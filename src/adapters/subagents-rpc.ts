import type { AgentRecord } from "../core/agent-registry.ts";

type EventBus = {
  on(channel: string, handler: (data: unknown) => void): () => void;
  emit(channel: string, data: unknown): void;
};

export interface FleetEntry {
  key: string;
  agent: string;
  role?: string;
  model?: string;
  effort?: string;
  startedAt?: number;
  tokens?: { input?: number; output?: number; total?: number };
  goal?: string;
}

interface RpcReply<T = unknown> {
  version: 1;
  requestId: string;
  success: boolean;
  data?: T;
  error?: { message?: string };
}

interface PendingRequest {
  settle: (reply: RpcReply | undefined) => void;
  dispose: () => void;
}

const REQUEST_EVENT = "subagents:rpc:v1:request";
const READY_EVENT = "subagents:rpc:v1:ready";
const REPLY_PREFIX = "subagents:rpc:v1:reply:";

export class SubagentsRpcAdapter {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly unsubscribers: Array<() => void> = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private probeRequest: Promise<boolean> | undefined;
  private statusRead: Promise<AgentRecord[]> | undefined;
  private refreshAfterRead = false;
  private available = false;
  private disposed = false;
  private capabilities: Record<string, unknown> = {};
  private watching = false;

  constructor(
    private readonly events: EventBus,
    private readonly onChange: (agents: AgentRecord[], available: boolean, totalActive?: number, omitted?: number) => void,
  ) {
    this.unsubscribers.push(events.on(READY_EVENT, () => void this.probe()));
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  async probe(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.probeRequest) return this.probeRequest;
    const request = this.probeRuntime();
    this.probeRequest = request;
    try {
      return await request;
    } finally {
      if (this.probeRequest === request) this.probeRequest = undefined;
    }
  }

  private async probeRuntime(): Promise<boolean> {
    const reply = await this.request("ping");
    if (this.disposed) return false;
    const data = reply?.data && typeof reply.data === "object" ? reply.data as { capabilities?: Record<string, unknown>; events?: Record<string, unknown> } : undefined;
    const fleetStatus = data?.capabilities?.fleetStatus as { version?: unknown } | undefined;
    this.available = !!reply?.success && fleetStatus?.version === 1;
    if (this.available && data) {
      this.capabilities = data.capabilities ?? {};
      if (!this.watching) {
        const advertised = data.events;
        for (const key of ["asyncComplete", "asyncStarted", "childStatus", "processTerminal", "jobsChanged"] as const) {
          const event = advertised?.[key];
          if (typeof event === "string") this.unsubscribers.push(this.events.on(event, () => this.scheduleRefresh()));
        }
        this.watching = true;
      }
      await this.refresh();
    } else {
      this.onChange([], false);
    }
    return this.available;
  }

  async refresh(): Promise<AgentRecord[]> {
    if (this.disposed) return [];
    if (this.statusRead) return this.statusRead;
    const request = this.readStatus();
    this.statusRead = request;
    try {
      return await request;
    } finally {
      if (this.statusRead === request) this.statusRead = undefined;
      if (this.refreshAfterRead && !this.disposed) {
        this.refreshAfterRead = false;
        void this.refresh();
      } else {
        this.refreshAfterRead = false;
      }
    }
  }

  private async readStatus(): Promise<AgentRecord[]> {
    const reply = await this.request("status");
    if (this.disposed) return [];
    const fleet = (reply?.data as { fleet?: { entries?: FleetEntry[]; totalActive?: number; omitted?: number } } | undefined)?.fleet;
    if (!reply?.success || !fleet || !Array.isArray(fleet.entries) || !fleet.entries.every((entry) =>
      entry && typeof entry.key === "string" && typeof entry.agent === "string",
    )) {
      this.available = false;
      this.onChange([], false);
      return [];
    }
    const records = fleet.entries.map((entry): AgentRecord => ({
      id: entry.key,
      runtime: "pi-subagents",
      name: entry.agent,
      role: entry.role,
      status: "unknown",
      task: entry.goal,
      model: entry.model,
      effort: entry.effort,
      startedAt: entry.startedAt,
      ...(entry.tokens && typeof entry.tokens.input === "number" && typeof entry.tokens.output === "number" && typeof entry.tokens.total === "number"
        ? { tokens: { input: entry.tokens.input, output: entry.tokens.output, total: entry.tokens.total } }
        : {}),
    }));
    const totalActive = typeof fleet.totalActive === "number" && Number.isSafeInteger(fleet.totalActive) && fleet.totalActive >= 0
      ? fleet.totalActive
      : records.length;
    const omitted = typeof fleet.omitted === "number" && Number.isSafeInteger(fleet.omitted) && fleet.omitted >= 0
      ? fleet.omitted
      : 0;
    this.available = true;
    this.onChange(records, true, totalActive, omitted);
    return records;
  }

  async spawn(params: { agent: string; task: string; model?: string; thinking?: string }): Promise<RpcReply | undefined> {
    if (this.disposed || !this.available) return undefined;
    return this.request("spawn", params);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    for (const pending of this.pending.values()) {
      pending.dispose();
      pending.settle(undefined);
    }
    this.pending.clear();
    this.available = false;
    this.probeRequest = undefined;
    this.watching = false;
    this.refreshAfterRead = false;
  }

  private scheduleRefresh(): void {
    if (this.disposed) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      if (this.disposed) return;
      if (this.statusRead) this.refreshAfterRead = true;
      else void this.refresh();
    }, 250);
  }

  private request(method: string, params?: unknown): Promise<RpcReply | undefined> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const unsubscribe = this.events.on(`${REPLY_PREFIX}${requestId}`, (data) => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        pending.dispose();
        this.pending.delete(requestId);
        const reply = data as Partial<RpcReply> | null;
        if (!reply || reply.version !== 1 || reply.requestId !== requestId || typeof reply.success !== "boolean") {
          pending.settle(undefined);
          return;
        }
        pending.settle(reply as RpcReply);
      });
      const timer = setTimeout(() => {
        const pending = this.pending.get(requestId);
        pending?.dispose();
        this.pending.delete(requestId);
        pending?.settle(undefined);
      }, 1500);
      const dispose = () => {
        clearTimeout(timer);
        unsubscribe();
      };
      this.pending.set(requestId, { settle: resolve, dispose });
      this.events.emit(REQUEST_EVENT, { version: 1, requestId, method, ...(params ? { params } : {}), source: { extension: "pi-agent-control-center" } });
    });
  }
}
