import { describe, expect, it } from "vitest";
import { preflight } from "../scripts/preflight.js";

const READY = {
  AMBIENT_RUNTIMES_FILE: "runtimes.call.json",
  ANTHROPIC_API_KEY: "sk-ant",
  ASSEMBLYAI_API_KEY: "aai",
  PUBLIC_BASE_URL: "https://abc.trycloudflare.com"
};

function probes(answers: { healthz?: number; agents?: number; model?: string | Error } = {}) {
  const asked: { url: string; headers?: Record<string, string> }[] = [];
  return {
    asked,
    probes: {
      fetch: async (url: string, init?: { headers?: Record<string, string> }) => {
        asked.push({ url, ...(init?.headers ? { headers: init.headers } : {}) });
        const status = url.endsWith("/healthz") ? answers.healthz ?? 200 : answers.agents ?? 200;
        return { ok: status === 200, status, json: async () => ({ ok: true }) };
      },
      model: async (_key: string, id: string) => {
        const answer = answers.model ?? id;
        if (answer instanceof Error) throw answer;
        return answer;
      }
    }
  };
}

describe("the live-run preflight", () => {
  it("passes every check when the keys, the model, the tunnel and the runtimes file are ready", async () => {
    const { probes: fake, asked } = probes();
    const checks = await preflight(READY, fake);
    expect(checks.map(check => [check.name, check.ok])).toEqual([["runtimes file", true], ["Claude key", true], ["AssemblyAI key", true], ["public URL", true]]);
    expect(asked).toEqual([
      { url: "https://agents.assemblyai.com/v1/agents?limit=1", headers: { authorization: "aai" } },
      { url: "https://abc.trycloudflare.com/healthz" }
    ]);
  });

  it("fails on the demo runtimes, empty keys and a URL that is not https, without calling any service", async () => {
    const { probes: fake, asked } = probes();
    const checks = await preflight({ AMBIENT_RUNTIMES_FILE: "runtimes.demo.json", PUBLIC_BASE_URL: "http://127.0.0.1:3000" }, fake);
    expect(checks.every(check => !check.ok)).toBe(true);
    expect(asked).toEqual([]);
  });

  it("names the failure when a key is refused or the tunnel is down", async () => {
    const { probes: fake } = probes({ agents: 401, healthz: 502, model: new Error("401 invalid x-api-key") });
    const checks = await preflight(READY, fake);
    expect(checks.filter(check => !check.ok).map(check => check.detail)).toEqual([
      "the key could not retrieve claude-opus-5-5: 401 invalid x-api-key",
      "listing voice agents answered 401",
      "https://abc.trycloudflare.com/healthz answered 502. Start pnpm call and the tunnel first."
    ]);
  });
});
