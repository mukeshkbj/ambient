# Product feedback

One section per tool we used to build Ambient. Each section follows the hackathon's required fields: what we used it for, what worked, what needs work, onboarding, and whether we would build with it again. Where we could not reach a live service, the section says so. The matching failures, with reproduction steps, are in [`docs/friction-log.md`](friction-log.md).

## Alexa+ developer documentation and MCP integration guidance

- **Used it for:** the voice-first MCP tool surface in `src/mcp.ts` (`delegate`, `status`, `approve`, `stop`, `agents`, `briefing`). We wrote each tool description in the guide's "when and what" style. The device-class handling in the `/sim` host follows the guide's device list.
- **What worked:** the voice guidance turned into rules we can test. Speech leads with the outcome, uses at most two sentences, asks one question, and never reads an internal id. `test/voice.test.ts` enforces these rules on every reply.
- **What needs work:** the Alexa+ MCP toolkit, CLI, and web simulator were gated for hackathon entrants while we built. Three pages show three different MCP protocol versions (friction entry 3). The authentication page lists `WWW-Authenticate` as unsupported, but the MCP specification requires clients to parse it (friction entry 4). We built the `/sim` host as a stand-in. It is our own MCP client, so it cannot prove what Alexa+ renders.
- **Onboarding:** not measured. We read the public docs and applied them. The end-to-end path was not reachable, because the toolkit was gated.
- **Would we build with it again?** Yes. Elicitation and approvals are the right shape for an agent that needs a person's consent. We would want the toolkit open before the build starts.

## Alexa Skills Kit custom skill and request verification

- **Used it for:** the `/alexa` endpoint (`src/alexa.ts`) with call intents (start a call, steer it, offer an amount, approve or deny, status, hang up), the en-US and en-GB interaction models in `alexa/`, and request verification in `src/alexa-verify.ts` (certificate URL pinning, the `echo-api.amazon.com` SAN, the chain and signature checks over the raw body, and a 150-second timestamp window).
- **What worked:** the interaction model format is clear. The signature-verification contract is precise enough to implement and test offline with generated certificate chains (`test/security.test.ts`).
- **What needs work:** we have not registered the skill. Skill registration and an Echo Dot test need the owner's developer account and hardware. The endpoint is tested against recorded request shapes only.
- **Onboarding:** not measured. The console step has not run.
- **Would we build with it again?** Yes. A custom skill is the path we used to hold a multi-turn voice decision on an Echo Dot.

## ASK Proactive Events and Voice Monkey (the "needs you" cue)

- **Used it for:** `src/cue.ts`. When a call needs the owner, Ambient sends a Voice Monkey announcement (spoken on the Echo Dot) and a Proactive Events notification (the yellow ring), at most once per approval.
- **What worked:** both APIs are small. Each one is a single authenticated POST, and both are unit tested with recorded responses (`test/cue.test.ts`).
- **What needs work:** We did not find a first-party API that lets a skill speak to the household unprompted. Proactive Events shows a notification from a fixed schema, so the spoken cue depends on Voice Monkey, a third-party service. We could not confirm from the docs whether the console accepts an HTTPS `events.endpoint` for a non-Lambda skill; `reference-alexa.md` marks it UNVERIFIED. Neither API has run live, because both need the owner's tokens and an Echo device.
- **Onboarding:** not measured. Live setup has not run.
- **Would we build with it again?** Yes. The notification fits the moment; we would replace Voice Monkey with a first-party "announce to this household" API if Amazon offered one.

## MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.30.0)

- **Used it for:** the whole server and client: `McpServer`, `registerTool`, `registerResource`, `StreamableHTTPServerTransport`, `server.server.elicitInput`, and the `Client` with `StreamableHTTPClientTransport` that the `/sim` host and `scripts/smoke-mcp.ts` use over loopback.
- **What worked:** the SDK tracks the 2025-11-25 specification closely. Elicitation with form schemas, capability negotiation, `ui://` resources, and `Mcp-Session-Id` sessions all worked as specified. In-memory transports made elicitation round trips testable without a network.
- **What needs work:** `elicitInput` inside a tool call reaches the client only on an SSE response tied to that request. In the other modes the call hangs with no error and no log (friction entry 1, severity High). Because nothing failed loudly, the hang stayed in our code for seven days, from `5087aad` to `fd17fa9`.
- **Onboarding:** not measured.
- **Would we build with it again?** Yes. It is the practical way to ship a standards MCP server in TypeScript.

## MCP Apps (`ui://` task card)

- **Used it for:** `ui://ambient/task` in `src/task-view.ts`, the Echo Show card with the call's state, the over-limit decision, and the booked result. The card calls tools back through the host with `tools/call`, and it adapts to `hostContext.deviceClass`.
- **What worked:** the resource indirection keeps tool results small. The `ui/initialize` handshake is one round trip, and a card that calls tools through the host lets the owner approve on the screen.
- **What needs work:** Alexa's docs put `resourceUri` in the tool response. The MCP Apps specification puts it in the tool definition (friction entry 5). We emit it on the tool result only (`runResult` in `src/voice.ts`), as the Alexa docs say, and we cannot test which placement Alexa+ reads.
- **Onboarding:** not measured.
- **Would we build with it again?** Yes. A decision card next to the voice prompt is what makes the over-limit moment clear.

## Anthropic API and TypeScript SDK (`@anthropic-ai/sdk` 0.135)

- **Used it for:** the call brain in `src/calls/brain.ts` (`claude-opus-5-5`, streamed through `client.beta.messages.stream` with low effort, server-side fallbacks, and strict tools with eager input streaming) and business discovery in `src/calls/discover.ts` (the web search tool plus a strict `report_candidates` tool).
- **What worked:** strict tools gave us typed `ask_owner`, `end_call`, and `remember` steps, which the reducer can trust structurally. Streaming text deltas let the voice line start speaking before the turn ends. The brain is tested against a stubbed stream (`test/brain.test.ts`).
- **What needs work:** Structured discovery output goes through a strict `report_candidates` tool alongside the web search tool (`src/calls/discover.ts`). We have not run the brain live or measured time to first word, because that spends API money and waits for the owner's approval (`pnpm brain:latency` is ready).
- **Onboarding:** not measured. The SDK types made the beta features easy to find.
- **Would we build with it again?** Yes. The model can negotiate, and the strict tool calls are why a pure reducer can keep the honesty rules outside the model.

## AssemblyAI Voice Agent API

- **Used it for:** the voice line in `src/calls/rooms.ts` and `web/call/index.html`. Each call creates a stored agent whose greeting is the AI disclosure and whose LLM is our own `/call/<id>/v1/chat/completions` endpoint. The business's browser connects with a single-use token.
- **What worked:** bring-your-own-LLM lets our reducer decide every word the agent says. The greeting is spoken verbatim, which guarantees the disclosure comes first.
- **What needs work:** the request AssemblyAI sends to a bring-your-own LLM endpoint is not documented (friction entry 6, severity High). Two docs pages disagree on event field names (friction entry 7). A per-call greeting needs a new stored agent per call (friction entry 8). There is no documented delete, so we clear the agent's LLM settings when a call ends. AssemblyAI cannot dial out, so the business answers on a web link. The line is tested against recorded frames only; it has not run against the live API.
- **Onboarding:** not measured. Most of the effort went into working out the undocumented request shape.
- **Would we build with it again?** Yes. The bring-your-own-LLM design is the right one for agents that must control what they say. A real phone call would also need outbound calling.

## AWS CDK, EC2, and Secrets Manager

- **Used it for:** `infra/stack.ts`, a single EC2 instance in a public subnet, an IAM role, a Secrets Manager secret for the OAuth signing key, and an Elastic IP for a stable HTTPS endpoint.
- **What worked:** `pnpm infra:synth` synthesizes the stack with no AWS credentials, so we could review the template before spending anything. Keeping CDK in devDependencies keeps the judges' `pnpm install` light.
- **What needs work:** nothing is deployed. A deploy costs money and waits for the owner's approval. This machine has no AWS credentials, so we have not exercised account setup, regions, or deploy errors. We do not use Bedrock in this version; the call brain uses the Anthropic API directly.
- **Onboarding:** not measured. Deploy onboarding has not run.
- **Would we build with it again?** Yes. CDK in TypeScript keeps the deploy in the same language and the same review as the server.

## Twilio ConversationRelay (evaluated, not used)

- **Used it for:** nothing in the shipped code. It was the first choice for real outbound calls (`docs/plans/2026-10-18-handle-the-call/decisions.md`).
- **What worked:** the docs describe a clean text-in, text-out bridge to an LLM, which fits our reducer.
- **What needs work:** a trial account cannot run `<ConversationRelay>`, and the account also needs an AI features addendum. Real outbound calls therefore need a paid account from day one. We had no budget for it.
- **Onboarding:** not started.
- **Would we build with it again?** Yes. It is the shortest path to a real phone ringing, which our demo lacks. It needs a paid account.
