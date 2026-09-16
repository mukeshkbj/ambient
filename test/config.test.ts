import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

describe("readConfig", () => {
  it("allows a local Hermes URL without OAuth during development", () => {
    expect(readConfig({ HERMES_WS_URL: "ws://127.0.0.1:9119/api/ws" })).toMatchObject({
      port: 3000,
      runtimeId: "local",
      hermesWsUrl: "ws://127.0.0.1:9119/api/ws",
      allowUnauthenticated: false
    });
  });

  it("requires all OAuth values together", () => {
    expect(() => readConfig({ OAUTH_ISSUER: "https://ambient.example" })).toThrow("required together");
  });

  it("keeps cloud runtime selection explicit", () => {
    expect(readConfig({ HERMES_RUNTIME_KIND: "cloud", HERMES_WS_URL: "wss://hermes.example/api/ws" })).toMatchObject({
      runtimeKind: "cloud",
      hermesWsUrl: "wss://hermes.example/api/ws"
    });
  });

  it("keeps the Alexa skill application id separate from runtime credentials", () => {
    expect(readConfig({ HERMES_WS_URL: "ws://127.0.0.1:9119/api/ws", ALEXA_SKILL_ID: "amzn1.ask.skill.example" })).toMatchObject({
      alexaSkillId: "amzn1.ask.skill.example"
    });
  });
});
