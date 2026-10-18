import { describe, expect, it } from "vitest";
import { startCall, step, type CallState } from "../src/calls/session.js";
import { parsePhoneNumber, type CallBrief, type CallInput } from "../src/calls/types.js";

function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const QUOTES = [
  (n: number) => `It'll be $${n}.`,
  (n: number) => `Sure, it's ${n} dollars for the job.`,
  (n: number) => `That's $${n} for Tuesday at three, and we're at 4500 Main Street.`,
  (n: number) => `Normally $${n + 60} but I can do $${n}.`,
  (n: number) => `$${n} labor, $${Math.round(n / 3)} parts.`,
  (n: number) => `Starting at $${n}, depending on the leak.`,
  (n: number) => `$${n} an hour, two hour minimum.`
] as const;

const CLEAN_YES = ["Yes, that's right.", "Yep, sorry, that's right.", "Yes, no problem.", "That'll work.", "Of course.", "Mm-hmm."] as const;
const NOT_YES = [
  "No, it's more than that.", "Yeah, no, that's too low.", "Absolutely not.", "Okay, let me check with my manager.", "Are you sure?", "Yes, plus parts.",
  "Yes, that's per hour.", "Sure, unless it's a bigger leak.", "Okay, 150.", "Yes. We're at 4500 Main Street.", "Sorry, we're booked.", "Hmm."
] as const;
const AGENT = ["Okay. The address is 12 Elm Street.", "Could you do it for less?", "What time works?"] as const;

type Reply = { text: string; clean: boolean };

function playCall(seed: number) {
  const next = random(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const limit = pick([undefined, 100, 150, 300]);
  const brief: CallBrief = {
    goal: "Book a plumber visit to fix a leaking kitchen sink",
    business: { name: "Joe's Plumbing", phone: parsePhoneNumber("4155550134") },
    ownerName: "Maya",
    ...(limit !== undefined ? { maxUsd: limit } : {}),
    facts: ["The address is 12 Elm Street"]
  };
  const quoted = 40 + Math.floor(next() * 400);
  let state: CallState = startCall(brief, `call-${seed}`).state;
  let clock = 0;
  const replies: Reply[] = [];
  const approved: (number | undefined)[] = [];
  const run = (input: CallInput) => {
    clock += 1000;
    const resolved = input.kind === "brain" ? { ...input, turn: state.turn } : input;
    state = step(state, resolved, new Date(Date.UTC(2026, 9, 20, 17) + clock).toISOString()).state;
  };
  run({ kind: "answered" });
  run({ kind: "heard", text: pick(QUOTES)(quoted) });
  for (let round = 0; round < 6 && state.phase.kind !== "ended"; round += 1) {
    if (state.phase.kind === "waiting_for_owner") {
      const approve = next() < 0.5;
      if (approve) approved.push(state.phase.amountUsd);
      run({ kind: "owner_decided", requestId: state.phase.requestId, decision: approve ? "once" : "deny" });
      continue;
    }
    if (state.readBack && next() < 0.7) {
      const reply: Reply = next() < 0.5 ? { text: pick(CLEAN_YES), clean: true } : { text: pick(NOT_YES), clean: false };
      replies.push(reply);
      run({ kind: "heard", text: reply.text });
      continue;
    }
    if (next() < 0.4) run({ kind: "brain", turn: 0, step: { kind: "say", text: pick(AGENT), last: true } });
    if (next() < 0.4) run({ kind: "heard", text: pick(NOT_YES) });
    const claim = pick([undefined, quoted, Math.max(1, quoted - 60), 12, quoted + 40]);
    run({ kind: "brain", turn: 0, step: { kind: "end_call", outcome: { kind: "confirmed", summary: "Booked Tuesday", ...(claim !== undefined ? { amountUsd: claim } : {}) } } });
  }
  return { state, limit, replies, approved };
}

describe("honesty over generated calls", () => {
  it("books only on a clean yes to a read-back of that exact amount, within the limit or with the owner's approval", () => {
    const failures: string[] = [];
    let booked = 0;
    for (let seed = 1; seed <= 4000; seed += 1) {
      const { state, limit, replies, approved } = playCall(seed);
      if (state.phase.kind !== "ended" || state.phase.outcome.kind !== "confirmed") continue;
      booked += 1;
      const amount = state.phase.outcome.amountUsd;
      const turns = state.turns.filter(turn => turn.speaker !== "owner");
      const [readBack, reply] = turns.slice(-3, -1);
      const transcript = turns.map(turn => `${turn.speaker}: ${turn.text}`).join(" | ");
      const fail = (why: string) => failures.push(`seed ${seed}: ${why}: ${transcript}`);
      if (!readBack?.text.startsWith("Just to confirm:")) fail("no read-back before the booking");
      else if (amount !== undefined && !readBack.text.includes(` total`)) fail("read-back without a total");
      if (replies.at(-1)?.clean !== true || reply?.text !== replies.at(-1)?.text) fail("booked without a clean yes");
      if (amount === undefined ? !approved.includes(undefined) : amount > (limit ?? 0) && !approved.includes(amount)) fail(`booked ${amount} without the owner`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
    expect(booked).toBeGreaterThan(100);
  });
});
