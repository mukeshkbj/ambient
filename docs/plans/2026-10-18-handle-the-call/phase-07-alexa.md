# Phase 7: Alexa (call intents and the cue)

[Back to overview](overview.md)

## Goal

From the Echo Dot, the user can start a call, hear that it needs them, answer, steer, and hear the outcome. Read [reference-alexa.md](reference-alexa.md) first.

## Changes

1. `alexa/interaction-model.en-US.json` (and en-GB): replace the model with call-focused intents. One `AMAZON.SearchQuery` slot per intent, never beside another slot, every sample with a carrier phrase.

| Intent | Slot | Samples |
|---|---|---|
| `StartCallIntent` | `task` (SearchQuery) | "call {task}", "to call {task}", "find {task}", "handle {task}", "get me {task}" |
| `SteerCallIntent` | `message` (SearchQuery) | "tell him {message}", "tell her {message}", "tell them {message}", "say {message}", "offer {message}" |
| `OfferAmountIntent` | `amount` (`AMAZON.NUMBER`) | "offer {amount}", "offer {amount} dollars", "say {amount} dollars" |
| `CallStatusIntent` | none | "how's the call going", "what's happening", "what did they say", "what's up" |
| `HangUpIntent` | none | "hang up", "end the call" |
| `AMAZON.YesIntent`, `AMAZON.NoIntent` | none | built in; mean approve and deny |
| `RespondApprovalIntent` | `decision` (custom: approve, deny) | "{decision}", "{decision} it" |

   The invocation name stays `ambient`. Remove every v1 intent and the `AssistantName` slot type.
2. `src/alexa.ts`: rewrite the intent switch for the table above.
   - Every handler that needs a run falls back to the active call: the newest run of the caller runtime in a non-terminal status. Session attributes are a hint, never required.
   - `StartCallIntent` calls `engine.ask(task, undefined, true, { waitMs })` and speaks the first state ("Calling Joe's Plumbing now. I'll tell you if they need you.").
   - `SteerCallIntent` and `OfferAmountIntent` call `engine.steer` ("offer 160 dollars"), then speak "Told them."
   - Yes, No, and `RespondApprovalIntent` resolve the newest open approval of the active call.
   - `CallStatusIntent` speaks the pending question if one exists, else the last business line, else the outcome.
3. `src/cue.ts`:
   - `type Cue = { needsYou(question: string): Promise<void> }`.
   - `voiceMonkeyCue({ token, device, fetch })` posts to `/announce` with `speech` = the question plus "Say: Alexa, tell Ambient approve, or tell Ambient offer a number."
   - `proactiveEventsCue({ clientId, clientSecret, fetch, now })` gets an LWA token (cache it until 60 s before expiry) and posts the `MessageAlert` multicast body from the reference.
   - `combinedCue(cues)` calls all and logs failures without throwing.
4. `src/server.ts` (startup wiring): subscribe to engine run changes; when a run enters `waiting_approval` with a new approval id, call `cue.needsYou(approvalAsk(view))` once per approval.
5. Skill manifest (`alexa/skill.json`, new): the notifications permission and `events.publications` for MessageAlert. If the console rejects an HTTPS `events.endpoint`, record it in `docs/friction-log.md` with the exact error and ship Voice Monkey alone.
6. `src/config.ts`: `VOICEMONKEY_TOKEN`, `VOICEMONKEY_DEVICE`, `ALEXA_CLIENT_ID_EVENTS`, `ALEXA_CLIENT_SECRET_EVENTS`, all optional; each cue is enabled only when its keys are set.

## Tests (write first, run red)

`test/alexa.test.ts` (rewrite) and `test/cue.test.ts`:

1. `StartCallIntent` with task "a plumber for tomorrow" starts a run on the caller runtime.
2. `SteerCallIntent` in a fresh session (no attributes) steers the active call.
3. `OfferAmountIntent` with amount 160 steers with "offer 160 dollars".
4. `AMAZON.YesIntent` in a fresh session approves the newest open approval of the active call.
5. With no active call, `SteerCallIntent` says "There's no call in progress."
6. `voiceMonkeyCue` posts the exact JSON body to the announce URL (fake `fetch`).
7. `proactiveEventsCue` requests one token for two events within its lifetime, and the event body has `relevantAudience.type` "Multicast" and an `expiryTime` 10 minutes after `now`.
8. The startup wiring calls `needsYou` once per new approval, not once per run change.
9. Every spoken string in these tests passes the UUID-regex check.

## Verification

- Static: `pnpm scan` green.
- Runtime on the Echo Dot (needs phase 0 step 1 to have passed): import the new model, build it, and confirm zero build errors. Then with the simulated line: "Alexa, tell Ambient to call Joe's Plumbing" starts the call; the Voice Monkey cue speaks the question; "Alexa, tell Ambient offer one sixty" steers; "Alexa, ask Ambient how's the call going" speaks the outcome. Record the cue delay and each utterance Alexa misheard (Alexa app Activity) in `progress.md`.

## Done when

The nine tests pass, the Echo Dot run is recorded, and one commit lands: "Alexa call intents and the needs-you cue".
