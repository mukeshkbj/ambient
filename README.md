# Ambient

Ambient is a personal-assistant gateway: one authenticated MCP endpoint — plus an
Alexa skill and an optional dashboard — in front of every assistant you can
actually reach. Delegate work to a Bedrock agent, steer Hermes, or watch a task
through — through one voice or chat surface.

```text
Alexa+ / any MCP client ─┐
Alexa custom skill ──────┤   authenticated Streamable HTTP
Ambient dashboard ───────┴──▶ Ambient
                                 │  RuntimeRegistry — one ConversationEngine per
                                 │  runtime over a shared SQLite store
                ┌────────────────┼─────────────────┬───────────────┐
          Bedrock agent    Hermes (WS)      OpenClaw (WS v4)   Demo agent
          (Converse API)        │
                          outbound
                          connector
```

Assistants keep their own tools, memory, sessions, and approval policy. Ambient
routes, tracks work honestly (`queued → accepted → running → completed/failed/
cancelled/unknown`), and reports per-runtime capabilities instead of faking
controls an assistant does not have.

## Quick start

Node 22.13+, pnpm. Zero credentials needed for the demo:

```sh
pnpm demo                    # scripted agent — no keys, no network
```

For a real agent, copy `runtimes.example.json` to `runtimes.json`, fill in
endpoints, and point each `tokenEnv` at a credential env var — secrets never go
in the file. Then:

```sh
AMBIENT_RUNTIMES_FILE=runtimes.json ALLOW_UNAUTHENTICATED=true pnpm dev
pnpm check:runtime hermes        # handshake → prompt → verdict, per runtime
MCP_URL=http://127.0.0.1:3000/mcp pnpm smoke:mcp
```

`docs/runtimes.md` documents each adapter's exact surface, required credentials,
and honest limits (Bedrock needs AWS credentials and a Nova-capable region;
Hermes and OpenClaw need their gateways; the demo agent is fully offline).

## MCP surface

Eleven neutral tools: `ask`, `get_work`, `list_assistants`, `select_assistant`,
`list_conversations`, `select_conversation`, `steer_work`, `cancel_work`,
`list_approvals`, `respond_to_approval`, and `dashboard` — a live MCP App
(assistant switcher, work feed, one-tap approvals) in hosts that support
`ui://` resources, and a full JSON snapshot everywhere else.

`ask` routes to the selected assistant or one named per call; a sticky default
is kept per server. Work and approval ids are exact and runtime-namespaced —
never guessed.

## Alexa

`POST /alexa` serves a custom skill with assistant-selection intents ("ask
my coding agent", "use Nova") and a sticky per-session default. Import
`alexa/interaction-model.en-GB.json`; see `docs/deployment.md`. OAuth account
linking is bundled for the single-owner case.

## Topology

The default deployment keeps assistants private: the bridge accepts an outbound
connector (per-runtime bearer + `x-ambient-runtime-id`) so a Hermes host never
needs a public listener. Cloud assistants use their own HTTPS endpoints. The CDK
stack provisions one EC2 bridge host (`pnpm infra:synth`, `docs/deployment.md`).

## Verification

```sh
pnpm scan            # typecheck + eslint + knip + tests
pnpm build
pnpm check:runtime <id>   # live reachability verdict per runtime
pnpm latency              # authenticated MCP latency, per tool
```

Evidence and open gates: `docs/acceptance.md`, `docs/compatibility.md`,
`docs/demo-runbook.md`, `docs/submission.md`.
