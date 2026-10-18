# Phase 10: AWS deploy and Bedrock

[Back to overview](overview.md)

## Goal

Give Twilio and the Alexa skill a stable public HTTPS endpoint on AWS, prove the brain runs on Claude through Bedrock, and document both for the AWS Builder mini challenge. `cdk deploy` costs money: get the user's explicit approval at the moment of deploy.

## Changes

1. `infra/stack.ts`:
   - Secrets Manager secret `ambient/app` holding `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `VOICEMONKEY_TOKEN`, `VOICEMONKEY_DEVICE`, `AMBIENT_ACCESS_TOKEN`. The boot script writes every key to the env file.
   - Remove the OAuth secret unless an OAuth value is configured; the current env block fails `readConfig` when only some OAuth keys are present.
   - IAM: `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` on the Claude model and its inference profile in `us-east-1`.
   - Caddy on `<eip>.sslip.io` terminates TLS and proxies WebSocket upgrades (Caddy does this by default).
   - Env: `PUBLIC_BASE_URL=https://<host>`, `ALEXA_VERIFY_SIGNATURE=true`, `AMBIENT_RUNTIMES_FILE=runtimes.live.json`.
2. `runtimes.live.json`: the caller with `line: twilio`, `brain: claude`.
3. `src/calls/brain.ts` wiring: `BRAIN_CLIENT=anthropic|bedrock`. Bedrock uses `AnthropicBedrockMantle({ awsRegion })` and the model id `anthropic.claude-opus-5-5` (check the exact id with the Bedrock console before use).
4. `test/infra.test.ts`: synthesize the stack and assert the env file keys satisfy `readConfig` (run `readConfig` on the generated key list with placeholder values).
5. `docs/deployment.md`: rewrite to the real steps and outputs.

## Verification

- Static: `pnpm scan`, `pnpm infra:synth` green.
- Runtime (after user approval): `pnpm infra:deploy`; `curl https://<host>/healthz` returns `{"ok":true}`; point the ASK endpoint and Twilio callbacks at the host; run one real call from the deployed server with `BRAIN_CLIENT=bedrock`; save `docs/receipts/bedrock-call-<date>.json` with the model id, request ids, and outcome.

## Done when

The deployed host serves a real call through Bedrock, the receipt is committed, and one commit lands: "Deploy to AWS with a Bedrock brain".
