import { describe, expect, it } from "vitest";
import { startCall, step, type CallState } from "../src/calls/session.js";
import { checkDialLimits, disclosure, redactDigits, HOLD_LINE_MS } from "../src/calls/rules.js";
import { parsePhoneNumber, type CallBrief, type CallEffect, type CallInput } from "../src/calls/types.js";

const T0 = Date.parse("2026-10-20T17:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

const brief: CallBrief = {
  goal: "Book a plumber visit to fix a leaking kitchen sink",
  business: { name: "Joe's Plumbing", phone: parsePhoneNumber("(415) 555-0134") },
  ownerName: "Maya",
  maxUsd: 150,
  facts: ["The address is 12 Elm Street"]
};

type Run = { state: CallState; effects: CallEffect[] };

function play(inputs: Array<CallInput | [CallInput, number]>, from?: CallState): Run {
  let state = from ?? startCall(brief, "call-1").state;
  const effects: CallEffect[] = [];
  let clock = 0;
  for (const item of inputs) {
    const [input, ms] = Array.isArray(item) ? item : [item, clock + 100];
    clock = ms;
    const result = step(state, input, at(ms));
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

const answered: CallInput = { kind: "answered" };
const heard = (text: string): CallInput => ({ kind: "heard", text });
const say = (text: string, last = true): CallInput => ({ kind: "brain", step: { kind: "say", text, last } });
const confirm = (amountUsd: number): CallInput => ({
  kind: "brain",
  step: { kind: "end_call", outcome: { kind: "confirmed", summary: `Tuesday at ten for $${amountUsd}`, amountUsd, when: "Tuesday 10:00" } }
});

const kinds = (effects: CallEffect[]) => effects.map(effect => (effect.kind === "emit" ? `emit:${effect.event.type}` : effect.kind));
const spoken = (effects: CallEffect[]) => effects.flatMap(effect => (effect.kind === "say" ? [effect.text] : []));
const emitted = (effects: CallEffect[], type: string) =>
  effects.flatMap(effect => (effect.kind === "emit" && effect.event.type === type ? [effect.event] : []));
const waitingRequestId = (state: CallState) => {
  if (state.phase.kind !== "waiting_for_owner") throw new Error(`expected waiting_for_owner, got ${state.phase.kind}`);
  return state.phase.requestId;
};

describe("startCall", () => {
  it("dials without speaking and opens the transcript with nothing", () => {
    const { state, effects } = startCall(brief, "call-1");
    expect(state.phase).toEqual({ kind: "dialing" });
    expect(state.turns).toEqual([]);
    expect(effects).toEqual([]);
  });
});

describe("step", () => {
  it("makes the disclosure the first thing in the transcript when the business answers", () => {
    const { state, effects } = play([answered]);
    expect(state.phase.kind).toBe("talking");
    expect(state.turns[0]).toEqual({ speaker: "agent", text: disclosure("Maya"), at: at(100) });
    expect(disclosure("Maya")).toBe("Hi, this is an AI assistant calling for Maya. This call is transcribed.");
    expect(emitted(effects, "status.update")[0]?.payload).toMatchObject({ text: "Connected to Joe's Plumbing" });
  });

  it("confirms a deal under the limit, hangs up once, and completes once", () => {
    const { state, effects } = play([answered, heard("I can do Tuesday for 140"), confirm(140)]);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 140 } });
    expect(kinds(effects).filter(kind => kind === "hang_up")).toHaveLength(1);
    const completes = emitted(effects, "message.complete");
    expect(completes).toHaveLength(1);
    expect(completes[0]?.payload).toMatchObject({ status: "completed", outcome: { kind: "confirmed", amountUsd: 140 } });
  });

  it("thinks after every business sentence", () => {
    const { state, effects } = play([answered, heard("Joe's Plumbing, how can I help?")]);
    expect(kinds(effects)).toContain("think");
    expect(state.turns.at(-1)).toMatchObject({ speaker: "business", text: "Joe's Plumbing, how can I help?" });
  });

  it("turns a confirmation above the limit into a question for the owner", () => {
    const { state, effects } = play([answered, heard("It'll be 180"), confirm(180)]);
    expect(state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 180 });
    expect(kinds(effects)).not.toContain("hang_up");
    const [request] = emitted(effects, "approval.request");
    expect(request?.payload).toMatchObject({ requestId: waitingRequestId(state), amountUsd: 180, kind: "spend", choices: ["once", "deny"] });
    expect(spoken(effects)).toContain("One moment, let me check with Maya.");
  });

  it("accepts the over-limit price after the owner approves it", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180)]);
    const approved = play([{ kind: "owner_decided", requestId: waitingRequestId(asked.state), decision: "once" }], asked.state);
    expect(approved.state.phase.kind).toBe("talking");
    expect(kinds(approved.effects)).toEqual(["think"]);
    expect(approved.state.ownerNotes).toHaveLength(1);
    expect(approved.state.ownerNotes[0]).toMatch(/approved/i);
    const done = play([confirm(180)], approved.state);
    expect(done.state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 180 } });
  });

  it("keeps refusing the over-limit price after the owner declines it", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180)]);
    const declined = play([{ kind: "owner_decided", requestId: waitingRequestId(asked.state), decision: "deny" }, confirm(180)], asked.state);
    expect(declined.state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 180 });
    expect(declined.state.ownerNotes[0]).toMatch(/declined/i);
  });

  it("lets an owner steer answer the pending question and authorize the amount they named", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180)]);
    const steered = play([{ kind: "owner_said", text: "offer 160" }], asked.state);
    expect(steered.state.phase.kind).toBe("talking");
    expect(kinds(steered.effects)).toEqual(["think"]);
    expect(steered.state.turns.at(-1)).toMatchObject({ speaker: "owner", text: "offer 160" });
    const done = play([heard("Fine, 160 it is"), confirm(160)], steered.state);
    expect(done.state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 160 } });
  });

  it("reads a spoken amount from the owner as authorization", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180)]);
    const done = play([{ kind: "owner_said", text: "tell him one sixty" }, heard("Okay, 160"), confirm(160)], asked.state);
    expect(done.state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 160 } });
  });

  it("does not treat a different owner amount as authorization", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180)]);
    const done = play([{ kind: "owner_said", text: "offer 160" }, heard("No, 170 is my floor"), confirm(170)], asked.state);
    expect(done.state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 170 });
  });

  it("ends unconfirmed when the business hangs up mid-call", () => {
    const { state, effects } = play([answered, heard("It'll be 180"), { kind: "line_ended", reason: "hangup" }]);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed", reason: "the line ended before they confirmed" } });
    expect(emitted(effects, "message.complete")[0]?.payload).toMatchObject({ outcome: { kind: "unconfirmed" } });
    expect(kinds(effects)).not.toContain("hang_up");
  });

  it("ends unconfirmed when the owner is being asked and the line drops", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180)]);
    const dropped = play([{ kind: "line_ended", reason: "hangup" }], asked.state);
    expect(dropped.state.phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed" } });
  });

  it.each([
    ["no_answer", "no answer"],
    ["busy", "busy"],
    ["failed", "failed"]
  ] as const)("ends unconfirmed with reason %s when the dial fails", (reason, text) => {
    const { state } = play([{ kind: "line_ended", reason }]);
    expect(state.phase).toEqual({ kind: "ended", outcome: { kind: "unconfirmed", reason: text } });
  });

  it("truncates the agent turn to what the business actually heard", () => {
    const { state } = play([answered, heard("When can you come?"), say("We could do Tuesday at ten or"), { kind: "interrupted", spokenSoFar: "We could do Tuesday" }]);
    expect(state.turns.at(-1)).toMatchObject({ speaker: "agent", text: "We could do Tuesday" });
  });

  it("records only what was heard when interrupted mid-stream, and drops the stale stream", () => {
    const { state, effects } = play([
      answered,
      heard("When can you come?"),
      say("We could do Tuesday ", false),
      { kind: "interrupted", spokenSoFar: "We could" },
      say("at ten.", true)
    ]);
    expect(state.turns.at(-1)).toMatchObject({ speaker: "agent", text: "We could" });
    expect(spoken(effects)).not.toContain("at ten.");
    const resumed = play([heard("Tuesday's full"), say("How about Wednesday?")], state);
    expect(spoken(resumed.effects)).toEqual(["How about Wednesday?"]);
  });

  it("assembles a streamed agent turn into one transcript line", () => {
    const { state, effects } = play([answered, heard("What do you need?"), say("A sink ", false), say("repair, please.", true)]);
    expect(spoken(effects)).toEqual(["A sink ", "repair, please."]);
    expect(state.turns.at(-1)).toMatchObject({ speaker: "agent", text: "A sink repair, please." });
  });

  it("speaks the holding line after 15 seconds of waiting, not before", () => {
    const asked = play([answered, [heard("It'll be 180"), 1000], [confirm(180), 2000]]);
    const early = play([[{ kind: "hold_tick" }, 2000 + HOLD_LINE_MS - 1000]], asked.state);
    expect(early.effects).toEqual([]);
    const due = play([[{ kind: "hold_tick" }, 2000 + HOLD_LINE_MS]], early.state);
    expect(spoken(due.effects)).toEqual(["Still checking with Maya, thanks for holding."]);
    const again = play([[{ kind: "hold_tick" }, 2000 + HOLD_LINE_MS + 1000]], due.state);
    expect(again.effects).toEqual([]);
  });

  it("answers the business while still waiting on the owner", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180)]);
    const { state, effects } = play([heard("Are you still there?")], asked.state);
    expect(state.phase.kind).toBe("waiting_for_owner");
    expect(spoken(effects)).toEqual(["Still checking with Maya, one moment."]);
    expect(kinds(effects)).not.toContain("think");
  });

  it("never speaks a card number, even split across stream deltas", () => {
    const whole = play([answered, heard("Card?"), say("My card is 4111111111111111")]);
    expect(spoken(whole.effects).join("")).toContain("that number");
    expect(spoken(whole.effects).join("")).not.toMatch(/\d{12}/);
    const split = play([answered, heard("Card?"), say("It is 4111 1111 ", false), say("1111 1111, thanks.", true)]);
    const text = spoken(split.effects).join("");
    expect(text.replace(/\D/g, "")).not.toMatch(/\d{12}/);
    expect(text).toContain("that number");
    expect(split.state.turns.at(-1)?.text).not.toMatch(/1111 1111 1111/);
  });

  it("ignores a decision for a request that is not pending", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180)]);
    const stale = step(asked.state, { kind: "owner_decided", requestId: "call-1:ask-99", decision: "once" }, at(5000));
    expect(stale).toEqual({ state: asked.state, effects: [] });
  });

  it("gives each owner question a distinct id scoped to the call", () => {
    const first = play([answered, heard("It'll be 180"), confirm(180)]);
    const firstId = waitingRequestId(first.state);
    const second = play([{ kind: "owner_decided", requestId: firstId, decision: "deny" }, confirm(175)], first.state);
    const secondId = waitingRequestId(second.state);
    expect(firstId).toMatch(/^call-1:/);
    expect(secondId).not.toBe(firstId);
  });

  it("changes nothing once the call has ended", () => {
    const ended = play([answered, heard("Tuesday for 140"), confirm(140)]);
    const inputs: CallInput[] = [
      answered,
      heard("hello?"),
      { kind: "interrupted", spokenSoFar: "" },
      { kind: "line_ended", reason: "hangup" },
      say("more"),
      { kind: "owner_said", text: "offer 160" },
      { kind: "owner_decided", requestId: "x", decision: "once" },
      { kind: "hold_tick" }
    ];
    for (const input of inputs) expect(step(ended.state, input, at(99_000))).toEqual({ state: ended.state, effects: [] });
  });

  it("ignores brain output that arrives before the business answers", () => {
    const { state, effects } = play([say("Hello?")]);
    expect(state.phase.kind).toBe("dialing");
    expect(effects).toEqual([]);
  });

  it("ends the call politely for declined and no-deal outcomes", () => {
    const { state, effects } = play([
      answered,
      heard("We don't do sinks"),
      { kind: "brain", step: { kind: "end_call", outcome: { kind: "declined", reason: "They don't repair sinks" } } }
    ]);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "declined" } });
    expect(effects.find(effect => effect.kind === "say")).toMatchObject({ last: true });
    expect(kinds(effects)).toContain("hang_up");
  });

  it("keeps facts the brain chooses to remember", () => {
    const live = play([answered]);
    const { state, effects } = play([{ kind: "brain", step: { kind: "remember", fact: "Joe's charges a $60 call-out fee" } }], live.state);
    expect(state.learned).toEqual(["Joe's charges a $60 call-out fee"]);
    expect(effects).toEqual([]);
  });
});

describe("redactDigits", () => {
  it.each([
    ["4111111111111111", "that number"],
    ["4111-1111-1111-1111", "that number"],
    ["four one one one four one one one four one one one", "that number"],
    ["call 415 555 0134 back", "call 415 555 0134 back"],
    ["one moment, I'll be one minute", "one moment, I'll be one minute"]
  ])("%s", (input, expected) => {
    expect(redactDigits(input)).toBe(expected);
  });
});

describe("parsePhoneNumber", () => {
  it.each([
    ["(415) 555-0134", "+14155550134"],
    ["1-415-555-0134", "+14155550134"],
    ["+44 20 7946 0958", "+442079460958"]
  ])("normalizes %s", (raw, expected) => {
    expect(parsePhoneNumber(raw)).toBe(expected);
  });

  it.each(["555-0134", "call joe", "+1", "911"])("rejects %s", raw => {
    expect(() => parsePhoneNumber(raw)).toThrow();
  });
});

describe("checkDialLimits", () => {
  const number = parsePhoneNumber("4155550134");
  const day = "2026-10-20T23:00:00.000Z";
  const call = (to: string, startedAt = "2026-10-20T18:00:00.000Z") => ({ to: parsePhoneNumber(to), startedAt });

  it("allows the third call to a number and refuses the fourth", () => {
    expect(checkDialLimits([call("4155550134"), call("4155550134")], number, day)).toEqual({ ok: true });
    expect(checkDialLimits([call("4155550134"), call("4155550134"), call("4155550134")], number, day)).toMatchObject({ ok: false });
  });

  it("refuses the 21st call of the day across numbers", () => {
    const history = Array.from({ length: 20 }, (_, n) => call(`41555501${String(n).padStart(2, "0")}`));
    expect(checkDialLimits(history, parsePhoneNumber("4155559999"), day)).toMatchObject({ ok: false });
  });

  it("does not count yesterday's calls", () => {
    const history = Array.from({ length: 3 }, () => call("4155550134", "2026-10-19T18:00:00.000Z"));
    expect(checkDialLimits(history, number, day)).toEqual({ ok: true });
  });
});
