# Runtime capability matrix

Discovery date: 2026-11-01. Evidence is the installed public package API/types and bundled ThinkRail runtime; capabilities refer to those versions only.

| Capability | Pi extension API / ThinkRail | pi-subagents 0.84.0 | Classification |
|---|---|---|---|
| Agent discovery | No general API that lists arbitrary external agents was found in the Pi SDK. | RPC `status` supports bounded current-session fleet records when `ping.capabilities.fleetStatus.version === 1`. Only same-process/current-session surface. | PARTIALLY SUPPORTED |
| Lifecycle observation | Pi provides events for its own parent agent (`agent_start`, `agent_end`, `turn_start`, `turn_end`), not child-agent lifecycle. | In-process event bus signals jobs changed/async started/child status/async complete/process terminal; status RPC returns bounded current-session data. `jobs-changed` child activity may lag up to 5 seconds. | PARTIALLY SUPPORTED |
| Model inspection | `ctx.model`, `ctx.thinkingLevel`; model registry provides catalog and model metadata. | Fleet/status rows report model/effort when known; child records may be omitted or not yet resolved. | PARTIALLY SUPPORTED |
| Thinking inspection | Parent `ctx.thinkingLevel`; not an arbitrary-agent inspection API. | RPC fleet DTO exposes effort; structured delegation terminal response may report actual thinking. | PARTIALLY SUPPORTED |
| Pre-spawn model configuration | `pi-subagents` launch API accepts model override; host model registry provides available model catalog. | RPC `spawn` accepts the model override used by this package. Actual child model was not observed in a live launch. | PARTIALLY SUPPORTED |
| Pre-spawn thinking configuration | Pi exposes per-model reasoning metadata and a `thinkingLevelMap`; no generic external launch API. | Public launch params include thinking override. The UI offers only levels with explicit non-null model metadata; runtime application was not verified in a live launch. | PARTIALLY SUPPORTED |
| Live model switching | `pi.setModel()` changes the current Pi session only; no verified child-worker live-switch API. | No live child model-switch method advertised. | UNSUPPORTED |
| Token usage | Pi session entries/context usage cover the parent session. | Fleet DTO provides input/output/total where known; RPC cost returns parent-plus-child report at request time. | PARTIALLY SUPPORTED |
| Agent cancellation | Pi `ctx.abort()` aborts the current parent operation, not arbitrary child selection. | RPC offers `interrupt`/`stop` for package-owned runs. Control is intentionally excluded from this MVP. | PARTIALLY SUPPORTED |
| ThinkRail status/commands | ThinkRail Canary 0.4.0-nightly.2 bundles the Pi runtime; installed SDK declares extension commands and native UI status/widgets/dialogs. | Same-process RPC and event bus as above when both extensions share the runtime. | PARTIALLY SUPPORTED; ThinkRail host-specific operation not smoke-tested |
| Optional runtime absence | Extensions can use Pi APIs without optional runtime imports. | Detect via RPC `ping`; absence/timeout is graceful and must be shown as unavailable, not as zero agents. | SUPPORTED |

## Verified versions and constraints

- ThinkRail Canary: `0.4.0-nightly.2`, build hash `3bxtzew7bw85t`.
- Pi SDK: `@earendil-works/pi-coding-agent` `1.4.0` and peers `@earendil-works/pi-agent-core`, `pi-ai`, `pi-tui` `1.4.0`.
- `pi-subagents`: `0.84.0`; `pi.events` is process-local and cannot discover separate Pi processes or child processes outside the advertised projection.
- Pi CLI executable was not on PATH. No Fabric installation was found in the inspected extension npm root.
- Existing custom `model-router` and `agent-model-pins` are outside this repository. Their source/config is not modified. The latter already alters Agent tool-call model input, so this package will not add a competing interception hook.

## Evidence references

Installed SDK declarations: `@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`, `dist/core/model-registry.d.ts`, and `dist/core/event-bus.d.ts`. Installed `pi-subagents/docs/extension-api.md`, `docs/observability.md`, `src/extension/rpc.d.ts`, `src/api/delegation.d.ts`, `src/api/external-runs.d.ts`, and `package.json`.
