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
