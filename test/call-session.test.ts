import { describe, expect, it } from "vitest";
import { startCall, step, type CallState } from "../src/calls/session.js";
import {
  amountsIn,
  chargedIn,
  checkDialLimits,
  disclosure,
  HOLD_LINE_MS,
  offerIn,
  OWNER_PATIENCE_MS,
  redactDigits
} from "../src/calls/rules.js";
import { parsePhoneNumber, type BrainStep, type CallBrief, type CallEffect, type CallInput } from "../src/calls/types.js";

const T0 = Date.parse("2026-10-20T17:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

const brief: CallBrief = {
  goal: "Book a plumber visit to fix a leaking kitchen sink",
  business: { name: "Joe's Plumbing", phone: parsePhoneNumber("(415) 555-0134") },
  ownerName: "Maya",
  maxUsd: 150,
  facts: ["The address is 12 Elm Street"]
};

type Input = CallInput | { kind: "brain"; step: BrainStep };
type Run = { state: CallState; effects: CallEffect[] };

function play(inputs: Array<Input | [Input, number]>, from?: CallState, callBrief: CallBrief = brief): Run {
  let state = from ?? startCall(callBrief, "call-1").state;
  const effects: CallEffect[] = [];
  let clock = Date.parse(state.turns.at(-1)?.at ?? at(0)) - T0;
  for (const item of inputs) {
    const [input, ms] = Array.isArray(item) ? item : [item, clock + 100];
    clock = ms;
    const resolved: CallInput = input.kind === "brain" && !("turn" in input) ? { ...input, turn: state.turn } : input;
    const result = step(state, resolved, at(ms));
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

const answered: Input = { kind: "answered" };
const heard = (text: string): Input => ({ kind: "heard", text });
const owner = (text: string): Input => ({ kind: "owner_said", text });
const say = (text: string, last = true): Input => ({ kind: "brain", step: { kind: "say", text, last } });
const confirm = (amountUsd?: number, summary = "Tuesday at ten", when?: string): Input => ({
  kind: "brain",
  step: { kind: "end_call", outcome: { kind: "confirmed", summary, ...(amountUsd !== undefined ? { amountUsd } : {}), ...(when ? { when } : {}) } }
});

const kinds = (effects: CallEffect[]) => effects.map(effect => (effect.kind === "emit" ? `emit:${effect.event.type}` : effect.kind));
const spoken = (effects: CallEffect[]) => effects.flatMap(effect => (effect.kind === "say" ? [effect.text] : []));
const emitted = (effects: CallEffect[], type: string) =>
  effects.flatMap(effect => (effect.kind === "emit" && effect.event.type === type ? [effect.event] : []));
const requestOf = (state: CallState) => {
  if (state.phase.kind !== "waiting_for_owner") throw new Error(`expected waiting_for_owner, got ${state.phase.kind}`);
  return state.phase.requestId;
};
const quoted = () => play([answered, heard("It'll be 180"), confirm(180)]);

describe("startCall", () => {
  it("dials without speaking and with an empty transcript", () => {
    const { state, effects } = startCall(brief, "call-1");
    expect(state.phase).toEqual({ kind: "dialing" });
    expect(state.turns).toEqual([]);
    expect(effects).toEqual([]);
  });
});

describe("rule 1: the disclosure comes first", () => {
  it("records the disclosure as the first turn when the business answers", () => {
    const { state, effects } = play([answered]);
    expect(state.phase.kind).toBe("talking");
    expect(state.turns).toEqual([{ speaker: "agent", text: disclosure("Maya"), at: at(100) }]);
    expect(disclosure("Maya")).toBe("Hi, this is an AI assistant calling for Maya. This call is transcribed.");
    expect(emitted(effects, "status.update").map(event => event.payload)).toEqual([
      { text: "Connected to Joe's Plumbing" },
      { text: `Ambient: ${disclosure("Maya")}`, name: "agent" }
    ]);
  });

  it("repeats the disclosure before anything else when the business cut it off", () => {
    const { state, effects } = play([answered, { kind: "interrupted", spokenSoFar: "Hi, this is an" }, heard("Hello? Who is this?")]);
    expect(spoken(effects)).toEqual([disclosure("Maya")]);
    expect(kinds(effects).indexOf("say")).toBeLessThan(kinds(effects).indexOf("think"));
    expect(state.turns.map(turn => turn.text)).toEqual(["Hi, this is an", "Hello? Who is this?", disclosure("Maya")]);
  });

  it("treats speech heard before the answer event as an answer", () => {
    const { state, effects } = play([heard("Joe's Plumbing?")]);
    expect(state.turns.map(turn => turn.speaker)).toEqual(["agent", "business"]);
    expect(state.turns[0]?.text).toBe(disclosure("Maya"));
    expect(kinds(effects)).toContain("think");
  });
});

describe("rule 2: confirmed only through the brain, on the line's evidence", () => {
  it("confirms a deal under the limit, hangs up once, and completes once", () => {
    const { state, effects } = play([answered, heard("I can do Tuesday for 140"), confirm(140)]);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 140 } });
    expect(kinds(effects).filter(kind => kind === "hang_up")).toHaveLength(1);
    const completes = emitted(effects, "message.complete");
    expect(completes).toHaveLength(1);
    expect(completes[0]?.payload).toMatchObject({ status: "completed", outcome: { kind: "confirmed", amountUsd: 140 } });
  });

  it("confirms at exactly the limit", () => {
    expect(play([answered, heard("150 even, that works"), confirm(150)]).state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed" } });
  });

  it("asks the business to confirm instead of claiming a deal it never heard", () => {
    const { state, effects } = play([answered, confirm(140)]);
    expect(state.phase.kind).toBe("talking");
    expect(spoken(effects)).toEqual(["Just to confirm, that's one hundred forty dollars?"]);
    const done = play([heard("Yes, that's right"), confirm(140)], state);
    expect(done.state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 140 } });
  });

  it("asks for confirmation when the amount was never said on the line", () => {
    const { state, effects } = play([answered, heard("We can come Tuesday"), confirm(120)]);
    expect(state.phase.kind).toBe("talking");
    expect(spoken(effects)).toEqual(["Just to confirm, that's one hundred twenty dollars?"]);
  });

  it.each(["hangup", "busy", "no_answer", "failed"] as const)("never confirms when the line ends (%s)", reason => {
    const { state, effects } = play([answered, heard("It'll be 140"), { kind: "line_ended", reason }]);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed", reason: "the line ended before they confirmed" } });
    expect(emitted(effects, "message.complete")[0]?.payload).toMatchObject({ outcome: { kind: "unconfirmed" } });
    expect(kinds(effects)).not.toContain("hang_up");
  });

  it.each([
    ["no_answer", "no answer"],
    ["busy", "busy"],
    ["failed", "failed"],
    ["hangup", "the line ended before they answered"]
  ] as const)("ends unconfirmed when the dial fails (%s)", (reason, text) => {
    expect(play([{ kind: "line_ended", reason }]).state.phase).toEqual({ kind: "ended", outcome: { kind: "unconfirmed", reason: text } });
  });

  it("ends unconfirmed when the line drops while the owner is being asked", () => {
    const dropped = play([{ kind: "line_ended", reason: "hangup" }], quoted().state);
    expect(dropped.state.phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed" } });
  });

  it("drops brain output from a stream that a newer business line made stale", () => {
    const first = play([answered, heard("Tuesday for 140?")]);
    const staleTurn = first.state.turn;
    const second = play([heard("Actually, it's 180")], first.state);
    const stale = step(second.state, { kind: "brain", turn: staleTurn, step: { kind: "end_call", outcome: { kind: "confirmed", summary: "Tuesday", amountUsd: 140 } } }, at(9000));
    expect(stale).toEqual({ state: second.state, effects: [] });
  });

  it("drops the rest of a stream after the business interrupts it", () => {
    const streaming = play([answered, heard("When can you come?"), say("We could do Tuesday ", false)]);
    const { state, effects } = play([{ kind: "interrupted", spokenSoFar: "We could" }, { kind: "brain", turn: streaming.state.turn, step: { kind: "say", text: "at ten.", last: true } }], streaming.state);
    expect(state.turns.at(-1)).toMatchObject({ speaker: "agent", text: "We could" });
    expect(spoken(effects)).toEqual([]);
    const resumed = play([heard("Tuesday's full"), say("How about Wednesday?")], state);
    expect(spoken(resumed.effects)).toEqual(["How about Wednesday?"]);
  });
});

describe("rule 3: a price above the limit needs the owner", () => {
  it("turns an over-limit confirmation into a question for the owner", () => {
    const { state, effects } = quoted();
    expect(state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 180 });
    expect(kinds(effects)).not.toContain("hang_up");
    expect(emitted(effects, "approval.request")[0]?.payload).toMatchObject({ requestId: requestOf(state), amountUsd: 180, limitUsd: 150, kind: "spend", choices: ["once", "deny"] });
    expect(spoken(effects)).toContain("One moment, let me check with Maya.");
  });

  it("checks dollar amounts in the summary when the brain omits amountUsd", () => {
    const { state } = play([answered, heard("It's $400"), confirm(undefined, "Booked Tuesday for $400")]);
    expect(state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 400 });
  });

  it("treats a missing limit as zero, so any price needs the owner", () => {
    const { maxUsd: _, ...unlimited } = brief;
    const { state } = play([answered, heard("It's 90"), confirm(90)], undefined, unlimited);
    expect(state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 90 });
  });

  it("accepts the price after the owner approves it", () => {
    const asked = quoted();
    const approved = play([{ kind: "owner_decided", requestId: requestOf(asked.state), decision: "once" }], asked.state);
    expect(approved.state.phase.kind).toBe("talking");
    expect(kinds(approved.effects)).toContain("think");
    expect(approved.state.turns.at(-1)).toMatchObject({ speaker: "owner", text: expect.stringMatching(/^Maya approved: /) });
    expect(play([heard("Great, you're booked."), confirm(180)], approved.state).state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 180 } });
  });

  it("ends without a deal instead of asking again after the owner declines that price", () => {
    const asked = quoted();
    const declined = play([{ kind: "owner_decided", requestId: requestOf(asked.state), decision: "deny" }, confirm(180)], asked.state);
    expect(declined.state.phase).toMatchObject({ kind: "ended", outcome: { kind: "no_deal", reason: "Maya declined one hundred eighty dollars" } });
    expect(emitted(declined.effects, "approval.request")).toHaveLength(0);
  });

  it.each(["offer 160", "tell him one sixty", "160", "one sixty", "$160", "counter at 160"])("treats \"%s\" as authorizing 160", text => {
    const done = play([owner(text), heard("Fine, 160 it is"), confirm(160)], quoted().state);
    expect(done.state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 160 } });
  });

  it.each(["don't pay 180", "180 is too much", "never over 180", "I paid 180 last time", "no, not 180", "offer 160 or 170"])(
    "does not treat \"%s\" as authorization",
    text => {
      const amount = text.includes("170") ? 170 : 180;
      const done = play([owner(text), heard(`Okay, ${amount}`), confirm(amount)], quoted().state);
      expect(done.state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: amount });
    }
  );

  it("does not stretch an authorized amount to a different one", () => {
    const done = play([owner("offer 160"), heard("No, 170 is my floor"), confirm(170)], quoted().state);
    expect(done.state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 170 });
  });
});

describe("round 2 review findings", () => {
  it("reads thousands, so a thousand-dollar charge cannot pass as one dollar", () => {
    expect(amountsIn("one thousand dollars")).toEqual([1000]);
    expect(amountsIn("one thousand two hundred dollars")).toEqual([1200]);
    expect(amountsIn("two thousand and fifty")).toEqual([2050]);
    const { state } = play([answered, heard("That will be one thousand dollars."), confirm(undefined, "Booked for one thousand dollars")]);
    expect(state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 1000 });
  });

  it("does not take the agent's own offer as confirmed when the business rejected it", () => {
    const { state } = play([answered, heard("When?"), say("Could you do one hundred dollars?"), heard("No, it's three hundred, take it or leave it."), confirm(100)]);
    expect(state.phase.kind).not.toBe("ended");
  });

  it("does not take a non-answer to its confirm question as confirmation", () => {
    const asked = play([answered, heard("Hi"), confirm(90)]);
    const { state } = play([heard("Sorry, what?"), confirm(90)], asked.state);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed" } });
  });

  it("accepts a yes to its confirm question", () => {
    const asked = play([answered, heard("Hi"), confirm(90)]);
    expect(play([heard("Yes, that's right."), confirm(90)], asked.state).state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 90 } });
  });

  it("needs an affirmative business line to confirm a deal with no price", () => {
    const { state, effects } = play([answered, heard("Hello, Joe's Plumbing."), confirm(undefined, "Booked Friday 7pm", "Friday 7pm")]);
    expect(state.phase.kind).toBe("talking");
    expect(spoken(effects)).toEqual(["Just to confirm, are we all set, Friday 7pm?"]);
  });

  it("stops asking after one unanswered confirm question and ends unconfirmed", () => {
    const first = play([answered, heard("Hmm"), confirm(120)]);
    const { state, effects } = play([heard("Hmm"), confirm(120)], first.state);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed", reason: "they never clearly confirmed it" } });
    expect(kinds(effects)).toContain("hang_up");
  });

  it.each(["total 200", "200 USD", "USD 200", "200$", "a 200 dollar fee", "a two hundred dollar callout fee"])("counts %s against the limit", summary => {
    const { state } = play([answered, heard("It's 200, sure"), confirm(undefined, summary)]);
    expect(state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 200 });
  });

  it.each([
    "I cannot go to 180", "tell them 180 is a ripoff", "tell them 180 is ridiculous", "say 180 is insane", "nope, tell them 180 is out",
    "tell them nah to 180", "I would accept 180 only if it includes tax", "tell them under 180", "maybe try 180"
  ])("does not treat \"%s\" as authorization", text => {
    expect(offerIn(text)).toBeUndefined();
  });

  it.each([["okay 160", 160], ["sure, 160", 160], ["yes 160 is fine", 160], ["160 works", 160], ["go with 160", 160], ["approve 160", 160], ["okay, one hundred and sixty", 160]] as const)(
    "treats \"%s\" as authorizing %i",
    (text, amount) => {
      expect(offerIn(text)).toBe(amount);
    }
  );

  it("lets the owner reverse an earlier decline", () => {
    const asked = play([answered, heard("It's 200"), confirm(200)]);
    const denied = play([{ kind: "owner_decided", requestId: requestOf(asked.state), decision: "deny" }], asked.state);
    const { state } = play([owner("actually okay, go to 200"), heard("Great, 200 works"), confirm(200)], denied.state);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 200 } });
  });

  it("repeats a disclosure cut off after the business already spoke", () => {
    const { state, effects } = play([answered, heard("Hello?"), { kind: "interrupted", spokenSoFar: "Hi, this is an" }, heard("Who's this?")]);
    expect(spoken(effects)).toContain(disclosure("Maya"));
    expect(state.turns[0]?.text).toBe("Hi, this is an");
  });

  it("does not repeat the still-checking line for every business sentence", () => {
    const { effects } = play([heard("Hello?"), heard("Still there?")], quoted().state);
    expect(spoken(effects)).toEqual(["Still checking with Maya, one moment."]);
  });

  it("keeps redacting digits that keep streaming after a card number", () => {
    const deltas = "4111111111111111".split("").map((digit, index, all) => say(digit, index === all.length - 1));
    const { effects } = play([answered, heard("Card?"), ...deltas]);
    expect(spoken(effects).join("").replace(/\D/g, "")).toBe("");
  });
});

describe("structural review findings", () => {
  it("does not treat a bare quote as the business agreeing to book", () => {
    const { state, effects } = play([answered, heard("It'll be 140."), confirm(140)]);
    expect(state.phase.kind).toBe("talking");
    expect(spoken(effects)).toEqual(["Just to confirm, that's one hundred forty dollars?"]);
  });

  it("asks the owner before confirming a deal that names no price", () => {
    const { state, effects } = play([answered, heard("Sure, we'll bill you after."), confirm(undefined, "Booked Friday 7pm", "Friday 7pm")]);
    expect(state.phase).toMatchObject({ kind: "waiting_for_owner" });
    expect(emitted(effects, "approval.request")[0]?.payload).toMatchObject({ kind: "other", description: expect.stringMatching(/no price/) });
    const approved = play([{ kind: "owner_decided", requestId: requestOf(state), decision: "once" }, heard("Yes, Friday works."), confirm(undefined, "Booked Friday 7pm", "Friday 7pm")], state);
    expect(approved.state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed" } });
  });

  it("ignores an interruption report that does not match what the agent said", () => {
    const live = play([answered, heard("When?"), say("We could do Tuesday.")]);
    const { state } = play([{ kind: "interrupted", spokenSoFar: "We will pay anything" }], live.state);
    expect(state.turns.at(-1)?.text).toBe("We could do Tuesday.");
  });

  it("emits the transcript line for an interrupted turn with what was actually heard", () => {
    const live = play([answered, heard("When?"), say("We could do Tuesday ", false)]);
    const { effects } = play([{ kind: "interrupted", spokenSoFar: "We could" }], live.state);
    expect(emitted(effects, "status.update").map(event => ("text" in event.payload ? event.payload.text : ""))).toEqual(["Ambient: We could"]);
  });
});

describe("rule 4: no long digit runs", () => {
  it("never speaks a card number, even split across stream deltas", () => {
    const whole = play([answered, heard("Card?"), say("My card is 4111111111111111")]);
    expect(spoken(whole.effects).join("")).toBe("My card is that number");
    const split = play([answered, heard("Card?"), say("It is 4111 1111 ", false), say("1111 1111, thanks.", true)]);
    expect(spoken(split.effects).join("")).toBe("It is that number, thanks.");
    expect(split.state.turns.at(-1)?.text).toBe("It is that number, thanks.");
  });

  it("holds a partial word across deltas so spelled-out digits are caught", () => {
    const { effects } = play([answered, heard("Card?"), say("four one one one four one one one four one one o", false), say("ne four one")]);
    expect(spoken(effects).join("")).toBe("that number");
  });

  it("keeps held digits that were never spoken out of the transcript", () => {
    const { state, effects } = play([answered, heard("Room?"), say("Room is 12", false), { kind: "brain", step: { kind: "ask_owner", question: "Which room?" } }]);
    expect(spoken(effects)[0]).toBe("Room is ");
    expect(state.turns.map(turn => turn.text)).toContain("Room is");
    expect(state.turns.map(turn => turn.text)).not.toContain("Room is 12");
  });
});

describe("owner input", () => {
  it("lets an owner steer answer the pending question", () => {
    const steered = play([owner("offer 160")], quoted().state);
    expect(steered.state.phase.kind).toBe("talking");
    expect(kinds(steered.effects)).toContain("think");
    expect(steered.state.turns.at(-1)).toMatchObject({ speaker: "owner", text: "offer 160" });
  });

  it("keeps what the agent already said when the owner steers mid-sentence", () => {
    const { state } = play([answered, heard("When?"), say("We could do Tuesday ", false), owner("offer 140")]);
    expect(state.turns.map(turn => [turn.speaker, turn.text])).toEqual([
      ["agent", disclosure("Maya")],
      ["business", "When?"],
      ["agent", "We could do Tuesday"],
      ["owner", "offer 140"]
    ]);
  });

  it("ignores a decision for a request that is not pending", () => {
    const asked = quoted();
    expect(step(asked.state, { kind: "owner_decided", requestId: "call-1:ask-99", decision: "once" }, at(5000))).toEqual({ state: asked.state, effects: [] });
  });

  it("gives each owner question a distinct id scoped to the call", () => {
    const first = quoted();
    const second = play([owner("offer 160"), heard("How about 175?"), confirm(175)], first.state);
    expect(requestOf(first.state)).toMatch(/^call-1:/);
    expect(requestOf(second.state)).not.toBe(requestOf(first.state));
  });
});

describe("holding", () => {
  it("speaks the holding line every 15 seconds while waiting, not before", () => {
    const asked = play([answered, [heard("It'll be 180"), 1000], [confirm(180), 2000]]);
    expect(play([[{ kind: "hold_tick" }, 2000 + HOLD_LINE_MS - 1]], asked.state).effects).toEqual([]);
    const due = play([[{ kind: "hold_tick" }, 2000 + HOLD_LINE_MS]], asked.state);
    expect(spoken(due.effects)).toEqual(["Still checking with Maya, thanks for holding."]);
    expect(play([[{ kind: "hold_tick" }, 2000 + HOLD_LINE_MS + 1000]], due.state).effects).toEqual([]);
  });

  it("answers the business while still waiting on the owner, without thinking", () => {
    const { state, effects } = play([heard("Are you still there?")], quoted().state);
    expect(state.phase.kind).toBe("waiting_for_owner");
    expect(spoken(effects)).toEqual(["Still checking with Maya, one moment."]);
    expect(kinds(effects)).not.toContain("think");
  });

  it("gives up honestly when the owner does not answer in time", () => {
    const asked = play([answered, [heard("It'll be 180"), 1000], [confirm(180), 2000]]);
    const { state, effects } = play([[{ kind: "hold_tick" }, 2000 + OWNER_PATIENCE_MS]], asked.state);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed", reason: "Maya didn't answer in time, so nothing was agreed" } });
    expect(kinds(effects)).toContain("hang_up");
  });

  it("stays quiet on unparsable clocks", () => {
    const asked = quoted();
    expect(step(asked.state, { kind: "hold_tick" }, "not a time")).toEqual({ state: asked.state, effects: [] });
  });
});

describe("the rest of the table", () => {
  it("emits a transcript line for every turn", () => {
    const { effects } = play([answered, heard("Hello"), say("Hi Joe.")]);
    expect(emitted(effects, "status.update").map(event => ("text" in event.payload ? event.payload.text : undefined))).toEqual([
      "Connected to Joe's Plumbing",
      `Ambient: ${disclosure("Maya")}`,
      "Joe's Plumbing: Hello",
      "Ambient: Hi Joe."
    ]);
  });

  it("emits the closing line's transcript before the run completes", () => {
    const { effects } = play([answered, heard("Tuesday for 140 works"), confirm(140)]);
    const order = effects.flatMap(effect => (effect.kind === "emit" ? [effect.event.type === "message.complete" ? "complete" : String("text" in effect.event.payload ? effect.event.payload.text : "")] : []));
    expect(order.slice(-2)).toEqual(["Ambient: Great, thank you so much. Goodbye.", "complete"]);
  });

  it("assembles a streamed agent turn into one transcript line", () => {
    const { state, effects } = play([answered, heard("What do you need?"), say("A sink ", false), say("repair, please.")]);
    expect(spoken(effects)).toEqual(["A sink ", "repair, please."]);
    expect(state.turns.at(-1)).toMatchObject({ speaker: "agent", text: "A sink repair, please." });
  });

  it("ends the call politely for a declined outcome", () => {
    const { state, effects } = play([answered, heard("We don't do sinks"), { kind: "brain", step: { kind: "end_call", outcome: { kind: "declined", reason: "They don't repair sinks" } } }]);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "declined" } });
    expect(effects.filter(effect => effect.kind === "say")).toEqual([{ kind: "say", text: "Okay, thanks for your time. Goodbye.", last: true }]);
    expect(kinds(effects)).toContain("hang_up");
  });

  it("passes remembered facts out as an effect", () => {
    const live = play([answered]);
    const { state, effects } = play([{ kind: "brain", step: { kind: "remember", fact: "Joe's charges a $60 call-out fee" } }], live.state);
    expect(effects).toEqual([{ kind: "remember", fact: "Joe's charges a $60 call-out fee" }]);
    expect(state).toEqual(live.state);
  });

  it("ignores brain output before the business answers", () => {
    expect(play([say("Hello?")]).effects).toEqual([]);
  });

  it("changes nothing once the call has ended", () => {
    const ended = play([answered, heard("Tuesday for 140 works"), confirm(140)]);
    const inputs: CallInput[] = [
      { kind: "answered" },
      { kind: "heard", text: "hello?" },
      { kind: "interrupted", spokenSoFar: "" },
      { kind: "line_ended", reason: "hangup" },
      { kind: "brain", turn: ended.state.turn, step: { kind: "say", text: "more", last: true } },
      { kind: "owner_said", text: "offer 160" },
      { kind: "owner_decided", requestId: "x", decision: "once" },
      { kind: "hold_tick" }
    ];
    for (const input of inputs) expect(step(ended.state, input, at(99_000))).toEqual({ state: ended.state, effects: [] });
  });
});

describe("redactDigits", () => {
  it.each([
    ["4111111111111111", "that number"],
    ["4111-1111-1111-1111", "that number"],
    ["4111/1111/1111/1111", "that number"],
    ["4111–1111–1111–1111", "that number"],
    ["(4111)(1111)(1111)(1111)", "(that number)"],
    ["4111 and 1111 and 1111 and 1111", "that number"],
    ["4111+1111*1111#1111", "that number"],
    ["٤١١١١١١١١١١١", "that number"],
    ["４１１１１１１１１１１１", "that number"],
    ["four one one one four one one one four one one one", "that number"],
    ["call 415 555 0134 back", "call 415 555 0134 back"],
    ["12345678901", "12345678901"],
    ["123456789012", "that number"],
    ["one moment, I'll be one minute", "one moment, I'll be one minute"]
  ])("%s", (input, expected) => {
    expect(redactDigits(input)).toBe(expected);
  });
});

describe("amount parsing", () => {
  it.each([
    ["one sixty", [160]],
    ["a hundred and fifty", [150]],
    ["one hundred eighty", [180]],
    ["$1,200", [1200]],
    ["sixty five", [65]],
    ["Tuesday at ten, that's one eighty", [10, 180]]
  ] as const)("amountsIn(%s)", (text, expected) => {
    expect(amountsIn(text)).toEqual(expected);
  });

  it.each([
    ["Booked for $180", [180]],
    ["one hundred eighty dollars, Tuesday", [180]],
    ["180 bucks", [180]],
    ["Tuesday at 10", []]
  ] as const)("chargedIn(%s)", (text, expected) => {
    expect(chargedIn(text)).toEqual(expected);
  });

  it.each([
    ["offer 160", 160],
    ["go up to 170", 170],
    ["don't go over 200", undefined],
    ["table for two", undefined]
  ] as const)("offerIn(%s)", (text, expected) => {
    expect(offerIn(text)).toBe(expected);
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

describe("rule 6: dial limits", () => {
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

  it("does not count calls older than a day", () => {
    const history = Array.from({ length: 3 }, () => call("4155550134", "2026-10-19T18:00:00.000Z"));
    expect(checkDialLimits(history, number, day)).toEqual({ ok: true });
  });
});
