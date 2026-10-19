import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tryToFool } from "../src/calls/fool.js";

describe("the simulator's try-to-fool panel", () => {
  it("shows the read-back the reducer really speaks, in both languages", () => {
    const html = readFileSync(new URL("../web/sim/index.html", import.meta.url), "utf8");
    expect(html).toContain(`data-en="${tryToFool("x").readBack}"`);
    expect(html).toContain(`data-es="${tryToFool("x", "es").readBack}"`);
  });
});

describe("try to fool the read-back", () => {
  it.each([
    ["Yes, that's right. See you then.", "booked", "It is a clean yes to the exact terms that were read back."],
    ["Yes, plus parts.", "not_booked", "It adds words that can change the deal: \"plus parts\"."],
    ["Sure, one eighty.", "not_booked", "It has a number that was not read back: \"one eighty\"."],
    ["Is that with tax?", "not_booked", "It is a question."],
    ["Yes, Wednesday at ten.", "not_booked", "It names a day that was not read back: \"wednesday\"."],
    ["Yes, we may.", "not_booked", "It adds words that can change the deal: \"we may\"."],
    ["Probably.", "not_booked", "It has no word of agreement."],
    ["Take us off your list.", "opted_out", "The business asked not to be called. Ambient ends the call and never calls this number again."]
  ] as const)("answers %j as the call reducer would: %s", (reply, result, why) => {
    expect(tryToFool(reply)).toEqual({ readBack: "Okay, so just to confirm, one hundred sixty dollars total, Tuesday the 20th at 10 am. Is that right?", reply, result, why });
  });

  it.each([
    ["Sí, correcto.", "booked"],
    ["Sí, más IVA.", "not_booked"],
    ["¿Con IVA?", "not_booked"]
  ] as const)("answers the Spanish read-back %j as the call reducer would: %s", (reply, result) => {
    const attempt = tryToFool(reply, "es");
    expect(attempt.readBack).toBe("Muy bien, para confirmar, ciento veinte dólares en total, el martes 20 a las 9 de la mañana. ¿Es correcto?");
    expect(attempt.result).toBe(result);
  });
});
