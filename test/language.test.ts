import { describe, expect, it } from "vitest";
import { agreesInSpanish, plainSpanishTime, spanishPrice } from "../src/calls/language.js";

describe("Spanish read-back replies", () => {
  it.each([
    "Sí, correcto.",
    "Sí.",
    "Así es, muchas gracias.",
    "Correcto, nos vemos.",
    "De acuerdo.",
    "Sí, está bien, gracias.",
    "Sí, claro.",
    "Vale.",
    "Está bien.",
    "Si, correcto."
  ])("books on a clean yes: %s", reply => {
    expect(agreesInSpanish(reply)).toBe(true);
  });

  it.each([
    "Sí, más las piezas.",
    "Sí, pero el miércoles.",
    "Sí, ciento veinte.",
    "No, el martes no.",
    "¿Cómo dice?",
    "Creo que sí.",
    "Sí, aparte del material.",
    "Sí, con depósito.",
    "Bueno, déjeme ver.",
    "Si puedo, sí.",
    "Claro, pero más tarde.",
    "Vale, ciento sesenta."
  ])("does not book: %s", reply => {
    expect(agreesInSpanish(reply)).toBe(false);
  });
});

describe("Spanish times in a read-back", () => {
  it.each(["el martes 20 a las 9 de la mañana", "el miércoles 21 a las 3 de la tarde", "mañana a las 10"])("accepts a plain day and time: %s", when => {
    expect(plainSpanishTime(when)).toBe(true);
  });

  it.each(["el martes, más el material", "a las 9, con un depósito de 50", "cuando pueda"])("rejects anything else: %s", when => {
    expect(plainSpanishTime(when)).toBe(false);
  });
});

describe("Spanish prices", () => {
  it.each([
    [120, "ciento veinte dólares"],
    [100, "cien dólares"],
    [1, "un dólar"],
    [125, "ciento veinticinco dólares"],
    [160, "ciento sesenta dólares"],
    [231, "doscientos treinta y un dólares"],
    [999, "novecientos noventa y nueve dólares"]
  ])("says %d as %s", (amount, words) => {
    expect(spanishPrice(amount)).toBe(words);
  });
});
