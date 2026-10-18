# Ambient v2: "Alexa, handle the call"

Status: decided with the user on 2026-10-18. This plan replaces `2026-10-18-household-consent-design.md`.
Deadline Fri 2026-10-23 12:00 PT. Submit Thu 2026-10-22.

## The product

Alexa+ can book anything with an API. Ambient calls everything that doesn't. The phone is the one API every business already has.

You ask Alexa to handle a call. An agent phones the business, says it is an AI calling for you, and talks to the person. When it hits a decision, the call waits and Alexa asks you in the room. You answer, or say "tell him 160", and your words reach the live call within about two seconds. When the call ends, Alexa reports only what was confirmed on the call.

## Decisions

| # | Decision |
|---|---|
| Brain | Anthropic API in the demo. The same code runs on Claude on Bedrock through the Mantle client, for the AWS story. |
| Phone | Twilio Programmable Voice with ConversationRelay. Twilio does speech-to-text and text-to-speech; our server exchanges text over a websocket. |
| Device | The user's Echo Dot (no screen) through the existing `/alexa` skill. Display devices appear in the sim. |
| Cue | Both: ASK Proactive Events (Amazon-native chime) and a third-party announcement service so Alexa speaks unprompted in the video. |
| Judges | `pnpm demo` runs with zero keys: scripted brain and simulated business. Keys upgrade each half. |
| Businesses | Real businesses are allowed. The video's hero call goes to a consenting family member. |
| Disclosure | The first sentence on every call says it is an AI calling for the user. Non-negotiable. |
| Memory | SQLite call history plus facts the brain extracts. Supermemory is an optional second adapter, only if time allows. |
| AWS | EC2 deploy (public HTTPS for Twilio and the Alexa skill), Secrets Manager, Bedrock brain. |
| Cuts | Delete the OpenClaw adapter and every developer scenario. |
| Stretch | Three calls in parallel, best offer wins. Decided on day 3. |

## Architecture

The caller is a new runtime adapter behind the existing `AssistantClient` interface (`src/runtimes/types.ts`). The engine, MCP tools, `/alexa`, briefings, and the sim work with it unchanged.

| `AssistantClient` | Phone call meaning |
|---|---|
| `submitPrompt` | Plan the call, find the number, dial |
| `message.delta`, `status.update` | Live transcript lines |
| `approval.request` | Decision mid-call, with amount and kind |
| `respondToApproval` | The answer reaches the live call |
| `steer` | "Tell him 160": injected into the live call |
| `interrupt` | Hang up |
| runtime `unknown` | The call ended without a confirmation the brain heard |

### Interface sketch (committed first, before lanes fan out)

```ts
// src/calls/line.ts: the phone side
type LineEvent =
  | { kind: "answered" }
  | { kind: "heard"; text: string }
  | { kind: "interrupted"; spokenSoFar: string }
  | { kind: "ended"; reason: "hangup" | "no_answer" | "busy" | "failed" };

type Line = {
  dial(to: PhoneNumber, greeting: string): Promise<void>;
  say(text: string, last: boolean): void;
  hangUp(): void;
  onEvent(listener: (event: LineEvent) => void): () => void;
};
// Adapters: TwilioLine (ConversationRelay websocket), SimulatedLine (scripted business).

// src/calls/brain.ts: the reasoning side
type BrainStep =
  | { kind: "say"; text: string }
  | { kind: "ask_owner"; question: string; amountUsd?: number }
  | { kind: "end_call"; outcome: CallOutcome };

type CallOutcome =
  | { kind: "confirmed"; summary: string; amountUsd?: number; when?: string }
  | { kind: "declined"; reason: string }
  | { kind: "no_deal"; reason: string };

type Brain = {
  next(call: CallState): AsyncIterable<BrainStep>;
};
// Adapters: ClaudeBrain (Anthropic client or Bedrock Mantle client, injected), ScriptedBrain.
```

`Line` and `Brain` each have two real adapters, so both seams pay rent. Tests use `SimulatedLine` and `ScriptedBrain` through the `AssistantClient` interface.

### Honesty rules (enforced in code, tested)

1. The outcome is `confirmed` only when the brain calls `end_call` with `confirmed` after hearing the business agree. A line that ends without it is `unknown`, and Alexa says so.
2. The agent never reads out payment card numbers. Payment stays with the person.
3. The agent never accepts a price above the owner's limit without an `ask_owner` decision.
4. Every call starts with the disclosure greeting.
5. Calls are rate-limited per number and per day.

### Claude usage

- Model `claude-opus-5-5`, streaming, `output_config.effort: "low"` for in-call turns (latency), adaptive thinking. Server-side `fallbacks: "default"` enabled.
- Tools: `ask_owner`, `end_call`, `remember_fact`, plus the `web_search_20260209` server tool for finding a business and its number.
- Measure first-audio latency on day 1. Target under 1.5 s.

## Lanes

| Lane | Scope | Depends on |
|---|---|---|
| S | Sketch commit: `line.ts`, `brain.ts` types, stub adapters, engine stakes fields | nothing |
| L0 | Merge `lane/L0-p0` (3 commits). Finish: friction-log dates, false doc claims, router utterance table for call phrases | nothing |
| C1 | `caller` runtime, `ClaudeBrain`, `ScriptedBrain`, `SimulatedLine`, honesty rules, tests | S |
| C2 | `TwilioLine`: outbound call, TwiML, ConversationRelay websocket route, status callbacks, tunnel script | S |
| C3 | Alexa path: intents for call, steer ("tell him"), approve, status; Proactive Events; announcement cue; interaction model | S |
| C4 | Sim redesign around a live call: transcript, phone card, Echo Show card, Fire TV corner card, Echo Dot light ring | S |
| C5 | Memory: call history, extracted facts, household profile, "last time" recall | C1 |
| C6 | AWS: fix CDK env, Twilio and Anthropic secrets, deploy, Bedrock brain run, receipts | C2 |
| C7 | Submission: video, friction log, product feedback, README, Devpost; blind judge re-run vs KiroWhisper and Spoken.ai | C1 to C6 |

## Schedule

| Day | Goal |
|---|---|
| 1 (Oct 18-19) | S, L0, C1. A real Twilio call to the user's phone through a tunnel. Latency measured. |
| 2 (Oct 19-20) | C2 done, C3: Echo Dot starts a call and steers it live. |
| 3 (Oct 20-21) | C4, C5, C6. Stretch decision on parallel calls. |
| 4 (Oct 21-22) | C7. Submit. |
| Oct 23 morning | Buffer only. |

## Needs the user

- Twilio account upgraded (trial accounts only call verified numbers and play a trial message), with a phone number.
- `ANTHROPIC_API_KEY` (or `ant auth login`).
- AWS credentials and approval for `cdk deploy`.
- Echo Dot on the same Amazon account as the ASK developer console; build the interaction model there.
- An announcement-service account for the spoken cue.
- Approval to create the public GitHub repo and push.

## Proof that it works (not our own opinion)

- A recorded real call with a person who did not see the script.
- The Echo Dot steering a live call, filmed in one take.
- Measured latency numbers in the README.
- A blind judge-persona re-run that scores above the three nearest competitors.
