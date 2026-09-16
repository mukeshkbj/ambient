import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://127.0.0.1:3000"),
  HERMES_WS_URL: z.string().url().optional(),
  HERMES_WS_TOKEN: z.string().optional(),
  HERMES_RUNTIME_ID: z.string().min(1).default("local"),
  HERMES_RUNTIME_LABEL: z.string().min(1).default("My Hermes"),
  HERMES_RUNTIME_KIND: z.enum(["local", "cloud"]).default("local"),
  AMBIENT_DATA_DIR: z.string().min(1).default(".hermes-ambient"),
  AMBIENT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
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
  publicBaseUrl: string;
  hermesWsUrl?: string;
  hermesWsToken?: string;
  runtimeId: string;
  runtimeLabel: string;
  runtimeKind: "local" | "cloud";
  dataDir: string;
  retentionDays: number;
  accessToken?: string;
  allowUnauthenticated: boolean;
  connectorToken?: string;
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
  const oauth = hasOAuth ? {
    issuer: parsed.OAUTH_ISSUER!,
    resource: `${parsed.PUBLIC_BASE_URL}/mcp`,
    signingSecret: parsed.OAUTH_SIGNING_SECRET!,
    clientId: parsed.ALEXA_CLIENT_ID!,
    clientSecret: parsed.ALEXA_CLIENT_SECRET!,
    redirectUris: parsed.ALEXA_REDIRECT_URIS!.split(",").map(value => value.trim()).filter(Boolean),
    ...(parsed.DEMO_LINK_CODE ? { demoLinkCode: parsed.DEMO_LINK_CODE } : {})
  } : undefined;
  return {
    port: parsed.PORT,
    publicBaseUrl: parsed.PUBLIC_BASE_URL.replace(/\/$/, ""),
    ...(parsed.HERMES_WS_URL ? { hermesWsUrl: parsed.HERMES_WS_URL } : {}),
    ...(parsed.HERMES_WS_TOKEN ? { hermesWsToken: parsed.HERMES_WS_TOKEN } : {}),
    runtimeId: parsed.HERMES_RUNTIME_ID,
    runtimeLabel: parsed.HERMES_RUNTIME_LABEL,
    runtimeKind: parsed.HERMES_RUNTIME_KIND,
    dataDir: parsed.AMBIENT_DATA_DIR,
    retentionDays: parsed.AMBIENT_RETENTION_DAYS,
    ...(parsed.AMBIENT_ACCESS_TOKEN ? { accessToken: parsed.AMBIENT_ACCESS_TOKEN } : {}),
    allowUnauthenticated: parsed.ALLOW_UNAUTHENTICATED,
    ...(parsed.CONNECTOR_TOKEN ? { connectorToken: parsed.CONNECTOR_TOKEN } : {}),
    ...(parsed.ALEXA_SKILL_ID ? { alexaSkillId: parsed.ALEXA_SKILL_ID } : {}),
    ...(oauth ? { oauth } : {})
  };
}
