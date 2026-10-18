import { afterEach, describe, expect, it } from "vitest";
import { RuntimeRegistry } from "../src/runtimes/registry.js";
import { createAmbientHttpServer } from "../src/server.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant, fakeRuntimeEntry } from "./fake.js";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const HEADERS = { accept: "application/json, text/event-stream", "content-type": "application/json" };

type Rpc = { id?: number; method?: string; params?: { requestedSchema?: unknown }; result?: { structuredContent?: { status?: string } } };

async function* messages(response: Response): AsyncGenerator<Rpc> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const data = buffer.slice(0, end).split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("");
      buffer = buffer.slice(end + 2);
      if (data) yield JSON.parse(data) as Rpc;
    }
  }
}

describe("elicitation over Streamable HTTP", () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it("reaches a client that opened no standalone GET stream", async () => {
    const store = new AmbientStore();
    const assistant = fakeAssistant();
    const registry = new RuntimeRegistry(store, [fakeRuntimeEntry("local", "My Agent", assistant.client, store)]);
    const http = createAmbientHttpServer({ registry, allowUnauthenticated: true, askWaitMs: 400 });
    cleanup = async () => {
      await http.close();
      await registry.close();
      store.close();
    };
    await new Promise<void>(resolve => http.server.listen(0, "127.0.0.1", resolve));
    const address = http.server.address();
    if (!address || typeof address === "string") throw new Error("no TCP address");
    const url = `http://127.0.0.1:${address.port}/mcp`;

    const init = await fetch(url, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} }, clientInfo: { name: "raw", version: "0.1.0" } } })
    });
    const session = { ...HEADERS, "mcp-session-id": init.headers.get("mcp-session-id")! };
    await init.text();
    await fetch(url, { method: "POST", headers: session, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });

    const call = await fetch(url, {
      method: "POST",
      headers: session,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "delegate", arguments: { task: "Book dinner at Lupa" } } })
    });
    await sleep(15);
    assistant.emit({ type: "approval.request", sessionId: "runtime-1", payload: { requestId: "ap-h1", command: "Book Lupa — $40 deposit", choices: ["once", "deny"] } });

    let elicited = false;
    for await (const message of messages(call)) {
      if (message.method === "elicitation/create") {
        elicited = true;
        expect(message.params?.requestedSchema).toMatchObject({ properties: { decision: { oneOf: [{ const: "approve_once", title: "Approve once" }, { const: "deny", title: "Deny" }] } } });
        await fetch(url, { method: "POST", headers: session, body: JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { action: "accept", content: { decision: "approve_once" } } }) });
        await sleep(15);
        assistant.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Lupa is booked.", status: "complete" } });
      }
      if (message.id === 2) {
        expect(message.result?.structuredContent?.status).toBe("completed");
        break;
      }
    }
    expect(elicited).toBe(true);
    expect(assistant.client.respondToApproval).toHaveBeenCalledWith("runtime-1", "ap-h1", "once");
  }, 10_000);
});
