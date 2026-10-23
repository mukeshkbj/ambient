# Ambient: Alexa, handle the call

This file holds every field of the Devpost entry, in form order. Paste each field as it is. Before you submit, replace `[VIDEO URL]` everywhere in this file with one find-and-replace.

## Form fields

| Field | Value |
|---|---|
| Project name | Ambient |
| Elevator pitch (200 characters) | Alexa hands a phone errand to an AI that must say it is an AI, never spend past your limit without asking, and refuse "Yes, plus parts." 4,000 generated calls: no booking without a clean yes. |
| Track | Alexa+ |
| Video demo link | [VIDEO URL] |
| Try it out | https://github.com/mukeshkbj/ambient |
| Thumbnail | `docs/media/thumbnail.png`, the "+ parts" price struck through (3:2, from the launch film) |
| Built with (tags) | alexa-skills-kit, alexa-plus, mcp, claude, anthropic, assemblyai, typescript, node.js, sqlite, vitest, aws-cdk, pnpm |
| License | MIT (`LICENSE`) |
| Friction log | https://github.com/mukeshkbj/ambient/blob/main/docs/friction-log.md |
| Product feedback | https://github.com/mukeshkbj/ambient/blob/main/docs/product-feedback.md |

Gallery images, in this order, with these captions:

1. `docs/media/sim-card-hero.png`: "The plumber quotes $180 against a $150 limit. The call holds, and the Echo Show asks the owner."
2. `docs/media/sim-fool.png`: "Try to fool it. Type any answer to the read-back. 'Yes, plus parts.' does not book."
3. `docs/media/around-quotes.png`: "Three plumbers at once. Ambient books the cheapest quote under the limit."
4. `docs/media/call-business-ringing.png`: "The business side. The first words say that the caller is an AI."
5. `docs/media/sim-confirmed.png`: "Booked, with proof: the read-back and the reply that booked it, each with its time."
6. `docs/media/architecture.png`: "Alexa skill and MCP server, call reducer, voice line, Claude brain."

## About the project

Paste from here to the end of the file into the "About the project" field.

Ambient is an AI caller for the household. Alexa hands it a call to a business. It says first that it is an AI, never spends past the owner's limit without asking, books only on a clean yes to the price and time it read back, and keeps that yes as proof.

- **Runs now, with zero keys:** the whole call, end to end, in a browser (`pnpm demo`) and through the MCP server (`pnpm smoke:mcp`). The honesty rules hold across a seeded test of 4,000 generated calls and a labelled corpus of 192 business replies.
- **Simulated:** the business and the Alexa+ host. The Alexa+ MCP toolkit was gated for entrants as of 2026-10-18.
- **Built, not yet run live:** the AssemblyAI voice line, the Claude brain, the Alexa skill, the spoken cue and the AWS stack. There is no phone dial-out: the business answers on a web link that a phone browser opens like an incoming call.

The repo began on 2026-09-16 as an agent-supervision bridge for Alexa+. We kept its engine, MCP surface and Alexa endpoint. The calling job is new: the call reducer, the read-back, the voice line, the simulator and every honesty rule.

## Try it in one minute, no keys

Open https://github.com/mukeshkbj/ambient in GitHub Codespaces. It installs the project, starts the demo and opens `/sim`, and each judge gets a private copy. Or run it locally with Node 22.13 or later: clone the repo, then `pnpm install` and `pnpm demo`, and open http://127.0.0.1:3000/sim. Then type your own answer to the read-back in the "Try to fool it" panel.

## What it does

You say "Alexa, ask Ambient to call Joe's Plumbing and book a visit to fix the kitchen sink, under 150." Ambient's first words to the business are "Hi, this is an AI assistant calling for Maya. This call is transcribed."

**It refuses a false yes.** Before it books, Ambient reads the total and the time back to the business. The plumber says "Yes, plus parts." Ambient answers "Sorry, I need one total price. What is the total with parts?" It books only on a reply such as "Yes, that's right. See you then.": agreement words that do not add, change or question the terms it read back. A dropped line is always unconfirmed.

You can play the business yourself. In the simulator, the "Try to fool it" panel sends any answer you type through the same call reducer, in English or Spanish, and names the reason it books or does not.

**It asks you before it spends more.** The plumber quotes $180 against a $150 limit. The call holds. In the simulator, an Echo Show card asks the owner: "Book $180", "Offer $150" or "Decline". The plumber counters at $160, so the card asks again before anything is booked.

**It calls three plumbers at once, in two languages.** "Get quotes from plumbers to fix the kitchen sink, under 150" asks the owner once, then calls three businesses. In the demo the cheapest plumber speaks Spanish, so Ambient discloses, reads back and books in Spanish. A pick within the limit is never recorded as the owner's approval.

It also keeps the read-back and the reply that booked as proof, shows the business a receipt, never calls again a business that says "take us off your list", and can move or redial a booking on request.

## Limits

The code refuses emergency and crisis numbers (911, 988, 112, 999) and premium-rate numbers. It places at most 3 calls to one number and 20 calls in 24 hours. It never gives card or account numbers. It does not navigate phone trees or wait in hold queues. It cannot use a live phone line without paid telephony. The cost per call is an estimate of 26 to 31 cents, not a measurement.

## Consent and the law

The US FCC ruled on 8 February 2024 that the TCPA's rules for "artificial or prerecorded voice" calls cover AI-generated voices ([HWG summary](https://hwglaw.com/2024/02/08/fcc-issues-declaratory-ruling-prohibiting-the-use-of-ai-generated-voice-in-robocalls/)). We have not had a legal review. The disclosure says the call is transcribed, and AssemblyAI also records the voice session, so a public launch must say "recorded" and needs a review of the TCPA, state call-recording consent laws and AI-disclosure laws.

## How we built it

One pure function owns the call: `step(state, input, now)`. It has no clock, no network and no model inside it. Every honesty rule is a table test against it. The property test plays 4,000 generated calls with mixed event orders and checks that every booking followed a clean yes to a fully played read-back of that exact amount.

The surfaces are an MCP server on `/mcp` (Streamable HTTP), a custom Alexa skill, an MCP App card, and a browser simulator on `/sim` that is a real MCP client. On the voice line, AssemblyAI's Voice Agent API calls our own LLM endpoint. That endpoint passes each business turn into the reducer and speaks only what the reducer allows. Claude Opus 5.5 is the brain behind it. The reducer decides what may be said, so the rules do not depend on the model. The live voice line has not run yet.

## Challenges

Free-text price parsing leaked: an agent's own offer once counted as the business's confirmation, and a street address once parsed as the price. We deleted the parser and replaced it with a read-back. AssemblyAI cannot dial out, and Twilio was not funded, so the business answers on a web link. The Alexa+ MCP toolkit was gated, so we built our own MCP host to test the contract end to end.

## What we learned

Honesty belongs in a state machine. Prompt-level instructions leaked under review. A pure reducer with property tests did not. MCP elicitation inside a tool call reaches the client only on an SSE response tied to that request, and otherwise hangs with no error.

## What's next

Run the voice line against the live API and measure the time to the first word. Deploy the skill and run it on a real Echo Dot and Echo Show. Then a small pilot: 5 households, 15 real calls, every transcript read. One booking the owner did not approve fails the pilot.

Source: https://github.com/mukeshkbj/ambient. Friction log: [friction-log.md](https://github.com/mukeshkbj/ambient/blob/main/docs/friction-log.md). Product feedback: [product-feedback.md](https://github.com/mukeshkbj/ambient/blob/main/docs/product-feedback.md).
