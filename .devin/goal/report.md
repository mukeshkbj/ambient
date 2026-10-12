# Goal report — hackathon build (ambient)

Objective: ship the Alexa+ hackathon submission per
`docs/plans/2026-10-11-hackathon-contender.md`. Deadline 2026-10-23; submit Oct 22.

## Done (verified on this machine)

- **Phase 0** — package `ambient`, engines >=22.13, cdk deps → dev, `.ambient`
  data dir, CI workflow, engineering docs moved. Commit `20044dd`.
- **Phase 1.1** — zero-credential demo agent (`src/runtimes/demo.ts`),
  `runtimes.demo.json`, `pnpm demo`, demo tests; `respondToApproval` no longer
  overwrites a finished run. Commit `20044dd`.
- **Phase 1.2** — Bedrock adapter (`src/runtimes/bedrock.ts` +
  `bedrock-tools.ts`): Converse tool loop, approval-gated tools, cancel,
  transcript persistence (`transcripts` table), registry + `runtimes.bedrock.json`
  + `pnpm dev:bedrock`. Mocked tests only — no AWS creds on this machine (no CLI,
  no ~/.aws, no env; live receipt blocked in `docs/acceptance.md`). Commit `2ca5142`.
- **Phase 1.3** — deleted grokbot/muse/townie/instinct (unverified + trademark
  risk); scrubbed README/example/env/alexa-model/docs; tests rewired to fakes.
  Commit `b7d2a25`.
- **Phase 2.1–2.4 + briefing** — commit `5087aad`:
  - Engine: EventEmitter `changed`, event-driven `waitForRun`, `ask(waitMs)`;
    `AMBIENT_ASK_WAIT_MS=6000`; `activeRunForNextAsk` for delegate-steering.
  - Store: `runs.title` + `runs.steps_json` (migrated); `recentRunViews`/
    `recentRuns`/`openApprovals` kill the per-runtime N+1.
  - `src/voice.ts`: `titleFor`, `speak(view, ctx)`, `runResult`, `say`,
    `approvalAsk`. Two sentences max, outcome first, open states end with the
    next phrase, never an id — pinned by `test/voice.test.ts` (UUID regex +
    literal-id checks across all nine statuses).
  - MCP tools: `delegate` (steers into active work), `status` (needs-you first),
    `approve`, `stop`, `agents(use)`, `briefing(since)`, `dashboard`.
    Descriptions follow the Alexa tools guide (when + what).
  - Approvals: `server.server.elicitInput` (form mode, decision enum
    approve_once/deny) when the client advertises `elicitation`; accept resolves
    and waits to the next speakable state; decline/cancel stays pending; no
    capability → `approve` tool fallback. `enableJsonResponse:false` so
    in-call requests ride the POST's SSE stream.
  - `ui://ambient/task` resource added; results carry `_meta.ui.resourceUri`
    (deprecated flat key gone). Alexa handler speaks via `speak()`; `viewText`
    deleted. `findWork` = exact id → fuzzy title match.
- **Phase 3.1–3.4 (simulator)** — `src/sim.ts` is a real MCP client on the
  loopback `/mcp` (declares `elicitation`); `src/sim-router.ts` maps utterances
  to the semantic tools via keyword router (Bedrock `toolConfig` when
  `BEDROCK_ROUTER_*` set). `/sim` serves `web/sim/index.html`: orb + transcript,
  device switcher (Voice only/Mobile/ES8/ES15/Fire TV), Web Speech in/out,
  SSE feed (`/sim/api/events`: run ticks carrying the task-view payload,
  attention count, elicit cards — replayed to late listeners). Browser approval
  resolves the in-call MCP elicitation (`/sim/api/elicit`) — the delegate call
  stays open until the click; verified live: approve → "Done — Lupa is
  booked…". Views do `ui/initialize`, read `hostContext.deviceClass`, re-fit on
  `host-context-changed`; polling deleted. 7 screenshots in `docs/media/` from
  scripted Playwright (`scripts/shots-sim.py`). Fixed: `status` no longer used
  for view refresh (it elicits by design — refresh now rides run events);
  `payload.kind` no longer lands as a run step.
- **Phase 5 (security hardening)** — Host/Origin allowlists on every route
  (SDK deprecated its transport options → enforced as middleware; live
  `Origin: evil.example` → 403, `*` CORS gone). `evictIdleSessions` closes
  sessions idle >30 min on a 60 s unref sweep; `lastSeenAt` touched per
  request. `/healthz` = `{ok:true}` public, detail behind bearer.
  `src/alexa-verify.ts`: cert URL pinned to s3.amazonaws.com/echo.api, SAN
  echo-api.amazon.com, validity + chain verify, RSA-SHA256 over raw body,
  ±150 s timestamp — `ALEXA_VERIFY_SIGNATURE=true` gates it on `/alexa`
  (7 new tests incl. a generated throwaway chain; valid/tampered/stale/
  bad-URL/route all covered). Interaction model: carrier phrases on every
  SearchQuery sample, `about` slots replace id slots, en-US added.
- **Phase 7 (type tightening + docs)** — `AssistantEvent` is now a
  discriminated union (7 variants with typed payloads) in
  `src/runtimes/types.ts`; `AssistantWireEvent` is the loose transport shape
  hermes canonicalizes inside `src/hermes.ts` — the only file that still knows
  `session_key`/`request_id`/`started_at`. `submitPrompt` returns
  `{ state: "accepted" | "streaming" }`; `steer`/`interrupt`/`respondToApproval`/
  `listPendingApprovals` all return typed results (`SteerResult`,
  `InterruptResult`, `ApprovalResponse`, `ApprovalPayload[]`).
  `ActiveSession.session_key` → `durableId`; `SavedSession`/`ActiveSession`
  went camelCase (`startedAt`, `messageCount`). `docs/adapters.md` = "write an
  adapter" guide on the demo template; `CONTRIBUTING.md` covers setup,
  `pnpm scan`, adapter + voice/honesty rules. `pnpm scan && pnpm build`
  green — 87 tests.
- **Phase 8 (submission assets)** — commit `9fc671a`: README rewrite (pitch,
  compliance box, GIF, architecture, honesty table), archify-generated
  interactive diagram + PNG (showcase-validated 9/9), approval-moment GIF
  (Playwright video → ffmpeg, 3.8 MB), `docs/friction-log.md` (8 real
  entries), `docs/product-feedback.md` (per-tool sections), `docs/submission.md`
  (Devpost prose), `docs/video-script.md` (2:45 timed script).
- **Phase 9 (clean-clone QA)** — `/private/tmp/ambient-clean`: `pnpm i &&
  pnpm demo` ran from README alone; first spoken answer ~11 s (elicitation
  card at 4.9 s, completion at 6.1 s — far under the 2 min target);
  `pnpm scan && pnpm build` green in the clone.
- **Phase 2.5 (MCP Tasks)** — commit `9ced97a`: `delegate_task` registered
  via `server.experimental.tasks.registerToolTask` (`taskSupport:
  "optional"`, `InMemoryTaskStore`, 1 h ttl, 250 ms poll). `waiting_approval`
  maps to `input_required` with a voice-safe `statusMessage`; `unknown` maps
  to `failed` with an honest message. `delegate` deliberately stays a normal
  tool — the SDK's auto-poll on plain `optional` calls is unbounded and
  would break Alexa's bounded ask. Round-trip proven: `test/tasks.test.ts`
  (real SDK client, `taskCreated` → `working` → `input_required` → approve →
  `completed` → `getTaskResult`, plus failed + cancelled) and
  `scripts/smoke-tasks.ts` over real Streamable HTTP. 90 tests.
- **CDK synth receipt** — `pnpm infra:synth` emits a 25-resource template
  (EC2 + EIP, dedicated VPC, IAM, 2 Secrets Manager secrets). Synth only;
  deploy awaits user approval.
- **Demo video built** — `docs/media/ambient-demo.mp4` (1:50, h264+aac,
  2.4 MB): `scripts/video/build.py` captures real Playwright runs of `/sim`
  (cold-open status, Lupa approval click-through, device switching, deploy→
  `unknown`, briefing) + `say` narration per beat + real /mcp transcript
  card (protocolVersion, tool list, ui:// URIs — captured live). Frame-
  checked all beats. Upload remains a user action. Friction log gained a
  9th entry (PORT without PUBLIC_BASE_URL → forbidden_origin — hit it while
  recording).

## Remaining

- Phase 6: AWS TLS deploy — **ASK USER before cdk deploy / anything paid**.
- Definition-of-done items needing the user (below).

## Blockers

- **AWS credentials**: none on this machine → Bedrock live receipt blocked
  (DoD line "Bedrock agent completes a real multi-tool task" unverifiable);
  sim's Bedrock tool-choice will run keyword router unless creds appear.
- **User actions**: public repo/push, `cdk deploy`, ASK console model build
  (en-US + en-GB model files ready in `alexa/`), Devpost submission, video
  recording (`docs/video-script.md` ready) — all need explicit user approval.
- DoD status: 8/10 lines fully verifiable on this machine; the exceptions are
  Bedrock-live (blocked: credentials) and video+Devpost (user actions).

## Evidence

- `pnpm scan` = typecheck + eslint + knip + vitest → green (90 tests,
  19 files).
- `pnpm build` green. `pnpm demo` + raw SDK client transcript +
  `scripts/smoke-tasks.ts` HTTP round-trip in `docs/acceptance.md`.

## waiting claim (2026-10-12 07:38)
All agent-doable work complete and committed (20044dd…96ca4d7, 90 tests green). Awaiting user actions: (1) approve AWS/cdk deploy for Phase 6 TLS receipt, (2) provide AWS credentials or approve skipping the Bedrock live receipt, (3) approve public repo creation/push, (4) import + build the interaction model in the ASK console (alexa/interaction-model.*.json ready), (5) record the video (docs/video-script.md ready) and upload publicly, (6) submit Devpost text (docs/submission.md ready) by Oct 22.
