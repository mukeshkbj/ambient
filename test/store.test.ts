import { afterEach, describe, expect, it } from "vitest";
import { AmbientStore } from "../src/store.js";

let store: AmbientStore | undefined;

afterEach(() => store?.close());

describe("AmbientStore", () => {
  it("keeps approval identity and exposes it on the run view", () => {
    store = new AmbientStore();
    store.createConversation({
      id: "conversation-1",
      runtimeId: "local",
      durableSessionId: "stored-1",
      title: "Personal schedule",
      liveSessionId: "runtime-1",
      createdAt: "2026-09-06T10:00:00.000Z",
      updatedAt: "2026-09-06T10:00:00.000Z"
    });
    store.createRun({
      id: "run-1",
      conversationId: "conversation-1",
      runtimeId: "local",
      durableSessionId: "stored-1",
      liveSessionId: "runtime-1",
      instruction: "Check the session",
      status: "running",
      createdAt: "2026-09-06T10:00:00.000Z",
      updatedAt: "2026-09-06T10:00:00.000Z"
    });
    store.createOrUpdateApproval({
      id: "request-1",
      runId: "run-1",
      runtimeId: "local",
      durableSessionId: "stored-1",
      liveSessionId: "runtime-1",
      requestId: "request-1",
      command: "restart demo",
      choices: ["once", "deny"],
      createdAt: "2026-09-06T10:01:00.000Z"
    });
    store.updateRun("run-1", { status: "waiting_approval", updatedAt: "2026-09-06T10:01:00.000Z" });
    store.rebindActiveRuns("local", "conversation-1", "runtime-2", "2026-09-06T10:02:00.000Z");

    expect(store.view("run-1")).toMatchObject({
      status: "waiting_approval",
      liveSessionId: "runtime-2",
      approval: { requestId: "request-1", command: "restart demo", liveSessionId: "runtime-2" }
    });
    expect(store.approvalById("request-1")).toMatchObject({ requestId: "request-1" });
    expect(store.listApprovals("local")).toHaveLength(1);
  });

  it("updates related fields in one explicit transition", () => {
    store = new AmbientStore();
    store.createConversation({
      id: "conversation-1",
      runtimeId: "local",
      durableSessionId: "stored-1",
      title: "Question",
      createdAt: "2026-09-06T10:00:00.000Z",
      updatedAt: "2026-09-06T10:00:00.000Z"
    });
    store.createRun({
      id: "run-1",
      conversationId: "conversation-1",
      runtimeId: "local",
      durableSessionId: "stored-1",
      liveSessionId: "runtime-1",
      instruction: "Question",
      status: "running",
      createdAt: "2026-09-06T10:00:00.000Z",
      updatedAt: "2026-09-06T10:00:00.000Z"
    });
    expect(store.updateRun("run-1", {
      status: "completed",
      answer: "At 7pm",
      updatedAt: "2026-09-06T10:02:00.000Z"
    })).toMatchObject({ status: "completed", answer: "At 7pm" });
  });

  it("keeps one selected conversation and does not select an unmarked history row", () => {
    store = new AmbientStore();
    store.createConversation({
      id: "conversation-1",
      runtimeId: "local",
      durableSessionId: "stored-1",
      title: "Older",
      createdAt: "2026-09-06T10:00:00.000Z",
      updatedAt: "2026-09-06T10:00:00.000Z"
    });
    expect(store.selectedConversation("local")).toBeUndefined();
    store.createConversation({
      id: "conversation-2",
      runtimeId: "local",
      durableSessionId: "stored-2",
      title: "Selected",
      selected: true,
      createdAt: "2026-09-06T10:01:00.000Z",
      updatedAt: "2026-09-06T10:01:00.000Z"
    });
    store.createConversation({
      id: "conversation-3",
      runtimeId: "local",
      durableSessionId: "stored-3",
      title: "New selected",
      selected: true,
      createdAt: "2026-09-06T10:02:00.000Z",
      updatedAt: "2026-09-06T10:02:00.000Z"
    });
    expect(store.selectedConversation("local")).toMatchObject({ id: "conversation-3" });
    expect(store.conversation("conversation-2")).toMatchObject({ selected: false });
  });
});
