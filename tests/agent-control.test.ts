import { describe, expect, test } from "bun:test";
import { AgentRegistry } from "../src/core/agent-registry.ts";
import { SubagentsRpcAdapter } from "../src/adapters/subagents-rpc.ts";
import agentControl from "../src/index.ts";

class FakeBus {
  private readonly handlers = new Map<string, Set<(data: unknown) => void>>();
  requests: Array<Record<string, unknown>> = [];
  malformedFleet = false;
  delayNextStatus = false;
  delayNextPing = false;
  failNextStatus = false;
  statusCount = 1;
  private pendingStatus: (() => void) | undefined;
  private pendingPing: (() => void) | undefined;
  afterPingReply: (() => void) | undefined;

  constructor(private readonly online = true) {}

  completePendingStatus(): void {
    const complete = this.pendingStatus;
    this.pendingStatus = undefined;
    complete?.();
  }

  completePendingPing(): void {
    const complete = this.pendingPing;
    this.pendingPing = undefined;
    complete?.();
  }

  on(channel: string, handler: (data: unknown) => void): () => void {
    const listeners = this.handlers.get(channel) ?? new Set();
    listeners.add(handler);
    this.handlers.set(channel, listeners);
    return () => listeners.delete(handler);
  }

  emit(channel: string, data: unknown): void {
    if (channel === "subagents:rpc:v1:request") {
      if (!this.online) return;
      const request = data as Record<string, unknown>;
      this.requests.push(request);
      const method = request.method;
      const ping = method === "ping";
      const result = ping
        ? { capabilities: { fleetStatus: { version: 1 } }, events: { ready: "subagents:rpc:v1:ready", request: "subagents:rpc:v1:request", replyPrefix: "subagents:rpc:v1:reply:", jobsChanged: "subagent:jobs-changed" } }
        : method === "status"
          ? { fleet: { version: 1, totalActive: this.statusCount, omitted: 0, entries: this.malformedFleet ? [null] : [{ key: "opaque", agent: "reviewer", model: "provider/model", effort: "high", startedAt: 10, goal: "Review", tokens: { input: 4, output: 6, total: 10 } }] } }
          : { runId: "run-1" };
      this.dispatch(channel, data);
      if (method === "ping" && this.delayNextPing) {
        this.delayNextPing = false;
        this.pendingPing = () => this.reply(request, result);
        return;
      }
      if (method === "status" && this.delayNextStatus) {
        this.delayNextStatus = false;
        const success = !this.failNextStatus;
        this.failNextStatus = false;
        this.pendingStatus = () => this.reply(request, result, success);
        return;
      }
      if (method === "status" && this.failNextStatus) {
        this.failNextStatus = false;
        this.reply(request, result, false);
        return;
      }
      this.reply(request, result);
      return;
    }
    this.dispatch(channel, data);
  }

  private reply(request: Record<string, unknown>, result: unknown, success = true): void {
    this.dispatch(`subagents:rpc:v1:reply:${request.requestId}`, {
      version: 1,
      requestId: request.requestId,
      success,
      data: result,
    });
    if (request.method === "ping") this.afterPingReply?.();
  }

  private dispatch(channel: string, data: unknown): void {
    for (const listener of this.handlers.get(channel) ?? []) listener(data);
  }
}

function createExtensionHarness(bus: FakeBus) {
  const commands = new Map<string, { handler: (args: string, ctx: never) => Promise<void> }>();
  const hooks = new Map<string, (...args: unknown[]) => void>();
  agentControl({
    events: bus,
    on: (name: string, handler: (...args: unknown[]) => void) => hooks.set(name, handler),
    registerCommand: (name: string, command: { handler: (args: string, ctx: never) => Promise<void> }) => commands.set(name, command),
  } as never);
  return { commands, hooks };
}

function createContext(
  sessionId: string,
  options: {
    input?: (title: string) => Promise<string | undefined>;
    select?: (title: string, choices: string[]) => Promise<string | undefined>;
    model?: { provider: string; id: string; reasoning?: boolean; thinkingLevelMap?: Record<string, number | null> };
    notify?: (message: string) => void;
  } = {},
) {
  let currentSessionId = sessionId;
  return {
    ctx: {
      sessionManager: { getSessionId: () => currentSessionId },
      ui: {
        input: options.input ?? (async (title: string) => title === "Agent / role" ? "reviewer" : "Review this"),
        select: options.select ?? (async (_title: string, choices: string[]) => choices[0]),
        notify: options.notify ?? (() => {}),
        setStatus: () => {},
      },
      modelRegistry: { getAvailable: () => [options.model ?? { provider: "provider", id: "model" }] },
    },
    setSessionId: (value: string) => { currentSessionId = value; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("AgentRegistry", () => {
  test("replaces records by opaque ID and returns copies", () => {
    const registry = new AgentRegistry();
    registry.replace([
      { id: "same", runtime: "test", name: "old", status: "unknown" },
      { id: "same", runtime: "test", name: "new", status: "running" },
    ]);
    const listed = registry.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("new");
    listed[0]!.name = "mutated";
    expect(registry.list()[0]?.name).toBe("new");
  });
});

describe("SubagentsRpcAdapter", () => {
  test("probes the optional runtime and maps its current-session fleet", async () => {
    const bus = new FakeBus();
    let observed: { agents: ReturnType<AgentRegistry["list"]>; available: boolean; count?: number } | undefined;
    const adapter = new SubagentsRpcAdapter(bus, (agents, available, count) => { observed = { agents, available, count }; });

    expect(await adapter.probe()).toBe(true);
    expect(observed?.available).toBe(true);
    expect(observed?.count).toBe(1);
    expect(observed?.agents[0]).toMatchObject({
      id: "opaque",
      runtime: "pi-subagents",
      name: "reviewer",
      status: "unknown",
      model: "provider/model",
      effort: "high",
      tokens: { input: 4, output: 6, total: 10 },
    });
    expect(bus.requests.map((request) => request.method)).toEqual(["ping", "status"]);
    await Bun.sleep(300);
    expect(bus.requests.filter((request) => request.method === "status")).toHaveLength(1);
    bus.emit("subagent:jobs-changed", { version: 1 });
    await Bun.sleep(300);
    expect(bus.requests.filter((request) => request.method === "status")).toHaveLength(2);

    const launched = await adapter.spawn({ agent: "reviewer", task: "Review", model: "provider/model", thinking: "high" });
    expect(launched?.success).toBe(true);
    expect(bus.requests.at(-1)).toMatchObject({
      method: "spawn",
      params: { agent: "reviewer", task: "Review", model: "provider/model", thinking: "high" },
    });
    adapter.dispose();
  });

  test("coalesces overlapping runtime probes", async () => {
    const bus = new FakeBus();
    bus.delayNextPing = true;
    const adapter = new SubagentsRpcAdapter(bus, () => {});
    const first = adapter.probe();
    const second = adapter.probe();
    await Bun.sleep(0);
    const pingCount = bus.requests.filter((request) => request.method === "ping").length;
    bus.completePendingPing();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(pingCount).toBe(1);
    adapter.dispose();
  });

  test("does not issue work or notify after disposal during a synchronous ping reply", async () => {
    const bus = new FakeBus();
    let changes = 0;
    const adapter = new SubagentsRpcAdapter(bus, () => changes++);
    bus.afterPingReply = () => adapter.dispose();
    expect(await adapter.probe()).toBe(false);
    expect(bus.requests.map((request) => request.method)).toEqual(["ping"]);
    expect(changes).toBe(0);
  });

  test("recovers availability after a lifecycle-triggered status retry", async () => {
    const bus = new FakeBus();
    bus.failNextStatus = true;
    let available = true;
    const adapter = new SubagentsRpcAdapter(bus, (_agents, value) => { available = value; });
    expect(await adapter.probe()).toBe(false);
    expect(available).toBe(false);
    bus.emit("subagent:jobs-changed", {});
    await Bun.sleep(300);
    expect(available).toBe(true);
    expect((await adapter.spawn({ agent: "reviewer", task: "Review" }))?.success).toBe(true);
    adapter.dispose();
  });

  test("runs a queued lifecycle refresh after a failed in-flight status read", async () => {
    const bus = new FakeBus();
    bus.delayNextStatus = true;
    bus.failNextStatus = true;
    let available = true;
    const adapter = new SubagentsRpcAdapter(bus, (_agents, value) => { available = value; });
    const probe = adapter.probe();
    await Bun.sleep(0);
    bus.emit("subagent:jobs-changed", {});
    await Bun.sleep(300);
    bus.completePendingStatus();
    await probe;
    await Bun.sleep(0);
    expect(bus.requests.filter((request) => request.method === "status")).toHaveLength(2);
    expect(available).toBe(true);
    expect((await adapter.spawn({ agent: "reviewer", task: "Review" }))?.success).toBe(true);
    adapter.dispose();
  });

  test("serializes status reads and keeps a lifecycle-triggered trailing refresh", async () => {
    const bus = new FakeBus();
    bus.delayNextStatus = true;
    let latestCount = 0;
    const adapter = new SubagentsRpcAdapter(bus, (_agents, _available, count) => { latestCount = count ?? 0; });
    const probe = adapter.probe();
    await Bun.sleep(0);
    expect(bus.requests.filter((request) => request.method === "status")).toHaveLength(1);

    bus.emit("subagent:jobs-changed", {});
    await Bun.sleep(300);
    expect(bus.requests.filter((request) => request.method === "status")).toHaveLength(1);

    bus.statusCount = 2;
    bus.completePendingStatus();
    await probe;
    await Bun.sleep(0);
    expect(bus.requests.filter((request) => request.method === "status")).toHaveLength(2);
    expect(latestCount).toBe(2);
    adapter.dispose();
  });

  test("reports malformed fleet data as unavailable", async () => {
    const bus = new FakeBus();
    bus.malformedFleet = true;
    let available = true;
    const adapter = new SubagentsRpcAdapter(bus, (_agents, value) => { available = value; });
    expect(await adapter.probe()).toBe(false);
    expect(available).toBe(false);
    adapter.dispose();
  });

  test("does not spawn when the thinking selector is cancelled", async () => {
    const bus = new FakeBus();
    const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    const hooks = new Map<string, (...args: unknown[]) => void>();
    agentControl({
      events: bus,
      on: (name: string, handler: (...args: unknown[]) => void) => hooks.set(name, handler),
      registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, command),
    } as never);
    const notices: string[] = [];
    let selection = 0;
    const ctx = {
      sessionManager: { getSessionId: () => "session-1" },
      ui: {
        input: async () => selection++ === 0 ? "reviewer" : "Review this",
        select: async () => selection++ === 2 ? "provider/model" : undefined,
        notify: (message: string) => notices.push(message),
        setStatus: () => {},
      },
      modelRegistry: { getAvailable: () => [{ provider: "provider", id: "model", reasoning: true, thinkingLevelMap: { low: 1, high: 2 } }] },
    };
    hooks.get("session_start")?.({}, ctx);
    await commands.get("agent-control")?.handler("", ctx);
    expect(bus.requests.some((request) => request.method === "spawn")).toBe(false);
    expect(notices).toHaveLength(0);
  });

  test("uses runtime default only when explicitly selected", async () => {
    const bus = new FakeBus();
    const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    const hooks = new Map<string, (...args: unknown[]) => void>();
    agentControl({
      events: bus,
      on: (name, handler) => hooks.set(name, handler),
      registerCommand: (name, command) => commands.set(name, command),
    } as never);
    let inputCount = 0;
    let selectCount = 0;
    const ctx = {
      sessionManager: { getSessionId: () => "session-1" },
      ui: {
        input: async () => inputCount++ === 0 ? "reviewer" : "Review this",
        select: async (_title: string, options: string[]) => selectCount++ === 0 ? options[0] : "Runtime default",
        notify: () => {},
        setStatus: () => {},
      },
      modelRegistry: { getAvailable: () => [{ provider: "provider", id: "model", reasoning: true, thinkingLevelMap: { low: 1, high: 2 } }] },
    };
    hooks.get("session_start")?.({}, ctx);
    await commands.get("agent-control")?.handler("", ctx);
    expect(bus.requests.find((request) => request.method === "spawn")).toMatchObject({
      params: { agent: "reviewer", task: "Review this", model: "provider/model" },
    });
    expect(bus.requests.find((request) => request.method === "spawn")?.params).not.toHaveProperty("thinking");
  });

  test("abandons a command after session switch while model selection is pending", async () => {
    const bus = new FakeBus();
    const { commands, hooks } = createExtensionHarness(bus);
    const modelChoice = deferred<string | undefined>();
    const modelPrompt = deferred<void>();
    const oldContext = createContext("session-a", {
      select: async () => { modelPrompt.resolve(); return modelChoice.promise; },
    });
    hooks.get("session_start")?.({}, oldContext.ctx);
    const command = commands.get("agent-control")!.handler("", oldContext.ctx as never);
    await modelPrompt.promise;

    hooks.get("session_shutdown")?.({});
    const newContext = createContext("session-b");
    hooks.get("session_start")?.({}, newContext.ctx);
    modelChoice.resolve("provider/model");
    await command;

    expect(bus.requests.some((request) => request.method === "spawn")).toBe(false);
  });

  test("invalidates a pending command before session teardown begins", async () => {
    const bus = new FakeBus();
    const { commands, hooks } = createExtensionHarness(bus);
    const modelChoice = deferred<string | undefined>();
    const modelPrompt = deferred<void>();
    const ctx = createContext("session-a", {
      select: async () => { modelPrompt.resolve(); return modelChoice.promise; },
    });
    hooks.get("session_start")?.({}, ctx.ctx);
    const command = commands.get("agent-control")!.handler("", ctx.ctx as never);
    await modelPrompt.promise;

    hooks.get("session_before_switch")?.({ reason: "resume" });
    modelChoice.resolve("provider/model");
    await command;

    expect(bus.requests.some((request) => request.method === "spawn")).toBe(false);
  });

  test("abandons a command when the captured session identity changes", async () => {
    const bus = new FakeBus();
    const { commands, hooks } = createExtensionHarness(bus);
    const modelChoice = deferred<string | undefined>();
    const modelPrompt = deferred<void>();
    const ctx = createContext("session-a", {
      select: async () => { modelPrompt.resolve(); return modelChoice.promise; },
    });
    hooks.get("session_start")?.({}, ctx.ctx);
    const command = commands.get("agent-control")!.handler("", ctx.ctx as never);
    await modelPrompt.promise;

    ctx.setSessionId("session-b");
    modelChoice.resolve("provider/model");
    await command;

    expect(bus.requests.some((request) => request.method === "spawn")).toBe(false);
  });

  test("abandons a command when its adapter is replaced in the same session", async () => {
    const bus = new FakeBus();
    const { commands, hooks } = createExtensionHarness(bus);
    const modelChoice = deferred<string | undefined>();
    const modelPrompt = deferred<void>();
    const ctx = createContext("session-a", {
      select: async () => { modelPrompt.resolve(); return modelChoice.promise; },
    });
    hooks.get("session_start")?.({}, ctx.ctx);
    const command = commands.get("agent-control")!.handler("", ctx.ctx as never);
    await modelPrompt.promise;

    hooks.get("session_start")?.({}, ctx.ctx);
    modelChoice.resolve("provider/model");
    await command;

    expect(bus.requests.some((request) => request.method === "spawn")).toBe(false);
  });

  test("abandons a command after adapter disposal", async () => {
    const bus = new FakeBus();
    const { commands, hooks } = createExtensionHarness(bus);
    const modelChoice = deferred<string | undefined>();
    const modelPrompt = deferred<void>();
    const ctx = createContext("session-a", {
      select: async () => { modelPrompt.resolve(); return modelChoice.promise; },
    });
    hooks.get("session_start")?.({}, ctx.ctx);
    const command = commands.get("agent-control")!.handler("", ctx.ctx as never);
    await modelPrompt.promise;

    hooks.get("session_shutdown")?.({});
    modelChoice.resolve("provider/model");
    await command;

    expect(bus.requests.some((request) => request.method === "spawn")).toBe(false);
  });

  test("generation rejects A-to-B-to-A while an old prompt is pending", async () => {
    const bus = new FakeBus();
    const { commands, hooks } = createExtensionHarness(bus);
    const modelChoice = deferred<string | undefined>();
    const modelPrompt = deferred<void>();
    const contextA = createContext("session-a", {
      select: async () => { modelPrompt.resolve(); return modelChoice.promise; },
    });
    hooks.get("session_start")?.({}, contextA.ctx);
    const command = commands.get("agent-control")!.handler("", contextA.ctx as never);
    await modelPrompt.promise;

    hooks.get("session_shutdown")?.({});
    const contextB = createContext("session-b");
    hooks.get("session_start")?.({}, contextB.ctx);
    hooks.get("session_shutdown")?.({});
    contextA.setSessionId("session-a");
    hooks.get("session_start")?.({}, contextA.ctx);
    modelChoice.resolve("provider/model");
    await command;

    expect(contextA.ctx.sessionManager.getSessionId()).toBe("session-a");
    expect(bus.requests.some((request) => request.method === "spawn")).toBe(false);
  });

  test("allows concurrent commands in the same session to launch independently", async () => {
    const bus = new FakeBus();
    const { commands, hooks } = createExtensionHarness(bus);
    let agentNumber = 0;
    const ctx = createContext("session-a", {
      input: async (title) => title === "Agent / role" ? `reviewer-${++agentNumber}` : "Review this",
    });
    hooks.get("session_start")?.({}, ctx.ctx);
    const handler = commands.get("agent-control")!.handler;

    await Promise.all([handler("", ctx.ctx as never), handler("", ctx.ctx as never)]);

    expect(bus.requests.filter((request) => request.method === "spawn")).toHaveLength(2);
  });

  test("handles a missing optional runtime and releases a pending probe", async () => {
    const bus = new FakeBus(false);
    const adapter = new SubagentsRpcAdapter(bus, () => {});
    const probe = adapter.probe();
    adapter.dispose();
    expect(await probe).toBe(false);
  });
});
