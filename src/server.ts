import { randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readConfig, type AppConfig } from "./config.js";
import { OAuthError, OAuthProvider, type Principal } from "./auth.js";
import { AlexaRequestError, handleAlexaRequest } from "./alexa.js";
import { verifyAlexaRequest, type AlexaVerifyOptions } from "./alexa-verify.js";
import { createMcpServer } from "./mcp.js";
import { buildRuntimeRegistry, type RuntimeRegistry } from "./runtimes/registry.js";
import { SimHost } from "./sim.js";
import { AmbientStore } from "./store.js";

type McpSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastSeenAt: number;
};

/** Alexa+ is conversation-based, not session-based — idle MCP sessions leak. */
export const MCP_SESSION_TTL_MS = 30 * 60 * 1000;
const MCP_SWEEP_INTERVAL_MS = 60_000;

/** Close sessions idle longer than ttlMs. Exported for tests. */
export async function evictIdleSessions<S extends { transport: { close(): Promise<void> }; server: { close(): Promise<void> }; lastSeenAt: number }>(
  sessions: Map<string, S>,
  ttlMs: number,
  now = Date.now()
): Promise<string[]> {
  const evicted: string[] = [];
  for (const [id, entry] of sessions) {
    if (now - entry.lastSeenAt <= ttlMs) continue;
    sessions.delete(id);
    evicted.push(id);
    try {
      await entry.transport.close();
    } catch { /* closing is best-effort */ }
    try {
      await entry.server.close();
    } catch { /* closing is best-effort */ }
  }
  return evicted;
}

export type AmbientHttpDependencies = {
  registry: RuntimeRegistry;
  auth?: OAuthProvider;
  accessToken?: string;
  allowUnauthenticated?: boolean;
  askWaitMs?: number;
  /** DNS-rebinding allowlists (hostname compared for Host, full origin for Origin). */
  allowedHosts?: string[];
  allowedOrigins?: string[];
  sessionTtlMs?: number;
  sweepIntervalMs?: number;
  sim?: SimHost;
  alexa?: {
    applicationId?: string;
    auth?: OAuthProvider;
    accessToken?: string;
    allowUnauthenticated?: boolean;
    /** Verify SignatureCertChainUrl + Signature + timestamp (certification requirement). */
    verifySignature?: boolean;
    verifyOptions?: AlexaVerifyOptions;
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
  const allowedHosts = new Set((dependencies.allowedHosts ?? []).map(host => host.toLowerCase()));
  const allowedOrigins = new Set(dependencies.allowedOrigins ?? []);
  const sweeper = setInterval(() => {
    void evictIdleSessions(sessions, dependencies.sessionTtlMs ?? MCP_SESSION_TTL_MS);
  }, dependencies.sweepIntervalMs ?? MCP_SWEEP_INTERVAL_MS);
  sweeper.unref();
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    // DNS-rebinding protection: Host must be an allowed hostname and a
    // browser Origin, when present, must be an allowed origin. Non-browser
    // clients (MCP, Alexa, curl) send no Origin and pass.
    const hostHeader = typeof request.headers.host === "string" ? request.headers.host : "";
    const hostname = hostHeader.split(":")[0]?.toLowerCase() ?? "";
    if (allowedHosts.size > 0 && !allowedHosts.has(hostname)) {
      writeJson(response, 403, { error: "forbidden_host" });
      return;
    }
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : undefined;
    if (origin && allowedOrigins.size > 0 && !allowedOrigins.has(origin)) {
      writeJson(response, 403, { error: "forbidden_origin" });
      return;
    }
    if (origin) response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-headers", "authorization, content-type, mcp-session-id, last-event-id");
    response.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    response.setHeader("vary", "origin");
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://ambient.invalid");

    if (url.pathname === "/healthz" && request.method === "GET") {
      // {ok:true} is public; runtime detail (ids, adapters, capabilities)
      // requires the same credentials as /mcp.
      const detailed = dependencies.accessToken
        ? tokenMatches(request.headers.authorization, dependencies.accessToken)
        : dependencies.auth
          ? await dependencies.auth.authenticate(request.headers.authorization).then(() => true, () => false)
          : true;
      writeJson(response, 200, detailed ? { ok: true, runtimes: dependencies.registry.list() } : { ok: true });
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
      if (url.pathname.startsWith("/sim/api/") && !(await authorize(dependencies, request, undefined))) {
        writeJson(response, 401, { error: "unauthorized" });
        return;
      }
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
      let raw: Buffer;
      let parsed: unknown;
      try {
        raw = await body(request, 1_000_000);
        parsed = raw.length ? JSON.parse(raw.toString("utf8")) : undefined;
      } catch {
        writeJson(response, 400, { error: "invalid_request" });
        return;
      }
      if (!dependencies.alexa) {
        writeJson(response, 404, { error: "not_found" });
        return;
      }
      if (dependencies.alexa.verifySignature) {
        try {
          await verifyAlexaRequest(request.headers, raw, parsed, dependencies.alexa.verifyOptions ?? {});
        } catch (error) {
          writeJson(response, error instanceof AlexaRequestError ? error.status : 400, { error: "invalid_request" });
          return;
        }
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
    if (entry) entry.lastSeenAt = Date.now();
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
      const created: McpSession = { server: mcp, transport, lastSeenAt: Date.now() };
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

  return {
    server,
    close: async () => {
      clearInterval(sweeper);
      for (const entry of sessions.values()) await entry.server.close();
      sessions.clear();
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

export async function startFromEnvironment(env: Record<string, string | undefined> = process.env): Promise<() => Promise<void>> {
  const config: AppConfig = readConfig(env);
  const store = new AmbientStore(join(config.dataDir, "ambient.sqlite"), config.retentionDays);
  const registry = buildRuntimeRegistry(config, env, store);
  const auth = config.oauth ? new OAuthProvider(config.oauth) : undefined;
  const alexa = config.alexaSkillId ? {
    applicationId: config.alexaSkillId,
    ...(auth ? { auth } : {}),
    ...(config.accessToken ? { accessToken: config.accessToken } : {}),
    allowUnauthenticated: config.allowUnauthenticated,
    verifySignature: config.alexaVerifySignature
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
    assetsDir: simAssets
  });
  sim.watch();
  const http = createAmbientHttpServer({
    registry,
    ...(auth ? { auth } : {}),
    ...(config.accessToken ? { accessToken: config.accessToken } : {}),
    ...(alexa ? { alexa } : {}),
    askWaitMs: config.askWaitMs,
    sim,
    allowedOrigins: config.allowedOrigins,
    allowedHosts: config.allowedHosts,
    allowUnauthenticated: !auth && !config.accessToken && config.allowUnauthenticated
  });
  await new Promise<void>(resolve => http.server.listen(config.port, config.host, resolve));
  registry.startAll();
  return async () => {
    sim.close();
    await registry.close();
    await http.close();
    store.close();
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFromEnvironment().then(close => {
    const shutdown = () => void close().finally(() => process.exit(0));
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
