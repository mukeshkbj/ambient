import { describe, expect, it } from "vitest";
import { agreesTo, offerIn } from "../src/calls/rules.js";
import { startCall, step, type CallState } from "../src/calls/session.js";
import { parsePhoneNumber, type CallBrief, type CallInput } from "../src/calls/types.js";

const brief: CallBrief = {
  goal: "Book a plumber visit to fix a leaking kitchen sink",
  business: { name: "Joe's Plumbing", phone: parsePhoneNumber("4155550134") },
  ownerName: "Maya",
  maxUsd: 200,
  facts: []
};

const BOOKS = [
  "Yes.", "Yes, that's right.", "Yeah.", "Yep.", "Yup, that's correct.", "Correct.", "That's right.", "Right.", "Sure.", "Sure thing.", "Okay.", "OK, sounds good.",
  "Alright.", "All right, see you then.", "Perfect.", "Yes, great, see you Tuesday.", "Exactly.", "Definitely.", "Certainly.", "Absolutely.", "Mhm.", "Mm-hmm.", "Mm hmm.",
  "Uh-huh.", "Uh huh, yes.", "Indeed.", "Looks good.", "Sounds good.", "Sounds great, thanks.", "That works.", "That'll work.", "Works for me.", "No problem.",
  "Yes, no problem.", "Not a problem.", "No worries, yes.", "You got it.", "You bet.", "Of course.", "Yes, Tuesday at three.", "Yes, one sixty.", "Yes, $160.",
  "Yes, $160.00, Tuesday at 3:00.", "Yes, one hundred sixty dollars.", "Yep, sorry, that's right.", "Sorry, yes, that's right.", "Yes sir.", "Yes, we'll see you then.",
  "Okay, great, thank you.", "Yes, you're all set.", "Yes, you're booked.", "Yeah, that's it.", "That is correct.", "Deal."
] as const;

const DOES_NOT_BOOK = [
  "No.", "Nope.", "No, it's 200.", "No, one eighty.", "Yes. No, sorry, that's wrong.", "Sure. Actually it's more.", "We're fully booked Tuesday.",
  "Right now we're booked up.", "Okay, we're closed Tuesday.", "Let me make sure we have a tech free.", "Yeah, it's higher.", "That isn't right.", "That isn’t right.",
  "Yes, though it might change.", "Yes, ballpark.", "Yes, double.", "Yes, that's one-sixty a week.", "Right, well, I'd have to see it first.", "Yes, Wednesday at three.",
  "Yes, Tuesday at four.", "Yes, one eighty.", "Yes, $180.", "Yes, plus parts.", "Yes, plus tax.", "Yes, that's per hour.", "Yes, a hundred sixty an hour.",
  "Yes, but that's just the estimate.", "Sure, unless it's a bigger leak.", "Are you sure?", "Is that right?", "Yes, anything else?", "Okay, let me check with my manager.",
  "Sure, hold on.", "Right, one sec.", "Okay, I'll call you back.", "Okay, I need to run it by my boss.", "Hmm.", "What?", "Sorry, what?", "Say that again?",
  "Yeah, no, that's too low.", "Absolutely not.", "Right, not at that price.", "Okay, that's too much.", "Yes, that's a no from me.", "Sorry, we're booked.",
  "Yes, but we can't do Tuesday.", "Yeah, no, we don't do that.", "Yeah, I wish. It's 200.", "Okay, 150.", "Yes. We're at 4500 Main Street.", "Starting at that, yes.",
  "Yes, minimum.", "Yes, at least that.", "Probably.", "Maybe.", "I think so.", "Yes, if the part is in stock.", "Yes, depending on the pipe.", "Yes, roughly.",
  "Yes, about that.", "Around that, yes.", "Yes, approximately.", "Yes, for the first hour.", "Yes, each visit.", "Yes, every week.", "Yes, except the parts.",
  "Yes, unless it's worse.", "We'll see.", "Not sure.", "I guess.", "Kind of.", "Close enough.", "Yes, but the call-out is extra.", "Yes, and another fifty for parts.",
  "Yes, Tuesday or Wednesday.", "Yes, sometime next week.", "Yes, in the morning.", "Yes, after lunch.", "Yes, if you pay cash.", "Yes, with a deposit.",
  "Yes, half now.", "Yes, plus the trip fee.", "Okay then, don't be late.", "Fine, whatever.", "Yes, call me back to confirm.", "Yes, I'll text you the price.",
  "Yes, my boss will confirm.", "No problem, but it's 200.", "Correct, plus tax.", "Right, two hundred.", "Sure, one fifty.", "Sure, a hundred fifty.",
  "That works, but Thursday.", "Sounds good, Thursday then.", "Perfect, three thirty.", "Great, at four.", "OK, call-out only.", "Yeah, the repair is separate.",
  "Yes, labor only.", "Yes, not including parts.", "Mm, no.", "Uh, no.", "Nah.", "Never mind.", "Wait.", "Hold on.", "Just a second.", "Hang on.",
  "Who is this?", "Is this a robot?", "Yes, is this a robot?", "Yeah, for real?", "Seriously?", "Huh?", "Pardon?", "Come again?", "Yes, I'll put it in pencil.",
  "Tentatively, yes.", "Pencil it in.", "Yes, pending approval.", "Yes, subject to availability.", "Yes, once I see it.", "Yes, after I look at it.",
  "Yes, twelve fifty.", "Yes, nineteen ninety nine dollars.", "Yes, five five five.", "Thank you.", "Thank you, goodbye.", "Okay, bye.", "Okay, goodbye.",
  "Fine, oh well.", "Sorry, that's it.", "Great, see you Tuesday.", "Fine.", "Booked.", "Yes, one sixty, two hundred.", "Yes, a hundred and eighty."
] as const;

const READ_BACK = "Just to confirm: one hundred sixty dollars total, Tuesday at three. Is that right?";

function readBackState(): CallState {
  let state = startCall(brief, "call-1").state;
  const inputs: CallInput[] = [
    { kind: "answered" },
    { kind: "heard", text: "It's $160 for Tuesday at three." },
    { kind: "brain", turn: 1, step: { kind: "end_call", outcome: { kind: "confirmed", summary: "Tuesday at three for $160", amountUsd: 160, when: "Tuesday at three" } } },
    { kind: "played", text: READ_BACK }
  ];
  inputs.forEach((input, index) => {
    state = step(state, input, new Date(Date.UTC(2026, 9, 20, 17, 0, index)).toISOString()).state;
  });
  return state;
}

const reply = (text: string) => step(readBackState(), { kind: "heard", text }, "2026-10-20T17:01:00.000Z").state;

describe("read-back replies", () => {
  it("speaks the read-back the corpus assumes", () => {
    expect(readBackState().turns.at(-1)?.text).toBe(READ_BACK);
  });

  it("has a corpus of at least 150 labelled replies", () => {
    expect(BOOKS.length + DOES_NOT_BOOK.length).toBeGreaterThanOrEqual(150);
  });

  it.each(BOOKS)("books on %s", text => {
    expect(reply(text).phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 160 } });
  });

  it.each(DOES_NOT_BOOK)("does not book on %s", text => {
    expect(reply(text).phase).not.toMatchObject({ outcome: { kind: "confirmed" } });
  });

  it("does not evaluate a reply that arrives before the read-back finished playing", () => {
    let state = startCall(brief, "call-1").state;
    const inputs: CallInput[] = [
      { kind: "answered" },
      { kind: "heard", text: "It's $160 for Tuesday at three." },
      { kind: "brain", turn: 1, step: { kind: "end_call", outcome: { kind: "confirmed", summary: "Tuesday at three for $160", amountUsd: 160, when: "Tuesday at three" } } },
      { kind: "heard", text: "Sure, take your time." }
    ];
    inputs.forEach((input, index) => {
      state = step(state, input, new Date(Date.UTC(2026, 9, 20, 17, 0, index)).toISOString()).state;
    });
    expect(state.phase.kind).toBe("talking");
    expect(state.readBack).toBeUndefined();
    expect(state.readBacks).toBe(0);
  });

  it("asks once more after an agreeing backchannel during playback, then books on the yes", () => {
    let state = startCall(brief, "call-1").state;
    const inputs: CallInput[] = [
      { kind: "answered" },
      { kind: "heard", text: "It's $160 for Tuesday at three." },
      { kind: "brain", turn: 1, step: { kind: "end_call", outcome: { kind: "confirmed", summary: "Tuesday at three for $160", amountUsd: 160, when: "Tuesday at three" } } },
      { kind: "heard", text: "Mm-hmm." },
      { kind: "played", text: READ_BACK },
      { kind: "played", text: "Sorry, I talked over you. Was that a yes?" },
      { kind: "heard", text: "Yes, that's right." }
    ];
    inputs.forEach((input, index) => {
      state = step(state, input, new Date(Date.UTC(2026, 9, 20, 17, 0, index)).toISOString()).state;
    });
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 160 } });
  });

  const run = (inputs: CallInput[], from = startCall(brief, "call-1").state) => {
    let state = from;
    inputs.forEach((input, index) => {
      const resolved = input.kind === "brain" ? { ...input, turn: state.turn } : input;
      state = step(state, resolved, new Date(Date.UTC(2026, 9, 20, 17, 0, index)).toISOString()).state;
    });
    return state;
  };
  const book = (amountUsd: number, when: string): CallInput => ({ kind: "brain", turn: 0, step: { kind: "end_call", outcome: { kind: "confirmed", summary: "Booked", amountUsd, when } } });

  it("words each retry differently, so a late played report for an earlier read-back cannot arm a later one", () => {
    const first = run([{ kind: "answered" }, { kind: "heard", text: "It's $160 for Tuesday at three." }, book(160, "Tuesday at three")]);
    const firstLine = first.readBack!.line;
    const second = run([{ kind: "heard", text: "Um, hold on." }, book(160, "Tuesday at three")], first);
    expect(second.readBack!.line).not.toBe(firstLine);
    const stale = run([{ kind: "played", text: firstLine }, { kind: "heard", text: "Yes." }], second);
    expect(stale.phase).not.toMatchObject({ outcome: { kind: "confirmed" } });
  });

  it("arms when the read-back played at the end of a longer reply", () => {
    const asked = run([{ kind: "answered" }, { kind: "heard", text: "It's $160 for Tuesday at three." }, book(160, "Tuesday at three")]);
    const state = run([{ kind: "played", text: `Great, Tuesday works for us. ${asked.readBack!.line}` }, { kind: "heard", text: "Yes." }], asked);
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 160 } });
  });

  it("asks once more when the yes came while the read-back was still playing", () => {
    const asked = run([{ kind: "answered" }, { kind: "heard", text: "It's $160 for Tuesday at three." }, book(160, "Tuesday at three"), { kind: "heard", text: "Yes." }]);
    const replayed = run([{ kind: "played", text: asked.readBack!.line }], asked);
    expect(replayed.turns.at(-1)).toMatchObject({ speaker: "agent", text: "Sorry, I talked over you. Was that a yes?" });
    const done = run([{ kind: "played", text: "Sorry, I talked over you. Was that a yes?" }, { kind: "heard", text: "Yes." }], replayed);
    expect(done.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 160 } });
  });

  it.each([
    ["Yes, 3 dollars.", 200, "Tuesday at 3", false],
    ["Yes, at three.", 200, "Tuesday at 3", true],
    ["Yes, that's two hundred dollars.", 200, "Tuesday at 3", true],
    ["Yes, three o'clock.", 200, "Tuesday at ten", false]
  ] as const)("checks money and time in separate buckets: %s", (reply, amount, when, books) => {
    const asked = run([{ kind: "answered" }, { kind: "heard", text: `It's $${amount}.` }, book(amount, when)]);
    const state = run([{ kind: "played", text: asked.readBack!.line }, { kind: "heard", text: reply }], asked);
    expect(state.phase.kind === "ended" && state.phase.outcome.kind === "confirmed").toBe(books);
  });

  it("drops a pending read-back as soon as the agent says anything else or asks the owner", () => {
    const asked = run([{ kind: "answered" }, { kind: "heard", text: "It's $160 for Tuesday at three." }, book(160, "Tuesday at three")]);
    const spoke = run([{ kind: "brain", turn: 0, step: { kind: "say", text: "The address is 12 Elm Street.", last: true } }], asked);
    expect(spoke.readBack).toBeUndefined();
    const owner = run([{ kind: "brain", turn: 0, step: { kind: "ask_owner", question: "Is 200 okay?", amountUsd: 200 } }], asked);
    expect(owner.readBack).toBeUndefined();
  });

  it("does not let a word from the read-back carry a no", () => {
    expect(agreesTo("No, that's right.", "no price is set, Friday", undefined)).toBe(false);
    expect(agreesTo("Yes, that's right.", "no price is set, Friday", undefined)).toBe(true);
  });

  it("keeps thousands separators inside an amount", () => {
    expect(agreesTo("Yes, $1,000.", "one thousand dollars total, Friday", 1000)).toBe(true);
    expect(agreesTo("Yes, $1,000.", "one hundred dollars total, Friday", 100)).toBe(false);
  });

  it("ends the call after five read-backs even if each one is cancelled before it plays", () => {
    let state = run([{ kind: "answered" }, { kind: "heard", text: "It's $160 for Tuesday at three." }]);
    for (let round = 0; round < 6 && state.phase.kind !== "ended"; round += 1) {
      state = run([book(160, "Tuesday at three"), { kind: "heard", text: "Um, hold on." }], state);
    }
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed" } });
  });

  it("leaves no read-back pending while the owner is being asked", () => {
    const asked = run([{ kind: "answered" }, { kind: "heard", text: "It's $160 for Tuesday at three." }, book(160, "Tuesday at three"), book(400, "Tuesday at three")]);
    expect(asked.phase.kind).toBe("waiting_for_owner");
    expect(asked.readBack).toBeUndefined();
  });

  it("does not arm on a played report for a different line", () => {
    let state = readBackState();
    state = { ...state, readBack: state.readBack && { ...state.readBack, armed: false } };
    const next = step(state, { kind: "played", text: "Still checking with Maya, thanks for holding." }, "2026-10-20T17:01:00.000Z").state;
    expect(next.readBack).toMatchObject({ armed: false });
  });
});

describe("owner offers", () => {
  it("does not treat a question as an offer", () => {
    expect(offerIn("Would you pay 300?")).toBeUndefined();
    expect(offerIn("offer 300")).toBe(300);
  });
});
