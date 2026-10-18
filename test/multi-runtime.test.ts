import { describe, expect, it } from "vitest";
import { RuntimeRegistry } from "../src/runtimes/registry.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant, fakeRuntimeEntry } from "./fake.js";

describe("multi-runtime isolation", () => {
  it("binds events and approvals to the runtime that owns the session", async () => {
    const store = new AmbientStore();
    const agent = fakeAssistant();
    const beta = fakeAssistant();
    const registry = new RuntimeRegistry(store, [
      fakeRuntimeEntry("agent", "Agent", agent.client, store, { id: (() => { let n = 0; return () => `agent-${++n}`; })() }),
      fakeRuntimeEntry("beta", "Beta Agent", beta.client, store, { id: (() => { let n = 0; return () => `beta-${++n}`; })() })
    ]);

    const agentRun = await registry.resolve("agent").engine.ask("check my email");
    const betaRun = await registry.resolve("beta agent").engine.ask("summarize the news");

    // Approval ids are namespaced per runtime even when request ids collide.
    agent.emit({ type: "approval.request", sessionId: "runtime-1", payload: { requestId: "a-1", command: "send it", choices: ["once", "deny"] } });
    beta.emit({ type: "approval.request", sessionId: "runtime-1", payload: { requestId: "a-1", command: "post it", choices: ["once", "deny"] } });
    await new Promise(resolve => setImmediate(resolve));
    const approvals = registry.list().flatMap(item => registry.entry(item.id)!.engine.listApprovals());
    expect(approvals.map(approval => approval.id).sort()).toEqual(["agent:a-1", "beta:a-1"]);

    // An event on beta's session must not touch agent's run.
    beta.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "News done", status: "complete" } });
    await new Promise(resolve => setImmediate(resolve));
    expect(registry.entry("agent")!.engine.getWork(agentRun.id)).toMatchObject({ status: "waiting_approval" });
    expect(registry.entry("beta")!.engine.getWork(betaRun.id)).toMatchObject({ status: "completed", answer: "News done" });

    // Routing by entity id lands on the owning engine.
    expect(registry.engineForRun(betaRun.id)).toBe(registry.entry("beta")!.engine);
    expect(registry.engineForApproval("agent:a-1")).toBe(registry.entry("agent")!.engine);
    await registry.close();
    store.close();
  });

  it("marks only the disconnected runtime's runs unknown", async () => {
    const store = new AmbientStore();
    const agent = fakeAssistant();
    const gamma = fakeAssistant();
    const registry = new RuntimeRegistry(store, [
      fakeRuntimeEntry("agent", "Agent", agent.client, store),
      fakeRuntimeEntry("gamma", "Gamma Agent", gamma.client, store)
    ]);

    const agentRun = await registry.resolve("agent").engine.ask("task one");
    const gammaRun = await registry.resolve("gamma").engine.ask("task two");
    agent.state("offline");

    expect(registry.entry("agent")!.engine.getWork(agentRun.id).status).toBe("unknown");
    expect(registry.entry("gamma")!.engine.getWork(gammaRun.id).status).toBe("running");
    await registry.close();
    store.close();
  });
});
