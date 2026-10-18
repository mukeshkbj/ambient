# "Alexa, handle the call": implementation plan

> **For agents:** read this file, then only the phase file you are assigned. Each phase file is self-contained. Load the skills named under "Applicable skills" before you write code.

**Goal:** a user asks Alexa to handle a phone call; an agent phones the business, talks to a person, pauses for the user's decision mid-call, and reports only what the business confirmed.

**Architecture:** the caller is one new runtime adapter behind the existing `AssistantClient` interface. Inside it, a pure state machine (`src/calls/session.ts`) owns the call; a `Line` (Twilio or simulated) carries speech as text; a `Brain` (Claude or scripted) decides what to say. The engine, MCP tools, `/alexa`, briefings, and the sim already speak `AssistantClient`, so they need small changes, not new surfaces.

**Tech stack:** Node 22, TypeScript (ESM, `NodeNext`, strict, `exactOptionalPropertyTypes`), `node:sqlite`, `@modelcontextprotocol/sdk` 1.30, Vitest 3, `@anthropic-ai/sdk` and `@anthropic-ai/bedrock-sdk`, `twilio` 6.x with ConversationRelay, Voice Monkey, ASK Proactive Events, AWS CDK.

Deadline Fri 2026-10-23 12:00 PT. Submit Thu 2026-10-22. Decisions and their reasons live in [decisions.md](decisions.md).

## Context

Three judge-persona reviews scored v1 ("Alexa supervises your agents") at 10.5, 12, and 13 of 20. A competing entry, KiroWhisper, ships that pitch on a real Echo. The new product keeps v1's engine and gives it a job a household has every week: making the phone call nobody wants to make.

The demo moment is concrete. A real phone rings on camera. The agent says it is an AI calling for Maya. The plumber asks for $180, over Maya's $150 limit. Alexa speaks up in the kitchen. Maya says "tell him 160." The agent says it on the live call two seconds later.

## Scope

**In:**
- Outbound calls through Twilio ConversationRelay, with an AI disclosure greeting.
- Mid-call decisions (`approval.request`) and free-text steering (`steer`) from Alexa, MCP, and the sim.
- Honest outcomes: `confirmed`, `declined`, `no_deal`, `unconfirmed`.
- A spoken cue on the Echo Dot (Voice Monkey) and an Amazon-native chime (Proactive Events).
- Business discovery with Claude web search, confirmed by the user before dialing.
- Cross-session memory: call history and facts in SQLite.
- Zero-key judge path: `pnpm demo` with a scripted brain and a simulated business.
- AWS: EC2 deploy, Secrets Manager, Claude on Bedrock as a second brain client, Amazon Polly voice through ConversationRelay.

**Out:**
- Inbound calls, voicemail handling, call recording.
- Payments of any kind. The agent never speaks card numbers.
- A Fire TV app, Bee, Ring.
- Supermemory and AssemblyAI (see Alternatives).
- Multi-household tenancy.

**Stretch (decided on day 3):** three calls in parallel, best offer wins.

## Constraints

- The Twilio account must be upgraded. Trial accounts replace `<ConversationRelay>` with a spoken error. The AI/ML addendum must be accepted in the console (error 64110 otherwise).
- There is no first-token timeout on ConversationRelay. Every millisecond before the first token is dead air on the call. The brain must stream.
- Alexa cannot speak free text unprompted through first-party APIs. Proactive Events speaks a fixed template only after the user asks. Voice Monkey (a Smart Home routine trigger) is the only spoken cue.
- Whether a custom skill invokes on the user's Echo Dot under Alexa+ is unverified. Phase 0 tests it first.
- Repo conventions: `.js` import suffixes, `exactOptionalPropertyTypes` spreads, no code comments, `pnpm scan` (typecheck, eslint, knip, vitest) green on every commit.
- One active run per conversation. Parallel calls use separate conversations.

## Alternatives

| Choice | Picked | Rejected and why |
|---|---|---|
| Phone audio | ConversationRelay (text over WebSocket) | Media Streams + AssemblyAI + Polly: 1.5 to 2 days of audio plumbing (codec, turn detection, barge-in, TTS streaming). Nova 2 Sonic: user declined. |
| Where the call logic lives | A pure reducer plus a thin shell | Logic inside the adapter's event handlers: untestable without a phone. |
| Repo | Keep and subtract | New repo: 1.5 days rebuilding MCP, elicitation, ASK verification. The repo's first commit (2026-09-16) is inside the hackathon window. |
| Spoken cue | Voice Monkey announce, plus Proactive Events chime | A custom Smart Home skill driving a routine: account linking and an OAuth provider for a static sentence. |
| Memory | SQLite | Supermemory: a third-party key with no judge value. |
| "Call ended without confirmation" | A run `outcome` field | Reusing engine `unknown`: that status means "lost contact with the runtime" and is recoverable. |

## Applicable skills

- `architect` and `codebase-design` for phases 3 to 6.
- `test-driven-development` for every phase with behavior.
- `claude-api` before writing any Anthropic SDK code (phase 4).
- `code-deslop` before every commit. No comments.
- `design-engineering` and `emil-design-eng` for phase 9. Verify by screenshots.
- `verification-before-completion` before marking a phase done.
- `technical-writing` and `prose` for phase 11 prose.

## Phases

Each phase ends with `pnpm scan` green and one commit. Phases on the same line can run in parallel lanes, each in its own worktree.

| # | Phase | Depends on | Lane |
|---|---|---|---|
| 0 | [Preflight: accounts and hardware](phase-00-preflight.md) | none | user + orchestrator |
| 1 | [Subtract the v1 adapters](phase-01-subtract.md) | none | A |
| 2 | [Engine support for calls](phase-02-engine-calls.md) | 1 | A |
| 3 | [Call session state machine](phase-03-call-session.md) | 1 | B |
| 4 | [Brain: Claude and scripted](phase-04-brain.md) | 3 | B |
| 5 | [Caller runtime and simulated line](phase-05-caller-runtime.md) | 2, 4 | A |
| 6 | [Twilio line](phase-06-twilio-line.md) | 3 | C |
| 7 | [Alexa: call intents and the cue](phase-07-alexa.md) | 2 | C |
| 8 | [Discovery and memory](phase-08-discovery-memory.md) | 5 | B |
| 9 | [Sim around a live call](phase-09-sim.md) | 5 | D |
| 10 | [AWS deploy and Bedrock](phase-10-aws.md) | 6 | C |
| 11 | [Submission](phase-11-submission.md) | all | orchestrator |

Schedule: day 1 runs phases 0 to 4 and a first real call from a smoke script. Day 2 runs 5 to 7. Day 3 runs 8 to 10 and the stretch decision. Day 4 runs 11. Fri morning is buffer.

## Data model

These types are the contract between lanes. Phase 3 commits them first.

```ts
type PhoneNumber = string & { readonly brand: "E164" };

type CallBrief = {
	goal: string;
	business: { name: string; phone: PhoneNumber };
	ownerName: string;
	maxUsd?: number;
	facts: string[];
};

type Speaker = "agent" | "business" | "owner";
type CallTurn = { speaker: Speaker; text: string; at: string };

type CallOutcome =
	| { kind: "confirmed"; summary: string; amountUsd?: number; when?: string }
	| { kind: "declined"; reason: string }
	| { kind: "no_deal"; reason: string }
	| { kind: "unconfirmed"; reason: string };

type CallPhase =
	| { kind: "dialing" }
	| { kind: "talking" }
	| { kind: "waiting_for_owner"; requestId: string; question: string; amountUsd?: number }
	| { kind: "ended"; outcome: CallOutcome };

type CallInput =
	| { kind: "answered" }
	| { kind: "heard"; text: string }
	| { kind: "interrupted"; spokenSoFar: string }
	| { kind: "line_ended"; reason: "hangup" | "no_answer" | "busy" | "failed" }
	| { kind: "brain"; step: BrainStep }
	| { kind: "owner_said"; text: string }
	| { kind: "owner_decided"; requestId: string; decision: "once" | "deny" }
	| { kind: "hold_tick" };

type BrainStep =
	| { kind: "say"; text: string; last: boolean }
	| { kind: "ask_owner"; question: string; amountUsd?: number }
	| { kind: "remember"; fact: string }
	| { kind: "end_call"; outcome: Exclude<CallOutcome, { kind: "unconfirmed" }> };

type CallEffect =
	| { kind: "say"; text: string; last: boolean }
	| { kind: "think" }
	| { kind: "hang_up" }
	| { kind: "emit"; event: AssistantEvent };
```

`step(state, input) -> { state, effects }` is the whole call logic. It is pure. The shell in phase 5 executes effects.

## Honesty rules

Each rule is a test in phase 3 or 4. Breaking one fails `pnpm scan`.

1. The first thing the business hears is the disclosure greeting: "Hi, this is an AI assistant calling for {ownerName}. This call is transcribed."
2. The outcome is `confirmed` only through a brain `end_call` with `confirmed`. A line that ends any other way yields `unconfirmed`.
3. A price above `maxUsd` needs an owner decision before the agent agrees to it.
4. The agent never says a sequence of 12 or more digits. Payment stays with the person.
5. Every dial needs an approved `dial` decision unless the number came from the user directly.
6. At most 3 calls per number per day and 20 calls per day in total.

## Verification

Project-level checks. Details in [testing.md](testing.md).

- `pnpm scan` green, `pnpm build` green.
- `pnpm demo` runs a full simulated call with zero keys.
- `pnpm call:me` places a real call to the user's phone (needs Twilio and Anthropic keys).
- The Echo Dot starts a call and steers it, filmed in one take.

## Implementation guidance

- Walk each subsystem before changing it. The codebase map is in [research/codebase-2026-10-18.md](research/codebase-2026-10-18.md). Line numbers there are from before phase 1.
- Subtract before you add: phase 1 lands before any new file.
- Write the failing test first, run it red, implement, run it green, commit.
- Run `code-deslop` on each diff before commit.
- Contested design (phase 3 reducer, phase 5 shell) gets two independent reviewer subagents before merge.
- Facts about Twilio and Alexa live in [reference-twilio.md](reference-twilio.md) and [reference-alexa.md](reference-alexa.md). Do not code from memory.
- Every lane updates `progress.md` when its phase lands.
