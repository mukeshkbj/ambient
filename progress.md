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
| 3 | Call session reducer | Landed `1c14609`; revised `3ab7db3` and `fab717c` after three Sonnet 5.5 reviews | 125 tests. Round 1 (two reviewers) reproduced 11 honesty holes; round 2 found 8 more (thousands parsed as 1, the agent's own offer counted as the business's confirmation, negations missing from offer parsing, digit leaks while streaming). Every one is a regression test now |
| 4 | Brain | Landed `99379e2` | 20 tests with a stubbed stream. `pnpm brain:latency` not run: it spends API money |
| 5 | Caller runtime + simulated line | Landed | 6 engine tests + 8 shell tests. `pnpm demo` + `pnpm smoke:mcp` runs a full simulated call through /mcp (transcript below) |
| 6 | AssemblyAI line | Landed `41fb071` (not yet run against the live API) | 15 tests: per-call stored agent (greeting = disclosure, LLM = our endpoint), token minting, chat-completions shim streams exactly what the reducer says, queued speech via `reply.create`, interruption, hang-up, no-answer timeout, a whole scripted call through the room, and HTTP routes with the per-call secret. Business answer page `web/call/index.html` (screenshot `docs/media/call-business-ringing.png`) |
| 7 | Alexa intents and cue | Landed (Devin draft, reviewed, cherry-picked) | 10 tests (7 alexa + 3 cue). `pnpm scan` and `pnpm build` green. Echo Dot run pending: needs Voice Monkey token and the phase-0 invocation check. Fixed a pre-existing eslint failure in `scripts/smoke-mcp.ts` (`no-base-to-string` on `unknown`) so scan could run green. |
| 8 | Discovery and memory | Landed (Devin draft, reviewed, cherry-picked) | 7 tests: discovery via web search + a strict `report_candidates` tool (not `output_config.format`, which conflicts with web-search citations), dial approval per candidate, user-given number skips the dial approval, memory feeds the next brief, the fourth call to a number in a day is refused. Real discovery needs `ANTHROPIC_API_KEY` |
| 9 | Sim around a live call | Landed `2126fbc`; redesigned through `bd5e1c8` | 12 screenshots in `docs/media/` (light, dark, mobile, business page), each inspected by eye after every change. Critic rounds 1-5 vs Apple: Apple 3-1 each time (we win trust). Round 6 running |
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

## Gauntlet pieces (bar: Google Duplex, past Alexa winners, Apple quality)

| Piece | Critic | State |
|---|---|---|
| Call reducer honesty | 3 Sonnet 5.5 adversarial reviews, then structural rounds 1-3 | Every hole found is a regression test. Round 3 (`81577c2`) moved pricing to money-shaped amounts only (`pricesIn`), bound agreement to the turn that named the price, and excluded rates |
| Simulator UI | Blind critic vs Apple iOS 26 call screens | Rounds 1-5: Apple 3-1 (we win trust). Round 5 fixes landed in `bd5e1c8`; round 6 running |
| Voice copy | Smoke transcript | Approval asks once with "?", steer says "Okay, I'll tell Joe's Plumbing.", status names the business |
| Repo as an AI reviewer reads it | Structural review (Sonnet 5.5) | Round 1: 3/5, fixed in `ee6ec6d`. Round 2: 3.5/5, fixed in `b00f750`, `5d9c4a8`, `de30e8d` (page key, constant-time secret, 413, retire vendor agent). Round 3: 3.5/5 (my round-2 price fix broke negotiation), fixed in `81577c2`. Round 4 running |
| Friction log | Blind critic (Sonnet 5.5) | Round 4 (`2fe58d4`): "earns the full bonus as written". Round 1: "does not earn the bonus" (unverified entries, no time lost, missing stages). Rewritten: 8 vendor entries, each reproduced on 2026-10-18 with a capture or a fetched quote, with severity and time lost; 3 own bugs split out; journey coverage table. Round 2 pending |

## Needs the user

- Twilio would restore the "a real phone rings" moment; without it the business answers on a web link.
- Keys, tested at the end: `ANTHROPIC_API_KEY` (brain, latency receipt), `ASSEMBLYAI_API_KEY` (phase 6), Voice Monkey token (phase 7 cue).
- Approval to spend: `pnpm brain:latency` (about 10 short Claude calls), AssemblyAI minutes for a real call test, AWS deploy (phase 10).
- Phase 0: whether the custom skill invokes on your Echo Dot under Alexa+.
- Phase 11: creating the public GitHub repo and submitting on Devpost.
- Open question from the plan: if p95 time to first word on `claude-opus-5-5` exceeds 1.5 s, may in-call turns use `claude-haiku-5-5`?

## Log

- 2026-10-19 (fifth round): structural round 11 scored 4/5 and reproduced four holes (disclosure skipped after a cut plus an owner message, bare numbers and malformed amounts read as offers, "yes the price is set" confirming a no-price read-back, unmarked questions); all closed test-first in `72a69fb`, and the property test now sends owner offers (a planted bare-number mutation fails it on seed 304). Approvals bind to their time (`6f38a25`). Voice round 4: the business side won, the owner side lost because Alexa asked for words the model could not hear; fixed in `44a5a57`, with a test that reads both locale models. UI round 13: comprehension tie, trust and delight ours, craft Apple; the Sonnet builder's fixes (date-not-confirmed flag, contrast, microtype, idle examples) merged as `bfd180b`, and screenshots were retaken and inspected. Judges round 3 (Tech 6, Design 6.5, Impact 4.5, Idea 8) docs fixes in `0203191`: sourced missed-call and hearing-loss figures, measured onboarding (20 s install warm, 122 s cold, `/sim` up 2.5 s after start), dated gating claim. 618 tests, smoke ok. Surprise: `TaskStop` on `pnpm demo` leaves the node child listening, and `.ambient/ambient.sqlite` keeps the last call, so `scripts/shots-sim.py` needs `AMBIENT_DATA_DIR` set to an empty directory.
- 2026-10-19 (fourth round): structural round 10 (3/5) found that `offerIn` read refusals as offers; the owner text parser is now an allowlist (`6e6e1c4`). UI round 12 fixes in `ed834c5` (three choices on one row). Submission judges round 2 (Idea 7-8, Tech 5-6, Design 5-6, Impact 4-5) found that the evidence disagreed: the smoke run and the video script now show the same two-round counter, and the counts are current (`7c9ad5e`). 595 tests. Running: structural 11, submission judges 3.
- 2026-10-19 (third round): friction critic round 4 says the friction log earns the full bonus as written (first piece to pass). Structural rounds 8 and 9 (3/5) closed in `5d29b54` and `4ddce46` (confirmation word required, numbers must be the amount or the time, am/pm and echo checks, refusal verbs veto owner offers). UI rounds 10 and 11 (craft still Apple) closed in `158edbb` and `7fd1c89` (offer at the limit, business counters, owner asked again; buttons say what they do; business page states the purpose). Voice round 3 tied; fixed in `0b60939`. 571 tests, smoke ok. Running: structural 10, UI 12, submission judges 2.
- 2026-10-19 (later): submission judges round 1 scored Idea 7-8, Tech 6, Design 5-6, Impact 5 (no live run, no impact case); repo-side fixes in `4744117` (status up top, who it is for, consent and the FCC ruling, 2:25 video plan). Voice round 2 tied the bar on voice UX; fixes in `28aff1f`. Friction round 2 still "no"; dates, times, citations fixed (`c676aff`, `f3f66bc`); product feedback rewritten (`4cd044c`). Structural round 7 (3/5) fixed in `70eabd6` (distinct retry wording, suffix arming, early-yes re-ask, money and time buckets, stale read-back dropped; property test caught the last one on seed 308). UI round 9: comprehension tie, trust and delight ours, craft Apple; fixes in `dc206f2`. 544 tests. Running: structural 8, UI 10, voice 3, friction 3.
- 2026-10-19: structural round 6 (3/5) fixed in `7d384c7` (allowlist yes, read-back armed only after playback, 158-reply corpus). Voice critic round 1 fixed in `10f3e2f` (short over-limit ask, offer echo, first-person decline, demo haggles before asking the owner; smoke transcript shows both sides). UI round 8 fixed in `1bb0ca3`. Friction log rewritten with reproductions and severity (`cbae8ff`). Fetched bar recorded in `reference-bar.md` (`7e46cbc`). Devin's submission draft merged and corrected (`1032fd6`, `ca7d16e`). 532 tests. Next round running: structural 7, UI 9, voice 2, friction 2, submission judges 1.
- 2026-10-18: structural round 5 (3/5) said free-text price parsing will always leak. Redesigned to a Duplex-style read-back (`0f2509d`): the reducer reads the total and time back and books only on a clean yes; the price parser is deleted. Property test rebuilt (4,000 calls, labelled replies, owner approve and deny); two planted mutations fail it. UI round 7 fixes in `1fbbe5a`. 344 tests, smoke ok. Structural round 6 and UI round 8 running.
- 2026-10-18: structural round 4 (2.5/5: agent address line became the price) fixed fail-closed in `8eba7a5`; seeded property test over 3000 generated calls (`63eef21`) catches the old trust-the-model rule on seed 2. UI round 6 fixes in `b153137`. 343 tests, smoke ok. Structural round 5 and UI round 7 running.
- 2026-10-18: structural rounds 2-3 and UI round 5 fixed (`b00f750` through `81577c2`); 326 tests, scan and build green, smoke ok, both demo paths confirm in the screenshot run.
- 2026-10-18: plan written; L0 fixes merged (`8143d5e`).
- 2026-10-18: implementation started. Phases 3, 4, 1 landed; Windows demo path fixed.
- 2026-10-18: UI round-4 fixes: approval `when` on the card, hold timer, booked check, "You offered", mobile card first while the call needs you; 292 tests, scan and build green.
- 2026-10-18: UI rounds 3-4, structural review fixes (`ee6ec6d`), architecture figure; 289 tests, smoke ok.
- 2026-10-18: phase 6 (AssemblyAI line) landed; UI critic rounds 1-2; docs rewrite (`baf3487`).
- 2026-10-18: reducer round-2 review fixes (`fab717c`); phase 9 sim rebuilt (`2126fbc`); phase 8 landed.
- 2026-10-18: phase 7 landed — call intents replace the v1 model (both locales), `src/cue.ts` (Voice Monkey announce + Proactive Events MessageAlert behind `combinedCue`), `watchApprovals` in server.ts cues once per new approval id. Needs the Echo Dot run.
