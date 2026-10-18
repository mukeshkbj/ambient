import { describe, expect, it, vi } from "vitest";
import { ConversationEngine } from "../src/conversations.js";
import { buildRuntimeRegistry } from "../src/runtimes/registry.js";
import type { AssistantClient } from "../src/runtimes/types.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant } from "./fake.js";

function engineFor(client: AssistantClient, store: AmbientStore, id = "rt"): ConversationEngine {
  return new ConversationEngine(client, store, {
    runtime: { id, label: id, kind: "cloud", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" }
  });
}

describe("honest-state regressions", () => {
  it("keeps a cancelled run cancelled when the in-flight submit resolves after interrupt", async () => {
    const fake = fakeAssistant({
      // submitPrompt resolves only once interrupt acknowledges — the path that
      // used to let a late submit overwrite `cancelled` with a stale status.
      submitPrompt: vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ state: "streaming" }), 30))),
      interrupt: vi.fn().mockResolvedValue({ state: "interrupted" })
    });
    const store = new AmbientStore();
    const engine = engineFor(fake.client, store, "agent");

    const askPromise = engine.ask("long task", undefined, true);
    await new Promise(resolve => setTimeout(resolve, 10));
    const run = store.listRuns("agent", 1)[0]!;
    const view = await engine.cancel(run.id);
    await askPromise;

    expect(view.status).toBe("cancelled");
    expect(engine.getWork(run.id)).toMatchObject({ status: "cancelled" });
    expect(engine.runtime().state).not.toBe("offline");
    engine.close();
    store.close();
  });

  it("marks leftover active runs unknown when a process-bound runtime starts", async () => {
    const store = new AmbientStore();
    const now = new Date().toISOString();
    store.createConversation({ id: "c1", runtimeId: "agent", durableSessionId: "d1", title: "t", selected: true, createdAt: now, updatedAt: now });
    store.createRun({ id: "r1", conversationId: "c1", runtimeId: "agent", durableSessionId: "d1", liveSessionId: "l1", instruction: "x", status: "running", createdAt: now, updatedAt: now });

    const registry = buildRuntimeRegistry({
      defaultRuntimeId: "agent",
      runtimes: [{ id: "agent", label: "Agent", kind: "local", adapter: "caller" }]
    }, {}, store);
    registry.startAll();
    expect(store.run("r1")!.status).toBe("unknown");

    await registry.close();
    store.close();
  });
});

describe("buildRuntimeRegistry adapter dispatch", () => {
  it("builds the caller adapter and rejects unknown adapters, lines, and brains", async () => {
    const store = new AmbientStore();
    const registry = buildRuntimeRegistry({
      defaultRuntimeId: "caller",
      runtimes: [{ id: "caller", label: "Ambient", kind: "cloud", adapter: "caller", options: { line: "simulated", brain: "scripted" } }]
    }, {}, store);
    expect(registry.list().map(item => item.id)).toEqual(["caller"]);
    expect(registry.entry("caller")!.client.capabilities).toMatchObject({ approvals: true, steer: true, cancel: true });
    await registry.close();

    expect(() => buildRuntimeRegistry({
      defaultRuntimeId: "x",
      runtimes: [{ id: "x", label: "X", kind: "local", adapter: "caller", options: { line: "assemblyai" } }]
    }, {}, store)).toThrow("needs ASSEMBLYAI_API_KEY");

    for (const options of [{ line: "carrier-pigeon" }, { brain: "ouija" }]) {
      expect(() => buildRuntimeRegistry({
        defaultRuntimeId: "x",
        runtimes: [{ id: "x", label: "X", kind: "local", adapter: "caller", options }]
      }, {}, store)).toThrow("not available");
    }

    expect(() => buildRuntimeRegistry({
      defaultRuntimeId: "x",
      runtimes: [{ id: "x", label: "X", kind: "local", adapter: "nope" }]
    }, {}, store)).toThrow("not available");
    store.close();
  });
});
