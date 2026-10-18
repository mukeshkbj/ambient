import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { RuntimeRegistry } from "../src/runtimes/registry.js";
import { createAmbientHttpServer, type AmbientHttpDependencies } from "../src/server.js";
import type { SimHost } from "../src/sim.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant, fakeRuntimeEntry } from "./fake.js";

function fakeRegistry(store: AmbientStore): RuntimeRegistry {
  return new RuntimeRegistry(store, [fakeRuntimeEntry("local", "My Agent", fakeAssistant().client, store)]);
}

/** Read the last JSON-RPC message out of an SSE response body. */
function parseSse(body: string): unknown {
  const data = body.split("\n")
    .filter(line => line.startsWith("data:"))
    .map(line => JSON.parse(line.slice(5).trim()) as unknown);
  return data[data.length - 1];
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
      "delegate",
      "delegate_task",
      "status",
      "approve",
      "stop",
      "agents",
      "briefing"
    ]);
    const result = await client.callTool({ name: "status", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "idle" });
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
    expect(initialize.headers.get("content-type")).toContain("text/event-stream");
    const payload = parseSse(await initialize.text()) as { result?: { protocolVersion?: string } };
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
    const toolsPayload = parseSse(await tools.text()) as { result?: { tools?: unknown[] } };
    expect(toolsPayload.result?.tools).toHaveLength(7);
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
    expect(payload.response?.outputSpeech?.ssml).toContain("Who should I call?");
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

  it("requires the local token on /sim/api when one is configured", async () => {
    const token = "a-local-token-that-is-long-enough";
    const callTool = vi.fn().mockResolvedValue({ ok: true });
    const http = build({ accessToken: token, sim: { callTool } as unknown as SimHost });
    const port = await listen(http);
    const call = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}/sim/api/tool`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ name: "status", arguments: {} })
    });
    expect((await call({})).status).toBe(401);
    expect(callTool).not.toHaveBeenCalled();
    expect((await call({ authorization: `Bearer ${token}` })).status).toBe(200);
    expect(callTool).toHaveBeenCalledOnce();
  });
});
