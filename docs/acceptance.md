# Acceptance record

This record separates observed behavior from gates that require an Alexa account,
an AWS account, or a live assistant. Update it with dated evidence; keep
credentials and private transcripts out of the repository.

## Observed locally

- Multi-runtime registry: four adapters (Bedrock, Hermes, OpenClaw, Demo) build
  from one `runtimes.json`; `/healthz` reports each runtime's state and
  capabilities; selection is sticky via `agents` (`use`).
- Eight customer-intent MCP tools over authenticated Streamable HTTP
  (`2025-11-25`, SSE responses so in-call elicitation has a channel):
  `delegate`, `status`, `approve`, `stop`, `agents`, `briefing`,
  `delegate_task` (task-augmented), and
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
- `pnpm scan` green: typecheck, eslint, knip, 90 tests.
- The installed Hermes gateway accepts the pinned WebSocket connection, replays
  observed events by sequence, and surfaces replay gaps as `unknown` work.
- Alexa+ simulator (2026-10-12): `/sim` serves a voice panel + device frame; it
  is a real MCP client on the loopback `/mcp` (Streamable HTTP, declares the
  `elicitation` capability). Natural-language turns route through a keyword
  router (Bedrock `toolConfig` when `BEDROCK_ROUTER_*` is configured) onto the
  semantic tools — never by id.
- Simulated approval, observed live: `delegate` ran "Book a table at Lupa",
  the run went `waiting_approval`, `server.server.elicitInput` held an in-call
  elicitation open on the tool call's SSE stream, the browser card resolved it
  (`POST /sim/api/elicit`), `respondToApproval` resumed the run, and the turn
  POST answered "Done — Lupa is booked…". The 60s timeout auto-declines stale
  elicitations; a page (re)load replays still-pending cards.
- Sim live feed: `GET /sim/api/events` streams `run` events (title/status/
  assistant plus the task-view payload — the UI updates without a tool call),
  `attention` counts, and `elicit` cards; the orb rings amber while anything
  needs you. Screenshots in `docs/media/sim-*.png` (Echo Show 8/15, Mobile,
  Fire TV, Voice only) were captured by scripted Playwright driving the real
  page, including the mid-run `waiting_approval` state.
- MCP App views do the `ui/initialize` handshake and read
  `hostContext.deviceClass` (`ui/notifications/host-context-changed` re-fits
  them when the sim device switches — verified: Fire TV renders the large
  variant). The old 2.5 s dashboard polling is gone; refreshes are pushed.
- Known edge: a `status` call on a `waiting_approval` run also elicits (by
  design — voice clients get asked in-band); two in-flight calls can hold one
  elicitation each for the same approval. The first browser answer wins the
  real approval; the other call just reports current state.
- MCP Tasks (2026-10-12, SDK `experimental.tasks`): `delegate_task` is
  registered `taskSupport: "optional"` against an `InMemoryTaskStore` (1 h ttl,
  250 ms poll hint) and drives the same engine run. Round-trip proven by
  `test/tasks.test.ts` over a real SDK client (`InMemoryTransport`):
  `callToolStream` yielded `taskCreated` → `working` → `input_required`
  (voice-safe `statusMessage`, no ids) → the `approve` tool resolved it →
  `completed` → `getTaskResult` returned the run's `CallToolResult`. Failed
  runs map to `failed`; `tasks/cancel` marks the handle `cancelled`.
  `delegate` stays a normal tool: the SDK's auto-poll for plain `optional`
  calls is unbounded, so a blocking `delegate` would break Alexa's bounded
  ask — task-capable clients opt in via `delegate_task` instead.
- Security hardening (2026-10-12): Host and Origin allowlists enforced on
  every route (default: `PUBLIC_BASE_URL` + loopback, extend via
  `AMBIENT_ALLOWED_*`; live check: `Origin: https://evil.example` on `/mcp`
  → 403 `forbidden_origin`, CORS `*` removed). Idle MCP sessions evict after
  30 min on a 60 s sweep (`evictIdleSessions`). `/healthz` is `{ok:true}`
  publicly; runtime detail needs the bearer token when one is configured.
  `/alexa` verifies `SignatureCertChainUrl` (URL-pinned to Amazon's echo.api
  bucket, SAN `echo-api.amazon.com`, in-date, chained), RSA-SHA256 over the
  raw body, and a ±150 s timestamp when `ALEXA_VERIFY_SIGNATURE=true` —
  tested with a generated throwaway chain: valid accepts, tampered body,
  stale timestamp, and foreign cert URL all 400. Interaction model now has
  carrier phrases on every SearchQuery sample, `about` slots instead of id
  slots, and a matching `en-US` locale alongside `en-GB`.
- AssistantClient type tightening (2026-10-12): `AssistantEvent` is a
  discriminated union (7 typed variants); `AssistantWireEvent` is the loose
  transport shape canonicalized inside `src/hermes.ts` — the only file that
  still names `session_key`/`request_id`/`started_at`. `submitPrompt` returns
  `{state:"accepted"|"streaming"}`; `steer`/`interrupt`/`respondToApproval`/
  `listPendingApprovals` return typed results. `ActiveSession.session_key` →
  `durableId`; session rows are camelCase at the adapter boundary.
  `pnpm scan && pnpm build` green — 87 tests / 18 files.
- Submission assets (2026-10-12): architecture diagram authored from repo
  structure (`docs/media/ambient-architecture.json` → validated 9/9 showcase
  checks → `ambient-architecture.html` + `architecture.png`); approval-moment
  GIF captured live by Playwright video + ffmpeg
  (`docs/media/sim-approval.gif`, delegate → elicit card → approve → "Done"
  at 9 fps / 920 px); `docs/friction-log.md` holds 8 reproduced entries;
  `docs/product-feedback.md`, `docs/video-script.md`, `docs/submission.md`,
  `CONTRIBUTING.md`, `docs/adapters.md`, and the rewritten README are in
  place.
- MCP Tasks (2026-10-12): `delegate_task` registered `taskSupport: "optional"`
  with `InMemoryTaskStore` (1 h ttl, 250 ms poll); `test/tasks.test.ts` proves
  the SDK-client round-trip (`taskCreated` → `working` → `input_required` →
  approve → `completed` → `getTaskResult`) plus failed/cancelled mappings,
  and `scripts/smoke-tasks.ts` verified it live over Streamable HTTP.
- CDK synth (2026-10-12): `pnpm infra:synth` emits a complete template —
  EC2 + Elastic IP, dedicated VPC/subnets/routes/security group, IAM role,
  and two Secrets Manager secrets (connector + OAuth). Synth only; `cdk
  deploy` awaits account-owner approval (paid resources).
- Demo video (2026-10-12): `docs/media/ambient-demo.mp4` — 109.7 s, built by
  `scripts/video/build.py`: Playwright recordings of the real `/sim` (status,
  approval click-through, device switching, deploy→`unknown`, briefing),
  `say` narration per beat, HTML cards (title, live MCP transcript captured
  from the running server, verified stats). Reviewed frame-by-frame. Public
  upload remains a user action.

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

- Connect the real Alexa+ MCP client (the rules-permitted simulated experience
  at `/sim` is built and recorded above) and record the negotiated protocol
  and account stage.
- Link the Echo custom skill (request signature verification is implemented
  behind `ALEXA_VERIFY_SIGNATURE`; validate it against real Amazon traffic on
  the deployed path before public use). The updated interaction model
  (en-GB + en-US, carrier phrases, no id slots) still needs importing and
  building in the ASK console.
- Speak a question + follow-up through Alexa; record spoken-result latency.
- Run a real end-to-end task with steer, approval, and cancellation on a live
  assistant; record `check:runtime` receipts for each configured runtime.
- Deploy the bridge with HTTPS on AWS; capture the authenticated path.
- Test connector loss and bridge restart without replaying an uncertain
  mutation, including a pending approval that survives reconnect.
