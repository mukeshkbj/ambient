# Submission notes

Ambient is an Alexa+ primary-track submission: it gives the Alexa+ MCP client —
and any other MCP host — a voice path to the owner's *whole fleet* of personal
assistants through one self-hosted, authenticated Streamable HTTP server.
A Bedrock agent (Amazon Nova), Hermes, OpenClaw, and a zero-credential demo
agent each appear as first-class runtimes with truthful capabilities; Alexa (or
the bundled MCP App dashboard) routes between them.

Why it matters: agents run for minutes or hours and hit decisions that need a
human. Ambient is the gateway the owner controls, where work tracking,
approvals, and honest "I don't know" outcomes are uniform across assistants
with wildly different APIs (WS JSON-RPC, OpenClaw protocol v4, the Bedrock
Converse tool loop, and a scripted demo agent).

Differentiators to show:

- `list_assistants` → `ask` against two different assistants in one session.
- The `dashboard` MCP App: assistant switcher, live work feed, one-tap approvals.
- `pnpm check:runtime <id>` live-verifying a configured runtime in seconds.
- An approval raised by the agent answered by voice, cleared only on
  assistant confirmation.
- A runtime disconnect marking in-flight work `unknown` instead of guessing.

The final submission should claim only the acceptance cases recorded in
[acceptance.md](acceptance.md). Honest limits to state plainly: the Bedrock
adapter needs AWS credentials and a Nova-capable region, and its bundled tools
are sample providers; Hermes and OpenClaw need their gateways reachable;
unsupported controls error instead of pretending; local assistants are
unavailable while their host sleeps.
