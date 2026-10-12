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
- **Verification**: `pnpm scan && pnpm build` green — 80 tests / 17 files.
  Live over `pnpm demo`: delegate→waiting_approval speech, approve→completed,
  status/briefing/agents/stop all speak cleanly; unknown deploy says "won't
  retry". Recorded in `docs/acceptance.md`.

## Remaining

- Phase 2.5 (cuttable): MCP Tasks augmentation.
- Phase 5: origin/DNS protection, session eviction, minimal /healthz, Alexa
  signature verification, interaction model en-US + en-GB.
- Phase 6: AWS TLS deploy — **ASK USER before cdk deploy / anything paid**.
- Phase 7: adapters.md, CONTRIBUTING, AssistantClient type tightening.
- Phase 8: README rewrite, compliance box, architecture SVG, GIF, friction log
  (5+ real entries), product feedback per tool, video, Devpost text.
- Phase 9: clean-clone QA + time-to-first-spoken-answer <2min.

## Blockers

- **AWS credentials**: none on this machine → Bedrock live receipt blocked;
  sim's Bedrock tool-choice will run keyword router unless creds appear.
- **User actions**: public repo/push, `cdk deploy`, ASK console model build,
  Devpost submission, video recording — all need explicit user approval.

## Evidence

- `pnpm scan` = typecheck + eslint + knip + vitest → green (80 tests).
- `pnpm build` green. `pnpm demo` + raw SDK client transcript in
  `docs/acceptance.md`.
