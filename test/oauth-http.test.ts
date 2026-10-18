import { afterEach, describe, expect, it } from "vitest";
import { createPkceChallenge, OAuthProvider } from "../src/auth.js";
import { RuntimeRegistry } from "../src/runtimes/registry.js";
import { createAmbientHttpServer } from "../src/server.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant, fakeRuntimeEntry } from "./fake.js";

async function start(registry: RuntimeRegistry, auth: OAuthProvider) {
  const http = createAmbientHttpServer({ registry, auth });
  await new Promise<void>(resolve => http.server.listen(0, "127.0.0.1", resolve));
  const address = http.server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind");
  return { http, base: `http://127.0.0.1:${address.port}` };
}

describe("OAuth HTTP boundary", () => {
  let store: AmbientStore | undefined;
  let registry: RuntimeRegistry | undefined;
  let close: (() => Promise<void>) | undefined;

  function buildRegistry() {
    store = new AmbientStore();
    registry = new RuntimeRegistry(store, [fakeRuntimeEntry("local", "My Agent", fakeAssistant().client, store)]);
    return registry;
  }

  afterEach(async () => {
    await close?.();
    await registry?.close();
    store?.close();
    registry = undefined;
    store = undefined;
  });

  it("keeps service discovery separate from personal tool calls", async () => {
    const registry = buildRegistry();
    const auth = new OAuthProvider({
      issuer: "https://ambient.example",
      resource: "http://127.0.0.1:3000/mcp",
      signingSecret: "01234567890123456789012345678901",
      clientId: "alexa",
      clientSecret: "client-secret-long-enough",
      redirectUris: ["https://alexa.example/callback"]
    });
    const server = await start(registry, auth);
    close = server.http.close;
    const response = await fetch(`${server.base}/token`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from("alexa:client-secret-long-enough").toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ grant_type: "client_credentials", resource: "http://127.0.0.1:3000/mcp", scope: "mcp:service" })
    });
    expect(response.status).toBe(200);
    const service = await response.json() as { access_token: string };
    const unauthorized = await fetch(`${server.base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${service.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "status", arguments: {} } })
    });
    expect(unauthorized.status).toBe(401);
  });

  it("completes the owner PKCE flow and accepts the user token", async () => {
    const registry = buildRegistry();
    const auth = new OAuthProvider({
      issuer: "https://ambient.example",
      resource: "http://127.0.0.1:3000/mcp",
      signingSecret: "01234567890123456789012345678901",
      clientId: "alexa",
      clientSecret: "client-secret-long-enough",
      redirectUris: ["https://alexa.example/callback"],
      demoLinkCode: "link-code-123456"
    });
    const server = await start(registry, auth);
    close = server.http.close;
    const verifier = "verifier-that-is-long-enough-123456789";
    const query = new URLSearchParams({
      client_id: "alexa",
      redirect_uri: "https://alexa.example/callback",
      response_type: "code",
      resource: "http://127.0.0.1:3000/mcp",
      scope: "mcp:tools mcp:resources",
      code_challenge: createPkceChallenge(verifier),
      code_challenge_method: "S256",
      state: "state-1"
    });
    expect((await fetch(`${server.base}/authorize?${query}`)).status).toBe(200);
    const confirmed = await fetch(`${server.base}/authorize/confirm`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...Object.fromEntries(query), link_code: "link-code-123456" })
    });
    expect(confirmed.status).toBe(302);
    const code = new URL(confirmed.headers.get("location")!).searchParams.get("code")!;
    const tokenResponse = await fetch(`${server.base}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: "alexa", redirect_uri: "https://alexa.example/callback", resource: "http://127.0.0.1:3000/mcp", code, code_verifier: verifier })
    });
    expect(tokenResponse.status).toBe(200);
    const token = await tokenResponse.json() as { access_token: string };
    const metadata = await fetch(`${server.base}/.well-known/oauth-protected-resource/mcp`);
    expect(metadata.status).toBe(200);
    const mcp = await fetch(`${server.base}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0.1.0" } } })
    });
    expect(mcp.status).toBe(200);
  });
});
