# Phase 5: Caller runtime and simulated line

[Back to overview](overview.md)

## Goal

Make a call a run. After this phase, `pnpm demo` with zero keys delegates "call the plumber", plays a simulated business, asks for an approval over the limit, accepts a steer, and ends with an honest outcome, all through the existing engine, MCP tools, and sim events.

## Changes

1. `src/calls/line.ts`:
   - `type Line = { dial(to: PhoneNumber, callId: string, ownerName: string): Promise<void>; say(text: string, last: boolean): void; hangUp(): void; onInput(listener: (input: LineInput) => void): () => void }`, where `LineInput` is the `answered | heard | interrupted | line_ended` subset of `CallInput`.
   - `simulatedLine(persona: BusinessPersona): Line`. A persona is a list of `{ when: RegExp, reply: string }` plus an opening line. It answers after 500 ms, replies to agent `last` turns by matching rules, and ends the line on "goodbye". The demo persona is "Joe's Plumbing": quotes $180, accepts $160 if offered, confirms "Tuesday at ten".
2. `src/calls/call.ts`: the shell. `runCall({ brief, line, brain, emit, now, tick })` creates the state with `startCall`, feeds every `LineInput`, brain step, and owner input through `step`, and executes effects:
   - `say` goes to `line.say`.
   - `think` aborts any running brain stream and starts `brain.respond(state, signal)`.
   - `hang_up` goes to `line.hangUp`.
   - `emit` goes to the adapter's event listeners with the run's `sessionId`.
   - A 1-second `tick` timer feeds `hold_tick` while waiting for the owner.
   - It exposes `ownerSaid(text)`, `ownerDecided(requestId, decision)`, `hangUp()`.
   - Inputs are processed one at a time in arrival order (a simple promise queue), so `step` never sees interleaved state.
3. `src/runtimes/caller.ts`: `CallerClient implements AssistantClient`.
   - `capabilities`: `{ sessions: true, steer: true, cancel: true, approvals: true, resume: false, events: true, asyncClass: "async" }`, `ephemeralSessions: true`.
   - `createSession` returns a new call id as both session ids.
   - `submitPrompt(sessionId, text)` builds a `CallBrief`, starts `runCall`, and returns `{ state: "streaming" }`. The brief's `goal` is the instruction text; `business` comes from the runtime options (phase 8 adds discovery); `maxUsd` is the first "under N" or "no more than N" amount in the instruction, else the household default; `ownerName` and `facts` come from the household profile.
   - `steer(sessionId, text)` calls `ownerSaid`. `respondToApproval(sessionId, requestId, choice)` calls `ownerDecided` and returns `{ resolved: 1 }`. `interrupt` calls `hangUp` and returns `{ state: "interrupted" }`.
   - Connection state is `online` from start. The runtime never emits `offline` because one call ended.
4. `src/runtimes/registry.ts`: add `caller: callerRuntime` to `ADAPTERS` using `polledRuntime`. Options: `line` (`simulated` or `twilio`), `brain` (`scripted` or `claude`), `owner`, `maxUsd`, `business`, `phone`.
5. `runtimes.demo.json`: one runtime `caller` with `line: simulated`, `brain: scripted`. Delete `src/runtimes/demo.ts`, `test/demo.test.ts`, and `adapter: "demo"` from `ADAPTERS`.
6. `household.example.json` and `src/household.ts`: `{ ownerName, address, maxUsdDefault, facts[] }`, read from `AMBIENT_HOUSEHOLD_FILE`, defaulting to the example.

## Tests (write first, run red)

`test/caller.test.ts`, through `ConversationEngine` with `simulatedLine` (speed option for tests) and `scriptedBrain`:

1. Full simulated call: `engine.ask("Call Joe's Plumbing and book a visit under 150")` reaches `waiting_approval` with `amountUsd: 180`.
2. Steer during the wait: `engine.steer(run.id, "offer 160")` then the persona accepts; the run completes with `outcome.kind === "confirmed"` and `amountUsd: 160`, and no approval stays open.
3. Approve instead: `engine.respondToApproval(id, "once")` completes the run `confirmed` at 180.
4. Hang-up: the persona variant that hangs up after the quote ends the run `completed` with `outcome.kind === "unconfirmed"`.
5. Cancel: `engine.cancel(run.id)` hangs up the line and the run is `cancelled`.
6. Transcript: after test 2, `run.steps` contains the business line "I can do Tuesday at ten" and the owner note.

## Verification

- Static: `pnpm scan` green.
- Runtime: `pnpm demo`, then drive the MCP tools with `scripts/smoke-mcp.ts` (update it to: `delegate` "call Joe's Plumbing, keep it under 150", wait for `waiting_approval`, `delegate` "offer 160", `status`). Paste the spoken lines into `progress.md`.

## Done when

The six tests pass, the demo run transcript is in `progress.md`, and one commit lands: "Add the caller runtime and simulated line".
