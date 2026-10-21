# Ambient: Alexa, handle the call

This file holds every field of the Devpost entry, in form order. Paste each field as it is. Before you submit, replace `[PUBLIC REPO URL]` and `[VIDEO URL]` everywhere in this file with one find-and-replace each.

## Form fields

| Field | Value |
|---|---|
| Project name | Ambient |
| Elevator pitch (200 characters) | Alexa hands a phone errand to an AI that must say it is an AI, stay under your price limit, and refuse "Yes, plus parts." 4,000 generated calls: no booking without a clean yes. |
| Track | Alexa+ |
| Video demo link | [VIDEO URL] |
| Try it out | [PUBLIC REPO URL] |
| Thumbnail | `docs/media/thumbnail.png`, the "+ parts" price struck through (3:2, from the launch film) |
| Built with (tags) | alexa-skills-kit, alexa-plus, mcp, model-context-protocol, claude, anthropic, assemblyai, typescript, node.js, sqlite, vitest, aws-cdk, pnpm |
| License | MIT (`LICENSE`) |
| Friction log | [PUBLIC REPO URL]/blob/main/docs/friction-log.md |
| Product feedback | [PUBLIC REPO URL]/blob/main/docs/product-feedback.md |

Gallery images, in this order, with these captions:

1. `docs/media/sim-card-hero.png`: "The plumber quotes $180 against a $150 limit. The call holds, and the Echo Show asks the owner."
2. `docs/media/sim-fool.png`: "Try to fool it. Type any answer to the read-back. 'Yes, plus parts.' does not book."
3. `docs/media/around-quotes.png`: "Three plumbers at once. Ambient books the cheapest quote under the limit."
4. `docs/media/call-business-ringing.png`: "The business side. The first words say that the caller is an AI."
5. `docs/media/sim-confirmed.png`: "Booked, with proof: the read-back and the reply that booked it, each with its time."
6. `docs/media/architecture.png`: "Alexa skill and MCP server, call reducer, voice line, Claude brain."

## About the project

Paste from here to the end of "Feedback for the tool makers" into the "About the project" field.

Ambient is an AI caller for the household that cannot lie for you and cannot be lied to. Alexa hands it a call to a business. It says first that it is an AI, spends only what the owner allows, books only on a clean yes to the exact price and time, and keeps that yes as proof.

| | State today |
|---|---|
| Runs now, with zero keys | The whole call, end to end: `pnpm demo` in a browser and `pnpm smoke:mcp` through the MCP server. The honesty rules hold across a seeded test of 4,000 generated calls and a labelled corpus of 192 business replies. |
| Simulated | The business, and the Alexa+ host. The Alexa+ MCP toolkit was gated for entrants as of 2026-10-18. |
| Built, not yet run live | The AssemblyAI voice line, the Claude brain, the Alexa skill, the spoken cue and the AWS stack. They are tested against fixtures written from the docs. There is no phone dial-out: the business answers on a web link that a phone browser opens like an incoming call. |

## Inspiration

Every household has calls nobody wants to make. The plumber. The dentist. The insurance company. Assistants can act through services that have an API, but many local errands still end in a phone call to a business. We wanted Alexa to make that call, and to report honestly what happened on it.

## What it does

You say "Alexa, ask Ambient to call Joe's Plumbing and book a visit to fix the kitchen sink, under 150." An AI agent makes the call. Its first words are "Hi, this is an AI assistant calling for Maya. This call is transcribed."

Three moments show the idea.

**It refuses a false yes.** Before it books, the agent reads the total and the time back to the business. At the read-back, the plumber says "Yes, plus parts." Ambient does not treat that as a yes. It says "Sorry, I need one total price. What is the total with parts?" It reads the terms back again and books only on "Yes, that's right. See you then." The reply books only if it holds agreement words and the exact terms that were read back. A qualifier, any other number or day, or a question sends the call back to the conversation. A dropped line is always unconfirmed.

A judge can play the business. In the simulator, the "Try to fool it" panel sends any typed answer to the read-back through the same call reducer, in English or Spanish. It shows whether Ambient would book and names the reason. For "Yes, plus parts." the reason is that it adds words that can change the deal.

**It asks you before it spends more.** The plumber quotes $180 against a $150 limit. The call holds, with a short hold line to the business every 15 seconds. The question reaches the Echo Dot as a spoken announcement, and the Echo Show as a card with "Book $180", "Offer $150" and "Decline". The plumber counters at $160, so the card asks again before anything is booked. On a Fire TV, the film pauses until the owner answers.

**It calls three plumbers at once, in two languages.** "Get quotes from plumbers to fix the kitchen sink, under 150" asks once, then calls three businesses at the same time. Each quote appears on the Echo Show as it arrives. In the demo the cheapest plumber speaks Spanish. Ambient discloses, reads back and books in Spanish, while the owner reads English on the Show. It thanks the other two businesses. A pick within the limit is never recorded as the owner's approval.

Everything else it does:

- **Proof of yes.** Every booking keeps the full read-back the business heard and the reply that booked it, each with its time. On a live call, "Hear them say yes" plays that moment from the call recording. In the simulator, which has no recording, the card speaks both lines.
- **A receipt for the business.** When a call books, the business's call page shows "Booked for Maya: $160 total, Tuesday the 20th at 10 am.", in the business's language.
- **"Don't call us" is final.** A business that says "take us off your list" is never called again.
- **Moving a booking.** "Alexa, move the plumber to Thursday" calls the business that Ambient last booked. The approved price carries over, and the new time books through the same read-back.
- **Calling again.** "Call them again" redials a call that ended without a booking. Ambient never redials a call that booked or one that is still going.
- **Honest reports.** Alexa reports only what the business confirmed. If the business agreed a day but gave no calendar date, the card says so.
- **Memory.** Each call is stored in SQLite. The next call to the same business starts with what the last one learned.

## Calls Ambient will not make

The code enforces each of these today:

- It refuses emergency and crisis short codes such as 911, 988, 112 and 999. A number must have 10 digits, 11 digits that start with 1, or a `+` and 8 to 15 digits.
- It refuses premium-rate numbers, 1-900 and 1-976.
- It places at most 3 calls to one number and 20 calls in total in 24 hours, in-progress calls included.
- It dials a business found by search only after the owner says yes. When it calls around, one question names every business.
- It never calls again a business that said "take us off your list" or "don't call us with an AI".

Phone trees are not handled yet.

## What it does not do

- It does not navigate phone trees.
- It does not wait in a hold queue for an agent.
- It calls at most three businesses at once, and only when the owner asks for quotes.
- It speaks English and Spanish. A Spanish call uses AssemblyAI's Spanish voice `lola` and Spanish speech recognition, and the business's call page is in Spanish. No live Spanish call has run yet.
- It cannot use a live phone line without paid telephony.
- The cost per call is an estimate, not a measurement: about 26 to 31 cents for the demo call. AssemblyAI is about 23 cents (three minutes at $0.075 per minute), and Claude Opus 5.5 is about 3 to 8 cents. The first live call will replace the estimate. The arithmetic is in the README: [PUBLIC REPO URL]/blob/main/README.md

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

The first commit in the git history is dated 2026-09-16. The repo began as an agent-supervision bridge for Alexa+. We kept its engine, MCP surface, and Alexa endpoint, and gave them the calling job.

## Challenges

No dial-out. AssemblyAI's voice path cannot place calls, and Twilio was not funded. The business answers on a web link instead of a ringing phone.

An undocumented wire format. The request AssemblyAI sends to a bring-your-own LLM endpoint is not documented. Our shim reads every user message defensively and streams OpenAI-shaped chunks back.

An honest "confirmed". Free-text price parsing leaked: an agent's own offer once counted as the business's confirmation, and a street address once parsed as the price. We deleted the parser. The reducer now reads the terms back and books only on a clean yes.

Alexa cannot speak free text unprompted. Proactive Events speaks a fixed template only after the user asks. Voice Monkey is the only spoken cue, so the cue is a Voice Monkey announcement plus a notification.

A gated toolkit. The Alexa+ MCP toolkit and simulator were gated as of 2026-10-18. We built our own MCP host on `/sim` to verify the contract end to end.

## Accomplishments

The honesty rules live in a pure reducer, not in a prompt. Five test files enforce them, including the 4,000-call property test and the 192-reply corpus. The rest of the suite covers voice, Alexa and security.

Every defect that review reproduced is now a regression test. When review showed that price parsing would always leak, we replaced it with a read-back instead of patching it.

The demo needs no keys and no accounts. `pnpm install && pnpm demo` runs a full call in the browser, and `pnpm smoke:mcp` drives the same call through `/mcp`.

## What we learned

Honesty belongs in a state machine. Prompt-level instructions leaked under review. A pure reducer with property tests did not.

MCP elicitation has sharp edges. Inside a tool call, it reaches the client only on an SSE response tied to that request, and otherwise hangs with no error. The reproduction is in the friction log: [PUBLIC REPO URL]/blob/main/docs/friction-log.md

The approval card should lead with the stake. "$180 · Tuesday the 20th at 10 am" told the owner more than any sentence we wrote.

## What's next

Run the AssemblyAI line against the live API and measure the time to the first word on a real call.

Deploy the custom skill to a public HTTPS host and run it on a real Echo Dot and Echo Show.

Deploy the prepared CDK stack (EC2, Secrets Manager, Elastic IP, auto-TLS) once AWS spend is approved.

A funded Twilio account would restore the moment when a real phone rings.

Run a small pilot: 5 households, 15 real calls, every transcript read. One booking the owner did not approve fails the pilot.

## Feedback for the tool makers

Product feedback for each tool: [PUBLIC REPO URL]/blob/main/docs/product-feedback.md. Reproducible friction entries, each with a severity: [PUBLIC REPO URL]/blob/main/docs/friction-log.md.
