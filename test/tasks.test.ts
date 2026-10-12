import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "../src/mcp.js";
import { RuntimeRegistry } from "../src/runtimes/registry.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant, fakeRuntimeEntry } from "./fake.js";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await sleep(10);
  }
}

type StreamMessage = { type: string; task?: { taskId: string; status: string; statusMessage?: string }; result?: { structuredContent?: Record<string, unknown> }; error?: unknown };

async function makePair() {
  const store = new AmbientStore();
  const assistant = fakeAssistant();
  const registry = new RuntimeRegistry(store, [
    fakeRuntimeEntry("planner", "My Agent", assistant.client, store, {
      id: (() => { let n = 0; return () => `run-${++n}`; })()
    })
  ]);
  const server = createMcpServer({ registry, askWaitMs: 400 });
  const client = new Client({ name: "tasks-test", version: "0.1.0" }, {
    capabilities: { tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } } }
  });
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
  const engine = () => registry.entry("planner")!.engine;
  return { client, assistant, engine, close };
}

describe("MCP tasks", () => {
  it("advertises taskSupport on delegate_task only", async () => {
    const { client, close } = await makePair();
    try {
      const { tools } = await client.listTools();
      const delegateTask = tools.find(tool => tool.name === "delegate_task");
      const delegate = tools.find(tool => tool.name === "delegate");
      expect(delegateTask?.execution?.taskSupport).toBe("optional");
      expect(delegate?.execution?.taskSupport).toBe("forbidden");
    } finally {
      await close();
    }
  });

  it("streams a run through task states: working → input_required → completed", async () => {
    const { client, assistant, engine, close } = await makePair();
    try {
      await client.listTools();
      const messages: StreamMessage[] = [];
      const consume = (async () => {
        for await (const message of client.experimental.tasks.callToolStream({
          name: "delegate_task",
          arguments: { task: "Book dinner at Lupa" }
        })) {
          messages.push(message as unknown as StreamMessage);
        }
      })();

      await waitFor(() => messages.some(message => message.type === "taskCreated"));
      const taskId = messages.find(message => message.type === "taskCreated")!.task!.taskId;
      await waitFor(() => engine().listRuns(1).length === 1);

      assistant.emit({
        type: "approval.request",
        sessionId: "runtime-1",
        payload: { requestId: "ap-t1", command: "Book Lupa — $40 deposit", choices: ["once", "deny"] }
      });
      await waitFor(async () => (await client.experimental.tasks.getTask(taskId)).status === "input_required");

      const waiting = await client.experimental.tasks.getTask(taskId);
      expect(waiting.status).toBe("input_required");
      expect(waiting.statusMessage).toContain("Book Lupa");
      expect(waiting.statusMessage).not.toContain("ap-t1");
      expect(waiting.statusMessage).not.toContain("run-");

      // Hold input_required long enough for the client's 250ms poll to observe it.
      await sleep(400);
      const approveCall = client.callTool({ name: "approve", arguments: { decision: "once" } });
      await sleep(50);
      assistant.emit({
        type: "message.complete",
        sessionId: "runtime-1",
        payload: { text: "Booked Lupa for 4 at 7:30.", status: "complete" }
      });
      await approveCall;
      await consume;

      const statuses = messages.filter(message => message.type === "taskStatus").map(message => message.task!.status);
      expect(statuses).toContain("input_required");

      const result = messages.find(message => message.type === "result")!.result!;
      expect((result.structuredContent!.speech as string)).toContain("Lupa");
      expect(result.structuredContent!.status).toBe("completed");

      const final = await client.experimental.tasks.getTaskResult(taskId, CallToolResultSchema);
      expect((final.structuredContent as Record<string, unknown>).status).toBe("completed");
    } finally {
      await close();
    }
  });

  it("maps a failed run to a failed task and cancelled calls to cancelled", async () => {
    const { client, assistant, engine, close } = await makePair();
    try {
      await client.listTools();
      const messages: StreamMessage[] = [];
      const consume = (async () => {
        for await (const message of client.experimental.tasks.callToolStream({
          name: "delegate_task",
          arguments: { task: "Deploy the site" }
        })) {
          messages.push(message as unknown as StreamMessage);
        }
      })();
      await waitFor(() => messages.some(message => message.type === "taskCreated"));
      const taskId = messages.find(message => message.type === "taskCreated")!.task!.taskId;
      await waitFor(() => engine().listRuns(1).length === 1);

      assistant.emit({
        type: "message.complete",
        sessionId: "runtime-1",
        payload: { text: "Deploy failed: credentials expired", status: "error" }
      });
      await waitFor(async () => (await client.experimental.tasks.getTask(taskId)).status === "failed");
      await consume;
      const failed = await client.experimental.tasks.getTaskResult(taskId, CallToolResultSchema);
      expect((failed.structuredContent as Record<string, unknown>).status).toBe("failed");

      const cancelledId = (await client.experimental.tasks.callToolStream({
        name: "delegate_task",
        arguments: { task: "Long background job" }
      }).next()).value as StreamMessage;
      const cancelTaskId = cancelledId.task!.taskId;
      const cancelled = await client.experimental.tasks.cancelTask(cancelTaskId);
      expect(cancelled.status).toBe("cancelled");
    } finally {
      await close();
    }
  });
});
