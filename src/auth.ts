import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

export type OAuthConfig = {
  issuer: string;
  resource: string;
  signingSecret: string;
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  demoLinkCode?: string;
};

export type Principal = {
  kind: "service" | "user";
  subject: string;
  scopes: string[];
};

type AuthorizationRequest = {
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
  challenge: string;
  state?: string;
  expiresAt: number;
};

type RefreshRecord = {
  resource: string;
  scope: string;
  subject: string;
  expiresAt: number;
};

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
  refresh_token?: string;
};

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function scopes(value: string): string[] {
  return value.split(/\s+/).map(item => item.trim()).filter(Boolean);
}

function assertScope(scope: string, allowed: Set<string>): void {
  const values = scopes(scope);
  if (values.length === 0 || values.some(item => !allowed.has(item))) throw new OAuthError("invalid_scope", "Invalid scope");
}

function basic(value: string | undefined): { id: string; secret: string } | undefined {
  if (!value?.startsWith("Basic ")) return undefined;
  const decoded = Buffer.from(value.slice(6), "base64").toString("utf8");
  const index = decoded.indexOf(":");
  return index > 0 ? { id: decoded.slice(0, index), secret: decoded.slice(index + 1) } : undefined;
}

export class OAuthError extends Error {
  constructor(readonly error: string, message: string) {
    super(message);
    this.name = "OAuthError";
  }
}

export class OAuthProvider {
  private readonly authorizationRequests = new Map<string, AuthorizationRequest>();
  private readonly refreshTokens = new Map<string, RefreshRecord>();

  constructor(private readonly config: OAuthConfig) {
    if (config.signingSecret.length < 32) throw new Error("OAuth signing secret must be at least 32 characters");
  }

  protectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: this.config.resource,
      authorization_servers: [this.config.issuer],
      scopes_supported: ["mcp:service", "mcp:tools", "mcp:resources"]
    };
  }

  authorizationServerMetadata(): Record<string, unknown> {
    return {
      issuer: this.config.issuer,
      authorization_endpoint: `${this.config.issuer}/authorize`,
      token_endpoint: `${this.config.issuer}/token`,
      revocation_endpoint: `${this.config.issuer}/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["client_credentials", "authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["mcp:service", "mcp:tools", "mcp:resources"]
    };
  }

  requiresLinkCode(): boolean {
    return Boolean(this.config.demoLinkCode);
  }

  beginAuthorization(input: Record<string, string | undefined>): AuthorizationRequest {
    const request: AuthorizationRequest = {
      clientId: input.client_id ?? "",
      redirectUri: input.redirect_uri ?? "",
      resource: input.resource ?? "",
      scope: input.scope ?? "mcp:tools mcp:resources",
      challenge: input.code_challenge ?? "",
      ...(input.state ? { state: input.state } : {}),
      expiresAt: Date.now() + 5 * 60_000
    };
    this.validateAuthorizationRequest(request, input.code_challenge_method ?? "");
    return request;
  }

  confirmAuthorization(request: AuthorizationRequest, linkCode?: string): string {
    if (request.expiresAt < Date.now()) throw new OAuthError("invalid_request", "Authorization request expired");
    if (this.config.demoLinkCode && !equal(linkCode ?? "", this.config.demoLinkCode)) {
      throw new OAuthError("access_denied", "Invalid link code");
    }
    const code = randomBytes(32).toString("base64url");
    this.authorizationRequests.set(code, request);
    const redirect = new URL(request.redirectUri);
    redirect.searchParams.set("code", code);
    if (request.state) redirect.searchParams.set("state", request.state);
    return redirect.toString();
  }

  async token(body: Record<string, string | undefined>, authorizationHeader?: string): Promise<TokenResponse> {
    const grantType = body.grant_type ?? "";
    if (grantType === "client_credentials") return this.clientCredentials(body, authorizationHeader);
    if (grantType === "authorization_code") return this.authorizationCode(body);
    if (grantType === "refresh_token") return this.refresh(body);
    throw new OAuthError("unsupported_grant_type", "Unsupported grant type");
  }

  async verifyAccessToken(token: string): Promise<Principal> {
    try {
      const verified = await jwtVerify(token, new TextEncoder().encode(this.config.signingSecret), {
        issuer: this.config.issuer,
        audience: this.config.resource
      });
      const kind = verified.payload.kind;
      if (kind !== "service" && kind !== "user") throw new Error("invalid token kind");
      const scopeClaim = verified.payload.scope;
      return {
        kind,
        subject: typeof verified.payload.sub === "string" ? verified.payload.sub : "",
        scopes: scopes(typeof scopeClaim === "string" ? scopeClaim : "")
      };
    } catch {
      throw new OAuthError("invalid_token", "Invalid access token");
    }
  }

  async authenticate(value: string | undefined): Promise<Principal> {
    if (!value?.startsWith("Bearer ")) throw new OAuthError("invalid_token", "Bearer token required");
    return this.verifyAccessToken(value.slice("Bearer ".length));
  }

  revoke(token: string): boolean {
    return this.refreshTokens.delete(token);
  }

  private validateAuthorizationRequest(request: AuthorizationRequest, method: string): void {
    if (request.clientId !== this.config.clientId || !this.config.redirectUris.includes(request.redirectUri)) {
      throw new OAuthError("invalid_request", "Invalid client or redirect URI");
    }
    if (request.resource !== this.config.resource) throw new OAuthError("invalid_target", "Invalid resource");
    if (method !== "S256" || request.challenge.length === 0) throw new OAuthError("invalid_request", "S256 PKCE is required");
    assertScope(request.scope, new Set(["mcp:tools", "mcp:resources"]));
  }

  private async issue(input: { kind: Principal["kind"]; subject: string; scope: string; resource: string }): Promise<string> {
    return new SignJWT({ kind: input.kind, scope: input.scope })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(this.config.issuer)
      .setAudience(input.resource)
      .setSubject(input.subject)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(this.config.signingSecret));
  }

  private async clientCredentials(body: Record<string, string | undefined>, header?: string): Promise<TokenResponse> {
    const credentials = basic(header);
    if (!credentials || !equal(credentials.id, this.config.clientId) || !equal(credentials.secret, this.config.clientSecret)) {
      throw new OAuthError("invalid_client", "Invalid client credentials");
    }
    if (body.resource !== this.config.resource) throw new OAuthError("invalid_target", "Invalid resource");
    if (body.scope !== "mcp:service") throw new OAuthError("invalid_scope", "Service scope is required");
    return {
      access_token: await this.issue({ kind: "service", subject: "alexa-service", scope: "mcp:service", resource: this.config.resource }),
      token_type: "Bearer",
      expires_in: 3600,
      scope: "mcp:service"
    };
  }

  private async authorizationCode(body: Record<string, string | undefined>): Promise<TokenResponse> {
    const code = body.code ?? "";
    const request = this.authorizationRequests.get(code);
    if (!request || request.expiresAt < Date.now() || request.clientId !== (body.client_id ?? "") || request.redirectUri !== (body.redirect_uri ?? "") || request.resource !== (body.resource ?? "")) {
      throw new OAuthError("invalid_grant", "Invalid authorization code");
    }
    const verifier = body.code_verifier ?? "";
    const challenge = createPkceChallenge(verifier);
    if (!equal(challenge, request.challenge)) throw new OAuthError("invalid_grant", "Invalid PKCE verifier");
    this.authorizationRequests.delete(code);
    const refresh = randomBytes(32).toString("base64url");
    this.refreshTokens.set(refresh, {
      resource: request.resource,
      scope: request.scope,
      subject: "owner",
      expiresAt: Date.now() + 30 * 24 * 60 * 60_000
    });
    return {
      access_token: await this.issue({ kind: "user", subject: "owner", scope: request.scope, resource: request.resource }),
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refresh,
      scope: request.scope
    };
  }

  private async refresh(body: Record<string, string | undefined>): Promise<TokenResponse> {
    const token = body.refresh_token ?? "";
    const record = this.refreshTokens.get(token);
    if (!record || record.expiresAt < Date.now()) throw new OAuthError("invalid_grant", "Invalid refresh token");
    return {
      access_token: await this.issue({ kind: "user", subject: record.subject, scope: record.scope, resource: record.resource }),
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: token,
      scope: record.scope
    };
  }
}

export function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
