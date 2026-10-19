# Errands: six features on two foundations

Date: 2026-10-19. Branch: `hackathon/household-consent`.

## Foundations

- **A. Errand.** A pure reducer `errandStep(state, input, now)` in `src/calls/errand.ts` owns one or more call sessions. It approves at most one booking and releases the others through the existing `ask_owner` hold, so the read-back and clean-yes rules stay the only way to book.
- **B. Call record.** The agreed terms, the transcript, and the start and end offset of each turn, stored with the call.

## Video storyboard (90 seconds, one beat per feature)

1. "Alexa, get me a plumber tomorrow morning under 150." Three call tiles ring on the Echo Show at once (call-around).
2. Quotes land on a comparison board. Ambient books the cheapest and releases the other two politely (call-around).
3. The film on the Fire TV pauses when a quote is over the limit; the Dot glows; the owner answers from the couch (the house reacts).
4. The third business answers in Spanish. Ambient discloses in Spanish; the owner reads English on the Show (another language).
5. Booked. The owner taps "Hear them say yes" and hears the read-back and the yes (proof of yes). The business screen shows the receipt (business receipt).
6. "Alexa, move the plumber to Thursday." Ambient calls back knowing the booking (follow-through).

## Invariants (each is a failing test before its code)

- An errand approves at most one call.
- An errand approves a quote only if it is within the limit or the owner said yes to that exact quote.
- Every quoted call that is not the winner is released.
- A quote that arrives after the winner is chosen is released.
- An errand with no quote ends with no booking.
- The disclosure is the first line in the business's language. The read-back in any language carries the same price and time.
- The proof clip spans exactly the accepted read-back and the yes.

## Kill rules

- Call-around: if three businesses cannot be held without one confirming early, degrade to parallel quotes and a sequential booking.
- Another language: if a native speaker rejects the disclosure or read-back, ship the language in the README only.
- Proof of yes: if per-turn offsets are not available from the line, ship the transcript excerpt with timestamps instead of audio.

## Order

A, call-around, follow-through. B, proof of yes, business receipt. The house reacts. Another language last.
