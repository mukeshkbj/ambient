# Submission notes

Ambient is an Alexa+ primary-track submission: it gives the Alexa+ MCP client —
and any other MCP host — a voice path to the owner's *whole fleet* of personal
assistants through one self-hosted, authenticated Streamable HTTP server.
Hermes, OpenClaw, Grok Bot, Muse Spark, a deployed Townie val, and Instinct's
email channel each appear as first-class runtimes with truthful capabilities;
Alexa (or the bundled MCP App dashboard) routes between them.

Why it matters: every assistant product ships its own silo. Ambient is the
inverse — a gateway the owner controls, where work tracking, approvals, and
honest "I don't know" outcomes are uniform across assistants with wildly
different APIs (WS JSON-RPC, OpenClaw protocol v4, an unofficial host gateway,
chat completions, val invocation, and email).

Differentiators to show:

- `list_assistants` → `ask` against two different assistants in one session.
- The `dashboard` MCP App: assistant switcher, live work feed, one-tap approvals.
- `pnpm check:runtime <id>` live-verifying a configured runtime in seconds.
- An approval raised by Hermes/OpenClaw answered by voice, cleared only on
  assistant confirmation.
- Instinct asked by email and its async reply landing in the work feed.

The final submission should claim only the acceptance cases recorded in
[acceptance.md](acceptance.md). Honest limits to state plainly: Grok Bot uses
its unofficial host gateway (LAN/tunnel only); "Muse" means Muse Spark via the
Meta Model API, not the consumer secure-VM product; Instinct is minutes-scale
asynchronous; Townie drives a deployed Val Town val, not the first-party chat UI;
unsupported controls error instead of pretending; local assistants are
unavailable while their host sleeps.
