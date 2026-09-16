import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { ConversationEngine } from "../src/conversations.js";
import { readConfig } from "../src/config.js";
import { GrokBotClient } from "../src/runtimes/grokbot.js";
import { InstinctClient } from "../src/runtimes/instinct.js";
import { MuseClient } from "../src/runtimes/muse.js";
import { OpenClawClient, OpenClawConnection, type SocketLike } from "../src/runtimes/openclaw.js";
import { buildRuntimeRegistry } from "../src/runtimes/registry.js";
import { TownieClient } from "../src/runtimes/townie.js";
import type { AssistantClient } from "../src/runtimes/types.js";
import { AmbientStore } from "../src/store.js";

type RequestLog = { url: string; method: string; auth?: string; body: unknown };

function fakeFetch(handler: (req: RequestLog) => { status?: number; body?: unknown }) {
  const requests: RequestLog[] = [];
  const fetchImpl = (async (url: unknown, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const request: RequestLog = {
      url: String(url),
      method: init.method ?? "GET",
      ...(init.headers?.authorization ? { auth: init.headers.authorization } : {}),
      body: init.body ? JSON.parse(init.body) : undefined
    };
    requests.push(request);
    const result = handler(request);
    return new Response(result.body === undefined ? "" : JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { "content-type": "application/json" }
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

function engineFor(client: AssistantClient, store: AmbientStore, id = "rt"): ConversationEngine {
  return new ConversationEngine(client, store, {
    runtime: { id, label: id, kind: "cloud", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" }
  });
}

async function waitFor(engine: ConversationEngine, runId: string, ms = 5_000): Promise<string> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const status = engine.getWork(runId).status;
    if (["completed", "failed", "cancelled", "unknown"].includes(status)) return status;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return "timeout";
}

describe("MuseClient (Muse Spark / Meta Model API)", () => {
  it("completes a run from a chat completion and reports honest capabilities", async () => {
    const { fetchImpl, requests } = fakeFetch(req => {
      if (req.url.endsWith("/chat/completions")) {
        return { body: { choices: [{ message: { role: "assistant", content: "hello from muse" } }] } };
      }
      return { body: { data: [] } };
    });
    const store = new AmbientStore();
    const client = new MuseClient({ token: "m-key", model: "muse-spark-1.3", fetchImpl });
    const engine = engineFor(client, store, "muse");

    const run = await engine.ask("say hi", undefined, true);
    expect(await waitFor(engine, run.id)).toBe("completed");
    expect(engine.getWork(run.id).answer).toBe("hello from muse");

    const call = requests.find(req => req.url.includes("chat/completions"))!;
    expect(call.auth).toBe("Bearer m-key");
    expect((call.body as { model: string }).model).toBe("muse-spark-1.3");

    expect(client.capabilities).toMatchObject({ approvals: false, steer: false, sessions: true });
    await client.close();
    engine.close();
    store.close();
  });
});

describe("TownieClient (Val Town run API)", () => {
  it("posts the prompt to the configured val run URL and pings /v1/me", async () => {
    const { fetchImpl, requests } = fakeFetch(req =>
      req.url.endsWith("/v1/me") ? { body: { id: "u1" } } : { body: "val says done" });
    const store = new AmbientStore();
    const client = new TownieClient({ endpoint: "https://api.val.town/v1/run/me.myval", token: "vt", fetchImpl });
    const engine = engineFor(client, store, "townie");

    await client.ping();
    const run = await engine.ask("ship it", undefined, true);
    expect(await waitFor(engine, run.id)).toBe("completed");
    expect(engine.getWork(run.id).answer).toBe("val says done");

    expect(requests[0]!.url).toBe("https://api.val.town/v1/me");
    const runCall = requests[1]!;
    expect(runCall.url).toBe("https://api.val.town/v1/run/me.myval");
    expect(runCall.body).toEqual([{ prompt: "ship it" }]);

    expect(client.capabilities).toMatchObject({ approvals: false, resume: false, sessions: false });
    engine.close();
    store.close();
  });
});

describe("GrokBotClient (sand host gateway)", () => {
  it("sends prompts via /api/sendPrompt and completes on a transcript reply", async () => {
    const { fetchImpl, requests } = fakeFetch(req => {
      if (req.url.endsWith("/api/listAgents")) {
        return { body: { agents: [{ id: "ag-1", name: "Ambient session", status: "idle" }] } };
      }
      if (req.url.endsWith("/api/getAgentTranscriptTail")) {
        const sent = requests.some(r => r.url.endsWith("/api/sendPrompt"));
        return { body: { entries: sent ? [{ seq: 7, role: "assistant", text: "grok says hi" }] : [] } };
      }
      if (req.url.endsWith("/api/createAgent")) {
        return { body: { id: "ag-1" } };
      }
      return { body: { ok: true } };
    });
    const store = new AmbientStore();
    const client = new GrokBotClient({ endpoint: "http://127.0.0.1:1340", token: "sand", pollMs: 5, fetchImpl });
    const engine = engineFor(client, store, "grokbot");

    const run = await engine.ask("hello", undefined, true);
    expect(await waitFor(engine, run.id)).toBe("completed");
    expect(engine.getWork(run.id).answer).toBe("grok says hi");

    const send = requests.find(req => req.url.endsWith("/api/sendPrompt"))!;
    expect(send.body).toEqual({ id: "ag-1", prompt: "hello" });
    expect(send.auth).toBe("Bearer sand");

    await client.interrupt("ag-1");
    expect(requests.some(req => req.url.endsWith("/api/interruptAgentRun"))).toBe(true);

    expect(client.capabilities).toMatchObject({ approvals: false, cancel: true, asyncClass: "async" });
    await client.close();
    engine.close();
    store.close();
  });

  it("uses createAgent for new sessions and resumeSession validates the roster", async () => {
    const { fetchImpl } = fakeFetch(req => {
      if (req.url.endsWith("/api/createAgent")) return { body: { id: "ag-new" } };
      if (req.url.endsWith("/api/listAgents")) return { body: { agents: [{ id: "ag-1", name: "x" }] } };
      return { body: {} };
    });
    const client = new GrokBotClient({ endpoint: "http://127.0.0.1:1340", fetchImpl });
    expect(await client.createSession()).toEqual({ runtimeSessionId: "ag-new", durableSessionId: "ag-new" });
    expect(await client.resumeSession("ag-1")).toEqual({ runtimeSessionId: "ag-1", durableSessionId: "ag-1" });
    await expect(client.resumeSession("gone")).rejects.toThrow("no longer exists");
    await client.close();
  });
});

describe("InstinctClient (email channel)", () => {
  it("emails the task and completes when the reply lands", async () => {
    let sentTag = "";
    const { fetchImpl, requests } = fakeFetch(req => {
      if (req.url.endsWith("/users/me/messages/send")) {
        const raw = Buffer.from((req.body as { raw: string }).raw, "base64url").toString("utf8");
        sentTag = raw.match(/ambient:inst-[a-z0-9-]+/)?.[0] ?? "";
        return { body: { id: "m-out" } };
      }
      if (req.url.includes("/users/me/messages?")) {
        return { body: { messages: [{ id: "m-in" }] } };
      }
      if (req.url.includes("/users/me/messages/m-in")) {
        return {
          body: {
            id: "m-in",
            internalDate: String(Date.now()),
            snippet: sentTag,
            payload: { mimeType: "text/plain", body: { data: Buffer.from(`done [${sentTag}]`).toString("base64url") } }
          }
        };
      }
      return { body: {} };
    });
    const store = new AmbientStore();
    const client = new InstinctClient({ to: "me@mail.instinct.com", token: "g", pollMs: 5, fetchImpl });
    const engine = engineFor(client, store, "instinct");

    const run = await engine.ask("water the plants", undefined, true);
    expect(await waitFor(engine, run.id)).toBe("completed");
    expect(engine.getWork(run.id).answer).toContain("done");
    expect(sentTag).toMatch(/^ambient:inst-/);
    expect(requests[0]!.auth).toBe("Bearer g");

    expect(client.capabilities).toMatchObject({ asyncClass: "async", cancel: false, approvals: false });
    await client.close();
    engine.close();
    store.close();
  });
});

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
        { id: "grok", label: "Grok Bot", kind: "local", adapter: "grokbot", endpoint: "http://127.0.0.1:1340", tokenEnv: "GROK_TOKEN" },
        { id: "muse", label: "Muse", kind: "cloud", adapter: "muse", tokenEnv: "META_KEY", options: { model: "muse-spark-1.3" } },
        { id: "townie", label: "Townie", kind: "cloud", adapter: "townie", endpoint: "https://api.val.town/v1/run/me.v", tokenEnv: "VT" },
        { id: "instinct", label: "Instinct", kind: "cloud", adapter: "instinct", tokenEnv: "GOOGLE_TOKEN", options: { to: "me@mail.instinct.com" } }
      ]
    }, env, store);
    expect(registry.list().map(item => item.id).sort()).toEqual(["grok", "hermes", "instinct", "muse", "oc", "townie"]);
    expect(registry.entry("muse")!.client.capabilities.approvals).toBe(false);
    await registry.close();

    expect(() => buildRuntimeRegistry({
      defaultRuntimeId: "x",
      runtimes: [{ id: "x", label: "X", kind: "local", adapter: "nope" }]
    }, {}, store)).toThrow("not available");
    store.close();
  });
});
