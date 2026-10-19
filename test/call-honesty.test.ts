import { describe, expect, it } from "vitest";
import { amountsIn, chargedIn, disclosure } from "../src/calls/rules.js";
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
  "Yes, that's per hour.", "Sure, unless it's a bigger leak.", "Okay, 150.", "Yes. We're at 4500 Main Street.", "Sorry, we're booked.", "Hmm.", "Yes, ten.", "Yes, thirty."
] as const;
const OWNER: ReadonlyArray<(n: number) => [string, number | undefined]> = [
  n => [`offer $${n}`, n], n => [`tell them ${n} works`, n], n => [`go to ${n} dollars`, n], n => [`${n}`, undefined],
  n => [`don't pay ${n}`, undefined], n => [`is ${n} okay?`, undefined], n => [`okay ${n}`, undefined], () => ["wait a moment", undefined]
];
const SUMMARIES = ["Booked", "Booked for 500", "Booked for five hundred", "Booked Wednesday at noon for $100", "Booked Tuesday at ten, 500 total"] as const;
const AGENT = ["Okay. The address is 12 Elm Street.", "Could you do it for less?", "What time works?"] as const;

type Reply = { text: string; clean: boolean };

const READ_BACK = /^(Just to confirm:|Let me check once more:|One last check:|To be sure:) /;
const TALKED_OVER = /^Sorry, I talked over you\. Was that a yes to .+\?$/;

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
  const approved: Array<{ amount: number | undefined; when: string | undefined }> = [];
  const undisclosed: string[] = [];
  let played = false;
  let owed = false;
  const run = (input: CallInput) => {
    clock += 1000;
    const before = state.turns.length;
    const resolved = input.kind === "brain" ? { ...input, turn: state.turn } : input;
    state = step(state, resolved, new Date(Date.UTC(2026, 9, 20, 17) + clock).toISOString()).state;
    const spoken = state.turns.slice(before).find(turn => turn.speaker === "agent");
    if (owed && spoken) {
      if (spoken.text !== disclosure("Maya")) undisclosed.push(spoken.text);
      owed = false;
    }
    if (input.kind === "interrupted" && !played) owed = true;
    if (input.kind === "played" && input.text.includes(disclosure("Maya"))) played = true;
  };
  const cut = () => run({ kind: "interrupted", spokenSoFar: pick(["Hi,", "Hi, this", "Just to"]) });
  run({ kind: "answered" });
  if (next() < 0.5) run({ kind: "played", text: disclosure("Maya") });
  if (next() < 0.2) cut();
  run({ kind: "heard", text: pick(QUOTES)(quoted) });
  for (let round = 0; round < 6 && state.phase.kind !== "ended"; round += 1) {
    if (next() < 0.1) cut();
    if (state.phase.kind === "waiting_for_owner") {
      if (next() < 0.3) run({ kind: "heard", text: "Hello? Are you still there?" });
      const approve = next() < 0.5;
      if (approve) approved.push({ amount: state.phase.amountUsd, when: state.phase.when });
      run({ kind: "owner_decided", requestId: state.phase.requestId, decision: approve ? "once" : "deny" });
      continue;
    }
    if (state.readBack && next() < 0.8) {
      const order = next();
      if (order < 0.15) run({ kind: "interrupted", spokenSoFar: "Just to confirm" });
      else if (order < 0.25) run({ kind: "owner_said", text: "wait a moment" });
      else if (order < 0.8) run({ kind: "played", text: state.readBack.line });
      else if (order < 0.88) {
        const early = pick(CLEAN_YES);
        replies.push({ text: early, clean: false });
        run({ kind: "heard", text: early });
        run({ kind: "played", text: `Okay. ${state.readBack?.line ?? ""}` });
        continue;
      }
      const reply: Reply = next() < 0.5 ? { text: pick(CLEAN_YES), clean: true } : { text: pick(NOT_YES), clean: false };
      replies.push({ ...reply, clean: reply.clean && order >= 0.25 && order < 0.8 });
      run({ kind: "heard", text: reply.text });
      continue;
    }
    if (next() < 0.2) {
      const [text, offer] = pick(OWNER)(pick([quoted, quoted + 40]));
      if (offer !== undefined) approved.push({ amount: offer, when: undefined });
      run({ kind: "owner_said", text });
    }
    if (next() < 0.4) run({ kind: "brain", turn: 0, step: { kind: "say", text: pick(AGENT), last: true } });
    if (next() < 0.4) run({ kind: "heard", text: pick(NOT_YES) });
    const claim = pick([undefined, quoted, Math.max(1, quoted - 60), 12, quoted + 40]);
    const when = pick([undefined, "Tuesday at ten thirty", "Tuesday at ten forty-five", "Wednesday at six", "Wednesday at six, plus a $400 deposit", "Tuesday at ten thirty, card 4111 1111 1111 1111"]);
    run({ kind: "brain", turn: 0, step: { kind: "end_call", outcome: { kind: "confirmed", summary: pick(SUMMARIES), ...(claim !== undefined ? { amountUsd: claim } : {}), ...(when ? { when } : {}) } } });
  }
  return { state, limit, replies, approved, undisclosed };
}

describe("honesty over generated calls", () => {
  it("books only on a clean yes to a read-back of that exact amount, within the limit or with the owner's approval", () => {
    const failures: string[] = [];
    let booked = 0;
    for (let seed = 1; seed <= 4000; seed += 1) {
      const { state, limit, replies, approved, undisclosed } = playCall(seed);
      if (undisclosed.length > 0) failures.push(`seed ${seed}: after a cut disclosure the agent said "${undisclosed[0]}" first`);
      const leaked = state.turns.find(turn => turn.speaker === "agent" && /(?:\d[\s-]?){12,}/.test(turn.text));
      if (leaked) failures.push(`seed ${seed}: the agent said a card-length digit run: ${leaked.text}`);
      if (state.phase.kind !== "ended" || state.phase.outcome.kind !== "confirmed") continue;
      booked += 1;
      const amount = state.phase.outcome.amountUsd;
      const turns = state.turns.filter(turn => turn.speaker !== "owner");
      const closing = turns.length - 1;
      const readBackAt = turns.slice(0, closing).findLastIndex(turn => turn.speaker === "agent" && READ_BACK.test(turn.text));
      const readBack = turns[readBackAt];
      const after = turns.slice(readBackAt + 1, closing);
      const reply = after.at(-1);
      const transcript = turns.map(turn => `${turn.speaker}: ${turn.text}`).join(" | ");
      const fail = (why: string) => failures.push(`seed ${seed}: ${why}: ${transcript}`);
      if (after.some(turn => !(CLEAN_YES as readonly string[]).includes(turn.text) && !TALKED_OVER.test(turn.text))) fail("something other than a clean yes followed the read-back");
      if (reply?.speaker !== "business") fail("the booking did not follow a business reply");
      if (!readBack) fail("no read-back before the booking");
      else if (amount !== undefined && !amountsIn(readBack.text.split(" total")[0] ?? "").includes(amount)) fail(`booked ${amount}, which the read-back did not say`);
      if (readBack && chargedIn(readBack.text).some(value => value !== amount)) fail(`booked ${amount} after a read-back that named another price`);
      if (readBack && amountsIn(state.phase.outcome.summary).some(value => !amountsIn(readBack.text).includes(value))) fail(`reported "${state.phase.outcome.summary}", which the read-back did not say`);
      if (replies.at(-1)?.clean !== true || reply?.text !== replies.at(-1)?.text) fail("booked without a clean yes");
      const when = state.phase.outcome.when;
      const allowed = approved.some(grant => grant.amount === amount && (grant.when === undefined || grant.when === when));
      if ((amount === undefined || amount > (limit ?? 0)) && !allowed) fail(`booked ${amount} for ${when} without the owner`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
    expect(booked).toBeGreaterThan(100);
  });
});
