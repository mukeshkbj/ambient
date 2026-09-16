import { describe, expect, it, vi } from "vitest";
import { ConversationEngine, type HermesConversationClient } from "../src/conversations.js";
import type { HermesEvent } from "../src/hermes.js";
import { AmbientStore } from "../src/store.js";

function fakeHermes() {
  let eventHandler: ((event: HermesEvent) => void) | undefined;
  let stateHandler: ((state: "online" | "offline" | "unknown") => void) | undefined;
  let replayGapHandler: ((gap: { sessionId: string; lastSeen: number; latestSeq: number }) => void) | undefined;
  const client: HermesConversationClient = {
    createSession: vi.fn().mockResolvedValue({ runtimeSessionId: "runtime-1", durableSessionId: "stored-1" }),
    submitPrompt: vi.fn().mockResolvedValue({ status: "streaming" }),
    steer: vi.fn().mockResolvedValue({ status: "queued" }),
    interrupt: vi.fn().mockResolvedValue({ status: "interrupted" }),
    respondToApproval: vi.fn().mockResolvedValue({ resolved: 1 }),
    resumeSession: vi.fn().mockResolvedValue({ runtimeSessionId: "runtime-1", durableSessionId: "stored-1" }),
    listSavedSessions: vi.fn().mockResolvedValue([]),
    listActiveSessions: vi.fn().mockResolvedValue([]),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    onEvent: vi.fn(handler => {
      eventHandler = handler;
      return () => undefined;
    }),
    onConnectionState: vi.fn(handler => {
      stateHandler = handler;
      return () => undefined;
    }),
    onReplayGap: vi.fn(handler => {
      replayGapHandler = handler;
      return () => undefined;
    })
  };
  return {
    client,
    emit: (event: HermesEvent) => eventHandler?.(event),
    state: (value: "online" | "offline" | "unknown") => stateHandler?.(value),
    gap: (value: { sessionId: string; lastSeen: number; latestSeq: number }) => replayGapHandler?.(value)
  };
}

describe("ConversationEngine", () => {
  it("creates one conversation and returns before completion", async () => {
    const hermes = fakeHermes();
    const store = new AmbientStore();
    const engine = new ConversationEngine(hermes.client, store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });

    const run = await engine.ask("What is on my schedule?", undefined, true);
    expect(run).toMatchObject({ status: "running", instruction: "What is on my schedule?" });
    expect(hermes.client.createSession).toHaveBeenCalledTimes(1);
    expect(hermes.client.submitPrompt).toHaveBeenCalledWith("runtime-1", "What is on my schedule?");
    await expect(engine.ask("Another question")).rejects.toThrow("already has active Hermes work");
    store.close();
  });

  it("projects the real event envelope and responds to the exact approval request", async () => {
    const hermes = fakeHermes();
    const store = new AmbientStore();
    const engine = new ConversationEngine(hermes.client, store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      now: () => "2026-09-06T10:00:00.000Z",
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Restart the demo", undefined, true);
    hermes.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { request_id: "approval-7", command: "restart demo", description: "Restart it", choices: ["once", "deny"] }
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(engine.getWork(run.id)).toMatchObject({ status: "waiting_approval", approval: { requestId: "approval-7" } });
    await engine.respondToApproval("local:approval-7", "once");
    expect(hermes.client.respondToApproval).toHaveBeenCalledWith("runtime-1", "approval-7", "once");
    await expect(engine.respondToApproval("local:approval-7", "once")).rejects.toThrow("no longer pending");
    store.close();
  });

  it("does not let a late completion get overwritten by prompt acknowledgement", async () => {
    const hermes = fakeHermes();
    let resolveSubmit: ((value: Record<string, unknown>) => void) | undefined;
    hermes.client.submitPrompt = vi.fn().mockImplementation(() => new Promise(resolve => { resolveSubmit = resolve; }));
    const store = new AmbientStore();
    const engine = new ConversationEngine(hermes.client, store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
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
    const hermes = fakeHermes();
    hermes.client.listSavedSessions = vi.fn().mockResolvedValue([{ id: "stored-1", title: "Existing conversation" }]);
    const store = new AmbientStore();
    const engine = new ConversationEngine(hermes.client, store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const conversations = await engine.discover();
    await engine.selectConversation(conversations[0]!.id);
    await engine.ask("Follow up", undefined, false);
    expect(hermes.client.resumeSession).toHaveBeenCalledWith("stored-1");
    expect(hermes.client.submitPrompt).toHaveBeenCalledWith("runtime-1", "Follow up");
    store.close();
  });

  it("marks in-flight work unknown when the Hermes connection closes", async () => {
    const hermes = fakeHermes();
    const store = new AmbientStore();
    const engine = new ConversationEngine(hermes.client, store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Long task", undefined, true);
    hermes.state("offline");
    expect(engine.getWork(run.id)).toMatchObject({ status: "unknown", progress: "Hermes disconnected; the work outcome is unknown" });
    await expect(engine.steer(run.id, "continue")).rejects.toThrow("outcome is unknown");
    hermes.state("online");
    hermes.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Recovered", status: "complete" } });
    await new Promise(resolve => setImmediate(resolve));
    expect(engine.getWork(run.id)).toMatchObject({ status: "completed", answer: "Recovered" });
    store.close();
  });

  it("keeps the runtime unknown until discovery confirms the live sessions", async () => {
    const hermes = fakeHermes();
    const store = new AmbientStore();
    const engine = new ConversationEngine(hermes.client, store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    hermes.state("online");
    expect(engine.runtime().state).toBe("unknown");
    await engine.discover();
    expect(engine.runtime().state).toBe("online");
    store.close();
  });

  it("reconciles an approval that was pending while the bridge was offline", async () => {
    const hermes = fakeHermes();
    const store = new AmbientStore();
    const engine = new ConversationEngine(hermes.client, store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Run the guarded task", undefined, true);
    hermes.state("offline");
    hermes.client.listSavedSessions = vi.fn().mockResolvedValue([{ id: "stored-1", title: "Guarded task" }]);
    hermes.client.listActiveSessions = vi.fn().mockResolvedValue([{
      id: "runtime-1", session_key: "stored-1", status: "working"
    }]);
    hermes.client.listPendingApprovals = vi.fn().mockResolvedValue([{
      request_id: "approval-recovered", command: "run guarded task", description: "Confirm the guarded task", choices: ["once", "deny"]
    }]);
    await engine.discover();
    expect(engine.getWork(run.id)).toMatchObject({
      status: "waiting_approval",
      approval: { requestId: "approval-recovered", command: "run guarded task" }
    });
    expect(hermes.client.listPendingApprovals).toHaveBeenCalledWith("runtime-1");
    store.close();
  });

  it("clears approvals absent from Hermes authoritative pending state", async () => {
    const hermes = fakeHermes();
    const store = new AmbientStore();
    const engine = new ConversationEngine(hermes.client, store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Run the guarded task", undefined, true);
    hermes.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { request_id: "approval-stale", command: "run guarded task", choices: ["once", "deny"] }
    });
    await new Promise(resolve => setImmediate(resolve));
    hermes.state("offline");
    hermes.client.listSavedSessions = vi.fn().mockResolvedValue([{ id: "stored-1", title: "Guarded task" }]);
    hermes.client.listActiveSessions = vi.fn().mockResolvedValue([{ id: "runtime-1", session_key: "stored-1", status: "working" }]);
    hermes.client.listPendingApprovals = vi.fn().mockResolvedValue([]);
    await engine.discover();
    expect(engine.listApprovals()).toEqual([]);
    expect(engine.getWork(run.id)).toMatchObject({
      status: "unknown",
      progress: "Hermes resolved an approval outside Ambient; the work outcome is unknown"
    });
    store.close();
  });

  it("keeps work unknown after a replay gap until a completion arrives", async () => {
    const hermes = fakeHermes();
    const store = new AmbientStore();
    const engine = new ConversationEngine(hermes.client, store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
      id: (() => { let n = 0; return () => `id-${++n}`; })()
    });
    const run = await engine.ask("Long task", undefined, true);
    hermes.gap({ sessionId: "runtime-1", lastSeen: 4, latestSeq: 600 });
    expect(engine.getWork(run.id)).toMatchObject({ status: "unknown" });
    hermes.client.listSavedSessions = vi.fn().mockResolvedValue([{ id: "stored-1", title: "Long task" }]);
    hermes.client.listActiveSessions = vi.fn().mockResolvedValue([{
      id: "runtime-1", session_key: "stored-1", status: "working"
    }]);
    await engine.discover();
    expect(engine.getWork(run.id)).toMatchObject({ status: "unknown" });
    hermes.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Recovered", status: "complete" } });
    await new Promise(resolve => setImmediate(resolve));
    expect(engine.getWork(run.id)).toMatchObject({ status: "completed", answer: "Recovered" });
    store.close();
  });
});
