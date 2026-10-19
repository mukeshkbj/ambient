import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../src/calls/scenarios.js";
import { runScenario } from "../scripts/scenarios.js";

const named = (title: RegExp) => SCENARIOS.find(scenario => title.test(scenario.title))!;

describe("scenarios through the real reducer", () => {
  it("asks about a missing price, reads back \"no price is set\", then books", async () => {
    const { outcome, transcript, asked } = await runScenario(named(/vet/i));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/gave no price/);
    expect(transcript.some(line => line.startsWith("Ambient: Just to confirm: no price is set"))).toBe(true);
    expect(outcome).toMatchObject({ kind: "confirmed", when: "Thursday the twenty-second at 3 pm" });
    expect(outcome).not.toHaveProperty("amountUsd");
  });

  it("ends unconfirmed after three hedged read-backs and never books", async () => {
    const { outcome, transcript } = await runScenario(named(/hedg/i));
    expect(outcome).toEqual({ kind: "unconfirmed", reason: "they never clearly confirmed it" });
    expect(transcript.filter(line => line.startsWith("Ambient: ") && /^Ambient: (Just to confirm|Let me check once more|Once more):/.test(line))).toHaveLength(3);
  });

  it("ends unconfirmed when nobody answers", async () => {
    const { outcome, transcript } = await runScenario(named(/no answer/i));
    expect(outcome).toEqual({ kind: "unconfirmed", reason: "no answer" });
    expect(transcript).toEqual([]);
  });

  it("ends with no deal when the owner declines the over-limit price", async () => {
    const { outcome, asked } = await runScenario(named(/declin/i));
    expect(asked[0]).toMatch(/one hundred eighty dollars/);
    expect(outcome).toMatchObject({ kind: "no_deal", reason: expect.stringMatching(/declined/) });
  });

  it("holds every scenario to its stated expectation", async () => {
    for (const scenario of SCENARIOS) {
      const { outcome, transcript } = await runScenario(scenario);
      expect(outcome.kind, scenario.title).toBe(scenario.expect.kind);
      for (const pattern of scenario.expect.transcript) expect(transcript.join("\n"), scenario.title).toMatch(pattern);
    }
  });
});
