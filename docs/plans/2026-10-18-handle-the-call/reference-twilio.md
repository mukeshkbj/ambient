# Twilio ConversationRelay reference

Facts gathered from twilio.com/docs on 2026-10-18. Items marked **UNVERIFIED** must be checked on a real call before code depends on them.

## Account prerequisites

- Upgrade the account. On trial, `<ConversationRelay>` is replaced with `<Say>` "The ConversationRelay verb is not available on trial accounts." Source: https://www.twilio.com/docs/usage/trials/try-out-voice
- Accept the Predictive and Generative AI/ML Features Addendum: **Communications > Voice > Settings > Privacy & Security**, then **Save**. Without it, error 64110 "Account Opted Out". Source: https://www.twilio.com/docs/voice/conversationrelay/onboarding
- Cost: ConversationRelay $0.07 per minute plus voice minutes (about $0.014 per minute US outbound).
- Assume region US1 only.

## Placing the call

`twilio` npm 6.2.0, Node 20 or later.

```ts
const call = await client.calls.create({
	to, from,
	twiml,
	statusCallback: `${publicBaseUrl}/twilio/status`,
	statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
	statusCallbackMethod: "POST",
	timeout: 30,
	timeLimit: 600,
});
```

- `twiml` is a string, at most 4000 characters. If `url` is also set, `twiml` is ignored.
- `CallStatus` values: `queued`, `initiated`, `ringing`, `in-progress`, `completed`, `busy`, `failed`, `no-answer`, `canceled`.
- Status callbacks arrive out of order. Sort by `SequenceNumber`.
- The status callback hostname must not contain underscores.

## TwiML we emit

Emit a raw XML string. The SDK builder types lag the docs (lowercase attribute names, wrong types for `reportInputDuringAgentSpeech`).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
	<Connect action="{PUBLIC_BASE_URL}/twilio/action">
		<ConversationRelay
			url="wss://{host}/twilio/relay"
			welcomeGreeting="Hi, this is an AI assistant calling for {ownerName}. This call is transcribed."
			welcomeGreetingInterruptible="none"
			ttsProvider="Amazon"
			voice="Joanna-Neural"
			interruptible="speech"
			reportInputDuringAgentSpeech="none"
			profanityFilter="false">
			<Parameter name="callId" value="{callId}"/>
		</ConversationRelay>
	</Connect>
	<Hangup/>
</Response>
```

- `welcomeGreetingInterruptible="none"` keeps the disclosure from being cut off.
- `profanityFilter` defaults to true and masks words in the transcript. Turn it off so the transcript is faithful.
- `<Parameter>` values arrive in the `setup` message as `customParameters.callId`.
- `<Hangup/>` after `</Connect>` ends the call when our server sends `end`.

## Messages Twilio sends to our WebSocket

```json
{"type":"setup","sessionId":"VX…","accountSid":"AC…","callSid":"CA…","from":"+1…","to":"+1…","direction":"inbound","callStatus":"RINGING","customParameters":{"callId":"…"}}
{"type":"prompt","voicePrompt":"I can come Tuesday.","lang":"en-US","last":true}
{"type":"interrupt","utteranceUntilInterrupt":"Life is a complex set of","durationUntilInterruptMs":460}
{"type":"dtmf","digit":"1"}
{"type":"error","description":"Invalid message received: …"}
```

- `direction` for an outbound call is probably `outbound-api`. **UNVERIFIED.**
- Ignore unknown `type` values (an `info` type exists in community samples). **UNVERIFIED.**
- On `interrupt`, truncate the agent's last stored turn to `utteranceUntilInterrupt`. That is what the business actually heard.

## Messages our server sends

```json
{"type":"text","token":"Hello","last":false}
{"type":"text","token":" there.","last":true}
{"type":"end","handoffData":"{\"outcome\":\"confirmed\"}"}
```

- Do not trim tokens. Spaces between tokens matter.
- `last:true` closes one talk cycle.
- Ten consecutive invalid messages close the socket with code 1007.
- Write numbers as words in spoken text ("one hundred sixty dollars").

## Hanging up

- Clean end: send `{"type":"end"}`. Twilio calls the `<Connect action>` URL; return `<Response><Hangup/></Response>`.
- Hard stop: `client.calls(callSid).update({ status: "completed" })`.

## `<Connect action>` callback

Form fields include `CallSid`, `CallStatus`, `SessionId`, `SessionStatus` (`ended`, `completed`, `failed`), `SessionDuration`, `HandoffData`, `ErrorCode`, `ErrorMessage`. Return TwiML.

## Signatures

- Status and action callbacks carry `X-Twilio-Signature`. Validate with `twilio.validateRequest(authToken, signature, fullUrl, params)` using every received form field and the exact URL given to Twilio.
- The WebSocket upgrade request carries `X-Twilio-Signature`. Validate it against the exact `wss://` URL from the TwiML with `params = {}` before accepting the socket. Build the URL from `PUBLIC_BASE_URL`, never from the `Host` header. (Community-confirmed: https://github.com/bbTwilio/twilio-websocket-security)

## Latency

- No first-token timeout exists. Silence lasts until the first `text` frame.
- Stream LLM tokens as they arrive.
- While waiting for the owner, send a holding line ("Still checking with Maya, thanks for holding.") every 15 seconds so the business does not hang up.

## Samples

- Outbound, TypeScript, Zod-typed frames: https://github.com/deshartman/simple-conversation-relay
- Official TypeScript sample: https://github.com/twilio-samples/cr-dify
