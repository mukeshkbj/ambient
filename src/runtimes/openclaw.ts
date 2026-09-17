import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { rawText } from "../raw.js";
import type { RuntimeState } from "../types.js";
import { firstString, record } from "./http.js";
import {
  AssistantEvented,
  type ActiveSession,
  type AssistantClient,
  type AssistantSession,
  type RuntimeCapabilities,
  type SavedSession
} from "./types.js";

const PROTOCOL_VERSION = 4;

type Frame = {
  type?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
  ok?: boolean;
  payload?: unknown;
  error?: { code?: string; message?: string; details?: unknown };
  event?: string;
};

export type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
};

export type OpenClawConnectionOptions = {
  url: string;
  token?: string | undefined;
  requestTimeoutMs?: number | undefined;
  socketFactory?: ((url: string) => SocketLike) | undefined;
};

class OpenClawError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "OpenClawError";
    this.code = code;
  }
}

/**
 * Documented OpenClaw Gateway WS protocol (protocol v4): the gateway sends a
 * `connect.challenge` event, the client replies with a `connect` request naming
 * role `operator` and its scopes, and the gateway answers `hello-ok`. Requests
 * are `{type:"req"}` frames; pushes arrive as `{type:"event"}` frames.
 */
export class OpenClawConnection extends EventEmitter {
  private socket: SocketLike | undefined;
  private nextId = 1;
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly requestTimeoutMs: number;
  private readonly socketFactory: (url: string) => SocketLike;
  private hello: Record<string, unknown> | undefined;
  private connecting: Promise<Record<string, unknown>> | undefined;

  constructor(private readonly options: OpenClawConnectionOptions) {
    super();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.socketFactory = options.socketFactory ?? (url => new WebSocket(url));
  }

  get isConnected(): boolean {
    return this.socket !== undefined && this.socket.readyState === WebSocket.OPEN && this.hello !== undefined;
  }

  get helloOk(): Record<string, unknown> | undefined {
    return this.hello;
  }

  connect(): Promise<Record<string, unknown>> {
    if (this.isConnected) return Promise.resolve(this.hello!);
    if (!this.connecting) {
      this.connecting = this.connectOnce().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  private async connectOnce(): Promise<Record<string, unknown>> {
    const socket = this.socketFactory(this.options.url);
    this.socket = socket;
    this.hello = undefined;
    this.bindSocket(socket);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new OpenClawError("OpenClaw gateway socket open timed out")), this.requestTimeoutMs);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        socket.off("error", onError);
        if (error) reject(error);
        else resolve();
      };
      const onError = (error: unknown) => finish(error instanceof Error ? error : new Error(String(error)));
      socket.once("error", onError);
      if (socket.readyState === WebSocket.OPEN) finish();
      else socket.once("open", () => finish());
    });
    return this.handshake(socket);
  }

  private async handshake(socket: SocketLike): Promise<Record<string, unknown>> {
    // A pre-connect challenge may arrive first; device signing does not apply to
    // token auth, so the connect request can go out immediately.
    const hello = await this.request("connect", {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: { id: "ambient", version: "0.1.0", platform: process.platform, mode: "operator" },
      role: "operator",
      scopes: ["operator.read", "operator.write", "operator.approvals"],
      caps: [],
      commands: [],
      permissions: {},
      ...(this.options.token ? { auth: { token: this.options.token } } : {}),
      locale: "en-US",
      userAgent: "ambient/0.1.0"
    }).catch(error => {
      socket.close();
      throw error;
    });
    const payload = record(hello);
    if (payload.type !== "hello-ok") {
      socket.close();
      throw new OpenClawError("OpenClaw gateway rejected the connect handshake");
    }
    this.hello = payload;
    this.emit("open");
    return payload;
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.hello = undefined;
    this.rejectPending(new OpenClawError("OpenClaw connection closed"));
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      socket.once("close", () => resolve());
      socket.close();
    });
  }

  request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = this.requestTimeoutMs): Promise<T> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new OpenClawError("OpenClaw gateway is unavailable"));
    }
    const id = `ambient-${this.nextId++}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new OpenClawError(`OpenClaw request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        this.socket!.send(JSON.stringify({ type: "req", id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleMessage(text: string, source: SocketLike): void {
    if (this.socket !== source) return;
    let frame: Frame;
    try {
      frame = JSON.parse(text) as Frame;
    } catch {
      this.emit("protocolError", new OpenClawError("OpenClaw sent invalid JSON"));
      return;
    }
    if (frame.type === "event" && typeof frame.event === "string") {
      this.emit("gatewayEvent", frame.event, record(frame.payload));
      return;
    }
    if (frame.type !== "res" || frame.id === undefined) return;
    const pending = this.pending.get(String(frame.id));
    if (!pending) return;
    this.pending.delete(String(frame.id));
    clearTimeout(pending.timer);
    if (frame.ok === false || frame.error) {
      pending.reject(new OpenClawError(frame.error?.message ?? "OpenClaw request failed", frame.error?.code));
      return;
    }
    pending.resolve(frame.payload);
  }

  private bindSocket(socket: SocketLike): void {
    socket.on("message", (data: unknown) => this.handleMessage(rawText(data as Parameters<typeof rawText>[0]), socket));
    socket.on("error", (error: unknown) => {
      this.emit("protocolError", error instanceof Error ? error : new OpenClawError(String(error)));
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.hello = undefined;
      this.rejectPending(new OpenClawError("OpenClaw gateway connection closed"));
      this.emit("close");
    });
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function approvalPayload(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const requestId = firstString(payload, "id", "approvalId", "requestId", "request_id");
  if (!requestId) return undefined;
  return {
    request_id: requestId,
    command: firstString(payload, "command", "title", "summary") ?? "OpenClaw requested approval",
    ...(firstString(payload, "description", "detail", "reason") ? { description: firstString(payload, "description", "detail", "reason")! } : {}),
    choices: ["once", "deny"]
  };
}

export class OpenClawClient extends AssistantEvented implements AssistantClient {
  readonly capabilities: RuntimeCapabilities = {
    sessions: true,
    steer: true,
    cancel: true,
    approvals: true,
    resume: true,
    events: true,
    asyncClass: "realtime"
  };

  private readonly runTimeoutMs: number;
  private readonly subscribedSessions = new Set<string>();

  constructor(private readonly rpc: OpenClawConnection, options: { runTimeoutMs?: number } = {}) {
    super();
    this.runTimeoutMs = options.runTimeoutMs ?? 15 * 60_000;
    rpc.on("gatewayEvent", (name: string, payload: Record<string, unknown>) => this.handleGatewayEvent(name, payload));
    // Push delivery is opt-in: sessions.changed needs sessions.subscribe, and
    // session.* streams need a per-session sessions.messages.subscribe. Both are
    // best-effort — a gateway that rejects them still works via agent.wait.
    rpc.on("open", () => {
      void this.rpc.request("sessions.subscribe").catch(() => undefined);
      for (const key of this.subscribedSessions) void this.subscribeSession(key);
    });
  }

  get connection(): OpenClawConnection {
    return this.rpc;
  }

  override onConnectionState(listener: (state: RuntimeState) => void): () => void {
    const open = () => listener("online");
    const close = () => listener("offline");
    this.rpc.on("open", open);
    this.rpc.on("close", close);
    return () => {
      this.rpc.off("open", open);
      this.rpc.off("close", close);
    };
  }

  private handleGatewayEvent(name: string, payload: Record<string, unknown>): void {
    const sessionId = firstString(payload, "sessionKey", "key", "session_key");
    if (name === "exec.approval.requested" || name === "plugin.approval.requested" || name === "session.approval") {
      const request = approvalPayload(payload);
      if (request && sessionId) this.emit({ type: "approval.request", sessionId, payload: request });
      return;
    }
    if (!sessionId) return;
    if (name === "session.message") {
      const state = firstString(payload, "state", "status");
      if (state === "error") {
        this.emit({
          type: "message.complete",
          sessionId,
          payload: { status: "error", error: firstString(payload, "errorMessage", "error") ?? "OpenClaw run failed" }
        });
        return;
      }
      const text = firstString(payload, "deltaText", "message", "text");
      this.emit({ type: "message.delta", sessionId, payload: text ? { text } : {} });
      return;
    }
    if (name === "session.operation" || name === "session.tool") {
      this.emit({ type: "status.update", sessionId, payload: { name: name.slice(8) } });
    }
  }

  async ping(): Promise<void> {
    await this.rpc.request("sessions.list", { limit: 1 });
  }

  private subscribeSession(key: string): Promise<unknown> {
    this.subscribedSessions.add(key);
    return this.rpc.request("sessions.messages.subscribe", { key, includeApprovals: true }).catch(() => undefined);
  }

  async createSession(): Promise<AssistantSession> {
    const result = await this.rpc.request<unknown>("sessions.create", { label: "Ambient conversation" });
    const key = firstString(result, "key", "sessionKey", "session.key", "entry.key");
    if (!key) throw new OpenClawError("sessions.create returned no session key");
    void this.subscribeSession(key);
    return { runtimeSessionId: key, durableSessionId: key };
  }

  async submitPrompt(runtimeSessionId: string, text: string): Promise<Record<string, unknown>> {
    const result = record(await this.rpc.request<unknown>("agent", {
      sessionKey: runtimeSessionId,
      message: text
    }));
    const runId = firstString(result, "runId", "run_id", "id");
    if (!runId) throw new OpenClawError("agent run was accepted without a run id");
    void this.subscribeSession(runtimeSessionId);
    void this.waitForRun(runtimeSessionId, runId);
    return { status: "streaming" };
  }

  private async waitForRun(sessionId: string, runId: string): Promise<void> {
    try {
      const result = record(await this.rpc.request<unknown>("agent.wait", { runId }, this.runTimeoutMs));
      const status = firstString(result, "status") ?? "ok";
      if (status === "ok") {
        const text = firstString(result, "output", "text", "message", "result", "summary")
          ?? "OpenClaw completed the request";
        this.emit({ type: "message.complete", sessionId, payload: { text, status: "ok" } });
      } else {
        const error = firstString(result, "error", "message", "reason") ?? `OpenClaw run ended: ${status}`;
        this.emit({ type: "message.complete", sessionId, payload: { status: "error", error, text: error } });
      }
    } catch (error) {
      // A dropped socket means the run's outcome is unknown — the close event
      // already marks the runtime offline and the engine marks runs unknown.
      if (!this.rpc.isConnected) return;
      this.emit({
        type: "message.complete",
        sessionId,
        payload: {
          status: "error",
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  steer(runtimeSessionId: string, text: string): Promise<Record<string, unknown>> {
    return this.rpc.request("chat.send", {
      sessionKey: runtimeSessionId,
      message: text,
      queueMode: "steer",
      idempotencyKey: randomUUID()
    });
  }

  async interrupt(runtimeSessionId: string): Promise<Record<string, unknown>> {
    await this.rpc.request("sessions.abort", { key: runtimeSessionId });
    return { status: "interrupted" };
  }

  async resumeSession(durableSessionId: string): Promise<AssistantSession> {
    const result = record(await this.rpc.request<unknown>("sessions.resolve", {
      key: durableSessionId,
      allowMissing: true
    }));
    if (result.ok === false) throw new OpenClawError(`OpenClaw session ${durableSessionId} no longer exists`);
    const key = firstString(result, "key", "sessionKey", "session.key") ?? durableSessionId;
    void this.subscribeSession(key);
    return { runtimeSessionId: key, durableSessionId: key };
  }

  async listSavedSessions(limit = 50): Promise<SavedSession[]> {
    const result = record(await this.rpc.request<unknown>("sessions.list", { limit }));
    const rows = Array.isArray(result.sessions) ? result.sessions.map(record) : [];
    return rows.flatMap(row => {
      const id = firstString(row, "key", "sessionKey", "id");
      if (!id) return [];
      const updated = row.updatedAt ?? row.createdAt;
      return [{
        id,
        ...(firstString(row, "label", "displayName", "title") ? { title: firstString(row, "label", "displayName", "title")! } : {}),
        ...(typeof updated === "number" ? { started_at: updated } : {}),
        source: "openclaw"
      }];
    });
  }

  async listActiveSessions(): Promise<ActiveSession[]> {
    const result = record(await this.rpc.request<unknown>("sessions.list", { activeOnly: true, limit: 100 }));
    const rows = Array.isArray(result.sessions) ? result.sessions.map(record) : [];
    return rows.flatMap(row => {
      const id = firstString(row, "key", "sessionKey", "id");
      if (!id || row.hasActiveRun !== true) return [];
      return [{
        id,
        session_key: id,
        status: "working",
        ...(firstString(row, "label", "displayName", "title") ? { title: firstString(row, "label", "displayName", "title")! } : {})
      }];
    });
  }

  async listPendingApprovals(): Promise<Record<string, unknown>[]> {
    const result = record(await this.rpc.request<unknown>("exec.approval.list"));
    const rows = result.pending ?? result.approvals ?? result.items;
    if (!Array.isArray(rows)) return [];
    return rows.map(record).flatMap(row => {
      const approval = approvalPayload(row);
      return approval ? [approval] : [];
    });
  }

  async respondToApproval(_runtimeSessionId: string, requestId: string, choice: string): Promise<Record<string, unknown>> {
    await this.rpc.request("approval.resolve", {
      id: requestId,
      kind: "exec",
      decision: choice === "deny" ? "deny" : "allow-once"
    });
    return { resolved: 1 };
  }

  async close(): Promise<void> {
    await this.rpc.close();
  }
}
