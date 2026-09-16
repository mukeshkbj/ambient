import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_URL ?? "http://127.0.0.1:3000/mcp";
const count = Math.max(1, Number(process.env.LATENCY_SAMPLES ?? 30));
const token = process.env.MCP_ACCESS_TOKEN;
const tools = (process.env.LATENCY_TOOLS ?? "list_conversations,get_work").split(",").map(name => name.trim()).filter(Boolean);
const transport = new StreamableHTTPClientTransport(new URL(endpoint), token ? {
  requestInit: { headers: { authorization: `Bearer ${token}` } }
} : undefined);
const client = new Client({ name: "hermes-ambient-latency", version: "0.1.0" });
const report: Record<string, unknown>[] = [];

try {
  await client.connect(transport as Parameters<typeof client.connect>[0]);
  for (const tool of tools) {
    const samples: number[] = [];
    let failures = 0;
    for (let index = 0; index < count; index += 1) {
      const started = performance.now();
      try {
        await client.callTool({ name: tool, arguments: {} });
        samples.push(performance.now() - started);
      } catch {
        failures += 1;
      }
    }
    samples.sort((left, right) => left - right);
    const percentile = (value: number) => samples.length === 0 ? null : samples[Math.min(samples.length - 1, Math.ceil(value * samples.length) - 1)]!;
    report.push({ operation: tool, samples: samples.length, failures, p50Ms: percentile(0.5), p95Ms: percentile(0.95), maxMs: samples.at(-1) ?? null });
  }
} finally {
  await client.close();
}

if (report.every(entry => entry.samples === 0)) throw new Error("No successful latency samples");
console.log(JSON.stringify({ endpoint, results: report }, null, 2));
