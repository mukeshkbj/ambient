import type { CallOutcome } from "../calls/types.js";
import type { RuntimeState } from "../types.js";

/** Canonical approval payload — adapters map their wire fields into this. */
export type ApprovalPayload = {
  requestId: string;
  command: string;
  description?: string;
  choices?: string[];
  amountUsd?: number;
  limitUsd?: number;
  when?: string;
  kind?: ApprovalKind;
};

export type ApprovalKind = "spend" | "dial" | "other";

type Event<T extends string, P> = { type: T; sessionId?: string; payload: P; seq?: number };

/** Canonical engine-facing event stream — a discriminated union, not a string. */
export type AssistantEvent =
  | Event<"message.start", { kind?: string }>
  | Event<"message.delta" | "message.interim", { text?: string }>
  | Event<"message.complete", { text?: string; status?: string; error?: string; outcome?: CallOutcome }>
  | Event<"tool.start" | "tool.complete", { name?: string }>
  | Event<"status.update", { text?: string; name?: string; summary?: string; message?: string; subject?: string }>
  | Event<"approval.request", ApprovalPayload>;

export type SubmitResult = { state: "accepted" | "streaming" };
export type SteerResult = { state: string };
export type InterruptResult = { state: "interrupted" | "acknowledged" };
export type ApprovalResponse = { resolved: number };

export type ReplayGap = {
  sessionId: string;
  lastSeen: number;
  latestSeq: number;
};

export type AssistantSession = {
  runtimeSessionId: string;
  durableSessionId: string;
};

export type SavedSession = {
  id: string;
  title?: string;
  preview?: string;
  startedAt?: number;
  messageCount?: number;
  source?: string;
};

export type ActiveSession = {
  id: string;
  /** Durable id the live session can resume into. */
  durableId?: string;
  title?: string;
  status?: string;
  messageCount?: number;
  preview?: string;
};

export type RuntimeCapabilities = {
  sessions: boolean;
  steer: boolean;
  cancel: boolean;
  approvals: boolean;
  resume: boolean;
  events: boolean;
  asyncClass: "realtime" | "async";
};

export type RuntimeDescriptor = {
  id: string;
  label: string;
  kind: "local" | "cloud";
  adapter: string;
  capabilities: RuntimeCapabilities;
};

export type AssistantClient = {
  readonly capabilities: RuntimeCapabilities;
  /**
   * True when runtimeSessionIds are bound to a live connection and die with it.
   * Discovery clears stored live ids so stale ones are re-bound.
   * Adapters whose session ids are durable (HTTP APIs, session keys) leave this
   * unset — clearing would force a resume that some cannot perform.
   */
  readonly ephemeralSessions?: boolean;
  ping?(): Promise<void>;
  createSession(): Promise<AssistantSession>;
  submitPrompt(runtimeSessionId: string, text: string): Promise<SubmitResult>;
  resumeSession?(durableSessionId: string): Promise<AssistantSession>;
  listSavedSessions?(limit?: number): Promise<SavedSession[]>;
  listActiveSessions?(): Promise<ActiveSession[]>;
  listPendingApprovals?(runtimeSessionId: string): Promise<ApprovalPayload[]>;
  steer?(runtimeSessionId: string, text: string): Promise<SteerResult>;
  interrupt?(runtimeSessionId: string): Promise<InterruptResult>;
  respondToApproval?(runtimeSessionId: string, requestId: string, choice: string): Promise<ApprovalResponse>;
  onEvent(listener: (event: AssistantEvent) => void): () => void;
  onConnectionState(listener: (state: RuntimeState) => void): () => void;
  onReplayGap?(listener: (gap: ReplayGap) => void): () => void;
};

/** Shared listener plumbing for adapters that emit AssistantEvents and connection states. */
export abstract class AssistantEvented {
  private readonly eventListeners = new Set<(event: AssistantEvent) => void>();
  private readonly stateListeners = new Set<(state: RuntimeState) => void>();

  protected emit(event: AssistantEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  protected emitState(state: RuntimeState): void {
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
}
