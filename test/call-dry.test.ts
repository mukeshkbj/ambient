import { expect, it } from "vitest";
import { disclosure } from "../src/calls/rules.js";
import { runCallDry } from "../scripts/call-dry.js";

it("runs a whole call through the real routes against a fake AssemblyAI over real sockets", async () => {
  const result = await runCallDry({ log: () => {} });
  expect(result.transcript[0]).toBe(`Ambient: ${disclosure("Maya")}`);
  expect(result.transcript).toContain("Joe's Plumbing: Yes, plus parts.");
  expect(result.summary).toMatch(/one hundred eighty dollars/);
  expect(result.requestShape).toMatch(/our assumption/);
}, 15_000);
