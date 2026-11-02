# Pi Agent Control Center

A small Pi extension for event-driven visibility into the current session's `pi-subagents` fleet and an explicit, one-run model override when launching a child. It uses no LLM calls for monitoring and does not require `pi-subagents` to load.

> **Development status:** `0.1.0` source scaffold. The package has not been published to npm, and the ThinkRail UI has not been smoke-tested. See [`RUNTIME-CAPABILITIES.md`](RUNTIME-CAPABILITIES.md) for the evidence-based capability matrix.

## Features

- `/agents-status` shows current-session active `pi-subagents` fleet entries when the runtime advertises fleet status.
- `/agent-control` launches an async child through `pi-subagents` RPC after selecting an agent/role, task, model from Pi's available model registry, and a thinking level explicitly allowed by model metadata.
- Status bar displays the current active count; advertised lifecycle events trigger a debounced status refresh. There is no polling loop.
- Monitoring is read-only. The extension never interrupts, stops, restarts, or live-switches an existing worker.
- Missing `pi-subagents` is reported as unavailable; it is not shown as an empty fleet.

## Compatibility

| Runtime / capability | Status |
|---|---|
| Pi SDK `@earendil-works/pi-coding-agent` 1.4.0 extension API | Implemented against verified declarations |
| ThinkRail Canary 0.4.0-nightly.2 | Uses the embedded Pi extension API; host integration not end-to-end tested |
| `pi-subagents` 0.84.0 | Current-session fleet status and async RPC spawn supported when co-installed in the same Pi process |
| pi-fabric | Not detected in the inspected environment; unsupported by this MVP |
| Separate Pi processes / arbitrary external agents | Unsupported; Pi event bus is process-local |
| Live model switching, cancellation, stop controls | Unsupported by this package |

The API and version evidence is in [`RUNTIME-CAPABILITIES.md`](RUNTIME-CAPABILITIES.md). A fleet DTO reports an active set, not exact per-agent lifecycle states. Entries therefore display `active; exact state unavailable`. Model/effort values are reported only if the runtime provides them; an effort label is not asserted to be an actual Pi thinking configuration. A requested model is not described as actual until the runtime confirms it.

## Installation

After an approved npm release, install with Pi:

```sh
pi install npm:pi-agent-control-center
```

ThinkRail package installation is intended through **Settings → Extensions → Install package**, using source `npm:pi-agent-control-center`. That host UI flow has not yet been verified in this environment.

This repository is not published yet, so neither command will install a public release today. For local development, run Pi with the extension file once Pi is installed:

```sh
pi --extension ./src/index.ts
```

## Usage

- `/agents-status` requests a fresh snapshot from the same-process `pi-subagents` RPC endpoint.
- `/agent-control` prompts for the configured `pi-subagents` agent name, task, a Pi model from the available model registry and, when per-level model metadata explicitly allows it, a requested thinking level. The runtime may reject or normalize configuration. The command only reports launch acceptance; inspect the runtime's own status to confirm effective model/thinking.

Monitoring performs no model requests. Launching an agent does use the selected model as normal.

## Settings, routing, and privacy

This MVP stores no settings and does not modify Pi settings, `agent-model-pins`, `model-router`, or `pi-subagents` configuration. Each launch uses an explicit one-run choice; no persistent role rules or fallback model are currently implemented. No provider credentials are written by this extension; the Pi registry supplies model options and its existing auth remains the runtime's responsibility.

## Adapter architecture

`src/adapters/subagents-rpc.ts` speaks only the documented v1 in-process event-bus RPC protocol. It does not import `pi-subagents` at runtime. The adapter checks the runtime's `ping` capability before exposing status, listens only to advertised event channels, and debounces burst refreshes. The registry replaces each snapshot using opaque runtime keys and does not interpret them as run identifiers.

## Limitations and troubleshooting

- If `/agents-status` reports the runtime unavailable, verify `pi-subagents` is installed, loaded in the same Pi process, and advertises `fleetStatus: { version: 1 }`.
- A missing or delayed row is not evidence that no agent exists elsewhere. The fleet view is current-session, bounded, and may lag child activity.
- Model selection is limited to the Pi model registry's available models. A thinking choice is shown only for reasoning-capable models with explicit non-null per-level metadata; missing or unsupported level metadata is not guessed. `pi-subagents` remains authoritative at launch.
- The requested configuration may not equal the actual child configuration. This extension does not restart or modify a running worker.
- No Fabric, cross-process, cancellation, live switching, persistent global/project routing, legacy config migration, or config-file management is implemented.

## Security

Extensions run with the host process's permissions. Review package source before installing. The extension sends only the user's chosen agent, task, model, and thinking request to the documented `pi-subagents` RPC endpoint. It never reads provider secrets, writes arbitrary files, shells out, or invokes monitoring LLM calls.

## Development

Requirements: Node.js >=22.19 and Bun for tests; the Pi host package is supplied by Pi at runtime. Install development dependencies, then run:

```sh
npm install
npm run typecheck
npm test
npm pack --dry-run
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for checks and contribution scope, and [`RELEASE.md`](RELEASE.md) for the approval-gated manual release process. Runtime smoke tests must not launch costly agents unless explicitly approved.

## Uninstallation

Remove `npm:pi-agent-control-center` from Pi with `pi remove npm:pi-agent-control-center`, or remove it through ThinkRail's Extensions settings. This package has no persistent state to clean up.

## Release status

Not published. Package-name lookup returned npm `E404 Not Found` during discovery, which is not a guarantee of future availability. No GitHub repository or public catalog entry has been created or verified. An authenticated maintainer must approve and perform public release actions.
