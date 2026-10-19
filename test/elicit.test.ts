import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "../src/mcp.js";
import { RuntimeRegistry } from "../src/runtimes/registry.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant, fakeRuntimeEntry } from "./fake.js";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await sleep(10);
  }
}

async function makePair(clientCapabilities: Record<string, unknown>) {
  const store = new AmbientStore();
  const assistant = fakeAssistant();
  const registry = new RuntimeRegistry(store, [
    fakeRuntimeEntry("planner", "My Agent", assistant.client, store, {
      id: (() => { let n = 0; return () => `run-${++n}`; })()
    })
  ]);
  const server = createMcpServer({ registry, askWaitMs: 400 });
  const client = new Client({ name: "elicit-test", version: "0.1.0" }, { capabilities: clientCapabilities });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport as Parameters<typeof client.connect>[0]),
    server.connect(serverTransport as Parameters<typeof server.connect>[0])
  ]);
  const close = async () => {
    await client.close();
    await server.close();
    await registry.close();
    store.close();
  };
  return { client, assistant, registry, close };
}

describe("approval via MCP elicitation", () => {
  it("asks in place and continues the run when the client accepts", async () => {
    const { client, assistant, close } = await makePair({ elicitation: {} });
    const messages: string[] = [];
    client.setRequestHandler(ElicitRequestSchema, async request => {
      const params = request.params;
      if (params.mode === "url") throw new Error("unexpected url elicitation");
      messages.push(params.message);
      expect(params.requestedSchema).toMatchObject({
        type: "object",
        required: ["decision"],
        properties: { decision: { oneOf: [{ const: "approve_once" }, { const: "deny" }] } }
      });
      return { action: "accept", content: { decision: "approve_once" } };
    });
    try {
      const call = client.callTool({ name: "delegate", arguments: { task: "Book dinner at Lupa" } });
      await sleep(15);
      assistant.emit({
        type: "approval.request",
        sessionId: "runtime-1",
        payload: { requestId: "ap-1", command: "Book Lupa for 4 — $40 deposit", choices: ["once", "deny"] }
      });
      await waitFor(() => messages.length === 1);
      expect(messages[0]).toContain("Book Lupa");
      expect(messages[0]).not.toContain("ap-1");
      assistant.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Lupa is booked for four, Saturday at 7pm.", status: "complete" } });
      const result = await call;
      expect(result.isError).not.toBe(true);
      const structured = result.structuredContent as { status: string; speech: string };
      expect(structured.status).toBe("completed");
      expect(structured.speech).toContain("Lupa is booked");
      expect(assistant.client.respondToApproval).toHaveBeenCalledWith("runtime-1", "ap-1", "once");
    } finally {
      await close();
    }
  });

  it("leaves the request pending with spoken instructions when the client declines", async () => {
    const { client, assistant, close } = await makePair({ elicitation: {} });
    client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "decline" }));
    try {
      const call = client.callTool({ name: "delegate", arguments: { task: "Book dinner" } });
      await sleep(15);
      assistant.emit({
        type: "approval.request",
        sessionId: "runtime-1",
        payload: { requestId: "ap-2", command: "Book Lupa", choices: ["once", "deny"] }
      });
      const result = await call;
      const structured = result.structuredContent as { status: string; speech: string };
      expect(structured.status).toBe("waiting_approval");
      expect(structured.speech).toContain("Say yes");
      expect(assistant.client.respondToApproval).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("falls back to the approve tool when the client cannot elicit", async () => {
    const { client, assistant, close } = await makePair({});
    try {
      const call = client.callTool({ name: "delegate", arguments: { task: "Book dinner" } });
      await sleep(15);
      assistant.emit({
        type: "approval.request",
        sessionId: "runtime-1",
        payload: { requestId: "ap-3", command: "Book Lupa — $40 deposit", choices: ["once", "deny"] }
      });
      const result = await call;
      const structured = result.structuredContent as { status: string; speech: string; approvals: { command: string }[] };
      expect(structured.status).toBe("waiting_approval");
      expect(structured.approvals[0]!.command).toContain("Book Lupa");
      expect(structured.speech).toContain("Say yes");

      const answerCall = client.callTool({ name: "approve", arguments: { decision: "deny" } });
      await sleep(15);
      assistant.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "Didn't book — deposit denied.", status: "complete" } });
      const answered = await answerCall;
      expect(assistant.client.respondToApproval).toHaveBeenCalledWith("runtime-1", "ap-3", "deny");
      const answeredStructured = answered.structuredContent as { speech: string };
      expect(answeredStructured.speech).not.toContain("ap-3");
    } finally {
      await close();
    }
  });
});
