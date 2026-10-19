import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  ActiveSession,
  AssistantClient,
  AssistantEvent,
  AssistantSession,
  RuntimeCapabilities,
  SavedSession
} from "./runtimes/types.js";
import type { AmbientStore, NewConversation } from "./store.js";
import type { Approval, Conversation, Run, RunStatus, RunView, Runtime, RuntimeState } from "./types.js";
import { titleFor } from "./voice.js";

export type ConversationEngineOptions = {
  runtime: Runtime;
  now?: () => string;
  id?: () => string;
};

export type AskOptions = {
  /** Bounded wait after submitting: return early when the run settles. */
  waitMs?: number;
};

// Statuses a voice client can speak immediately — everything else is "still working".
const SPEAKABLE: ReadonlySet<RunStatus> = new Set(["completed", "failed", "cancelled", "waiting_approval", "unknown"]);

function value(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function eventText(event: AssistantEvent): string | undefined {
  const payload = event.payload as { text?: unknown; summary?: unknown; message?: unknown };
  return value(payload.text) ?? value(payload.summary) ?? value(payload.message);
}

function terminal(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function makeConversation(
  runtimeId: string,
  session: AssistantSession,
  now: string,
  id: string,
  title: string
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
  private readonly changes = new EventEmitter();

  constructor(
    private readonly assistant: AssistantClient,
    private readonly store: AmbientStore,
    private readonly options: ConversationEngineOptions
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => randomUUID());
    this.store.upsertRuntime({ ...options.runtime, state: options.runtime.state ?? "unknown" });
    this.unsubscribeEvent = assistant.onEvent(event => {
      void this.applyEvent(event);
    });
    this.unsubscribeState = assistant.onConnectionState(state => {
      if (state === "offline") {
        this.store.markActiveRunsUnknown(this.options.runtime.id, this.now(), `${this.label()} disconnected; the work outcome is unknown`);
        this.emitChanged("*");
      }
      this.setRuntimeState(state);
    });
    this.unsubscribeReplayGap = assistant.onReplayGap?.(gap => {
      const run = this.store.activeRunByLiveSession(this.options.runtime.id, gap.sessionId);
      if (run && !terminal(run.status)) {
        this.replayGapSessions.add(gap.sessionId);
        this.updateRun(run.id, {
          status: "unknown",
          progress: `${this.label()} replay history was truncated; the work outcome is unknown`,
          updatedAt: this.now()
        });
      }
    }) ?? (() => undefined);
  }

  close(): void {
    this.changes.removeAllListeners();
    this.unsubscribeEvent();
    this.unsubscribeState();
    this.unsubscribeReplayGap();
  }

  private emitChanged(runId: string): void {
    this.changes.emit("run", runId);
  }

  /** Store writes funnel through here so waiters and live views see every update. */
  private updateRun(runId: string, changes: Parameters<AmbientStore["updateRun"]>[1]): Run {
    const run = this.store.updateRun(runId, changes);
    this.emitChanged(runId);
    return run;
  }

  /** Fires with the run id on every run update, or "*" for bulk changes. */
  onRunChanged(listener: (runId: string) => void): () => void {
    this.changes.on("run", listener);
    return () => {
      this.changes.off("run", listener);
    };
  }

  get capabilities(): RuntimeCapabilities {
    return this.assistant.capabilities;
  }

  label(): string {
    return this.options.runtime.label;
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
      if (this.assistant.ephemeralSessions) this.store.clearLiveSessionIds(this.options.runtime.id);
      await this.assistant.ping?.();
      const saved = await this.assistant.listSavedSessions?.(100) ?? [];
      for (const session of saved) this.mergeSavedSession(session);
      const active = await this.assistant.listActiveSessions?.() ?? [];
      for (const session of active) this.mergeActiveSession(session);
      const reconciliations = this.assistant.listPendingApprovals
        ? await Promise.allSettled(active.map(session => this.reconcilePendingApprovals(session.id)))
        : [];
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

  async ask(text: string, conversationId?: string, newConversation = false, options: AskOptions = {}): Promise<RunView> {
    const instruction = text.trim();
    if (!instruction) throw new Error(`An instruction for ${this.label()} is required`);
    const conversation = await this.ensureConversation(conversationId, newConversation);
    if (this.store.activeRunForConversation(this.options.runtime.id, conversation.id)) {
      throw new Error(`This conversation already has active ${this.label()} work`);
    }
    const liveSessionId = await this.ensureLive(conversation);
    if (this.store.activeRunForConversation(this.options.runtime.id, conversation.id)) {
      throw new Error(`This conversation already has active ${this.label()} work`);
    }
    const timestamp = this.now();
    const run = this.store.createRun({
      id: this.id(),
      conversationId: conversation.id,
      runtimeId: this.options.runtime.id,
      durableSessionId: conversation.durableSessionId,
      liveSessionId,
      instruction,
      title: titleFor(instruction),
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp
    });

    try {
      const response = await this.assistant.submitPrompt(liveSessionId, instruction);
      const current = this.store.run(run.id)!;
      if (current.status === "queued") {
        this.updateRun(run.id, {
          status: response.state === "streaming" ? "running" : "accepted",
          updatedAt: this.now()
        });
      }
      this.setRuntimeState("online");
    } catch (error) {
      this.updateRun(run.id, {
        status: "failed",
        failure: error instanceof Error ? error.message : String(error),
        updatedAt: this.now()
      });
      throw error;
    }
    return this.waitForRun(run.id, options.waitMs ?? 0);
  }

  /**
   * Block until the run reaches a speakable state or the deadline passes —
   * event-driven, not polled.
   */
  waitForRun(runId: string, waitMs: number): Promise<RunView> {
    const view = this.store.view(runId);
    if (!view) return Promise.reject(new Error("Work item not found"));
    if (waitMs <= 0 || SPEAKABLE.has(view.status)) return Promise.resolve(view);
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.changes.off("run", onChange);
        const latest = this.store.view(runId);
        if (latest) resolve(latest);
        else reject(new Error("Work item not found"));
      };
      const onChange = (changedId: string) => {
        if (changedId !== runId && changedId !== "*") return;
        const latest = this.store.view(runId);
        if (!latest || SPEAKABLE.has(latest.status)) finish();
      };
      const timer = setTimeout(finish, waitMs);
      this.changes.on("run", onChange);
    });
  }

  /**
   * The run a bare `delegate` would have to join: the active run on the
   * conversation the next ask() would pick, without creating anything.
   */
  activeRunForNextAsk(conversationId?: string): RunView | undefined {
    const conversation = conversationId
      ? this.requireConversation(conversationId)
      : this.store.selectedConversation(this.options.runtime.id);
    if (!conversation) return undefined;
    const run = this.store.activeRunForConversation(this.options.runtime.id, conversation.id);
    return run ? this.store.view(run.id) : undefined;
  }

  getWork(runId: string): RunView {
    const run = this.store.view(runId);
    if (!run || run.runtimeId !== this.options.runtime.id) throw new Error("Work item not found");
    return run;
  }

  async steer(runId: string, instruction: string): Promise<RunView> {
    const run = this.getWork(runId);
    if (terminal(run.status)) throw new Error("Work is already finished");
    if (run.status === "unknown") throw new Error(`Work outcome is unknown; wait for ${this.label()} to reconnect before steering it`);
    const text = instruction.trim();
    if (!text) throw new Error(`A steering instruction for ${this.label()} is required`);
    if (!this.assistant.steer) throw new Error(`${this.label()} does not support steering work`);
    await this.assistant.steer(run.liveSessionId, text);
    if (run.status === "waiting_approval") this.store.resolveApprovalsForRun(run.id, this.now());
    if (run.status === "queued" || run.status === "accepted" || run.status === "waiting_approval") {
      this.updateRun(run.id, { status: "running", updatedAt: this.now() });
    }
    return this.store.view(run.id)!;
  }

  async cancel(runId: string): Promise<RunView> {
    const run = this.getWork(runId);
    if (terminal(run.status)) return run;
    if (run.status === "unknown") throw new Error(`Work outcome is unknown; wait for ${this.label()} to reconnect before cancelling it`);
    if (!this.assistant.interrupt) throw new Error(`${this.label()} does not support cancelling work`);
    const response = await this.assistant.interrupt(run.liveSessionId);
    const status = response.state;
    this.updateRun(run.id, {
      status: status === "interrupted" ? "cancelled" : "cancel_requested",
      updatedAt: this.now()
    });
    if (status === "interrupted") this.store.resolveApprovalsForRun(run.id, this.now());
    return this.store.view(run.id)!;
  }

  async respondToApproval(approvalId: string, decision: "once" | "deny"): Promise<RunView> {
    if (!this.assistant.respondToApproval) throw new Error(`${this.label()} does not support approvals`);
    const approval = this.store.approvalById(approvalId) ?? this.store.approvalForRuntime(this.options.runtime.id, approvalId);
    if (!approval || approval.runtimeId !== this.options.runtime.id || approval.resolvedAt) {
      throw new Error("Approval is no longer pending");
    }
    if (this.approvalResponses.has(approval.requestId)) throw new Error("Approval response is already in progress");
    const run = this.getWork(approval.runId);
    if (run.status === "unknown") throw new Error(`Work outcome is unknown; wait for ${this.label()} to reconnect before answering approval`);
    this.approvalResponses.add(approval.requestId);
    try {
      const response = await this.assistant.respondToApproval(approval.liveSessionId, approval.requestId, decision);
      if (response.resolved < 1) {
        throw new Error(`${this.label()} did not accept the approval response`);
      }
      this.store.resolveApprovalForRuntime(this.options.runtime.id, approval.requestId, this.now());
      this.emitChanged(run.id);
      // The assistant may already have finished the run while we awaited its ack;
      // only move a still-waiting run back to running when no other approval is open.
      if (this.store.run(run.id)?.status === "waiting_approval" && !this.store.openApprovalForRun(run.id)) {
        this.updateRun(run.id, { status: "running", updatedAt: this.now() });
      }
      return this.store.view(run.id)!;
    } finally {
      this.approvalResponses.delete(approval.requestId);
    }
  }

  async applyEvent(event: AssistantEvent): Promise<void> {
    if (!event.sessionId) return;
    const run = this.store.activeRunByLiveSession(this.options.runtime.id, event.sessionId);
    if (!run || terminal(run.status)) return;
    if (event.type === "message.complete") this.replayGapSessions.delete(event.sessionId);
    const timestamp = this.now();
    if (event.type === "approval.request") {
      const requestId = value(event.payload.requestId);
      if (!requestId) {
        this.updateRun(run.id, { progress: `${this.label()} sent an approval without a request identity`, updatedAt: timestamp });
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
        command: value(event.payload.command) ?? `${this.label()} requested approval`,
        ...(value(event.payload.description) ? { description: value(event.payload.description)! } : {}),
        ...(typeof event.payload.amountUsd === "number" ? { amountUsd: event.payload.amountUsd } : {}),
        ...(typeof event.payload.limitUsd === "number" ? { limitUsd: event.payload.limitUsd } : {}),
        ...(value(event.payload.when) ? { when: value(event.payload.when)! } : {}),
        ...(event.payload.kind ? { kind: event.payload.kind } : {}),
        choices: Array.isArray(event.payload.choices)
          ? event.payload.choices.filter((choice): choice is string => typeof choice === "string")
          : ["once", "deny"],
        createdAt: timestamp
      };
      this.store.createOrUpdateApproval(approval);
      this.updateRun(run.id, {
        ...(run.status !== "cancel_requested" ? { status: "waiting_approval" as const } : {}),
        progress: approval.description ?? approval.command,
        updatedAt: timestamp
      });
      return;
    }
    if (event.type === "message.complete") {
      const status = value(event.payload.status);
      const answer = eventText(event) ?? `${this.label()} completed the request`;
      const outcome = event.payload.outcome;
      if (run.status === "cancel_requested") {
        this.updateRun(run.id, { status: "cancelled", answer, ...(outcome ? { outcome } : {}), updatedAt: timestamp });
      } else if (status === "error" || value(event.payload.error)) {
        this.updateRun(run.id, {
          status: "failed",
          answer,
          failure: value(event.payload.error) ?? answer,
          ...(outcome ? { outcome } : {}),
          updatedAt: timestamp
        });
      } else if (status === "cancelled" || status === "canceled") {
        this.updateRun(run.id, { status: "cancelled", answer, ...(outcome ? { outcome } : {}), updatedAt: timestamp });
      } else {
        this.updateRun(run.id, { status: "completed", answer, ...(outcome ? { outcome } : {}), updatedAt: timestamp });
      }
      this.store.resolveApprovalsForRun(run.id, timestamp);
      return;
    }
    if (["message.start", "message.delta", "message.interim", "tool.start", "tool.complete", "status.update"].includes(event.type)) {
      const progress = eventText(event) ?? ("name" in event.payload ? value(event.payload.name) : undefined);
      this.updateRun(run.id, {
        ...(run.status === "queued" || run.status === "accepted" ? { status: "running" as const } : {}),
        ...(progress ? { progress } : {}),
        ...(event.type === "status.update" && value(event.payload.subject) ? { subject: value(event.payload.subject)! } : {}),
        ...(event.type === "status.update" && event.payload.board ? { board: event.payload.board } : {}),
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
    const session = await this.assistant.createSession();
    const timestamp = this.now();
    // Number titles so voice selection can disambiguate between conversations.
    const count = this.store.listConversations(this.options.runtime.id).length;
    return this.store.createConversation(makeConversation(
      this.options.runtime.id,
      session,
      timestamp,
      this.id(),
      `New ${this.label()} conversation ${count + 1}`
    ));
  }

  private requireConversation(id: string): Conversation {
    const conversation = this.store.conversation(id);
    if (!conversation || conversation.runtimeId !== this.options.runtime.id) throw new Error("Conversation not found");
    return conversation;
  }

  private async ensureLive(conversation: Conversation): Promise<string> {
    if (conversation.liveSessionId) return conversation.liveSessionId;
    if (!this.assistant.resumeSession) {
      throw new Error(`${this.label()} cannot resume that conversation; start a new conversation`);
    }
    const resumed = await this.assistant.resumeSession(conversation.durableSessionId);
    this.store.updateConversation(conversation.id, {
      durableSessionId: resumed.durableSessionId,
      liveSessionId: resumed.runtimeSessionId,
      updatedAt: this.now()
    });
    await this.reconcilePendingApprovals(resumed.runtimeSessionId);
    return resumed.runtimeSessionId;
  }

  private async reconcilePendingApprovals(liveSessionId: string): Promise<void> {
    const pending = await this.assistant.listPendingApprovals?.(liveSessionId) ?? [];
    const pendingIds = new Set<string>();
    for (const payload of pending) {
      const requestId = value(payload.requestId);
      if (!requestId) throw new Error(`${this.label()} approval snapshot contains an approval without a request identity`);
      pendingIds.add(requestId);
    }
    const timestamp = this.now();
    for (const approval of this.store.listApprovals(this.options.runtime.id)) {
      if (approval.liveSessionId !== liveSessionId || pendingIds.has(approval.requestId)) continue;
      this.store.resolveApprovalForRuntime(this.options.runtime.id, approval.requestId, timestamp);
      const run = this.store.run(approval.runId);
      if (run && !terminal(run.status)) {
        this.updateRun(run.id, {
          status: "unknown",
          progress: `${this.label()} resolved an approval outside Ambient; the work outcome is unknown`,
          updatedAt: timestamp
        });
      } else if (run) {
        this.emitChanged(run.id);
      }
    }
    if (pending.length > 0) this.replayGapSessions.delete(liveSessionId);
    for (const payload of pending) {
      await this.applyEvent({ type: "approval.request", sessionId: liveSessionId, payload });
    }
  }

  private mergeSavedSession(session: SavedSession): void {
    const existing = this.store.conversationByDurable(this.options.runtime.id, session.id);
    const title = session.title ?? session.preview ?? `${this.label()} conversation`;
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

  private mergeActiveSession(session: ActiveSession): void {
    if (!session.durableId) return;
    const existing = this.store.conversationByDurable(this.options.runtime.id, session.durableId);
    const title = session.title ?? session.preview ?? `Active ${this.label()} conversation`;
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
      this.emitChanged("*");
      return;
    }
    const timestamp = this.now();
    this.store.createConversation({
      id: this.id(),
      runtimeId: this.options.runtime.id,
      durableSessionId: session.durableId,
      title,
      liveSessionId: session.id,
      selected: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  }
}
