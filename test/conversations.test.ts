import { describe, expect, it, vi } from "vitest";
import { ConversationEngine } from "../src/conversations.js";
import { fakeAssistant } from "./fake.js";
import { AmbientStore } from "../src/store.js";

const fakeAgent = fakeAssistant;

describe("ConversationEngine", () => {
  it("creates one conversation and returns before completion", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });

    const run = await engine.ask("What is on my schedule?", undefined, true);
    expect(run).toMatchObject({ status: "running", instruction: "What is on my schedule?" });
    expect(agent.client.createSession).toHaveBeenCalledTimes(1);
    expect(agent.client.submitPrompt).toHaveBeenCalledWith("runtime-1", "What is on my schedule?");
    await expect(engine.ask("Another question")).rejects.toThrow("already has active My Agent work");
    store.close();
  });

  it("projects the real event envelope and responds to the exact approval request", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Restart the demo", undefined, true);
    agent.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { requestId: "approval-7", command: "restart demo", description: "Restart it", choices: ["once", "deny"] }
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(engine.getWork(run.id)).toMatchObject({ status: "waiting_approval", approval: { requestId: "approval-7" } });
    await engine.respondToApproval("local:approval-7", "once");
    expect(agent.client.respondToApproval).toHaveBeenCalledWith("runtime-1", "approval-7", "once");
    await expect(engine.respondToApproval("local:approval-7", "once")).rejects.toThrow("no longer pending");
    store.close();
  });

  it("does not let a late completion get overwritten by prompt acknowledgement", async () => {
    const agent = fakeAgent();
    let resolveSubmit: ((value: Record<string, unknown>) => void) | undefined;
    agent.client.submitPrompt = vi.fn().mockImplementation(() => new Promise(resolve => { resolveSubmit = resolve; }));
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const pending = engine.ask("Question", undefined, true);
    await new Promise(resolve => setImmediate(resolve));
    const runId = [...store.listRuns("local")][0]!.id;
    await engine.applyEvent({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Done", status: "complete" } });
    resolveSubmit!({ status: "streaming" });
    await pending;
    expect(engine.getWork(runId)).toMatchObject({ status: "completed", answer: "Done" });
    store.close();
  });

  it("resumes durable history before sending a follow-up after discovery", async () => {
    const agent = fakeAgent();
    agent.client.listSavedSessions = vi.fn().mockResolvedValue([{ id: "stored-1", title: "Existing conversation" }]);
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const conversations = await engine.discover();
    await engine.selectConversation(conversations[0]!.id);
    await engine.ask("Follow up", undefined, false);
    expect(agent.client.resumeSession).toHaveBeenCalledWith("stored-1");
    expect(agent.client.submitPrompt).toHaveBeenCalledWith("runtime-1", "Follow up");
    store.close();
  });

  it("marks in-flight work unknown when the runtime connection closes", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Long task", undefined, true);
    agent.state("offline");
    expect(engine.getWork(run.id)).toMatchObject({ status: "unknown", progress: "My Agent disconnected; the work outcome is unknown" });
    await expect(engine.steer(run.id, "continue")).rejects.toThrow("outcome is unknown");
    agent.state("online");
    agent.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Recovered", status: "complete" } });
    await new Promise(resolve => setImmediate(resolve));
    expect(engine.getWork(run.id)).toMatchObject({ status: "completed", answer: "Recovered" });
    store.close();
  });

  it("maps a cancelled message.complete to cancelled, not completed", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Task", undefined, true);
    agent.emit({ type: "message.complete", sessionId: "runtime-1", payload: { status: "cancelled" } });
    await new Promise(resolve => setImmediate(resolve));
    expect(engine.getWork(run.id).status).toBe("cancelled");
    store.close();
  });

  it("trusts the adapter's connection state and marks runs unknown on disconnect", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    agent.state("online");
    expect(engine.runtime().state).toBe("online");
    agent.state("offline");
    expect(engine.runtime().state).toBe("offline");
    store.close();
  });

  it("reconciles an approval that was pending while the bridge was offline", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Run the guarded task", undefined, true);
    agent.state("offline");
    agent.client.listSavedSessions = vi.fn().mockResolvedValue([{ id: "stored-1", title: "Guarded task" }]);
    agent.client.listActiveSessions = vi.fn().mockResolvedValue([{
      id: "runtime-1", session_key: "stored-1", status: "working"
    }]);
    agent.client.listPendingApprovals = vi.fn().mockResolvedValue([{
      requestId: "approval-recovered", command: "run guarded task", description: "Confirm the guarded task", choices: ["once", "deny"]
    }]);
    await engine.discover();
    expect(engine.getWork(run.id)).toMatchObject({
      status: "waiting_approval",
      approval: { requestId: "approval-recovered", command: "run guarded task" }
    });
    expect(agent.client.listPendingApprovals).toHaveBeenCalledWith("runtime-1");
    store.close();
  });

  it("clears approvals absent from the adapter's authoritative pending state", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Run the guarded task", undefined, true);
    agent.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { requestId: "approval-stale", command: "run guarded task", choices: ["once", "deny"] }
    });
    await new Promise(resolve => setImmediate(resolve));
    agent.state("offline");
    agent.client.listSavedSessions = vi.fn().mockResolvedValue([{ id: "stored-1", title: "Guarded task" }]);
    agent.client.listActiveSessions = vi.fn().mockResolvedValue([{ id: "runtime-1", session_key: "stored-1", status: "working" }]);
    agent.client.listPendingApprovals = vi.fn().mockResolvedValue([]);
    await engine.discover();
    expect(engine.listApprovals()).toEqual([]);
    expect(engine.getWork(run.id)).toMatchObject({
      status: "unknown",
      progress: "My Agent resolved an approval outside Ambient; the work outcome is unknown"
    });
    store.close();
  });

  it("returns a fast answer inline when ask waits", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const pending = engine.ask("Quick question", undefined, true, { waitMs: 2_000 });
    await new Promise(resolve => setTimeout(resolve, 10));
    agent.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Four lights.", status: "complete" } });
    const run = await pending;
    expect(run).toMatchObject({ status: "completed", answer: "Four lights." });
    store.close();
  });

  it("returns a still-running view when the bounded wait expires", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const started = Date.now();
    const run = await engine.ask("Slow task", undefined, true, { waitMs: 50 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(run.status).toBe("running");
    store.close();
  });

  it("surfaces waiting_approval inline inside the bounded wait", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const pending = engine.ask("Guarded task", undefined, true, { waitMs: 2_000 });
    await new Promise(resolve => setTimeout(resolve, 10));
    agent.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { requestId: "ap-7", command: "restart demo", choices: ["once", "deny"] }
    });
    const run = await pending;
    expect(run.status).toBe("waiting_approval");
    expect(run.approval?.requestId).toBe("ap-7");
    store.close();
  });

  it("keeps work unknown after a replay gap until a completion arrives", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Long task", undefined, true);
    agent.gap({ sessionId: "runtime-1", lastSeen: 4, latestSeq: 600 });
    expect(engine.getWork(run.id)).toMatchObject({ status: "unknown" });
    agent.client.listSavedSessions = vi.fn().mockResolvedValue([{ id: "stored-1", title: "Long task" }]);
    agent.client.listActiveSessions = vi.fn().mockResolvedValue([{
      id: "runtime-1", session_key: "stored-1", status: "working"
    }]);
    await engine.discover();
    expect(engine.getWork(run.id)).toMatchObject({ status: "unknown" });
    agent.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Recovered", status: "complete" } });
    await new Promise(resolve => setImmediate(resolve));
    expect(engine.getWork(run.id)).toMatchObject({ status: "completed", answer: "Recovered" });
    store.close();
  });

  it("keeps the subject a runtime names in a status update", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Call the plumber", undefined, true);
    agent.emit({ type: "status.update", sessionId: "runtime-1", payload: { text: "Calling Pete's Pipes", subject: "Pete's Pipes" } });
    await new Promise(resolve => setImmediate(resolve));
    expect(engine.getWork(run.id).subject).toBe("Pete's Pipes");
    store.close();
  });

  it("stores an approval's amount and kind on the run view", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Call the plumber", undefined, true);
    agent.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: {
        requestId: "req-9",
        command: "agree to the quote",
        description: "The plumber wants more than the limit",
        choices: ["once", "deny"],
        amountUsd: 180,
        limitUsd: 150,
        when: "Tuesday at ten",
        kind: "spend"
      }
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(engine.getWork(run.id)).toMatchObject({
      status: "waiting_approval",
      approval: { requestId: "req-9", amountUsd: 180, limitUsd: 150, when: "Tuesday at ten", kind: "spend" }
    });
    store.close();
  });

  it("keeps a second open approval on the run when the first response settles late", async () => {
    const agent = fakeAgent();
    let ack: ((value: { resolved: number }) => void) | undefined;
    agent.client.respondToApproval = vi.fn().mockImplementation(
      () => new Promise<{ resolved: number }>(resolve => { ack = resolve; })
    );
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Call the plumber", undefined, true);
    agent.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { requestId: "req-a", command: "agree to the first quote", choices: ["once", "deny"] }
    });
    await new Promise(resolve => setImmediate(resolve));
    const pending = engine.respondToApproval("local:req-a", "once");
    agent.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { requestId: "req-b", command: "agree to the second quote", choices: ["once", "deny"] }
    });
    await new Promise(resolve => setImmediate(resolve));
    ack!({ resolved: 1 });
    await pending;
    const view = engine.getWork(run.id);
    expect(view.status).toBe("waiting_approval");
    expect(view.approval?.requestId).toBe("req-b");
    store.close();
  });

  it("stores the call outcome on a completed run", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Call the plumber", undefined, true);
    agent.emit({
      type: "message.complete",
      sessionId: "runtime-1",
      payload: { text: "The line went quiet", status: "complete", outcome: { kind: "unconfirmed", reason: "line ended" } }
    });
    await new Promise(resolve => setImmediate(resolve));
    const view = engine.getWork(run.id);
    expect(view.status).toBe("completed");
    expect(view.outcome?.kind).toBe("unconfirmed");
    store.close();
  });

  it("keeps a cancel_requested run cancel_requested when an approval arrives", async () => {
    const agent = fakeAgent();
    agent.client.interrupt = vi.fn().mockResolvedValue({ state: "acknowledged" });
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Call the plumber", undefined, true);
    await engine.cancel(run.id);
    expect(engine.getWork(run.id).status).toBe("cancel_requested");
    agent.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { requestId: "req-late", command: "one more thing", choices: ["once", "deny"] }
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(engine.getWork(run.id).status).toBe("cancel_requested");
    store.close();
  });

  it("steering a waiting run resolves its approval and returns it to running", async () => {
    const agent = fakeAgent();
    const store = new AmbientStore();
    const engine = new ConversationEngine(agent.client, store, {
      runtime: { id: "local", label: "My Agent", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Call the plumber", undefined, true);
    agent.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { requestId: "req-5", command: "agree to the quote", choices: ["once", "deny"] }
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(engine.getWork(run.id).status).toBe("waiting_approval");
    const view = await engine.steer(run.id, "Offer one sixty");
    expect(agent.client.steer).toHaveBeenCalledWith("runtime-1", "Offer one sixty");
    expect(view.status).toBe("running");
    expect(view.approval).toBeUndefined();
    expect(store.approvalById("local:req-5")?.resolvedAt).toBeDefined();
    store.close();
  });
});
