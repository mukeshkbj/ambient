import { describe, expect, it } from "vitest";
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
  "Alright.", "All right, see you then.", "Perfect.", "Great, see you Tuesday.", "Exactly.", "Definitely.", "Certainly.", "Absolutely.", "Mhm.", "Mm-hmm.", "Mm hmm.",
  "Uh-huh.", "Uh huh, yes.", "Indeed.", "Looks good.", "Sounds good.", "Sounds great, thanks.", "That works.", "That'll work.", "Works for me.", "No problem.",
  "Yes, no problem.", "Not a problem.", "No worries, yes.", "You got it.", "You bet.", "Of course.", "Yes, Tuesday at three.", "Yes, one sixty.", "Yes, $160.",
  "Yes, $160.00, Tuesday at 3:00.", "Yes, one hundred sixty dollars.", "Yep, sorry, that's right.", "Sorry, yes, that's right.", "Yes sir.", "Yes, we'll see you then.",
  "Okay, great, thank you.", "Yes, you're all set.", "Booked.", "Yes, you're booked.", "Yeah, that's it.", "That is correct.", "Fine.", "Deal."
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
  "Tentatively, yes.", "Pencil it in.", "Yes, pending approval.", "Yes, subject to availability.", "Yes, once I see it.", "Yes, after I look at it."
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

  it("waits through an agreeing backchannel during playback, then books on the yes after it", () => {
    let state = startCall(brief, "call-1").state;
    const inputs: CallInput[] = [
      { kind: "answered" },
      { kind: "heard", text: "It's $160 for Tuesday at three." },
      { kind: "brain", turn: 1, step: { kind: "end_call", outcome: { kind: "confirmed", summary: "Tuesday at three for $160", amountUsd: 160, when: "Tuesday at three" } } },
      { kind: "heard", text: "Mm-hmm." },
      { kind: "played", text: READ_BACK },
      { kind: "heard", text: "Yes, that's right." }
    ];
    inputs.forEach((input, index) => {
      state = step(state, input, new Date(Date.UTC(2026, 9, 20, 17, 0, index)).toISOString()).state;
    });
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 160 } });
  });

  it("does not arm on a played report for a different line", () => {
    let state = readBackState();
    state = { ...state, readBack: state.readBack && { ...state.readBack, armed: false } };
    const next = step(state, { kind: "played", text: "Still checking with Maya, thanks for holding." }, "2026-10-20T17:01:00.000Z").state;
    expect(next.readBack).toMatchObject({ armed: false });
  });
});
