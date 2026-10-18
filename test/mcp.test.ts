import { describe, expect, it, vi } from "vitest";
import { createMcpServer } from "../src/mcp.js";
import { RuntimeRegistry, type RuntimeEntry } from "../src/runtimes/registry.js";
import { AmbientStore } from "../src/store.js";
import type { ConversationEngine } from "../src/conversations.js";
import { fakeAssistant } from "./fake.js";

describe("MCP surface", () => {
  it("exposes customer-intent tools without exposing internal plumbing", () => {
    const store = new AmbientStore();
    const engine = {
      ask: vi.fn(),
      getWork: vi.fn(),
      listConversations: vi.fn(),
      selectConversation: vi.fn(),
      steer: vi.fn(),
      cancel: vi.fn(),
      listApprovals: vi.fn(),
      respondToApproval: vi.fn(),
      runtime: vi.fn(),
      listRuns: vi.fn(),
      waitForRun: vi.fn(),
      activeRunForNextAsk: vi.fn()
    };
    const entry: RuntimeEntry = {
      descriptor: { id: "local", label: "My Agent", kind: "local", adapter: "fake", capabilities: fakeAssistant().client.capabilities },
      client: fakeAssistant().client,
      engine: engine as unknown as ConversationEngine,
      start: () => undefined,
      close: async () => undefined
    };
    const registry = new RuntimeRegistry(store, [entry]);
    const server = createMcpServer({ registry });
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools).sort()).toEqual([
      "agents",
      "approve",
      "briefing",
      "delegate",
      "delegate_task",
      "status",
      "stop"
    ]);
    store.close();
  });
});
