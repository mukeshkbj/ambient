// One-shot check: delegate_task over real Streamable HTTP against a running server.
// Usage: PORT=3101 npx tsx scripts/smoke-tasks.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const port = Number(process.env.PORT ?? 3101);
const client = new Client({ name: "tasks-smoke", version: "0.1.0" }, {
  capabilities: { tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } } }
});
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)) as Parameters<typeof client.connect>[0]);
await client.listTools();
const messages: string[] = [];
let taskId = "";
for await (const message of client.experimental.tasks.callToolStream({
  name: "delegate_task",
  arguments: { task: "Summarize today" }
})) {
  if (message.type === "taskCreated") taskId = message.task.taskId;
  messages.push(`${message.type}${"task" in message && message.task ? `:${message.task.status}` : ""}`);
  if (message.type === "result") {
    const speech = (message.result.structuredContent as { speech?: string })?.speech;
    if (speech) messages.push(`speech:${speech.slice(0, 80)}`);
  }
}
console.log("taskId:", taskId);
console.log(messages.join("\n"));
await client.close();
