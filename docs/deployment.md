# Deployment

Ambient runs as one Node process behind HTTPS. The Alexa skill and AssemblyAI both need a public HTTPS URL.

## Local with a tunnel

1. Start a tunnel to port 3000 (for example `cloudflared tunnel --url http://127.0.0.1:3000`).
2. In `.env`, set `PUBLIC_BASE_URL` to the tunnel URL, then set `ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`, and `AMBIENT_RUNTIMES_FILE=runtimes.call.json`.
3. Run `pnpm call`.
4. Open `/sim`, start a call, and open the "Answer as the business" link on a phone.

## AWS

`infra/stack.ts` defines `AmbientStack`: one EC2 instance with Caddy for automatic TLS, a retained data volume at `/opt/ambient/data`, and secrets in AWS Secrets Manager. Inspect it with `pnpm infra:synth`. The deploy has not run yet; it needs the account owner's approval.

## Alexa skill

The skill endpoint is `POST /alexa`. In the Alexa developer console, point the skill at `PUBLIC_BASE_URL/alexa`, set `ALEXA_SKILL_ID`, and set `ALEXA_VERIFY_SIGNATURE=true`. The invocation name is `ambient`. The interaction models are in `alexa/`, and `alexa/skill.json` declares the notification permission for the needs-you alert.
