import { randomUUID } from "node:crypto";
import { contentText, jsonRequest } from "./http.js";
import { AssistantEvented, type AssistantClient, type AssistantSession, type RuntimeCapabilities } from "./types.js";

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
export class TownieClient extends AssistantEvented implements AssistantClient {
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

  constructor(private readonly options: TownieClientOptions) {
    super();
    const url = new URL(options.endpoint);
    this.runUrl = url.toString();
    this.meUrl = `${url.origin}/v1/me`;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
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
