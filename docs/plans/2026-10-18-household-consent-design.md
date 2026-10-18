# Ambient v2: the household consent layer

Status: superseded on 2026-10-18 by `2026-10-18-handle-the-call-plan.md`. Deadline Fri 2026-10-23 12:00 PT; submit by Thu 2026-10-22.

## Why we are changing direction

Three judge-persona reviews scored v1 at 10.5, 12 and 13 out of 20. A competing entry, KiroWhisper, ships the same pitch ("voice supervises agents, speaks only when needed") on a real Echo Dot Max. About twelve other entries gate agent actions behind a voice approval. Every one of them decides **whether** to ask, by risk. None decides **when, where and whom** to ask.

Only an assistant in every room can answer that question. The organizers list "context-aware add-on that maintains state across sessions" and "agentic workflow that orchestrates across services" as creative. This design builds exactly that on top of the engine we already have.

## The product in one sentence

Your agents work in the background. Ambient decides who in the house should answer each question, on which device, and when. It learns your household's standing rules from every answer.

## Demo story (drives every decision below)

1. Maya is on a work call in the office. The errands agent needs a $40 restaurant deposit. Ambient holds the question. The office Echo Show shows a quiet glance card and makes no sound.
2. The call ends. Alexa asks Maya in the office: "Lupa needs a $40 deposit for Saturday. Approve?" Maya says yes. Alexa offers: "Want me to allow restaurant deposits under $50 from now on?" Maya agrees. A standing rule is stored.
3. Next booking at $30: Ambient approves by itself and says so in the evening briefing.
4. Leo (12) asks the agent to buy a $9 game. A child cannot approve spending. Ambient routes the question to a parent.
5. The agent wants to pay a $260 plumber invoice. That is over the two-person threshold. Ambient asks Maya, then asks Sam.
6. Sam is out. The Ring doorbell reports him arriving. The held question goes to the kitchen Echo as he walks in. The living-room Fire TV shows a corner glance card while the show plays.
7. The agent's host dies mid-run. Alexa says the outcome is unknown and will not guess. She tells Sam when the agent is back.

## Core design

### The decision module (functional core)

`src/attention.ts` is pure. It has no IO and no clock reads.

```ts
type Need = {
  approvalId: string; runId: string; agent: string;
  summary: string; kind: "spend" | "booking" | "message" | "other";
  amountUsd?: number; requestedBy?: MemberId;
};

type Household = {
  members: Member[];            // role: "adult" | "child"
  devices: Device[];            // room, class: voice | echo_show | fire_tv | mobile
  presence: Presence;           // per member: room | "away", busy: boolean
  policies: Policy[];           // standing rules learned from answers
  now: Date;
};

type Delivery =
  | { kind: "auto"; decision: "approve" | "deny"; policy: Policy }
  | { kind: "ask"; to: MemberId; device: DeviceId; authority: Authority; say: string }
  | { kind: "hold"; to: MemberId; until: "free" | "home"; glance: DeviceId[] };

type Authority = "voice" | "screen_confirm" | { kind: "two_person"; second: MemberId };

export function decide(need: Need, household: Household): Delivery;
export function learn(need: Need, answer: Answer): Policy | undefined;
```

Rules, in order:
1. A matching standing policy answers the need (`auto`).
2. Pick the approver: the requester if they are an adult, else an adult who is home and free, else any adult.
3. Authority by stakes: voice under $20, screen confirmation from $20, two people from $200.
4. If the approver is busy or away, hold the need and show glance cards on the devices in their room, or on every display if they are away.
5. Otherwise ask on the best device in the approver's room: a display if the authority needs a screen.

All tests go through `decide` and `learn`. They are table tests.

### The desk (imperative shell)

`src/desk.ts` subscribes to engine run changes (the existing `onRunChanged`). It:
- builds `Household` from the store and the presence source,
- calls `decide`,
- executes the delivery: `auto` → `engine.respondToApproval` and a briefing entry; `ask` → push to the target device; `hold` → re-run `decide` when presence changes.

It replaces the sim's ad-hoc attention ring logic. MCP tools stay as they are; `status` and `briefing` read the desk's ledger.

### Presence: two real adapters

The presence seam has two adapters, so it is a real seam:
1. **Sim presence panel**: drag a person between rooms and toggle "on a call".
2. **Ring webhook**: `POST /ring/events`, HMAC-verified, using the Ring Developer Playground (allowed by the FAQ). A doorbell or motion event for a known member sets them home.

A real Alexa request carries `context.System.person.personId` for a recognized speaker. The `/alexa` path maps it to a member. The sim's speaker picker stands in for it and says so.

### Standing policies: context across sessions

New `policies` table in the existing SQLite store: `id, member_id, kind, max_usd, decision, created_at, source_approval_id`. `learn` proposes a policy after an approval. It is stored only when the person says yes to the offer. Policies are listed and revoked by voice ("what rules do my agents follow?").

### Honest `unknown`, now recoverable

Keep the `unknown` status. Add a `notify_when_back` intent on the desk: when the runtime reconnects, the desk delivers "the agent is back; last task outcome is still unknown. Retry?" The steering guard is scoped to the run's own conversation, so one `unknown` run no longer blocks every `delegate`.

## Alternatives considered

- **Risk tags set by each agent** (KiroWhisper's model). Rejected: the agent decides its own oversight, and nothing knows about the household.
- **Policy inside each runtime adapter.** Rejected: four copies of household state, and the demo agent would carry product logic.

A central desk with a pure decision core keeps one owner for household state and tests without IO.

## Out of scope

- A separate Fire TV app (the sim renders the Fire TV glance card).
- Bee integration (no Bee device or Apple Watch confirmed).
- Multi-household tenancy.

## Proof work (needs the account owner)

- A real Echo via KayLerch/alexa-skill-mcp-bridge or the `/alexa` skill in development mode.
- `cdk deploy` and a live Bedrock Nova receipt.
- Open Source mini challenge: a PR to the bridge that carries `ui://` cards to Echo Show.
