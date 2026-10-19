# Video script: Ambient, "Alexa, handle the call"

Target: 2:25, well under the 3:00 limit. English, public YouTube. No third-party music or trademarks. The final URL goes into `docs/submission.md` at [VIDEO URL].

There is no phone dial-out in this version, so no real phone rings. The business answers on a web link that a phone browser opens like an incoming call.

## What each beat needs

- **HW**: the owner's Echo Dot or Echo Show, the custom skill deployed to a public HTTPS host, and a Voice Monkey token for the spoken cue. None of this has run yet.
- **KEYS**: `ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`, and a public HTTPS `PUBLIC_BASE_URL` in `.env`, then `pnpm call`.
- **None**: runs today with zero keys through `pnpm demo` (the `/sim` page) or `pnpm smoke:mcp`.

If the hardware path is not ready on recording day, shoot the whole video on the simulator. The rules allow a simulated Alexa+ experience if the video shows it clearly. Keep this caption on screen for every simulated beat: **"Simulated business and Alexa+ host. Every action is a real MCP tool call."**

The lines below are the exact words the zero-key demo produces today (`docs/demo/smoke-transcript.txt`). A live call will word things differently.

## Beats

### 1. The pain (0:00 to 0:08)

- Screen: the `/sim` idle card, "Nobody wants to make this call."
- Voiceover: "Nobody wants to call the plumber. So Alexa does it, honestly."
- Needs: none.

### 2. The ask (0:08 to 0:20)

- Owner, to the Echo Dot: "Alexa, tell Ambient to call Joe's Plumbing about the kitchen sink. Keep it under one fifty."
- Needs: HW.
- Fallback: in `/sim`, tap "Call Joe's Plumbing".

### 3. The call and the haggle (0:20 to 0:45)

- Screen: the business answer page on a second phone (`docs/media/call-business-ringing.png`), labelled "AI assistant". In the fallback, the transcript column in `/sim`.
- Ambient: "Hi, this is an AI assistant calling for Maya. This call is transcribed." Keep it audible.
- Joe: "Sure, we can come Tuesday at ten. It'll be one eighty for the call-out and the repair."
- Ambient: "Hmm, that's a bit more than we planned. Is there any room on the price?"
- Joe: "Best I can do is one eighty, honestly."
- Needs: KEYS and a second device for the live path. None for the fallback.

### 4. Over the limit (0:45 to 1:05)

- Ambient, to Joe: "One moment, let me check with Maya."
- Echo Dot: "Joe's Plumbing wants one hundred eighty dollars for Tuesday at ten. Your limit is one hundred fifty dollars. Book it, or offer less?"
- Echo Show card: "Fix the kitchen sink", "$180 · Tuesday at ten", "$30 over your $150 limit", with "Approve $180", "Offer $160 instead", and "Decline" (`docs/media/sim-needs-you.png`).
- Needs: HW for the Echo. The card renders in `/sim` without hardware.

### 5. The owner steers (1:05 to 1:20)

- Owner: "Alexa, tell Ambient offer one sixty." Or tap "Offer $160 instead".
- Alexa: "Okay, offering one hundred sixty dollars."
- Ambient, to Joe: "Thanks for waiting. Could you do it for one hundred sixty dollars?"
- Joe: "Hmm, one sixty. Alright, that works."
- Needs: HW for voice. None for the card tap.

### 6. The read-back, then the report (1:20 to 1:40)

- Ambient: "Just to confirm: one hundred sixty dollars total, Tuesday at ten. Is that right?"
- Joe: "Yes, that's right."
- Alexa: "Joe's Plumbing confirmed Tuesday at ten for one hundred sixty dollars."
- Echo Show: the check draws itself; the card says Ambient read back the total and the time (`docs/media/sim-confirmed.png`).
- Show this beat uncut. The clean-yes rule is the strongest honesty evidence.

### 7. The honest failure (1:40 to 2:00)

- Start a second call. End it before Joe confirms.
- Alexa: "You ended the call before Joe's Plumbing confirmed. Nothing was booked."
- Echo Show: "Not confirmed", with Joe's last words quoted (`docs/media/sim-unconfirmed.png`).
- Needs: none on the sim path.

### 8. How it works (2:00 to 2:15)

- Screen: `docs/media/architecture.png`.
- Voiceover (22 words): "One pure function decides every word Ambient says on the call. Alexa reaches it through MCP. AssemblyAI carries the voice. Claude thinks."
- Needs: none.

### 9. End card (2:15 to 2:25)

- Screen: "Ambient. Alexa, handle the call." and the repo URL [PUBLIC REPO URL].
- Needs: none.

## Production notes

- Beats 2, 4, and 5 need the owner's Echo hardware for the voice parts. If the skill is not deployed in time, shoot the fallback and keep the simulated caption on screen.
- Keep the AI disclosure audible in every take. It is the product's first rule.
- Check the audio mix before upload. The voiceover and the Echo must both be clear.
