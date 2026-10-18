# progress.md: Ambient v2 (household consent layer)

Plan: `docs/plans/2026-10-18-handle-the-call/overview.md` (supersedes the consent design). Deadline Fri 2026-10-23 12:00 PT; submit Thu 2026-10-22.
Integration branch: `hackathon/household-consent`. Each lane works on its own branch in a worktree; the orchestrator merges.

## Review evidence (2026-10-18)

Judge personas scored v1 10.5 / 12 / 13 of 20. Confirmed defects: `/sim` mounted before `authorize()` (`src/server.ts:289` vs `:409`); `elicitInput` without `relatedRequestId` (`src/mcp.ts:75`); task cancel does not cancel the run; flagship utterance misroutes to `agents` (`src/sim-router.ts:56`); friction-log entries dated 10-16/10-19 but committed 10-12; CDK env block likely fails `readConfig`. Competitor KiroWhisper does the v1 pitch on a real Echo.

## Lanes

See the phase table in the plan overview. None are running. Keep: `lane/L0-p0` (6228b0f: /sim auth, elicitation on the call's stream, task cancel). The consent-layer branches (`lane/L1-attention`, `lane/L3-household-agent`, `t3/*`) are obsolete.

## Needs the user

See `phase-00-preflight.md` in the plan.

## Log

- 2026-10-18: review done, design written, lanes defined.
- 2026-10-18: launched L0, L1, L3, L4 as worktree subagents (claude-sonnet-5-5).
- 2026-10-18: user stopped all lanes. Direction under review: consent layer judged to lack a demo moment. Plan only until the user confirms a direction.
- 2026-10-18: direction changed to "Alexa, handle the call" (Twilio ConversationRelay + Anthropic API). Plan written; nothing launched.
- 2026-10-18: deep plan written (overview, 12 phases, testing, Twilio and Alexa references, codebase map). Nothing launched.
