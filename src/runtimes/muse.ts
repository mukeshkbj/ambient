import { randomUUID } from "node:crypto";
import { contentText, jsonRequest, record } from "./http.js";
import { AssistantEvented, type AssistantClient, type AssistantSession, type RuntimeCapabilities } from "./types.js";

type ChatMessage = { role: "user" | "assistant"; content: string };

export type MuseClientOptions = {
  endpoint?: string;
  token?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Muse Spark via the Meta Model API (api.meta.ai/v1, OpenAI-compatible).
 * This is the model behind the consumer Muse assistant — not the consumer
 * secure-VM product itself, which has no public API. Sessions are in-memory
 * conversation threads; they survive an Ambient restart as empty threads.
 */
export class MuseClient extends AssistantEvented implements AssistantClient {
  /** Threads live in process memory; a restart must re-bind via resumeSession. */
  readonly ephemeralSessions = true;

  readonly capabilities: RuntimeCapabilities = {
    sessions: true,
    steer: false,
    cancel: true,
    approvals: false,
    resume: true,
    events: true,
    asyncClass: "realtime"
  };

  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sessions = new Map<string, ChatMessage[]>();
  private readonly inflight = new Map<string, AbortController>();

  constructor(private readonly options: MuseClientOptions) {
    super();
    this.endpoint = (options.endpoint ?? "https://api.meta.ai/v1").replace(/\/$/, "");
    this.model = options.model ?? "muse-spark-1.1";
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async ping(): Promise<void> {
    await jsonRequest(`${this.endpoint}/models`, {
      token: this.options.token,
      timeoutMs: 15_000,
      fetchImpl: this.fetchImpl
    });
  }

  createSession(): Promise<AssistantSession> {
    const id = `muse-${randomUUID()}`;
    this.sessions.set(id, []);
    return Promise.resolve({ runtimeSessionId: id, durableSessionId: id });
  }

  resumeSession(durableSessionId: string): Promise<AssistantSession> {
    // The remote side is stateless; a restarted Ambient keeps the thread label
    // but the earlier transcript is gone.
    if (!this.sessions.has(durableSessionId)) this.sessions.set(durableSessionId, []);
    return Promise.resolve({ runtimeSessionId: durableSessionId, durableSessionId });
  }

  async submitPrompt(runtimeSessionId: string, text: string): Promise<Record<string, unknown>> {
    const messages = this.sessions.get(runtimeSessionId);
    if (!messages) throw new Error(`Unknown Muse session ${runtimeSessionId}`);
    messages.push({ role: "user", content: text });
    const controller = new AbortController();
    this.inflight.set(runtimeSessionId, controller);
    this.emit({ type: "message.start", sessionId: runtimeSessionId, payload: { kind: "assistant" } });
    try {
      const result = await jsonRequest(`${this.endpoint}/chat/completions`, {
        method: "POST",
        token: this.options.token,
        body: { model: this.model, messages },
        timeoutMs: this.timeoutMs,
        signal: controller.signal,
        fetchImpl: this.fetchImpl
      });
      const reply = this.extractReply(result);
      if (reply) messages.push({ role: "assistant", content: reply });
      this.emit({
        type: "message.complete",
        sessionId: runtimeSessionId,
        payload: reply ? { text: reply, status: "ok" } : { status: "error", error: "Muse returned an empty reply" }
      });
      this.emitState("online");
      return { status: "streaming" };
    } catch (error) {
      // An abort means engine.cancel already marked the run cancelled —
      // don't overwrite it with a failure or flag the runtime offline.
      if (controller.signal.aborted) return { status: "cancelled" };
      this.emitState("offline");
      throw error;
    } finally {
      this.inflight.delete(runtimeSessionId);
    }
  }

  private extractReply(result: unknown): string | undefined {
    const choices = record(result).choices;
    if (!Array.isArray(choices) || choices.length === 0) return undefined;
    const message = record(choices[0]).message;
    return contentText(record(message).content ?? message);
  }

  interrupt(runtimeSessionId: string): Promise<Record<string, unknown>> {
    this.inflight.get(runtimeSessionId)?.abort();
    return Promise.resolve({ status: "interrupted" });
  }

  async close(): Promise<void> {
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
  }
}
