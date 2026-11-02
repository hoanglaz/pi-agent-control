export type AgentStatus = "running" | "queued" | "completed" | "failed" | "cancelled" | "unknown";

export interface AgentRecord {
  id: string;
  runtime: string;
  name: string;
  role?: string;
  status: AgentStatus;
  task?: string;
  model?: string;
  effort?: string;
  startedAt?: number;
  tokens?: { input: number; output: number; total: number };
}

/** Current-session view keyed by opaque runtime IDs; never interpret IDs across refreshes. */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentRecord>();

  replace(records: readonly AgentRecord[]): void {
    this.agents.clear();
    for (const record of records) this.agents.set(record.id, { ...record });
  }

  list(): AgentRecord[] {
    return [...this.agents.values()].map((agent) => ({ ...agent }));
  }
}
