function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP returned a non-object");
  return value as Record<string, unknown>;
}

function requiredProtocol(version: unknown): version is string {
  return typeof version === "string" && /^\d{4}-\d{2}-\d{2}$/.test(version) && version >= "2025-11-25";
}

const endpoint = process.env.MCP_URL ?? "http://127.0.0.1:3000/mcp";
const token = process.env.MCP_ACCESS_TOKEN;
const baseHeaders = {
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
  ...(token ? { authorization: `Bearer ${token}` } : {})
};

async function post(body: unknown, sessionId?: string): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    headers: { ...baseHeaders, ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
    body: JSON.stringify(body)
  });
}

async function requireOk(response: Response, operation: string): Promise<{ response: Response; payload: Record<string, unknown> }> {
  if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}`);
  return { response, payload: record(await response.json()) };
}

const initialize = await requireOk(await post({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "hermes-ambient-contract", version: "0.1.0" }
  }
}), "MCP initialize");
const initializeResult = record(initialize.payload.result);
const negotiatedProtocol = initializeResult.protocolVersion;
if (!requiredProtocol(negotiatedProtocol)) throw new Error(`MCP protocol ${String(negotiatedProtocol)} is older than 2025-11-25`);
const sessionId = initialize.response.headers.get("mcp-session-id");
if (!sessionId) throw new Error("MCP initialize did not return a session id");

const initialized = await post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sessionId);
if (!initialized.ok && initialized.status !== 202) throw new Error(`MCP initialized notification failed with HTTP ${initialized.status}`);

const toolsList = await requireOk(await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, sessionId), "MCP tools/list");
const toolsResult = record(toolsList.payload.result);
const tools = toolsResult.tools;
if (!Array.isArray(tools) || tools.length === 0) throw new Error("MCP tools/list returned no tools");

const closed = await fetch(endpoint, {
  method: "DELETE",
  headers: { "mcp-session-id": sessionId, ...(token ? { authorization: `Bearer ${token}` } : {}) }
});
if (!closed.ok && closed.status !== 404) throw new Error(`MCP session close failed with HTTP ${closed.status}`);

console.log(JSON.stringify({
  transport: "Streamable HTTP",
  requestedProtocol: "2025-11-25",
  negotiatedProtocol,
  sessionIdPresent: true,
  toolCount: tools.length
}, null, 2));
