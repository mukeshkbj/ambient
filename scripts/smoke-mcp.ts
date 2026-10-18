import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.MCP_URL ?? "http://127.0.0.1:3000/mcp";
const token = process.env.MCP_ACCESS_TOKEN;
const transport = new StreamableHTTPClientTransport(new URL(endpoint), token ? {
  requestInit: { headers: { authorization: `Bearer ${token}` } }
} : undefined);
const client = new Client({ name: "ambient-smoke", version: "0.1.0" });

try {
  await client.connect(transport as Parameters<typeof client.connect>[0]);
  const tools = await client.listTools();
  const status = await client.callTool({ name: "status", arguments: {} });
  const agents = await client.callTool({ name: "agents", arguments: {} });
  console.log(JSON.stringify({ endpoint, tools: tools.tools.map(tool => tool.name), status, agents }, null, 2));
} finally {
  await client.close();
}
