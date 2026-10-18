import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

  it("migrates an old-schema database and reads back its approval unchanged", () => {
    const dir = mkdtempSync(join(tmpdir(), "ambient-store-"));
    const path = join(dir, "ambient.db");
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        durable_session_id TEXT NOT NULL,
        live_session_id TEXT NOT NULL,
        instruction TEXT NOT NULL,
        status TEXT NOT NULL,
        answer TEXT,
        progress TEXT,
        failure TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        durable_session_id TEXT NOT NULL,
        live_session_id TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        command TEXT NOT NULL,
        description TEXT,
        choices_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
    `);
    old.prepare(`
      INSERT INTO runs (id, conversation_id, runtime_id, durable_session_id, live_session_id,
        instruction, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("run-1", "conversation-1", "local", "stored-1", "runtime-1", "Check the session",
      "waiting_approval", "2026-09-06T10:00:00.000Z", "2026-09-06T10:01:00.000Z");
    old.prepare(`
      INSERT INTO approvals (id, run_id, runtime_id, durable_session_id, live_session_id,
        request_id, command, description, choices_json, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("approval-old", "run-1", "local", "stored-1", "runtime-1", "req-old", "restart demo",
      "the old question", JSON.stringify(["once", "deny"]), "2026-09-06T10:01:00.000Z", null);
    old.close();

    store = new AmbientStore(path);
    expect(store.approvalById("approval-old")).toMatchObject({
      runId: "run-1",
      requestId: "req-old",
      command: "restart demo",
      description: "the old question",
      choices: ["once", "deny"],
      createdAt: "2026-09-06T10:01:00.000Z"
    });
    expect(store.view("run-1")?.approval?.requestId).toBe("req-old");

    store.createOrUpdateApproval({
      id: "approval-new",
      runId: "run-1",
      runtimeId: "local",
      durableSessionId: "stored-1",
      liveSessionId: "runtime-1",
      requestId: "req-new",
      command: "agree to the quote",
      choices: ["once", "deny"],
      amountUsd: 180,
      kind: "spend",
      createdAt: "2026-09-06T10:02:00.000Z"
    });
    expect(store.approvalById("approval-new")).toMatchObject({ amountUsd: 180, kind: "spend" });
    expect(store.view("run-1")?.approval?.requestId).toBe("req-new");
    store.close();
    store = undefined;
    rmSync(dir, { recursive: true, force: true });
  });
});
