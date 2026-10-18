# Phase 3: Call session state machine

[Back to overview](overview.md)

## Goal

Put the whole call logic in one pure function, `step(state, input) -> { state, effects }`, so every honesty rule is a table test that runs without a phone, a model, or a clock.

This is the deepest module in the product. Get two independent reviewer subagents to read the reducer before merge.

## Changes

1. `src/calls/types.ts`: every type in the overview's Data model section, plus `parsePhoneNumber(raw: string): PhoneNumber` (E.164, US default) that throws on anything else.
2. `src/calls/session.ts`:
   - `CallState = { brief: CallBrief; phase: CallPhase; turns: CallTurn[]; ownerNotes: string[]; agentDraft: string; heldSince?: string; now: string }`.
   - `startCall(brief, now): { state, effects }` returns phase `dialing` and no speech. The greeting is spoken by Twilio's `welcomeGreeting`, and the simulated line must mirror it.
   - `step(state, input): { state, effects }`.
3. `src/calls/rules.ts`: `HOLD_LINE_MS = 15000`, `MAX_DIGIT_RUN = 11`, `disclosure(ownerName)`, `redactDigits(text)`, and the daily call limits as constants. Kept separate only because phase 6 and the simulated line import `disclosure`.

## Transition table

| Phase | Input | Next phase | Effects |
|---|---|---|---|
| `dialing` | `answered` | `talking` | append agent turn with the disclosure; `emit status.update` "Connected to {business}" |
| `dialing` | `line_ended` | `ended` `unconfirmed` ("no answer", "busy", "failed") | `emit message.complete` with outcome |
| `talking` | `heard` | `talking` | append business turn; `emit status.update` with the line; `think` |
| `talking` | `brain say` | `talking` | `say` (digits redacted); on `last`, append the agent turn from `agentDraft` |
| `talking` | `brain ask_owner` | `waiting_for_owner` | `say` "One moment, let me check with {ownerName}."; `emit approval.request` with `requestId`, `amountUsd`, `kind: "spend"` when an amount is present |
| `talking` | `brain end_call` | `ended` (that outcome) | `say` a closing line; `hang_up`; `emit message.complete` with outcome |
| `talking` | `interrupted` | `talking` | truncate the last agent turn to `spokenSoFar` |
| `talking` | `owner_said` | `talking` | append owner note and an owner turn; `think` |
| `waiting_for_owner` | `owner_said` | `talking` | the note answers the pending question: append owner note and an owner turn; `think` |
| `waiting_for_owner` | `owner_decided` matching `requestId` | `talking` | append owner note "approved" or "declined" with the question; `think` |
| `waiting_for_owner` | `owner_decided` with another `requestId` | same | none |
| `waiting_for_owner` | `heard` | same | append business turn; `say` "Still checking with {ownerName}, one moment." |
| `waiting_for_owner` | `hold_tick` and `now - heldSince >= HOLD_LINE_MS` | same | `say` "Still checking with {ownerName}, thanks for holding."; reset `heldSince` |
| any live | `line_ended` | `ended` `unconfirmed` ("the line ended before they confirmed") | `emit message.complete` with outcome |
| `ended` | any | `ended` | none |

## Honesty guards inside `step`

- A `brain end_call` with `confirmed` and an `amountUsd` above `brief.maxUsd` is rejected unless an owner note approved that amount. The reducer converts it to `ask_owner` with the amount.
- A `brain say` text has digit runs of 12 or more replaced with "that number".
- `unconfirmed` is never accepted from the brain (the type forbids it).

## Tests (write first, run red)

`test/call-session.test.ts`, table-driven. Each case gives a starting state, a list of inputs, and the expected final phase and effect kinds.

1. Happy path: answered, heard "I can do Tuesday for 140", brain end_call confirmed 140 under max 150. Final `ended confirmed`; effects include one `hang_up` and one `message.complete`.
2. Over-limit: max 150, brain end_call confirmed 180 with no owner approval. Phase becomes `waiting_for_owner` with amount 180; an `approval.request` with `amountUsd: 180` is emitted.
3. Owner approves: from case 2, `owner_decided once` on the matching id. Phase `talking`; a `think` effect; owner note recorded. A later end_call confirmed 180 is accepted.
4. Owner steers: `owner_said "offer 160"` during `waiting_for_owner` moves the phase to `talking`, records an owner turn, and emits `think`.
5. Hang-up mid-call: `line_ended hangup` from `talking` gives `ended unconfirmed`.
6. No answer: `line_ended no_answer` from `dialing` gives `ended unconfirmed` with reason "no answer".
7. Interrupt: agent says "We could do Tuesday at ten or" then `interrupted "We could do Tuesday"`; the stored agent turn equals "We could do Tuesday".
8. Hold line: in `waiting_for_owner`, `hold_tick` at 14 s emits nothing; at 15 s emits one `say` with the holding line.
9. Digits: brain says "My card is 4111111111111111"; the `say` effect text contains "that number" and no 12-digit run.
10. Stale decision: `owner_decided` with a different `requestId` changes nothing.
11. After `ended`, every input returns the same state and no effects.

## Verification

- Static: `pnpm scan` green.
- Runtime: none (pure module). Reviewers sign off on the transition table against the tests.

## Done when

All 11 cases pass, two reviewer subagents agree the table matches the code, and one commit lands: "Add the call session state machine".
