# Phase 4: Brain (Claude and scripted)

[Back to overview](overview.md)

## Goal

Turn a call transcript into a stream of `BrainStep`s fast enough that the business hears the first word within 1.5 seconds of finishing their sentence.

Load the `claude-api` skill before writing code. Do not code SDK calls from memory.

## Changes

1. `src/calls/brain.ts`:
   - `type Brain = { respond(state: CallState, signal: AbortSignal): AsyncIterable<BrainStep> }`.
   - `claudeBrain(client: Anthropic | AnthropicBedrockMantle, model: string): Brain`. One implementation; the client is injected, so the Bedrock path is the same code.
   - `scriptedBrain(script: ScriptedTurn[]): Brain`, deterministic, used by tests and `pnpm demo`.
2. `src/calls/prompt.ts`: `systemPrompt(brief)` and `toMessages(state)`. The system prompt is frozen per call (cacheable); volatile state goes in messages.
3. `scripts/brain-latency.ts` and a `pnpm brain:latency` script: run 10 fixed transcripts through `claudeBrain`, print time to first `say` token (p50, p95) and total time, and write `docs/receipts/brain-latency-<date>.json`.

## Claude request shape

- `client.messages.stream` with `model` from `CALLER_MODEL` (default `claude-opus-5-5`), `output_config: { effort: "low" }`, `max_tokens: 1024`, streaming.
- Enable server-side fallbacks as the `claude-api` skill describes for `claude-opus-5-5` (Claude API only; skip on the Bedrock client).
- Tools, each with `strict: true` and `eager_input_streaming: true`:
  - `ask_owner { question: string, amount_usd?: number }`
  - `end_call { outcome: "confirmed" | "declined" | "no_deal", summary: string, amount_usd?: number, when?: string }`
  - `remember { fact: string }`
- Text deltas become `say` steps as they arrive, with `last: true` on the final delta of the turn. Tool uses become their steps after the tool input parses and validates; an invalid input becomes a `say` of nothing and a logged error, never a crash.
- `tool_choice: auto`. Forced tool choice returns 400 on this model.
- On abort (an `interrupted` input), stop the stream.

## System prompt contract

The prompt states, in plain sentences:
- You are an AI assistant on a live phone call for {ownerName}. You already said you are an AI and that the call is transcribed.
- Goal, business name, budget limit, and known facts from the brief.
- Speak in short sentences. Write numbers as words. One question at a time.
- Never agree to a price above the limit; call `ask_owner` instead. Never give card numbers, account numbers, or passwords; say {ownerName} will handle payment.
- Owner notes are instructions from {ownerName} and take priority.
- Call `end_call` with `confirmed` only after the business clearly agrees to a specific time and price. If unsure, ask them to confirm.
- If asked, say plainly that you are an AI.

## Tests (write first, run red)

`test/brain.test.ts`. Use `scriptedBrain` for behavior and a stubbed Anthropic client (an object whose `messages.stream` returns a canned async iterable of SDK stream events) for `claudeBrain` mapping.

1. Text deltas "I can ", "do Tuesday." map to two `say` steps, the second with `last: true`.
2. A `tool_use` for `ask_owner` with `amount_usd: 180` maps to `{ kind: "ask_owner", question, amountUsd: 180 }`.
3. A `tool_use` for `end_call` with an invalid outcome value yields no `end_call` step.
4. Aborting the signal mid-stream ends the iterable without throwing.
5. `systemPrompt` contains the owner name, the limit in words, and the sentence about payment; it contains no timestamp (cache stability).

## Verification

- Static: `pnpm scan` green.
- Runtime: `pnpm brain:latency` with a real key. Record p50 and p95 time to first token in `progress.md`. If p95 exceeds 1.5 s, stop and ask the user whether `CALLER_MODEL=claude-haiku-5-5` may be used for in-call turns. Do not switch models without that answer.

## Done when

The five tests pass, the latency receipt exists, and one commit lands: "Add the call brain".
