import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import WebSocket, { WebSocketServer } from "ws";
import { ConversationEngine } from "./conversations.js";
import { readConfig, type AppConfig } from "./config.js";
import { OAuthError, OAuthProvider, type Principal } from "./auth.js";
import { AlexaRequestError, handleAlexaRequest } from "./alexa.js";
import { HermesClient, HermesConnection } from "./hermes.js";
import { createMcpServer } from "./mcp.js";
import { AmbientStore } from "./store.js";

type McpSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

export type AmbientHttpDependencies = {
  engine: ConversationEngine;
  auth?: OAuthProvider;
  accessToken?: string;
  allowUnauthenticated?: boolean;
  alexa?: {
    applicationId?: string;
    auth?: OAuthProvider;
    accessToken?: string;
    allowUnauthenticated?: boolean;
  };
  connector?: {
    runtimeId: string;
    token: string;
    connection: HermesConnection;
  };
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

async function formBody(request: IncomingMessage): Promise<Record<string, string | undefined>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return Object.fromEntries(new URLSearchParams(raw).entries());
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 5_000_000) throw new Error("request body too large");
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
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
  return `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link Hermes Ambient</title><body><main><h1>Link Hermes Ambient</h1><p>Confirm access for Alexa.</p><form method="post" action="/authorize/confirm">${hidden}${linkCode}<button type="submit">Link account</button></form></main></body></html>`;
}

export function createAmbientHttpServer(dependencies: AmbientHttpDependencies): AmbientHttp {
  const sessions = new Map<string, McpSession>();
  const connectorServer = dependencies.connector ? new WebSocketServer({ noServer: true }) : undefined;
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
      writeJson(response, 200, { ok: true, runtime: dependencies.engine.runtime() });
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
        const result = await handleAlexaRequest(parsed, { engine: dependencies.engine, ...dependencies.alexa });
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
      const mcp = createMcpServer({ engine: dependencies.engine });
      const ref: { current?: McpSession } = {};
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
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

  if (connectorServer && dependencies.connector) {
    const connector = dependencies.connector;
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://ambient.invalid");
      const runtimeId = request.headers["x-ambient-runtime-id"];
      const headerRuntime = typeof runtimeId === "string" ? runtimeId : undefined;
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
      if (url.pathname !== "/connector" || headerRuntime !== connector.runtimeId || !secretMatches(token, connector.token)) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      connectorServer.handleUpgrade(request, socket, head, webSocket => {
        void connector.connection.attach(webSocket).catch(() => {
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
        await dependencies.connector?.connection.close();
        await new Promise<void>(resolve => connectorServer.close(() => resolve()));
      }
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

export async function startFromEnvironment(env: Record<string, string | undefined> = process.env): Promise<() => Promise<void>> {
  const config: AppConfig = readConfig(env);
  if (!config.hermesWsUrl && !config.connectorToken) throw new Error("HERMES_WS_URL or CONNECTOR_TOKEN is required");
  const connection = new HermesConnection({
    url: config.hermesWsUrl ?? "ws://ambient-connector.invalid",
    ...(config.hermesWsToken ? { token: config.hermesWsToken } : {})
  });
  const hermes = new HermesClient(connection);
  const store = new AmbientStore(join(config.dataDir, "ambient.sqlite"), config.retentionDays);
  const engine = new ConversationEngine(hermes, store, {
    runtime: { id: config.runtimeId, label: config.runtimeLabel, kind: config.runtimeKind, state: "unknown", updatedAt: new Date().toISOString() }
  });
  const auth = config.oauth ? new OAuthProvider(config.oauth) : undefined;
  const alexa = config.alexaSkillId ? {
    applicationId: config.alexaSkillId,
    ...(auth ? { auth } : {}),
    ...(config.accessToken ? { accessToken: config.accessToken } : {}),
    allowUnauthenticated: config.allowUnauthenticated
  } : undefined;
  const http = createAmbientHttpServer({
    engine,
    ...(auth ? { auth } : {}),
    ...(config.accessToken ? { accessToken: config.accessToken } : {}),
    ...(config.connectorToken ? { connector: { runtimeId: config.runtimeId, token: config.connectorToken, connection } } : {}),
    ...(alexa ? { alexa } : {}),
    allowUnauthenticated: !auth && !config.accessToken && config.allowUnauthenticated
  });
  await new Promise<void>(resolve => http.server.listen(config.port, "0.0.0.0", resolve));
  const discover = async () => {
    try {
      await engine.discover();
    } catch {
      engine.setRuntimeState("offline");
    }
  };
  const direct = Boolean(config.hermesWsUrl);
  const connect = async () => {
    try {
      await connection.connect();
      await discover();
    } catch {
      engine.setRuntimeState("offline");
    }
  };
  let reconnect: NodeJS.Timeout | undefined;
  if (direct) {
    void connect();
    reconnect = setInterval(() => {
      if (!connection.isConnected) void connect();
    }, 5_000);
    reconnect.unref();
  } else {
    connection.on("open", () => void discover());
  }
  return async () => {
    if (reconnect) clearInterval(reconnect);
    engine.close();
    await connection.close();
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
