# Video script: Ambient, "Alexa, handle the call"

Target: 2:21 by the per-beat budget below. The hard cap is 2:25, well under the 3:00 limit. English, public YouTube. No third-party music or trademarks. The final URL goes into `docs/submission.md` at [VIDEO URL].

There is no phone dial-out in this version, so no real phone rings. The business answers on a web link that a phone browser opens like an incoming call.

## What each beat needs

- **HW**: the owner's Echo Dot or Echo Show, the custom skill deployed to a public HTTPS host, and a Voice Monkey token for the spoken cue. None of this has run yet.
- **KEYS**: `ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`, and a public HTTPS `PUBLIC_BASE_URL` in `.env`, then `pnpm call`.
- **None**: runs today with zero keys through `pnpm demo` (the `/sim` page) or `pnpm smoke:mcp`.

If the hardware path is not ready on recording day, shoot the whole video on the simulator. The rules allow a simulated Alexa+ experience if the video shows it clearly. Keep this caption on screen for every simulated beat: **"Simulated business and Alexa+ host. Every action is a real MCP tool call."**

The lines below are the exact words the zero-key demo produces today (`docs/demo/smoke-transcript.txt`). A live call will word things differently. In the demo the time is spoken as "Tuesday the 20th at 10 am" in asks, read-backs, and reports. Joe says "at ten" in conversation.

## Timing

The read time is an estimate: 3 spoken words per second, plus 0.3 seconds between lines. Time the real take before upload. Lines marked **CUT** stay in the transcript on screen but are not spoken or played in the video.

| Beat | Window | Seconds | Spoken words kept | Estimated read |
|---|---|---|---|---|
| 1. The pain | 0:00 to 0:05 | 5 | 11 | 4.0 s |
| 2. The ask | 0:05 to 0:13 | 8 | 16 | 5.6 s |
| 3. The call and the haggle | 0:13 to 0:37 | 24 | 56 of 99 | 20.2 s |
| 4. Over the limit | 0:37 to 0:55 | 18 | 44 | 15.3 s |
| 5. The owner counters | 0:55 to 1:20 | 25 | 59 of 101 | 21.5 s, plus a 3 s card hold |
| 6. The read-back and a refusal | 1:20 to 1:36 | 16 | 32 | 11.6 s, plus the uncut hold on the refusal |
| 7. Read again, then the report | 1:36 to 1:55 | 19 | 52 of 64 | 18.5 s |
| 8. The honest failure | 1:55 to 2:04 | 9 | 11 | 4.0 s, plus the second call and the card |
| 9. How it works | 2:04 to 2:14 | 10 | 22 | 7.3 s |
| 10. End card | 2:14 to 2:21 | 7 | 0 | 0 |

Beat 3 now has about 3.8 s of slack, because Joe's "Sure, we can come" line is cut by default. Beat 7 has the least slack. If a take runs long, cut Joe's "Fair enough" line in beat 7. If a take has room, restore Joe's "Sure, we can come" line in beat 3, which adds about 3.3 s and returns the estimate to 23.5 s.

## Beats

### 1. The pain (0:00 to 0:05)

- Screen: the `/sim` idle card, "Nobody wants to make this call."
- Voiceover: "Nobody wants to call the plumber. So Alexa does it, honestly."
- Needs: none.

### 2. The ask (0:05 to 0:13)

- Owner, to the Echo Dot: "Alexa, tell Ambient to call Joe's Plumbing about the kitchen sink. Keep it under one fifty."
- Needs: HW.
- Fallback: in `/sim`, tap "Call Joe's Plumbing".

### 3. The call and the haggle (0:13 to 0:37)

- Screen: the business answer page on a second phone (`docs/media/call-business-ringing.png`), labelled "AI assistant". In the fallback, the transcript column in `/sim`. Cut between lines.
- Ambient: "Hi, this is an AI assistant calling for Maya. This call is transcribed." Keep it audible.
- Joe: "Oh, okay. Joe's Plumbing, this is Joe. How can I help?"
- Ambient: "Hi Joe. I'd like to book a visit to fix a leaking kitchen sink. The address is 12 Elm Street. When could you come?" **CUT** (24 words, about 8 s)
- Joe: "Sure, we can come Tuesday the twentieth at ten." **CUT** by default; optional. The day and time are stated in beat 4.
- Ambient: "Tuesday the twentieth at ten works. What would it cost?" **CUT**
- Joe: "It'll be one eighty for the call-out and the repair."
- Ambient: "Hmm, okay. Is there any room on the price?"
- Joe: "Best I can do is one eighty, honestly. Parts went up this year."
- Needs: KEYS and a second device for the live path. None for the fallback.

### 4. Over the limit (0:37 to 0:55)

- Ambient, to Joe: "One moment, let me check with Maya."
- Echo Dot: "Joe's Plumbing wants one hundred eighty dollars for Tuesday the 20th at 10 am. Your limit is one hundred fifty dollars. Say yes to book it, offer a price like one fifty, or say no."
- Echo Show card: "Fix the kitchen sink", "$180 · Tuesday the 20th at 10 am", "$30 over your $150 limit", with "Book $180 · Tells them yes", "Offer $150 · Your limit", and "Decline · Ambient hangs up" (`docs/media/sim-card-hero.png`). Show the card while the Echo Dot speaks.
- Needs: HW for the Echo. The card renders in `/sim` without hardware.

### 5. The owner counters, and Joe counters back (0:55 to 1:20)

- Owner: "Alexa, tell Ambient offer one fifty." Or tap "Offer $150 · Your limit".
- Alexa: "Okay, offering one hundred fifty dollars. Say status to hear their answer."
- Ambient, to Joe: "Okay, thanks for waiting. Could you do one fifty?"
- Joe: "One fifty is too low for me. I could do one sixty."
- Echo Show: the card asks again, "Book $160 · Tells them yes" (`docs/media/sim-countered.png`). Hold it for about 3 s.
- Alexa: "Joe's Plumbing turned down your offer and is holding at one hundred sixty dollars, over your limit of one hundred fifty dollars. Say yes to book it, offer a price like one fifty, or say no." **CUT** (the card carries it)
- Owner: "Alexa, tell Ambient approve." Or tap "Book $160". The owner approves a price over the limit on purpose; nothing above the limit books without this step.
- Screen: the transcript shows the owner's note "Maya: Approved: one hundred sixty dollars for Tuesday the 20th at 10 am". It is not spoken.
- Ambient, to Joe: "Okay, thanks for waiting. Maya says one sixty is fine. Please go ahead and book Tuesday at ten." **CUT**
- Joe: "Hmm, one sixty. Alright, that works. I'll put you down for Tuesday the 20th at 10 am."
- Needs: HW for voice. None for the card taps.

### 6. The read-back, and a refusal (1:20 to 1:36)

- Ambient: "Okay, so just to confirm, one hundred sixty dollars total, Tuesday the 20th at 10 am. Is that right?"
- Joe: "Yes, plus parts."
- Ambient: "Sorry, I need one total price. What is the total with parts?"
- Screen: the transcript at the refusal (`docs/media/sim-refused.png`). Nothing is booked.
- Show this beat uncut. A refusal on screen is the strongest honesty evidence.
- Needs: none on the sim path.

### 7. Read again, then the report (1:36 to 1:55)

- Joe: "Fair enough. A sink like that needs no parts, so that's all in."
- Ambient: "Sorry, just so I have it right, one hundred sixty dollars total, Tuesday the 20th at 10 am. Is that right?"
- Joe: "Yes, that's right. See you then."
- Ambient: "Great, Maya will expect you Tuesday the 20th at 10 am. Thanks so much, bye." **CUT**
- Alexa: "Joe's Plumbing confirmed Tuesday the 20th at 10 am for one hundred sixty dollars."
- Echo Show: the check draws itself; the card reads "Booked · confirmed by Joe's Plumbing" and says Ambient read back the total and the time (`docs/media/sim-confirmed.png`).

### 8. The honest failure (1:55 to 2:04)

- Start a second call. End it before Joe confirms.
- Alexa: "You ended the call before Joe's Plumbing confirmed. Nothing was booked."
- Echo Show: "Not booked" and "Nothing was booked.", with Joe's last words quoted under "Last from Joe's Plumbing" (`docs/media/sim-unconfirmed.png`).
- Needs: none on the sim path.

### 9. How it works (2:04 to 2:14)

- Screen: `docs/media/architecture.png`.
- Voiceover (22 words): "One pure function decides every word Ambient says on the call. Alexa reaches it through MCP. AssemblyAI carries the voice. Claude thinks."
- On-screen caption for the whole beat: **"This demo run is simulated. The live voice line and the Claude brain are built but not yet run live."** The voiceover describes the design. In the demo run, neither AssemblyAI nor Claude executes.
- Needs: none.

### 10. End card (2:14 to 2:21)

- Screen: "Ambient. Alexa, handle the call." and the repo URL [PUBLIC REPO URL].
- Needs: none.

## Production notes

- Beats 2, 4, and 5 need the owner's Echo hardware for the voice parts. If the skill is not deployed in time, shoot the fallback and keep the simulated caption on screen.
- Keep the AI disclosure audible in every take. It is the product's first rule.
- Check the audio mix before upload. The voiceover and the Echo must both be clear.
