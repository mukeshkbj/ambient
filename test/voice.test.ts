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

  it("says why work failed without internal detail", () => {
    const text = speak(view({ status: "failed", failure: "The restaurant API timed out" }), ctx);
    expect(text).toBe('My Agent couldn\'t finish "Book a table for four": The restaurant API timed out.');
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
    expect(text).toBe('My Agent is asking: Book Lupa for 4 on Saturday at 7pm — $40 deposit. Say approve to allow it once, or deny.');
    expect(text).not.toMatch(ID_LIKE);
  });

  it("tells the user what to say next while work is running", () => {
    const text = speak(view({ status: "running", progress: "Comparing three laptops" }), ctx);
    expect(text).toBe('My Agent is working on "Book a table for four" — Comparing three laptops. Say "what\'s the status" any time.');
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
    expect(text).toBe("The call ended before they confirmed, so I won't assume it's booked.");
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
      expect(speak(call({ status: "waiting_approval", approval }), { label: "Ambient" })).toBe(`${question} Say approve, deny, or offer a different amount.`);
    });

    it("asks one short question when the price is over the limit", () => {
      const overLimit = { ...approval, limitUsd: 150, when: "Tuesday at ten" };
      expect(speak(call({ status: "waiting_approval", approval: overLimit }), { label: "Ambient" })).toBe(
        "Joe's Plumbing wants one hundred eighty dollars for Tuesday at ten. Your limit is one hundred fifty dollars. Say approve to book it, offer a price like one fifty, or hang up."
      );
    });

    it("asks a shorter question when the owner checks status on a call that is waiting", () => {
      const overLimit = { ...approval, limitUsd: 150, when: "Tuesday at ten" };
      expect(heldStatus(call({ status: "waiting_approval", approval: overLimit }))).toBe(
        "Joe's Plumbing is holding at one hundred eighty dollars, over your limit of one hundred fifty dollars. Say approve to book it, offer a price like one fifty, or hang up."
      );
      expect(heldStatus(call({ status: "running" }))).toBeUndefined();
    });

    it("echoes the amount when the owner offers one", () => {
      expect(steerReply(call({ status: "running" }), { label: "Ambient" }, "offer 160")).toBe("Okay, offering one hundred sixty dollars. Say status to hear their answer.");
    });

    it("tells the owner in their own terms that they declined", () => {
      const ended = call({ status: "completed", outcome: { kind: "no_deal", reason: "Maya declined one hundred eighty dollars" } });
      expect(speak(ended, { label: "Ambient" })).toBe("You said no to one hundred eighty dollars, so I ended the call. Nothing is booked.");
    });

    it("names the business from the run's subject even after early steps scroll away", () => {
      const view0 = view({ title: "Find a plumber", subject: "Pete's Pipes", status: "running", steps: ["Pete's Pipes: Hello?"] });
      expect(speak(view0, { label: "Ambient" })).toBe("Ambient is on the phone with Pete's Pipes. They just said: Hello?");
    });

    it("says who it is calling before they answer", () => {
      expect(speak(call({ status: "running" }), { label: "Ambient" })).toBe("Ambient is calling Joe's Plumbing now.");
    });

    it("says what the business last said once connected", () => {
      const steps = ["Calling Joe's Plumbing", "Connected to Joe's Plumbing", "Ambient: Hi, this is an AI assistant calling for Maya.", "Joe's Plumbing: We can come Tuesday at ten."];
      expect(speak(call({ status: "running", steps }), { label: "Ambient" })).toBe("Ambient is on the phone with Joe's Plumbing. They just said: We can come Tuesday at ten.");
    });

    it("says the owner ended the call and nothing was booked", () => {
      expect(speak(call({ status: "cancelled" }), { label: "Ambient" })).toBe("You ended the call before Joe's Plumbing confirmed. Nothing was booked.");
    });

    it("confirms a steer by naming who will hear it", () => {
      expect(steerReply(call({ status: "running" }), { label: "Ambient" })).toBe("Okay, I'll tell Joe's Plumbing. Say status to hear their answer.");
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
