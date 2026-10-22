# Film 3: the demo video, about 1:58

The Devpost demo video. The rules: under 3:00, English, no third-party music or trademarks. It must show the project on its intended platform. A simulated Alexa+ experience is allowed if the video clearly shows it. Judges are Amazon Alexa+ people. They score Tech Implementation, Design, Potential Impact and Quality of the Idea.

## The film in one line

Everyone puts off the call to the plumber. Ambient lets Alexa make it, and it is built so that you can trust it with your money. Then the film shows how far that goes.

## Hook (judges must relate in 3 s)

A phone lock screen. The reminder "Call the plumber about the sink" arrives, then is snoozed, and arrives again: Mon, Tue, Wed, Thu, Fri, Sat. The stack piles up fast with a tick per card. Then the line "Nobody wants to make this call." Then "Would you trust an AI to make it?" Then the story answers the question.

## Timeline (film seconds)

| Scene | id | Start | Length | What it shows |
|---|---|---|---|---|
| Hook | `hook` | 0.0 | 6.4 | The "Call the plumber" reminder snoozed Mon to Sat, then "Nobody wants to make this call." and "So Alexa makes it.", each spoken. |
| Story | video `assets/video/story.mp4` | 6.4 | 24.78 | Film 2 (v2-11) from 3.95 s to 28.73 s: the ask, the disclosure, $180 over the $150 limit, the offer, the $160 counter, "+ parts?" refused, booked with proof, the three rules. |
| Bridge | `bridge` | 31.18 | 2.2 | "That was one call." then "Now make it hard." |
| Try to fool it | `fool` | 33.38 | 13 | Four typed replies with the reducer's real verdicts, then 4,000 generated calls. |
| Three at once | `around` | 46.38 | 16 | Three plumbers rung at once, quotes land, the cheapest speaks Spanish, Ambient books in Spanish. |
| Every screen | `screens` | 62.38 | 14 | The same "needs you" card on Echo Show 8 and 15, Fire TV, a phone and voice only. |
| Honest edges | `honest` | 76.38 | 11 | No yes, no booking; the receipt; "stop calling" is final; "move it to Thursday". Narrated. |
| How it is built | `built` | 87.38 | 12 | Alexa skill and MCP, Claude proposes and the code decides, `step(state, input, now)`, 931 tests. Narrated. |
| The real thing | `real` | 99.38 | 12 | The real `/sim` call at 2x, full-bleed, then a push into the booked card. |
| End | `end` | 111.38 | 6.5 | "Alexa makes the call. You still decide.", spoken; `pnpm demo`. |

Total: 117.88 s.

## Look (inherit from film 2, do not invent a new one)

Source of truth: `launch/film2/index.html` (CSS at the top). Read it before you design.

- Ground: warm porcelain, `radial-gradient(75% 65% at 46% 34%, #fbf9f6 0%, #eee9e1 52%, #dad3c7 100%)` plus a soft warm "sun" at top left.
- Ink #15130f, secondary #777166, tertiary #a59e92.
- Ambient ring: conic gradient #5ad8ff, #3d7bff, #8a5cff. Amber #ff9f1c means "over the limit / needs you". Green #2fd37e means "booked / confirmed".
- Type: Inter for UI, numbers and labels (prices 600 weight, letter-spacing -0.045em to -0.055em, tabular nums). Newsreader only for the big statements (400, -0.02em). No other families.
- Devices are drawn in HTML: an Echo Show with a 14 px dark bezel, radius 52 / 38, two-layer warm shadow `0 2px 4px #140e062e, 0 48px 90px -24px #140e0661`; dark screens `radial-gradient(90% 75% at 10% 0%, #1b2a4a 0%, #0c1018 55%, #07090d 100%)`.
- The call pill (dark capsule, speaker label, words as they are said) is the language for spoken lines.
- Motion: state swaps 160 ms out (y -10, blur 3 px) and 320 ms in (y 12, blur 3 px, expo.out, 40 ms stagger). Press: scale .97, ripple, back.out spring. Numbers roll (odometer) rather than cut. Camera mostly still; one deliberate move per scene at most.
- Bar: recent.design launch films and inspora.design UI clips. Every frame must look designed: one focal point, generous space, nothing below 22 px at 1920x1080 except fine print, no text collisions, no empty dead frames longer than 0.4 s.

## Honesty

Every claim on screen must be true of the repo today. The business and the Alexa+ host are simulated, and the live voice line and Claude brain are built but have not run live. Real verdicts and numbers come from the code (`src/`), the demo transcripts (`docs/demo/`) or the simulator. No invented statistics.

## Sound

`tools/mix.py` places every voice and effect. Each scene file has a sibling `<id>.cues.json`: `{"lines": [{"file": "vo file stem in assets/vo", "at": local seconds, "text": "...", "band": "phone" | "room"}], "effects": [{"name": "sfx stem in assets/sfx", "at": local seconds, "gain": 0..1, "pan": -1..1}]}`. Voices are Kokoro through `npx hyperframes tts` (Joe am_michael, Ambient af_heart, Maya af_bella, Spanish voices ef_dora). The score is original MusicGen.
