import type WebSocket from "ws";
import type { RuntimeState } from "../types.js";

export type AssistantEvent = {
  type: string;
  sessionId?: string;
  payload: Record<string, unknown>;
  seq?: number;
};

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
  started_at?: number;
  message_count?: number;
  source?: string;
};

export type ActiveSession = {
  id: string;
  session_key?: string;
  title?: string;
  status?: string;
  message_count?: number;
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
  ping?(): Promise<void>;
  createSession(): Promise<AssistantSession>;
  submitPrompt(runtimeSessionId: string, text: string): Promise<Record<string, unknown>>;
  resumeSession?(durableSessionId: string): Promise<AssistantSession>;
  listSavedSessions?(limit?: number): Promise<SavedSession[]>;
  listActiveSessions?(): Promise<ActiveSession[]>;
  listPendingApprovals?(runtimeSessionId: string): Promise<Record<string, unknown>[]>;
  steer?(runtimeSessionId: string, text: string): Promise<Record<string, unknown>>;
  interrupt?(runtimeSessionId: string): Promise<Record<string, unknown>>;
  respondToApproval?(runtimeSessionId: string, requestId: string, choice: string): Promise<Record<string, unknown>>;
  onEvent(listener: (event: AssistantEvent) => void): () => void;
  onConnectionState(listener: (state: RuntimeState) => void): () => void;
  onReplayGap?(listener: (gap: ReplayGap) => void): () => void;
};

export type ConnectorConnection = {
  attach(socket: WebSocket): Promise<void>;
  close(): Promise<void>;
};
