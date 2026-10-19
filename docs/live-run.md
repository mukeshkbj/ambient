# First live run

**This has not been run.** No live call has happened. Every item below is a plan for the owner's first live call, and every result cell is empty until the owner fills it in. Nothing in this file is a measurement.

The first live call is the first time AssemblyAI's servers reach our `/call/<id>/v1/chat/completions` endpoint and the first time the Claude brain speaks on a real line. The goal of the run is to record what actually arrives, in one step, so the friction log and the README can stop saying "assumed".

The run spends money: one Claude call per business turn and one AssemblyAI voice-agent session. Do not start it without the owner's approval.

## Setup

Run these in the repo root, in Git Bash. `envsync` fills blank keys from the local age-encrypted vault, so no key is pasted into a file or a chat.

```sh
cat > .env <<'EOF'
AMBIENT_HOST=127.0.0.1
PORT=3000
PUBLIC_BASE_URL=https://REPLACE-WITH-TUNNEL-URL
AMBIENT_RUNTIMES_FILE=runtimes.call.json
AMBIENT_DATA_DIR=.ambient-live
ALLOW_UNAUTHENTICATED=true
AMBIENT_CAPTURE_LLM_REQUESTS=1
ANTHROPIC_API_KEY=
ASSEMBLYAI_API_KEY=
EOF
envsync
```

Then:

1. Start a tunnel in a second terminal: `cloudflared tunnel --url http://127.0.0.1:3000`. Copy the `https://…trycloudflare.com` URL it prints into `PUBLIC_BASE_URL` in `.env`. AssemblyAI requires a public `https` host, and the server refuses to start with the key set and any other URL.
2. Run `pnpm call`.
3. Open `http://127.0.0.1:3000/sim`, press "Call Joe's Plumbing", and open the "Answer as the business" link on a phone. Speak as the business.
4. When the call ends, stop the server and the tunnel.

Notes that cost time otherwise:

- `cp .env.example .env` also works: empty lines count as unset, and a test (`test/config.test.ts`) starts the config from the shipped example.
- `ALLOW_UNAUTHENTICATED=true` is needed because the `/sim` page sends no token. The tunnel then exposes `/mcp` and `/sim/api` without a login for as long as it runs. Keep the run short and stop the tunnel afterwards.
- `AMBIENT_CAPTURE_LLM_REQUESTS=1` is the capture switch. It is off by default.
- The brain model is `CALLER_MODEL`, default `claude-opus-5-5`.

## What the capture flag writes

With `AMBIENT_CAPTURE_LLM_REQUESTS=1`, the first request to `/call/<id>/v1/chat/completions` is written once per call to:

```
.ambient-live/captures/llm-request-<call id>.json
```

The file holds `method`, `path`, `headers`, and the JSON `body`. Any header whose name contains `authorization`, `cookie`, `key`, `token` or `secret` has the value `<redacted>`. Later requests of the same call do not overwrite the file. The first request is captured even when it fails authorization (the endpoint still answers 401), because an authorization mismatch is the likeliest way for the first live call to fail silently. The body is stored as received, so read it before sharing it.

## Capture checklist

Fill in the result column. Each row names where the result goes.

| # | What to capture | How | Result | Record it in |
|---|---|---|---|---|
| 1 | First request body: are the system prompt and the history in `messages`? Are `tools`, `stream`, `temperature` present? | Open the capture file; read `body` | _not run_ | Friction log entry 6 ("Actual" and "Workaround"; drop "We have not logged a real request") |
| 2 | First request headers: which header carries our per-call secret, and with what scheme (`Bearer` or other)? Which user agent? | Same file; `headers` shows which names arrive. Values are redacted, so the scheme (`Bearer` or other) is not recorded. If the capture holds a request but the call went silent, the endpoint answered 401: the header name or scheme differs from what `accepts` in `src/calls/rooms.ts` expects | _not run_ | Friction log entry 6 |
| 3 | Time to first word: seconds from the end of the business's first sentence to the start of Ambient's reply audio | Screen-record the answer page with a visible clock; read the gap from the recording. Cross-check the Claude part alone with `pnpm brain:latency` (spends money; writes `docs/receipts/brain-latency-<date>.json`) | _not run_ | README "Limits" bullet about `pnpm brain:latency`, and the README status row for the Claude brain |
| 4 | The agent id field: does the create-agent response hold `agent_id` or `id`? | The server reads `agent_id` then `id` and throws "AssemblyAI agent response had no id" if neither is a string. If the call connects, one of the two worked. To see which, send one create request by hand (it creates a stored agent, so it is a spend decision) and read the response keys | _not run_ | Friction log entry 6 (the paragraph on the agent id) |
| 5 | Does a per-call greeting work? Does the first thing the business hears equal `Hi, this is an AI assistant calling for <owner>. This call is transcribed.` word for word? | Listen on the phone; compare with the first `Ambient:` line in the transcript on `/sim` | _not run_ | Friction log entry 8, and the README status row for the AssemblyAI voice line |
| 6 | Event field names the page actually receives: `transcript.user` with `text` or `delta`? `reply.started` with or without ids? | Browser devtools console on the answer page, or the Network tab's WebSocket frames | _not run_ | Friction log entry 7 |
| 7 | Did the agent stop being bound to our endpoint after the call? | Server log shows no "retire" error; the call is over | _not run_ | Friction log entry 8 (cleanup, `de30e8d`) |

## After the run

1. Copy the capture file to `docs/receipts/llm-request-<date>.json` if the owner agrees to publish it, after reading it once.
2. Update friction log entries 6, 7 and 8 from the table above. Replace "we have not logged a real request" with what the file shows. Keep the vendor's words next to ours.
3. Update the README status table (rows "Claude brain", "AssemblyAI voice line and chat-completions shim", "Business answer page") and the two "has not run" bullets under Limits. Change a row from "Built but not yet run live" only for what the run showed.
4. If the first request does not match the shape the endpoint expects (`src/calls/assemblyai.ts`, `src/calls/rooms.ts`), fix the endpoint and add the captured body as a test fixture in `test/call-routes.test.ts`.
5. Re-run `pnpm call:dry`. It still tests against a local fake, so update `scripts/fake-assemblyai.ts` to the real request shape if it differs.
