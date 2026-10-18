# Testing

[Back to overview](overview.md)

## Every commit

```sh
pnpm scan
pnpm build
```

`pnpm scan` runs typecheck, eslint, knip, and vitest. Every phase adds its tests to `test/`; they run in this command.

## Zero-key end to end (judge path)

```sh
pnpm i
pnpm demo
pnpm tsx scripts/smoke-mcp.ts
```

Expected: the simulated call reaches `waiting_approval` with an amount over the limit, the steer "offer 160" is accepted, and the run ends `completed` with outcome `confirmed` at 160. `smoke-mcp.ts` exits 0.

## Real call

Needs Twilio, Anthropic, `PUBLIC_BASE_URL` on a tunnel or the AWS host, and `CALL_ME_NUMBER`.

```sh
pnpm call:me
```

Expected: the phone rings within 10 seconds, the disclosure plays uninterrupted, the agent answers each sentence, and the script prints the transcript and outcome. Record the first-word delay.

## Echo Dot

Needs phase 0 step 1 passed and the phase 7 model built.

1. "Alexa, tell Ambient to call Joe's Plumbing." Expect "Calling Joe's Plumbing now."
2. Wait for the cue. Expect the Echo Dot to speak the question within the measured Voice Monkey delay.
3. "Alexa, tell Ambient offer one sixty." Expect "Told them."
4. "Alexa, ask Ambient how's the call going." Expect the outcome sentence.

Record misheard utterances from the Alexa app Activity page.

## Latency

```sh
pnpm brain:latency
```

Target: p95 time to first token under 1.5 s. The receipt goes to `docs/receipts/`.

## Fresh clone

```sh
git clone <repo> /tmp/ambient-clean && cd /tmp/ambient-clean
pnpm i && pnpm scan && pnpm demo
```

Run before submission. Every README command must work from the README alone.
