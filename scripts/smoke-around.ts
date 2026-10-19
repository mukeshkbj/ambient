import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_URL ?? "http://127.0.0.1:3000/mcp";
const token = process.env.MCP_ACCESS_TOKEN;
const transport = new StreamableHTTPClientTransport(new URL(endpoint), token ? {
  requestInit: { headers: { authorization: `Bearer ${token}` } }
} : undefined);
const client = new Client({ name: "ambient-smoke-around", version: "0.1.0" });

type Board = Array<{ business: string; state: string; amountUsd?: number; when?: string }>;
type Result = { structuredContent?: { speech?: string; status?: string; task?: { steps?: string[]; board?: Board } } };

const speech = (result: Result) => result.structuredContent?.speech ?? "";
const status = (result: Result) => result.structuredContent?.status ?? "";

async function waitFor(wanted: string[], timeoutMs = 30_000): Promise<Result> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await client.callTool({ name: "status", arguments: {} }) as Result;
    if (wanted.includes(status(result))) {
      console.log(`> status\n  Ambient reply: ${speech(result)}`);
      return result;
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${wanted.join(" or ")}; last status ${status(result)}: ${speech(result)}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

try {
  await client.connect(transport as Parameters<typeof client.connect>[0]);
  const task = "Get quotes from plumbers to fix the kitchen sink, under 150";
  const started = await client.callTool({ name: "delegate", arguments: { task, newConversation: true } }) as Result;
  console.log(`> delegate ${JSON.stringify({ task })}\n  Ambient reply: ${speech(started)}`);
  await waitFor(["waiting_approval"]);
  const approved = await client.callTool({ name: "approve", arguments: { decision: "once" } }) as Result;
  console.log(`> approve {"decision":"once"}\n  Ambient reply: ${speech(approved)}`);
  const done = await waitFor(["completed", "failed", "cancelled", "unknown"]);
  const board = done.structuredContent?.task?.board ?? [];
  const booked = board.filter(item => item.state === "booked");
  if (status(done) !== "completed" || booked.length !== 1 || booked[0]!.business !== "Drain Bros") throw new Error(`Expected one booking with Drain Bros, got ${JSON.stringify(board)}`);
  if (board.filter(item => item.state === "released").length !== 2) throw new Error(`Expected two released quotes, got ${JSON.stringify(board)}`);
  console.log("\nThe board:");
  for (const item of board) console.log(`  ${item.business}: ${item.state}${item.amountUsd !== undefined ? `, $${item.amountUsd}` : ""}${item.when ? `, ${item.when}` : ""}`);
  console.log("\nThe calls, as they happened:");
  for (const line of done.structuredContent?.task?.steps ?? []) if (line.includes(": ")) console.log(`  ${line}`);
  console.log("smoke:around: ok, three businesses quoted at once, the cheapest under the limit booked, and the other two were released");
} finally {
  await client.close();
}
