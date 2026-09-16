import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { RuntimeRegistry } from "../src/runtimes/registry.js";
import { createAmbientHttpServer, type AmbientHttpDependencies } from "../src/server.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant, fakeRuntimeEntry } from "./fake.js";

function fakeRegistry(store: AmbientStore): RuntimeRegistry {
  return new RuntimeRegistry(store, [fakeRuntimeEntry("local", "My Hermes", fakeAssistant().client, store)]);
}

async function listen(server: ReturnType<typeof createAmbientHttpServer>): Promise<number> {
  await new Promise<void>(resolve => server.server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return address.port;
}

describe("Ambient HTTP bridge", () => {
  let close: (() => Promise<void>) | undefined;
  let registry: RuntimeRegistry | undefined;
  let store: AmbientStore | undefined;

  afterEach(async () => {
    await close?.();
    await registry?.close();
    store?.close();
    close = undefined;
    registry = undefined;
    store = undefined;
  });

  function build(dependencies: Omit<AmbientHttpDependencies, "registry"> = {}) {
    store = new AmbientStore();
    registry = fakeRegistry(store);
    const http = createAmbientHttpServer({ registry, ...dependencies });
    close = http.close;
    return http;
  }

  it("serves a stateful MCP session over Streamable HTTP", async () => {
    const http = build({ allowUnauthenticated: true });
    const port = await listen(http);
    const client = new Client({ name: "http-test", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));

    await client.connect(transport as Parameters<typeof client.connect>[0]);
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toEqual([
      "ask",
      "get_work",
      "list_assistants",
      "select_assistant",
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
    const http = build({ allowUnauthenticated: true });
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
    expect(toolsPayload.result?.tools).toHaveLength(10);
    const deleted = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "DELETE", headers: { "mcp-session-id": sessionId! } });
    expect([200, 204]).toContain(deleted.status);
  });

  it("serves a custom Alexa skill request", async () => {
    const http = build({ alexa: { applicationId: "skill-id", allowUnauthenticated: true } });
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
    expect(payload.response?.outputSpeech?.ssml).toContain("What would you like your assistants to do?");
  });

  it("rejects an MCP request without the configured local token", async () => {
    const http = build({ accessToken: "a-local-token-that-is-long-enough" });
    const port = await listen(http);
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0.1.0" } } })
    });
    expect(response.status).toBe(401);
  });
});
