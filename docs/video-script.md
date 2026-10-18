# Video script: Ambient, "Alexa, handle the call"

Target: under 3:00, English, public YouTube. No third-party music or trademarks. The final URL goes into `docs/submission.md` at [VIDEO URL].

There is no phone dial-out in this version, so no real phone rings. Beat 3 is adapted: the business answers on a web link that a phone browser opens like an incoming call.

## What each beat needs

- **HW**: the user's Echo Dot or Echo Show, the custom skill deployed to a public HTTPS host, and a Voice Monkey token for the spoken cue. None of this has run yet.
- **KEYS**: `ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`, and a public https `PUBLIC_BASE_URL` in `.env`, then `pnpm call`.
- **None**: runs today with zero keys through `pnpm demo` (the `/sim` page) or `pnpm smoke:mcp`.

Each beat lists a fallback. If the hardware path is not ready on recording day, shoot the whole video on the simulator. The simulator is a real MCP client over loopback, so every action on camera is still a real tool call.

## Beats

### 1. The pain (0:00 to 0:10)

- Screen: the `/sim` idle card, or a shot of the kitchen Echo.
- Voiceover: "Nobody wants to call the plumber. So we taught Alexa to do it."
- Needs: none.

### 2. The ask (0:10 to 0:25)

- User, to the Echo Dot: "Alexa, tell Ambient to find a plumber for tomorrow under one fifty."
- Alexa replies and the call starts.
- Needs: HW + KEYS. Real business discovery uses web search and needs `ANTHROPIC_API_KEY`.
- Fallback: in `/sim` or `pnpm smoke:mcp`, send `delegate {"task":"Call Joe's Plumbing and book a visit to fix the kitchen sink, keep it under 150"}`.

### 3. The business answers (0:25 to 0:55)

- Adapted beat: no real phone rings. A second phone opens the business call link in its browser.
- Screen: the answer page shows an incoming call from Ambient, labeled "AI assistant" (`web/call/index.html`, screenshot `docs/media/call-business-ringing.png`).
- A family member taps answer and plays Joe, the plumber.
- The AssemblyAI agent speaks the disclosure word for word: "Hi, this is an AI assistant calling for Maya. This call is transcribed." Keep it audible.
- Needs: KEYS + one extra phone or laptop for the business page.
- Fallback: `pnpm demo` plays the same disclosure on the simulated line.

### 4. Over the limit (0:55 to 1:15)

- Joe quotes one hundred eighty dollars. The limit is one fifty.
- The Echo Dot speaks the question through Voice Monkey. A Proactive Events notification fires.
- The Echo Show card shows the stake first: "$180, Joe's Plumbing", with "Approve $180" and "Decline".
- Needs: HW + KEYS. The card alone renders in `/sim` without hardware.
- Fallback: the sim needs-you card (`docs/media/sim-needs-you.png` is the exact frame). Answer through the card or the `approve` tool.

### 5. The steer (1:15 to 1:35)

- User, to the Echo Dot: "Alexa, tell Ambient offer one sixty."
- The agent says the offer on the call moments later.
- Needs: HW + KEYS.
- Fallback: `delegate {"task":"offer 160"}`. The reply is "Okay, I'll tell Joe's Plumbing."

### 6. Confirmed, then reported (1:35 to 1:50)

- The agent reads the terms back: "Just to confirm: one hundred sixty dollars total, Tuesday at ten. Is that right?"
- Joe: "Yes."
- Alexa reports only the confirmed terms: "Joe's Plumbing confirmed Tuesday at ten for one hundred sixty dollars."
- Needs: HW + KEYS.
- Fallback: `status` in `pnpm smoke:mcp` prints the same line.

### 7. The honest failure (1:50 to 2:10)

- Start a second call. Joe hangs up mid-call. On the web-link path, close the business tab.
- Alexa reports: "The call ended before they confirmed, so I won't assume it's booked."
- Point of the beat: an unconfirmed call stays unconfirmed.
- Needs: none on the sim path (`docs/media/sim-unconfirmed.png` shows the end state). KEYS for the live path.

### 8. Memory (2:10 to 2:30)

- Start a third call to Joe's. The run opens with the remembered fact: "Remembered from Oct 18, confirmed, quoted one hundred sixty dollars." (In product copy this line uses a dash after the date.)
- Voiceover: "Next time, Ambient starts the call already knowing the last one."
- Needs: none on the sim path. KEYS for the live path. Memory is real SQLite, shown in `test/caller.test.ts`.

### 9. Architecture in fifteen seconds (2:30 to 2:45)

- Screen: `docs/media/architecture.png`.
- Voiceover: "An Alexa skill on slash alexa. An MCP server on slash mcp. One pure function decides every word on the call. The voice line is the AssemblyAI Voice Agent API, with our Claude brain behind a chat-completions shim. The AWS stack is prepared in CDK and not yet deployed."
- Needs: none.

### 10. End card (2:45 to 2:55)

- Screen: "Ambient. Alexa, handle the call." plus the repo URL [PUBLIC REPO URL].
- Needs: none.

## Production notes

- Beats 2, 4, and 5 are the only ones that strictly need the user's Echo hardware. If the skill is not deployed in time, shoot the fallback column and say so in the submission text.
- Keep the AI disclosure audible in every take. It is the product's first rule.
- Show the read-back in beat 6 uncut if possible. The clean-yes booking rule is the strongest honesty evidence.
- Check the audio mix before upload: voiceover and the Echo must both be intelligible.
