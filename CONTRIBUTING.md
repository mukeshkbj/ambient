# Contributing

Ambient is a voice-first gateway for background AI agents: assistants work
asynchronously, and Alexa (or the `/sim` simulator) tells you when they need
attention — approvals, completions, disconnects.

## Setup

Requires **Node ≥ 22.13** and **pnpm 10**.

```bash
corepack enable          # or: npm i -g pnpm@10.33.0
pnpm install
```

Run the zero-credential demo (deterministic, no AWS or API keys needed):

```bash
pnpm demo
# → http://127.0.0.1:3000/sim   Alexa+ simulator (real MCP client)
# → http://127.0.0.1:3000/mcp   Streamable HTTP MCP endpoint
# → http://127.0.0.1:3000/healthz
```

## Verification

```bash
pnpm scan        # typecheck + eslint + knip + tests — the gate
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest
pnpm build       # tsc -p tsconfig.json → dist/
```

Run `pnpm scan && pnpm build` before opening a change for review; both must be
green. Tests live in `test/` and run in-process — no external services are
required for the suite.

## Architecture in one paragraph

`src/conversations.ts` (`ConversationEngine`) owns the run lifecycle:
queued → accepted → running → waiting_approval → terminal, plus `unknown`
when a runtime disconnects mid-run. Runtimes plug in through `AssistantClient`
(`src/runtimes/types.ts`); each adapter maps its wire protocol onto the
canonical `AssistantEvent` union inside its own file. `src/mcp.ts` exposes the
voice-first tool surface (delegate, status, approve, stop, agents, briefing)
over Streamable HTTP MCP; `src/alexa.ts` serves the Alexa skill endpoint;
`src/sim.ts` + `web/sim/` are the browser simulator — a real MCP client on
loopback, not a mock.

## Adding a runtime adapter

See [`docs/adapters.md`](docs/adapters.md). In short: implement
`AssistantClient` against `src/runtimes/types.ts`, keep every wire field
inside your adapter, register it in `src/runtimes/registry.ts`, and add
contract tests that drive it through a fake socket or a mocked sender — the
`demo` adapter is the smallest working example.

Only claim an adapter is verified when it has been exercised against the real
service, and record the receipt in `docs/acceptance.md`. Adapters we cannot
verify are removed, not shipped.

## Voice rules

Spoken output never contains internal ids — sessions, runs, approvals, or
conversation ids. `test/voice.test.ts` enforces this with a golden corpus;
if your change adds speech, run it through `src/voice.ts` and keep the corpus
green.

## Honesty rules

- `unknown` is a legitimate run status. Do not turn a disconnected runtime's
  fate into `failed` or `completed`.
- `docs/acceptance.md` records only receipts actually produced on this repo.
- `docs/friction-log.md` logs only friction actually reproduced.
- Security middleware (origin allowlists, DNS-rebinding protection, Alexa
  signature verification) is load-bearing — do not weaken it to make a test
  pass.
