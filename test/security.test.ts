import { createSign } from "node:crypto";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyAlexaRequest } from "../src/alexa-verify.js";
import { AlexaRequestError } from "../src/alexa.js";
import { RuntimeRegistry } from "../src/runtimes/registry.js";
import { createAmbientHttpServer, evictIdleSessions, type AmbientHttpDependencies, MCP_SESSION_TTL_MS } from "../src/server.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant, fakeRuntimeEntry } from "./fake.js";

// Throwaway test-only chain: leaf for echo-api.amazon.com signed by "Test CA".
// Generated with openssl for this suite; not a real credential.
const BUNDLE = `-----BEGIN CERTIFICATE-----
MIIC4DCCAcigAwIBAgIUOIhGDJr8rDgst+YJEgU42LccqPgwDQYJKoZIhvcNAQEL
BQAwEjEQMA4GA1UEAwwHVGVzdCBDQTAeFw0yNjEwMTIwMzI1MTdaFw0zNjEwMDkw
MzI1MTdaMB4xHDAaBgNVBAMME2VjaG8tYXBpLmFtYXpvbi5jb20wggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQCnfZWFFjky+PmmUNrvEvcrwjd4OL5UrRJG
GDAq3TVM/LGvSHcXRj+pnOPpcX4zZ0S1uueBwPZb6pQ94qp5To+pQJjX7mx+GWHI
0OyeuuDd5uoHkiW0H4hAQsTWBDa1+VzT5Frhclx96IFGB3CWTNmLYSLOYF41PnXn
zTblvUv18QUBLAETIK2aSQDjmap5rAorlRYjUXayS8g0ZjMzj12X4vNCMhhhxl9Z
nldVtU9FcGee6s5znO3yTgn23ceD4qTe+mGYw4dfAT1vwPcJMVRRK+4na7oz/1ho
de0XiwCdLtTRro87IXa/R6/wZ1t1u3KDj+QKF9X94gydvzyKercdAgMBAAGjIjAg
MB4GA1UdEQQXMBWCE2VjaG8tYXBpLmFtYXpvbi5jb20wDQYJKoZIhvcNAQELBQAD
ggEBAEplRLJqQYlITxfV1BC3EkKnVCyVBEwk8rc/Wiij9ps4bnEa6VSAGw1YCw+I
sHVylo2KKvjVgYZ7dtabk3I/ZyQaB71KDTaBCFn3cF1ykneFgglPteAV6aE+h54D
ILmrBTjkZQSL0bpdJgYVAbipbm8G/ZBYKXCLi8MlPiZB+Q+3GM9wQ6IoCQg0PjWY
KfuJbEtOkOeXGY8OPSRROBCdG02ZXilvzvMm6ZtcSteireH1LuL0HhWg680H76zX
aS5DOGmURHekdun0E2APlqygA0hndSR+2JQ+xXtnx2YaH/OpoPER9L55UKheRACz
/RXvJtIM+2H4EDCf6X97bZ8Q0p8=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIC5DCCAcygAwIBAgIUG7wTLOqg79tx3oZxP+iGAAEXGzwwDQYJKoZIhvcNAQEL
BQAwEjEQMA4GA1UEAwwHVGVzdCBDQTAeFw0yNjEwMTIwMzI1MTdaFw0zNjEwMDkw
MzI1MTdaMBIxEDAOBgNVBAMMB1Rlc3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IB
DwAwggEKAoIBAQDPvgu8Itk5tZHDqajc9MpFQzaMlL6dgc4H369YAzqpbEgMvlka
kESYDrYd/gTZmmnWSjcZlZYzWbxl6kdax9pVvV3dEoBhpuwPjhUoWc9nhQrIfvQP
ZzIW7YMRSER2dTI7YlbJQMkcB0BB7FJzCBRoWholxngPkxBZsM8/w6dbTiH8+lC4
u8WDCghBj88otzqWOZxj6MuJtsbPWzgTSyxaBuW8kC7LzseCuoH7CtzKs0HHGZXt
n+JKQYLDYi091z464jBs4rJTmUDbDqP0yOBZ9paOD5O2+u9Ob52D8gvplAYhmugJ
Ow+cfGcBAtz3zSP79bH8EhbOFDfKtKw/ezdHAgMBAAGjMjAwMB0GA1UdDgQWBBRI
ffZjTK+LMHiINyND/uY7ReX09TAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEB
CwUAA4IBAQAqDVARqSSo80Q+P2kj4xVb94kfMnL40Y1uGqaYw+03O3UGtn4l3fKX
0F8s6IFyGn3XcIikENnlXyRmtTpMdc0dfNGQkC/NpsScFn/h7VlsLtnndMaHoqR0
aILPgY6LZEisrIvxtGO6g4aUBM1deu887h1W1BzHJoUuTFu2yHpT53SsvWUGyxsK
7ifcwwxjbl6wt16XWg4YFZc5Ddq5H6G8iVLCOia5ONdI7GzyPS1NIjBtEAlaFVf8
8WIMuv6mNWJZs9KTAkguA8FKE32VDaEnEUdMxBOdwOOs0sisX31uNu5CmVO9FEza
hHMTfL5U98JLJAx3NYiTbissXREM2IPo
-----END CERTIFICATE-----`;

const LEAF_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCnfZWFFjky+Pmm
UNrvEvcrwjd4OL5UrRJGGDAq3TVM/LGvSHcXRj+pnOPpcX4zZ0S1uueBwPZb6pQ9
4qp5To+pQJjX7mx+GWHI0OyeuuDd5uoHkiW0H4hAQsTWBDa1+VzT5Frhclx96IFG
B3CWTNmLYSLOYF41PnXnzTblvUv18QUBLAETIK2aSQDjmap5rAorlRYjUXayS8g0
ZjMzj12X4vNCMhhhxl9ZnldVtU9FcGee6s5znO3yTgn23ceD4qTe+mGYw4dfAT1v
wPcJMVRRK+4na7oz/1hode0XiwCdLtTRro87IXa/R6/wZ1t1u3KDj+QKF9X94gyd
vzyKercdAgMBAAECggEACaGKjf8Tpe80J9ChbjrodJ8z4llc9HCJSveMGYLj1Dv5
maswkemLspyfbGaGy7zl8g8/zbHDWNC52n8kr1oJn8FjqJMAsRWTjmEZIh173baw
AWRxf5SKmKteNzJB1R/0KwkIAsu5LtJGULkPy8y6e63HuxdGg4hGbmBaBkbmzcsI
29UwnIBS7TDNehfEdxZJFGtmhWm49SF/yAkCwxYPr4EIQXZj3HVxzP1ZPvRaNu/L
LyzDihtmZrlSgBTyvmx0Ot6TyG4QPzc7WTo1szGSNaCFYyT+Y5tIto/IEcaO+6Kb
UpxaSzTLIJEnBJKCDEjwuWRAeUrXrW/GNqQ1fVvRnwKBgQDVjiVWMVmfyl7i2BHh
JH7YNrS22QUg9OIovq1tif+4vxjRESFk7os0D2o5jvH4ZMUHTkZGcUVKlzQhOAeF
REVNzkgeku6go3uiCsAa4BO4oNwEwdEbihUmA4Fw5xjwWVUFP6UnpZPUZE+0VC8h
hXfHh6kmtjVI32ytFUcfMAgZDwKBgQDIx6GoODmOthXAgqptdxdgtqcKwxkOLxlV
cjQU5dzDAQYzjGxaRCrzJh8taf7wE9r0PPIySc94AdLwfwTNwS46RjScsSGm5FD0
qMuJ5u6SeHTu9L5q2+9FHrbUDgeQM3BzraOU7KtmR4Vxy7xptV5UliQ6DAaf/CgF
3oJ/0MN1EwKBgC/f4fbksVblI0hvb/KtH9KQ0Qp8tG2i+GBx/qcj3LQqAwI7eOUL
pSFSo1mr9grdbF4q6g44rnP+Wa1oxibWG0NKD1jrT5urirfU+SQNP96QEULvwFUQ
K5WOC6Kn7CtVm33FutycffuLUWL3zGkTZrrQatdG2cMwc0iKEJupROd5AoGAOyb1
bYYDDxR+HBVi+JUZghjN5dHM0+z0XcQjq/R8scbfeNhqI73pmXElxk9wGHMBEuvR
vxcX1JdU+h2x4JyFbg24+mEFNRIW972zGZG7v9NVQAFDCGB7gbWmz5rCh61f9/S0
OO/xH1T676fCfrI8dFc3nRJl8URs1i3T7KwoqZkCgYEAxNf13cGW7B642+lcZA3a
cylHToZjSP4ShZ1jZXXG6cMxKGyDWFiz266gEDvGsagNh1qKYfSlLUyDDDtCNqWV
I6nRPdt7DQqggITgMudADLNBTfhTr3qHRn2AquHpdDsam9xKtOF+kuwvsbHa9Pol
peTjhZG+bq3O3C3pL+kVPOI=
-----END PRIVATE KEY-----`;

const NOW = Date.parse("2027-06-01T12:00:00Z");
const CERT_URL = "https://s3.amazonaws.com/echo.api/echo-api-cert.pem";

function fakeRegistry(store: AmbientStore): RuntimeRegistry {
  return new RuntimeRegistry(store, [fakeRuntimeEntry("local", "My Agent", fakeAssistant().client, store)]);
}

async function listen(server: ReturnType<typeof createAmbientHttpServer>): Promise<number> {
  await new Promise<void>(resolve => server.server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return address.port;
}

function signedHeaders(raw: Buffer): Record<string, string> {
  const signature = createSign("RSA-SHA256").update(raw).sign(LEAF_KEY, "base64");
  return {
    "content-type": "application/json",
    signaturecertchainurl: CERT_URL,
    signature
  };
}

function alexaBody(timestamp: string): string {
  return JSON.stringify({
    version: "1.0",
    session: { application: { applicationId: "skill-id" }, user: { userId: "user-1" } },
    request: { type: "LaunchRequest", requestId: "request-1", timestamp }
  });
}

describe("ambient http security", () => {
  let close: (() => Promise<void>) | undefined;
  let registry: RuntimeRegistry | undefined;
  let store: AmbientStore | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await close?.();
    await registry?.close();
    store?.close();
    close = undefined;
    registry = undefined;
    store = undefined;
  });

  function build(dependencies: Omit<AmbientHttpDependencies, "registry"> = {}) {
    store = new AmbientStore();
    registry = fakeRegistry(store);
    const http = createAmbientHttpServer({ registry, ...dependencies });
    close = http.close;
    return http;
  }

  it("rejects a foreign Origin (DNS rebinding) but allows the public origin", async () => {
    const http = build({
      allowUnauthenticated: true,
      allowedHosts: ["127.0.0.1"],
      allowedOrigins: ["http://127.0.0.1:3000"]
    });
    const port = await listen(http);
    const initialize = (origin?: string) => fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...(origin ? { origin } : {})
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "t", version: "0" } }
      })
    });
    expect((await initialize("https://evil.example")).status).toBe(403);
    expect((await initialize("http://127.0.0.1:3000")).status).toBe(200);
    // Non-browser clients send no Origin — MCP clients and Alexa pass.
    expect((await initialize()).status).toBe(200);
  });

  it("rejects a Host outside the allowlist", async () => {
    const http = build({ allowUnauthenticated: true, allowedHosts: ["ambient.example"] });
    const port = await listen(http);
    const getWithHost = (host: string) => new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: "/healthz", method: "GET", headers: { host } }, res => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      });
      req.on("error", reject);
      req.end();
    });
    expect(await getWithHost("ambient.example")).toBe(200);
    expect(await getWithHost("evil.example")).toBe(403);
  });

  it("serves {ok:true} publicly and runtime detail only to the bearer", async () => {
    const http = build({ accessToken: "a-local-token-that-is-long-enough" });
    const port = await listen(http);
    const publicHealth = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json() as Record<string, unknown>;
    expect(publicHealth).toEqual({ ok: true });
    const detailed = await (await fetch(`http://127.0.0.1:${port}/healthz`, {
      headers: { authorization: "Bearer a-local-token-that-is-long-enough" }
    })).json() as Record<string, unknown>;
    expect(Array.isArray(detailed.runtimes)).toBe(true);
  });

  it("evicts MCP sessions idle past the ttl", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const closed: string[] = [];
    const make = (id: string, lastSeenAt: number) => ({
      server: { close: vi.fn(async () => { closed.push(`server:${id}`); }) },
      transport: { close: vi.fn(async () => { closed.push(`transport:${id}`); }) },
      lastSeenAt
    });
    const sessions = new Map<string, ReturnType<typeof make>>();
    sessions.set("stale", make("stale", NOW));
    vi.setSystemTime(NOW + MCP_SESSION_TTL_MS + 1);
    sessions.set("fresh", make("fresh", Date.now()));
    const evicted = await evictIdleSessions(sessions, MCP_SESSION_TTL_MS);
    expect(evicted).toEqual(["stale"]);
    expect(sessions.has("stale")).toBe(false);
    expect(sessions.has("fresh")).toBe(true);
    expect(closed).toContain("server:stale");
    expect(closed).toContain("transport:stale");
  });

  describe("alexa request verification", () => {
    const fetchPem = async (url: string) => {
      expect(url).toBe(CERT_URL);
      return BUNDLE;
    };

    it("accepts a properly signed request and rejects tampered or stale ones", async () => {
      const timestamp = new Date(NOW).toISOString();
      const raw = Buffer.from(alexaBody(timestamp));
      await expect(verifyAlexaRequest(signedHeaders(raw), raw, JSON.parse(raw.toString()), {
        now: () => NOW, fetchPem
      })).resolves.toBeUndefined();

      const tampered = Buffer.from(raw.toString().replace("LaunchRequest", "IntentRequest"));
      await expect(verifyAlexaRequest(signedHeaders(raw), tampered, JSON.parse(tampered.toString()), {
        now: () => NOW, fetchPem
      })).rejects.toBeInstanceOf(AlexaRequestError);

      const staleRaw = Buffer.from(alexaBody(new Date(NOW - 151_000).toISOString()));
      await expect(verifyAlexaRequest(signedHeaders(staleRaw), staleRaw, JSON.parse(staleRaw.toString()), {
        now: () => NOW, fetchPem
      })).rejects.toBeInstanceOf(AlexaRequestError);
    });

    it("rejects a SignatureCertChainUrl outside Amazon's echo.api bucket", async () => {
      const timestamp = new Date(NOW).toISOString();
      const raw = Buffer.from(alexaBody(timestamp));
      await expect(verifyAlexaRequest({
        signaturecertchainurl: "https://evil.example/echo.api/cert.pem",
        signature: "AAAA"
      }, raw, JSON.parse(raw.toString()), { now: () => NOW, fetchPem })).rejects.toBeInstanceOf(AlexaRequestError);
    });

    it("verifies requests on /alexa when signature checking is on", async () => {
      const http = build({
        alexa: {
          applicationId: "skill-id",
          allowUnauthenticated: true,
          verifySignature: true,
          verifyOptions: { now: () => NOW, fetchPem }
        }
      });
      const port = await listen(http);
      const timestamp = new Date(NOW).toISOString();
      const raw = alexaBody(timestamp);
      const ok = await fetch(`http://127.0.0.1:${port}/alexa`, {
        method: "POST",
        headers: signedHeaders(Buffer.from(raw)),
        body: raw
      });
      expect(ok.status).toBe(200);
      const unsigned = await fetch(`http://127.0.0.1:${port}/alexa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw
      });
      expect(unsigned.status).toBe(400);
    });
  });
});
