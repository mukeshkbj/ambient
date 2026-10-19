import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

const planner = { id: "planner", label: "My Agent", kind: "cloud", adapter: "caller", default: true };

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function runtimesFile(entries: unknown[]): string {
  dir = mkdtempSync(join(tmpdir(), "ambient-config-"));
  const file = join(dir, "runtimes.json");
  writeFileSync(file, JSON.stringify(entries));
  return file;
}

describe("readConfig", () => {
  it("reads runtimes from AMBIENT_RUNTIMES_FILE", () => {
    expect(readConfig({ AMBIENT_RUNTIMES_FILE: runtimesFile([planner, { id: "coder", label: "Coding Agent", adapter: "caller" }]) })).toMatchObject({
      port: 3000,
      defaultRuntimeId: "planner",
      allowUnauthenticated: false,
      runtimes: [planner, { id: "coder", label: "Coding Agent", kind: "local", adapter: "caller" }]
    });
  });

  it("reads an optional AssemblyAI API base next to the key", () => {
    const runtimes = runtimesFile([planner]);
    expect(readConfig({ AMBIENT_RUNTIMES_FILE: runtimes, ASSEMBLYAI_API_KEY: "k" }).assemblyAi).toEqual({ apiKey: "k" });
    expect(readConfig({ AMBIENT_RUNTIMES_FILE: runtimes, ASSEMBLYAI_API_KEY: "k", ASSEMBLYAI_API_BASE: "http://127.0.0.1:4000/v1/" }).assemblyAi)
      .toEqual({ apiKey: "k", apiBase: "http://127.0.0.1:4000/v1" });
  });

  it("captures LLM requests only when AMBIENT_CAPTURE_LLM_REQUESTS is set, under the data directory", () => {
    const runtimes = runtimesFile([planner]);
    expect(readConfig({ AMBIENT_RUNTIMES_FILE: runtimes })).not.toHaveProperty("captureDir");
    expect(readConfig({ AMBIENT_RUNTIMES_FILE: runtimes, AMBIENT_CAPTURE_LLM_REQUESTS: "0" })).not.toHaveProperty("captureDir");
    expect(readConfig({ AMBIENT_RUNTIMES_FILE: runtimes, AMBIENT_CAPTURE_LLM_REQUESTS: "1", AMBIENT_DATA_DIR: "data" }).captureDir).toBe(join("data", "captures"));
  });

  it("requires at least one runtime", () => {
    expect(() => readConfig({ AMBIENT_RUNTIMES_FILE: "/nonexistent/runtimes.json" })).toThrow("At least one runtime");
  });

  it("requires all OAuth values together", () => {
    expect(() => readConfig({ AMBIENT_RUNTIMES_FILE: runtimesFile([planner]), OAUTH_ISSUER: "https://ambient.example" })).toThrow("required together");
  });

  it("keeps cloud runtime selection explicit", () => {
    expect(readConfig({ AMBIENT_RUNTIMES_FILE: runtimesFile([planner]) }).runtimes[0]).toMatchObject({ kind: "cloud" });
  });

  it("keeps the Alexa skill application id separate from runtime credentials", () => {
    expect(readConfig({ AMBIENT_RUNTIMES_FILE: runtimesFile([planner]), ALEXA_SKILL_ID: "amzn1.ask.skill.example" })).toMatchObject({
      alexaSkillId: "amzn1.ask.skill.example"
    });
  });
});

describe("the shipped .env.example", () => {
  it("starts the server config when copied as is", async () => {
    const { readFileSync } = await import("node:fs");
    const env = Object.fromEntries(
      readFileSync(new URL("../.env.example", import.meta.url), "utf8")
        .split(/\r?\n/)
        .filter(line => /^[A-Z_]+=/.test(line))
        .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
    );
    expect(() => readConfig(env)).not.toThrow();
  });
});
