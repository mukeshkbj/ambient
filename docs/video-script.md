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

### 1. The pain (0:00 to 0:06)

- Screen: the `/sim` idle card, "Nobody wants to make this call."
- Voiceover: "Nobody wants to call the plumber. So Alexa does it, honestly."
- Needs: none.

### 2. The ask (0:06 to 0:16)

- Owner, to the Echo Dot: "Alexa, tell Ambient to call Joe's Plumbing about the kitchen sink. Keep it under one fifty."
- Needs: HW.
- Fallback: in `/sim`, tap "Call Joe's Plumbing".

### 3. The call and the haggle (0:16 to 0:40)

- Screen: the business answer page on a second phone (`docs/media/call-business-ringing.png`), labelled "AI assistant". In the fallback, the transcript column in `/sim`. Cut between lines.
- Ambient: "Hi, this is an AI assistant calling for Maya. This call is transcribed." Keep it audible.
- Joe: "Oh, okay. Joe's Plumbing, this is Joe. How can I help?"
- Ambient: "Hi Joe. I'd like to book a visit to fix a leaking kitchen sink. The address is 12 Elm Street. When could you come?"
- Joe: "Sure, we can come Tuesday at ten."
- Ambient: "Tuesday at ten works. What would it cost?"
- Joe: "It'll be one eighty for the call-out and the repair."
- Ambient: "Hmm, okay. Is there any room on the price?"
- Joe: "Best I can do is one eighty, honestly. Parts went up this year."
- Needs: KEYS and a second device for the live path. None for the fallback.

### 4. Over the limit (0:40 to 1:00)

- Ambient, to Joe: "One moment, let me check with Maya."
- Echo Dot: "Joe's Plumbing wants one hundred eighty dollars for Tuesday at ten. Your limit is one hundred fifty dollars. Say approve to book it, offer an amount, or hang up."
- Echo Show card: "Fix the kitchen sink", "$180 · Tuesday at ten", "$30 over your $150 limit", with "Book $180 · Tells them yes", "Offer $150 · Your limit", and "Decline · Ambient hangs up" (`docs/media/sim-card-hero.png`).
- Needs: HW for the Echo. The card renders in `/sim` without hardware.

### 5. The owner counters, and Joe counters back (1:00 to 1:20)

- Owner: "Alexa, tell Ambient offer one fifty." Or tap "Offer $150 · Your limit".
- Alexa: "Okay, offering one hundred fifty dollars."
- Ambient, to Joe: "Thanks for waiting. Could you do one fifty?"
- Joe: "One fifty is too low for me. I could do one sixty."
- Echo Show: the card asks again, "Book $160 · Tells them yes" (`docs/media/sim-countered.png`). Alexa: "Joe's Plumbing is holding at one hundred sixty dollars, over your limit of one hundred fifty dollars. Say approve to book it, offer an amount, or hang up."
- Owner: "Alexa, tell Ambient approve." Or tap "Book $160". The owner approves a price over the limit on purpose; nothing above the limit books without this step.
- Ambient, to Joe: "Thanks for waiting. Maya says one sixty is fine. Please go ahead and book Tuesday at ten."
- Joe: "Hmm, one sixty. Alright, that works if you're my first job that morning. I'll put you down for Tuesday at ten."
- Needs: HW for voice. None for the card taps.

### 6. The read-back, and a refusal (1:20 to 1:40)

- Ambient: "Just to confirm: one hundred sixty dollars total, Tuesday at ten. Is that right?"
- Joe: "Yes, plus parts."
- Ambient: "Sorry, I can only book a total price. With parts, what's the total?"
- Screen: the transcript at the refusal (`docs/media/sim-refused.png`). Nothing is booked.
- Show this beat uncut. A refusal on screen is the strongest honesty evidence.
- Needs: none on the sim path.

### 7. Read again, then the report (1:40 to 1:50)

- Joe: "Fair enough. A sink like that needs no parts, so that's all in."
- Ambient: "Let me check once more: one hundred sixty dollars total, Tuesday at ten. Is that right?"
- Joe: "Yes, that's right. See you then."
- Ambient: "Great, Maya will expect you Tuesday at ten. Thanks, goodbye."
- Alexa: "Joe's Plumbing confirmed Tuesday at ten for one hundred sixty dollars."
- Echo Show: the check draws itself; the card says Ambient read back the total and the time (`docs/media/sim-confirmed.png`).

### 8. The honest failure (1:50 to 2:05)

- Start a second call. End it before Joe confirms.
- Alexa: "You ended the call before Joe's Plumbing confirmed. Nothing was booked."
- Echo Show: "Not confirmed", with Joe's last words quoted (`docs/media/sim-unconfirmed.png`).
- Needs: none on the sim path.

### 9. How it works (2:05 to 2:15)

- Screen: `docs/media/architecture.png`.
- Voiceover (22 words): "One pure function decides every word Ambient says on the call. Alexa reaches it through MCP. AssemblyAI carries the voice. Claude thinks."
- Needs: none.

### 10. End card (2:15 to 2:25)

- Screen: "Ambient. Alexa, handle the call." and the repo URL [PUBLIC REPO URL].
- Needs: none.

## Production notes

- Beats 2, 4, and 5 need the owner's Echo hardware for the voice parts. If the skill is not deployed in time, shoot the fallback and keep the simulated caption on screen.
- Keep the AI disclosure audible in every take. It is the product's first rule.
- Check the audio mix before upload. The voiceover and the Echo must both be clear.
