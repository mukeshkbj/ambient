# Phase 0: Preflight (accounts and hardware)

[Back to overview](overview.md)

## Goal

Prove the two unverified platform facts that could sink the plan, and collect every credential, before any lane depends on them.

## Owner

The user does the account steps. The orchestrator runs the checks and records results in `progress.md`.

## Steps

1. **Echo Dot skill check (highest risk).** In the ASK developer console, import `alexa/interaction-model.en-US.json`, set the endpoint to a tunnel URL for `/alexa`, and set **Test** to **Development**. Run `pnpm demo` with `ALEXA_SKILL_ID` set and a tunnel (`cloudflared tunnel --url http://127.0.0.1:<port>`). On the Echo Dot say "Alexa, open Ambient".
   - Done when Alexa answers with the skill's launch prompt, or the failure is recorded with the Alexa app **Activity** entry.
   - If the Dot is on Alexa+ and the skill does not invoke, ask the user to turn Alexa+ off for the account and retest. If it still fails, the video uses the sim for Alexa and the real phone call for proof. Record the decision.
2. **Twilio.** The user upgrades the account, buys a US number with voice, and accepts the AI/ML addendum (see [reference-twilio.md](reference-twilio.md)). Store `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` with `envsync set`.
   - Done when `envsync ls` lists all three.
3. **Anthropic.** Run `ant auth status`. If no credential source is active, the user runs `ant auth login` or stores `ANTHROPIC_API_KEY` with `envsync set`.
   - Done when a one-line `messages.create` call with `claude-opus-5-5` returns text.
4. **Voice Monkey.** The user enables the Voice Monkey skill, creates a Speaker named `ambient`, wires it to the Echo Dot, and stores `VOICEMONKEY_TOKEN` and `VOICEMONKEY_DEVICE`.
   - Done when `curl -X POST https://api-v3.voicemonkey.io/announce -H 'Content-Type: application/json' -d '{"token":"…","device":"ambient","speech":"Ambient test"}'` makes the Echo Dot speak. Record the delay in seconds.
5. **AWS.** The user provides credentials with Bedrock access in `us-east-1` and approves `cdk deploy` for phase 10. Request access to the Claude model on Bedrock if needed.
   - Done when `aws sts get-caller-identity` succeeds, or the user defers AWS to day 3.
6. **GitHub.** The user approves creating the public repo `ambient` and pushing `main` with history.

## Verification

`progress.md` has a "Preflight" section with one line per step: result, date, and any measured delay. No code changes in this phase.
