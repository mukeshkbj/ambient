import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const RuntimeEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["local", "cloud"]).default("local"),
  adapter: z.string().min(1).default("caller"),
  endpoint: z.string().min(1).optional(),
  tokenEnv: z.string().min(1).optional(),
  options: z.record(z.string(), z.string()).optional(),
  default: z.boolean().optional()
});

export type RuntimeConfigEntry = z.infer<typeof RuntimeEntrySchema>;

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  AMBIENT_HOST: z.string().min(1).default("0.0.0.0"),
  PUBLIC_BASE_URL: z.string().url().default("http://127.0.0.1:3000"),
  AMBIENT_ALLOWED_ORIGINS: z.string().optional(),
  AMBIENT_ALLOWED_HOSTS: z.string().optional(),
  AMBIENT_DATA_DIR: z.string().min(1).default(".ambient"),
  AMBIENT_RUNTIMES_FILE: z.string().min(1).optional(),
  AMBIENT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  AMBIENT_ASK_WAIT_MS: z.coerce.number().int().nonnegative().default(6000),
  AMBIENT_ACCESS_TOKEN: z.string().min(16).optional(),
  ALLOW_UNAUTHENTICATED: z.string().default("false").transform(value => value === "true"),
  ALEXA_SKILL_ID: z.string().min(1).optional(),
  ALEXA_VERIFY_SIGNATURE: z.string().default("false").transform(value => value === "true"),
  OAUTH_ISSUER: z.string().url().optional(),
  OAUTH_SIGNING_SECRET: z.string().min(32).optional(),
  ALEXA_CLIENT_ID: z.string().min(1).optional(),
  ALEXA_CLIENT_SECRET: z.string().min(16).optional(),
  ALEXA_REDIRECT_URIS: z.string().optional(),
  DEMO_LINK_CODE: z.string().min(8).optional(),
  VOICEMONKEY_TOKEN: z.string().min(1).optional(),
  VOICEMONKEY_DEVICE: z.string().min(1).optional(),
  ALEXA_CLIENT_ID_EVENTS: z.string().min(1).optional(),
  ALEXA_CLIENT_SECRET_EVENTS: z.string().min(1).optional()
});

export type AppConfig = {
  port: number;
  host: string;
  publicBaseUrl: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  runtimes: RuntimeConfigEntry[];
  defaultRuntimeId: string;
  dataDir: string;
  retentionDays: number;
  askWaitMs: number;
  accessToken?: string;
  allowUnauthenticated: boolean;
  alexaSkillId?: string;
  alexaVerifySignature: boolean;
  oauth?: {
    issuer: string;
    resource: string;
    signingSecret: string;
    clientId: string;
    clientSecret: string;
    redirectUris: string[];
    demoLinkCode?: string;
  };
  voiceMonkey?: { token: string; device: string };
  proactiveEvents?: { clientId: string; clientSecret: string };
};

function runtimeEntries(runtimesFile: string): RuntimeConfigEntry[] {
  const entries: RuntimeConfigEntry[] = existsSync(runtimesFile)
    ? z.array(RuntimeEntrySchema).parse(JSON.parse(readFileSync(runtimesFile, "utf8")) as unknown)
    : [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`Duplicate runtime id "${entry.id}" in ${runtimesFile}`);
    seen.add(entry.id);
  }
  if (entries.length === 0) {
    throw new Error(`At least one runtime is required: add entries to ${runtimesFile} (AMBIENT_RUNTIMES_FILE)`);
  }
  return entries;
}

export function readConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const oauthValues = [
    parsed.OAUTH_ISSUER,
    parsed.OAUTH_SIGNING_SECRET,
    parsed.ALEXA_CLIENT_ID,
    parsed.ALEXA_CLIENT_SECRET,
    parsed.ALEXA_REDIRECT_URIS
  ];
  const hasOAuth = oauthValues.some(Boolean);
  if (hasOAuth && oauthValues.some(value => !value)) {
    throw new Error("OAUTH_ISSUER, OAUTH_SIGNING_SECRET, ALEXA_CLIENT_ID, ALEXA_CLIENT_SECRET, and ALEXA_REDIRECT_URIS are required together");
  }
  const voiceMonkeyValues = [parsed.VOICEMONKEY_TOKEN, parsed.VOICEMONKEY_DEVICE];
  if (voiceMonkeyValues.some(Boolean) && voiceMonkeyValues.some(value => !value)) {
    throw new Error("VOICEMONKEY_TOKEN and VOICEMONKEY_DEVICE are required together");
  }
  const eventsValues = [parsed.ALEXA_CLIENT_ID_EVENTS, parsed.ALEXA_CLIENT_SECRET_EVENTS];
  if (eventsValues.some(Boolean) && eventsValues.some(value => !value)) {
    throw new Error("ALEXA_CLIENT_ID_EVENTS and ALEXA_CLIENT_SECRET_EVENTS are required together");
  }
  const baseUrl = parsed.PUBLIC_BASE_URL.replace(/\/$/, "");
  const oauth = hasOAuth ? {
    issuer: parsed.OAUTH_ISSUER!,
    resource: `${baseUrl}/mcp`,
    signingSecret: parsed.OAUTH_SIGNING_SECRET!,
    clientId: parsed.ALEXA_CLIENT_ID!,
    clientSecret: parsed.ALEXA_CLIENT_SECRET!,
    redirectUris: parsed.ALEXA_REDIRECT_URIS!.split(",").map(value => value.trim()).filter(Boolean),
    ...(parsed.DEMO_LINK_CODE ? { demoLinkCode: parsed.DEMO_LINK_CODE } : {})
  } : undefined;
  const runtimesFile = parsed.AMBIENT_RUNTIMES_FILE ?? join(parsed.AMBIENT_DATA_DIR, "runtimes.json");
  const runtimes = runtimeEntries(runtimesFile);
  const publicOrigin = new URL(baseUrl).origin;
  const list = (value: string | undefined): string[] =>
    (value ?? "").split(",").map(item => item.trim()).filter(Boolean);
  return {
    port: parsed.PORT,
    host: parsed.AMBIENT_HOST,
    publicBaseUrl: baseUrl,
    // DNS-rebinding allowlists: the public origin/host plus loopback for local
    // clients; extend with AMBIENT_ALLOWED_ORIGINS / AMBIENT_ALLOWED_HOSTS.
    allowedOrigins: [...new Set([publicOrigin, ...list(parsed.AMBIENT_ALLOWED_ORIGINS)])],
    allowedHosts: [...new Set([
      new URL(baseUrl).hostname,
      "127.0.0.1",
      "localhost",
      "::1",
      "[::1]",
      ...list(parsed.AMBIENT_ALLOWED_HOSTS)
    ])],
    runtimes,
    defaultRuntimeId: runtimes.find(entry => entry.default)?.id ?? runtimes[0]!.id,
    dataDir: parsed.AMBIENT_DATA_DIR,
    retentionDays: parsed.AMBIENT_RETENTION_DAYS,
    askWaitMs: parsed.AMBIENT_ASK_WAIT_MS,
    ...(parsed.AMBIENT_ACCESS_TOKEN ? { accessToken: parsed.AMBIENT_ACCESS_TOKEN } : {}),
    allowUnauthenticated: parsed.ALLOW_UNAUTHENTICATED,
    ...(parsed.ALEXA_SKILL_ID ? { alexaSkillId: parsed.ALEXA_SKILL_ID } : {}),
    alexaVerifySignature: parsed.ALEXA_VERIFY_SIGNATURE,
    ...(oauth ? { oauth } : {}),
    ...(parsed.VOICEMONKEY_TOKEN && parsed.VOICEMONKEY_DEVICE
      ? { voiceMonkey: { token: parsed.VOICEMONKEY_TOKEN, device: parsed.VOICEMONKEY_DEVICE } }
      : {}),
    ...(parsed.ALEXA_CLIENT_ID_EVENTS && parsed.ALEXA_CLIENT_SECRET_EVENTS
      ? { proactiveEvents: { clientId: parsed.ALEXA_CLIENT_ID_EVENTS, clientSecret: parsed.ALEXA_CLIENT_SECRET_EVENTS } }
      : {})
  };
}
