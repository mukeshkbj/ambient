export type RuntimeId = string;

export type RuntimeState = "online" | "offline" | "unknown";

export type RunStatus =
  | "queued"
  | "accepted"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "cancelled"
  | "unknown";

export type Runtime = {
  id: RuntimeId;
  label: string;
  kind: "local" | "cloud";
  state: RuntimeState;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  runtimeId: RuntimeId;
  durableSessionId: string;
  title: string;
  liveSessionId?: string;
  selected: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Run = {
  id: string;
  conversationId: string;
  runtimeId: RuntimeId;
  durableSessionId: string;
  liveSessionId: string;
  instruction: string;
  status: RunStatus;
  answer?: string;
  progress?: string;
  failure?: string;
  createdAt: string;
  updatedAt: string;
};

export type Approval = {
  id: string;
  runId: string;
  runtimeId: RuntimeId;
  durableSessionId: string;
  liveSessionId: string;
  requestId: string;
  command: string;
  description?: string;
  choices: string[];
  createdAt: string;
  resolvedAt?: string;
};

export type RunView = Run & {
  approval?: Approval;
};
