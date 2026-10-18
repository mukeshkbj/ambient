# Phase 8: Discovery and memory

[Back to overview](overview.md)

## Goal

"Alexa, find a plumber for tomorrow under 150" works without a phone number, and the second call knows what the first one learned. Memory is the organizers' "maintains state across sessions" item; make it visible in the demo.

## Changes

1. `src/calls/discover.ts`: `discoverBusiness(client, goal, household): Promise<Candidate[]>`.
   - One `messages.create` with `claude-opus-5-5`, the `web_search_20260209` server tool, and `user_location` from the household address.
   - Structured output (`output_config.format`) returns up to 3 `{ name, phone, why }`. Parse each phone with `parsePhoneNumber`; drop candidates that fail.
   - Handle a web search error result (an object, not a list) as zero candidates.
2. `src/runtimes/caller.ts`: when the instruction names no known business:
   - Emit `status.update` "Looking for a plumber near you."
   - Run discovery, then emit `approval.request` with `kind: "dial"`: "I found Joe's Plumbing, rated for same-week visits. Call them?"
   - `once` dials. `deny` tries the next candidate or ends with `no_deal` "no suitable business".
   - A number given by the user in the instruction dials without a `dial` approval (honesty rule 5).
3. `src/store.ts`: two tables.
   - `call_history (id, run_id, business_name, phone, goal, outcome_json, amount_usd, created_at)`, written when a caller run ends.
   - `facts (id, business_phone, fact, created_at)`, written on each brain `remember` step.
4. `src/calls/prompt.ts`: the brief's `facts` include the last 3 outcomes and all facts for that phone ("Last call on Oct 12: quoted $140, came Tuesday."). Discovery ranks a business with a past `confirmed` outcome first and says so in the `dial` question ("You used Joe's Plumbing on Oct 12 for $140. Call them again?").
5. `src/calls/limits.ts`: before dialing, count today's `call_history` rows; enforce 3 per number and 20 per day. Over the limit ends the run `no_deal` with "call limit reached".

## Tests (write first, run red)

1. `discoverBusiness` with a stubbed client returning a structured result keeps valid E.164 numbers and drops "call us!".
2. A web search error block yields `[]`.
3. A caller run with no business emits a `dial` approval naming the first candidate; `deny` moves to the second.
4. A run with "call 415 555 0100" dials without a `dial` approval.
5. After a confirmed call, a second brief for the same phone contains "quoted" and the amount.
6. The fourth call to one number in a day ends `no_deal` "call limit reached" without dialing.

## Verification

- Static: `pnpm scan` green.
- Runtime: with a real key, `pnpm demo` with `brain: claude` and `line: simulated`: ask to "find a plumber near me for tomorrow", confirm the `dial` question names a real local business (do not dial it). Then run two simulated calls to the persona and confirm the second `dial` question mentions the first.

## Done when

The six tests pass and one commit lands: "Business discovery and call memory".
