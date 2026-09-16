import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_URL ?? "http://127.0.0.1:3000/mcp";
const count = Math.max(1, Number(process.env.LATENCY_SAMPLES ?? 30));
const token = process.env.MCP_ACCESS_TOKEN;
const transport = new StreamableHTTPClientTransport(new URL(endpoint), token ? {
  requestInit: { headers: { authorization: `Bearer ${token}` } }
} : undefined);
const client = new Client({ name: "hermes-ambient-latency", version: "0.1.0" });
const samples: number[] = [];
let failures = 0;

try {
  await client.connect(transport as Parameters<typeof client.connect>[0]);
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    try {
      await client.callTool({ name: "list_conversations", arguments: {} });
      samples.push(performance.now() - started);
    } catch {
      failures += 1;
    }
  }
} finally {
  await client.close();
}

if (samples.length === 0) throw new Error("No successful latency samples");
samples.sort((left, right) => left - right);
const percentile = (value: number) => samples[Math.min(samples.length - 1, Math.ceil(value * samples.length) - 1)]!;
console.log(JSON.stringify({ endpoint, operation: "list_conversations", samples: samples.length, failures, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: samples[samples.length - 1] }, null, 2));
