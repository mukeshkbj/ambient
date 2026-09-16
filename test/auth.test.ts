import { describe, expect, it } from "vitest";
import { createPkceChallenge, OAuthProvider } from "../src/auth.js";

const config = {
  issuer: "https://ambient.example",
  resource: "https://ambient.example/mcp",
  signingSecret: "01234567890123456789012345678901",
  clientId: "alexa-client",
  clientSecret: "01234567890123456789012345678901",
  redirectUris: ["https://alexa.example/callback"],
  demoLinkCode: "demo-link-code"
};

describe("OAuthProvider", () => {
  it("issues a service token only for the canonical resource", async () => {
    const provider = new OAuthProvider(config);
    const basic = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
    const token = await provider.token({ grant_type: "client_credentials", resource: config.resource, scope: "mcp:service" }, basic);
    await expect(provider.verifyAccessToken(token.access_token)).resolves.toMatchObject({ kind: "service", scopes: ["mcp:service"] });
    await expect(provider.token({ grant_type: "client_credentials", resource: "https://other.example/mcp", scope: "mcp:service" }, basic)).rejects.toMatchObject({ error: "invalid_target" });
  });

  it("exchanges authorization code with S256 PKCE and refreshes it", async () => {
    const provider = new OAuthProvider(config);
    const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
    const request = provider.beginAuthorization({
      client_id: config.clientId,
      redirect_uri: config.redirectUris[0],
      resource: config.resource,
      scope: "mcp:tools mcp:resources",
      state: "state-1",
      code_challenge: createPkceChallenge(verifier),
      code_challenge_method: "S256"
    });
    const redirect = provider.confirmAuthorization(request, config.demoLinkCode);
    const code = new URL(redirect).searchParams.get("code")!;
    const token = await provider.token({
      grant_type: "authorization_code",
      code,
      client_id: config.clientId,
      redirect_uri: config.redirectUris[0],
      resource: config.resource,
      code_verifier: verifier
    });
    await expect(provider.verifyAccessToken(token.access_token)).resolves.toMatchObject({ kind: "user", scopes: ["mcp:tools", "mcp:resources"] });
    await expect(provider.token({ grant_type: "refresh_token", refresh_token: token.refresh_token })).resolves.toMatchObject({ token_type: "Bearer" });
  });
});
