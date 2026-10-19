# Ambient

**Alexa, handle the call.**

Assistants can act through services that have an API. Ambient handles the ones that only answer a phone. You ask Alexa to call the plumber. An AI agent makes the call, says first that it is an AI, and talks to the business. If the price goes over your limit, Alexa asks you in the kitchen. You say "offer one fifty". The agent says it on the call, and if the business counters, Alexa asks you again. At the end, Alexa reports only what the business confirmed.

Google Duplex books in one hop. Pixel's Hold for Me and Call Screen wait on a call or screen one. None of them negotiates under the owner's limit and asks the owner again when the business counters. Ambient does.

![The call needs you: the Echo Show asks to approve $180 while the business is on hold](docs/media/sim-needs-you.png)

| | |
|---|---|
| **Track** | Alexa+ |
| **Surfaces** | MCP server on `/mcp` (spec 2025-11-25, Streamable HTTP) · custom skill on `/alexa` · MCP App card `ui://ambient/task` · simulator on `/sim` |
| **Brain** | Claude Opus 5.5 (`claude-opus-5-5`) through the Anthropic API, or a scripted brain for the zero-key demo |
| **Voice line** | AssemblyAI Voice Agent API, with our own endpoint as its LLM |
| **Entry point** | `src/server.ts` |

## Run it

The demo needs no keys and no accounts. The business is simulated. Every action is a real MCP tool call. Measured on 2026-10-19 (Windows 11, warm pnpm store): `pnpm install` took 20 seconds from a fresh clone, and `pnpm demo` served `/sim` 2.5 seconds after it started. The first install on a cold store took 122 seconds.

```sh
corepack enable
pnpm install
pnpm demo
# open http://127.0.0.1:3000/sim and tap "Call Joe's Plumbing"
```

`pnpm smoke:mcp` drives the same call through `/mcp` from the command line. It fails unless the call ends confirmed at the counter the owner approved. Joe counters the owner's offer, so the owner is asked a second time:

```text
> delegate {"task":"Call Joe's Plumbing and book a visit to fix the kitchen sink, keep it under 150","newConversation":true}
  Alexa: Joe's Plumbing wants one hundred eighty dollars for Tuesday at ten. Your limit is one hundred fifty dollars. Say approve to book it, offer an amount, or hang up.
> delegate {"task":"offer 150"}
  Alexa: Okay, offering one hundred fifty dollars.
> status
  Alexa: Joe's Plumbing is holding at one hundred sixty dollars, over your limit of one hundred fifty dollars. Say approve to book it, offer an amount, or hang up.
> approve {"decision":"once"}
  Alexa: Joe's Plumbing confirmed Tuesday at ten for one hundred sixty dollars.
smoke: ok, the business countered the owner's offer and the call booked at the approved counter
```

The full run, with the call transcript, is in [`docs/demo/smoke-transcript.txt`](docs/demo/smoke-transcript.txt).

## How a call works

![How Ambient handles a call: Alexa and MCP tools feed a run engine, a pure call reducer decides every word on the voice line, and the engine cues the house when the call needs the owner](docs/media/architecture.png)

One pure function owns the call: `step(state, input, now)` in [`src/calls/session.ts`](src/calls/session.ts). It takes the current state and one input (the business spoke, the brain produced words, the owner decided, the line dropped) and returns the next state and a list of effects (say these words, think, hang up, tell the engine). It has no clock, no network, and no model inside it. Every honesty rule below is a table test against it.

A thin shell, [`src/calls/call.ts`](src/calls/call.ts), runs the effects. Two seams plug into it:

- **The line** carries speech as text. [`simulatedLine`](src/calls/line.ts) plays Joe's Plumbing for the demo. [`CallRoom`](src/calls/rooms.ts) is the real voice line.
- **The brain** decides what to say. [`claudeBrain`](src/calls/brain.ts) streams one turn from Claude with three strict tools: `ask_owner`, `end_call`, and `remember`. [`scriptedBrain`](src/calls/brain.ts) replays rules for the demo.

A call is a run in the existing engine ([`src/conversations.ts`](src/conversations.ts)), so the MCP tools, the Alexa skill, and the simulator all see the same state.

## Honesty rules

Rules 1 to 4 are enforced in the reducer and tested in [`test/call-session.test.ts`](test/call-session.test.ts). Rules 5 and 6 are enforced in the caller runtime and tested in [`test/caller.test.ts`](test/caller.test.ts).

| Rule | What the code does |
|---|---|
| 1. The first words are an AI disclosure | The line speaks "Hi, this is an AI assistant calling for Maya. This call is transcribed." If the business cuts it off, the agent says it again before anything else. |
| 2. "Confirmed" means the business confirmed | Only the brain's `end_call` can start a booking. The reducer then reads the terms back word for word ("Just to confirm: one hundred sixty dollars total, Tuesday at ten. Is that right?"). The read-back counts only after it has fully played; the voice page reports playback, and speech during playback that is not agreement cancels it. It books only if the business's reply is short, contains a confirmation word ("yes", "that's right", "sounds good"), and otherwise holds only courtesy words and the exact amount and time from the read-back. Any other word or number, a negation, or a question returns to the conversation. Each retry is worded differently, so a late playback report cannot arm the wrong one. A labelled corpus of 192 replies pins this. After three unanswered read-backs, or five in all, the call ends unconfirmed. A dropped line is always unconfirmed. A seeded test plays 4,000 generated calls and checks that every booking followed a clean yes to a read-back of that exact amount. |
| 3. A price above the limit needs the owner | The reducer turns an over-limit confirmation into a question for the owner. Only a clear offer ("offer 160", "one sixty") counts as approval. "Don't pay 180" does not. A declined price ends the call with no deal. A deal with no price also needs the owner. |
| 4. No card numbers | Runs of 12 or more digits, spoken or written, become "that number". The check holds digits back across stream chunks, so a number split over several chunks is still caught. |
| 5. Dialing an unknown business needs approval | A business found by web search gets a "Call them?" approval. A number the user gives is dialed directly. |
| 6. Call limits | At most 3 calls to one number and 20 calls in total per 24 hours, on real lines, counting calls still in progress. |

Two independent reducer reviews and eleven structural review rounds tried to break these rules and the voice line ([progress log](progress.md)). Each defect they reproduced is now a regression test.

## The house

- **Echo Dot.** The custom skill ([`src/alexa.ts`](src/alexa.ts), [`alexa/interaction-model.en-US.json`](alexa/interaction-model.en-US.json)) starts, steers, approves, and ends calls in one sentence each. When a call needs the owner, a Voice Monkey announcement speaks the question and Proactive Events adds a notification ([`src/cue.ts`](src/cue.ts)).
- **Echo Show and Fire TV.** The MCP App card leads with the stake ("$180 · Joe's Plumbing"). On a screen it carries "Approve $180" and "Decline", which call the `approve` tool through the host.
- **Memory.** Each call is stored in SQLite. The next call to the same business starts with what the last one learned ("Remembered from Oct 18 — confirmed, quoted one hundred sixty dollars").

## Real calls

There is no phone network in this version. AssemblyAI cannot dial out, and a paid Twilio account was out of budget. Instead, the business answers on a web link, which a phone browser opens like an incoming call:

![The business's answer page: an incoming call from Ambient, labelled AI assistant](docs/media/call-business-ringing.png)

For each call, [`src/calls/rooms.ts`](src/calls/rooms.ts) creates an AssemblyAI agent. The agent's greeting is the disclosure, spoken word for word. Its LLM is our own endpoint, `/call/<id>/v1/chat/completions`. That endpoint passes each business turn into the reducer and streams back exactly what the reducer says. The honesty rules therefore hold on the real voice line too. The page streams audio straight to AssemblyAI with a single-use token, so the API key stays on the server.

```sh
cp .env.example .env
# in .env: ANTHROPIC_API_KEY, ASSEMBLYAI_API_KEY, an https PUBLIC_BASE_URL,
# and AMBIENT_RUNTIMES_FILE=runtimes.call.json
pnpm call
```

## Verification

```sh
pnpm scan    # typecheck, eslint, knip, and 618 tests
pnpm build
pnpm smoke:mcp            # a full simulated call through /mcp
python scripts/shots-sim.py   # every call state, light and dark, into docs/media/
pnpm brain:latency        # time to first word on Claude (needs ANTHROPIC_API_KEY)
```

## Limits, stated plainly

- The real voice line has not yet run against the live AssemblyAI API. The request AssemblyAI sends to our endpoint is undocumented, so the endpoint reads it defensively ([friction log](docs/friction-log.md)).
- `pnpm brain:latency` has not run yet, so the time to the first word on a live call is not measured.
- The Echo Dot flow needs the custom skill deployed to a public HTTPS host. The AWS stack is prepared (`pnpm infra:synth`) but not deployed.
- The simulator stands in for the Alexa+ host. It is a real MCP client over loopback.

## What is real and what is simulated

| Piece | Status | Evidence |
|---|---|---|
| MCP server on `/mcp` (spec 2025-11-25, Streamable HTTP) | Real | `pnpm smoke:mcp` runs a full call through it; `test/mcp.test.ts` |
| Simulator on `/sim` | Real | A real MCP client over loopback, standing in for the Alexa+ host, which was gated as of 2026-10-18 |
| MCP App card `ui://ambient/task` | Real | Rendered by the `/sim` host; not yet rendered by an Alexa+ host |
| Call reducer honesty rules (`src/calls/session.ts`) | Real | Table tests (`test/call-session.test.ts`), a 192-reply corpus (`test/read-back-replies.test.ts`), and a seeded property test over 4,000 generated calls (`test/call-honesty.test.ts`) |
| Scripted brain and the demo business | Simulated | `simulatedLine` plays Joe's Plumbing in `pnpm demo`; every action is a real MCP tool call |
| Claude brain (`claudeBrain` in `src/calls/brain.ts`) | Built but not yet run live | Tests against a stubbed stream (`test/brain.test.ts`); `pnpm brain:latency` has not run |
| AssemblyAI voice line and chat-completions shim (`src/calls/rooms.ts`) | Built but not yet run live | `test/assemblyai-line.test.ts` and `test/call-routes.test.ts`; no live API call yet ([friction log](docs/friction-log.md)) |
| Business answer page (`web/call`) | Built but not yet run live | Rendered screenshot `docs/media/call-business-ringing.png` |
| Alexa custom skill on `/alexa` | Built but not yet run live | `test/alexa.test.ts`; needs a public HTTPS deploy and an Echo Dot |
| Spoken cue and notification (`src/cue.ts`) | Built but not yet run live | `test/cue.test.ts`; needs a Voice Monkey token and Echo hardware |
| Business discovery by web search (`src/calls/discover.ts`) | Built but not yet run live | `test/discover.test.ts`; a real search needs `ANTHROPIC_API_KEY` |
| Call memory in SQLite (`src/store.ts`) | Real | The next call brief carries a "Remembered from" line (`test/caller.test.ts`) |
| AWS deployment (`infra/`) | Built but not yet run live | `pnpm infra:synth` synthesizes the CDK stack; nothing is deployed |
| An outbound phone call, a real phone ringing | Not built | No dial-out exists without paid Twilio; the business answers on a web link instead |

## Docs

[Plan](docs/plans/2026-10-18-handle-the-call/overview.md) · [AssemblyAI reference](docs/plans/2026-10-18-handle-the-call/reference-assemblyai.md) · [Alexa reference](docs/plans/2026-10-18-handle-the-call/reference-alexa.md) · [friction log](docs/friction-log.md) · [product feedback](docs/product-feedback.md) · [CONTRIBUTING](CONTRIBUTING.md)
