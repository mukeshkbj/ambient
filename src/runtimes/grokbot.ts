import type { RuntimeState } from "../types.js";
import { contentText, firstString, jsonRequest, record } from "./http.js";
import type {
  ActiveSession,
  AssistantClient,
  AssistantEvent,
  AssistantSession,
  RuntimeCapabilities,
  SavedSession
} from "./types.js";

export type GrokBotClientOptions = {
  /** Base URL of the Grok Bot host gateway, e.g. http://127.0.0.1:1340. */
  endpoint: string;
  token?: string;
  pollMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type Watcher = {
  timer: NodeJS.Timeout;
  deadline: number;
  marker: string | undefined;
  buffer: string[];
  stablePolls: number;
};

const AGENT_BUSY = new Set(["running", "working", "busy", "thinking", "generating", "streaming"]);

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function entryKey(entry: Record<string, unknown>): string | undefined {
  const key = entry.seq ?? entry.id ?? entry.created_at ?? entry.createdAt ?? entry.ts ?? entry.timestamp;
  return typeof key === "number" || typeof key === "string" ? String(key) : undefined;
}

function entriesOf(payload: unknown): Record<string, unknown>[] {
  const row = record(payload);
  const list = row.entries ?? row.items ?? row.messages ?? row.transcript;
  return Array.isArray(list) ? list.map(record) : [];
}

function isAssistant(entry: Record<string, unknown>): boolean {
  const role = stringOf(entry.role ?? entry.author ?? entry.kind).toLowerCase();
  return role.includes("assistant") || role.includes("agent") || role === "bot";
}

function entryText(entry: Record<string, unknown>): string | undefined {
  return contentText(entry.text ?? entry.content ?? entry.body ?? entry.message);
}

/**
 * Grok Bot via the unofficial `sand` host gateway (`POST /api/<command>` with a
 * bearer token, normally on port 1340). Command names mirror the host's
 * SAND_GATEWAY_COMMANDS surface. There is no push channel here, so completion
 * is detected by polling the agent transcript until a new assistant entry
 * stabilizes or the agent goes idle. This gateway is private to the host —
 * expose it only over LAN/VPN/tunnel, never publicly.
 */
export class GrokBotClient implements AssistantClient {
  readonly capabilities: RuntimeCapabilities = {
    sessions: true,
    steer: true,
    cancel: true,
    approvals: false,
    resume: true,
    events: true,
    asyncClass: "async"
  };

  private readonly endpoint: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly watchers = new Map<string, Watcher>();
  private readonly eventListeners = new Set<(event: AssistantEvent) => void>();
  private readonly stateListeners = new Set<(state: RuntimeState) => void>();

  constructor(private readonly options: GrokBotClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.pollMs = options.pollMs ?? 2_000;
    this.timeoutMs = options.timeoutMs ?? 600_000;
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

  private command<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
    return jsonRequest(`${this.endpoint}/api/${name}`, {
      method: "POST",
      token: this.options.token,
      body,
      timeoutMs: 30_000,
      fetchImpl: this.fetchImpl
    }) as Promise<T>;
  }

  async ping(): Promise<void> {
    try {
      await jsonRequest(`${this.endpoint}/health`, { timeoutMs: 10_000, fetchImpl: this.fetchImpl });
    } catch {
      await this.command("getHostStatus");
    }
  }

  private async agentRows(): Promise<Record<string, unknown>[]> {
    const result = await this.command<unknown>("listAgents");
    const row = record(result);
    const list = row.agents ?? row.items ?? result;
    return Array.isArray(list) ? list.map(record) : [];
  }

  private agentId(row: Record<string, unknown>): string | undefined {
    return firstString(row, "id", "agentId", "agent_id");
  }

  async listSavedSessions(): Promise<SavedSession[]> {
    return (await this.agentRows()).flatMap(agent => {
      const id = this.agentId(agent);
      if (!id) return [];
      return [{
        id,
        ...(firstString(agent, "name", "title", "label") ? { title: firstString(agent, "name", "title", "label")! } : {}),
        ...(firstString(agent, "preview", "lastMessage") ? { preview: firstString(agent, "preview", "lastMessage")! } : {})
      }];
    });
  }

  async listActiveSessions(): Promise<ActiveSession[]> {
    return (await this.agentRows()).flatMap(agent => {
      const id = this.agentId(agent);
      const status = stringOf(agent.status ?? agent.state).toLowerCase();
      if (!id || !AGENT_BUSY.has(status)) return [];
      return [{
        id,
        session_key: id,
        status: "working",
        ...(firstString(agent, "name", "title", "label") ? { title: firstString(agent, "name", "title", "label")! } : {})
      }];
    });
  }

  async createSession(): Promise<AssistantSession> {
    const result = await this.command<unknown>("createAgent", {
      name: "Ambient session",
      description: "Created by Ambient"
    });
    const id = this.agentId(record(result)) ?? this.agentId(record(record(result).agent));
    if (!id) throw new Error("Grok Bot did not return an agent id");
    return { runtimeSessionId: id, durableSessionId: id };
  }

  async resumeSession(durableSessionId: string): Promise<AssistantSession> {
    const exists = (await this.agentRows()).some(agent => this.agentId(agent) === durableSessionId);
    if (!exists) throw new Error(`Grok Bot agent ${durableSessionId} no longer exists`);
    return { runtimeSessionId: durableSessionId, durableSessionId };
  }

  private async tail(agentId: string): Promise<Record<string, unknown>[]> {
    const result = await this.command<unknown>("getAgentTranscriptTail", { id: agentId, limit: 20 });
    return entriesOf(result);
  }

  async submitPrompt(runtimeSessionId: string, text: string): Promise<Record<string, unknown>> {
    const tail = await this.tail(runtimeSessionId).catch(() => [] as Record<string, unknown>[]);
    const marker = entryKey(tail[tail.length - 1] ?? {});
    await this.command("sendPrompt", { id: runtimeSessionId, prompt: text });
    this.emit({ type: "message.start", sessionId: runtimeSessionId, payload: { kind: "assistant" } });
    this.emitState("online");
    this.watch(runtimeSessionId, marker);
    return { status: "streaming" };
  }

  async steer(runtimeSessionId: string, text: string): Promise<Record<string, unknown>> {
    const tail = await this.tail(runtimeSessionId).catch(() => [] as Record<string, unknown>[]);
    const marker = entryKey(tail[tail.length - 1] ?? {});
    await this.command("sendPrompt", { id: runtimeSessionId, prompt: text });
    this.watch(runtimeSessionId, marker);
    return { status: "streaming" };
  }

  async interrupt(runtimeSessionId: string): Promise<Record<string, unknown>> {
    await this.command("interruptAgentRun", { id: runtimeSessionId });
    this.stopWatch(runtimeSessionId);
    this.emit({ type: "message.complete", sessionId: runtimeSessionId, payload: { text: "Interrupted", status: "cancelled" } });
    return { status: "interrupted" };
  }

  private stopWatch(sessionId: string): void {
    const watcher = this.watchers.get(sessionId);
    if (watcher) clearInterval(watcher.timer);
    this.watchers.delete(sessionId);
  }

  private watch(sessionId: string, marker: string | undefined): void {
    if (this.watchers.has(sessionId)) {
      const existing = this.watchers.get(sessionId)!;
      existing.marker = marker;
      return;
    }
    const watcher: Watcher = {
      deadline: Date.now() + this.timeoutMs,
      marker,
      buffer: [],
      stablePolls: 0,
      timer: setInterval(() => void this.poll(sessionId), this.pollMs)
    };
    watcher.timer.unref();
    this.watchers.set(sessionId, watcher);
  }

  private async poll(sessionId: string): Promise<void> {
    const watcher = this.watchers.get(sessionId);
    if (!watcher) return;
    try {
      const entries = await this.tail(sessionId);
      // If the marker is absent from this tail the window rotated — treat the
      // current tail as fresh rather than waiting forever.
      let seen = watcher.marker === undefined || !entries.some(entry => entryKey(entry) === watcher.marker);
      const fresh: string[] = [];
      for (const entry of entries) {
        const key = entryKey(entry);
        if (!seen) {
          if (key === watcher.marker) seen = true;
          continue;
        }
        if (key !== undefined) watcher.marker = key;
        if (isAssistant(entry)) {
          const text = entryText(entry);
          if (text) fresh.push(text);
        }
      }
      if (fresh.length > 0) {
        watcher.buffer.push(...fresh);
        watcher.stablePolls = 0;
      } else if (watcher.buffer.length > 0) {
        watcher.stablePolls += 1;
      }
      const idle = await this.agentIdle(sessionId).catch(() => false);
      if ((idle && watcher.buffer.length > 0) || watcher.stablePolls >= 3) {
        this.finish(sessionId, watcher.buffer.join("\n\n"));
      } else if (Date.now() > watcher.deadline) {
        this.finish(sessionId, undefined, "Grok Bot did not produce a reply before the timeout; the outcome is unknown");
      }
    } catch {
      // transient poll failure — the next tick retries until the deadline
      if (Date.now() > watcher.deadline) {
        this.finish(sessionId, undefined, "Lost contact with the Grok Bot gateway; the outcome is unknown");
      }
    }
  }

  private async agentIdle(sessionId: string): Promise<boolean> {
    const rows = await this.agentRows();
    const agent = rows.find(row => this.agentId(row) === sessionId);
    if (!agent) return false;
    const status = stringOf(agent.status ?? agent.state ?? agent.runStatus).toLowerCase();
    return status.length > 0 && !AGENT_BUSY.has(status);
  }

  private finish(sessionId: string, text: string | undefined, error?: string): void {
    this.stopWatch(sessionId);
    this.emit({
      type: "message.complete",
      sessionId,
      payload: error
        ? { status: "error", error, text: error }
        : { status: "ok", text: text ?? "Grok Bot completed the request" }
    });
  }

  async close(): Promise<void> {
    for (const sessionId of [...this.watchers.keys()]) this.stopWatch(sessionId);
  }
}
