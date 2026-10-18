# progress.md: Ambient v2, "Alexa, handle the call"

Plan: `docs/plans/2026-10-18-handle-the-call/overview.md`. Deadline Fri 2026-10-23 12:00 PT; submit Thu 2026-10-22.
Branch: `hackathon/household-consent`. Nothing is pushed.

## Decisions taken this session (2026-10-18)

- **Phone path: AssemblyAI, no Twilio.** The user has no Twilio budget. AssemblyAI cannot dial out (its SIP path is inbound only), so phase 6 builds the AssemblyAI Voice Agent line where the business joins through a browser link (a phone's browser works). The `Line` seam keeps a Twilio Media Streams bridge possible later. The real-phone-rings moment is not available without paid Twilio.
- Subagents: Devin `swe-2-high` drafts (the catalog has no "SWE 2 Max"); Opus 5.5 (lead) or `claude-sonnet-5-5` reviews and cleans.
- `step(state, input, now)` takes the clock as an argument instead of `state.now`; `startCall(brief, callId)` takes a call id so approval request ids are unique per runtime.

## Baseline (2026-10-18, before any change)

`corepack enable; pnpm install; pnpm scan`: typecheck, eslint, knip green; 94 tests in 20 files pass.

## Phases

| # | Phase | State | Evidence |
|---|---|---|---|
| 1 | Subtract v1 adapters | Landed `38aa26d` (Devin draft, reviewed) | scan green; `pnpm demo` + `pnpm smoke:mcp` list 7 tools; grep for hermes/openclaw/nova/dashboard in src, test, scripts is empty |
| 1b | Windows demo fix | Landed `1ffda6a` | `pnpm demo` failed twice on Windows (cmd.exe env syntax; entry guard); both fixed and logged in the friction log |
| 2 | Engine support for calls | Landed (Devin draft `d9921fe`, reviewed, cherry-picked) | approval amount and kind, run outcome, newest open approval, steer resolves approvals; 8 tests |
| 3 | Call session reducer | Landed `1c14609`, revised `3ab7db3` after two Sonnet 5.5 reviews | 89 tests. Reviews reproduced 11 honesty holes (negated owner amounts authorized spend, stale brain output, cut-off disclosure, unbounded owner wait, redaction bypasses); each is now a regression test. Round-2 review running |
| 4 | Brain | Landed `99379e2` | 20 tests with a stubbed stream. `pnpm brain:latency` not run: it spends API money |
| 5 | Caller runtime + simulated line | Landed | 6 engine tests + 8 shell tests. `pnpm demo` + `pnpm smoke:mcp` runs a full simulated call through /mcp (transcript below) |
| 6 | AssemblyAI line | After 9 | |
| 7 | Alexa intents and cue | Landed | 10 tests (7 alexa + 3 cue). `pnpm scan` and `pnpm build` green. Echo Dot run pending: needs Voice Monkey token and the phase-0 invocation check. Fixed a pre-existing eslint failure in `scripts/smoke-mcp.ts` (`no-base-to-string` on `unknown`) so scan could run green. |
| 8 | Discovery and memory | | |
| 9 | Sim around a live call | | |
| 10 | AWS | Needs AWS spend approval | |

## Evidence: zero-key call through /mcp (2026-10-18)

```
> delegate {"task":"Call Joe's Plumbing and book a visit to fix the kitchen sink, keep it under 150"}
  Alexa: Ambient needs your OK: Joe's Plumbing can come Tuesday at ten for one hundred eighty dollars, over your one hundred fifty dollars limit. Should I book it. That's one hundred eighty dollars. Say approve to allow it once, or deny.
> delegate {"task":"offer 160"}
  Alexa: Noted — passed that to Ambient while it works on "Call Joe's Plumbing and book".
> status
  Alexa: Joe's Plumbing confirmed Tuesday at ten for one hundred sixty dollars.
smoke: ok
```

Known voice defects to fix in the voice-UX pass: the approval repeats the amount and loses its question mark; the steer reply quotes a truncated title.

## Needs the user

- Keys, tested at the end: `ANTHROPIC_API_KEY` (brain, latency receipt), `ASSEMBLYAI_API_KEY` (phase 6), Voice Monkey token (phase 7 cue).
- Approval to spend: `pnpm brain:latency` (about 10 short Claude calls), AssemblyAI minutes for a real call test, AWS deploy (phase 10).
- Phase 0: whether the custom skill invokes on your Echo Dot under Alexa+.
- Phase 11: creating the public GitHub repo and submitting on Devpost.
- Open question from the plan: if p95 time to first word on `claude-opus-5-5` exceeds 1.5 s, may in-call turns use `claude-haiku-5-5`?

## Log

- 2026-10-18: plan written; L0 fixes merged (`8143d5e`).
- 2026-10-18: implementation started. Phases 3, 4, 1 landed; Windows demo path fixed.
- 2026-10-18: phase 7 landed — call intents replace the v1 model (both locales), `src/cue.ts` (Voice Monkey announce + Proactive Events MessageAlert behind `combinedCue`), `watchApprovals` in server.ts cues once per new approval id. Needs the Echo Dot run.
