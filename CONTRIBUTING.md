# Contributing

Contributions should preserve the verified-capability boundary: do not infer APIs, inspect undocumented private state, or claim control over agents the runtime does not expose. Keep optional runtimes optional and never modify user routing configuration implicitly.

## Development

- Node.js >=22.19.0 and Bun are required.
- Install with `npm install`.
- Run `npm run typecheck`, `npm test`, and `npm pack --dry-run` before submitting.
- Tests and monitoring must not make model calls. Do not launch paid agents in automated tests.
- Add evidence to `RUNTIME-CAPABILITIES.md` when adding runtime behavior.

## Changes

Keep changes scoped, document user-visible behavior and limitations, and include regression tests for new logic. Do not include credentials, session logs, personal configuration, or local runtime files in commits. Release or publication requires explicit maintainer approval.
