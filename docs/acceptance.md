# Acceptance record

This record separates observed behavior from gates that require an Alexa account,
an AWS account, or a live assistant. Update it with dated evidence; keep
credentials and private transcripts out of the repository.

## Observed locally

- Multi-runtime registry: four adapters (Bedrock, Hermes, OpenClaw, Demo) build
  from one `runtimes.json`; `/healthz` reports each runtime's state and
  capabilities; selection is sticky via `agents` (`use`).
- Seven customer-intent MCP tools over authenticated Streamable HTTP
  (`2025-11-25`, SSE responses so in-call elicitation has a channel):
  `delegate`, `status`, `approve`, `stop`, `agents`, `briefing`, and
  `dashboard`, which serves `ui://ambient/dashboard` (`text/html;profile=mcp-app`)
  plus a full structured snapshot. Task results carry
  `_meta.ui.resourceUri` = `ui://ambient/task`.
- `pnpm check:runtime` ran live against local HTTP endpoints for `townie` and
  `muse` (adapters removed 2026-10-11; historical receipts are in git history).
- Contract tests pin each adapter's wire shape: OpenClaw `connect`/`hello-ok`
  handshake + `agent`/`agent.wait` + `exec.approval.requested` → approval event;
  Bedrock Converse tool loop with approval-gated tools, abort-cancel, and
  transcript resume; Demo scripts through the engine.
- Engine honesty: offline runtimes mark active work `unknown`; approval ids are
  runtime-namespaced; unsupported controls (steer/cancel/approvals on adapters
  without them) fail with explicit errors.
- Voice contract (2026-10-11): `delegate` → bounded wait → `waiting_approval`
  result speaks the ask and ends with "Say approve to allow it once, or deny";
  `approve` resolved it and waited to the completed answer. `stop` reports
  "Nothing is running" once a run is `unknown`. Verified live over
  `pnpm demo` with a raw SDK client — no id strings appear in any `speech`
  field (golden tests pin this).
- `pnpm scan` green: typecheck, eslint, knip, 71 tests.
- The installed Hermes gateway accepts the pinned WebSocket connection, replays
  observed events by sequence, and surfaces replay gaps as `unknown` work.

## Per-adapter live status

| Adapter | Contract-tested | Live-verified | Gate |
|---|---|---|---|
| demo | yes (engine-driven) | n/a — deterministic, no service | — |
| bedrock | yes (mocked Converse) | **blocked** — no AWS credentials on this machine (no `aws` CLI, no `~/.aws`, no `AWS_*` env; checked 2026-10-11) | AWS credentials + Bedrock model access |
| hermes | yes | yes (2026-09-06) | — |
| openclaw | yes (fake socket) | no | self-hosted gateway + operator token |

Removed 2026-10-11 (unverified, trademark risk): `grokbot`, `muse`, `townie`,
`instinct`. Their code and historical receipts remain in git history
(last present in 51775a0).

## Still required for the hackathon submission

- Connect the real Alexa+ MCP client (or the rules-permitted simulated Alexa+)
  and record the negotiated protocol and account stage.
- Link the Echo custom skill; verify Amazon request signature before public use.
- Speak a question + follow-up through Alexa; record spoken-result latency.
- Run a real end-to-end task with steer, approval, and cancellation on a live
  assistant; record `check:runtime` receipts for each configured runtime.
- Deploy the bridge with HTTPS on AWS; capture the authenticated path.
- Test connector loss and bridge restart without replaying an uncertain
  mutation, including a pending approval that survives reconnect.
