import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ConversationEngine, type HermesConversationClient } from "../src/conversations.js";
import { createAmbientHttpServer } from "../src/server.js";
import { AmbientStore } from "../src/store.js";

function fakeHermes(): HermesConversationClient {
  return {
    createSession: vi.fn().mockResolvedValue({ runtimeSessionId: "live-1", durableSessionId: "saved-1" }),
    submitPrompt: vi.fn().mockResolvedValue({ status: "streaming" }),
    steer: vi.fn().mockResolvedValue({ status: "queued" }),
    interrupt: vi.fn().mockResolvedValue({ status: "interrupted" }),
    respondToApproval: vi.fn().mockResolvedValue({ resolved: 1 }),
    resumeSession: vi.fn().mockResolvedValue({ runtimeSessionId: "live-1", durableSessionId: "saved-1" }),
    listSavedSessions: vi.fn().mockResolvedValue([]),
    listActiveSessions: vi.fn().mockResolvedValue([]),
    listPendingApprovals: vi.fn().mockResolvedValue([]),
    onEvent: vi.fn(() => () => undefined),
    onConnectionState: vi.fn(() => () => undefined),
    onReplayGap: vi.fn(() => () => undefined)
  };
}

async function listen(server: ReturnType<typeof createAmbientHttpServer>): Promise<number> {
  await new Promise<void>(resolve => server.server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return address.port;
}

describe("Ambient HTTP bridge", () => {
  let close: (() => Promise<void>) | undefined;
  let engine: ConversationEngine | undefined;
  let store: AmbientStore | undefined;

  afterEach(async () => {
    await close?.();
    engine?.close();
    store?.close();
    close = undefined;
    engine = undefined;
    store = undefined;
  });

  it("serves a stateful MCP session over Streamable HTTP", async () => {
    store = new AmbientStore();
    engine = new ConversationEngine(fakeHermes(), store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "online", updatedAt: new Date().toISOString() }
    });
    const http = createAmbientHttpServer({ engine, allowUnauthenticated: true });
    close = http.close;
    const port = await listen(http);
    const client = new Client({ name: "http-test", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));

    await client.connect(transport as Parameters<typeof client.connect>[0]);
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toEqual([
      "ask_hermes",
      "get_work",
      "list_conversations",
      "select_conversation",
      "steer_work",
      "cancel_work",
      "list_approvals",
      "respond_to_approval"
    ]);
    const result = await client.callTool({ name: "list_conversations", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ runtime: { id: "local" }, conversations: [], work: [] });
    await client.close();
  });

  it("negotiates the Alexa+ required MCP protocol", async () => {
    store = new AmbientStore();
    engine = new ConversationEngine(fakeHermes(), store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "online", updatedAt: new Date().toISOString() }
    });
    const http = createAmbientHttpServer({ engine, allowUnauthenticated: true });
    close = http.close;
    const port = await listen(http);
    const initialize = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "alexa-plus-contract", version: "0.1.0" } }
      })
    });
    expect(initialize.status).toBe(200);
    const payload = await initialize.json() as { result?: { protocolVersion?: string } };
    expect(payload.result?.protocolVersion).toBe("2025-11-25");
    const sessionId = initialize.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    const initialized = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-session-id": sessionId! },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })
    });
    expect([200, 202]).toContain(initialized.status);
    const tools = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-session-id": sessionId! },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    });
    expect(tools.status).toBe(200);
    const toolsPayload = await tools.json() as { result?: { tools?: unknown[] } };
    expect(toolsPayload.result?.tools).toHaveLength(8);
    const deleted = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "DELETE", headers: { "mcp-session-id": sessionId! } });
    expect([200, 204]).toContain(deleted.status);
  });

  it("serves a custom Alexa skill request", async () => {
    store = new AmbientStore();
    engine = new ConversationEngine(fakeHermes(), store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "online", updatedAt: new Date().toISOString() }
    });
    const http = createAmbientHttpServer({
      engine,
      alexa: { applicationId: "skill-id", allowUnauthenticated: true }
    });
    close = http.close;
    const port = await listen(http);
    const response = await fetch(`http://127.0.0.1:${port}/alexa`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: "1.0",
        session: { application: { applicationId: "skill-id" }, user: { userId: "user-1" } },
        request: { type: "LaunchRequest", requestId: "request-1" }
      })
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as { response?: { outputSpeech?: { ssml?: string } } };
    expect(payload.response?.outputSpeech?.ssml).toContain("What would you like Hermes to do?");
  });

  it("rejects an MCP request without the configured local token", async () => {
    store = new AmbientStore();
    engine = new ConversationEngine(fakeHermes(), store, {
      runtime: { id: "local", label: "My Hermes", kind: "local", state: "online", updatedAt: new Date().toISOString() }
    });
    const http = createAmbientHttpServer({ engine, accessToken: "a-local-token-that-is-long-enough" });
    close = http.close;
    const port = await listen(http);
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0.1.0" } } })
    });
    expect(response.status).toBe(401);
  });
});
