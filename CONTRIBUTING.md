# Contributing

Ambient makes phone calls for a household. Alexa starts the call, asks the owner when the call needs a decision, and reports only what the business confirmed.

## Setup

Ambient needs Node 22.13 or later and pnpm 10.

```bash
corepack enable          # or: npm i -g pnpm@10.33.0
pnpm install
pnpm demo                # http://127.0.0.1:3000/sim, /mcp, /healthz
```

The demo needs no keys. The business is simulated and the brain is scripted.

## Verification

```bash
pnpm scan        # typecheck, eslint, knip, vitest: the gate
pnpm build
pnpm smoke:mcp   # a full simulated call through /mcp (start pnpm demo first)
```

Run `pnpm scan` and `pnpm build` before a change is reviewed. Both must pass. The tests run in-process and need no external service.

## Where things live

| Path | Job |
|---|---|
| `src/calls/session.ts` | The pure call reducer, `step(state, input, now)`. All call logic and every honesty rule. |
| `src/calls/rules.ts` | Disclosure text, digit redaction, amount parsing, dial limits. |
| `src/calls/call.ts` | The shell that runs the reducer's effects against a line and a brain. |
| `src/calls/brain.ts`, `prompt.ts` | Claude and scripted brains. |
| `src/calls/line.ts`, `rooms.ts` | The simulated line and the AssemblyAI voice line. |
| `src/runtimes/caller.ts` | A call as a run in the engine (`AssistantClient`). |
| `src/conversations.ts` | The run lifecycle engine. |
| `src/mcp.ts`, `src/alexa.ts`, `src/sim.ts` | MCP tools, the Alexa skill, and the simulator host. |
| `src/voice.ts` | Every spoken sentence. |

## Rules

- A change to call behavior starts with a failing test in `test/call-session.test.ts`. The reducer stays pure: no clock, no network, no model.
- Spoken output never contains an internal id. `test/voice.test.ts` checks this.
- "Confirmed" means the business confirmed. A call that ends any other way is reported as unconfirmed.
- `docs/friction-log.md` records only friction that was actually reproduced, dated the day it was written.
- Do not weaken the security middleware (origin allowlists, DNS-rebinding protection, Alexa signature verification, the per-call secret on the voice endpoint) to make a test pass.
- No code comments. Names and tests carry the meaning.
