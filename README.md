# Ambient

**Your AI agents work in the background. Alexa tells you when they need you.**

Ambient is an ambient supervisor for a fleet of personal agents: they run for
minutes or hours — coding, booking, deploying — and when they hit a decision
only you can make, Alexa (or the bundled simulator) speaks up. Approvals are
elicited, disconnects are reported honestly as *unknown*, and no spoken reply
ever contains an internal id.

![Delegate a task, get asked to approve, approve by voice](docs/media/sim-approval.gif)

**Demo video:** [`docs/media/ambient-demo.mp4`](docs/media/ambient-demo.mp4) — 1:50, narrated, every beat captured live from the sim.

| | |
|---|---|
| **Track** | Alexa+ — primary track |
| **Compliance** | Self-hosted MCP server · MCP spec **2025-11-25** · Streamable HTTP |
| **Entry point** | `src/server.ts` → `createMcpServer` in `src/mcp.ts` |
| **Simulated Alexa+ host** | `/sim` — a real MCP client, not a mock |
| **Also** | `/alexa` signature-verified skill endpoint · `ui://ambient/task` MCP App views |
| **MCP Tasks** | `delegate_task` (experimental `taskSupport: "optional"`) — task-capable clients get a handle; `tasks/get` polls the run, `waiting_approval` maps to `input_required` |

## Run it in 60 seconds

Zero credentials, fully deterministic:

```sh
pnpm install
pnpm demo
# → open http://localhost:3000/sim
```

Call `delegate` on `/mcp` with *"Book Lupa for Saturday at 7"* — the task card
on `/sim` fills with live steps, the approval card asks *"Approve once or
deny?"*, and the agent finishes only after you answer. `pnpm smoke:mcp` runs a
quick client against it.

## Your own agents

Copy `runtimes.example.json` → `runtimes.json` (or set `AMBIENT_RUNTIMES_FILE`)
and wire your own endpoints through the `AssistantClient` interface — see
[`docs/adapters.md`](docs/adapters.md) and [`docs/runtimes.md`](docs/runtimes.md).

## Architecture

[![Ambient architecture](docs/media/architecture.png)](docs/media/ambient-architecture.html)

*[Interactive version](docs/media/ambient-architecture.html) — every box is a
real module in this repo.*

## Honesty guarantees

| Run state | What Alexa says (`speak()` in `src/voice.ts`) |
|---|---|
| `queued` / `accepted` / `running` | "*Agent* is working on *task* — *latest step*. Say 'what's the status' any time." |
| `waiting_approval` | "*Agent* is asking: *request*. Say approve to allow it once, or deny." |
| `completed` | The agent's own answer, clamped to two sentences — never an id. |
| `failed` | "*Agent* couldn't finish *task*: *reason*." |
| `cancelled` | "*Agent* stopped *task*." |
| `cancel_requested` | "Asking *agent* to stop *task*." |
| `unknown` | "*Agent* lost the connection during *task*, so the outcome is unknown. It won't retry by itself — ask again when it's back." |
| Runtime `offline` | "*Agent* is offline; *task* is marked *status* until it reconnects." |

`unknown` is a first-class status: when a runtime drops mid-run Ambient says
so instead of guessing, and `stop` refuses to touch work whose fate it can't
see. Approval snapshots reconcile after every reconnect so nothing waits
forever.

## Verification

![CI: pnpm scan green](https://img.shields.io/badge/CI-pnpm%20scan%20green-brightgreen) — `.github/workflows/ci.yml` runs typecheck, eslint, knip, and the test suite on push.

```sh
pnpm scan            # typecheck + eslint + knip + 74 tests
pnpm build
pnpm check:runtime <id>   # live reachability verdict per runtime
```

A golden speech corpus (`test/voice.test.ts`) regex-rejects ids in every
spoken string; security middleware (origin/host allowlists, DNS-rebinding,
session eviction, Alexa signature verification) is covered by
`test/security.test.ts`. Honest receipts live in
[`docs/acceptance.md`](docs/acceptance.md).

## Limits, stated plainly

- **The demo adapter is scripted** — deterministic, no network, no
  credentials. Real assistants plug in through `AssistantClient`.
- **AWS deployment** is prepared (`pnpm infra:synth`, `docs/deployment.md`)
  but the TLS deploy itself is pending account-owner approval.
- **The `/sim` host** stands in for the gated Alexa+ toolkit — it is a real
  MCP client over loopback, so everything it does is standards-verifiable.

## Docs

[CONTRIBUTING](CONTRIBUTING.md) · [adapters](docs/adapters.md) ·
[acceptance](docs/acceptance.md) · [friction log](docs/friction-log.md) ·
[product feedback](docs/product-feedback.md) ·
[video script](docs/video-script.md) · [submission](docs/submission.md) ·
[demo runbook](docs/demo-runbook.md)
