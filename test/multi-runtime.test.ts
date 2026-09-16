import { describe, expect, it } from "vitest";
import { RuntimeRegistry } from "../src/runtimes/registry.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant, fakeRuntimeEntry } from "./fake.js";

describe("multi-runtime isolation", () => {
  it("binds events and approvals to the runtime that owns the session", async () => {
    const store = new AmbientStore();
    const hermes = fakeAssistant();
    const grok = fakeAssistant();
    const registry = new RuntimeRegistry(store, [
      fakeRuntimeEntry("hermes", "Hermes", hermes.client, store, { id: (() => { let n = 0; return () => `hermes-${++n}`; })() }),
      fakeRuntimeEntry("grokbot", "Grok Bot", grok.client, store, { id: (() => { let n = 0; return () => `grok-${++n}`; })() })
    ]);

    const hermesRun = await registry.resolve("hermes").engine.ask("check my email");
    const grokRun = await registry.resolve("grok bot").engine.ask("summarize the news");

    // Approval ids are namespaced per runtime even when request ids collide.
    hermes.emit({ type: "approval.request", sessionId: "runtime-1", payload: { request_id: "a-1", command: "send it", choices: ["once", "deny"] } });
    grok.emit({ type: "approval.request", sessionId: "runtime-1", payload: { request_id: "a-1", command: "post it", choices: ["once", "deny"] } });
    await new Promise(resolve => setImmediate(resolve));
    const approvals = registry.list().flatMap(item => registry.entry(item.id)!.engine.listApprovals());
    expect(approvals.map(approval => approval.id).sort()).toEqual(["grokbot:a-1", "hermes:a-1"]);

    // An event on grok's session must not touch hermes' run.
    grok.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "News done", status: "complete" } });
    await new Promise(resolve => setImmediate(resolve));
    expect(registry.entry("hermes")!.engine.getWork(hermesRun.id)).toMatchObject({ status: "waiting_approval" });
    expect(registry.entry("grokbot")!.engine.getWork(grokRun.id)).toMatchObject({ status: "completed", answer: "News done" });

    // Routing by entity id lands on the owning engine.
    expect(registry.engineForRun(grokRun.id)).toBe(registry.entry("grokbot")!.engine);
    expect(registry.engineForApproval("hermes:a-1")).toBe(registry.entry("hermes")!.engine);
    await registry.close();
    store.close();
  });

  it("marks only the disconnected runtime's runs unknown", async () => {
    const store = new AmbientStore();
    const hermes = fakeAssistant();
    const muse = fakeAssistant();
    const registry = new RuntimeRegistry(store, [
      fakeRuntimeEntry("hermes", "Hermes", hermes.client, store),
      fakeRuntimeEntry("muse", "Muse", muse.client, store)
    ]);

    const hermesRun = await registry.resolve("hermes").engine.ask("task one");
    const museRun = await registry.resolve("muse").engine.ask("task two");
    hermes.state("offline");

    expect(registry.entry("hermes")!.engine.getWork(hermesRun.id).status).toBe("unknown");
    expect(registry.entry("muse")!.engine.getWork(museRun.id).status).toBe("running");
    await registry.close();
    store.close();
  });
});
