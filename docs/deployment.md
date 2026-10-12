# Deployment

Hermes Ambient is a single-owner bridge. Keep the Hermes host private and make the connector initiate the network connection.

## Bridge host

1. Bootstrap the AWS account and inspect the stack with `pnpm infra:synth`.
2. Deploy `HermesAmbientStack` with an instance size and volume sized for measured use.
3. Read the generated connector and OAuth secret ARNs from the stack outputs. Fetch values through SSM or Secrets Manager; do not put them in shell history or URLs.
4. User data already installs Node 22, pnpm, Caddy, and an `ambient.service` unit that loads `CONNECTOR_TOKEN`/`OAUTH_SIGNING_SECRET` from Secrets Manager at each boot and sets `PUBLIC_BASE_URL`/`ALEXA_VERIFY_SIGNATURE=true`. Caddy serves auto-TLS on `<dashed-eip>.sslip.io` (the `BridgePublicUrl` output) and proxies to `127.0.0.1:3000`, including the `/connector` WebSocket upgrade.
5. Copy the built repository to `/opt/hermesambient/app` via SSM `aws ssm send-command` or rsync over the Elastic IP, then `systemctl start ambient`. The retained data volume is mounted at `/opt/hermesambient/data` (`AMBIENT_DATA_DIR` is already set). The instance role grants `bedrock:InvokeModel*`/`Converse*` scoped to the Nova Lite inference profile, so `runtimes.bedrock.json` works with no keys on disk.
6. Leave `HERMES_WS_URL` empty in connector mode. Keep the Hermes gateway off the security group.
7. Set `ALEXA_SKILL_ID` to the application id from the Alexa developer console when using the custom skill route. Verify `/healthz` before linking Alexa.

## Hermes host

1. Keep the installed Hermes gateway on loopback or its existing private interface.
2. Start `pnpm connector` with the bridge URL, connector token, Hermes WebSocket URL, Hermes gateway token, and the matching `HERMES_RUNTIME_ID`. Keep the Hermes URL private: this installed gateway uses its legacy query-token WebSocket contract, so do not point it at a public endpoint.
3. Confirm that the bridge reports the runtime online and run `pnpm smoke:mcp` against the public MCP URL.
4. Let the connector restart after a network interruption. Check that old work is reported with honest state and is not submitted again.

The host must remain awake for local Hermes to be available. A cloud Hermes deployment is a separately configured runtime; it is not an automatic substitute for a sleeping local host.

## Standard Alexa skill

The custom skill endpoint is `POST /alexa`. Configure the Alexa developer console to send requests to the public HTTPS bridge URL and set the skill application id in `ALEXA_SKILL_ID`. In development, `ALLOW_UNAUTHENTICATED=true` permits the skill route without account linking; use the OAuth account-linking flow before exposing a public skill. The skill invocation name is `hermes`, and the included interaction model is [alexa/interaction-model.en-GB.json](../alexa/interaction-model.en-GB.json). The route checks the skill application id, verifies Amazon's `SignatureCertChainUrl`/`Signature` headers when `ALEXA_VERIFY_SIGNATURE=true` (the stack sets it), and enforces owner authorization.

## Teardown and retention

Stop the bridge service, detach the connector, and run `pnpm exec cdk destroy` only after exporting any needed evidence. The data volume is retained by the stack; delete it deliberately when the stored Ambient projection is no longer needed. Rotate connector and OAuth secrets through Secrets Manager and restart both sides.
