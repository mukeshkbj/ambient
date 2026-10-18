import { describe, expect, it } from "vitest";
import { ConversationEngine } from "../src/conversations.js";
import { DemoClient } from "../src/runtimes/demo.js";
import { AmbientStore } from "../src/store.js";

function engineFor(client: DemoClient, store: AmbientStore): ConversationEngine {
  return new ConversationEngine(client, store, {
    runtime: { id: "planner", label: "My Agent", kind: "cloud", state: "unknown", updatedAt: "2026-10-11T00:00:00.000Z" },
    id: (() => { let n = 0; return () => `run-${++n}`; })()
  });
}

async function waitFor(predicate: () => boolean, ms = 4_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe("DemoClient", () => {
  it("runs the planner script through an approval to a booked result", async () => {
    const store = new AmbientStore();
    const client = new DemoClient({ speedMs: 1 });
    const engine = engineFor(client, store);
    const run = await engine.ask("Book a table for Saturday", undefined, true);
    await waitFor(() => engine.getWork(run.id).status === "waiting_approval");
    const approval = engine.getWork(run.id).approval!;
    expect(approval.command).toContain("Lupa");
    await engine.respondToApproval(`${run.runtimeId}:${approval.requestId}`, "once");
    await waitFor(() => engine.getWork(run.id).status === "completed");
    expect(engine.getWork(run.id).answer).toContain("booked");
    store.close();
  });

  it("denying an approval completes without booking", async () => {
    const store = new AmbientStore();
    const client = new DemoClient({ speedMs: 1 });
    const engine = engineFor(client, store);
    const run = await engine.ask("Book a table for Saturday", undefined, true);
    await waitFor(() => engine.getWork(run.id).status === "waiting_approval");
    const approval = engine.getWork(run.id).approval!;
    await engine.respondToApproval(`${run.runtimeId}:${approval.requestId}`, "deny");
    await waitFor(() => engine.getWork(run.id).status === "completed");
    expect(engine.getWork(run.id).answer).toContain("didn't book");
    store.close();
  });

  it("reports pending approvals for listPendingApprovals and survives cancel", async () => {
    const store = new AmbientStore();
    const client = new DemoClient({ speedMs: 1 });
    const engine = engineFor(client, store);
    const run = await engine.ask("Book dinner", undefined, true);
    await waitFor(() => engine.getWork(run.id).status === "waiting_approval");
    const session = engine.getWork(run.id).liveSessionId;
    expect(await client.listPendingApprovals(session)).toHaveLength(1);
    await engine.cancel(run.id);
    expect(engine.getWork(run.id).status).toBe("cancelled");
    store.close();
  });
});
