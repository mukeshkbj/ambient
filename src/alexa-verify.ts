import { createVerify, X509Certificate } from "node:crypto";
import { AlexaRequestError } from "./alexa.js";

/** Amazon's documented cert location for skill request signatures. */
const CERT_HOST = "s3.amazonaws.com";
const CERT_PATH_PREFIX = "/echo.api/";
const SIGNING_SAN = "echo-api.amazon.com";
/** Amazon requires requests be no older than 150 seconds. */
const ALEXA_TIMESTAMP_TOLERANCE_MS = 150_000;

export type AlexaVerifyOptions = {
  /** Injectable clock for tests. */
  now?: () => number;
  /** Injectable PEM fetch for tests; defaults to HTTPS GET with caching. */
  fetchPem?: (url: string) => Promise<string>;
};

const pemCache = new Map<string, Promise<string>>();

async function fetchPemHttps(url: string): Promise<string> {
  let pending = pemCache.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url);
      if (!response.ok) throw new AlexaRequestError(400, `could not fetch signing certificate (${response.status})`);
      return response.text();
    })();
    pemCache.set(url, pending);
    pending.catch(() => pemCache.delete(url));
  }
  return pending;
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/** Split a PEM bundle into individual certificates. */
function certificates(pem: string): X509Certificate[] {
  return pem
    .split("-----END CERTIFICATE-----")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      try {
        return new X509Certificate(`${part}\n-----END CERTIFICATE-----`);
      } catch {
        throw new AlexaRequestError(400, "malformed signing certificate");
      }
    });
}

/**
 * Verify an Alexa skill request: signing cert chain (URL-pinned to Amazon's
 * echo.api bucket, SAN echo-api.amazon.com, in-date, chained), RSA-SHA256
 * signature over the raw body, and a timestamp within ±150 s. Throws
 * AlexaRequestError(400) on any failure — Amazon expects a 400, not 401.
 */
export async function verifyAlexaRequest(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  parsed: unknown,
  options: AlexaVerifyOptions = {}
): Promise<void> {
  const now = options.now ?? Date.now;
  const fetchPem = options.fetchPem ?? fetchPemHttps;

  const certUrl = header(headers, "signaturecertchainurl");
  if (!certUrl) throw new AlexaRequestError(400, "missing SignatureCertChainUrl");
  const parsedUrl = (() => {
    try {
      return new URL(certUrl);
    } catch {
      throw new AlexaRequestError(400, "invalid SignatureCertChainUrl");
    }
  })();
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== CERT_HOST || !parsedUrl.pathname.startsWith(CERT_PATH_PREFIX)) {
    throw new AlexaRequestError(400, "SignatureCertChainUrl is not an Amazon echo.api URL");
  }

  const signature = header(headers, "signature-256") ?? header(headers, "signature");
  if (!signature) throw new AlexaRequestError(400, "missing Signature");

  const chain = certificates(await fetchPem(certUrl));
  if (chain.length === 0) throw new AlexaRequestError(400, "empty certificate chain");
  const leaf = chain[0]!;
  const at = new Date(now());
  if (at < new Date(leaf.validFrom) || at > new Date(leaf.validTo)) {
    throw new AlexaRequestError(400, "signing certificate expired");
  }
  const sans = (leaf.subjectAltName ?? "").split(",").map(name => name.trim().replace(/^DNS:/, ""));
  if (!sans.includes(SIGNING_SAN)) {
    throw new AlexaRequestError(400, "certificate is not for Alexa request signing");
  }
  for (let index = 0; index + 1 < chain.length; index += 1) {
    if (!chain[index]!.verify(chain[index + 1]!.publicKey)) {
      throw new AlexaRequestError(400, "certificate chain does not verify");
    }
  }

  const valid = createVerify("RSA-SHA256").update(rawBody).verify(leaf.publicKey, signature, "base64");
  if (!valid) throw new AlexaRequestError(400, "signature verification failed");

  const request = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>).request
    : undefined;
  const timestamp = request && typeof request === "object" && !Array.isArray(request)
    ? (request as Record<string, unknown>).timestamp
    : undefined;
  if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) {
    throw new AlexaRequestError(400, "request has no parseable timestamp");
  }
  if (Math.abs(now() - Date.parse(timestamp)) > ALEXA_TIMESTAMP_TOLERANCE_MS) {
    throw new AlexaRequestError(400, "request timestamp is outside the 150s window");
  }
}
