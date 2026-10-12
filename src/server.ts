import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import WebSocket, { WebSocketServer } from "ws";
import { readConfig, type AppConfig } from "./config.js";
import { OAuthError, OAuthProvider, type Principal } from "./auth.js";
import { AlexaRequestError, handleAlexaRequest } from "./alexa.js";
import { createMcpServer } from "./mcp.js";
import { buildRuntimeRegistry, type RuntimeRegistry } from "./runtimes/registry.js";
import type { ConnectorConnection } from "./runtimes/types.js";
import { SimHost } from "./sim.js";
import { AmbientStore } from "./store.js";

type McpSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

export type AmbientHttpDependencies = {
  registry: RuntimeRegistry;
  auth?: OAuthProvider;
  accessToken?: string;
  allowUnauthenticated?: boolean;
  askWaitMs?: number;
  sim?: SimHost;
  alexa?: {
    applicationId?: string;
    auth?: OAuthProvider;
    accessToken?: string;
    allowUnauthenticated?: boolean;
  };
  connectors?: Map<string, { token: string; connection: ConnectorConnection }>;
};

export type AmbientHttp = {
  server: Server;
  close(): Promise<void>;
};

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(payload));
  response.end(payload);
}

function writeText(response: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8"): void {
  response.statusCode = status;
  response.setHeader("content-type", type);
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
}

async function body(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function formBody(request: IncomingMessage): Promise<Record<string, string | undefined>> {
  const raw = (await body(request, 1_000_000)).toString("utf8");
  return raw ? Object.fromEntries(new URLSearchParams(raw).entries()) : {};
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const raw = (await body(request, 5_000_000)).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

function methodOf(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
  const method = (parsed as Record<string, unknown>).method;
  return typeof method === "string" ? method : "";
}

function tokenMatches(value: string | undefined, expected: string): boolean {
  if (!value?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(value.slice("Bearer ".length));
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function secretMatches(value: string | undefined, expected: string): boolean {
  const actual = Buffer.from(value ?? "");
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function serviceMethod(method: string): boolean {
  return [
    "initialize",
    "notifications/initialized",
    "ping",
    "tools/list",
    "resources/list",
    "resources/templates/list",
    "resources/read"
  ].includes(method);
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

async function authorize(
  dependencies: AmbientHttpDependencies,
  request: IncomingMessage,
  parsed: unknown
): Promise<Principal | undefined> {
  if (dependencies.auth) {
    let principal: Principal;
    try {
      principal = await dependencies.auth.authenticate(request.headers.authorization);
    } catch {
      return undefined;
    }
    const method = methodOf(parsed);
    if (serviceMethod(method)) {
      return principal.scopes.includes("mcp:service") || principal.scopes.includes("mcp:tools") ? principal : undefined;
    }
    return principal.kind === "user" && principal.scopes.includes("mcp:tools") ? principal : undefined;
  }
  if (dependencies.accessToken) {
    return tokenMatches(request.headers.authorization, dependencies.accessToken)
      ? { kind: "user", subject: "local", scopes: ["mcp:tools", "mcp:resources"] }
      : undefined;
  }
  return dependencies.allowUnauthenticated
    ? { kind: "user", subject: "local", scopes: ["mcp:tools", "mcp:resources"] }
    : undefined;
}

function authorizationForm(params: Record<string, string | undefined>, requiresLinkCode: boolean): string {
  const hidden = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `<input type="hidden" name="${htmlEscape(key)}" value="${htmlEscape(value!)}">`)
    .join("");
  const linkCode = requiresLinkCode ? '<label>Link code <input name="link_code" type="password" autocomplete="one-time-code" required></label>' : "";
  return `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link Ambient</title><body><main><h1>Link Ambient</h1><p>Confirm access for Alexa.</p><form method="post" action="/authorize/confirm">${hidden}${linkCode}<button type="submit">Link account</button></form></main></body></html>`;
}

export function createAmbientHttpServer(dependencies: AmbientHttpDependencies): AmbientHttp {
  const sessions = new Map<string, McpSession>();
  const connectorServer = dependencies.connectors && dependencies.connectors.size > 0 ? new WebSocketServer({ noServer: true }) : undefined;
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "authorization, content-type, mcp-session-id, last-event-id");
    response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://ambient.invalid");

    if (url.pathname === "/healthz" && request.method === "GET") {
      writeJson(response, 200, { ok: true, runtimes: dependencies.registry.list() });
      return;
    }
    if (dependencies.auth && request.method === "GET" && (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp")) {
      writeJson(response, 200, dependencies.auth.protectedResourceMetadata());
      return;
    }
    if (dependencies.auth && request.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      writeJson(response, 200, dependencies.auth.authorizationServerMetadata());
      return;
    }
    if (dependencies.auth && request.method === "GET" && url.pathname === "/authorize") {
      try {
        const params = Object.fromEntries(url.searchParams.entries());
        dependencies.auth.beginAuthorization(params);
        writeText(response, 200, authorizationForm(params, dependencies.auth.requiresLinkCode()), "text/html; charset=utf-8");
      } catch (error) {
        writeText(response, 400, error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (dependencies.auth && request.method === "POST" && url.pathname === "/authorize/confirm") {
      try {
        const values = await formBody(request);
        const params = { ...values, ...Object.fromEntries(url.searchParams.entries()) };
        const requestData = dependencies.auth.beginAuthorization(params);
        const redirect = dependencies.auth.confirmAuthorization(requestData, values.link_code);
        response.statusCode = 302;
        response.setHeader("location", redirect);
        response.end();
      } catch (error) {
        const status = error instanceof OAuthError && error.error === "access_denied" ? 403 : 400;
        writeText(response, status, error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (dependencies.auth && request.method === "POST" && url.pathname === "/token") {
      try {
        const values = await formBody(request);
        const token = await dependencies.auth.token(values, request.headers.authorization);
        writeJson(response, 200, token);
      } catch (error) {
        const oauthError = error instanceof OAuthError ? error : new OAuthError("invalid_request", String(error));
        writeJson(response, oauthError.error === "invalid_client" ? 401 : 400, { error: oauthError.error, error_description: oauthError.message });
      }
      return;
    }
    if (dependencies.auth && request.method === "POST" && url.pathname === "/revoke") {
      try {
        const values = await formBody(request);
        dependencies.auth.revoke(values.token ?? "");
        response.statusCode = 200;
        response.end();
      } catch {
        writeJson(response, 400, { error: "invalid_request" });
      }
      return;
    }
    if (dependencies.sim && (url.pathname === "/sim" || url.pathname.startsWith("/sim/"))) {
      const sim = dependencies.sim;
      if (url.pathname === "/sim/api/events" && request.method === "GET") {
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive"
        });
        const send = (event: unknown) => response.write(`data: ${JSON.stringify(event)}\n\n`);
        const unlisten = sim.onEvent(send);
        const heartbeat = setInterval(() => response.write(": ping\n\n"), 15_000);
        request.on("close", () => {
          clearInterval(heartbeat);
          unlisten();
        });
        return;
      }
      if (url.pathname === "/sim/api/turn" && request.method === "POST") {
        try {
          const input = await jsonBody(request) as { utterance?: unknown } | undefined;
          const utterance = typeof input?.utterance === "string" ? input.utterance.trim() : "";
          if (!utterance) {
            writeJson(response, 400, { error: "utterance is required" });
            return;
          }
          writeJson(response, 200, await sim.turn(utterance));
        } catch (error) {
          writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      if (url.pathname === "/sim/api/tool" && request.method === "POST") {
        try {
          const input = await jsonBody(request) as { name?: unknown; arguments?: unknown } | undefined;
          if (typeof input?.name !== "string" || !input.name) {
            writeJson(response, 400, { error: "tool name is required" });
            return;
          }
          const args = input.arguments && typeof input.arguments === "object" ? input.arguments as Record<string, unknown> : {};
          writeJson(response, 200, await sim.callTool(input.name, args));
        } catch (error) {
          writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
      if (url.pathname === "/sim/api/resource" && request.method === "GET") {
        const uri = url.searchParams.get("uri") ?? "";
        try {
          const resource = await sim.readResource(uri);
          if (resource) writeJson(response, 200, resource);
          else writeJson(response, 404, { error: "not_found" });
        } catch {
          writeJson(response, 404, { error: "not_found" });
        }
        return;
      }
      if (url.pathname === "/sim/api/elicit" && request.method === "POST") {
        const input = await jsonBody(request) as { id?: unknown; decision?: unknown } | undefined;
        const decision = input?.decision === "deny" ? "deny" : input?.decision === "decline" ? "decline" : "approve_once";
        const answered = typeof input?.id === "string" && sim.answerElicit(input.id, decision);
        writeJson(response, answered ? 200 : 404, { answered });
        return;
      }
      if (request.method === "GET") {
        const asset = sim.asset(url.pathname);
        if (asset) writeText(response, 200, asset.body, asset.type);
        else writeJson(response, 404, { error: "not_found" });
        return;
      }
    }
    if (request.method === "POST" && url.pathname === "/alexa") {
      let parsed: unknown;
      try {
        parsed = await jsonBody(request);
      } catch {
        writeJson(response, 400, { error: "invalid_request" });
        return;
      }
      if (!dependencies.alexa) {
        writeJson(response, 404, { error: "not_found" });
        return;
      }
      try {
        const result = await handleAlexaRequest(parsed, {
          registry: dependencies.registry,
          ...(dependencies.askWaitMs !== undefined ? { askWaitMs: dependencies.askWaitMs } : {}),
          ...dependencies.alexa
        });
        writeJson(response, 200, result);
      } catch (error) {
        if (error instanceof AlexaRequestError) {
          writeJson(response, error.status, { error: error.status === 401 ? "unauthorized" : "invalid_request" });
        } else {
          writeJson(response, 500, { error: "internal_error" });
        }
      }
      return;
    }
    if (url.pathname !== "/mcp") {
      writeJson(response, 404, { error: "not_found" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = request.method === "POST" ? await jsonBody(request) : undefined;
    } catch (error) {
      writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!(await authorize(dependencies, request, parsed))) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    const sessionId = typeof request.headers["mcp-session-id"] === "string" ? request.headers["mcp-session-id"] : undefined;
    let entry = sessionId ? sessions.get(sessionId) : undefined;
    if (!entry && sessionId) {
      writeJson(response, 404, { error: "unknown_mcp_session" });
      return;
    }
    if (!entry) {
      const mcp = createMcpServer({
        registry: dependencies.registry,
        ...(dependencies.askWaitMs !== undefined ? { askWaitMs: dependencies.askWaitMs } : {})
      });
      const ref: { current?: McpSession } = {};
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        // SSE responses on every POST so in-tool server→client requests
        // (elicitation) have a channel to the caller.
        enableJsonResponse: false,
        onsessioninitialized: id => {
          if (ref.current) sessions.set(id, ref.current);
        },
        onsessionclosed: async id => {
          const closed = sessions.get(id);
          sessions.delete(id);
          await closed?.server.close();
        }
      });
      const created: McpSession = { server: mcp, transport };
      ref.current = created;
      entry = created;
      try {
        await mcp.connect(transport as Parameters<typeof mcp.connect>[0]);
      } catch (error) {
        writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    try {
      await entry.transport.handleRequest(request, response, parsed);
    } catch (error) {
      if (!response.headersSent) writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
  const server = createHttpServer((request, response) => {
    void handle(request, response).catch(error => {
      if (!response.headersSent) writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  if (connectorServer && dependencies.connectors) {
    const connectors = dependencies.connectors;
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://ambient.invalid");
      const runtimeId = request.headers["x-ambient-runtime-id"];
      const entry = typeof runtimeId === "string" ? connectors.get(runtimeId) : undefined;
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
      if (url.pathname !== "/connector" || !entry || !secretMatches(token, entry.token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      connectorServer.handleUpgrade(request, socket, head, webSocket => {
        void entry.connection.attach(webSocket).catch(() => {
          if (webSocket.readyState === WebSocket.OPEN) webSocket.close(1013, "connector unavailable");
        });
      });
    });
  }

  return {
    server,
    close: async () => {
      for (const entry of sessions.values()) await entry.server.close();
      sessions.clear();
      if (connectorServer) {
        for (const connector of dependencies.connectors?.values() ?? []) await connector.connection.close();
        await new Promise<void>(resolve => connectorServer.close(() => resolve()));
      }
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

export async function startFromEnvironment(env: Record<string, string | undefined> = process.env): Promise<() => Promise<void>> {
  const config: AppConfig = readConfig(env);
  const store = new AmbientStore(join(config.dataDir, "ambient.sqlite"), config.retentionDays);
  const registry = buildRuntimeRegistry(config, env, store);
  const connectors = registry.connectors();
  const auth = config.oauth ? new OAuthProvider(config.oauth) : undefined;
  const alexa = config.alexaSkillId ? {
    applicationId: config.alexaSkillId,
    ...(auth ? { auth } : {}),
    ...(config.accessToken ? { accessToken: config.accessToken } : {}),
    allowUnauthenticated: config.allowUnauthenticated
  } : undefined;
  // The simulator is a real MCP client on the loopback /mcp endpoint — it goes
  // through the same auth surface, so hand it the local token when one is set.
  const simAssets = [new URL("../web/sim/", import.meta.url), new URL("../../web/sim/", import.meta.url)]
    .map(candidate => fileURLToPath(candidate))
    .find(dir => existsSync(dir)) ?? join(process.cwd(), "web/sim");
  const sim = new SimHost({
    registry,
    mcpUrl: `http://127.0.0.1:${config.port}/mcp`,
    ...(config.accessToken ? { token: config.accessToken } : {}),
    assetsDir: simAssets,
    env
  });
  sim.watch();
  const http = createAmbientHttpServer({
    registry,
    ...(auth ? { auth } : {}),
    ...(config.accessToken ? { accessToken: config.accessToken } : {}),
    ...(connectors.size > 0 ? { connectors } : {}),
    ...(alexa ? { alexa } : {}),
    askWaitMs: config.askWaitMs,
    sim,
    allowUnauthenticated: !auth && !config.accessToken && config.allowUnauthenticated
  });
  await new Promise<void>(resolve => http.server.listen(config.port, "0.0.0.0", resolve));
  registry.startAll();
  return async () => {
    sim.close();
    await registry.close();
    await http.close();
    store.close();
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startFromEnvironment().then(close => {
    const shutdown = () => void close().finally(() => process.exit(0));
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
