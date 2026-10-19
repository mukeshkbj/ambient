import { describe, expect, it } from "vitest";
import { approvalAsk, heldStatus, runResult, speak, steerReply, titleFor } from "../src/voice.js";
import type { RunView } from "../src/types.js";

// UUIDs, runtime-namespaced ids ("planner:ap-91f2"), and opaque request ids.
// The namespaced pattern requires a letter after the colon so "7:30pm" passes.
const ID_LIKE = /[0-9a-f]{8}-[0-9a-f-]{27,}|\b[a-z][\w-]*:[a-z][\w-]+|\bap-\w+/i;

function view(overrides: Partial<RunView>): RunView {
  return {
    id: "61d7aa1b-3a8a-4f9e-9a5d-2f0d8a3cc04f",
    conversationId: "7b0b2f10-2b04-4b12-9c84-09ba5d2c0f60",
    runtimeId: "planner",
    durableSessionId: "sess-9812",
    liveSessionId: "live-4412",
    instruction: "book a table for four at Lupa this Saturday at 7pm",
    title: "Book a table for four",
    steps: [],
    status: "running",
    createdAt: "2026-10-11T10:00:00.000Z",
    updatedAt: "2026-10-11T10:00:00.000Z",
    ...overrides
  };
}

describe("titleFor", () => {
  it("takes the first meaningful words and drops filler openers", () => {
    expect(titleFor("please can you book a table for four at Lupa")).toBe("book a table for four");
    expect(titleFor("Book a table for Saturday at 7pm")).toBe("Book a table for Saturday");
    expect(titleFor("")).toBe("new task");
  });
});

describe("speak", () => {
  const ctx = { label: "My Agent" };

  it("leads with the answer when work completes", () => {
    const text = speak(view({ status: "completed", answer: "Lupa is booked for four, Saturday at 7pm." }), ctx);
    expect(text).toBe("Lupa is booked for four, Saturday at 7pm.");
  });

  it("clamps long answers to two sentences for speech", () => {
    const text = speak(view({ status: "completed", answer: "One done. Two here. Three beyond." }), ctx);
    expect(text).toBe("One done. Two here.");
  });

  it("does not read a raw error aloud when work fails", () => {
    const text = speak(view({ status: "failed", failure: "The restaurant API timed out" }), ctx);
    expect(text).toBe('My Agent couldn\'t finish "Book a table for four". To try again, say: call them again.');
  });

  it("asks for a decision on pending approval without ids", () => {
    const text = speak(view({
      status: "waiting_approval",
      approval: {
        id: "planner:ap-91f2",
        runId: "61d7aa1b-3a8a-4f9e-9a5d-2f0d8a3cc04f",
        runtimeId: "planner",
        durableSessionId: "sess-9812",
        liveSessionId: "live-4412",
        requestId: "ap-91f2",
        command: "Book Lupa for 4 on Saturday at 7pm — $40 deposit",
        description: "Book Lupa for 4 on Saturday at 7pm — $40 deposit",
        choices: ["once", "deny"],
        createdAt: "2026-10-11T10:00:00.000Z"
      }
    }), ctx);
    expect(text).toBe('My Agent is asking: Book Lupa for 4 on Saturday at 7pm — $40 deposit. Say yes to allow it once, or say no.');
    expect(text).not.toMatch(ID_LIKE);
  });

  it("tells the user what to say next while work is running", () => {
    const text = speak(view({ status: "running", progress: "Comparing three laptops" }), ctx);
    expect(text).toBe(`My Agent is working on "Book a table for four" — Comparing three laptops. Ask how it's going any time.`);
  });

  it("is honest about unknown outcomes", () => {
    const text = speak(view({ status: "unknown" }), ctx);
    expect(text).toContain("outcome is unknown");
    expect(text).toContain("won't retry");
  });

  it("confirms cancellation plainly", () => {
    expect(speak(view({ status: "cancelled" }), ctx)).toBe('My Agent stopped "Book a table for four".');
  });

  it("never speaks ids for any status", () => {
    const statuses: RunView["status"][] = ["queued", "accepted", "running", "waiting_approval", "completed", "failed", "cancel_requested", "cancelled", "unknown"];
    for (const status of statuses) {
      const text = speak(view({ status, progress: "checking" }), ctx);
      expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(text).not.toContain("61d7aa1b");
      expect(text).not.toContain("run-");
      expect(text).not.toContain("ap-91f2");
      expect(text).not.toContain("live-4412");
    }
  });

  it("speaks an unconfirmed call outcome without assuming the booking", () => {
    const text = speak(view({ status: "completed", outcome: { kind: "unconfirmed", reason: "line ended" } }), ctx);
    expect(text).toBe("I can't confirm a booking with the business: line ended. Check with them before you try again.");
    expect(text).not.toMatch(ID_LIKE);
    expect(text).not.toMatch(/\b\d+\b/);
  });

  describe("during a phone call", () => {
    const call = (overrides: Partial<RunView>) => view({ title: "Call Joe's Plumbing and book", steps: ["Calling Joe's Plumbing"], ...overrides });
    const question = "Joe's Plumbing can come Tuesday at ten for one hundred eighty dollars, over your limit of one hundred fifty dollars. Should I book it?";
    const approval = {
      id: "caller:call-1:ask-1", runId: "61d7aa1b-3a8a-4f9e-9a5d-2f0d8a3cc04f", runtimeId: "caller", durableSessionId: "s", liveSessionId: "l",
      requestId: "call-1:ask-1", command: question, description: question, choices: ["once", "deny"], amountUsd: 180, kind: "spend" as const,
      createdAt: "2026-10-11T10:00:00.000Z"
    };

    it("asks the call's question as written, without repeating the amount", () => {
      expect(approvalAsk(call({ status: "waiting_approval", approval }), { label: "Ambient" })).toBe(question);
      expect(speak(call({ status: "waiting_approval", approval }), { label: "Ambient" })).toBe(`${question} Say yes, offer a price, or say no.`);
    });

    it("asks one short question when the price is over the limit", () => {
      const overLimit = { ...approval, limitUsd: 150, when: "Tuesday at ten" };
      expect(speak(call({ status: "waiting_approval", approval: overLimit }), { label: "Ambient" })).toBe(
        "Joe's Plumbing wants one hundred eighty dollars for Tuesday at ten. Your limit is one hundred fifty dollars. Say yes to book it, offer a price like one fifty, or say no."
      );
    });

    it("asks a shorter question when the owner checks status on a call that is waiting", () => {
      const overLimit = { ...approval, limitUsd: 150, when: "Tuesday at ten" };
      expect(heldStatus(call({ status: "waiting_approval", approval: overLimit }))).toBe(
        "Joe's Plumbing is holding at one hundred eighty dollars, over your limit of one hundred fifty dollars. Say yes to book it, offer a price like one fifty, or say no."
      );
      expect(heldStatus(call({ status: "running" }))).toBeUndefined();
    });

    it("says the business turned down the owner's offer when it counters", () => {
      const counter = { ...approval, amountUsd: 160, limitUsd: 150, when: "Tuesday at ten" };
      expect(heldStatus(call({ status: "waiting_approval", approval: counter, steps: ["Calling Joe's Plumbing", "Maya: offer 150"] }))).toBe(
        "Joe's Plumbing turned down your offer and is holding at one hundred sixty dollars, over your limit of one hundred fifty dollars. Say yes to book it, offer a price like one fifty, or say no."
      );
    });

    it("tells the owner to check with the business when the call drops mid-way", () => {
      expect(speak(call({ status: "unknown" }), { label: "Ambient" })).toBe(
        "I lost the connection during the call to Joe's Plumbing, so I don't know if anything is booked. Check with them before you try again."
      );
    });

    it("echoes the amount when the owner offers one", () => {
      expect(steerReply(call({ status: "running" }), { label: "Ambient" }, "offer 160")).toBe("Okay, offering one hundred sixty dollars. To hear their answer, ask how it's going.");
    });

    it("tells the owner in their own terms that they declined", () => {
      const steps = ["Calling Joe's Plumbing", "Maya Patel: Declined: one hundred eighty dollars for Tuesday the 20th at 10 am"];
      const ended = call({ status: "completed", steps, outcome: { kind: "no_deal", reason: "Maya declined the one hundred eighty dollar quote." } });
      expect(speak(ended, { label: "Ambient" })).toBe("You said no to one hundred eighty dollars for Tuesday the 20th at 10 am, so I ended the call. Nothing is booked.");
      const laterYes = call({ status: "completed", steps: [...steps, "Maya Patel: Approved: one hundred sixty dollars"], outcome: { kind: "no_deal", reason: "They hung up." } });
      expect(speak(laterYes, { label: "Ambient" })).not.toContain("You said no");
    });

    it("never says the owner refused when the business turned the job down", () => {
      const refused = call({ status: "completed", outcome: { kind: "declined", reason: "Joe's Plumbing declined to take the job." } });
      expect(speak(refused, { label: "Ambient" })).toBe("Joe's Plumbing turned it down, so nothing is booked.");
    });

    it("keeps the cents in a price and gives no example offer when the limit is zero", () => {
      const cents = { ...approval, amountUsd: 180.5, limitUsd: 0, when: "Tuesday at ten" };
      expect(speak(call({ status: "waiting_approval", approval: cents }), { label: "Ambient" })).toBe(
        "Joe's Plumbing wants one hundred eighty dollars and fifty cents for Tuesday at ten. Your limit is zero dollars. Say yes to book it, offer a price, or say no."
      );
    });

    it("names the business from the run's subject even after early steps scroll away", () => {
      const view0 = view({ title: "Find a plumber", subject: "Pete's Pipes", status: "running", steps: ["Pete's Pipes: Hello?"] });
      expect(speak(view0, { label: "Ambient" })).toBe("I'm on the phone with Pete's Pipes. They just said: Hello? Ask how it's going, or say hang up.");
    });

    it("says who it is calling before they answer", () => {
      expect(speak(call({ status: "running" }), { label: "Ambient" })).toBe("I'm calling Joe's Plumbing now.");
    });

    it("says what the business last said once connected", () => {
      const steps = ["Calling Joe's Plumbing", "Connected to Joe's Plumbing", "Ambient: Hi, this is an AI assistant calling for Maya.", "Joe's Plumbing: We can come Tuesday at ten."];
      expect(speak(call({ status: "running", steps }), { label: "Ambient" })).toBe("I'm on the phone with Joe's Plumbing. They just said: We can come Tuesday at ten. Ask how it's going, or say hang up.");
    });

    it("says the owner ended the call and nothing was booked", () => {
      expect(speak(call({ status: "cancelled" }), { label: "Ambient" })).toBe("You ended the call before Joe's Plumbing confirmed. Nothing was booked.");
    });

    it("confirms a steer by naming who will hear it", () => {
      expect(steerReply(call({ status: "running" }), { label: "Ambient" })).toBe("Okay, I'll tell Joe's Plumbing. To hear their answer, ask how it's going.");
      expect(steerReply(view({ status: "running" }), { label: "My Agent" })).toBe('Noted — passed that to My Agent while it works on "Book a table for four".');
    });
  });

  it("leads the approval ask with the stake in words", () => {
    const text = approvalAsk(view({
      status: "waiting_approval",
      approval: {
        id: "planner:ap-91f2",
        runId: "61d7aa1b-3a8a-4f9e-9a5d-2f0d8a3cc04f",
        runtimeId: "planner",
        durableSessionId: "sess-9812",
        liveSessionId: "live-4412",
        requestId: "ap-91f2",
        command: "agree to the quote",
        description: "The plumber wants a deposit over the limit",
        choices: ["once", "deny"],
        amountUsd: 180,
        kind: "spend",
        createdAt: "2026-10-11T10:00:00.000Z"
      }
    }), ctx);
    expect(text).toContain("one hundred eighty dollars");
    expect(text).not.toMatch(ID_LIKE);
    expect(text).not.toMatch(/\b\d+\b/);
  });

  it("keeps ids out of spoken text while structured content stays complete", () => {
    const result = runResult(view({ status: "waiting_approval", approval: {
      id: "planner:ap-91f2",
      runId: "61d7aa1b-3a8a-4f9e-9a5d-2f0d8a3cc04f",
      runtimeId: "planner",
      durableSessionId: "sess-9812",
      liveSessionId: "live-4412",
      requestId: "ap-91f2",
      command: "Book Lupa",
      choices: ["once", "deny"],
      createdAt: "2026-10-11T10:00:00.000Z"
    } }), ctx);
    expect(result.content[0]!.text).not.toMatch(/ap-91f2|61d7aa1b|live-4412/);
    const structured = result.structuredContent as { approvals: { id: string }[] };
    expect(structured.approvals[0]!.id).toBe("planner:ap-91f2");
    expect(result._meta).toMatchObject({ ui: { resourceUri: "ui://ambient/task" } });
  });
});

describe("the confirmed report", () => {
  const ctx = { label: "Ambient", state: "online" as const };
  const done = (when: string) => view({ status: "completed", outcome: { kind: "confirmed", summary: `Joe's Plumbing confirmed ${when} for one hundred sixty dollars.`, amountUsd: 160, when } });

  it("says plainly when the business gave a day but no date", () => {
    expect(speak(done("Tuesday at ten"), ctx)).toBe("Joe's Plumbing confirmed Tuesday at ten for one hundred sixty dollars. They gave a day but no date, so check which one.");
  });

  it.each(["Tuesday the twentieth at ten", "October 20 at ten", "10/20 at ten", "Tuesday the 20th at ten"])("adds nothing when the business gave a date: %s", when => {
    expect(speak(done(when), ctx)).toBe(`Joe's Plumbing confirmed ${when} for one hundred sixty dollars.`);
  });
});
