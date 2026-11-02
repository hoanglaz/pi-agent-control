import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AgentRegistry } from "./core/agent-registry.ts";
import { SubagentsRpcAdapter } from "./adapters/subagents-rpc.ts";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

function formatStatus(agents: ReturnType<AgentRegistry["list"]>, available: boolean, totalActive: number, omitted: number): string {
  if (!available) return "pi-subagents unavailable";
  if (!totalActive) return "No active agents";
  if (!agents.length) return `${totalActive} active agents reported; details unavailable`;
  const rows = agents.map((agent) => {
    const details = [agent.model ? `model ${agent.model}` : undefined, agent.effort ? `effort ${agent.effort}` : undefined, agent.tokens ? `${agent.tokens.total} tokens` : undefined].filter(Boolean).join(" · ");
    return `• ${agent.name} — active; exact state unavailable${details ? ` (${details})` : ""}`;
  });
  if (omitted > 0) rows.push(`${omitted} additional active agents omitted by runtime limit`);
  return rows.join("\n");
}

export default function (pi: ExtensionAPI): void {
  const registry = new AgentRegistry();
  let adapter: SubagentsRpcAdapter | undefined;
  let currentContext: ExtensionContext | undefined;
  let sessionGeneration = 0;
  let totalActive = 0;
  let omitted = 0;

  const render = (available: boolean): void => {
    if (!currentContext) return;
    currentContext.ui.setStatus("agent-control-center", available ? `🤖 Agents: ${totalActive} active` : "🤖 Agents: runtime unavailable");
  };

  const connect = (ctx: ExtensionContext): void => {
    sessionGeneration++;
    currentContext = ctx;
    adapter?.dispose();
    adapter = new SubagentsRpcAdapter(pi.events, (agents, available, count, omittedCount) => {
      registry.replace(agents);
      totalActive = count ?? agents.length;
      omitted = omittedCount ?? 0;
      render(available);
    });
    void adapter.probe();
  };

  pi.on("session_start", (_event, ctx) => connect(ctx));
  pi.on("session_before_switch", () => { sessionGeneration++; });
  pi.on("session_before_fork", () => { sessionGeneration++; });
  pi.on("session_shutdown", () => {
    sessionGeneration++;
    adapter?.dispose();
    adapter = undefined;
    currentContext?.ui.setStatus("agent-control-center", undefined);
    currentContext = undefined;
    registry.replace([]);
    totalActive = 0;
    omitted = 0;
  });

  pi.registerCommand("agents-status", {
    description: "Show active pi-subagents agents when available",
    handler: async (_args, ctx) => {
      currentContext = ctx;
      const available = await adapter?.probe() ?? false;
      ctx.ui.notify(formatStatus(registry.list(), available, totalActive, omitted), available ? "info" : "warning");
    },
  });

  pi.registerCommand("agent-control", {
    description: "Launch an async pi-subagents agent with a one-run model override",
    handler: async (_args, ctx) => {
      const commandAdapter = adapter;
      const commandGeneration = sessionGeneration;
      const commandSessionId = ctx.sessionManager.getSessionId();
      if (!commandAdapter) {
        ctx.ui.notify("pi-subagents is not available in this session; no agent was launched.", "warning");
        return;
      }
      const isCurrent = () => adapter === commandAdapter
        && sessionGeneration === commandGeneration
        && ctx.sessionManager.getSessionId() === commandSessionId
        && !commandAdapter.isDisposed;

      const available = await commandAdapter.probe();
      if (!isCurrent()) return;
      if (!available) {
        ctx.ui.notify("pi-subagents is not available in this session; no agent was launched.", "warning");
        return;
      }
      const agentInput = await ctx.ui.input("Agent / role", "e.g. reviewer");
      if (!isCurrent()) return;
      const agent = agentInput?.trim();
      if (!agent) return;
      const taskInput = await ctx.ui.input("Agent task", "Describe the work");
      if (!isCurrent()) return;
      const task = taskInput?.trim();
      if (!task) return;
      if (/[\r\n]/.test(agent)) {
        ctx.ui.notify("Agent name cannot contain a newline.", "error");
        return;
      }

      const models = ctx.modelRegistry.getAvailable();
      const modelOptions = models.map((model) => `${model.provider}/${model.id}`);
      if (!modelOptions.length) {
        ctx.ui.notify("No models are available in the Pi model registry.", "warning");
        return;
      }
      const modelChoice = await ctx.ui.select("Model for this launch", modelOptions);
      if (!isCurrent()) return;
      if (!modelChoice) return;
      const model = models.find((candidate) => `${candidate.provider}/${candidate.id}` === modelChoice);
      if (!model) {
        ctx.ui.notify("The selected model is no longer available; no agent was launched.", "error");
        return;
      }

      let thinking: string | undefined;
      const supportedThinking = model.reasoning
        ? THINKING_LEVELS.filter((level) => model.thinkingLevelMap?.[level] != null)
        : [];
      if (supportedThinking.length) {
        const choice = await ctx.ui.select("Requested thinking level", ["Runtime default", ...supportedThinking]);
        if (!isCurrent()) return;
        if (!choice) return;
        thinking = choice === "Runtime default" ? undefined : choice;
      }

      // spawn emits synchronously; keep validation and the launch boundary in one event-loop turn.
      if (!isCurrent()) return;
      const reply = await commandAdapter.spawn({
        agent,
        task,
        model: `${model.provider}/${model.id}`,
        ...(thinking ? { thinking } : {}),
      });
      if (!isCurrent()) return;
      if (!reply?.success) {
        ctx.ui.notify(reply?.error?.message ?? "pi-subagents did not acknowledge the launch; no success is reported.", "error");
        return;
      }
      ctx.ui.notify(`Launch accepted for ${agent}. Requested ${model.provider}/${model.id}${thinking ? ` · thinking ${thinking}` : ""}. Actual model is not yet confirmed.`, "info");
    },
  });
}
