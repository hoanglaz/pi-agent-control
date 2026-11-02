---
id: agent-control-center-goal
type: goal-and-requirements
title: Pi Agent Control Center
status: active
---

# Pi Agent Control Center

A trustworthy, lightweight control surface for monitoring and routing agents in Pi-based coding environments.

## Overview

`pi-agent-control-center` is a public Pi Package for observing and configuring agents through verified Pi and ThinkRail APIs. It should work without optional runtimes such as pi-fabric, report capability boundaries honestly, and avoid interfering with external orchestration. The initial release prioritizes reliable observation and routing for agents launched through this package, then adds third-party adapters only where their APIs are verified.

## Problem Statement

Developers using multiple Pi agent runtimes lack one reliable view of agent state and model configuration. Runtime APIs and host UI capabilities vary, so a control surface that assumes universal visibility or control risks stale data and misleading claims.

## Target Users

- Pi coding-environment users who launch or observe multiple agents.
- Maintainers integrating compatible Pi runtimes and extensions.

## Jobs to Be Done

- When agents are active across a coding session, I want a concise view of verified lifecycle and model information, so I can understand what is running without extra LLM usage.
- When I launch a supported agent, I want role and runtime model policies applied before launch, so its requested configuration is explicit and auditable.

## Key User Story

A developer installs the package in Pi or ThinkRail, launches a supported managed agent, and sees its lifecycle and requested/effective model details in the supported host UI. Without an optional runtime, the package still loads and reports that integration as unavailable.

## Goals

- Provide an installable, independently usable Pi Package with public documentation and automated checks.
- Monitor verified agent lifecycles without LLM calls, busy loops, or interference with agent execution.
- Apply model and thinking preferences before supported managed launches, distinguishing configured, requested, and runtime-confirmed actual values.
- Integrate with ThinkRail UI only through verified APIs and state capability limitations clearly.
- Keep optional runtimes optional and avoid private APIs or third-party modifications.

## Non-Goals

- Claiming universal visibility or control over runtimes that expose no supported integration API.
- Changing or restarting already-running workers when configuration changes.
- Publishing publicly or modifying/pushing to public repositories without explicit approval.
- Replacing existing external orchestration systems.

## Success Conditions

- Package loads through Pi's package mechanism and remains usable when optional runtimes are absent.
- Tests and package validation cover core registry, routing, configuration, and graceful degradation.
- Documentation distinguishes implemented features from runtime-verified capabilities.
- Public release readiness is reported with actual evidence; publication remains gated on user approval.

## Capabilities

- Maintain a deduplicated agent registry with lifecycle, runtime, task, model, thinking, timing, and optional usage/error details.
- Route role/runtime/default model and thinking preferences for supported managed launches, honoring explicit overrides and runtime-confirmed capabilities.
- Provide host-supported commands and status/detail UI for verified agent data.
- Persist validated global and project settings without credentials, with safe migration behavior that does not silently overwrite existing configuration.
- Expose runtime adapters with explicit capability declarations and graceful absence behavior.
- Package, test, document, and prepare a secure release pipeline for independent installation.

## Non-Functional Requirements

- Monitoring uses no LLM calls; event-driven updates are preferred and any polling is bounded and cleaned up.
- No monkey-patching private APIs, storing provider credentials, or automatic interruption of running agents.
- Keep dependencies and runtime overhead minimal; avoid excess scans, logging, and persistent processes.

## Technology

| Aspect | Choice | Rationale |
|---|---|---|
| Runtime | TypeScript Pi extension/package | Required for Pi package ecosystem and its extension APIs. |
| Integration | Capability-declared adapters over verified public APIs | Runtime support varies and optional runtimes must remain optional. |
| First-release scope | Verified core monitoring/routing; broader adapters only where discovery confirms support | User selected a trustworthy core rather than speculative broad integration. |
