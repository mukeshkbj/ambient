import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const RuntimeEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["local", "cloud"]).default("local"),
  adapter: z.string().min(1).default("hermes"),
  endpoint: z.string().min(1).optional(),
  tokenEnv: z.string().min(1).optional(),
  connectorTokenEnv: z.string().min(1).optional(),
  options: z.record(z.string(), z.string()).optional(),
  default: z.boolean().optional()
});

export type RuntimeConfigEntry = z.infer<typeof RuntimeEntrySchema>;

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://127.0.0.1:3000"),
  HERMES_WS_URL: z.string().url().optional(),
  HERMES_WS_TOKEN: z.string().optional(),
  HERMES_RUNTIME_ID: z.string().min(1).default("local"),
  HERMES_RUNTIME_LABEL: z.string().min(1).default("My Hermes"),
  HERMES_RUNTIME_KIND: z.enum(["local", "cloud"]).default("local"),
  AMBIENT_DATA_DIR: z.string().min(1).default(".ambient"),
  AMBIENT_RUNTIMES_FILE: z.string().min(1).optional(),
  AMBIENT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  AMBIENT_ASK_WAIT_MS: z.coerce.number().int().nonnegative().default(6000),
  AMBIENT_ACCESS_TOKEN: z.string().min(16).optional(),
  ALLOW_UNAUTHENTICATED: z.string().default("false").transform(value => value === "true"),
  CONNECTOR_TOKEN: z.string().min(16).optional(),
  ALEXA_SKILL_ID: z.string().min(1).optional(),
  OAUTH_ISSUER: z.string().url().optional(),
  OAUTH_SIGNING_SECRET: z.string().min(32).optional(),
  ALEXA_CLIENT_ID: z.string().min(1).optional(),
  ALEXA_CLIENT_SECRET: z.string().min(16).optional(),
  ALEXA_REDIRECT_URIS: z.string().optional(),
  DEMO_LINK_CODE: z.string().min(8).optional()
});

export type AppConfig = {
  port: number;
  runtimes: RuntimeConfigEntry[];
  defaultRuntimeId: string;
  dataDir: string;
  retentionDays: number;
  askWaitMs: number;
  accessToken?: string;
  allowUnauthenticated: boolean;
  alexaSkillId?: string;
  oauth?: {
    issuer: string;
    resource: string;
    signingSecret: string;
    clientId: string;
    clientSecret: string;
    redirectUris: string[];
    demoLinkCode?: string;
  };
};

function runtimeEntries(parsed: z.infer<typeof EnvSchema>, runtimesFile: string): RuntimeConfigEntry[] {
  const entries: RuntimeConfigEntry[] = existsSync(runtimesFile)
    ? z.array(RuntimeEntrySchema).parse(JSON.parse(readFileSync(runtimesFile, "utf8")) as unknown)
    : [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) throw new Error(`Duplicate runtime id "${entry.id}" in ${runtimesFile}`);
    seen.add(entry.id);
  }
  // Env shorthand defines the default Hermes runtime unless the file already declares that id.
  if ((parsed.HERMES_WS_URL || parsed.CONNECTOR_TOKEN) && !seen.has(parsed.HERMES_RUNTIME_ID)) {
    entries.unshift({
      id: parsed.HERMES_RUNTIME_ID,
      label: parsed.HERMES_RUNTIME_LABEL,
      kind: parsed.HERMES_RUNTIME_KIND,
      adapter: "hermes",
      ...(parsed.HERMES_WS_URL ? { endpoint: parsed.HERMES_WS_URL, tokenEnv: "HERMES_WS_TOKEN" } : {}),
      ...(parsed.CONNECTOR_TOKEN ? { connectorTokenEnv: "CONNECTOR_TOKEN" } : {})
    });
  }
  if (entries.length === 0) {
    throw new Error("At least one runtime is required: set HERMES_WS_URL/CONNECTOR_TOKEN or add entries to AMBIENT_RUNTIMES_FILE");
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
  const runtimes = runtimeEntries(parsed, runtimesFile);
  return {
    port: parsed.PORT,
    runtimes,
    defaultRuntimeId: runtimes.find(entry => entry.default)?.id ?? runtimes[0]!.id,
    dataDir: parsed.AMBIENT_DATA_DIR,
    retentionDays: parsed.AMBIENT_RETENTION_DAYS,
    askWaitMs: parsed.AMBIENT_ASK_WAIT_MS,
    ...(parsed.AMBIENT_ACCESS_TOKEN ? { accessToken: parsed.AMBIENT_ACCESS_TOKEN } : {}),
    allowUnauthenticated: parsed.ALLOW_UNAUTHENTICATED,
    ...(parsed.ALEXA_SKILL_ID ? { alexaSkillId: parsed.ALEXA_SKILL_ID } : {}),
    ...(oauth ? { oauth } : {})
  };
}
