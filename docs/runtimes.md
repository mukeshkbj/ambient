# Assistant runtimes

Ambient is a gateway: one authenticated MCP endpoint + Alexa skill in front of
whatever personal assistants you can actually reach. Each runtime is an entry in
`runtimes.json` (`AMBIENT_RUNTIMES_FILE`, default `$AMBIENT_DATA_DIR/runtimes.json`)
naming an **adapter**, an **endpoint**, and a **tokenEnv** — the environment
variable that holds the credential. Secrets never live in the runtime file.

```json
{ "id": "muse", "label": "Muse", "kind": "cloud", "adapter": "muse",
  "tokenEnv": "META_MODEL_API_KEY", "options": { "model": "muse-spark-1.1" } }
```

`options` is a string map for per-adapter settings (`model`, `to`, `pollMs`,
`timeoutMs`, …). Verify any runtime end-to-end with:

```bash
pnpm check:runtime <id-or-name>     # handshake → trivial prompt → verdict JSON
```

## Adapter matrix

| Adapter | Assistant | Transport | Sessions | Steer | Cancel | Approvals | Resume | Class |
|---|---|---|---|---|---|---|---|---|
| `hermes` | Hermes gateway | WS JSON-RPC (v0.21) | yes | yes | yes | yes | yes | realtime |
| `openclaw` | OpenClaw gateway | WS protocol v4 | yes | yes | yes | yes (exec) | yes | realtime |
| `grokbot` | Grok Bot (`sand` host) | HTTP `POST /api/<cmd>` | yes (agents) | yes | yes | no | yes | async (poll) |
| `muse` | Muse Spark model | HTTPS chat completions | yes (in-memory) | no | yes | no | thread label only | realtime |
| `townie` | A Val Town val | HTTPS `POST /v1/run/{val}` | no | no | no | no | no | realtime |
| `instinct` | Instinct email | HTTPS Gmail send + poll | no | no | no | no | no | async (minutes) |

Capabilities are reported per runtime in `list_assistants` and `/healthz`;
unsupported controls fail with a clear error instead of pretending.

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
`approval.resolve`. Needs a reachable self-hosted gateway (default `:18789`) and
an operator token. Pin the gateway version you validated; older gateways may
reject protocol v4.

## Grok Bot (`grokbot`)

**Unofficial.** Talks to the Grok Bot host's `sand` gateway: `POST
{endpoint}/api/<command>` with a bearer token (default port `1340`, token in
`sand-data/gateway.json`). Commands used: `listAgents`, `createAgent`,
`sendPrompt`, `interruptAgentRun`, `getAgentTranscriptTail`, `getHostStatus`.
Agents are durable sessions; follow-up prompts are steering; completion is
detected by polling the transcript tail until a new assistant entry stabilizes
(`options.pollMs`, default 2 s) or `options.timeoutMs` (default 10 min) hits.
The gateway is a private host surface — reach it over LAN, tailnet, or an SSH
tunnel, never the public internet. Host updates can change command names; if a
call fails the run fails with the gateway's own error.

## Muse (`muse`)

The consumer Muse assistant has no public API, so this adapter drives **Muse
Spark** — the model that powers Muse — through the Meta Model API
(`https://api.meta.ai/v1`, OpenAI-compatible, key via `tokenEnv`). Each Ambient
conversation is an in-memory message thread: follow-ups keep context, but a
server restart resumes the thread empty (the label persists, the transcript
does not). `options.model` defaults to `muse-spark-1.1`. No approvals — a Muse
Spark reply can't ask for one — and no mid-run steering.

## Townie (`townie`)

The first-party Townie chat UI is not publicly drivable. This adapter uses the
documented Val Town API instead: `endpoint` is a val run URL
(`https://api.val.town/v1/run/<user>.<val>`), and the prompt arrives as a single
argument `{ "prompt": "…" }`. Townie itself is an open-source val — deploy your
own fork (or any prompt-accepting val) and point the endpoint at it. `tokenEnv`
is a Val Town API token. Calls are stateless: `sessions` is honestly `false`,
and a run completes when the HTTP call returns.

## Instinct (`instinct`)

Instinct's documented async surface is its **email channel**: send it a task and
it replies later. The adapter sends through the Gmail API
(`users.me.messages/send`) and polls `users.me/messages` for a reply containing
the `[ambient:<sessionId>]` subject tag (`options.pollMs` default 15 s).
`options.to` is your Instinct address (`<you>@mail.instinct.com`); `tokenEnv` is
a Google OAuth access token with `gmail.send` + `gmail.readonly`. Replies take
minutes — `asyncClass: "async"`, default `timeoutMs` 30 min, after which the run
fails with "outcome is unknown". Cancelling can't unsend email, so cancel is
unsupported. A short-lived OAuth token is enough for a demo; for production,
put a token-refresh wrapper in front or use a service account with delegated
mail.

## Adding an assistant

Implement `AssistantClient` (`src/runtimes/types.ts`), register a factory in
`ADAPTERS` in `src/runtimes/registry.ts`, and be honest in `capabilities` —
the engine surfaces unsupported controls as clear errors and unreachable hosts
as `offline`/`unknown` automatically.
