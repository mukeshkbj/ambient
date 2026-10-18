# Phase 9: Sim around a live call

[Back to overview](overview.md)

## Goal

A judge who runs `pnpm demo` and opens `/sim` understands the product in ten seconds: a call is happening, the business is talking, the call needs you, you answer. Load `design-engineering` and `emil-design-eng`. Verify by looking at screenshots, not by reading code.

## Changes

1. `web/sim/index.html` (rebuild): one page, three regions.
   - **The call.** A phone card: business name, call timer, a live transcript with speaker labels (Agent, Joe's Plumbing, You), and the outcome badge at the end (`confirmed` green, `unconfirmed` amber with its sentence).
   - **The room.** Device frames: Echo Dot (light ring states: blue listening, yellow needs-you, green done), Echo Show 8 card, Fire TV corner card over a neutral placeholder. Each renders the same `ui://ambient/task` card at its aspect ratio.
   - **You.** A push-to-talk button (Web Speech) and quick replies: "Approve", "Deny", "Offer…", "How's it going?", "Hang up". Each calls an MCP tool through `/sim/api/tool` (`approve`, `delegate` for steer, `status`, `stop`).
2. `src/task-view.ts`: the task card shows the stake first ("$180 · Joe's Plumbing · Tuesday 10am"), the question, and the outcome. One place per approval, no duplicate popups.
3. `src/sim.ts`: `run` events carry `steps` (the transcript lines) and `outcome`. Remove the 60-second auto-decline of elicitations; a call waits as long as the hold line keeps the business on.
4. A "Start demo call" button that delegates "Call Joe's Plumbing and book a visit tomorrow, keep it under 150".
5. Respect `prefers-reduced-motion`. Keyboard reachable. No gradient-purple, no emoji bullets. No third-party trademarks or imagery.
6. `scripts/shots-sim.py`: capture idle, ringing, talking, needs-you (yellow ring and card), steered, confirmed, unconfirmed. Save to `docs/media/`.

## Data structures

SSE `run` event: `{ runId, status, steps: string[], approval?: { id, question, amountUsd?, kind }, outcome?: CallOutcome }`.

## Verification

- Static: `pnpm scan` green.
- Runtime: `pnpm demo`, run `python scripts/shots-sim.py`, then look at every screenshot. Iterate until a person who has never seen the product can say what is happening from the needs-you shot alone. Ask one reviewer subagent with the `design-slop` skill to audit the shots.

## Done when

All seven screenshots exist and pass the audit, and one commit lands: "Rebuild the sim around a live call".
