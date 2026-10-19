# Ambient: Alexa, handle the call

Track: Alexa+

Demo video: [VIDEO URL]
Public repo: [PUBLIC REPO URL]

Ambient lets Alexa phone a business for the household, discloses that it is an AI, and books only on a clear yes to the exact price and time.

**What you can run today, and what is not live yet.** The whole call runs end to end with zero keys: `pnpm demo` in a browser, and `pnpm smoke:mcp` through the MCP server. In that demo the business is simulated, and so is the Alexa+ host, because the Alexa+ MCP toolkit was gated for entrants as of 2026-10-18. The voice line, the Claude brain, the Alexa skill, the spoken cue, and the AWS stack are built and tested against fixtures written from the docs, but none has run live yet. No real phone call has been placed. The [README table](../README.md#what-is-real-and-what-is-simulated) lists each piece with its evidence.

## Inspiration

Every household has calls nobody wants to make. The plumber. The dentist. The insurance company. Assistants can act through services that have an API, but many local errands still end in a phone call to a business. We wanted Alexa to make that call, and to report honestly what happened on it.

## What it does

This section describes the design. The demo runs all of it against a simulated business.

Start with a call that does not book. At the read-back, the plumber answers "Yes, plus parts." Ambient does not treat that as a yes. It says "Sorry, I need one total price. What is the total with parts?" In another demo call, a dental office answers every read-back with "Probably, let me check with my manager." After three read-backs the call ends, and the outcome reads "unconfirmed. Bright Smile Dental never clearly confirmed it". Nothing is booked in either case.

The plumber call then succeeds. After the plumber answers "Yes, that's right. See you then." to a second read-back, Alexa reports "Joe's Plumbing confirmed Tuesday the 20th at 10 am for one hundred sixty dollars."

Ambient can also call around. "Get quotes from plumbers to fix the kitchen sink, under 150" asks once, then calls three businesses at the same time. Each quote appears on the Echo Show as it arrives. In the demo the cheapest plumber speaks Spanish. Ambient discloses that it is an AI in Spanish, reads the price and time back in Spanish, and books on "Sí, correcto." The owner reads the English on the Show. Ambient books the cheapest quote under the limit through that call's read-back and thanks the other two businesses. A pick within the limit is never recorded as the owner's approval.

Every booking keeps its proof: the full read-back the business heard and the reply that booked it, each with its time. The booked card quotes both lines. In the simulator, "Hear them say yes" replays them. A live call does not record audio yet.

If a call ends without a booking, the owner says "call them again". Ambient redials the same business with the original job, and never redials a call that booked or one that is still going.

You ask Alexa to call a business for the household. An AI agent makes the call. Its first words are an AI disclosure: "Hi, this is an AI assistant calling for Maya. This call is transcribed." If the business cuts it off, the agent says it again before anything else.

The agent negotiates within a spending limit you set. When the business quotes over the limit, the agent puts the call on hold and asks you. The question reaches Echo devices as a spoken announcement and a notification. It also reaches the Echo Show as an MCP App card with "Book $180", "Offer $150" (your limit), and "Decline". If the business counters, the card asks you again before anything is booked. You can steer the call by voice at any point: "Alexa, tell Ambient offer one sixty."

Before the agent books, it reads the total and the time back to the business word for word. The read-back counts only after it has fully played. The agent books only if the reply is made entirely of agreement words and the exact terms it read back. A qualifier such as "plus parts", any other number or day, or any question sends the call back to negotiation. A dropped line is always unconfirmed.

After the call, Alexa reports only what the business confirmed. If the business agreed a day but gave no calendar date, the card says so. Each call is stored in SQLite. The next call to the same business starts with what the last one learned.

## What a pilot measures

No pilot has run, so we have no results. The numbers below are targets. We chose them before any pilot, and we picked them to be conservative. A pilot would track four measures:

- Calls placed per household per week. Target: at least 1.
- The share of calls that end confirmed. Target: at least 50%.
- The share of calls where the owner was asked. Target: at most 50%. A higher share would mean the owner's limits sit below what local businesses quote.
- The share of read-backs the reducer refused. Target: 100% of the read-backs whose reply carries a qualifier, a new number, or a question, checked by reading every pilot transcript.

**Pilot protocol (a plan, not a result).** The owner recruits 5 households. Each household places 3 real calls, each to a different kind of business line, for example a plumber, a vet, and a repair shop. That gives 15 calls. The owner reads every transcript and the final Alexa report for each call. Any one of these counts as a failure:

- A booking the owner did not approve.
- A call where the AI disclosure was not the first thing the business heard.
- A "confirmed" report that the business did not confirm in the transcript.

One failure of any kind means the pilot did not pass. The team fixes the cause and adds a regression test before the next call. This protocol needs the live voice line, which has not run yet.

## Calls Ambient will not make

This table lists only what the code enforces today.

| Call | What the code does | Where |
|---|---|---|
| An emergency or crisis short code such as 911, 988, 112 or 999 | `parsePhoneNumber` rejects it as "Not a phone number". It accepts only 10 digits, 11 digits that start with 1, or a `+` number of 8 to 15 digits. | `src/calls/types.ts` |
| A premium-rate number, 1-900 or 1-976 | `blockedNumber` refuses it, and the caller checks it before dialing. The call ends with no deal. The check covers `+1` numbers only. | `src/calls/rules.ts`, `src/runtimes/caller.ts` |
| More than 3 calls to one number, or more than 20 calls in total, in 24 hours | `checkDialLimits` refuses the call. It applies on real lines and counts calls still in progress. | `src/calls/rules.ts`, `src/runtimes/caller.ts` |
| An unknown business found by search, without the owner's approval | The caller asks "Call them?" and dials only after the owner answers once. When it calls around, one question names every business: "I found Pete's Pipes, Drain Bros and Rapid Rooter. Call all three and book the best quote under your limit?" A number the owner gives is dialed directly. | `src/runtimes/caller.ts` |
| A business that asked not to be called | A line such as "take us off your list" or "don't call us with an AI" ends the call with no booking, and Ambient never dials that number again. | `src/calls/rules.ts`, `src/calls/session.ts`, `src/runtimes/caller.ts` |

Phone trees are not handled yet.

## What it does not do

- It does not navigate phone trees.
- It does not wait in a hold queue for an agent.
- It handles one business per call.
- It speaks English only.
- It cannot use a live phone line without paid telephony.
- Cost per call is not measured. The AssemblyAI pricing page, as recorded in `docs/plans/2026-10-18-handle-the-call/reference-assemblyai.md` on 2026-10-18, lists the Voice Agent API at $0.075 per minute, billed per second of connected time. Our own LLM cost is on top, and the repo records no price for it. The cost of one call depends on its length, the number of Claude turns, and the Claude token counts. None of these has been measured on a live call.

## Who this is for

People who put off calls. In a 2023 US survey for weBoost, 47% of Gen Z said they feel anxious when they see someone is calling them ([report, PDF](https://assets.wilsonelectronics.com/m/3788b144e055bd3f/original/weBoost-Good-Call-Survey-Full-Report-Presentation.pdf)). The errand still has to happen: a plumber, a vet, a repair shop.

Small businesses are hard to reach by phone. Invoca analyzed 70 million tracked inbound calls and classified 44% as missed, meaning they never reached a person ([Invoca Lead Conversion Benchmarks Report 2026, as summarized by JustCall](https://justcall.io/blog/missed-call-statistics.html)). The data comes from businesses that pay for call tracking, so JustCall notes the true rate is probably higher. The call code plans for that. While the owner decides, the agent speaks a hold line every 15 seconds. After 90 seconds without an answer from the owner, it ends the call unconfirmed. After three unanswered read-backs, or five in all, it also ends unconfirmed. The code never redials by itself. The owner can say "call them again" to redial with the original job.

Ambient is also for anyone who cannot easily make a call: a parent holding a baby, a person with a speech or hearing difficulty, an older adult who finds phone menus hard. In a 2024 US survey of adults with hearing loss, 54% said they had difficulty communicating over the phone because of it ([Statista Research Department](https://www.statista.com/statistics/1550270/hearing-loss-barriers-us-adults), page fetched on 2026-10-19). The CDC reports that 26.8% of US adults aged 65 and over had some difficulty hearing in 2019, even with a hearing aid ([NCHS Data Brief 414](https://www.cdc.gov/nchs/products/databriefs/db414.htm)).

A home service is the first call a household would hand to Alexa. The call is short and has two outcomes, a time and a price. The agent can read both back to the business word for word, and the owner can set a limit on the price.

The household keeps the decision. Ambient never agrees to more than the owner allowed without asking first.

This document describes one call: a plumber who quotes a time and a price. We claim only what the demo calls show. A real launch would start with one category, home repair, where a call usually ends in a time and a price.

## Consent and the law

Ambient is designed to be the honest kind of AI call. Its first sentence says it is an AI assistant calling for a named person, and that the call is transcribed. It repeats this if the business cuts it off. It places one call per request from the owner, with limits of three calls per number and twenty calls per day. It never gives card or account numbers.

The US FCC ruled on 8 February 2024 that the TCPA's rules for "artificial or prerecorded voice" calls cover AI-generated voices ([HWG summary](https://hwglaw.com/2024/02/08/fcc-issues-declaratory-ruling-prohibiting-the-use-of-ai-generated-voice-in-robocalls/)). We have not had a legal review. A public launch needs one, covering the TCPA, state call-recording consent laws, and AI-disclosure laws.

## How we built it

One pure function owns the call: `step(state, input, now)` in `src/calls/session.ts`. It has no clock, no network, and no model inside it. Every honesty rule is a table test against it. A seeded property test plays 4,000 generated calls with mixed event orders and checks that every booking followed a clean yes to a fully played read-back of that exact amount. A labelled corpus of 192 business replies pins what counts as a yes.

The surfaces are an MCP server on `/mcp` (spec 2025-11-25, Streamable HTTP), a custom Alexa skill on `/alexa`, an MCP App card `ui://ambient/task`, and a browser simulator on `/sim` that is a real MCP client over loopback.

The voice line is the AssemblyAI Voice Agent API. Its LLM is our own endpoint, `/call/<id>/v1/chat/completions`. That endpoint passes each business turn into the reducer and streams back only what the reducer says. The brain behind the shim is Claude (`claude-opus-5-5`) through the Anthropic API. The honesty rules therefore hold on the real voice line too.

There is no phone dial-out in this version. AssemblyAI cannot dial out, and a paid Twilio account was not funded. The business answers on a web link that a phone browser opens like an incoming call.

The first commit in the git history is dated 2026-09-16. The repo does not record the hackathon start date. The repo began as an agent-supervision bridge for Alexa+. We kept its engine, MCP surface, and Alexa endpoint, and gave them the calling job.

What is real today: the full call runs end to end in the zero-key demo and through `/mcp` (`pnpm smoke:mcp`), with the business simulated. What is built but not yet run live: the AssemblyAI line, the Alexa skill, the spoken cue, and the CDK stack. No real phone call has been placed. No AWS deployment exists. Call latency is not measured. The skill has not run on an Echo Dot. The README carries the same list as a table.

## Challenges

No dial-out. AssemblyAI's voice path cannot place calls, and Twilio was not funded. The business answers on a web link instead of a ringing phone.

An undocumented wire format. The request AssemblyAI sends to a bring-your-own LLM endpoint is not documented. Our shim reads every user message defensively and streams OpenAI-shaped chunks back.

An honest "confirmed". Free-text price parsing leaked: an agent's own offer once counted as the business's confirmation, and a street address once parsed as the price. We deleted the parser. The reducer now reads the terms back and books only on a clean yes.

Alexa cannot speak free text unprompted. Proactive Events speaks a fixed template only after the user asks. Voice Monkey is the only spoken cue, so the cue is a Voice Monkey announcement plus a notification.

A gated toolkit. The Alexa+ MCP toolkit and simulator were gated as of 2026-10-18. We built our own MCP host on `/sim` to verify the contract end to end.

## Accomplishments

The honesty rules live in a pure reducer, not in a prompt. Five test files enforce them: `test/call-session.test.ts`, `test/call-honesty.test.ts`, `test/read-back-replies.test.ts`, `test/call.test.ts`, and `test/caller.test.ts`. They include the 4,000-call property test and the 192-reply corpus. The rest of the suite covers voice, Alexa, and security.

To count the tests, run `pnpm exec vitest list test/call-session.test.ts test/call-honesty.test.ts test/read-back-replies.test.ts test/call.test.ts test/caller.test.ts | grep -c "test/"` for the five files, and `pnpm exec vitest list | grep -c "test/"` for the whole suite.

Three adversarial reviews of the reducer and repeated structural review rounds, all by AI reviewers, tried to break the rules and the voice line. Each round is logged in the [progress log](../progress.md). Every defect they reproduced is now a regression test. When a round showed that price parsing would always leak, we replaced it with a read-back instead of patching it.

The demo needs no keys and no accounts. `pnpm install && pnpm demo` runs a full call in the browser, and `pnpm smoke:mcp` drives the same call through `/mcp`.

## What we learned

Honesty belongs in a state machine. Prompt-level instructions leaked under review. A pure reducer with property tests did not.

MCP elicitation has sharp edges. Inside a tool call, it reaches the client only on an SSE response tied to that request, and otherwise hangs with no error. The reproduction is in `docs/friction-log.md`.

The approval card should lead with the stake. "$180 · Tuesday the 20th at 10 am" told the owner more than any sentence we wrote.

## What's next

Run the AssemblyAI line against the live API and measure the time to the first word on a real call.

Deploy the custom skill to a public HTTPS host and run it on a real Echo Dot and Echo Show.

Deploy the prepared CDK stack (EC2, Secrets Manager, Elastic IP, auto-TLS) once AWS spend is approved.

A funded Twilio account would restore the moment when a real phone rings.

## Feedback for the tool makers

Product feedback for each tool is in [`docs/product-feedback.md`](product-feedback.md). Reproducible friction entries, each with a severity, are in [`docs/friction-log.md`](friction-log.md).

## Built with

Alexa Skills Kit (custom skill, en-US and en-GB interaction models, request signature verification). ASK Proactive Events. Voice Monkey. MCP TypeScript SDK 1.30, spec 2025-11-25, Streamable HTTP. MCP Apps (`ui://ambient/task`). AssemblyAI Voice Agent API. Claude `claude-opus-5-5` through the Anthropic API. Node 22.13 or later, and TypeScript. node:sqlite. Vitest. AWS CDK (stack synthesized, not deployed). pnpm.
