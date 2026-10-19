# Ambient: Alexa, handle the call

Track: Alexa+

Demo video: [VIDEO URL]
Public repo: [PUBLIC REPO URL]

**What you can run today, and what is not live yet.** The whole call runs end to end with zero keys: `pnpm demo` in a browser, and `pnpm smoke:mcp` through the MCP server. In that demo the business is simulated, and so is the Alexa+ host, because the Alexa+ MCP toolkit was gated for entrants. The voice line, the Claude brain, the Alexa skill, the spoken cue, and the AWS stack are built and tested against recorded traffic, but none has run live yet. No real phone call has been placed. The [README table](../README.md#what-is-real-and-what-is-simulated) lists each piece with its evidence.

## Inspiration

Every household has calls nobody wants to make. The plumber. The dentist. The insurance company. Assistants can act through services that have an API, but most small businesses still answer a phone. We wanted Alexa to make that call, and to report honestly what happened on it.

## What it does

This section describes the design. The demo runs all of it against a simulated business.

You ask Alexa to call a business for the household. An AI agent makes the call. Its first words are an AI disclosure: "Hi, this is an AI assistant calling for Maya. This call is transcribed." If the business cuts it off, the agent says it again before anything else.

The agent negotiates within a spending limit you set. When the business quotes over the limit, the agent puts the call on hold and asks you. The question reaches Echo devices as a spoken announcement and a notification. It also reaches the Echo Show as an MCP App card with "Book $180", "Offer $150" (your limit), and "Decline". If the business counters, the card asks you again before anything is booked. You can steer the call by voice at any point: "Alexa, tell Ambient offer one sixty."

Before the agent books, it reads the total and the time back to the business word for word. The read-back counts only after it has fully played. The agent books only if the reply is made entirely of agreement words and the exact terms it read back. A qualifier such as "plus parts", any other number or day, or any question sends the call back to negotiation. A dropped line is always unconfirmed.

After the call, Alexa reports only what the business confirmed. Each call is stored in SQLite. The next call to the same business starts with what the last one learned.

## Who this is for

People who put off calls. In a 2023 US survey for weBoost, 47% of Gen Z said they feel anxious when they see someone is calling them ([report, PDF](https://assets.wilsonelectronics.com/m/3788b144e055bd3f/original/weBoost-Good-Call-Survey-Full-Report-Presentation.pdf)). The errand still has to happen: a plumber, a vet, a repair shop. Ambient is also for anyone who cannot easily make a call: a parent holding a baby, a person with a speech or hearing difficulty, an older adult who finds phone menus hard. The household keeps the decision. Ambient never agrees to more than the owner allowed without asking first.

The same reducer works for any business that answers a phone. A real launch would start with one category, home repair, where a call usually ends in a time and a price.

## Consent and the law

Ambient is designed to be the honest kind of AI call. Its first sentence says it is an AI assistant calling for a named person, and that the call is transcribed. It repeats this if the business cuts it off. It places one call per request from the owner, with limits of three calls per number and twenty calls per day. It never gives card or account numbers.

The US FCC ruled on 8 February 2024 that the TCPA's rules for "artificial or prerecorded voice" calls cover AI-generated voices ([HWG summary](https://hwglaw.com/2024/02/08/fcc-issues-declaratory-ruling-prohibiting-the-use-of-ai-generated-voice-in-robocalls/)). We have not had a legal review. A public launch needs one, covering the TCPA, state call-recording consent laws, and AI-disclosure laws.

## How we built it

One pure function owns the call: `step(state, input, now)` in `src/calls/session.ts`. It has no clock, no network, and no model inside it. Every honesty rule is a table test against it. A seeded property test plays 4,000 generated calls with mixed event orders and checks that every booking followed a clean yes to a fully played read-back of that exact amount. A labelled corpus of 192 business replies pins what counts as a yes.

The surfaces are an MCP server on `/mcp` (spec 2025-11-25, Streamable HTTP), a custom Alexa skill on `/alexa`, an MCP App card `ui://ambient/task`, and a browser simulator on `/sim` that is a real MCP client over loopback.

The voice line is the AssemblyAI Voice Agent API. Its LLM is our own endpoint, `/call/<id>/v1/chat/completions`. That endpoint passes each business turn into the reducer and streams back only what the reducer says. The brain behind the shim is Claude (`claude-opus-5-5`) through the Anthropic API. The honesty rules therefore hold on the real voice line too.

There is no phone dial-out in this version. AssemblyAI cannot dial out, and a paid Twilio account was not funded. The business answers on a web link that a phone browser opens like an incoming call.

The repo started on 2026-09-16, inside the hackathon window. It began as an agent-supervision bridge for Alexa+. We kept its engine, MCP surface, and Alexa endpoint, and gave them the calling job.

What is real today: the full call runs end to end in the zero-key demo and through `/mcp` (`pnpm smoke:mcp`), with the business simulated. What is built but not yet run live: the AssemblyAI line, the Alexa skill, the spoken cue, and the CDK stack. No real phone call has been placed. No AWS deployment exists. Call latency is not measured. The skill has not run on an Echo Dot. The README carries the same list as a table.

## Challenges

No dial-out. AssemblyAI's voice path cannot place calls, and Twilio was not funded. The business answers on a web link instead of a ringing phone.

An undocumented wire format. The request AssemblyAI sends to a bring-your-own LLM endpoint is not documented. Our shim reads every user message defensively and streams OpenAI-shaped chunks back.

An honest "confirmed". Free-text price parsing leaked: an agent's own offer once counted as the business's confirmation, and a street address once parsed as the price. We deleted the parser. The reducer now reads the terms back and books only on a clean yes.

Alexa cannot speak free text unprompted. Proactive Events speaks a fixed template only after the user asks. Voice Monkey is the only spoken cue, so the cue is a Voice Monkey announcement plus a notification.

A gated toolkit. The Alexa+ MCP toolkit and simulator were gated during the build. We built our own MCP host on `/sim` to verify the contract end to end.

## Accomplishments

The honesty rules live in a pure reducer, not in a prompt. 563 tests enforce them, including the 4,000-call property test and the 192-reply corpus.

Two reducer reviews and seven structural review rounds tried to break the rules and the voice line ([progress log](../progress.md)). Every defect they reproduced is now a regression test. When a round showed that price parsing would always leak, we replaced it with a read-back instead of patching it.

The demo needs no keys and no accounts. `pnpm install && pnpm demo` runs a full call in the browser, and `pnpm smoke:mcp` drives the same call through `/mcp`.

## What we learned

Honesty belongs in a state machine. Prompt-level instructions leaked under review. A pure reducer with property tests did not.

MCP elicitation has sharp edges. Inside a tool call, it reaches the client only on an SSE response tied to that request, and otherwise hangs with no error. The reproduction is in `docs/friction-log.md`.

The approval card should lead with the stake. "$180, Joe's Plumbing" told the owner more than any sentence we wrote.

## What's next

Run the AssemblyAI line against the live API and measure the time to the first word on a real call.

Deploy the custom skill to a public HTTPS host and run it on a real Echo Dot and Echo Show.

Deploy the prepared CDK stack (EC2, Secrets Manager, Elastic IP, auto-TLS) once AWS spend is approved.

A funded Twilio account would restore the moment when a real phone rings.

## Feedback for the tool makers

Product feedback for each tool is in [`docs/product-feedback.md`](product-feedback.md). Reproducible friction entries, each with a severity, are in [`docs/friction-log.md`](friction-log.md).

## Built with

Alexa Skills Kit (custom skill, en-US and en-GB interaction models, request signature verification). ASK Proactive Events. Voice Monkey. MCP TypeScript SDK 1.30, spec 2025-11-25, Streamable HTTP. MCP Apps (`ui://ambient/task`). AssemblyAI Voice Agent API. Claude `claude-opus-5-5` through the Anthropic API. Node 22.13 or later, and TypeScript. node:sqlite. Vitest. AWS CDK (stack synthesized, not deployed). pnpm.
