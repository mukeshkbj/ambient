import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_URL ?? "http://127.0.0.1:3000/mcp";
const token = process.env.MCP_ACCESS_TOKEN;
const transport = new StreamableHTTPClientTransport(new URL(endpoint), token ? {
  requestInit: { headers: { authorization: `Bearer ${token}` } }
} : undefined);
const client = new Client({ name: "ambient-smoke", version: "0.1.0" });

type Result = { structuredContent?: { speech?: string; status?: string }; content?: Array<{ type: string; text?: string }> };

const speech = (result: Result) => result.structuredContent?.speech ?? result.content?.find(item => item.type === "text")?.text ?? "";
const status = (result: Result) => result.structuredContent?.status ?? "";

async function call(name: string, args: Record<string, unknown> = {}): Promise<Result> {
  const result = await client.callTool({ name, arguments: args }) as Result;
  console.log(`> ${name}${Object.keys(args).length ? ` ${JSON.stringify(args)}` : ""}\n  Alexa: ${speech(result)}`);
  return result;
}

async function waitFor(wanted: string[], timeoutMs = 20_000): Promise<Result> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await client.callTool({ name: "status", arguments: {} }) as Result;
    if (wanted.includes(status(result))) {
      console.log(`> status\n  Alexa: ${speech(result)}`);
      return result;
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${wanted.join(" or ")}; last status ${status(result)}: ${speech(result)}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

try {
  await client.connect(transport as Parameters<typeof client.connect>[0]);
  const tools = await client.listTools();
  console.log(`tools: ${tools.tools.map(tool => tool.name).join(", ")}`);
  await call("delegate", { task: "Call Joe's Plumbing and book a visit to fix the kitchen sink, keep it under 150", newConversation: true });
  const waiting = await waitFor(["waiting_approval"]);
  if (!/one hundred eighty dollars/.test(speech(waiting))) throw new Error("The approval did not lead with the stake in words");
  await call("delegate", { task: "offer 160" });
  const done = await waitFor(["completed", "failed", "cancelled", "unknown"]);
  if (status(done) !== "completed" || !/one hundred sixty/i.test(speech(done))) throw new Error(`Expected a confirmed booking at 160, got ${status(done)}: ${speech(done)}`);
  console.log("smoke: ok, the simulated call ended confirmed at the steered price");
} finally {
  await client.close();
}
