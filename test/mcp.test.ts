import { describe, expect, it, vi } from "vitest";
import { createMcpServer } from "../src/mcp.js";

describe("MCP surface", () => {
  it("exposes semantic Hermes controls without exposing Hermes tools", () => {
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
      listRuns: vi.fn()
    };
    const server = createMcpServer({ engine: engine as never });
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools).sort()).toEqual([
      "ask_hermes",
      "cancel_work",
      "get_work",
      "list_approvals",
      "list_conversations",
      "respond_to_approval",
      "select_conversation",
      "steer_work"
    ]);
  });
});
