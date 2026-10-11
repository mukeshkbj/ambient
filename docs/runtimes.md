# Assistant runtimes

Ambient is a gateway: one authenticated MCP endpoint + Alexa skill in front of
whatever personal assistants you can actually reach. Each runtime is an entry in
`runtimes.json` (`AMBIENT_RUNTIMES_FILE`, default `$AMBIENT_DATA_DIR/runtimes.json`)
naming an **adapter**, an **endpoint**, and a **tokenEnv** — the environment
variable that holds the credential. Secrets never live in the runtime file.

```json
{ "id": "nova", "label": "Nova", "kind": "cloud", "adapter": "bedrock",
  "options": { "model": "us.amazon.nova-lite-v1:0", "region": "us-east-1" } }
```

`options` is a string map for per-adapter settings (`model`, `region`,
`maxTurns`, `speedMs`, `timeoutMs`, …). Verify any runtime end-to-end with:

```bash
pnpm check:runtime <id-or-name>     # handshake → trivial prompt → verdict JSON
```

## Adapter matrix

| Adapter | Assistant | Transport | Sessions | Steer | Cancel | Approvals | Resume | Class |
|---|---|---|---|---|---|---|---|---|
| `bedrock` | Amazon Nova via Bedrock | Converse API | yes (transcript-persisted) | yes | yes | yes (tool gates) | yes | realtime |
| `hermes` | Hermes gateway | WS JSON-RPC (v0.21) | yes | yes | yes | yes | yes | realtime |
| `openclaw` | OpenClaw gateway | WS protocol v4 | yes | yes | yes | yes (exec) | yes | realtime |
| `demo` | Scripted agent | none | yes | yes | yes | yes | yes | realtime |

Capabilities are reported per runtime in `list_assistants` and `/healthz`;
unsupported controls fail with a clear error instead of pretending.

## Bedrock (`bedrock`)

A real agent runtime on Amazon Bedrock. The Converse tool-use loop runs
in-process: the model calls `web_search`, `reservation_search`,
`reservation_book`, `calendar_list`, and `calendar_add`; tools that change
things (`reservation_book`, `calendar_add`) pause the loop on an
`approval.request` until `respondToApproval` answers — a denial returns an
error tool result so the model reports honestly instead of claiming success.
Transcripts persist in SQLite per durable session, so restarts keep context.
`options.model` defaults to `us.amazon.nova-lite-v1:0`; `options.region`
overrides `AWS_REGION`/`AWS_DEFAULT_REGION` (default `us-east-1`).
Credentials come from the standard AWS chain (`AWS_PROFILE`, env vars,
instance role) — nothing in the runtime file. Liveness is honest: the runtime
reports `offline` when no credential resolves. The bundled tool providers are
sample data (reservations, search) or local files (calendar); point them at
real services to go further.

## Hermes (`hermes`)

The original adapter. Point `endpoint` at a Hermes gateway WS URL plus
`tokenEnv` for its token, or use `connectorTokenEnv` for an outbound connector
(the assistant host dials out to Ambient — the runtime on this machine then
waits for that connection). The `HERMES_WS_*`/`CONNECTOR_TOKEN` env shorthand
defines one Hermes runtime without a file.

## OpenClaw (`openclaw`)

Speaks the documented Gateway WS protocol (v4): `connect.challenge` → `connect`
with role `operator` and scopes `operator.read operator.write operator.approvals`
→ `hello-ok`. Sessions via `sessions.create`/`sessions.list`/`sessions.resolve`,
prompts via `agent` + `agent.wait`, steering via `chat.send queueMode:"steer"`,
cancel via `sessions.abort`, exec approvals via `exec.approval.*` events and
`approval.resolve`. The adapter subscribes (`sessions.subscribe`,
`sessions.messages.subscribe`) for push events — a gateway that rejects
subscriptions still works through `agent.wait`. `options.requestTimeoutMs`
governs ordinary calls (default 30 s); `options.runTimeoutMs` governs
`agent.wait` (default 15 min). Needs a reachable self-hosted gateway (default
`:18789`) and an operator token. Pin the gateway version you validated; older
gateways may reject protocol v4.

## Demo (`demo`)

A scripted, deterministic agent with no network and no credentials — the
zero-setup path for judges, tests, and demos. Scripts are picked by keywords
in the instruction (or forced with `options.script`): a planner that searches
restaurants then pauses for a deposit approval, a research summary, a deploy
that simulates a disconnect (runs go `unknown`), and a failure. Step timing is
`options.speedMs` (default 1.2 s; tests use ~1 ms).

## Adding an assistant

Implement `AssistantClient` (`src/runtimes/types.ts`), register a factory in
`ADAPTERS` in `src/runtimes/registry.ts`, and be honest in `capabilities` —
the engine surfaces unsupported controls as clear errors and unreachable hosts
as `offline`/`unknown` automatically.
