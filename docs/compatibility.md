# Compatibility evidence

This file records observed contracts for the Hermes revision and Alexa tooling used by a deployment. Keep credentials and personal transcripts out of this file.

## Hermes

- Executable: command-resolved `hermes`, version `v0.21.0 (2026.8.31)`.
- Gateway URL: loopback WebSocket at `/api/ws`, authenticated with the installed gateway token.
- The installed v0.21.0 gateway accepts its legacy session token as `?token=` on this loopback WebSocket. The connector never exposes that URL beyond the private Hermes host; a non-loopback or public Hermes endpoint needs a header or short-lived ticket contract before it is enabled.
- Observed frames: `gateway.ready` is an `event` frame; `session.list` and `session.active_list` return a `{ "sessions": [] }` wrapper; active rows use `id` for the live handle and `session_key` for the durable session.
- The installed gateway advertises `heartbeat`, `change_events`, and `replay_epoch` in `gateway.ready`; `gateway.ping` returns `{ "ok": true }`.
- `session.events.stats` reports a replay ring with `max_per_session=512`. `session.events.since` returns `events`, `latest_seq`, `truncated`, `count`, and `epoch`; replay elements are bare event objects with `type`, `session_id`, `seq`, and `payload`.
- The adapter treats a rejected, malformed, epoch-mismatched, or truncated replay response as a recovery gap. It refuses partial history, marks affected work unknown, emits reconnect readiness only after the replay attempt finishes, and leaves the runtime unknown until session and approval discovery completes.
- During discovery, `approval.pending` is authoritative for each active session. Pending requests are re-projected by exact `request_id`; local requests absent from the snapshot are resolved locally and their waiting run becomes unknown because Hermes may have resolved them outside Ambient.
- `approval.pending` returns an `approvals` array, and approval payloads carry `request_id`, `command`, `description`, and `choices`. `approval.respond` accepts `session_id`, `choice`, and an optional `request_id`; the bridge always supplies the exact request identity and requires a positive `{ "resolved": <count> }` response before clearing it.
- Hermes can advertise `session` and `always` approval choices; the first Alexa surface intentionally exposes only `once` and `deny` until persistent grants have a separately verified voice confirmation flow.
- Sanitized live evidence is in `.audit/hermes-contract-2026-09-06.txt`; rerun it with `pnpm check:hermes-contract` against an authenticated gateway.
- Installed-source evidence is reproducible with `HERMES_SOURCE_ROOT=<hermes-agent-root> PYTHONPATH=<hermes-agent-root> python3 scripts/check-hermes-source-contract.py`; it is separate from the live WebSocket receipt.
- Local bridge evidence: `pnpm check:hermes`, `pnpm check:hermes-contract`, and the connector smoke path completed against the running gateway on 2026-09-06.
- No raw gateway frames or personal session data are committed; the sanitized live receipt is in `.audit/hermes-contract-2026-09-06.txt` and the probe is rerunnable with `pnpm check:hermes-contract`.

## Other adapters (contract-tested, live-verified where noted)

- **OpenClaw** — Gateway WS protocol v4. `connect.challenge` event → `connect` req
  with role `operator` and scopes `operator.read operator.write operator.approvals`
  → `hello-ok`. Verified against published TypeBox schemas: `sessions.create/send/
  list/resolve/abort`, `chat.send queueMode:"steer"`, `agent` → `{runId}` +
  `agent.wait`, `exec.approval.list`, `approval.resolve {id,kind,decision}`,
  `exec.approval.requested`/`session.approval` events. Contract-tested with a fake
  socket; live verification needs a self-hosted gateway + operator token.
- **Grok Bot** — unofficial `sand` host gateway (`POST /api/<command>`, bearer,
  default port 1340). Commands per the host's SAND_GATEWAY_COMMANDS surface:
  `listAgents`, `createAgent`, `sendPrompt`, `interruptAgentRun`,
  `getAgentTranscriptTail`, `getHostStatus`; `/health` and `/events` exist.
  Completion is poll-based. Not an official API — keep the gateway on LAN/VPN.
- **Muse** — `api.meta.ai/v1` OpenAI-compatible chat completions,
  `options.model` default `muse-spark-1.1` (the model behind consumer Muse —
  not the consumer product, which has no API). Threads are in-memory.
- **Townie** — Val Town `POST /v1/run/{user}.{val}`; the val receives one arg
  `{prompt}`. Live-verified against a mock endpoint via `pnpm check:runtime`.
  First-party Townie chat has no public API — point the endpoint at a deployed
  Townie-based val.
- **Instinct** — documented email channel: Gmail `users.me.messages/send` +
  `users.me/messages` poll for `[ambient:<sessionId>]` correlation. Async by
  design (minutes); cancel unsupported (email can't be unsent).

## Alexa host options

- Alexa+ MCP is the primary hackathon host. The self-hosted endpoint must negotiate MCP spec `2025-11-25` or newer; if preview access is unavailable, the rules permit a simulated Alexa+ experience in a web app.
- Record the Alexa+ client version, account stage, locale, device or simulator, exact negotiated MCP protocol version, and whether the interaction was live or simulated.
- The local bridge contract probe negotiated `2025-11-25` over Streamable HTTP and exposed all eight semantic tools; this proves the server-side protocol shape, not Alexa preview access or a deployed AWS endpoint.
- The standard Alexa custom skill route works on Alexa-enabled Echo devices and uses an Alexa request handler hosted on AWS or another public HTTPS service. It does not require an Alexa+ subscription and remains an optional daily-use route.
- Record the skill stage, account-linking configuration, locale, and Echo model or simulator if that route is tested.
- The current Alexa+ authentication guidance requires service discovery with `client_credentials`, user operations with authorization code plus PKCE S256, and does not support `WWW-Authenticate` headers. The bridge returns plain 401 JSON and serves the protected-resource metadata path.

## Open questions

- Whether delayed MCP results can be spoken in the same Alexa turn or require a follow-up.
