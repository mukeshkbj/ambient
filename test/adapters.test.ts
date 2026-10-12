import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ConversationEngine } from "../src/conversations.js";
import { readConfig } from "../src/config.js";
import { OpenClawClient, OpenClawConnection, type SocketLike } from "../src/runtimes/openclaw.js";
import { buildRuntimeRegistry } from "../src/runtimes/registry.js";
import type { AssistantClient } from "../src/runtimes/types.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant } from "./fake.js";

function engineFor(client: AssistantClient, store: AmbientStore, id = "rt"): ConversationEngine {
  return new ConversationEngine(client, store, {
    runtime: { id, label: id, kind: "cloud", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" }
  });
}

class FakeSocket extends EventEmitter implements SocketLike {
  readyState = 0;
  readonly sent: Frame[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Frame);
  }
  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
  open(): void {
    this.readyState = 1;
    this.emit("open");
  }
  deliver(frame: Frame): void {
    this.emit("message", Buffer.from(JSON.stringify(frame)));
  }
  last(method: string): Frame {
    const frame = [...this.sent].reverse().find(item => item.method === method);
    if (!frame) throw new Error(`no ${method} frame sent`);
    return frame;
  }
  respond(method: string, payload: unknown): void {
    this.deliver({ type: "res", id: this.last(method).id!, ok: true, payload });
  }
}

type Frame = {
  type?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  ok?: boolean;
  payload?: unknown;
  event?: string;
};

describe("OpenClawClient (gateway WS protocol v4)", () => {
  it("handshakes as operator and drives a run through agent + agent.wait", async () => {
    const socket = new FakeSocket();
    const connection = new OpenClawConnection({ url: "ws://127.0.0.1:18789", token: "oc", socketFactory: () => socket });
    const client = new OpenClawClient(connection);
    const store = new AmbientStore();
    const engine = engineFor(client, store, "openclaw");

    const connectPromise = connection.connect();
    socket.open();
    await new Promise(resolve => setImmediate(resolve));

    const connect = socket.last("connect");
    expect(connect.params).toMatchObject({ role: "operator", minProtocol: 4, maxProtocol: 4 });
    socket.deliver({ type: "res", id: connect.id!, ok: true, payload: { type: "hello-ok", protocol: 4, server: { version: "t", connId: "c1" }, features: { methods: [], events: [] }, snapshot: {}, auth: { role: "operator", scopes: [] }, policy: {} } });
    await connectPromise;
    expect(connection.isConnected).toBe(true);

    const tick = () => new Promise(resolve => setTimeout(resolve, 10));
    const runPromise = engine.ask("check status", undefined, true);
    await tick();
    socket.respond("sessions.create", { key: "agent:main:ambient-1" });
    await tick();
    const agent = socket.last("agent");
    expect(agent.params).toMatchObject({ sessionKey: "agent:main:ambient-1", message: "check status" });
    socket.deliver({ type: "res", id: agent.id!, ok: true, payload: { runId: "run-9" } });
    const run = await runPromise;
    await tick();
    const wait = socket.last("agent.wait");
    expect(wait.params).toEqual({ runId: "run-9" });
    socket.deliver({ type: "res", id: wait.id!, ok: true, payload: { status: "ok", output: "all green" } });
    await tick();
    expect(engine.getWork(run.id)).toMatchObject({ status: "completed", answer: "all green" });

    // An exec approval broadcast becomes an approval.request on the session.
    const emitted: string[] = [];
    client.onEvent(event => emitted.push(event.type));
    socket.deliver({ type: "event", event: "exec.approval.requested", payload: { id: "ap-1", command: "rm -rf /tmp/x", sessionKey: "agent:main:ambient-1" } });
    expect(emitted).toContain("approval.request");

    await connection.close();
    engine.close();
    store.close();
  });
});

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

  it("marks an OpenClaw run unknown, not failed, when the gateway drops mid-run", async () => {
    const socket = new FakeSocket();
    const connection = new OpenClawConnection({ url: "ws://127.0.0.1:18789", socketFactory: () => socket });
    const client = new OpenClawClient(connection);
    const store = new AmbientStore();
    const engine = engineFor(client, store, "openclaw");
    const tick = () => new Promise(resolve => setTimeout(resolve, 10));

    const connectPromise = connection.connect();
    socket.open();
    await tick();
    socket.deliver({ type: "res", id: socket.last("connect").id!, ok: true, payload: { type: "hello-ok" } });
    await connectPromise;

    const runPromise = engine.ask("work", undefined, true);
    await tick();
    socket.respond("sessions.create", { key: "s1" });
    await tick();
    const agent = socket.last("agent");
    socket.deliver({ type: "res", id: agent.id!, ok: true, payload: { runId: "r1" } });
    const run = await runPromise;

    socket.close();
    await tick();
    expect(engine.getWork(run.id).status).toBe("unknown");

    await connection.close();
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
      runtimes: [{ id: "agent", label: "Agent", kind: "local", adapter: "demo" }]
    }, {}, store);
    registry.startAll();
    expect(store.run("r1")!.status).toBe("unknown");

    await registry.close();
    store.close();
  });
});

describe("buildRuntimeRegistry adapter dispatch", () => {
  it("builds every supported adapter and rejects unknown ones", async () => {
    const config = readConfig({
      AMBIENT_RUNTIMES_FILE: "/nonexistent/runtimes.json",
      CONNECTOR_TOKEN: "a".repeat(16),
      AMBIENT_ACCESS_TOKEN: "b".repeat(16)
    });
    expect(config.runtimes).toHaveLength(1);

    const store = new AmbientStore();
    const env = { CONNECTOR_TOKEN: "a".repeat(16) };
    const registry = buildRuntimeRegistry({
      defaultRuntimeId: "hermes",
      runtimes: [
        { id: "hermes", label: "Hermes", kind: "local", adapter: "hermes", connectorTokenEnv: "CONNECTOR_TOKEN" },
        { id: "oc", label: "OpenClaw", kind: "local", adapter: "openclaw", endpoint: "ws://127.0.0.1:18789", tokenEnv: "OC_TOKEN" },
        { id: "nova", label: "Nova", kind: "cloud", adapter: "bedrock", options: { model: "us.amazon.nova-lite-v1:0" } },
        { id: "planner", label: "Demo Agent", kind: "cloud", adapter: "demo" }
      ]
    }, env, store);
    expect(registry.list().map(item => item.id).sort()).toEqual(["hermes", "nova", "oc", "planner"]);
    expect(registry.entry("nova")!.client.capabilities.approvals).toBe(true);
    await registry.close();

    expect(() => buildRuntimeRegistry({
      defaultRuntimeId: "x",
      runtimes: [{ id: "x", label: "X", kind: "local", adapter: "nope" }]
    }, {}, store)).toThrow("not available");
    store.close();
  });
});
