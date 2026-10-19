# Video script: Ambient, "Alexa, handle the call"

Target: 2:40 by the per-beat budget below. The hard cap is 2:55, under the 3:00 limit. English, public YouTube. No third-party music or trademarks. The final URL goes into `docs/submission.md` at [VIDEO URL].

There is no phone dial-out in this version, so no real phone rings. The business answers on a web link that a phone browser opens like an incoming call.

## Draft cut

`python scripts/render-video.py` renders a draft of this video from the simulator into `.ambient/video/ambient-draft.mp4`. It starts three fresh zero-key demo servers at half the demo speed, records the single call, the call-around and the "Try to fool it" panel, and cuts them by event marks with ffmpeg. It adds the captions, the title cards, the montage stills and the "simulated" label. The draft runs about 2:04 and has no voice, because the simulator's speech is not recorded. Use it as the fallback video, or as a cut guide for the take with a voiceover. A contact sheet of the draft, one frame every 3 seconds, and three full-size frames were checked by eye on 2026-10-19.

## What each beat needs

- **HW**: the owner's Echo Dot or Echo Show, the custom skill deployed to a public HTTPS host, and a Voice Monkey token for the spoken cue. None of this has run yet.
- **KEYS**: `ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`, and a public HTTPS `PUBLIC_BASE_URL` in `.env`, then `pnpm call`.
- **None**: runs today with zero keys through `pnpm demo` (the `/sim` page) or `pnpm smoke:mcp`.

If the hardware path is not ready on recording day, shoot the whole video on the simulator. The rules allow a simulated Alexa+ experience if the video shows it clearly. Keep this caption on screen for every simulated beat: **"Simulated business and Alexa+ host. Every action is a real MCP tool call."**

The lines below are the exact words the zero-key demo produces today (`docs/demo/smoke-transcript.txt`). A live call will word things differently. In the demo the time is spoken as "Tuesday the 20th at 10 am" in asks, read-backs, and reports. Joe says "at ten" in conversation.

## Timing

The read time is an estimate: 3 spoken words per second, plus 0.3 seconds between lines. Time the real take before upload. Lines marked **CUT** stay in the transcript on screen but are not spoken or played in the video.

The video opens on the refusal, because that one exchange shows the idea. Then it shows the three moments from the README in order, and puts the other features in one montage.

| Beat | Window | Seconds | Spoken words kept | Estimated read |
|---|---|---|---|---|
| 1. Cold open: the refusal | 0:00 to 0:13 | 13 | 34 | 11.9 s |
| 2. The idea | 0:13 to 0:21 | 8 | 22 | 7.6 s |
| 3. The ask and the disclosure | 0:21 to 0:35 | 14 | 40 | 13.9 s |
| 4. Over the limit | 0:35 to 0:53 | 18 | 44 | 15.3 s |
| 5. The owner counters | 0:53 to 1:15 | 22 | 38 | 13.3 s, plus a 3 s card hold |
| 6. The clean yes and the proof | 1:15 to 1:35 | 20 | 38 | 13.3 s, plus the proof card |
| 7. Call around, one call in Spanish | 1:35 to 2:05 | 30 | 41 | 15.0 s, plus the board and the proof card |
| 8. Montage: everything else | 2:05 to 2:21 | 16 | 25 | 8.3 s, over four 3 s cards |
| 9. How it works | 2:21 to 2:33 | 12 | 22 | 7.3 s |
| 10. End card | 2:33 to 2:40 | 7 | 0 | 0 |

The total is 2:40. That leaves 20 s of slack under the 3:00 limit. If a take runs long, cut the montage to three cards first.

## Beats

### 1. Cold open: the refusal (0:00 to 0:13)

- Screen: the `/sim` transcript at the read-back (`docs/media/sim-refused.png`). No title yet.
- Ambient: "Okay, so just to confirm, one hundred sixty dollars total, Tuesday the 20th at 10 am. Is that right?"
- Joe: "Yes, plus parts."
- Ambient: "Sorry, I need one total price. What is the total with parts?"
- Caption: **"It will not take a false yes."**
- Needs: none on the sim path. This is the exchange from beat 6, shown first.

### 2. The idea (0:13 to 0:21)

- Screen: "Ambient. Alexa, handle the call." over the `/sim` idle view (`docs/media/sim-idle.png`).
- Voiceover (22 words): "Nobody wants to call the plumber. Ambient lets Alexa make the call, and it cannot lie for you or be lied to."
- Needs: none.

### 3. The ask and the disclosure (0:21 to 0:35)

- Owner, to the Echo Dot: "Alexa, tell Ambient to call Joe's Plumbing about the kitchen sink. Keep it under one fifty."
- Fallback: in `/sim`, tap "Call Joe's Plumbing".
- Screen: the business answer page on a second phone (`docs/media/call-business-ringing.png`), labelled "AI assistant". In the fallback, the transcript column in `/sim`.
- Ambient: "Hi, this is an AI assistant calling for Maya. This call is transcribed." Keep it audible. Caption: **"The first words say it is an AI."**
- Joe: "Oh, okay. Joe's Plumbing, this is Joe. How can I help?" **CUT**
- Joe: "It'll be one eighty for the call-out and the repair."
- Needs: HW for the voice ask. KEYS and a second device for the live path. None for the fallback.

### 4. Over the limit (0:35 to 0:53)

- Ambient, to Joe: "One moment, let me check with Maya."
- Echo Dot: "Joe's Plumbing wants one hundred eighty dollars for Tuesday the 20th at 10 am. Your limit is one hundred fifty dollars. Say yes to book it, offer a price like one fifty, or say no."
- Echo Show card: "Fix the kitchen sink", "$180 · Tuesday the 20th at 10 am", "$30 over your $150 limit", with "Book $180 · Tells them yes", "Offer $150 · Your limit", and "Decline · Ambient hangs up" (`docs/media/sim-card-hero.png`). Show the card while the Echo Dot speaks.
- Fire TV: the film pauses and dims, "Film paused · the call needs you", with "Over your limit $180" in the corner (`docs/media/sim-needs-you.png`).
- Needs: HW for the Echo. The card renders in `/sim` without hardware.

### 5. The owner counters, and Joe counters back (0:53 to 1:15)

- Owner: tap "Offer $150 · Your limit". Or say "Alexa, tell Ambient offer one fifty."
- Ambient, to Joe: "Okay, thanks for waiting. Could you do one fifty?"
- Joe: "One fifty is too low for me. I could do one sixty."
- Echo Show: the card asks again, "Book $160 · Tells them yes" (`docs/media/sim-countered.png`). Hold it for about 3 s. Caption: **"A counter goes back to the owner."**
- Owner: tap "Book $160". Or say "Alexa, tell Ambient to book it."
- Joe: "Hmm, one sixty. Alright, that works. I'll put you down for Tuesday the 20th at 10 am."
- Needs: HW for voice. None for the card taps.

### 6. The clean yes and the proof (1:15 to 1:35)

- Screen: a fast pass over the refusal from beat 1, then the second read-back.
- Ambient: "Let me say it back, one hundred sixty dollars total, Tuesday the 20th at 10 am. Is that right?"
- Joe: "Yes, that's right. See you then."
- Alexa: "Joe's Plumbing confirmed Tuesday the 20th at 10 am for one hundred sixty dollars."
- Echo Show: the check draws itself. The card reads "Booked · confirmed by Joe's Plumbing" and quotes the read-back and Joe's yes with their times (`docs/media/sim-confirmed.png`). Tap "Hear them say yes". On a live call it plays that moment from the call recording. In the simulator it speaks both lines, because the simulator has no recording. Caption: **"Every booking keeps proof of the yes."**
- Needs: none on the sim path. KEYS for the recorded clip.

### 7. Call around, one call in Spanish (1:35 to 2:05)

- Owner: "Alexa, get quotes from plumbers to fix the kitchen sink, under 150." Or tap "Get 3 quotes at once".
- Echo Show: "Call all three at once?" Tap "Call all three" (`docs/media/around-ask.png`).
- Echo Show: three tiles ring, then go to "On the phone". Quotes land as $140, $125 and $120 (`docs/media/around-quotes.png`). Hold on the board for about 3 s.
- Ambient, to Plomería Ruiz: "Muy bien, para confirmar, ciento veinte dólares en total, el martes 20 a las 9 de la mañana. ¿Es correcto?" Caption: **"The cheapest plumber speaks Spanish. Ambient discloses, reads back and books in Spanish."**
- Plomería Ruiz: "Sí, correcto."
- Ambient, to Pete's Pipes: "Thanks so much for the quote. Maya is going with another option this time. Bye." **CUT**
- Alexa: "Plomería Ruiz confirmed Tuesday the 20th at 9 am for one hundred twenty dollars."
- Echo Show: "Cheapest of 3 quotes ($140 passed, $125 passed), within your $150 limit.", with the Spanish read-back and its English line (`docs/media/around-booked.png`, `docs/media/around.gif`).
- Needs: none on the sim path (`pnpm smoke:around` checks it). A live run would need three business links answered at once.

### 8. Montage: everything else (2:05 to 2:21)

Four cards, about 3 s each, each with one caption. The voiceover runs over them.

- Voiceover (25 words): "It tells you when nothing was booked. The business gets a receipt in its own language. A business that says stop is never called again."
- Card 1: a call that ends before a yes, "Not booked" and "Nothing was booked." (`docs/media/sim-unconfirmed.png`). Caption: **"No yes, no booking."**
- Card 2: the business's call page with "Booked for Maya: $160 total, Tuesday the 20th at 10 am." (`docs/media/call-business-receipt.png`). Caption: **"The business gets a receipt."**
- Card 3: the Spanish call page, "Llamada entrante" (`docs/media/call-business-ringing-es.png`). Caption: **"The business sees its own language."**
- Card 4: the moved booking (`docs/media/sim-moved.png`). Caption: **"Alexa, move the plumber to Thursday."**
- Needs: none.

### 9. How it works (2:21 to 2:33)

- Screen: `docs/media/architecture.png`.
- Voiceover (22 words): "One pure function decides every word Ambient says on the call. Alexa reaches it through MCP. AssemblyAI carries the voice. Claude thinks."
- On-screen caption for the whole beat: **"This demo run is simulated. The live voice line and the Claude brain are built but not yet run live."** The voiceover describes the design. In the demo run, neither AssemblyAI nor Claude executes.
- Needs: none.

### 10. End card (2:33 to 2:40)

- Screen: "Ambient. Alexa, handle the call." and the repo URL [PUBLIC REPO URL].
- Needs: none.

## Production notes

- Beats 3, 4, and 5 need the owner's Echo hardware for the voice parts. If the skill is not deployed in time, shoot the fallback and keep the simulated caption on screen.
- Keep the AI disclosure audible in every take. It is the product's first rule.
- Check the audio mix before upload. The voiceover and the Echo must both be clear.
