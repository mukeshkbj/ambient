import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { rawText } from "./raw.js";
import type {
  ActiveSession,
  ApprovalPayload,
  ApprovalResponse,
  AssistantClient,
  AssistantEvent,
  AssistantSession,
  AssistantWireEvent,
  InterruptResult,
  ReplayGap,
  RuntimeCapabilities,
  SavedSession,
  SteerResult,
  SubmitResult
} from "./runtimes/types.js";

/** Wire (snake_case) → canonical (camelCase) mapping, all in one place. */
function canonicalize(event: AssistantWireEvent): AssistantEvent | undefined {
  const base = {
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
    ...(event.seq !== undefined ? { seq: event.seq } : {})
  };
  const p = event.payload;
  switch (event.type) {
    case "message.start":
      return { ...base, type: "message.start", payload: { ...(typeof p.kind === "string" ? { kind: p.kind } : {}) } };
    case "message.delta":
    case "message.interim":
      return { ...base, type: event.type, payload: { ...(typeof p.text === "string" ? { text: p.text } : {}) } };
    case "message.complete":
      return {
        ...base,
        type: "message.complete",
        payload: {
          ...(typeof p.text === "string" ? { text: p.text } : {}),
          ...(typeof p.status === "string" ? { status: p.status } : {}),
          ...(typeof p.error === "string" ? { error: p.error } : {})
        }
      };
    case "tool.start":
    case "tool.complete":
      return { ...base, type: event.type, payload: { ...(typeof p.name === "string" ? { name: p.name } : {}) } };
    case "status.update":
      return {
        ...base,
        type: "status.update",
        payload: {
          ...(typeof p.text === "string" ? { text: p.text } : {}),
          ...(typeof p.name === "string" ? { name: p.name } : {}),
          ...(typeof p.summary === "string" ? { summary: p.summary } : {}),
          ...(typeof p.message === "string" ? { message: p.message } : {})
        }
      };
    case "approval.request": {
      const requestId = typeof p.request_id === "string" ? p.request_id
        : typeof p.requestId === "string" ? p.requestId : undefined;
      if (!requestId) return undefined;
      return {
        ...base,
        type: "approval.request",
        payload: {
          requestId,
          command: typeof p.command === "string" ? p.command : "Approval requested",
          ...(typeof p.description === "string" ? { description: p.description } : {}),
          ...(Array.isArray(p.choices) ? { choices: p.choices.filter((c): c is string => typeof c === "string") } : {})
        }
      };
    }
    default:
      return undefined;
  }
}

type HermesFrame = {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export type HermesConnectionOptions = {
  url: string;
  token?: string;
  requestTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatDeadlineMs?: number;
};

class HermesRpcError extends Error {
  readonly code: number | undefined;
  readonly data: unknown;

  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.name = "HermesRpcError";
    this.code = code;
    this.data = data;
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HermesRpcError("Hermes returned an object where one was required");
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown, field: string): string {
  const result = record(value)[field];
  if (typeof result !== "string" || result.length === 0) {
    throw new HermesRpcError(`Hermes response is missing ${field}`);
  }
  return result;
}

function sessionRows(value: unknown): Record<string, unknown>[] {
  const rows = record(value).sessions;
  if (!Array.isArray(rows)) throw new HermesRpcError("Hermes session response is missing sessions");
  return rows.map(record);
}

export class HermesConnection extends EventEmitter {
  private socket: WebSocket | undefined;
  private nextRequestId = 1;
  private readonly pending = new Map<string | number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private readonly requestTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatDeadlineMs: number;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private lastInboundAt = 0;
  private ready = false;
  private connecting: Promise<void> | undefined;
  private opened = false;
  private replayEpoch: string | undefined;
  private pendingReplayEpoch: string | undefined;
  private replayInFlight = false;
  private replayHold: Map<string, AssistantWireEvent[]> | undefined;
  private readonly lastSeenSeq = new Map<string, number>();

  constructor(private readonly options: HermesConnectionOptions) {
    super();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.heartbeatDeadlineMs = options.heartbeatDeadlineMs ?? 45_000;
  }

  get isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN && this.ready;
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;
    if (this.connecting) return this.connecting;
    const attempt = this.connectOnce();
    this.connecting = attempt;
    try {
      await attempt;
    } finally {
      if (this.connecting === attempt) this.connecting = undefined;
    }
  }

  private async connectOnce(): Promise<void> {
    const url = new URL(this.options.url);
    if (this.options.token) url.searchParams.set("token", this.options.token);
    const socket = new WebSocket(url);
    this.socket = socket;
    this.ready = false;
    this.bindSocket(socket);
    await this.waitForReady(socket);
  }

  async attach(socket: WebSocket): Promise<void> {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED && this.socket.readyState !== WebSocket.CLOSING) {
      throw new HermesRpcError("Hermes gateway is already attached");
    }
    this.socket = socket;
    this.ready = false;
    this.bindSocket(socket);
    await this.waitForReady(socket);
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.ready = false;
    this.stopHeartbeat();
    this.rejectPending(new Error("Hermes connection closed"));
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      socket.once("close", () => resolve());
      socket.close();
    });
  }

  onEvent(listener: (event: AssistantWireEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }

  onReplayGap(listener: (gap: ReplayGap) => void): () => void {
    this.on("replayGap", listener);
    return () => this.off("replayGap", listener);
  }

  onConnectionState(listener: (state: "online" | "offline" | "unknown") => void): () => void {
    const open = () => listener("online");
    const close = () => listener("offline");
    this.on("open", open);
    this.on("close", close);
    return () => {
      this.off("open", open);
      this.off("close", close);
    };
  }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.isConnected || !this.socket) throw new HermesRpcError("Hermes gateway is unavailable");
    const id = `ambient-${this.nextRequestId++}`;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HermesRpcError(`Hermes request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        this.socket!.send(frame);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleMessage(text: string, source: WebSocket): void {
    if (this.socket !== source) return;
    this.lastInboundAt = Date.now();
    try {
      const frame = JSON.parse(text) as HermesFrame;
      if (frame.method === "event") {
        const params = record(frame.params);
        const type = stringField(params, "type");
        const sessionId = typeof params.session_id === "string" ? params.session_id : undefined;
        const payload = params.payload && typeof params.payload === "object" && !Array.isArray(params.payload)
          ? params.payload as Record<string, unknown>
          : {};
        const seq = typeof params.seq === "number" && Number.isFinite(params.seq) ? params.seq : undefined;
        const event = {
          type,
          ...(sessionId ? { sessionId } : {}),
          payload,
          ...(seq !== undefined ? { seq } : {})
        } satisfies AssistantWireEvent;
        if (type === "gateway.ready") {
          const epoch = typeof payload.replay_epoch === "string" && payload.replay_epoch ? payload.replay_epoch : undefined;
          if (epoch && this.opened && this.lastSeenSeq.size > 0 && epoch !== this.replayEpoch) {
            this.pendingReplayEpoch = epoch;
          } else if (epoch) {
            this.adoptReplayEpoch(epoch);
          }
        }
        if (this.replayHold && sessionId && seq !== undefined && this.replayHold.has(sessionId)) {
          this.replayHold.get(sessionId)!.push(event);
          return;
        }
        this.dispatchIfNewer(event);
        return;
      }
      if (frame.id === undefined) {
        this.emit("protocolError", new HermesRpcError("Hermes sent an unrecognized frame"));
        return;
      }
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id);
      clearTimeout(pending.timer);
      if (frame.error) {
        pending.reject(new HermesRpcError(frame.error.message ?? "Hermes request failed", frame.error.code, frame.error.data));
        return;
      }
      pending.resolve(frame.result);
    } catch {
      this.emit("protocolError", new HermesRpcError("Hermes sent invalid JSON"));
    }
  }

  private bindSocket(socket: WebSocket): void {
    socket.on("message", data => this.handleMessage(rawText(data), socket));
    socket.on("error", error => {
      if (this.socket === socket) this.emit("protocolError", new HermesRpcError(error instanceof Error ? error.message : String(error)));
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.ready = false;
      this.stopHeartbeat();
      this.rejectPending(new HermesRpcError("Hermes gateway connection closed"));
      this.emit("close");
    });
  }

  private async waitForReady(socket: WebSocket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let readyStarted = false;
      const onReady = (event: AssistantWireEvent) => {
        if (event.type !== "gateway.ready" || settled || readyStarted) return;
        readyStarted = true;
        this.ready = true;
        if (event.payload.heartbeat === true) this.startHeartbeat(socket);
        const reconnect = this.opened;
        this.opened = true;
        void (async () => {
          if (reconnect) await this.fetchReplay();
          if (finish()) this.emit("open");
        })();
      };
      const onError = (error: unknown) => finish(error instanceof Error ? error : new Error(String(error)));
      const onClose = () => finish(new HermesRpcError("Hermes gateway closed before ready"));
      const finish = (error?: Error): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        this.off("event", onReady);
        socket.off("error", onError);
        socket.off("close", onClose);
        if (error && this.socket === socket && socket.readyState === WebSocket.OPEN) socket.close();
        if (error) reject(error);
        else resolve();
        return true;
      };
      const timer = setTimeout(() => finish(new HermesRpcError("Hermes gateway.ready timed out")), this.requestTimeoutMs);
      this.on("event", onReady);
      socket.once("error", onError);
      socket.once("close", onClose);
      if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        finish(new HermesRpcError("Hermes gateway closed before ready"));
      }
    });
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    this.lastInboundAt = Date.now();
    if (this.heartbeatIntervalMs <= 0 || this.heartbeatDeadlineMs <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || !this.isConnected) return;
      if (Date.now() - this.lastInboundAt >= this.heartbeatDeadlineMs) {
        socket.close();
        return;
      }
      void this.request("gateway.ping").catch(() => {
        if (this.socket === socket) socket.close();
      });
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private dispatchIfNewer(event: AssistantWireEvent): void {
    if (event.sessionId && event.seq !== undefined) {
      const previous = this.lastSeenSeq.get(event.sessionId) ?? -1;
      if (event.seq <= previous) return;
      this.lastSeenSeq.set(event.sessionId, event.seq);
    }
    this.emit("event", event);
  }

  private adoptReplayEpoch(epoch: string): void {
    if (this.replayEpoch === epoch) return;
    if (this.replayEpoch !== undefined) this.lastSeenSeq.clear();
    this.replayEpoch = epoch;
  }

  private async fetchReplay(): Promise<void> {
    if (this.replayInFlight || !this.isConnected) return;
    const epochChange = this.pendingReplayEpoch;
    if (this.lastSeenSeq.size === 0) {
      if (epochChange) {
        this.adoptReplayEpoch(epochChange);
        this.pendingReplayEpoch = undefined;
      }
      return;
    }
    this.replayInFlight = true;
    const entries = [...this.lastSeenSeq.entries()];
    const hold = new Map<string, AssistantWireEvent[]>();
    for (const [sessionId] of entries) hold.set(sessionId, []);
    this.replayHold = hold;
    const gaps = new Set<string>();
    const emitGap = (sessionId: string, lastSeen: number, latestSeq: number): void => {
      if (gaps.has(sessionId)) return;
      gaps.add(sessionId);
      this.emit("replayGap", { sessionId, lastSeen, latestSeq } satisfies ReplayGap);
    };
    try {
      const results = await Promise.allSettled(entries.map(([sessionId, lastSeen]) =>
        this.request<Record<string, unknown>>("session.events.since", { session_id: sessionId, last_seen: lastSeen })
      ));
      for (const [index, result] of results.entries()) {
        const entry = entries[index];
        if (!entry) continue;
        const [requestedSessionId, lastSeen] = entry;
        if (result.status !== "fulfilled") {
          emitGap(requestedSessionId, lastSeen, lastSeen);
          continue;
        }
        let value: Record<string, unknown>;
        try {
          value = record(result.value);
        } catch {
          emitGap(requestedSessionId, lastSeen, lastSeen);
          continue;
        }
        const latestSeq = typeof value.latest_seq === "number" && Number.isFinite(value.latest_seq)
          ? value.latest_seq
          : lastSeen;
        const epoch = typeof value.epoch === "string" && value.epoch ? value.epoch : undefined;
        if (!epoch || epochChange || (this.replayEpoch && epoch !== this.replayEpoch)) {
          emitGap(requestedSessionId, lastSeen, latestSeq);
          if (epoch && epoch !== this.replayEpoch) this.pendingReplayEpoch = epoch;
          continue;
        }
        if (value.truncated !== false || !Array.isArray(value.events)) {
          emitGap(requestedSessionId, lastSeen, latestSeq);
          continue;
        }
        const replayed: AssistantWireEvent[] = [];
        let malformed = false;
        for (const item of value.events) {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            malformed = true;
            break;
          }
          const eventValue = item as Record<string, unknown>;
          if (typeof eventValue.type !== "string" || !eventValue.type || eventValue.session_id !== requestedSessionId) {
            malformed = true;
            break;
          }
          if (typeof eventValue.seq !== "number" || !Number.isFinite(eventValue.seq)) {
            malformed = true;
            break;
          }
          if (!eventValue.payload || typeof eventValue.payload !== "object" || Array.isArray(eventValue.payload)) {
            malformed = true;
            break;
          }
          replayed.push({
            type: eventValue.type,
            sessionId: requestedSessionId,
            payload: eventValue.payload as Record<string, unknown>,
            seq: eventValue.seq
          });
        }
        if (malformed) {
          emitGap(requestedSessionId, lastSeen, latestSeq);
          continue;
        }
        for (const event of replayed) this.dispatchIfNewer(event);
      }
      if (epochChange) this.adoptReplayEpoch(epochChange);
      else if (this.pendingReplayEpoch && this.pendingReplayEpoch !== this.replayEpoch) this.adoptReplayEpoch(this.pendingReplayEpoch);
      this.pendingReplayEpoch = undefined;
    } catch {
      for (const [sessionId, lastSeen] of entries) emitGap(sessionId, lastSeen, lastSeen);
    } finally {
      const epochToAdopt = epochChange ?? this.pendingReplayEpoch;
      if (epochToAdopt && epochToAdopt !== this.replayEpoch) this.adoptReplayEpoch(epochToAdopt);
      this.pendingReplayEpoch = undefined;
      const parked = this.replayHold;
      this.replayHold = undefined;
      if (parked) {
        for (const events of parked.values()) {
          for (const event of events) this.dispatchIfNewer(event);
        }
      }
      this.replayInFlight = false;
    }
  }
}

export class HermesClient implements AssistantClient {
  readonly ephemeralSessions = true;

  readonly capabilities: RuntimeCapabilities = {
    sessions: true,
    steer: true,
    cancel: true,
    approvals: true,
    resume: true,
    events: true,
    asyncClass: "realtime"
  };

  constructor(private readonly rpc: HermesConnection) {}

  get connection(): HermesConnection {
    return this.rpc;
  }

  async close(): Promise<void> {
    await this.rpc.close();
  }

  onEvent(listener: (event: AssistantEvent) => void): () => void {
    return this.rpc.onEvent(event => {
      const canonical = canonicalize(event);
      if (canonical) listener(canonical);
    });
  }

  onReplayGap(listener: (gap: ReplayGap) => void): () => void {
    return this.rpc.onReplayGap(listener);
  }

  onConnectionState(listener: (state: "online" | "offline" | "unknown") => void): () => void {
    return this.rpc.onConnectionState(listener);
  }

  createSession(): Promise<AssistantSession> {
    return this.rpc.request<Record<string, unknown>>("session.create", {
      source: "ambient",
      close_on_disconnect: false
    }).then(result => ({
      runtimeSessionId: stringField(result, "session_id"),
      durableSessionId: stringField(result, "stored_session_id")
    }));
  }

  submitPrompt(runtimeSessionId: string, text: string): Promise<SubmitResult> {
    return this.rpc.request<Record<string, unknown>>("prompt.submit", { session_id: runtimeSessionId, text }).then(result => ({
      state: record(result).status === "streaming" ? "streaming" : "accepted"
    }));
  }

  steer(runtimeSessionId: string, text: string): Promise<SteerResult> {
    return this.rpc.request<Record<string, unknown>>("session.steer", { session_id: runtimeSessionId, text }).then(result => {
      const status = record(result).status;
      return { state: typeof status === "string" ? status : "accepted" };
    });
  }

  interrupt(runtimeSessionId: string): Promise<InterruptResult> {
    return this.rpc.request<Record<string, unknown>>("session.interrupt", { session_id: runtimeSessionId }).then(result => ({
      state: record(result).status === "interrupted" ? "interrupted" : "acknowledged"
    }));
  }

  respondToApproval(runtimeSessionId: string, requestId: string, choice: string): Promise<ApprovalResponse> {
    return this.rpc.request<Record<string, unknown>>("approval.respond", {
      session_id: runtimeSessionId, request_id: requestId, choice
    }).then(result => {
      const resolved = record(result).resolved;
      return { resolved: typeof resolved === "number" ? resolved : 0 };
    });
  }

  listSavedSessions(limit = 50): Promise<SavedSession[]> {
    return this.rpc.request("session.list", { limit }).then(value => sessionRows(value).map(row => ({
      id: stringField(row, "id"),
      ...(typeof row.title === "string" ? { title: row.title } : {}),
      ...(typeof row.preview === "string" ? { preview: row.preview } : {}),
      ...(typeof row.started_at === "number" ? { startedAt: row.started_at } : {}),
      ...(typeof row.message_count === "number" ? { messageCount: row.message_count } : {}),
      ...(typeof row.source === "string" ? { source: row.source } : {})
    })));
  }

  listActiveSessions(): Promise<ActiveSession[]> {
    return this.rpc.request("session.active_list").then(value => sessionRows(value).map(row => ({
      id: stringField(row, "id"),
      ...(typeof row.session_key === "string" ? { durableId: row.session_key } : {}),
      ...(typeof row.title === "string" ? { title: row.title } : {}),
      ...(typeof row.status === "string" ? { status: row.status } : {}),
      ...(typeof row.message_count === "number" ? { messageCount: row.message_count } : {}),
      ...(typeof row.preview === "string" ? { preview: row.preview } : {})
    })));
  }

  resumeSession(durableSessionId: string): Promise<AssistantSession> {
    return this.rpc.request<Record<string, unknown>>("session.resume", { session_id: durableSessionId }).then(result => ({
      runtimeSessionId: stringField(result, "session_id"),
      durableSessionId: typeof result.session_key === "string" && result.session_key
        ? result.session_key
        : typeof result.stored_session_id === "string" && result.stored_session_id
          ? result.stored_session_id
          : durableSessionId
    }));
  }

  getHistory(runtimeSessionId: string): Promise<Record<string, unknown>> {
    return this.rpc.request("session.history", { session_id: runtimeSessionId });
  }

  listPendingApprovals(runtimeSessionId: string): Promise<ApprovalPayload[]> {
    return this.rpc.request("approval.pending", { session_id: runtimeSessionId }).then(result => {
      const approvals = record(result).approvals;
      if (!Array.isArray(approvals)) throw new HermesRpcError("Hermes approval response is missing approvals");
      return approvals.map(record).flatMap(row => {
        const requestId = typeof row.request_id === "string" ? row.request_id
          : typeof row.requestId === "string" ? row.requestId : undefined;
        if (!requestId) return [];
        return [{
          requestId,
          command: typeof row.command === "string" ? row.command : "Approval requested",
          ...(typeof row.description === "string" ? { description: row.description } : {}),
          ...(Array.isArray(row.choices) ? { choices: row.choices.filter((c): c is string => typeof c === "string") } : {})
        }];
      });
    });
  }
}
