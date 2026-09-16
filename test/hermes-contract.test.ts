import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { HermesClient, HermesConnection, type HermesEvent } from "../src/hermes.js";
import { rawText } from "../src/raw.js";

let server: WebSocketServer | undefined;

afterEach(async () => {
  await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve());
  server = undefined;
});

describe("Hermes gateway contract", () => {
  it("waits for gateway.ready and unwraps the current session list", async () => {
    server = new WebSocketServer({ port: 0 });
    server.on("connection", socket => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
        type: "gateway.ready", payload: { change_events: true }
      }}));
      socket.on("message", raw => {
        const request = JSON.parse(rawText(raw)) as { id: string; method: string };
        expect(request.method).toBe("session.list");
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
          sessions: [{ id: "stored-1", title: "Personal schedule", preview: "What is on my schedule?" }]
        }}));
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    const connection = new HermesConnection({ url: `ws://127.0.0.1:${address.port}` });
    await connection.connect();
    const client = new HermesClient(connection);
    await expect(client.listSavedSessions()).resolves.toEqual([
      { id: "stored-1", title: "Personal schedule", preview: "What is on my schedule?" }
    ]);
    await connection.close();
  });

  it("normalizes event payloads without losing approval request identity", async () => {
    server = new WebSocketServer({ port: 0 });
    server.on("connection", socket => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
        type: "gateway.ready", payload: {}
      }}));
      setTimeout(() => socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
        type: "approval.request", session_id: "runtime-1", payload: {
          request_id: "approval-1", command: "restart demo", description: "Restart the demo", choices: ["once", "deny"]
        }
      }})), 5);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    const connection = new HermesConnection({ url: `ws://127.0.0.1:${address.port}` });
    const event = new Promise<unknown>(resolve => connection.onEvent(value => {
      if (value.type === "approval.request") resolve(value);
    }));
    await connection.connect();
    await expect(event).resolves.toMatchObject({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { request_id: "approval-1" }
    });
    await connection.close();
  });

  it("times out a gateway that never announces readiness", async () => {
    server = new WebSocketServer({ port: 0 });
    server.on("connection", () => undefined);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    const connection = new HermesConnection({ url: `ws://127.0.0.1:${address.port}`, requestTimeoutMs: 20 });
    await expect(connection.connect()).rejects.toThrow("gateway.ready timed out");
    await connection.close();
  });

  it("keeps a heartbeat-capable gateway alive with gateway.ping", async () => {
    server = new WebSocketServer({ port: 0 });
    server.on("connection", socket => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
        type: "gateway.ready", payload: { heartbeat: true }
      }}));
      socket.on("message", raw => {
        const request = JSON.parse(rawText(raw)) as { id: string; method: string };
        if (request.method === "gateway.ping") socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { ok: true } }));
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    const connection = new HermesConnection({ url: `ws://127.0.0.1:${address.port}`, heartbeatIntervalMs: 5, heartbeatDeadlineMs: 30 });
    await connection.connect();
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(connection.isConnected).toBe(true);
    await connection.close();
  });

  it("replays observed events after reconnect", async () => {
    server = new WebSocketServer({ port: 0 });
    let connections = 0;
    server.on("connection", socket => {
      connections += 1;
      socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
        type: "gateway.ready", payload: { replay_epoch: "epoch-a" }
      }}));
      if (connections === 1) {
        setTimeout(() => {
          socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
            type: "message.delta", session_id: "runtime-1", seq: 1, payload: { text: "first" }
          }}));
          setTimeout(() => socket.close(), 5);
        }, 5);
        return;
      }
      socket.on("message", raw => {
        const request = JSON.parse(rawText(raw)) as { id: string; method: string };
        if (request.method === "session.events.since") {
          socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
            events: [{ type: "message.complete", session_id: "runtime-1", seq: 2, payload: { text: "done" } }],
            count: 1, latest_seq: 2, truncated: false,
            epoch: "epoch-a"
          }}));
        }
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    const connection = new HermesConnection({ url: `ws://127.0.0.1:${address.port}` });
    const events: HermesEvent[] = [];
    const openEventCounts: number[] = [];
    const secondEvent = new Promise<void>(resolve => connection.onEvent(event => {
      if (!event.sessionId) return;
      events.push(event);
      if (events.length === 2) resolve();
    }));
    connection.on("open", () => openEventCounts.push(events.length));
    await connection.connect();
    await new Promise<void>(resolve => connection.once("close", resolve));
    await connection.connect();
    await secondEvent;
    expect(events.map(event => [event.type, event.seq])).toEqual([
      ["message.delta", 1],
      ["message.complete", 2]
    ]);
    expect(openEventCounts).toEqual([0, 2]);
    await connection.close();
  });

  it("refuses partial replay when Hermes reports truncation", async () => {
    server = new WebSocketServer({ port: 0 });
    let connections = 0;
    server.on("connection", socket => {
      connections += 1;
      socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
        type: "gateway.ready", payload: { replay_epoch: "epoch-a" }
      }}));
      if (connections === 1) {
        setTimeout(() => {
          socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
            type: "message.delta", session_id: "runtime-1", seq: 1, payload: { text: "first" }
          }}));
          setTimeout(() => socket.close(), 5);
        }, 5);
        return;
      }
      socket.on("message", raw => {
        const request = JSON.parse(rawText(raw)) as { id: string; method: string };
        if (request.method === "session.events.since") {
          socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
            events: [{ type: "message.complete", session_id: "runtime-1", seq: 2, payload: { text: "partial" } }],
            latest_seq: 20, truncated: true, epoch: "epoch-a"
          }}));
        }
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    const connection = new HermesConnection({ url: `ws://127.0.0.1:${address.port}` });
    const events: HermesEvent[] = [];
    connection.onEvent(event => {
      if (event.sessionId) events.push(event);
    });
    await connection.connect();
    await new Promise<void>(resolve => connection.once("close", resolve));
    await connection.connect();
    expect(events.map(event => [event.type, event.seq])).toEqual([["message.delta", 1]]);
    await connection.close();
  });

  it("surfaces a replay gap when the replay request fails", async () => {
    server = new WebSocketServer({ port: 0 });
    let connections = 0;
    server.on("connection", socket => {
      connections += 1;
      socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
        type: "gateway.ready", payload: { replay_epoch: "epoch-a" }
      }}));
      if (connections === 1) {
        setTimeout(() => {
          socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
            type: "message.delta", session_id: "runtime-1", seq: 1, payload: { text: "first" }
          }}));
          setTimeout(() => socket.close(), 5);
        }, 5);
        return;
      }
      socket.on("message", raw => {
        const request = JSON.parse(rawText(raw)) as { id: string; method: string };
        if (request.method === "session.events.since") {
          socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "replay unavailable" } }));
        }
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    const connection = new HermesConnection({ url: `ws://127.0.0.1:${address.port}` });
    const gaps: Array<{ sessionId: string; lastSeen: number; latestSeq: number }> = [];
    connection.onReplayGap(gap => gaps.push(gap));
    await connection.connect();
    await new Promise<void>(resolve => connection.once("close", resolve));
    await connection.connect();
    expect(gaps).toEqual([{ sessionId: "runtime-1", lastSeen: 1, latestSeq: 1 }]);
    expect(connection.isConnected).toBe(true);
    await connection.close();
  });

  it("surfaces a replay gap when replay event data is malformed", async () => {
    server = new WebSocketServer({ port: 0 });
    let connections = 0;
    server.on("connection", socket => {
      connections += 1;
      socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
        type: "gateway.ready", payload: { replay_epoch: "epoch-a" }
      }}));
      if (connections === 1) {
        setTimeout(() => {
          socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
            type: "message.delta", session_id: "runtime-1", seq: 1, payload: { text: "first" }
          }}));
          setTimeout(() => socket.close(), 5);
        }, 5);
        return;
      }
      socket.on("message", raw => {
        const request = JSON.parse(rawText(raw)) as { id: string; method: string };
        if (request.method === "session.events.since") {
          socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
            events: [{ type: "message.complete", session_id: "runtime-1", seq: 2, payload: "malformed" }],
            count: 1, latest_seq: 2, truncated: false, epoch: "epoch-a"
          }}));
        }
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    const connection = new HermesConnection({ url: `ws://127.0.0.1:${address.port}` });
    const events: HermesEvent[] = [];
    const gaps: Array<{ sessionId: string; lastSeen: number; latestSeq: number }> = [];
    connection.onEvent(event => { if (event.sessionId) events.push(event); });
    connection.onReplayGap(gap => gaps.push(gap));
    await connection.connect();
    await new Promise<void>(resolve => connection.once("close", resolve));
    await connection.connect();
    expect(events.map(event => [event.type, event.seq])).toEqual([["message.delta", 1]]);
    expect(gaps).toEqual([{ sessionId: "runtime-1", lastSeen: 1, latestSeq: 2 }]);
    await connection.close();
  });

  it("does not replay across a changed gateway epoch", async () => {
    server = new WebSocketServer({ port: 0 });
    let connections = 0;
    server.on("connection", socket => {
      connections += 1;
      socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
        type: "gateway.ready", payload: { replay_epoch: connections === 1 ? "epoch-a" : "epoch-b" }
      }}));
      if (connections === 1) {
        setTimeout(() => {
          socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: {
            type: "message.delta", session_id: "runtime-1", seq: 1, payload: { text: "first" }
          }}));
          setTimeout(() => socket.close(), 5);
        }, 5);
        return;
      }
      socket.on("message", raw => {
        const request = JSON.parse(rawText(raw)) as { id: string; method: string };
        if (request.method === "session.events.since") {
          socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {
            events: [{ type: "message.complete", session_id: "runtime-1", seq: 2, payload: { text: "stale" } }],
            count: 1, latest_seq: 2, truncated: false, epoch: "epoch-b"
          }}));
        }
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server did not bind");
    const connection = new HermesConnection({ url: `ws://127.0.0.1:${address.port}` });
    const events: HermesEvent[] = [];
    const gaps: Array<{ sessionId: string; lastSeen: number; latestSeq: number }> = [];
    connection.onEvent(event => { if (event.sessionId) events.push(event); });
    connection.onReplayGap(gap => gaps.push(gap));
    await connection.connect();
    await new Promise<void>(resolve => connection.once("close", resolve));
    await connection.connect();
    expect(events.map(event => [event.type, event.seq])).toEqual([["message.delta", 1]]);
    expect(gaps).toEqual([{ sessionId: "runtime-1", lastSeen: 1, latestSeq: 2 }]);
    await connection.close();
  });
});
