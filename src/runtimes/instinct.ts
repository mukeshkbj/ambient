import { randomUUID } from "node:crypto";
import type { RuntimeState } from "../types.js";
import { jsonRequest, record } from "./http.js";
import type { AssistantClient, AssistantEvent, AssistantSession, RuntimeCapabilities } from "./types.js";

export type InstinctClientOptions = {
  /** The assistant's documented email address, e.g. <you>@mail.instinct.com. */
  to: string;
  /** Google OAuth access token with gmail.send + gmail.readonly scope. */
  token?: string;
  /** Gmail API base. */
  gmailEndpoint?: string;
  pollMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type Pending = {
  timer: NodeJS.Timeout;
  deadline: number;
  sentAt: number;
};

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBody(payload: Record<string, unknown>): string | undefined {
  const data = record(payload.body).data;
  if (typeof data === "string" && data) return Buffer.from(data, "base64url").toString("utf8");
  const parts = payload.parts;
  if (Array.isArray(parts)) {
    const plain = parts.map(record).find(part => record(part).mimeType === "text/plain") ?? parts.map(record)[0];
    if (plain) return decodeBody(plain);
  }
  return undefined;
}

/**
 * Instinct via its documented email channel: each request is emailed to the
 * assistant's @mail.instinct.com address and the run completes when a reply
 * lands in the owner's Gmail. Correlation is a `[ambient:<sessionId>]` subject
 * tag; one active run per conversation is enforced by the engine. Replies can
 * take minutes — this is an asynchronous surface, not realtime.
 */
export class InstinctClient implements AssistantClient {
  readonly capabilities: RuntimeCapabilities = {
    sessions: false,
    steer: false,
    cancel: false,
    approvals: false,
    resume: false,
    events: true,
    asyncClass: "async"
  };

  private readonly gmail: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly pending = new Map<string, Pending>();
  private readonly eventListeners = new Set<(event: AssistantEvent) => void>();
  private readonly stateListeners = new Set<(state: RuntimeState) => void>();

  constructor(private readonly options: InstinctClientOptions) {
    this.gmail = (options.gmailEndpoint ?? "https://gmail.googleapis.com/gmail/v1").replace(/\/$/, "");
    this.pollMs = options.pollMs ?? 15_000;
    this.timeoutMs = options.timeoutMs ?? 30 * 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private emit(event: AssistantEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private emitState(state: RuntimeState): void {
    for (const listener of this.stateListeners) listener(state);
  }

  onEvent(listener: (event: AssistantEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onConnectionState(listener: (state: RuntimeState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private gmailRequest<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    return jsonRequest(`${this.gmail}${path}`, {
      method: body === undefined ? "GET" : "POST",
      token: this.options.token,
      ...(body === undefined ? {} : { body }),
      timeoutMs: 30_000,
      fetchImpl: this.fetchImpl
    }) as Promise<T>;
  }

  async ping(): Promise<void> {
    await this.gmailRequest("/users/me/profile");
  }

  createSession(): Promise<AssistantSession> {
    const id = `inst-${randomUUID()}`;
    return Promise.resolve({ runtimeSessionId: id, durableSessionId: id });
  }

  async submitPrompt(runtimeSessionId: string, text: string): Promise<Record<string, unknown>> {
    const tag = `ambient:${runtimeSessionId}`;
    const raw = [
      `To: ${this.options.to}`,
      `Subject: Ambient request [${tag}]`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      text,
      "",
      `[${tag}]`
    ].join("\r\n");
    await this.gmailRequest("/users/me/messages/send", { raw: base64url(raw) });
    this.emit({
      type: "message.start",
      sessionId: runtimeSessionId,
      payload: { kind: "email", text: `Emailed ${this.options.to}; waiting for a reply` }
    });
    this.emitState("online");
    this.watch(runtimeSessionId);
    return { status: "accepted" };
  }

  private watch(sessionId: string): void {
    this.stopWatch(sessionId);
    const pending: Pending = {
      deadline: Date.now() + this.timeoutMs,
      sentAt: Date.now(),
      timer: setInterval(() => void this.poll(sessionId), this.pollMs)
    };
    pending.timer.unref();
    this.pending.set(sessionId, pending);
  }

  private stopWatch(sessionId: string): void {
    const pending = this.pending.get(sessionId);
    if (pending) clearInterval(pending.timer);
    this.pending.delete(sessionId);
  }

  private async poll(sessionId: string): Promise<void> {
    const pending = this.pending.get(sessionId);
    if (!pending) return;
    try {
      const list = await this.gmailRequest<unknown>(
        `/users/me/messages?q=${encodeURIComponent(`from:${this.options.to}`)}&maxResults=10`
      );
      const messages = record(list).messages;
      if (Array.isArray(messages)) {
        for (const stub of messages.map(record)) {
          const id = typeof stub.id === "string" ? stub.id : undefined;
          if (!id) continue;
          const message = record(await this.gmailRequest<unknown>(`/users/me/messages/${encodeURIComponent(id)}?format=full`));
          const internalDate = Number(message.internalDate ?? 0);
          const mime = record(message.payload).mimeType;
          const haystack = `${typeof mime === "string" ? mime : ""} ${typeof message.snippet === "string" ? message.snippet : ""}`;
          const body = decodeBody(record(message.payload)) ?? "";
          if (internalDate <= pending.sentAt - 60_000) continue;
          if (!haystack.includes(`ambient:${sessionId}`) && !body.includes(`ambient:${sessionId}`)) continue;
          const text = (body || (typeof message.snippet === "string" ? message.snippet : "")).trim();
          this.finish(sessionId, text || "Instinct replied");
          return;
        }
      }
    } catch {
      // transient poll failure — retry next tick until the deadline
    }
    if (Date.now() > pending.deadline) {
      this.finish(sessionId, undefined, `No reply from ${this.options.to} before the timeout; the outcome is unknown`);
    }
  }

  private finish(sessionId: string, text?: string, error?: string): void {
    this.stopWatch(sessionId);
    this.emit({
      type: "message.complete",
      sessionId,
      payload: error
        ? { status: "error", error, text: error }
        : { status: "ok", text: text ?? "Instinct replied" }
    });
  }

  async close(): Promise<void> {
    for (const sessionId of [...this.pending.keys()]) this.stopWatch(sessionId);
  }
}
