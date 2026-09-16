import { randomUUID } from "node:crypto";
import type { RuntimeState } from "../types.js";
import { contentText, jsonRequest } from "./http.js";
import type { AssistantClient, AssistantEvent, AssistantSession, RuntimeCapabilities } from "./types.js";

export type TownieClientOptions = {
  /** Full val run URL, e.g. https://api.val.town/v1/run/<user>.<valname>. */
  endpoint: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Val Town adapter. The first-party Townie chat surface has no public API, so
 * this drives a deployed val through the documented `POST /v1/run/{val}` API.
 * The val receives one argument: `{ prompt }`. Point it at a Townie-based val
 * (townie.val.run is open source) or any prompt-accepting val. Each call is
 * stateless — Ambient conversations here are grouping labels only.
 */
export class TownieClient implements AssistantClient {
  readonly capabilities: RuntimeCapabilities = {
    sessions: false,
    steer: false,
    cancel: false,
    approvals: false,
    resume: false,
    events: true,
    asyncClass: "realtime"
  };

  private readonly runUrl: string;
  private readonly meUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly eventListeners = new Set<(event: AssistantEvent) => void>();
  private readonly stateListeners = new Set<(state: RuntimeState) => void>();

  constructor(private readonly options: TownieClientOptions) {
    const url = new URL(options.endpoint);
    this.runUrl = url.toString();
    this.meUrl = `${url.origin}/v1/me`;
    this.timeoutMs = options.timeoutMs ?? 120_000;
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

  async ping(): Promise<void> {
    await jsonRequest(this.meUrl, {
      token: this.options.token,
      timeoutMs: 15_000,
      fetchImpl: this.fetchImpl
    });
  }

  createSession(): Promise<AssistantSession> {
    const id = `townie-${randomUUID()}`;
    return Promise.resolve({ runtimeSessionId: id, durableSessionId: id });
  }

  async submitPrompt(runtimeSessionId: string, text: string): Promise<Record<string, unknown>> {
    this.emit({ type: "message.start", sessionId: runtimeSessionId, payload: { kind: "assistant" } });
    try {
      const result = await jsonRequest(this.runUrl, {
        method: "POST",
        token: this.options.token,
        body: [{ prompt: text }],
        timeoutMs: this.timeoutMs,
        fetchImpl: this.fetchImpl
      });
      const reply = contentText(result) ?? JSON.stringify(result);
      this.emit({ type: "message.complete", sessionId: runtimeSessionId, payload: { text: reply, status: "ok" } });
      this.emitState("online");
      return { status: "streaming" };
    } catch (error) {
      this.emitState("offline");
      throw error;
    }
  }
}
