# Alexa reference: cue and call intents

Facts gathered from developer.amazon.com and voicemonkey.io on 2026-10-18. Items marked **UNVERIFIED** must be checked on the user's Echo Dot.

## The cue problem

No first-party API lets a custom skill speak free text unprompted. Two mechanisms exist:

| Mechanism | What the user experiences | Dynamic text | Effort |
|---|---|---|---|
| ASK Proactive Events, `AMAZON.MessageAlert.Activated` | Chime and pulsing yellow ring. Alexa speaks "You have 1 new unread message from Ambient" only when the user asks "what are my notifications". | No. Only `creator.name` is free text. | About 1 hour |
| Voice Monkey `/announce` | Alexa speaks the text immediately on the chosen Echo. | Yes | About 20 minutes of setup |

The plan uses Voice Monkey for the spoken cue and Proactive Events as the Amazon-native chime. Both are behind one `Cue` interface (phase 7).

## Voice Monkey

- `POST https://api-v3.voicemonkey.io/announce`
- Body: `{"token":"…","device":"<speaker id>","speech":"Maya, the plumber wants one hundred eighty dollars. Say: Alexa, tell Ambient approve, or tell Ambient offer a number."}`
- Optional: `chime` (a `soundbank://` URL), `voice`, `language`.
- Response: `{"success":true,"data":"OK"}`. Errors: 429 `THROTTLED`, 429 `MONTHLY_QUOTA_EXCEEDED`, 500 `ALEXA_TRIGGER_FAILED`.
- Setup: enable the Voice Monkey skill in the Alexa app, create a Speaker, wire it to the Echo Dot with a routine.
- Free plan: 200 requests per month. Enough for the hackathon.
- Terms: "provided 'as is'". Latency is **UNVERIFIED**; measure it in phase 7.

## Proactive Events

- Token: `POST https://api.amazon.com/auth/o2/token` with `grant_type=client_credentials`, the skill's client id and secret, `scope=alexa::proactive_events`.
- Event: `POST https://api.amazonalexa.com/v1/proactiveEvents/stages/development` with `Authorization: Bearer <token>`. Success is 202.
- Body:

```json
{
	"timestamp": "2026-10-18T22:10:01.00Z",
	"referenceId": "call-123-q1",
	"expiryTime": "2026-10-18T22:20:01.00Z",
	"event": {
		"name": "AMAZON.MessageAlert.Activated",
		"payload": {
			"state": { "status": "UNREAD", "freshness": "NEW" },
			"messageGroup": { "creator": { "name": "Ambient" }, "count": 1 }
		}
	},
	"localizedAttributes": [{ "locale": "en-US" }],
	"relevantAudience": { "type": "Multicast", "payload": {} }
}
```

- `expiryTime` must be 5 minutes to 24 hours ahead. `referenceId` must be unique per event.
- Manifest needs `permissions: [{ "name": "alexa::devices:all:notifications:write" }]` and `events.publications: [{ "eventName": "AMAZON.MessageAlert.Activated" }]`.
- The doc shows only Lambda ARNs for `events.endpoint`. Whether an HTTPS endpoint is accepted is **UNVERIFIED**. If the console rejects it, record the failure in the friction log and ship Voice Monkey alone.
- The user must enable notifications for the skill in the Alexa app.
- Use `Multicast`. The user id changes when the skill stage changes, so unicast ids go stale.

## Custom skill rules that shape the interaction model

- At most one `AMAZON.SearchQuery` slot per intent, and it cannot share an utterance with another slot. Every sample needs a carrier phrase. The current model breaks this rule (`ask {assistant} {request}`), so phase 7 rewrites the model.
- One-shot forms work without a connecting word: "Alexa, tell Ambient approve", "Alexa, tell Ambient offer one sixty".
- A skill must return a full response in about 8 seconds. Up to five progressive responses can be sent before it.
- The mic stays open a few seconds after a response, plus a reprompt window.
- A fresh session opened by the user after a cue has no session attributes. Handlers must fall back to the active call.

## Testing on the Echo Dot

- The Echo Dot must be registered to the same Amazon account as the developer console.
- In the console, set **Test > Skill testing is enabled in** to **Development**.
- Alexa app **Activity** shows what Alexa heard.
- Alexa+ and custom skills: Amazon said in Feb 2025 that skills remain available on original Alexa and that Alexa+ invocation needs evaluation. Whether "Alexa, tell Ambient …" works on an Alexa+ Echo Dot is **UNVERIFIED**. Phase 0 tests it first.
