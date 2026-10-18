import { describe, expect, it } from "vitest";
import { startCall, step, type CallState } from "../src/calls/session.js";
import { parsePhoneNumber, type CallBrief, type CallInput } from "../src/calls/types.js";

const LIMIT = 150;

const brief: CallBrief = {
  goal: "Book a plumber visit to fix a leaking kitchen sink",
  business: { name: "Joe's Plumbing", phone: parsePhoneNumber("4155550134") },
  ownerName: "Maya",
  maxUsd: LIMIT,
  facts: ["The address is 12 Elm Street"]
};

function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

type Pick = <T>(items: readonly T[]) => T;

const QUOTES = [
  (n: number) => `It'll be $${n}.`,
  (n: number) => `Sure, it's ${n} dollars for the job.`,
  (n: number) => `That's $${n} for Tuesday at three.`,
  (n: number) => `We charge $${n}, and we're at 4500 Main Street.`,
  (n: number) => `It's $${n}. Call 555-1212 if you need us.`,
  (n: number) => `The fee is $${n}, unit 300.`
] as const;
const REPLIES = ["Yes.", "Sure, that works.", "Yeah, no, that's too low.", "Absolutely not.", "Okay, let me check with my manager.", "Got it, Tuesday works.", "100 Oak. Yes sure.", "Sorry, we're booked."] as const;
const AGENT = ["Okay. The address is 12 Elm Street.", "Could you do it for less?", "What time works?"] as const;

function playCall(seed: number) {
  const next = random(seed);
  const pick: Pick = items => items[Math.floor(next() * items.length)]!;
  const quoted = 50 + Math.floor(next() * 350);
  let state: CallState = startCall(brief, `call-${seed}`).state;
  let clock = 0;
  const said: number[] = [quoted];
  const run = (input: CallInput) => {
    clock += 1000;
    const resolved = input.kind === "brain" ? { ...input, turn: state.turn } : input;
    state = step(state, resolved, new Date(Date.UTC(2026, 9, 20, 17) + clock).toISOString()).state;
  };
  run({ kind: "answered" });
  run({ kind: "heard", text: pick(QUOTES)(quoted) });
  for (let round = 0; round < 3 && state.phase.kind !== "ended"; round += 1) {
    if (state.phase.kind === "waiting_for_owner") {
      run({ kind: "owner_decided", requestId: state.phase.requestId, decision: "deny" });
      continue;
    }
    if (next() < 0.5) run({ kind: "brain", turn: 0, step: { kind: "say", text: pick(AGENT), last: true } });
    run({ kind: "heard", text: pick(REPLIES) });
    const claim = pick([undefined, quoted, Math.max(1, quoted - 60), 12, 100, quoted + 40]);
    if (claim !== undefined) said.push(claim);
    run({ kind: "brain", turn: 0, step: { kind: "end_call", outcome: { kind: "confirmed", summary: "Booked Tuesday", ...(claim !== undefined ? { amountUsd: claim } : {}) } } });
  }
  return { state, quoted };
}

describe("honesty over generated calls", () => {
  it("never confirms over the limit, below the business's own quote, or without the owner when the owner always declines", () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 3000; seed += 1) {
      const { state, quoted } = playCall(seed);
      if (state.phase.kind !== "ended" || state.phase.outcome.kind !== "confirmed") continue;
      const amount = state.phase.outcome.amountUsd;
      const transcript = state.turns.map(turn => `${turn.speaker}: ${turn.text}`).join(" | ");
      if (amount === undefined) failures.push(`seed ${seed}: confirmed with no price: ${transcript}`);
      else if (amount > LIMIT) failures.push(`seed ${seed}: confirmed ${amount} over the limit: ${transcript}`);
      else if (amount < quoted && !state.turns.some(turn => turn.speaker === "business" && turn.text.includes(String(amount)))) {
        failures.push(`seed ${seed}: confirmed ${amount} below the quote ${quoted}: ${transcript}`);
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });
});
