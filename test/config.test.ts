import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

describe("readConfig", () => {
  it("allows a local Hermes URL without OAuth during development", () => {
    expect(readConfig({ HERMES_WS_URL: "ws://127.0.0.1:9119/api/ws" })).toMatchObject({
      port: 3000,
      defaultRuntimeId: "local",
      allowUnauthenticated: false,
      runtimes: [{ id: "local", adapter: "hermes", endpoint: "ws://127.0.0.1:9119/api/ws", tokenEnv: "HERMES_WS_TOKEN" }]
    });
  });

  it("requires at least one runtime", () => {
    expect(() => readConfig({ AMBIENT_RUNTIMES_FILE: "/nonexistent/runtimes.json" })).toThrow("At least one runtime");
  });

  it("requires all OAuth values together", () => {
    expect(() => readConfig({ HERMES_WS_URL: "ws://127.0.0.1:9119/api/ws", OAUTH_ISSUER: "https://ambient.example" })).toThrow("required together");
  });

  it("keeps cloud runtime selection explicit", () => {
    expect(readConfig({ HERMES_RUNTIME_KIND: "cloud", HERMES_WS_URL: "wss://hermes.example/api/ws" }).runtimes[0]).toMatchObject({
      kind: "cloud",
      endpoint: "wss://hermes.example/api/ws"
    });
  });

  it("keeps the Alexa skill application id separate from runtime credentials", () => {
    expect(readConfig({ HERMES_WS_URL: "ws://127.0.0.1:9119/api/ws", ALEXA_SKILL_ID: "amzn1.ask.skill.example" })).toMatchObject({
      alexaSkillId: "amzn1.ask.skill.example"
    });
  });
});
