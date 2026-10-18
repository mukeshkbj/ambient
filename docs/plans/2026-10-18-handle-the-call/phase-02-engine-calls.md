# Phase 2: Engine support for calls

[Back to overview](overview.md)

## Goal

Teach the engine the three facts a phone call needs: an approval has an amount and a question, a run can end with a structured outcome, and a run can hold more than one approval over its life without losing one.

## Changes

1. `src/runtimes/types.ts`: `ApprovalPayload` gains `amountUsd?: number` and `kind?: ApprovalKind`, where `ApprovalKind = "spend" | "dial" | "other"`. `message.complete` payload gains `outcome?: CallOutcome` (import the type from `src/calls/types.ts`, created in phase 3; if phase 3 has not landed, define `CallOutcome` in `src/calls/types.ts` here with exactly the overview's shape).
2. `src/types.ts`: `Approval` gains `amountUsd?` and `kind?`. `Run` and `RunView` gain `outcome?: CallOutcome`.
3. `src/store.ts`:
   - `approvals` gains `amount_usd REAL` and `kind TEXT`. Add them with `ALTER TABLE ADD COLUMN` in the existing migration style. Change `migrateApprovals` to an explicit column list so the rebuild path does not depend on column order.
   - `runs` gains `outcome_json TEXT`.
   - `view()` and `recentRunViews` attach the **newest** open approval of a run, not the first.
4. `src/conversations.ts`:
   - `approval.request` stores `amountUsd` and `kind`. It does not overwrite `cancel_requested`.
   - `message.complete` stores `payload.outcome` on the run. Status mapping is unchanged.
   - `respondToApproval` moves the run back to `running` only when the run has no other open approval.
   - `steer` on a `waiting_approval` run resolves that run's open approvals (the instruction answers the question) and moves the run to `running`. A call adapter treats "offer 160" as the answer; leaving the approval open would keep the needs-you cue and the "approve or deny" prompt alive after the user already answered.
5. `src/voice.ts`:
   - `approvalAsk` leads with the stake when `amountUsd` is set: "{label} needs your OK: {description}. That's {amount in words}." Keep it under two sentences.
   - `speak()` for a completed run with an `outcome` speaks the outcome: `confirmed` gives the summary; `unconfirmed` gives "The call ended before they confirmed, so I won't assume it's booked."; `declined` and `no_deal` give the reason.
   - No spoken string contains an id. Extend the UUID-regex test to the new strings.

## Data structures

`ApprovalKind = "spend" | "dial" | "other"`. `CallOutcome` from the overview.

## Tests (write first, run red)

In `test/conversations.test.ts` and `test/voice.test.ts`, using `fakeAssistant`:

1. An `approval.request` with `amountUsd: 180, kind: "spend"` produces a view whose approval has `amountUsd` 180 and `kind` "spend".
2. Two approvals in one run: request A, respond to A while request B arrives before the adapter ack resolves. After both settle, the run is `waiting_approval` and the view's approval is B.
3. `message.complete` with `outcome: { kind: "unconfirmed", reason: "line ended" }` gives status `completed` and `view.outcome.kind === "unconfirmed"`.
4. `approval.request` on a `cancel_requested` run leaves it `cancel_requested`.
5. `speak()` for that unconfirmed run equals the exact sentence above. `approvalAsk` with `amountUsd: 180` contains "one hundred eighty dollars" and no digits-only id.
6. `steer` on a `waiting_approval` run calls the adapter's `steer`, resolves the open approval, and leaves the run `running` with no view approval.
7. Store migration: open a database created with the old schema (fixture SQL string), run the store, and read back an old approval row unchanged.

## Verification

- Static: `pnpm scan` green.
- Runtime: `pnpm demo`; the planner booking still completes end to end through `/mcp`.

## Done when

The seven tests pass and one commit lands: "Engine: approval stakes, run outcomes, multiple approvals".
