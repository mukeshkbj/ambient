# Acceptance record

This record separates observed behavior from gates that require an Alexa account,
an AWS account, or a live assistant. Update it with dated evidence; keep
credentials and private transcripts out of the repository.

## Observed locally

- Multi-runtime registry: six adapters (Hermes, OpenClaw, Grok Bot, Muse, Townie,
  Instinct) build from one `runtimes.json`; `/healthz` reports each runtime's
  state and capabilities; selection is sticky via `select_assistant`.
- Eleven neutral MCP tools over authenticated Streamable HTTP (`2025-11-25`),
  including `dashboard`, which serves a `ui://ambient/dashboard` MCP App
  (`text/html;profile=mcp-app`) plus a full structured snapshot.
- `pnpm check:runtime` ran live against local HTTP endpoints for `townie` and
  `muse`: handshake → trivial prompt → `completed` verdict JSON with real answers.
- Contract tests pin each adapter's wire shape: OpenClaw `connect`/`hello-ok`
  handshake + `agent`/`agent.wait` + `exec.approval.requested` → approval event;
  Grok Bot `sendPrompt`/`getAgentTranscriptTail` polling; Instinct Gmail
  send/poll correlation; Muse chat-completions; Townie `POST /v1/run`.
- Engine honesty: offline runtimes mark active work `unknown`; approval ids are
  runtime-namespaced; unsupported controls (steer/cancel/approvals on adapters
  without them) fail with explicit errors.
- `pnpm scan` green: typecheck, eslint, knip, 54 tests.
- The installed Hermes gateway accepts the pinned WebSocket connection, replays
  observed events by sequence, and surfaces replay gaps as `unknown` work.

## Per-adapter live status

| Adapter | Contract-tested | Live-verified | Gate |
|---|---|---|---|
| demo | yes (engine-driven) | n/a — deterministic, no service | — |
| bedrock | yes (mocked Converse) | **blocked** — no AWS credentials on this machine (no `aws` CLI, no `~/.aws`, no `AWS_*` env; checked 2026-10-11) | AWS credentials + Bedrock model access |
| hermes | yes | yes (2026-09-06) | — |
| openclaw | yes (fake socket) | no | self-hosted gateway + operator token |
| grokbot | yes (fake fetch) | no | host `sand` gateway reachable + token |
| muse | yes (fake fetch) | no | Meta Model API key |
| townie | yes (fake fetch) | yes (mock endpoint, `check:runtime`) | Val Town token + deployed val |
| instinct | yes (fake fetch) | no | Gmail OAuth token + Instinct address |

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
