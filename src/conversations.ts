import { randomUUID } from "node:crypto";
import type { HermesActiveSession, HermesEvent, HermesReplayGap, HermesSavedSession, HermesSession } from "./hermes.js";
import type { AmbientStore, NewConversation } from "./store.js";
import type { Approval, Conversation, RunStatus, RunView, Runtime, RuntimeState } from "./types.js";

export type HermesConversationClient = {
  createSession(): Promise<HermesSession>;
  submitPrompt(runtimeSessionId: string, text: string): Promise<Record<string, unknown>>;
  steer(runtimeSessionId: string, text: string): Promise<Record<string, unknown>>;
  interrupt(runtimeSessionId: string): Promise<Record<string, unknown>>;
  respondToApproval(runtimeSessionId: string, requestId: string, choice: string): Promise<Record<string, unknown>>;
  resumeSession(durableSessionId: string): Promise<HermesSession>;
  listSavedSessions(limit?: number): Promise<HermesSavedSession[]>;
  listActiveSessions(): Promise<HermesActiveSession[]>;
  listPendingApprovals(runtimeSessionId: string): Promise<Record<string, unknown>[]>;
  onEvent(listener: (event: HermesEvent) => void): () => void;
  onConnectionState(listener: (state: RuntimeState) => void): () => void;
  onReplayGap(listener: (gap: HermesReplayGap) => void): () => void;
};

export type ConversationEngineOptions = {
  runtime: Runtime;
  now?: () => string;
  id?: () => string;
};

function value(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resultStatus(result: Record<string, unknown>): string | undefined {
  return value(result.status);
}

function eventText(event: HermesEvent): string | undefined {
  return value(event.payload.text) ?? value(event.payload.summary) ?? value(event.payload.message);
}

function terminal(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function makeConversation(
  runtimeId: string,
  session: HermesSession,
  now: string,
  id: string,
  title = "New Hermes conversation"
): NewConversation {
  return {
    id,
    runtimeId,
    durableSessionId: session.durableSessionId,
    title,
    liveSessionId: session.runtimeSessionId,
    selected: true,
    createdAt: now,
    updatedAt: now
  };
}

export class ConversationEngine {
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly unsubscribeEvent: () => void;
  private readonly unsubscribeState: () => void;
  private readonly unsubscribeReplayGap: () => void;
  private readonly approvalResponses = new Set<string>();
  private readonly replayGapSessions = new Set<string>();

  constructor(
    private readonly hermes: HermesConversationClient,
    private readonly store: AmbientStore,
    private readonly options: ConversationEngineOptions
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => randomUUID());
    this.store.upsertRuntime({ ...options.runtime, state: options.runtime.state ?? "unknown" });
    this.unsubscribeEvent = hermes.onEvent(event => {
      void this.applyEvent(event);
    });
    this.unsubscribeState = hermes.onConnectionState(state => {
      if (state === "offline") this.store.markActiveRunsUnknown(this.options.runtime.id, this.now());
      this.setRuntimeState(state === "online" ? "unknown" : state);
    });
    this.unsubscribeReplayGap = hermes.onReplayGap(gap => {
      const run = this.store.activeRunByLiveSession(this.options.runtime.id, gap.sessionId);
      if (run && !terminal(run.status)) {
        this.replayGapSessions.add(gap.sessionId);
        this.store.updateRun(run.id, {
          status: "unknown",
          progress: "Hermes replay history was truncated; the work outcome is unknown",
          updatedAt: this.now()
        });
      }
    }) ?? (() => undefined);
  }

  close(): void {
    this.unsubscribeEvent();
    this.unsubscribeState();
    this.unsubscribeReplayGap();
  }

  runtime(): Runtime {
    return this.store.runtime(this.options.runtime.id) ?? this.options.runtime;
  }

  setRuntimeState(state: RuntimeState): Runtime {
    const current = this.runtime();
    const next = { ...current, state, updatedAt: this.now() };
    this.store.upsertRuntime(next);
    return next;
  }

  async discover(): Promise<Conversation[]> {
    try {
      this.store.clearLiveSessionIds(this.options.runtime.id);
      const saved = await this.hermes.listSavedSessions(100);
      for (const session of saved) this.mergeSavedSession(session);
      const active = await this.hermes.listActiveSessions();
      for (const session of active) this.mergeActiveSession(session);
      const reconciliations = await Promise.allSettled(active.map(session => this.reconcilePendingApprovals(session.id)));
      this.setRuntimeState(reconciliations.some(result => result.status === "rejected") ? "unknown" : "online");
    } catch (error) {
      this.setRuntimeState("offline");
      throw error;
    }
    return this.store.listConversations(this.options.runtime.id);
  }

  listConversations(): Conversation[] {
    return this.store.listConversations(this.options.runtime.id);
  }

  listRuns(limit = 20): RunView[] {
    return this.store.listRuns(this.options.runtime.id, limit).map(item => this.store.view(item.id)!);
  }

  listApprovals(): Approval[] {
    return this.store.listApprovals(this.options.runtime.id);
  }

  async selectConversation(conversationId: string): Promise<Conversation> {
    const selected = this.store.conversation(conversationId);
    if (!selected || selected.runtimeId !== this.options.runtime.id) throw new Error("Conversation not found");
    return this.store.updateConversation(conversationId, { selected: true, updatedAt: this.now() });
  }

  async ask(text: string, conversationId?: string, newConversation = false): Promise<RunView> {
    const instruction = text.trim();
    if (!instruction) throw new Error("A Hermes instruction is required");
    const conversation = await this.ensureConversation(conversationId, newConversation);
    if (this.store.activeRunForConversation(this.options.runtime.id, conversation.id)) {
      throw new Error("This conversation already has active Hermes work");
    }
    const liveSessionId = await this.ensureLive(conversation);
    if (this.store.activeRunForConversation(this.options.runtime.id, conversation.id)) {
      throw new Error("This conversation already has active Hermes work");
    }
    const timestamp = this.now();
    const run = this.store.createRun({
      id: this.id(),
      conversationId: conversation.id,
      runtimeId: this.options.runtime.id,
      durableSessionId: conversation.durableSessionId,
      liveSessionId,
      instruction,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    try {
      const response = await this.hermes.submitPrompt(liveSessionId, instruction);
      const current = this.store.run(run.id)!;
      if (current.status === "queued") {
        this.store.updateRun(run.id, {
          status: resultStatus(response) === "streaming" ? "running" : "accepted",
          updatedAt: this.now()
        });
      }
      this.setRuntimeState("online");
    } catch (error) {
      this.store.updateRun(run.id, {
        status: "failed",
        failure: error instanceof Error ? error.message : String(error),
        updatedAt: this.now()
      });
      throw error;
    }
    return this.store.view(run.id)!;
  }

  getWork(runId: string): RunView {
    const run = this.store.view(runId);
    if (!run || run.runtimeId !== this.options.runtime.id) throw new Error("Work item not found");
    return run;
  }

  async steer(runId: string, instruction: string): Promise<RunView> {
    const run = this.getWork(runId);
    if (terminal(run.status)) throw new Error("Work is already finished");
    if (run.status === "unknown") throw new Error("Work outcome is unknown; wait for Hermes to reconnect before steering it");
    const text = instruction.trim();
    if (!text) throw new Error("A Hermes steering instruction is required");
    await this.hermes.steer(run.liveSessionId, text);
    if (run.status === "queued" || run.status === "accepted") {
      this.store.updateRun(run.id, { status: "running", updatedAt: this.now() });
    }
    return this.store.view(run.id)!;
  }

  async cancel(runId: string): Promise<RunView> {
    const run = this.getWork(runId);
    if (terminal(run.status)) return run;
    if (run.status === "unknown") throw new Error("Work outcome is unknown; wait for Hermes to reconnect before cancelling it");
    const response = await this.hermes.interrupt(run.liveSessionId);
    const status = resultStatus(response);
    this.store.updateRun(run.id, {
      status: status === "interrupted" ? "cancelled" : "cancel_requested",
      updatedAt: this.now()
    });
    if (status === "interrupted") this.store.resolveApprovalsForRun(run.id, this.now());
    return this.store.view(run.id)!;
  }

  async respondToApproval(approvalId: string, decision: "once" | "deny"): Promise<RunView> {
    const approval = this.store.approvalById(approvalId) ?? this.store.approvalForRuntime(this.options.runtime.id, approvalId);
    if (!approval || approval.runtimeId !== this.options.runtime.id || approval.resolvedAt) {
      throw new Error("Approval is no longer pending");
    }
    if (this.approvalResponses.has(approval.requestId)) throw new Error("Approval response is already in progress");
    const run = this.getWork(approval.runId);
    if (run.status === "unknown") throw new Error("Work outcome is unknown; wait for Hermes to reconnect before answering approval");
    this.approvalResponses.add(approval.requestId);
    try {
      const response = await this.hermes.respondToApproval(approval.liveSessionId, approval.requestId, decision);
      const resolved = response.resolved;
      if (typeof resolved !== "number" || resolved < 1) {
        throw new Error("Hermes did not accept the approval response");
      }
      this.store.resolveApprovalForRuntime(this.options.runtime.id, approval.requestId, this.now());
      this.store.updateRun(run.id, { status: "running", updatedAt: this.now() });
      return this.store.view(run.id)!;
    } finally {
      this.approvalResponses.delete(approval.requestId);
    }
  }

  async applyEvent(event: HermesEvent): Promise<void> {
    if (!event.sessionId) return;
    const run = this.store.activeRunByLiveSession(this.options.runtime.id, event.sessionId);
    if (!run || terminal(run.status)) return;
    if (event.type === "message.complete") this.replayGapSessions.delete(event.sessionId);
    const timestamp = this.now();
    if (event.type === "approval.request") {
      const requestId = value(event.payload.request_id);
      if (!requestId) {
        this.store.updateRun(run.id, { progress: "Hermes sent an approval without a request identity", updatedAt: timestamp });
        return;
      }
      const existing = this.store.approvalForRuntime(this.options.runtime.id, requestId);
      if (existing?.resolvedAt) return;
      const approval: Approval = {
        id: `${this.options.runtime.id}:${requestId}`,
        runId: run.id,
        runtimeId: this.options.runtime.id,
        durableSessionId: run.durableSessionId,
        liveSessionId: event.sessionId,
        requestId,
        command: value(event.payload.command) ?? "Hermes requested approval",
        ...(value(event.payload.description) ? { description: value(event.payload.description)! } : {}),
        choices: Array.isArray(event.payload.choices)
          ? event.payload.choices.filter((choice): choice is string => typeof choice === "string")
          : ["once", "deny"],
        createdAt: timestamp
      };
      this.store.createOrUpdateApproval(approval);
      this.store.updateRun(run.id, { status: "waiting_approval", progress: approval.description ?? approval.command, updatedAt: timestamp });
      return;
    }
    if (event.type === "message.complete") {
      const status = value(event.payload.status);
      const answer = eventText(event) ?? "Hermes completed the request";
      if (run.status === "cancel_requested") {
        this.store.updateRun(run.id, { status: "cancelled", answer, updatedAt: timestamp });
      } else if (status === "error" || value(event.payload.error)) {
        this.store.updateRun(run.id, { status: "failed", answer, failure: value(event.payload.error) ?? answer, updatedAt: timestamp });
      } else {
        this.store.updateRun(run.id, { status: "completed", answer, updatedAt: timestamp });
      }
      this.store.resolveApprovalsForRun(run.id, timestamp);
      return;
    }
    if (["message.start", "message.delta", "message.interim", "tool.start", "tool.complete", "status.update"].includes(event.type)) {
      const progress = eventText(event) ?? value(event.payload.name) ?? value(event.payload.kind);
      this.store.updateRun(run.id, {
        ...(run.status === "queued" || run.status === "accepted" ? { status: "running" as const } : {}),
        ...(progress ? { progress } : {}),
        updatedAt: timestamp
      });
    }
  }

  private async ensureConversation(conversationId: string | undefined, newConversation: boolean): Promise<Conversation> {
    if (conversationId) return this.requireConversation(conversationId);
    if (!newConversation) {
      const selected = this.store.selectedConversation(this.options.runtime.id);
      if (selected) return selected;
    }
    const session = await this.hermes.createSession();
    const timestamp = this.now();
    return this.store.createConversation(makeConversation(this.options.runtime.id, session, timestamp, this.id()));
  }

  private requireConversation(id: string): Conversation {
    const conversation = this.store.conversation(id);
    if (!conversation || conversation.runtimeId !== this.options.runtime.id) throw new Error("Conversation not found");
    return conversation;
  }

  private async ensureLive(conversation: Conversation): Promise<string> {
    if (conversation.liveSessionId) return conversation.liveSessionId;
    const resumed = await this.hermes.resumeSession(conversation.durableSessionId);
    this.store.updateConversation(conversation.id, {
      durableSessionId: resumed.durableSessionId,
      liveSessionId: resumed.runtimeSessionId,
      updatedAt: this.now()
    });
    await this.reconcilePendingApprovals(resumed.runtimeSessionId);
    return resumed.runtimeSessionId;
  }

  private async reconcilePendingApprovals(liveSessionId: string): Promise<void> {
    const pending = await this.hermes.listPendingApprovals(liveSessionId);
    const pendingIds = new Set<string>();
    for (const payload of pending) {
      const requestId = value(payload.request_id);
      if (!requestId) throw new Error("Hermes approval snapshot contains an approval without a request identity");
      pendingIds.add(requestId);
    }
    const timestamp = this.now();
    for (const approval of this.store.listApprovals(this.options.runtime.id)) {
      if (approval.liveSessionId !== liveSessionId || pendingIds.has(approval.requestId)) continue;
      this.store.resolveApprovalForRuntime(this.options.runtime.id, approval.requestId, timestamp);
      const run = this.store.run(approval.runId);
      if (run && !terminal(run.status)) {
        this.store.updateRun(run.id, {
          status: "unknown",
          progress: "Hermes resolved an approval outside Ambient; the work outcome is unknown",
          updatedAt: timestamp
        });
      }
    }
    if (pending.length > 0) this.replayGapSessions.delete(liveSessionId);
    for (const payload of pending) {
      await this.applyEvent({ type: "approval.request", sessionId: liveSessionId, payload });
    }
  }

  private mergeSavedSession(session: HermesSavedSession): void {
    const existing = this.store.conversationByDurable(this.options.runtime.id, session.id);
    const title = session.title ?? session.preview ?? "Hermes conversation";
    if (existing) {
      this.store.updateConversation(existing.id, { ...(title ? { title } : {}), updatedAt: this.now() });
      return;
    }
    const timestamp = this.now();
    this.store.createConversation({
      id: this.id(),
      runtimeId: this.options.runtime.id,
      durableSessionId: session.id,
      title,
      selected: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }

  private mergeActiveSession(session: HermesActiveSession): void {
    if (!session.session_key) return;
    const existing = this.store.conversationByDurable(this.options.runtime.id, session.session_key);
    const title = session.title ?? session.preview ?? "Active Hermes conversation";
    if (existing) {
      const timestamp = this.now();
      if (existing.liveSessionId && this.replayGapSessions.has(existing.liveSessionId)) {
        this.replayGapSessions.add(session.id);
      }
      this.store.updateConversation(existing.id, { liveSessionId: session.id, ...(title ? { title } : {}), updatedAt: timestamp });
      this.store.rebindActiveRuns(this.options.runtime.id, existing.id, session.id, timestamp);
      if ((session.status === "working" || session.status === "starting") && !this.replayGapSessions.has(session.id)) {
        this.store.markUnknownRunsRunning(this.options.runtime.id, existing.id, timestamp);
      }
      return;
    }
    const timestamp = this.now();
    this.store.createConversation({
      id: this.id(),
      runtimeId: this.options.runtime.id,
      durableSessionId: session.session_key,
      title,
      liveSessionId: session.id,
      selected: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }
}
