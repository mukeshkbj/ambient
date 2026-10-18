# Phase 6: Twilio line

[Back to overview](overview.md)

## Goal

A second `Line` adapter that places a real call through Twilio ConversationRelay. Read [reference-twilio.md](reference-twilio.md) first; it holds every message shape used below.

## Changes

1. `src/calls/twilio.ts`:
   - `twilioLine(deps: { client: Twilio; fromNumber: PhoneNumber; publicBaseUrl: string; relay: RelayHub }): Line`.
   - `dial` calls `client.calls.create` with the TwiML from `conversationRelayTwiml({ callId, ownerName, publicBaseUrl })`, the status callback, and `timeLimit: 600`.
   - `say(text, last)` sends `{ type: "text", token: text, last }` on the call's socket.
   - `hangUp` sends `{ type: "end" }`; if the socket is gone, it calls `client.calls(sid).update({ status: "completed" })`.
   - Socket messages map to `LineInput`: `setup` gives `answered`; `prompt` with `last: true` gives `heard`; `interrupt` gives `interrupted`; socket close or a terminal status callback (`busy`, `no-answer`, `failed`, `completed`) gives `line_ended` with the matching reason, once.
2. `src/calls/relay-hub.ts`: `RelayHub` maps `callId` to a pending line. `attach(socket, setup)` routes the socket to the line whose `callId` matches `setup.customParameters.callId`; unmatched sockets are closed.
3. `src/server.ts`:
   - WebSocket upgrade on `/twilio/relay`: validate `X-Twilio-Signature` against `wss://<public host>/twilio/relay` with empty params before accepting. Reject with 403 otherwise.
   - `POST /twilio/status`: validate the signature with all form fields; forward to the hub.
   - `POST /twilio/action`: validate; return `<Response><Hangup/></Response>`.
   - These routes skip bearer auth (Twilio cannot send it) and rely on the signature.
4. `src/config.ts`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, all required together when any runtime uses `line: twilio`. `PUBLIC_BASE_URL` required in that case.
5. `scripts/call-me.ts` and `pnpm call:me`: starts the server with `line: twilio`, `brain: claude`, a brief for "confirm a pretend plumbing appointment", and dials `CALL_ME_NUMBER` (the user's phone). Prints the transcript and outcome.
6. `package.json`: add `twilio`.

## Tests (write first, run red)

`test/twilio-line.test.ts` with a fake Twilio client and a real `ws` pair on loopback:

1. `conversationRelayTwiml` output contains the disclosure as `welcomeGreeting`, `welcomeGreetingInterruptible="none"`, `profanityFilter="false"`, the `callId` parameter, and `<Hangup/>` after `</Connect>`; it is under 4000 characters.
2. An upgrade without a valid signature is rejected with 403; with a valid signature (computed with `twilio.getExpectedTwilioSignature` and the auth token) it is accepted.
3. `setup` then `prompt {last:true}` produce `answered` then `heard`.
4. `interrupt` produces `interrupted` with `utteranceUntilInterrupt`.
5. A `busy` status callback before any socket produces exactly one `line_ended busy`.
6. `say("Hello", true)` writes `{"type":"text","token":"Hello","last":true}` to the socket.

## Verification

- Static: `pnpm scan` green.
- Runtime: tunnel the server (`cloudflared tunnel --url`), set `PUBLIC_BASE_URL` to the tunnel URL, run `pnpm call:me`. The user's phone rings, the disclosure plays, the agent holds a short conversation, and the outcome prints. Record in `progress.md`: the transcript, the `setup.direction` value, the time from the user finishing a sentence to the first agent word (stopwatch is fine), and anything that contradicted the reference.
- Update `reference-twilio.md` for every **UNVERIFIED** item the call settled.

## Done when

The six tests pass, one real call succeeds, and one commit lands: "Add the Twilio line".
