import { vi } from "vitest";
import { ConversationEngine } from "../src/conversations.js";
import type { RuntimeEntry } from "../src/runtimes/registry.js";
import type { AssistantClient, AssistantEvent, ReplayGap } from "../src/runtimes/types.js";
import { AmbientStore } from "../src/store.js";
import type { RuntimeState } from "../src/types.js";

const ALL_CAPABILITIES = {
  sessions: true,
  steer: true,
  cancel: true,
  approvals: true,
  resume: true,
  events: true,
  asyncClass: "realtime" as const
};

export type FakeAssistant = {
  client: AssistantClient;
  emit(event: AssistantEvent): void;
  state(value: RuntimeState): void;
  gap(value: ReplayGap): void;
};

export function fakeAssistant(overrides: Partial<AssistantClient> = {}): FakeAssistant {
  let eventHandler: ((event: AssistantEvent) => void) | undefined;
  let stateHandler: ((state: RuntimeState) => void) | undefined;
  let replayGapHandler: ((gap: ReplayGap) => void) | undefined;
  const client: AssistantClient = {
    capabilities: ALL_CAPABILITIES,
    ephemeralSessions: true,
    createSession: vi.fn().mockResolvedValue({ runtimeSessionId: "runtime-1", durableSessionId: "stored-1" }),
    submitPrompt: vi.fn().mockResolvedValue({ state: "streaming" }),
    steer: vi.fn().mockResolvedValue({ state: "queued" }),
    interrupt: vi.fn().mockResolvedValue({ state: "interrupted" }),
    respondToApproval: vi.fn().mockResolvedValue({ resolved: 1 }),
    resumeSession: vi.fn().mockResolvedValue({ runtimeSessionId: "runtime-1", durableSessionId: "stored-1" }),
    listSavedSessions: vi.fn().mockResolvedValue([]),
    listActiveSessions: vi.fn().mockResolvedValue([]),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    onEvent: vi.fn((handler: (event: AssistantEvent) => void) => {
      eventHandler = handler;
      return () => undefined;
    }),
    onConnectionState: vi.fn((handler: (state: RuntimeState) => void) => {
      stateHandler = handler;
      return () => undefined;
    }),
    onReplayGap: vi.fn((handler: (gap: ReplayGap) => void) => {
      replayGapHandler = handler;
      return () => undefined;
    }),
    ...overrides
  };
  return {
    client,
    emit: (event: AssistantEvent) => eventHandler?.(event),
    state: (value: RuntimeState) => stateHandler?.(value),
    gap: (value: ReplayGap) => replayGapHandler?.(value)
  };
}

export function fakeRuntimeEntry(
  id: string,
  label: string,
  client: AssistantClient,
  store: AmbientStore,
  options: { now?: () => string; id?: () => string } = {}
): RuntimeEntry {
  const engine = new ConversationEngine(client, store, {
    runtime: { id, label, kind: "local", state: "unknown", updatedAt: "2026-09-06T10:00:00.000Z" },
    ...options
  });
  return {
    descriptor: { id, label, kind: "local", adapter: "fake", capabilities: client.capabilities },
    client,
    engine,
    start: () => undefined,
    close: async () => engine.close()
  };
}
