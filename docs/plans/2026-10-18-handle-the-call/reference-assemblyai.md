# AssemblyAI Voice Agent API: verified reference

Researched 2026-10-18 from the live docs (raw `.md` variants of each page, fetched with curl), the AssemblyAI GitHub org, and the pricing page. Docs base: `https://www.assemblyai.com/docs/voice-agents/voice-agent-api/`. Quotes are verbatim. `UNVERIFIED` marks anything the docs do not state.

Page names below are relative to the docs base: `events-reference`, `session-configuration`, `audio-format`, `browser-integration`, `connect-your-own-llm`, `greeting`, `deploy`, `api-spec/voice-agent-websocket`, `api-spec/generate-voice-agent-token`.

## 1. Endpoint and authentication

Current endpoint (AsyncAPI spec, `address: /v1/ws`, `host: agents.assemblyai.com`, `protocol: wss`):

```
wss://agents.assemblyai.com/v1/ws
```

`deploy`: "Both open the same WebSocket, `wss://agents.assemblyai.com/v1/ws`".

Stale endpoint: the example repo `AssemblyAI/voice-agent-api-twilio-example` (last pushed 2026-10-14) still says its README bridges to `wss://agents.assemblyai.com/v1/realtime`. Every doc page and the JS starter use `/v1/ws`. Use `/v1/ws`.

Server-side auth (`api-spec/voice-agent-websocket`): "Pass your API key as a Bearer token in the `Authorization` header on the WebSocket upgrade request." Example value: `Bearer YOUR_ASSEMBLYAI_API_KEY`. The `events-reference` Python sample does the same: `additional_headers={"Authorization": f"Bearer {API_KEY}"}`. (REST examples elsewhere send the raw key with no `Bearer`. Both appear in the docs. UNVERIFIED which forms the WS upgrade accepts; send `Bearer`.)

Browser auth: "For browser apps (which can't set custom headers on WebSockets), generate a temporary token ... and pass it via the `token` query parameter instead."

```js
// server: GET https://agents.assemblyai.com/v1/token?expires_in_seconds=300&max_session_duration_seconds=8640
//   header  Authorization: Bearer <ASSEMBLYAI_API_KEY>   -> { "token": "...", "expires_in_seconds": 300 }
// browser:
const wsUrl = new URL("wss://agents.assemblyai.com/v1/ws");
wsUrl.searchParams.set("token", token);
```

Token facts (`browser-integration`, `api-spec/generate-voice-agent-token`):
- "Each token is single-use, it starts exactly one session, and all usage is attributed to the key that generated it."
- `expires_in_seconds`: required, 1 to 600. It is the redemption window only.
- `max_session_duration_seconds`: optional, 60 to 10800, default 10800.
- Expired or bad token: "the server returns a `session.error` with code `unauthorized` on the first frame instead of `session.ready`". In browsers a pre-handshake failure can instead surface as a `close` event with code `1006` and no payload.
- The JS starter calls `/token?product=voice_agent&expires_in_seconds=60`. The `product` param is not in the token spec. UNVERIFIED whether it is needed.

Warning in `deploy`: "A raw API key is fine for servers and trusted backends. **Never ship it in browser or mobile client code.**"

## 2. Message types

Flow (`events-reference`): connect, then `session.update` as the first message, wait for `session.ready`, then stream `input.audio`. End with `session.end`, wait for `session.ended`.

### Client to server

| `type` | Fields |
| - | - |
| `session.update` | `session` object (below) |
| `input.audio` | `audio`: base64 PCM16 |
| `tool.result` | `call_id`, `result` (JSON string), optional `is_error` |
| `reply.create` | optional `instructions` (string) |
| `conversation.message` | `role` (`"user"` or `"system"`), `content` |
| `session.resume` | `session_id` |
| `session.end` | none |

`session.update` fields (`session-configuration`, `events-reference`). All optional:

```json
{ "type": "session.update", "session": {
  "agent_id": "<stored agent id; mutually exclusive with everything below>",
  "system_prompt": "...", "greeting": "...",
  "tools": [{ "type": "function", "name": "get_weather", "description": "...",
              "parameters": { "type": "object", "properties": {}, "required": [] } }],
  "input":  { "format": { "encoding": "audio/pcm" },
              "keyterms": ["..."], "transcription_mode": "balanced",
              "transcription_prompt": "...", "language_codes": ["en"],
              "voice_focus": "near-field", "voice_focus_threshold": 0.5,
              "turn_detection": { "vad_threshold": 0.5, "min_silence": 1000, "max_silence": 3000,
                                  "interrupt_response": true, "interruption_delay": 100 } },
  "output": { "voice": "alba", "format": { "encoding": "audio/pcm" }, "volume": 100 } } }
```

There is no `llm` field in the inline `session.update` schema. See section 4.

Mutability after `session.ready` (`session-configuration`): `system_prompt`, `turn_detection`, `keyterms`, `transcription_mode`, `transcription_prompt`, `output.volume` are mutable. `greeting`, `output.voice`, `output.format` raise `session.error` code `immutable_field`. `tools` and `input.format` are accepted in later updates.

Defaults: `transcription_mode` = `balanced` (also `min_latency`, `max_accuracy`); `interrupt_response` = `true`; `interruption_delay` 0 to 1000 ms (0 for `min_latency`, 500 otherwise); `min_silence`/`max_silence` adaptive if unset; `vad_threshold` 0.5; `keyterms` up to 100; `transcription_prompt` max 1750 chars.

Voices (`voices`): US `alba, eve, george, jane, jean, mary, michael`; UK `anna, charles, paul, vera`; plus `giovanni` (it), `lola` (es), `juergen` (de), `rafael` (pt), `estelle` (fr).

### Server to client

| `type` | Fields |
| - | - |
| `session.ready` | `session_id`, `expires_at` (unix s, max duration), `resume_token`, `config` |
| `session.updated` | `config` |
| `input.speech.started` / `input.speech.stopped` | none |
| `transcript.user.delta` | `item_id`, `text` (full transcript so far, not a chunk) |
| `transcript.user` | `text`, `item_id` |
| `reply.started` | `reply_id`, `item_id` |
| `reply.audio` | `data`: base64 PCM16 |
| `transcript.agent.delta` | `reply_id`, `item_id`, `delta`, `start_ms`, `end_ms` |
| `transcript.agent` | `text`, `reply_id`, `item_id`, `interrupted` |
| `reply.done` | `reply_id`, `status`: `"completed"` or `"interrupted"` |
| `tool.call` | `call_id`, `name`, `arguments` (object) |
| `session.ended` | `session_duration_seconds`, `audio_duration_seconds`, `timestamp` |
| `session.error` | `code`, `message`, `timestamp`, optional `param` |

Doc inconsistency: `message-sequence` shows `transcript.user.delta` with a `delta` field and `reply.started` / `reply.done` without ids. `events-reference` is the fuller page and says `text`. Read both defensively.

Error codes of interest: `UNAUTHORIZED`/`FORBIDDEN`/`server_error` (close 1008), `agent_init_failed`, `agent_timeout` ("Agent did not signal ready within 10 seconds"), `invalid_format`, `invalid_audio`, `immutable_field`, `agent_id_not_first`, `agent_not_found`, `audio_rate_violation` ("`input.audio` streamed faster than real time"), `at_capacity`, `concurrency_exceeded`, `session_expired`. "If the server cancels the session due to an internal error, the WebSocket closes with code `1011` without any `session.error` payload." Case differs between pages (`UNAUTHORIZED` vs `unauthorized`).

Interruption handling: on `reply.done` with `status: "interrupted"`, "Flush your local audio playback buffer." `transcript.agent` then carries `interrupted: true` and only the text actually spoken.

Reconnect: "Sessions are preserved for 30 seconds after every disconnection". `session.resume` with the old `session_id` as the first message.

## 3. Audio

`audio-format`: "All audio is **base64-encoded and mono**. Input and output are configured independently and can differ."

| `encoding` | Rate | Depth |
| - | - | - |
| `audio/pcm` (default) | 24,000 Hz | 16-bit signed little-endian |
| `audio/pcmu` | 8,000 Hz | 8-bit mu-law |
| `audio/pcma` | 8,000 Hz | 8-bit A-law |

"`format.sample_rate` | No | Hz. Determined by the encoding if omitted." Use the default: mono, 24 kHz, PCM16 LE, both ways.

Sending: "Send `input.audio` events continuously ... Chunk size doesn't matter; ~50 ms works well." That is 1200 samples, 2400 bytes per chunk.
- "**Wait for `session.ready`** before the first chunk." Earlier audio is discarded.
- "**Send at real time, not faster.** Frames beyond about one second of audio per second of wall clock are dropped, not buffered".
- "**Send raw mic audio.** The server denoises already". Capture with `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false } })`.

Browser AudioWorklet (`browser-integration`): the quickstart forces `new AudioContext({ sampleRate: 24000 })`, which works on Chromium only. "Firefox honors the rate but bypasses its echo canceller ... Safari ignores the option entirely". For a phone (iOS Safari), use the default-rate `AudioContext`, pass `processorOptions: { inputSampleRate: audioCtx.sampleRate, targetSampleRate: 24000 }` to the worklet, and resample there. The docs' worklet decimates by nearest sample (`input[Math.floor(i * ratio)]`); linear interpolation is better. Convert float to int16 with `Math.round(x * 32767)`, clamped.

Playback: base64 decode, read int16 LE, divide by 32768, `audioCtx.createBuffer(1, n, 24000)`, schedule each chunk at a running `playbackTime = Math.max(playbackTime, now)`. "`createBuffer(1, length, 24000)` works on all current browsers, since the context resamples on output." On interrupt, "Disconnect the source node, create a new `AudioBufferSourceNode`, reconnect" (track live sources so you can `stop()` them). Docs warn against `sleep`-based scheduling.

Other browser rules: `getUserMedia`/`AudioContext` need a user gesture (start in a `click`/`touchstart` handler, `await audioCtx.resume()`); HTTPS or localhost only; iOS Safari needs playsinline or an `AudioContext` destination.

Ending: send `session.end` synchronously in `pagehide`. A bare `ws.close()` leaves a 30 s billable grace window.

## 4. Bring your own LLM

Source: `connect-your-own-llm`.

Configuration is on a stored agent via REST, not inline: "set the `llm` field on the agent to your own **OpenAI-compatible** chat-completions endpoint. AssemblyAI calls that endpoint at runtime to generate every reply."

```bash
curl -X POST https://agents.assemblyai.com/v1/agents \
  -H "Authorization: $ASSEMBLYAI_API_KEY" -H "Content-Type: application/json" \
  -d '{ "name": "...", "system_prompt": "...", "voice": { "voice_id": "alba" },
        "greeting": "...",
        "llm": [{ "base_url": "https://your-endpoint.example.com/v1", "model": "your-model", "api_key": "..." }] }'
# then PUT /v1/agents/{id} to change any field, "llm": [] to return to the managed model
```

Then every session binds with `{"type":"session.update","session":{"agent_id":"<id>"}}` as the only field. Per `events-reference`, `agent_id` "First `session.update` only, and mutually exclusive with the inline fields".

Documented constraints:
- `base_url`: "HTTPS base URL of the OpenAI-compatible endpoint. Must be `https` and a public host. The agent calls `POST {base_url}/chat/completions`."
- "Non-`https` URLs and private/loopback hosts are rejected." So `localhost` fails; local dev needs a public HTTPS tunnel (ngrok, cloudflared).
- `api_key`: "**Write-only** — encrypted at rest and never returned in any response."
- "**Streaming.** Realtime voice needs token streaming, so the model must support streamed chat completions."
- "`llm` is a list, but only a single entry is accepted today (fallbacks aren't supported yet)."
- "Latency and reliability now depend on your endpoint. A slow or rate-limited model shows up directly as reply latency".
- Alternative: LLM Gateway, `base_url: https://llm-gateway.assemblyai.com/v1`, model `claude-sonnet-4-6`, `api_key` = your AssemblyAI key. That is a hosted Claude, not our brain logic.

NOT DOCUMENTED (state these as unknown; test with a request logger):
- The agent-create response field name. The docs show the request only. `src/calls/assemblyai.ts` reads `agent_id`, then `id`. UNVERIFIED until the first real call (noted 2026-10-18).
- The per-turn request body. UNVERIFIED: whether `messages` includes the agent's `system_prompt` as a system message, how history is shaped, whether `stream: true` and `stream_options` are set, which extra params (temperature, max_tokens) are sent.
- The auth header on the call to us. UNVERIFIED; almost certainly `Authorization: Bearer <api_key>` as with OpenAI, but the docs do not say.
- Request timeouts or retry behaviour toward our endpoint. UNVERIFIED. (Only HTTP tools document `timeout_seconds`, default 120, range 1 to 300.)
- Whether `tools` (client-side `session.tools` or stored HTTP tools) are forwarded to our endpoint in OpenAI `tools` format, and whether we may answer with `tool_calls` deltas. UNVERIFIED. The tools pages describe tool calls only as decisions of "the model".
- Whether our streamed text is spoken verbatim. The `greeting` page says the greeting skips the LLM, which implies normal replies are LLM output sent to TTS. UNVERIFIED that no rewriting happens.
- Whether `reply.create` `instructions` and `conversation.message` appear as messages in our request. UNVERIFIED.
- Mid-call dynamic content: `system_prompt` is mutable after `session.ready`, but UNVERIFIED whether a session bound by `agent_id` accepts a later `session.update` that changes `system_prompt`.

The JS starter has `agents/byo-llm.jsonc` (https://github.com/AssemblyAI/voice-agent-starter-js/blob/main/agents/byo-llm.jsonc). It only shows the config; it has no server-side sample of the request.

## 5. Speaking exact text

- `greeting` is verbatim. `greeting` page: "The greeting is sent **straight to the TTS engine**. It is not run through the LLM first. Whatever string you put here is exactly what the user hears, word for word." Spec: "Sent directly to the TTS engine and spoken verbatim. It is NOT run through the LLM". "Omit to have the agent wait silently for the user to speak first." Immutable after `session.ready` when inline.
- Stored agent greeting: change it with `PUT /v1/agents/{id}` (`{ "greeting": "..." }`). It cannot be set per session when binding by `agent_id`. For a per-call disclosure that names the business, create or update a per-call agent first.
- No "say"/"speak" message exists. Client messages are exactly: `session.update`, `session.resume`, `input.audio`, `tool.result`, `reply.create`, `conversation.message`, `session.end` (AsyncAPI `send*` operations).
- `reply.create` is not verbatim. "Ask the agent to generate a reply right now, optionally with custom `instructions`." Instructions are "One-shot ... the agent uses to compose this reply", so the LLM composes the text.
- `conversation.message` only adds context: "does not by itself make the agent reply".
- Therefore exact text beyond the greeting is possible only through our `/chat/completions` endpoint returning exactly the words we want (section 4 caveats).

## 6. Pricing, limits, session length

Pricing page (https://www.assemblyai.com/pricing, Voice Agent API tab):
- "$4.50/hr ($0.075/min)". "Billed per second on connected conversation time."
- "Every feature is included in the $4.50/hr rate. There are no per-layer add-ons, concurrency fees, or per-agent subscriptions." Includes STT, the managed LLM, TTS, hosting, recordings, transcripts.
- UNVERIFIED whether the $4.50/hr drops when `llm` points at our endpoint. The pages say nothing about a discount. Our own LLM cost is on top.
- The 30 s `session.resume` grace window is billable unless `session.end` is sent.
- Free credit: "Sign up for a free account in the dashboard and get API credit to start building — no credit card required." The Voice Agent amount is not stated. The same FAQ says the free tier is "up to 185 hours of pre-recorded transcription and up to 333 hours of streaming transcription" (speech-to-text, not stated to cover Voice Agent).
- Product page comparison: ~1 second end-to-end latency, OpenAI Realtime listed at $18.00/hr.

Limits:
- Max session length: 10800 s (3 h) default and cap, via `max_session_duration_seconds` on the token. Direct API-key connections: `session.ready.expires_at` reports the limit. "There is no separate 'closing soon' warning event before this, so run a client-side timer".
- Concurrency/rate limits: no numbers published. Errors exist (`concurrency_exceeded`, `at_capacity`, HTTP 429 on `/v1/token`). Enterprise: "custom rate limits, enhanced concurrency". UNVERIFIED default account concurrency.
- Input pace: about real time only (`audio_rate_violation`).
- Recordings: `GET https://agents.assemblyai.com/v1/sessions` and `/v1/sessions/{id}` return pre-signed OGG/Opus audio, a timeline JSON (`user_transcript` / `agent_text` per turn), and metadata.

## 7. SDK

No official JS/TS SDK for the Voice Agent API found. The npm `assemblyai` package (latest 4.41.5, modified 2026-09-24) describes itself as covering "async and real-time transcription"; its README has no Voice Agent mention. Official artifacts are two zero-dependency starters, `AssemblyAI/voice-agent-starter-js` (Node 18+) and `...-python`, and the Twilio example `AssemblyAI/voice-agent-api-twilio-example` (TypeScript). The Node 22 global `WebSocket` or the `ws` package can open the socket; `ws` is needed to set an `Authorization` header (browser `WebSocket` cannot).

## 8. Beta / preview status

No page mentions "beta" or "preview" for the Voice Agent API (grep of the 15 fetched doc pages). Signals of youth: the pricing page labels the model "New" (Universal-3.6 Pro Realtime); the docs contradict each other on field names (section 2); the sample repo still points at `/v1/realtime`; `llm` accepts one entry with "fallbacks aren't supported yet". Treat the API as young and expect drift. Docs for coding agents: https://www.assemblyai.com/docs/llms.txt.

## Implications for our design

- Feasible and simpler than a relay: with BYO LLM, the "brain" is the `/chat/completions` endpoint, not the audio path. The phone page can open `wss://agents.assemblyai.com/v1/ws?token=...` directly using a one-use token minted by our Node server (key never leaves the server). Our server then only mints tokens, hosts the chat endpoint, and manages agents. A Node relay is optional; keep it only if we need to observe or gate audio (relay uses the `Authorization: Bearer` header).
- The AI disclosure is solved by `greeting`, which is spoken verbatim and bypasses the LLM. A per-call stored agent (POST or PUT `/v1/agents`) with `greeting` = disclosure text gives a guaranteed first sentence. Cost: one REST call before each call, and the greeting cannot differ per session when bound by `agent_id`.
- Every later sentence depends on our endpoint returning exactly the words to be spoken. The docs never promise verbatim playback of LLM output. This is the main risk. The honesty rules (price limit, owner approval) must be enforced in our endpoint, not in the system prompt.
- Biggest unknown: the request body, auth header, timeouts, and tool handling for the `/chat/completions` call are undocumented. First task: deploy a logging stub on a public HTTPS tunnel, point a test agent at it, and record one full turn (messages, system prompt presence, `tools`, `stream`, headers).
- Our endpoint must be public HTTPS and stream SSE chunks fast; the voice latency budget (~1 s end to end) includes our Claude call. Plan a short prefix streamed early, plus a hard timeout and a safe fallback sentence.
- Approval waits ("owner must approve this price") cannot block a `/chat/completions` stream for long. Return a holding sentence that we control, then use `reply.create` with `instructions` (LLM-composed, so not verbatim) or a later turn. Alternatively use client-side `tool.call` with `execution_mode: "hold"`, but tool forwarding through BYO LLM is UNVERIFIED.
- Mobile web audio needs care: default-rate `AudioContext` plus worklet resampling to 24 kHz (iOS Safari ignores the `sampleRate` option), `echoCancellation: true`, `noiseSuppression: false`, real-time pacing, flush on `reply.done` `interrupted`, and `session.end` on `pagehide`. A business rep holding a phone on speaker is the echo case the browser canceller must handle.
- Cost is about $0.075/min plus our Claude tokens; a 3-hour hard cap and per-second billing mean we must always send `session.end`. Free credit size for Voice Agent is not published; check the dashboard.
- Keep a thin adapter module for the AssemblyAI protocol (events, token mint, agent CRUD) and a pure function from the call transcript to the next spoken text. The protocol is young and the docs disagree in places, so contract tests against recorded frames will catch drift.
