# Hermes Ambient

Hermes Ambient is a small authenticated MCP bridge that lets Alexa+ reach one configured Hermes runtime. It keeps Hermes responsible for tools, memory, sessions, and approvals while exposing a narrow voice-friendly control surface.

The default deployment keeps Hermes on the owner's computer or server. A local connector opens the only outbound connection to the bridge, so the Hermes gateway does not need a public listener. A separate deployment can point the same bridge process at a deliberately configured cloud Hermes runtime with `HERMES_RUNTIME_KIND=cloud`; the two environments do not share credentials or session files and the bridge never fails over between them.

## Local proof

Use Node 24 or newer and pnpm. Confirm the installed Hermes gateway first:

```sh
HERMES_WS_URL=ws://127.0.0.1:9129/api/ws \
HERMES_WS_TOKEN="$HERMES_GATEWAY_TOKEN" \
pnpm check:hermes
```

For a direct development bridge, set `HERMES_WS_URL`, `HERMES_WS_TOKEN`, `PORT`, `AMBIENT_DATA_DIR`, and `ALLOW_UNAUTHENTICATED=true`, then run:

```sh
pnpm dev
MCP_URL=http://127.0.0.1:3000/mcp pnpm smoke:mcp
```

For the production topology, run the bridge without `HERMES_WS_URL` and set a long random `CONNECTOR_TOKEN`. On the Hermes host, run the connector with `AMBIENT_BRIDGE_URL`, `CONNECTOR_TOKEN`, `HERMES_WS_URL`, and `HERMES_WS_TOKEN`:

```sh
pnpm connector
```

The connector retries with bounded backoff and forwards frames only after both sockets are open. It does not replay a command after a disconnect.
When the installed gateway advertises session event sequences, the bridge replays missed observations after reconnect so a completion is not lost; a changed replay epoch clears the old sequence watermarks.

## MCP surface

The bridge exposes `ask_hermes`, `get_work`, `list_conversations`, `select_conversation`, `steer_work`, `cancel_work`, `list_approvals`, and `respond_to_approval`. An `ask_hermes` call returns a work reference after Hermes accepts the request; a later `get_work` call reads completion, progress, failure, cancellation, or approval state.

Set `AMBIENT_ACCESS_TOKEN` for a local bearer token. `AMBIENT_RETENTION_DAYS` controls deletion of old terminal work and resolved approvals; conversations and pending work are retained. For Alexa account linking, configure all OAuth variables together and use HTTPS. The bundled OAuth provider is a development and single-owner compatibility implementation; use a managed provider before exposing a public service.

## AWS bridge

The CDK stack provisions one public EC2 bridge host, an encrypted retained EBS volume, SSM access, and Secrets Manager entries. It does not claim to deploy Hermes, configure log shipping, or invent a TLS certificate. Install the application and an established HTTPS reverse proxy on the host after inspecting the synthesized stack:

```sh
pnpm infra:typecheck
pnpm infra:synth
pnpm exec cdk deploy
```

Use [docs/deployment.md](docs/deployment.md) for the order of secret setup, bridge installation, connector startup, and teardown.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
```

`pnpm check:hermes` verifies session discovery and `pnpm check:hermes-contract` captures sanitized heartbeat, replay, and approval response shapes from the installed gateway. `pnpm latency` measures authenticated MCP read calls and reports sample count, failures, p50, p95, and maximum. It does not pretend to measure Alexa's spoken-answer latency.

The current evidence and remaining Alexa questions are in [docs/compatibility.md](docs/compatibility.md) and [docs/acceptance.md](docs/acceptance.md). The revised architecture and cut order are in [docs/plans/2026-09-06-hermes-ambient.md](docs/plans/2026-09-06-hermes-ambient.md).

## Standard Echo skill

The optional custom skill endpoint is `POST /alexa`. Import [alexa/interaction-model.en-GB.json](alexa/interaction-model.en-GB.json) into the Alexa developer console, use `hermes` as the invocation name, and configure the bridge URL with `ALEXA_SKILL_ID`. The route can use the same owner OAuth token as `/mcp`; `ALLOW_UNAUTHENTICATED=true` is for local development only. Amazon request-signature validation remains a deployment gate for a public skill.

Alexa publication also requires a publicly hosted privacy policy; the single-owner draft is [docs/privacy-policy.md](docs/privacy-policy.md) and is not presented as final legal copy.
