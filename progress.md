# progress.md: Ambient v2 (household consent layer)

Design: `docs/plans/2026-10-18-household-consent-design.md`. Deadline Fri 2026-10-23 12:00 PT; submit Thu 2026-10-22.
Integration branch: `hackathon/household-consent`. Each lane works on its own branch in a worktree; the orchestrator merges.

## Review evidence (2026-10-18)

Judge personas scored v1 10.5 / 12 / 13 of 20. Confirmed defects: `/sim` mounted before `authorize()` (`src/server.ts:289` vs `:409`); `elicitInput` without `relatedRequestId` (`src/mcp.ts:75`); task cancel does not cancel the run; flagship utterance misroutes to `agents` (`src/sim-router.ts:56`); friction-log entries dated 10-16/10-19 but committed 10-12; CDK env block likely fails `readConfig`. Competitor KiroWhisper does the v1 pitch on a real Echo.

## Lanes

| Lane | Scope | Status |
|---|---|---|
| L0 | P0 fixes and honest docs | todo |
| L1 | `src/attention.ts` pure core + `policies` table | todo |
| L2 | `src/desk.ts` shell, presence seam (sim panel + Ring webhook), recoverable `unknown` | blocked on L1 |
| L3 | Household agent: demo scripts + Bedrock household tools + approval-invariant eval harness | todo |
| L4 | Sim redesign: household floor plan, per-room devices, Fire TV glance, Echo Show card | todo |
| L5 | Proof: real Echo, `cdk deploy`, live Bedrock, OSS PR to alexa-skill-mcp-bridge | needs user |
| L6 | Submission: video re-cut, friction log, product feedback, README, Devpost | after L2–L4 |

## Needs the user

- Do you own an Echo (which model)? A Ring device or Ring developer account?
- AWS credentials (Bedrock Nova access) and approval for `cdk deploy`.
- Approval to create the public GitHub repo and push.

## Log

- 2026-10-18: review done, design written, lanes defined.
