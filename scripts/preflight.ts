import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

type Check = { name: string; ok: boolean; detail: string };
type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type Probes = { fetch: Fetch; model(apiKey: string, id: string): Promise<string> };

const realProbes: Probes = {
  fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }),
  model: async (apiKey, id) => (await new Anthropic({ apiKey }).models.retrieve(id)).id
};

const reason = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function preflight(env: Record<string, string | undefined>, probes: Probes = realProbes): Promise<Check[]> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const runtimesFile = env.AMBIENT_RUNTIMES_FILE ?? "";
  try {
    const options = (JSON.parse(readFileSync(runtimesFile, "utf8")) as { options?: { line?: string; brain?: string } }[])[0]?.options ?? {};
    add("runtimes file", options.line === "assemblyai" && options.brain === "claude", `${runtimesFile}: line ${options.line ?? "unset"}, brain ${options.brain ?? "unset"}. A live call needs line assemblyai and brain claude, as in runtimes.call.json.`);
  } catch (error) {
    add("runtimes file", false, `AMBIENT_RUNTIMES_FILE "${runtimesFile}" could not be read: ${reason(error)}`);
  }

  const model = env.CALLER_MODEL ?? "claude-opus-5-5";
  if (!env.ANTHROPIC_API_KEY) add("Claude key", false, "ANTHROPIC_API_KEY is empty. Run envsync.");
  else {
    try {
      add("Claude key", true, `the key can use ${await probes.model(env.ANTHROPIC_API_KEY, model)}. Retrieving a model is free.`);
    } catch (error) {
      add("Claude key", false, `the key could not retrieve ${model}: ${reason(error)}`);
    }
  }

  const aaiBase = env.ASSEMBLYAI_API_BASE ?? "https://agents.assemblyai.com/v1";
  if (!env.ASSEMBLYAI_API_KEY) add("AssemblyAI key", false, "ASSEMBLYAI_API_KEY is empty. Run envsync.");
  else {
    try {
      const response = await probes.fetch(`${aaiBase}/agents?limit=1`, { headers: { authorization: env.ASSEMBLYAI_API_KEY } });
      add("AssemblyAI key", response.ok, response.ok ? "the key can list voice agents. Listing is free." : `listing voice agents answered ${response.status}`);
    } catch (error) {
      add("AssemblyAI key", false, `could not reach ${aaiBase}: ${reason(error)}`);
    }
  }

  const base = env.PUBLIC_BASE_URL ?? "";
  if (!base.startsWith("https://")) add("public URL", false, `PUBLIC_BASE_URL "${base}" is not an https URL. Copy the tunnel's https URL into .env.`);
  else {
    try {
      const response = await probes.fetch(`${base.replace(/\/$/, "")}/healthz`);
      const body = response.ok ? await response.json() as { ok?: unknown } : undefined;
      add("public URL", body?.ok === true, body?.ok === true ? `${base}/healthz answers through the tunnel` : `${base}/healthz answered ${response.status}. Start pnpm call and the tunnel first.`);
    } catch (error) {
      add("public URL", false, `${base}/healthz did not answer: ${reason(error)}. Start pnpm call and the tunnel first.`);
    }
  }
  return checks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const checks = await preflight(process.env);
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  const failed = checks.filter(check => !check.ok).length;
  console.log(failed === 0 ? "preflight: ok, the live call can start" : `preflight: ${failed} of ${checks.length} checks failed`);
  process.exit(failed === 0 ? 0 : 1);
}
