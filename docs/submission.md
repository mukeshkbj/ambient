# Devpost submission text — Ambient

> Draft for copy-paste into Devpost. Each section notes the judging criterion
> it primarily serves (Technical Implementation · Design · Potential Impact ·
> Quality of the Idea). Submit only what's verified in `acceptance.md`.

## Inspiration

AI agents now run for minutes or hours — coding, booking, deploying — and they
keep hitting decisions only a human can make. But they report to a chat
window, and nobody watches a chat window while making dinner.

Alexa already lives in the room. The insight: Alexa shouldn't *be* the agent —
it should *supervise* them. Ambient turns Alexa into the ambient supervisor
for a whole fleet of personal agents: they work in the background, and she
speaks up only when they need you.

*(Quality of the Idea — a supervision layer, not another assistant.)*

## What it does

- **Delegate by voice:** "Alexa, have my agent book Lupa for Saturday." The
  agent works in the background; the task card shows live steps.
- **Approval elicitation:** when the agent wants to spend money or deploy,
  Alexa asks — "Your agent wants to charge a $40 deposit. Approve once or
  deny?" — and holds the action until you answer, through a real MCP
  `elicitInput` round-trip.
- **Honest state:** if an agent's host dies mid-run, Alexa says "it
  disconnected before confirming — I won't retry it" instead of guessing. An
  `unknown` run is a first-class status, not an error path.
- **Needs-you feed:** a live attention ring across devices — Echo Show, Fire
  TV, mobile, voice-only — driven by events, not polling.
- **Briefing:** "What did my agents get done today?" — one spoken digest
  across every runtime.
- **Every device:** the same MCP response adapts to `deviceClass` — a task
  card on a display, a spoken answer on voice-only.

*(Design + Potential Impact — supervision UX that works on every Alexa form
factor, built for the multi-agent world that's arriving.)*

## How we built it

- **Self-hosted MCP server** (`src/mcp.ts` on `@modelcontextprotocol/sdk`
  1.30): spec **2025-11-25**, Streamable HTTP, sessions, `elicitInput`
  approval elicitation, `ui://ambient/task` MCP App resources.
- **Simulated Alexa+ host** (`/sim`): a real MCP `Client` on loopback — not a
  mock — with Web Speech in/out, a device switcher (Echo Show 8/15, Fire TV,
  Mobile, Voice-only), SSE needs-you feed, and an MCP Apps iframe host.
- **Runtimes:** Amazon **Bedrock Converse** (Nova tool loop with
  approval-gated tools and transcript persistence), Hermes (WS JSON-RPC),
  OpenClaw (protocol v4), and a deterministic zero-credential demo agent for
  judge runs.
- **Voice layer** (`src/voice.ts`): every spoken string passes a golden
  corpus that regex-rejects ids — speech never contains a UUID.
- **Persistence:** `node:sqlite` for conversations, runs, approvals,
  transcripts.
- **Security:** origin/host allowlists, DNS-rebinding protection, session
  eviction, and Alexa signature + timestamp verification (s3-pinned cert
  chain, SAN `echo-api.amazon.com`, RSA-SHA256 over the raw body).
- **AWS (pending deploy):** CDK + EC2 + Secrets Manager + ACM for the TLS
  deployment; Bedrock for the agent runtime and (optionally) utterance→tool
  routing in the sim.
- **Quality:** 87 tests, typecheck + ESLint + knip + CI workflow, `pnpm demo`
  to a working sim in under a minute with zero credentials.

*(Technical Implementation — a real standards server with adapters over four
genuinely different agent protocols.)*

## Challenges

- **In-call elicitation over HTTP:** a JSON-response transport can never
  deliver a server→client request, so approvals ride the POST's SSE stream —
  and two concurrent elicitations race. We serialize eliciting calls and push
  refreshes on run events instead (see `docs/friction-log.md`).
- **Honest approvals:** a run can finish while its approval ack is in flight;
  naive state machines overwrite the terminal state. The engine reconciles
  pending approvals against runtime snapshots after reconnects.
- **Replay gaps:** live event streams can skip sequences; the engine detects
  gaps and marks affected runs `unknown` rather than inventing outcomes.
- **Four protocols, one model:** WS JSON-RPC, OpenClaw v4 frames, the Bedrock
  Converse tool loop, and a scripted timer agent all map onto one
  discriminated `AssistantEvent` union — the wire names live inside each
  adapter and nowhere else.

*(Technical Implementation.)*

## What's next

- **Alexa+ add-on certification** as a first-class agent surface (the MCP
  server is already built to the required spec).
- **Agent categories** in the directory: travel, home, finance — so Alexa can
  name-check the right agent by domain.
- **MCP Tasks** augmentation for long-running work as the spec matures.
- **Multi-household policies:** per-member approval scopes for shared homes.

*(Quality of the Idea + Potential Impact.)*

## Media checklist

- [ ] Demo video ≤ 3:00 (public YouTube, English, no third-party music/trademarks)
- [ ] `docs/media/sim-needs-you.png` — attention ring
- [ ] `docs/media/sim-approved.png` — approval card resolved
- [ ] `docs/media/sim-echo-show-8.png`, `sim-echo-show-15.png` — displays
- [ ] `docs/media/sim-fire-tv.png`, `sim-mobile.png`, `sim-voice-only.png` — every class
- [ ] Architecture SVG in README

## Honest limits (state plainly in "What's next" or Q&A)

- Bedrock adapter needs AWS credentials and a Nova-capable region — its
  receipt is marked blocked in `acceptance.md`, not faked.
- Hermes/OpenClaw need their gateways reachable; the deterministic demo agent
  exists precisely so judges need nothing.
- Deployment to AWS is prepared (CDK devDeps, `docs/deployment.md`) but was
  held for the account owner — local run is fully verified.
