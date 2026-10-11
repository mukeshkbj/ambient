import { describe, expect, it } from "vitest";
import { runResult, speak, titleFor } from "../src/voice.js";
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
