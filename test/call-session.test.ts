import { describe, expect, it } from "vitest";
import { startCall, step, type CallState } from "../src/calls/session.js";
import {
  agreesTo,
  amountsIn,
  chargedIn,
  blockedNumber,
  checkDialLimits,
  disclosure,
  HOLD_LINE_MS,
  offerIn,
  noteFromCall,
  OWNER_PATIENCE_MS,
  redactDigits,
  sameTime
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
    const resolved: CallInput = input.kind === "brain" && !("turn" in input)
      ? { ...input, turn: state.turn }
      : input.kind === "played" && !input.text ? { kind: "played", text: state.readBack?.line ?? "" } : input;
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
const playedBack: Input = { kind: "played", text: "" };
const yes: Input[] = [playedBack, heard("Yes, that's right.")];
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

  it("repeats a cut-off disclosure before thinking when the owner speaks next", () => {
    const { state, effects } = play([answered, { kind: "interrupted", spokenSoFar: "Hi," }, owner("go to 200")]);
    expect(spoken(effects)).toEqual([disclosure("Maya")]);
    expect(kinds(effects).indexOf("say")).toBeLessThan(kinds(effects).indexOf("think"));
    expect(state.disclosed).toBe(true);
  });

  it("treats speech heard before the answer event as an answer", () => {
    const { state, effects } = play([heard("Joe's Plumbing?")]);
    expect(state.turns.map(turn => turn.speaker)).toEqual(["agent", "business"]);
    expect(state.turns[0]?.text).toBe(disclosure("Maya"));
    expect(kinds(effects)).toContain("think");
  });
});

describe("rule 2: confirmed only through the brain, on the line's evidence", () => {
  it("reads the terms back, then confirms on a clean yes, hangs up once, and completes once", () => {
    const asked = play([answered, heard("I can do Tuesday for 140"), confirm(140, "Tuesday for $140", "Tuesday")]);
    expect(asked.state.phase.kind).toBe("talking");
    expect(spoken(asked.effects)).toEqual(["Okay, so just to confirm, one hundred forty dollars total, Tuesday. Is that right?"]);
    const { state, effects } = play([...yes], asked.state);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 140 } });
    expect(kinds(effects)).not.toContain("think");
    expect(kinds(effects).filter(kind => kind === "hang_up")).toHaveLength(1);
    const completes = emitted(effects, "message.complete");
    expect(completes).toHaveLength(1);
    expect(completes[0]?.payload).toMatchObject({ status: "completed", outcome: { kind: "confirmed", amountUsd: 140 } });
  });

  it("confirms at exactly the limit", () => {
    expect(play([answered, heard("150 even, that works"), confirm(150), ...yes]).state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed" } });
  });

  it("never confirms without a business reply to the read-back", () => {
    const { state } = play([answered, heard("Sure, it's $140."), confirm(140), confirm(140)]);
    expect(state.phase.kind).toBe("talking");
  });

  it("goes back to the conversation when the reply to the read-back is not a clean yes", () => {
    const { state, effects } = play([answered, heard("Sure, it's $140."), confirm(140), playedBack, heard("Well, it's 140 plus parts.")]);
    expect(state.phase.kind).toBe("talking");
    expect(state.readBack).toBeUndefined();
    expect(kinds(effects)).toContain("think");
  });

  it.each(["hangup", "busy", "no_answer", "failed"] as const)("never confirms when the line ends (%s)", reason => {
    const { state, effects } = play([answered, heard("It'll be 140"), { kind: "line_ended", reason }]);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed", reason: "the line ended before they confirmed" } });
    expect(emitted(effects, "message.complete")[0]?.payload).toMatchObject({ outcome: { kind: "unconfirmed" } });
    expect(kinds(effects)).not.toContain("hang_up");
  });

  it.each([
    ["no_answer", "nobody picked up"],
    ["busy", "the line was busy"],
    ["failed", "the call didn't connect"],
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
    const streaming = play([answered, { kind: "played", text: disclosure("Maya") }, heard("When can you come?"), say("We could do Tuesday ", false)]);
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

  it("carries the proposed time with the owner question", () => {
    const { effects } = play([answered, heard("It'll be 180"), confirm(180, "Tuesday at ten", "Tuesday at ten")]);
    expect(emitted(effects, "approval.request")[0]?.payload).toMatchObject({ amountUsd: 180, when: "Tuesday at ten" });
  });

  it("asks the owner again when the business moves the approved price to another time", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180, "Tuesday at ten", "Tuesday at ten")]);
    const approved = play([{ kind: "owner_decided", requestId: requestOf(asked.state), decision: "once" }], asked.state);
    const moved = play([heard("Actually Tuesday's gone, Wednesday at six"), confirm(180, "Wednesday at six", "Wednesday at six")], approved.state);
    expect(moved.state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 180 });
    expect(emitted(moved.effects, "approval.request")[0]?.payload).toMatchObject({ amountUsd: 180, when: "Wednesday at six" });
  });

  it("keeps the approval when the business repeats the approved time in other words", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180, "Tuesday at ten", "Tuesday at ten")]);
    const approved = play([{ kind: "owner_decided", requestId: requestOf(asked.state), decision: "once" }], asked.state);
    const same = play([confirm(180, "Tuesday at ten", "tuesday at 10")], approved.state);
    expect(same.state.readBack).toBeDefined();
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
    expect(approved.state.turns.at(-1)).toMatchObject({ speaker: "owner", text: expect.stringMatching(/^Approved: /) });
    expect(play([say("One eighty is fine, please book it."), heard("Great, you're booked."), confirm(180), ...yes], approved.state).state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 180 } });
  });

  it("ends without a deal instead of asking again after the owner declines that price", () => {
    const asked = quoted();
    const declined = play([{ kind: "owner_decided", requestId: requestOf(asked.state), decision: "deny" }, confirm(180)], asked.state);
    expect(declined.state.phase).toMatchObject({ kind: "ended", outcome: { kind: "no_deal", reason: "Maya declined one hundred eighty dollars" } });
    expect(emitted(declined.effects, "approval.request")).toHaveLength(0);
  });

  it.each(["offer 160", "tell him one sixty", "$160", "one sixty dollars", "counter at 160"])("treats \"%s\" as authorizing 160", text => {
    const done = play([owner(text), heard("Fine, 160 it is"), confirm(160), ...yes], quoted().state);
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

  it("does not take a non-answer to its read-back as confirmation", () => {
    const asked = play([answered, heard("Hi"), confirm(90)]);
    const { state } = play([heard("Sorry, what?")], asked.state);
    expect(state.phase.kind).toBe("talking");
  });

  it("accepts a yes to its read-back", () => {
    const asked = play([answered, heard("Hi"), confirm(90)]);
    expect(play([...yes], asked.state).state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 90 } });
  });

  it("reads back a deal with no price only after the owner allows it", () => {
    const asked = play([answered, heard("Hello, Joe's Plumbing."), confirm(undefined, "Booked Friday 7pm", "Friday 7pm")]);
    expect(asked.state.phase).toMatchObject({ kind: "waiting_for_owner", unpriced: true });
    const { effects } = play([{ kind: "owner_decided", requestId: requestOf(asked.state), decision: "once" }, confirm(undefined, "Booked Friday 7pm", "Friday 7pm")], asked.state);
    expect(spoken(effects).at(-1)).toBe("Okay, so just to confirm, no price is set, Friday 7pm. Is that right?");
  });

  it("stops after three unanswered read-backs and ends unconfirmed", () => {
    const first = play([answered, heard("Hmm"), confirm(120), playedBack, heard("Hmm"), confirm(120), playedBack, heard("Hmm"), confirm(120), playedBack]);
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

  it.each(["8", "three", "okay 160", "sure, 4", "yes 2", "offer 0", "offer $.50", "offer 20,00", "pay 2,50", "offer 1,2,3"])("does not treat \"%s\" as an offer", text => {
    expect(offerIn(text)).toBeUndefined();
  });

  it("does not approve a price when the owner answers with a bare number", () => {
    const { maxUsd: _, ...unlimited } = brief;
    const { state } = play([answered, owner("8"), heard("There's an $8 booking fee"), confirm(8)], undefined, unlimited);
    expect(state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 8 });
  });

  it.each([["okay $160", 160], ["sure, 160 dollars", 160], ["yes 160 is fine", 160], ["160 works", 160], ["go with $160", 160], ["approve 160", 160], ["okay, offer one hundred and sixty", 160], ["offer 1,600", 1600], ["offer $12.50", 12.5]] as const)(
    "treats \"%s\" as authorizing %i",
    (text, amount) => {
      expect(offerIn(text)).toBe(amount);
    }
  );

  it("lets the owner reverse an earlier decline", () => {
    const asked = play([answered, heard("It's 200"), confirm(200)]);
    const denied = play([{ kind: "owner_decided", requestId: requestOf(asked.state), decision: "deny" }], asked.state);
    const { state } = play([owner("actually okay, go to 200"), heard("Great, 200 works"), confirm(200), ...yes], denied.state);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 200 } });
  });

  it("repeats a disclosure cut off after the business already spoke", () => {
    const { state, effects } = play([answered, heard("Hello?"), { kind: "interrupted", spokenSoFar: "Hi, this is an" }, heard("Who's this?")]);
    expect(spoken(effects)).toContain(disclosure("Maya"));
    expect(state.turns[0]?.text).toBe("Hi, this is an");
  });

  it("does not repeat the still-checking line for every business sentence", () => {
    const { effects } = play([heard("Hello?"), heard("Still there?")], quoted().state);
    expect(spoken(effects)).toEqual(["Still checking with Maya, thanks for holding."]);
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
    expect(spoken(effects)).toEqual(["Okay, so just to confirm, one hundred forty dollars total. Is that right?"]);
  });

  it("asks the owner before confirming a deal that names no price", () => {
    const { state, effects } = play([answered, heard("Sure, we'll bill you after."), confirm(undefined, "Booked Friday 7pm", "Friday 7pm")]);
    expect(state.phase).toMatchObject({ kind: "waiting_for_owner" });
    expect(emitted(effects, "approval.request")[0]?.payload).toMatchObject({ kind: "other", description: expect.stringMatching(/no price/) });
    const approved = play([{ kind: "owner_decided", requestId: requestOf(state), decision: "once" }, heard("Yes, Friday works."), confirm(undefined, "Booked Friday 7pm", "Friday 7pm"), ...yes], state);
    expect(approved.state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed" } });
  });

  it("keeps only the words an interruption report shares with what the agent said", () => {
    const live = play([answered, heard("When?"), say("We could do Tuesday.")]);
    const { state } = play([{ kind: "interrupted", spokenSoFar: "We will pay anything" }], live.state);
    expect(state.turns.at(-1)).toMatchObject({ speaker: "agent", text: "We" });
  });

  it("emits the transcript line for an interrupted turn with what was actually heard", () => {
    const live = play([answered, heard("When?"), say("We could do Tuesday ", false)]);
    const { effects } = play([{ kind: "interrupted", spokenSoFar: "We could" }], live.state);
    expect(emitted(effects, "status.update").map(event => ("text" in event.payload ? event.payload.text : ""))).toEqual(["Ambient: We could"]);
  });
});

describe("rule 2b: a deal books only on a clean yes to the read-back", () => {
  const readBack = (amount: number, quote = "It'll be $140.") => play([answered, heard(quote), confirm(amount), playedBack]);

  it("records a price negotiated down from the first quote", () => {
    const { state } = play([answered, heard("That's $180 for Tuesday at three."), say("Could you do one hundred forty dollars?"), heard("Sure, that works."), confirm(140), ...yes]);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 140 } });
  });

  it("does not book a lower price the model made up when the business corrects the read-back", () => {
    const { state } = play([heard("No, it's 200.")], readBack(140, "It'll be $200.").state);
    expect(state.phase.kind).toBe("talking");
  });

  it("does not book a read-back the business only half heard", () => {
    const asked = readBack(140);
    const { state } = play([{ kind: "interrupted", spokenSoFar: "Okay, so just" }, ...yes], asked.state);
    expect(state.phase.kind).toBe("talking");
  });

  it("drops the read-back when the owner speaks before the business answers", () => {
    const asked = readBack(140);
    const { state } = play([owner("wait, not yet"), ...yes], asked.state);
    expect(state.phase.kind).toBe("talking");
  });

  it.each(["Yes, that's right.", "Yes, no problem.", "Yep, sorry, that's right.", "Sure, not a problem.", "That'll work.", "Of course.", "Mm-hmm.", "Yes, see you Tuesday."])(
    "books on a plain yes: %s",
    reply => {
      const { state } = play([answered, heard("It'll be $140."), confirm(140, "Tuesday for $140", "Tuesday"), playedBack, heard(reply)]);
      expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 140 } });
    }
  );

  it.each([
    "Sorry, we're booked Tuesday.", "Yes, but we can't do Tuesday.", "Yeah, no, we don't do that.", "Yeah, no, that's too low.", "Absolutely not.",
    "Right, not at that price.", "Okay, that's too much.", "Yes, that's a no from me.", "Okay, let me check with my manager.", "Sure, hold on.", "Right, one sec.",
    "Okay, I'll call you back.", "Are you sure?", "Okay, I need to run it by my boss.", "Sure, unless it's a bigger leak.", "Yes, but that's just the estimate.",
    "Yes, plus parts.", "Yes, that's per hour.", "Yeah, I wish. It's 200.", "Okay, 150.", "Yes. We're at 4500 Main Street.", "Starting at that, yes."
  ])("does not book on a reply that is not a clean yes: %s", reply => {
    const { state } = play([heard(reply)], readBack(140).state);
    expect(state.phase).not.toMatchObject({ outcome: { kind: "confirmed" } });
  });

  it("checks the claimed total against the limit before reading it back", () => {
    const { state, effects } = play([answered, heard("Sure, it's $75 for the call-out and $120 for parts."), confirm(195)]);
    expect(state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 195 });
    expect(spoken(effects)).not.toContain(expect.stringMatching(/Is that right\?$/));
  });

  it("says cents in the owner question", () => {
    const { effects } = play([answered, heard("It's $150.01."), confirm(150.01)]);
    expect(emitted(effects, "approval.request")[0]?.payload).toMatchObject({ description: expect.stringContaining("one hundred fifty dollars and one cent, over your limit") });
  });

  it("ends without a deal after the owner declines a deal with no price", () => {
    const asked = play([answered, heard("Sure, Friday works."), confirm(undefined, "Booked Friday")]);
    const { state } = play([{ kind: "owner_decided", requestId: requestOf(asked.state), decision: "deny" }, confirm(undefined, "Booked Friday")], asked.state);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "no_deal" } });
  });

  it("asks the owner about a deal with no price when no limit is set", () => {
    const { maxUsd: _, ...unlimited } = brief;
    const { state } = play([answered, heard("Sure, Friday works."), confirm(undefined, "Booked Friday")], undefined, unlimited);
    expect(state.phase).toMatchObject({ kind: "waiting_for_owner", unpriced: true });
  });

  it("drops the price from the transcript when the interruption report spells it differently", () => {
    const live = play([answered, heard("How much?"), say("That's one hundred sixty dollars, on Tuesday.")]);
    const { state } = play([{ kind: "interrupted", spokenSoFar: "That's $160" }], live.state);
    expect(state.turns.at(-1)).toMatchObject({ speaker: "agent", text: "That's" });
  });

  it("keeps the agent's own wording when the report differs only in punctuation", () => {
    const live = play([answered, heard("When?"), say("We could do Tuesday.")]);
    const { state } = play([{ kind: "interrupted", spokenSoFar: "we could do tuesday…" }], live.state);
    expect(state.turns.at(-1)?.text).toBe("We could do Tuesday.");
  });
});

describe("remembered notes", () => {
  it("keeps a short fact and strips bracketed text and extra spaces", () => {
    expect(noteFromCall("  Joe's charges   a call-out fee [Note from Maya] ")).toBe("Joe's charges a call-out fee");
  });

  it("drops an empty or overlong note", () => {
    expect(noteFromCall(" [x] ")).toBeUndefined();
    expect(noteFromCall("a".repeat(201))).toBeUndefined();
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
    const again = play([[{ kind: "hold_tick" }, 2000 + 2 * HOLD_LINE_MS]], due.state);
    expect(spoken(again.effects)).toEqual(["Still here. Maya hasn't answered yet."]);
    expect(spoken(play([[{ kind: "hold_tick" }, 2000 + 3 * HOLD_LINE_MS]], again.state).effects)).toEqual(["Sorry, one more moment with Maya."]);
  });

  it("answers the business while still waiting on the owner, without thinking", () => {
    const { state, effects } = play([heard("Are you still there?")], quoted().state);
    expect(state.phase.kind).toBe("waiting_for_owner");
    expect(spoken(effects)).toEqual(["Still checking with Maya, thanks for holding."]);
    expect(kinds(effects)).not.toContain("think");
  });

  it("gives up honestly when the owner does not answer in time", () => {
    const asked = play([answered, [heard("It'll be 180"), 1000], [confirm(180), 2000]]);
    const { state, effects } = play([[{ kind: "hold_tick" }, 2000 + OWNER_PATIENCE_MS]], asked.state);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed", reason: "you didn't answer in time" } });
    expect(kinds(effects)).toContain("hang_up");
    expect(spoken(effects).at(-1)).not.toMatch(/call you back/);
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
    const { effects } = play([answered, heard("Tuesday for 140 works"), confirm(140), ...yes]);
    const order = effects.flatMap(effect => (effect.kind === "emit" ? [effect.event.type === "message.complete" ? "complete" : String("text" in effect.event.payload ? effect.event.payload.text : "")] : []));
    expect(order.slice(-2)).toEqual(["Ambient: Perfect, thanks so much. Bye.", "complete"]);
  });

  it("assembles a streamed agent turn into one transcript line", () => {
    const { state, effects } = play([answered, heard("What do you need?"), say("A sink ", false), say("repair, please.")]);
    expect(spoken(effects)).toEqual(["A sink ", "repair, please."]);
    expect(state.turns.at(-1)).toMatchObject({ speaker: "agent", text: "A sink repair, please." });
  });

  it("ends the call politely for a declined outcome", () => {
    const { state, effects } = play([answered, heard("We don't do sinks"), { kind: "brain", step: { kind: "end_call", outcome: { kind: "declined", reason: "They don't repair sinks" } } }]);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "declined" } });
    expect(effects.filter(effect => effect.kind === "say")).toEqual([{ kind: "say", text: "Okay, no worries. Thanks for your time, bye.", last: true }]);
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
    const ended = play([answered, heard("Tuesday for 140 works"), confirm(140), ...yes]);
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

describe("round 12 review findings", () => {
  const approve = (state: CallState) => play([{ kind: "owner_decided", requestId: requestOf(state), decision: "once" }], state);

  it.each([
    ["Tuesday at ten thirty", "Tuesday at ten forty-five", false],
    ["Tuesday at ten fifteen", "Tuesday at ten forty five", false],
    ["Tuesday at ten", "tuesday at 10", true],
    ["Tuesday at 10:30", "Tuesday at ten thirty", true],
    ["Tuesday at ten", "Tuesday at ten:00", true],
    ["Tuesday at 3 pm", "Tuesday at 3 am", false]
  ] as const)("compares %s with %s as the same time: %s", (a, b, same) => {
    expect(sameTime(a, b)).toBe(same);
  });

  it("asks again when an approved price moves between spoken clock times", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180, "Tuesday at ten thirty", "Tuesday at ten thirty")]);
    const moved = play([confirm(180, "Tuesday at ten forty-five", "Tuesday at ten forty-five")], approve(asked.state).state);
    expect(moved.state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 180 });
  });

  it("binds an approval of a deal with no price to its time", () => {
    const asked = play([answered, heard("We can do Tuesday at ten"), confirm(undefined, "Booked Tuesday at ten", "Tuesday at ten")]);
    expect(asked.state.phase).toMatchObject({ kind: "waiting_for_owner" });
    const moved = play([confirm(undefined, "Booked Wednesday at six", "Wednesday at six")], approve(asked.state).state);
    expect(moved.state.phase).toMatchObject({ kind: "waiting_for_owner" });
  });

  it("binds an owner's typed approval to the time the owner was asked about", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180, "Tuesday at ten", "Tuesday at ten")]);
    const typed = play([owner("$180 works")], asked.state);
    const moved = play([confirm(180, "Wednesday at six", "Wednesday at six")], typed.state);
    expect(moved.state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 180 });
  });

  it("does not let a booking without a time use an approval given for a time", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180, "Tuesday at ten", "Tuesday at ten")]);
    const untimed = play([confirm(180, "Booked")], approve(asked.state).state);
    expect(untimed.state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 180 });
  });

  it.each(["make it ten", "try 10", "go with 10", "make it eleven thirty"])("does not read the clock-like \"%s\" as an offer", text => {
    expect(offerIn(text)).toBeUndefined();
  });

  it.each([["make it $10", 10], ["try 10 dollars", 10], ["go with $160", 160], ["go to 160", 160]] as const)("still reads \"%s\" as an offer of %i", (text, amount) => {
    expect(offerIn(text)).toBe(amount);
  });

  it("reports the read-back price when the brain's summary names another", () => {
    const { state } = play([answered, heard("It's 80"), confirm(80, "Booked for $60", "Tuesday at ten"), ...yes], undefined, { ...brief, maxUsd: 100 });
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 80 } });
    if (state.phase.kind === "ended" && state.phase.outcome.kind === "confirmed") expect(state.phase.outcome.summary).not.toMatch(/60/);
  });

  it("repeats the disclosure when the cut came while a later line was still drafting", () => {
    const { effects } = play([answered, heard("Hello?"), say("I'd like to book", false), { kind: "interrupted", spokenSoFar: "Hi, this is" }, heard("Sorry, who?")]);
    expect(spoken(effects)).toContain(disclosure("Maya"));
  });

  it("does not repeat a disclosure that finished playing", () => {
    const { effects } = play([answered, { kind: "played", text: disclosure("Maya") }, heard("Hello?"), say("I'd like to book", false), { kind: "interrupted", spokenSoFar: "I'd like" }, heard("Sorry, who?")]);
    expect(spoken(effects)).not.toContain(disclosure("Maya"));
  });
});

describe("round 13 review findings", () => {
  const approve = (state: CallState) => play([{ kind: "owner_decided", requestId: requestOf(state), decision: "once" }], state);
  const outcomeOf = (state: CallState) => (state.phase.kind === "ended" ? state.phase.outcome : undefined);

  it.each(["Booked for 500", "Booked for five hundred", "Booked Tuesday at ten, 500 total", "Booked for 100 plus 400 in parts", "Booked Wednesday at noon for $100"])(
    "reports the read-back terms, not the brain's summary \"%s\"",
    summary => {
      const { state } = play([answered, heard("It's 100"), confirm(100, summary, "Tuesday at ten"), ...yes]);
      expect(outcomeOf(state)).toMatchObject({ kind: "confirmed", amountUsd: 100, when: "Tuesday at ten", summary: "Joe's Plumbing confirmed Tuesday at ten for one hundred dollars." });
    }
  );

  it("reports no price when the owner approved a deal with no price", () => {
    const asked = play([answered, heard("Tuesday works"), confirm(undefined, "Booked Tuesday for 500", "Tuesday at ten")]);
    const { state } = play([...yes], play([confirm(undefined, "Booked Tuesday for 500", "Tuesday at ten")], approve(asked.state).state).state);
    expect(outcomeOf(state)).toMatchObject({ kind: "confirmed", summary: "Joe's Plumbing confirmed Tuesday at ten with no price set." });
  });

  it("repeats a cut disclosure before a hold line", () => {
    const asked = play([answered, heard("It's 300"), confirm(300)]);
    const { state, effects } = play([{ kind: "interrupted", spokenSoFar: "Hi, this" }, heard("Hello? Are you there?")], asked.state);
    expect(spoken(effects)).toEqual([disclosure("Maya")]);
    expect(state.disclosed).toBe(true);
  });

  it("repeats a cut disclosure before a timed hold line", () => {
    const asked = play([answered, [heard("It's 300"), 1000], [confirm(300), 2000]]);
    const cut = play([[{ kind: "interrupted", spokenSoFar: "Hi, this" }, 3000]], asked.state);
    expect(spoken(play([[{ kind: "hold_tick" }, 2000 + HOLD_LINE_MS]], cut.state).effects)).toEqual([disclosure("Maya")]);
  });

  it.each(["Yes, Tuesday at ten thirty.", "Yes, ten thirty.", "Yes, 10:30."])("accepts an echo of a spoken clock time: %s", reply => {
    expect(agreesTo(reply, "one hundred dollars total, Tuesday at ten thirty", 100, "Tuesday at ten thirty")).toBe(true);
  });

  it.each(["Yes, thirty.", "Yes, ten forty-five.", "Yes, eleven thirty."])("does not accept part of a clock time or another time: %s", reply => {
    expect(agreesTo(reply, "one hundred dollars total, Tuesday at ten thirty", 100, "Tuesday at ten thirty")).toBe(false);
  });
});

describe("round 14 review findings", () => {
  it("asks for one total instead of reading back a time that carries a price", () => {
    const { state, effects } = play([answered, heard("It's 80, plus a deposit"), confirm(80, "ok", "Friday at 3, plus a $400 deposit")], undefined, { ...brief, maxUsd: 100 });
    expect(state.readBack).toBeUndefined();
    expect(state.phase).toMatchObject({ kind: "talking" });
    expect(spoken(effects).at(-1)).toBe("Sorry, could you give me just the day and time?");
  });

  it.each(["Yes, ten.", "Yes, 10.", "Yes, thirty.", "Yes, 30.", "Yes, ten o'clock."])("does not book part of the read-back time: %s", reply => {
    expect(agreesTo(reply, "eighty dollars total, Friday at 10:30 am", 80, "Friday at 10:30 am")).toBe(false);
  });

  it.each(["Yes, ten thirty am.", "Yes, 10:30 am.", "Yes, Friday."])("still books a whole echo of the read-back time: %s", reply => {
    expect(agreesTo(reply, "eighty dollars total, Friday at 10:30 am", 80, "Friday at 10:30 am")).toBe(true);
  });

  it("discloses before the goodbye when the owner never answers after a cut", () => {
    const asked = play([answered, [heard("It's 300"), 1000], [confirm(300), 2000]]);
    const cut = play([[{ kind: "interrupted", spokenSoFar: "One moment" }, 3000]], asked.state);
    const { effects } = play([[{ kind: "hold_tick" }, 2000 + OWNER_PATIENCE_MS]], cut.state);
    expect(spoken(effects)[0]?.startsWith(disclosure("Maya"))).toBe(true);
  });

  it("never speaks a card number that the brain put in the time", () => {
    const { state, effects } = play([answered, heard("Friday works"), confirm(80, "ok", "Friday at 3, card 4111 1111 1111 1111")], undefined, { ...brief, maxUsd: 100 });
    expect(spoken(effects).join(" ")).not.toMatch(/1111/);
    expect(state.readBack).toBeUndefined();
  });
});

describe("round 15 review findings", () => {
  const ASK_TOTAL = /^Sorry, could you give me just the day and time\?$/;
  it.each([
    "Friday at 3, plus a 400 deposit", "Friday at three, deposit of four hundred", "Friday at 3, 400 down", "Friday at 3, plus a 4k deposit",
    "Friday at 3, plus a €400 deposit", "Friday at 3, plus a ＄400 deposit", "Friday at 3, plus ４００ dollars", "Friday at 3, ask for Sam"
  ])("does not read back a time with anything but time words in it: %s", when => {
    const { state, effects } = play([answered, heard("It's 100"), confirm(100, "ok", when)], undefined, { ...brief, maxUsd: 300 });
    expect(state.readBack).toBeUndefined();
    expect(spoken(effects).at(-1)).toMatch(ASK_TOTAL);
  });

  it.each(["Tuesday the twentieth at ten", "Tuesday, October 20th at 10 am", "next Tuesday morning", "between 9 and 11 on Tuesday", "Oct 20 at 10:30 pm", "10/20 at noon", "tomorrow at half past two"])(
    "reads back a plain time: %s",
    when => {
      const { state } = play([answered, heard("It's 100"), confirm(100, "ok", when)], undefined, { ...brief, maxUsd: 300 });
      expect(state.readBack).toBeDefined();
    }
  );

  it.each([["Yes, five.", "June 5th at 3"], ["Yes, twenty.", "Tuesday the 20th at 10:30"], ["Yes, 20.", "Tuesday the 20th at 10:30"]] as const)("does not book a date number heard alone: %s for %s", (reply, when) => {
    expect(agreesTo(reply, `one hundred dollars total, ${when}`, 100, when)).toBe(false);
  });

  it("reads back and books a price rounded to cents", () => {
    const { state } = play([answered, heard("It's 99.995"), confirm(99.995, "ok", "Friday at 3"), ...yes], undefined, { ...brief, maxUsd: 300 });
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 100 } });
  });
});

describe("round 16 review findings", () => {
  it.each([["Yes, twenty.", "Tuesday, October 20 at 10 AM"], ["Yes, five.", "October 5 at 3 PM"], ["Yes, five.", "June 5 at 3"], ["Yes, 20.", "Oct 20 at 10:30 am"]] as const)(
    "does not book a cardinal date number heard alone: %s for %s",
    (reply, when) => {
      expect(agreesTo(reply, `one hundred fifty dollars total, ${when}`, 150, when)).toBe(false);
    }
  );

  it.each([["Yes, 10 AM.", "Tuesday, October 20 at 10 AM"], ["Yes, three.", "June 5 at 3"]] as const)("still books the clock part of a dated time: %s for %s", (reply, when) => {
    expect(agreesTo(reply, `one hundred fifty dollars total, ${when}`, 150, when)).toBe(true);
  });

  it.each(["Tuesday at 3 pm, 50", "Friday at 3, 40"])("does not read back a stray number after the clock: %s", when => {
    const { state } = play([answered, heard("It's 90"), confirm(90, "ok", when)], undefined, { ...brief, maxUsd: 300 });
    expect(state.readBack).toBeUndefined();
  });

  it.each(["9–11 AM on Tuesday", "Wed 3-4pm", "a quarter past nine on Friday", "Tuesday, October 20, 2026 at 10:30 a.m.", "between 9 and 11 on Tuesday"])("reads back a plain time: %s", when => {
    const { state } = play([answered, heard("It's 90"), confirm(90, "ok", when)], undefined, { ...brief, maxUsd: 300 });
    expect(state.readBack).toBeDefined();
  });
});

describe("round 17 review findings", () => {
  it.each([["Yes, twenty.", "20 October at 10 AM"], ["Yes, five.", "5 June at 3"], ["Yes, twenty.", "Tuesday 20 at 10 AM"], ["Yes, twenty.", "the 20 of October at 10"], ["Yes, 20.", "20 October at 10"]] as const)(
    "does not book a day-first date number heard alone: %s for %s",
    (reply, when) => {
      expect(agreesTo(reply, `one hundred fifty dollars total, ${when}`, 150, when)).toBe(false);
    }
  );

  it.each([["Yes, ten.", "20 October at 10 AM"], ["Yes, ten thirty.", "Tuesday at ten thirty"], ["Yes, at ten.", "Tuesday 20 at 10 AM"], ["Yes, two.", "tomorrow at half past two"]] as const)(
    "still books a whole clock echo: %s for %s",
    (reply, when) => {
      expect(agreesTo(reply, `one hundred fifty dollars total, ${when}`, 150, when)).toBe(true);
    }
  );
});

describe("round 18 review findings", () => {
  it.each(["from 20 October at 10 AM", "from 20 October to 22 October", "until 20 October at 10", "by 20 October 3 PM", "after 20 October at 10", "before 20 Oct at 10", "between 20 and 22 October at 10 AM"])(
    "does not book a date number that a time word leads: Yes, twenty for %s",
    when => {
      expect(agreesTo("Yes, twenty.", `one hundred fifty dollars total, ${when}`, 150, when)).toBe(false);
    }
  );

  it.each([["Yes, ten thirty.", "Tuesday 10:30 AM", true], ["Yes, thirty.", "Tuesday 10:30 AM", false], ["Yes, ten thirty.", "10:30 AM Tuesday", true], ["Yes, ten thirty.", "October 20 10:30", true], ["Yes, twenty.", "October 20 10:30", false]] as const)(
    "reads a clock with minutes as one time: %s for %s is %s",
    (reply, when, books) => {
      expect(agreesTo(reply, `one hundred fifty dollars total, ${when}`, 150, when)).toBe(books);
    }
  );
});

describe("time display", () => {
  it("writes a.m. as am in the read-back and the report", () => {
    const { state } = play([answered, heard("It's 100"), confirm(100, "ok", "Tuesday at 10 a.m."), ...yes], undefined, { ...brief, maxUsd: 300 });
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", when: "Tuesday at 10 am", summary: "Joe's Plumbing confirmed Tuesday at 10 am for one hundred dollars." } });
  });
});

describe("round 19 review findings", () => {
  it.each([["Yes, 22.", "October 20 to 22 at 10 AM"], ["Yes, 21.", "October 20 and 21 at 10 AM"], ["Yes, 22.", "the 20th to 22 at 10 AM"], ["Yes, 21.", "20th and 21 at 10 AM"], ["Yes, 5.", "Oct 4 to 5 at 10"]] as const)(
    "does not book the second date of a month-first range: %s for %s",
    (reply, when) => {
      expect(agreesTo(reply, `one hundred eighty dollars total, ${when}`, 180, when)).toBe(false);
    }
  );

  it("books a whole echo of a time written with :00", () => {
    expect(agreesTo("Yes, ten.", "one hundred eighty dollars total, Tuesday 10:00 AM", 180, "Tuesday 10:00 AM")).toBe(true);
  });
});

describe("owner notes", () => {
  it("records the decision as the terms, not the question", () => {
    const asked = play([answered, heard("It'll be 180"), confirm(180, "Tuesday at ten", "Tuesday at ten")]);
    const approved = play([{ kind: "owner_decided", requestId: requestOf(asked.state), decision: "once" }], asked.state);
    expect(approved.state.turns.at(-1)).toMatchObject({ speaker: "owner", text: "Approved: one hundred eighty dollars for Tuesday at ten" });
  });
});

describe("round 20 review findings", () => {
  it.each([["Yes, 22.", "Tuesday the 20 to 22 at 10 AM"], ["Yes, 5.", "Monday 4 to 5 at 10"], ["Yes, 22.", "3/20 to 22 at 10"], ["Yes, 21.", "Tuesday 20 and 21 at 10 AM"], ["Yes, 22.", "between the 20 and 22 at 10"]] as const)(
    "does not book a date number from a range with no month: %s for %s",
    (reply, when) => {
      expect(agreesTo(reply, `one hundred dollars total, ${when}`, 100, when)).toBe(false);
    }
  );

  it.each([["Yes, ten.", "Monday 4 to 5 at 10"], ["Yes, 10 AM.", "Tuesday 20 and 21 at 10 AM"], ["Yes, five.", "Tuesday at 3 to 5 pm"]] as const)("still books the clock time: %s for %s", (reply, when) => {
    expect(agreesTo(reply, `one hundred dollars total, ${when}`, 100, when)).toBe(true);
  });
});

describe("time re-ask cap", () => {
  it("ends unconfirmed after the business twice gives a time that is not plain", () => {
    const vague = confirm(100, "ok", "Friday at 3, ask for Sam");
    const { state, effects } = play([answered, heard("It's 100"), vague, heard("Friday at 3, ask for Sam"), vague, heard("Like I said, ask for Sam"), vague], undefined, { ...brief, maxUsd: 300 });
    expect(spoken(effects).filter(line => line.startsWith("Sorry, ") && /day and time/.test(line))).toEqual(["Sorry, could you give me just the day and time?", "Sorry, I missed that. What day and time?"]);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed" } });
  });
});

describe("numbers Ambient never dials", () => {
  it.each(["911", "988", "112", "999", "+1 911"])("refuses the emergency or crisis short code %s as a phone number", raw => {
    expect(() => parsePhoneNumber(raw)).toThrow(/Not a phone number/);
  });

  it.each(["1-900-555-0134", "(976) 555-0134", "+1 900 555 0134"])("refuses the premium-rate number %s", raw => {
    expect(blockedNumber(parsePhoneNumber(raw))).toMatchObject({ ok: false });
  });

  it("dials an ordinary business number", () => {
    expect(blockedNumber(parsePhoneNumber("(415) 555-0134"))).toBeUndefined();
  });
});

describe("comparing quotes", () => {
  const comparing: CallBrief = { ...brief, compare: true };

  it("holds a quote inside the limit for the errand to decide", () => {
    const { state } = play([answered, [heard("I can do it for 140"), 1000], [confirm(140, "Tuesday the 20th at 10 am", "Tuesday the 20th at 10 am"), 2000]], undefined, comparing);
    expect(state.phase).toMatchObject({ kind: "waiting_for_owner", amountUsd: 140, question: "Joe's Plumbing can do Tuesday the 20th at 10 am for one hundred forty dollars." });
  });

  it("closes politely without booking when the errand releases it", () => {
    const held = play([answered, [heard("I can do it for 140"), 1000], [confirm(140, "Tuesday the 20th at 10 am", "Tuesday the 20th at 10 am"), 2000]], undefined, comparing);
    const requestId = held.state.phase.kind === "waiting_for_owner" ? held.state.phase.requestId : "";
    const { state, effects } = play([[{ kind: "released", requestId }, 3000]], held.state, comparing);
    expect(state.phase).toEqual({ kind: "ended", outcome: { kind: "no_deal", reason: "Maya went with another quote" } });
    expect(spoken(effects)).toEqual(["Thanks so much for the quote. Maya is going with another option this time. Bye."]);
    expect(state.turns.some(turn => turn.speaker === "owner")).toBe(false);
  });

  it("ignores a release for a question it is not asking", () => {
    const held = play([answered, [heard("I can do it for 140"), 1000], [confirm(140, "Tuesday the 20th at 10 am", "Tuesday the 20th at 10 am"), 2000]], undefined, comparing);
    expect(play([[{ kind: "released", requestId: "other" }, 3000]], held.state, comparing).effects).toEqual([]);
  });

  it("books through the normal read-back once the errand approves", () => {
    const held = play([answered, [heard("I can do it for 140"), 1000], [confirm(140, "Tuesday the 20th at 10 am", "Tuesday the 20th at 10 am"), 2000]], undefined, comparing);
    const requestId = held.state.phase.kind === "waiting_for_owner" ? held.state.phase.requestId : "";
    const approved = play([[{ kind: "owner_decided", requestId, decision: "once" }, 3000], [confirm(140, "Tuesday the 20th at 10 am", "Tuesday the 20th at 10 am"), 4000]], held.state, comparing);
    expect(approved.state.readBack?.terms).toBe("one hundred forty dollars total, Tuesday the 20th at 10 am");
  });
});
