# SPEC: "Plus parts."

1920x1080, 30 fps, 36.5 s. Storyline A from `STORYLINES.md`, revised after the analysis of 22 reference films in `~/honey/ambient-launch-refs/analysis/`.

## What the research changed

- All 22 films score low on story and emotion. Only Poke has a person with a stake. Ambient has one: Maya, her budget, and a stranger on the phone who tries an old trick.
- The best films turn the idea into one object. Ambient's object is the price. It rolls $180, $150, $160. The plumber tries to attach "+ parts" to it. Ambient strips the tag off.
- One repeated move makes a film look designed. Ours is the rolling price figure. It appears at the open, at each negotiation step and at the payoff.
- Weak hooks open on a statement. Ours opens inside the call, at the trap, with a voice at 0.15 s.
- Sonnet 5.5 ends a run of fast cuts with one long hold. Opus 5.5 opens and closes on one image. We close on the same $160 figure that opens the film, now locked as "total".

## Type

- Dialogue: Newsreader, regular 400, opsz 72. Hook line 200 px. Body lines 96 px. Tracking -0.03em at 200 px, -0.02em at 96 px. Upright only.
- Price figure: Newsreader 400, 360 px, tabular figures, tracking -0.04em.
- Labels: Segoe UI 600, 24 px, uppercase, tracking 0.08em.
- Claim: Newsreader 400, 120 px, two lines.
- Words of a spoken line arrive in time with the voice, one word at a time.

## Colour

- Ground: radial graphite, #1d1b19 at the centre to #100f0e at the edge. No other background.
- Ink: #f1ece3. Muted label: #8f8a82.
- Joe and the trap: amber #ffb44a.
- Ambient: blue #a9c6ff text, #6ea8ff label.
- Booked: green #4fd18b, only from the payoff onward.

## Motion

- Arrivals: expo.out, 0.5 to 0.7 s. Exits: power2.in, 0.3 s.
- Price roll: each digit turns on its own wheel, 0.55 s, power3.inOut, digits staggered 0.04 s.
- Device cards scale from 0.94 to 1 with opacity, expo.out 0.6 s. Once landed, a title or card stays still.
- Transition kinds (four): hard cut on a sound event, match cut on the ring shape, the call-timer rewind, the price push-in.
- Every cut lands on a sound event: a word onset, a ring, a tap or a stop-down.

## Sound

- Two phone voices (Joe: Kokoro am_michael; Ambient: af_heart), band-passed 300 to 3400 Hz. Maya speaks in the room (af_bella), full band.
- Original score generated locally with MusicGen. No third-party music. The bed stays low under speech and rises at the payoff.
- Effects from the earshot bank, only on visible actions: ring, tap, digit ticks, rewind, stop-down, booked impact.
- Master: about -14 LUFS integrated, true peak at or below -1 dBTP.

## Rules

- Every number, line and screen comes from the demo call or the real UI captures. Nothing is invented.
- The Echo Show host is simulated; a label says so whenever the device is on screen.
- No Amazon or Alexa logo. The word "Alexa" is spoken once, as the wake word.

BANNED: glow, purple or blue gradients, a dark void with small floating cards, cream paper, italic accent words, fade and slide up as the default arrival, three cards in a row, a docked logo, stock footage, emoji, a generic "AI" sparkle.
