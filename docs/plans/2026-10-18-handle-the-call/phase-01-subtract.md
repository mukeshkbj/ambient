# Phase 1: Subtract the v1 adapters

[Back to overview](overview.md)

## Goal

Merge the L0 fixes and delete every module the call product does not use, so later phases build on a smaller base and the AI repo reviewer stops flagging dead code.

## Changes

1. Merge `lane/L0-p0` into the integration branch (3 commits: `/sim/api` auth and `AMBIENT_HOST`, elicitation on the call's SSE stream, task cancel). `git merge-tree` reports no conflicts.
2. Delete these files and their tests:

| Delete | Tests to delete |
|---|---|
| `src/hermes.ts`, `src/raw.ts`, `src/connector.ts` | `test/hermes-contract.test.ts`, `test/connector.test.ts` |
| `src/runtimes/openclaw.ts`, `src/runtimes/http.ts` | OpenClaw cases and `FakeSocket` in `test/adapters.test.ts` |
| `src/runtimes/bedrock.ts`, `src/runtimes/bedrock-tools.ts` | `test/bedrock.test.ts` |
| `src/sim-router.ts` | none |
| `scripts/check-hermes.ts`, `scripts/check-hermes-contract.ts`, `scripts/check-hermes-source-contract.py`, `scripts/connect-local.ts` | none |
| `runtimes.bedrock.json` | none |

3. `src/dashboard.ts`: move `TASK_HTML` and `HOST_BOOT` into a new `src/task-view.ts`. Delete the `dashboard` tool, the dashboard resource, `dashboardSnapshot`, and `DASHBOARD_HTML`. Update `src/mcp.ts` and `src/voice.ts` (`DASHBOARD_RESOURCE_URI`). Update the tool-list assertions in `test/mcp.test.ts` and `test/http.test.ts`.
4. Remove server-side connector plumbing: `RuntimeEntry.connector`, `registry.connectors()`, `ConnectorConnection`, `AssistantWireEvent`, and the connector routes and wiring in `src/server.ts`.
5. `src/config.ts`: delete the `HERMES_*` and `CONNECTOR_TOKEN` env keys and the Hermes runtime shorthand. Keep the "at least one runtime" error, reworded to name `AMBIENT_RUNTIMES_FILE`. Rewrite `test/config.test.ts` around a runtimes file.
6. `src/sim.ts`: delete `route`, `turn`, and `/sim/api/turn`. The sim page sends tool calls directly (phase 9 rebuilds the page). Remove the typed-input box from `web/sim/index.html` for now.
7. `src/runtimes/demo.ts`: delete the `deploy`, `research`, `fail`, and `echo` scripts. Keep `DemoClient` and the planner script only until phase 5 replaces the demo runtime with the caller. Delete `test/demo.test.ts` "marks deploy work unknown".
8. Rewrite `test/adapters.test.ts` dispatch test for adapters `{demo}`; keep the cancel-versus-late-submit regression.
9. `package.json`: remove scripts `check:hermes`, `check:hermes-contract`, `connector`, `dev:bedrock`; remove `@aws-sdk/client-bedrock-runtime`. Keep `ws`.
10. Interaction models, `.env.example`, `runtimes.example.json`, README, `docs/runtimes.md`, `docs/adapters.md`, `docs/acceptance.md`, `docs/demo-runbook.md`: remove references to deleted adapters and the `dashboard` tool. Rename "Hermes" names in `infra/stack.ts` (`HermesAmbientStack` to `AmbientStack`, `/opt/hermesambient` to `/opt/ambient`). Remove the Nova IAM block; phase 10 adds Bedrock Claude access.

## Data structures

None new. `ADAPTERS` in `src/runtimes/registry.ts` shrinks to `{ demo }`.

## Verification

- Static: `pnpm install && pnpm scan && pnpm build` green. `knip` reports nothing unused.
- Runtime: `pnpm demo`, then call the `delegate` tool through `/mcp` with the SDK client script in `scripts/smoke-mcp.ts` (or `curl`); the planner booking reaches `waiting_approval` and completes after `approve`.
- `rg -i "hermes|openclaw|nova|bedrock-runtime|dashboard" src test scripts` returns only intended hits (none, or the `task-view` resource).

## Done when

All of the above pass and one commit lands: "Remove v1 adapters and the dashboard tool".
