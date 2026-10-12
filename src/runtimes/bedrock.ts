import { randomUUID } from "node:crypto";
import type { AmbientStore } from "../store.js";
import { defaultTools, type AgentTool, type ToolInput } from "./bedrock-tools.js";
import {
  AssistantEvented,
  type ActiveSession,
  type ApprovalPayload,
  type ApprovalResponse,
  type AssistantClient,
  type AssistantSession,
  type InterruptResult,
  type RuntimeCapabilities,
  type SavedSession,
  type SteerResult,
  type SubmitResult
} from "./types.js";

const DEFAULT_MODEL = "us.amazon.nova-lite-v1:0";
const DEFAULT_REGION = "us-east-1";

const SYSTEM_PROMPT = [
  "You are a household agent supervised by Ambient, a voice-first gateway.",
  "Reply in plain sentences that can be read aloud: no ids, no markdown, no lists longer than three items.",
  "Use the tools when they help. Tools that change things — bookings, calendar writes — pause for the user's approval; never claim one succeeded unless its tool result says so.",
  "If a tool result says it was denied, say it was not done and stop.",
  "Keep answers under three sentences unless the user asks for more."
].join(" ");

export type ConverseToolUse = { toolUseId: string; name: string; input: ToolInput };
type ConverseToolResult = { toolUseId: string; content: { text: string }[]; status?: "success" | "error" };
export type ConverseContent = { text?: string; toolUse?: ConverseToolUse; toolResult?: ConverseToolResult };
export type ConverseMessage = { role: "user" | "assistant"; content: ConverseContent[] };

export type ConverseInput = {
  modelId: string;
  system?: { text: string }[];
  messages: ConverseMessage[];
  toolConfig?: { tools: { toolSpec: { name: string; description: string; inputSchema: { json: unknown } } }[] };
};

export type ConverseOutput = {
  stopReason?: string;
  output?: { message?: ConverseMessage };
};

export type ConverseSender = (input: ConverseInput, signal: AbortSignal) => Promise<ConverseOutput>;

type BedrockSdk = typeof import("@aws-sdk/client-bedrock-runtime");

export type BedrockClientOptions = {
  /** Store/runtime wiring for transcript persistence. */
  runtimeId?: string;
  store?: AmbientStore;
  /** Converse model id or inference profile, e.g. us.amazon.nova-lite-v1:0. */
  model?: string;
  region?: string;
  /** Where file-backed tools (calendar) keep state. */
  dataDir?: string;
  /** Hard cap on consecutive model turns in one run. */
  maxTurns?: number;
  tools?: AgentTool[];
  env?: Record<string, string | undefined>;
  /** Inject the Converse call in tests; the real client is used otherwise. */
  send?: ConverseSender;
};

type PendingApproval = {
  requestId: string;
  command: string;
  description: string;
  resolve(choice: "once" | "deny"): void;
};

type BedrockSession = {
  liveId: string;
  durableId: string;
  title: string;
  messages: ConverseMessage[];
  working: boolean;
  aborted: boolean;
  abort: AbortController;
  steerQueue: string[];
  pending?: PendingApproval | undefined;
};

function shortTitle(text: string): string {
  const title = text.split(/\s+/).filter(Boolean).slice(0, 8).join(" ");
  return title || "Bedrock conversation";
}

function messageText(message: ConverseMessage): string {
  return message.content.map(block => block.text ?? "").filter(text => text.trim()).join("\n").trim();
}

function toolResultBlock(toolUseId: string, text: string, status: "success" | "error"): ConverseContent {
  return { toolResult: { toolUseId, content: [{ text }], status } };
}

/**
 * A real agent runtime on Amazon Bedrock. The Converse tool-use loop runs
 * in-process: each model turn may request tool calls, approval-gated tools
 * pause the loop on an `approval.request` event, and `respondToApproval`
 * resumes it. Transcripts persist per durable session so restarts keep
 * context (an in-flight approval is itself unrecoverable — the engine marks
 * such runs unknown, which is the honest answer).
 */
export class BedrockClient extends AssistantEvented implements AssistantClient {
  readonly capabilities: RuntimeCapabilities = {
    sessions: true,
    steer: true,
    cancel: true,
    approvals: true,
    resume: true,
    events: true,
    asyncClass: "realtime"
  };

  /** Live session handles die with the process; durable ids survive via transcripts. */
  readonly ephemeralSessions = true;

  private readonly model: string;
  private readonly region: string;
  private readonly dataDir: string;
  private readonly maxTurns: number;
  private readonly tools: Map<string, AgentTool>;
  private readonly sessions = new Map<string, BedrockSession>();
  private sdkPromise?: Promise<BedrockSdk>;
  private clientPromise?: Promise<InstanceType<BedrockSdk["BedrockRuntimeClient"]>>;

  constructor(private readonly options: BedrockClientOptions = {}) {
    super();
    const env = options.env ?? process.env;
    this.model = options.model ?? DEFAULT_MODEL;
    this.region = options.region ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? DEFAULT_REGION;
    this.dataDir = options.dataDir ?? ".ambient";
    this.maxTurns = options.maxTurns ?? 12;
    this.tools = new Map((options.tools ?? defaultTools()).map(tool => [tool.name, tool]));
  }

  async ping(): Promise<void> {
    if (this.options.send) {
      this.emitState("online");
      return;
    }
    // Honest liveness: the runtime is online only when AWS credentials resolve.
    const client = await this.client();
    const credentials = (client as { config?: { credentials?: unknown } }).config?.credentials;
    if (typeof credentials === "function") await (credentials as () => Promise<unknown>)();
    this.emitState("online");
  }

  createSession(): Promise<AssistantSession> {
    const session = this.newSession(`bedrock-${randomUUID()}`);
    return Promise.resolve({ runtimeSessionId: session.liveId, durableSessionId: session.durableId });
  }

  resumeSession(durableSessionId: string): Promise<AssistantSession> {
    const existing = [...this.sessions.values()].find(session => session.durableId === durableSessionId);
    if (existing) {
      return Promise.resolve({ runtimeSessionId: existing.liveId, durableSessionId: existing.durableId });
    }
    const session = this.newSession(durableSessionId);
    session.messages = this.loadTranscript(durableSessionId);
    if (session.messages.length > 0) session.title = "Resumed conversation";
    return Promise.resolve({ runtimeSessionId: session.liveId, durableSessionId: session.durableId });
  }

  listSavedSessions(limit = 50): Promise<SavedSession[]> {
    const seen = new Set<string>();
    const saved: SavedSession[] = [];
    const durableIds = this.options.store && this.options.runtimeId
      ? this.options.store.listTranscriptSessions(this.options.runtimeId)
      : [];
    for (const durableId of durableIds) {
      seen.add(durableId);
      const transcript = this.options.store!.transcript(this.options.runtimeId!, durableId);
      const firstUser = transcript
        .map(entry => this.parseMessage(entry.json))
        .find(message => message?.role === "user");
      saved.push({
        id: durableId,
        title: firstUser ? shortTitle(messageText(firstUser)) : "Bedrock conversation",
        source: "bedrock"
      });
      if (saved.length >= limit) break;
    }
    for (const session of this.sessions.values()) {
      if (seen.has(session.durableId) || saved.length >= limit) continue;
      saved.push({ id: session.durableId, title: session.title, source: "bedrock" });
    }
    return Promise.resolve(saved);
  }

  listActiveSessions(): Promise<ActiveSession[]> {
    return Promise.resolve([...this.sessions.values()]
      .filter(session => session.working)
      .map(session => ({ id: session.liveId, durableId: session.durableId, status: "working", title: session.title })));
  }

  listPendingApprovals(runtimeSessionId: string): Promise<ApprovalPayload[]> {
    const pending = this.sessions.get(runtimeSessionId)?.pending;
    return Promise.resolve(pending
      ? [{ requestId: pending.requestId, command: pending.command, description: pending.description, choices: ["once", "deny"] }]
      : []);
  }

  submitPrompt(runtimeSessionId: string, text: string): Promise<SubmitResult> {
    const session = this.require(runtimeSessionId);
    if (session.working) throw new Error("This Bedrock session already has active work");
    session.working = true;
    session.aborted = false;
    session.abort = new AbortController();
    session.title = shortTitle(text);
    const steered = session.steerQueue.splice(0).map(queued => ({ text: queued }));
    this.pushMessage(session, { role: "user", content: [...steered, { text }] });
    this.emit({ type: "message.start", sessionId: session.liveId, payload: { kind: "assistant" } });
    void this.runLoop(session);
    return Promise.resolve({ state: "streaming" });
  }

  steer(runtimeSessionId: string, text: string): Promise<SteerResult> {
    const session = this.require(runtimeSessionId);
    session.steerQueue.push(text);
    this.emit({ type: "status.update", sessionId: session.liveId, payload: { text: `Noted — adjusting for: ${text}` } });
    return Promise.resolve({ state: "queued" });
  }

  interrupt(runtimeSessionId: string): Promise<InterruptResult> {
    const session = this.sessions.get(runtimeSessionId);
    if (session) {
      session.aborted = true;
      session.pending?.resolve("deny");
      session.pending = undefined;
      session.abort.abort();
    }
    return Promise.resolve({ state: "interrupted" });
  }

  respondToApproval(runtimeSessionId: string, requestId: string, choice: string): Promise<ApprovalResponse> {
    const pending = this.sessions.get(runtimeSessionId)?.pending;
    if (!pending || pending.requestId !== requestId) return Promise.resolve({ resolved: 0 });
    pending.resolve(choice === "deny" ? "deny" : "once");
    return Promise.resolve({ resolved: 1 });
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.aborted = true;
      session.pending?.resolve("deny");
      session.abort.abort();
    }
  }

  private sdk(): Promise<BedrockSdk> {
    this.sdkPromise ??= import("@aws-sdk/client-bedrock-runtime");
    return this.sdkPromise;
  }

  private client(): Promise<InstanceType<BedrockSdk["BedrockRuntimeClient"]>> {
    this.clientPromise ??= this.sdk().then(mod => new mod.BedrockRuntimeClient({ region: this.region }));
    return this.clientPromise;
  }

  private async send(input: ConverseInput, signal: AbortSignal): Promise<ConverseOutput> {
    if (this.options.send) return this.options.send(input, signal);
    const [mod, client] = await Promise.all([this.sdk(), this.client()]);
    const command = new mod.ConverseCommand(input as ConstructorParameters<typeof mod.ConverseCommand>[0]);
    return client.send(command, { abortSignal: signal }) as Promise<ConverseOutput>;
  }

  private newSession(durableId: string): BedrockSession {
    const session: BedrockSession = {
      liveId: `live-${randomUUID()}`,
      durableId,
      title: "Bedrock conversation",
      messages: [],
      working: false,
      aborted: false,
      abort: new AbortController(),
      steerQueue: []
    };
    this.sessions.set(session.liveId, session);
    return session;
  }

  private require(liveId: string): BedrockSession {
    const session = this.sessions.get(liveId);
    if (!session) throw new Error(`Unknown Bedrock session ${liveId}`);
    return session;
  }

  private pushMessage(session: BedrockSession, message: ConverseMessage): void {
    session.messages.push(message);
    if (this.options.store && this.options.runtimeId) {
      this.options.store.appendTranscript(this.options.runtimeId, session.durableId, message.role, JSON.stringify(message));
    }
  }

  private parseMessage(json: string): ConverseMessage | undefined {
    try {
      const parsed = JSON.parse(json) as ConverseMessage;
      return parsed && (parsed.role === "user" || parsed.role === "assistant") && Array.isArray(parsed.content) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private loadTranscript(durableId: string): ConverseMessage[] {
    if (!this.options.store || !this.options.runtimeId) return [];
    const messages = this.options.store
      .transcript(this.options.runtimeId, durableId)
      .flatMap(entry => {
        const message = this.parseMessage(entry.json);
        return message ? [message] : [];
      });
    // Converse requires alternating roles starting with user. If a restart cut
    // a turn short — an assistant toolUse with no matching toolResult — close
    // out those calls honestly so the resumed transcript stays valid.
    const pendingUses = new Map<string, string>();
    for (const message of messages) {
      for (const block of message.content) {
        if (block.toolUse) pendingUses.set(block.toolUse.toolUseId, block.toolUse.name);
        if (block.toolResult) pendingUses.delete(block.toolResult.toolUseId);
      }
    }
    if (pendingUses.size > 0) {
      messages.push({
        role: "user",
        content: [...pendingUses.entries()].map(([toolUseId, name]) =>
          toolResultBlock(toolUseId, `Ambient restarted before "${name}" finished; its result is unknown. Do not claim it succeeded.`, "error"))
      });
    }
    return messages;
  }

  private requestFor(session: BedrockSession): ConverseInput {
    return {
      modelId: this.model,
      system: [{ text: SYSTEM_PROMPT }],
      messages: [...session.messages],
      toolConfig: {
        tools: [...this.tools.values()].map(tool => ({
          toolSpec: { name: tool.name, description: tool.description, inputSchema: { json: tool.inputSchema } }
        }))
      }
    };
  }

  private finish(session: BedrockSession, payload: { text?: string; status?: string; error?: string }): void {
    session.working = false;
    session.pending = undefined;
    this.emit({ type: "message.complete", sessionId: session.liveId, payload });
  }

  private async awaitApproval(session: BedrockSession, tool: AgentTool, call: ConverseToolUse): Promise<"once" | "deny"> {
    const described = tool.describe?.(call.input ?? {}) ?? { command: `Run ${tool.name}`, description: `Run ${tool.name}.` };
    const choice = await new Promise<"once" | "deny">(resolve => {
      session.pending = { requestId: call.toolUseId, command: described.command, description: described.description, resolve };
      this.emit({
        type: "approval.request",
        sessionId: session.liveId,
        payload: {
          requestId: call.toolUseId,
          command: described.command,
          description: described.description,
          choices: ["once", "deny"]
        }
      });
    });
    session.pending = undefined;
    return choice;
  }

  private async runTool(session: BedrockSession, tool: AgentTool, call: ConverseToolUse): Promise<ConverseContent> {
    try {
      const text = await tool.run(call.input ?? {}, { dataDir: this.dataDir });
      return toolResultBlock(call.toolUseId, text, "success");
    } catch (error) {
      return toolResultBlock(call.toolUseId, error instanceof Error ? error.message : String(error), "error");
    }
  }

  private async runLoop(session: BedrockSession): Promise<void> {
    try {
      for (let turn = 0; turn < this.maxTurns; turn++) {
        if (session.aborted) return this.finish(session, { status: "cancelled", text: "Stopped." });
        const response = await this.send(this.requestFor(session), session.abort.signal);
        const message = response.output?.message;
        if (!message || !Array.isArray(message.content)) throw new Error("Bedrock returned an empty response");
        this.pushMessage(session, message);
        if (session.aborted) return this.finish(session, { status: "cancelled", text: "Stopped." });
        const calls = message.content.flatMap(block => block.toolUse ? [block.toolUse] : []);
        if (response.stopReason !== "tool_use" || calls.length === 0) {
          return this.finish(session, { status: "ok", text: messageText(message) || "Done." });
        }
        const results: ConverseContent[] = [];
        for (const call of calls) {
          if (session.aborted) return this.finish(session, { status: "cancelled", text: "Stopped." });
          const tool = this.tools.get(call.name);
          this.emit({ type: "tool.start", sessionId: session.liveId, payload: { name: call.name } });
          try {
            if (!tool) {
              results.push(toolResultBlock(call.toolUseId, `Unknown tool "${call.name}"`, "error"));
            } else if (tool.requiresApproval) {
              const choice = await this.awaitApproval(session, tool, call);
              results.push(choice === "once"
                ? await this.runTool(session, tool, call)
                : toolResultBlock(call.toolUseId, "The user denied this action. It was not performed — say so and do not retry it.", "error"));
            } else {
              results.push(await this.runTool(session, tool, call));
            }
          } finally {
            this.emit({ type: "tool.complete", sessionId: session.liveId, payload: { name: call.name } });
          }
        }
        // Steer text shares the tool-result turn so messages stay alternating.
        for (const steered of session.steerQueue.splice(0)) results.push({ text: steered });
        this.pushMessage(session, { role: "user", content: results });
      }
      this.finish(session, {
        status: "error",
        error: `Stopped after ${this.maxTurns} model turns without a final answer`,
        text: `I stopped after ${this.maxTurns} steps without finishing.`
      });
    } catch (error) {
      if (session.aborted) return this.finish(session, { status: "cancelled", text: "Stopped." });
      const message = error instanceof Error ? error.message : String(error);
      this.finish(session, { status: "error", error: message, text: `Something went wrong: ${message}` });
    }
  }
}
