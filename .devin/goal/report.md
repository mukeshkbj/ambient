# Goal report

## Objective
Hackathon build in ~/honey/hermesambient — Amazon "Build, Ship, Shape", Alexa+ track.
Deadline Fri 2026-10-23 12:00 PT; aim to submit Oct 22.
Spec: docs/plans/2026-10-11-hackathon-contender.md (Phases 0–9 + Definition of Done).

## Progress
- **Phase 0** done + committed (20044dd): rename→ambient, engines>=22.13, cdk deps→dev,
  .ambient data dir, CI workflow, docs declutter, .pytest_cache gitignored.
- **Phase 1.1** done + committed (20044dd): demo adapter + runtimes.demo.json + `pnpm demo`.
- **Phase 1.2** done + committed (2ca5142): Bedrock adapter (Converse tool loop,
  approval-gated tools, transcript persistence in SQLite, honest credential ping),
  runtimes.bedrock.json, `pnpm dev:bedrock`, 7 mocked tests.
  - **BLOCKED RECEIPT**: no AWS credentials on this MacBook (no aws CLI, no ~/.aws,
    no AWS_* env — checked 2026-10-11). `pnpm check:runtime nova` live receipt
    needs user to provide credentials or run elsewhere.
- Engine fix committed: respondToApproval no longer overwrites finished runs.
- Verified: `pnpm scan` green (typecheck+eslint+knip+71 tests), `pnpm build` green.
- Tooling note: pnpm 10.33.0 already installed at ~/.local/bin/pnpm; the "pnpm
  broken" note in the objective was stale — no fix needed.

## In progress / next
- Phase 1.3: quarantine grokbot/muse/townie/instinct to src/runtimes/contrib/,
  scrub README/docs/runtimes.example.json/Alexa AssistantName slot.
- Then Phase 2 (voice-first contract) → Phase 3 (sim) → … → Phase 9 (QA).

## Blocked on user (do not poll)
- AWS credentials for live Bedrock receipt (`aws configure` / AWS_PROFILE), and
  approval before `cdk deploy` (Phase 6), public repo creation, ASK console model
  build, Devpost submission, video recording.
