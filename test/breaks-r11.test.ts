import { describe, expect, it } from "vitest";
import { sameSpanishTime } from "../src/calls/language.js";
import { optsOut } from "../src/calls/rules.js";
import { moveRequest } from "../src/runtimes/caller.js";

describe("a business asking not to be called", () => {
  it.each([
    "Please don't call us with an AI.",
    "Take us off your list.",
    "Remove us from your list.",
    "Put us on your do not call list.",
    "Stop calling this number.",
    "Quit calling.",
    "No more calls, please.",
    "Please do not contact us.",
    "We don't want robots calling.",
    "Hang up and don't ever call again.",
    "Don’t call us again.",
    "No nos vuelva a llamar, por favor.",
    "No llamen más.",
    "Quítenos de su lista."
  ])("is heard: %s", text => {
    expect(optsOut(text)).toBe(true);
  });

  it.each([
    "Never call before nine, we open at nine.",
    "We stop calling at 5.",
    "Don't call the other number, call this one.",
    "Take me off speaker.",
    "Can you take us off hold?",
    "Don't call us back tomorrow, we'll call you.",
    "Please don't call me at home, use the office line.",
    "We don't call customers on Sundays.",
    "Sorry, we're slammed today, can you call back tomorrow?"
  ])("is not heard in an ordinary line: %s", text => {
    expect(optsOut(text)).toBe(false);
  });
});

describe("a Spanish read-back", () => {
  it.each([
    ["el martes 20 a las 9 de la mañana", "Tuesday the 20th at 9 am"],
    ["el miércoles 21 a las 3 de la tarde", "Wednesday the 21st at 3 pm"],
    ["mañana a las 10", "tomorrow at 10 am"]
  ])("matches the English booking: %s", (spoken, when) => {
    expect(sameSpanishTime(spoken, when)).toBe(true);
  });

  it.each([
    ["el martes a las 10", "Wednesday at 3 pm"],
    ["el martes 20 a las 9 de la mañana", "Tuesday the 20th at 9 pm"],
    ["el martes 20 a las 9", "Tuesday the 21st at 9 am"],
    ["el lunes a las 9", "Tuesday at 9 am"]
  ])("does not match a different time: %s vs %s", (spoken, when) => {
    expect(sameSpanishTime(spoken, when)).toBe(false);
  });
});

describe("a request to move a booking", () => {
  it.each([
    ["Move my plumber booking to Thursday", "Thursday"],
    ["Move my booking to Thursday", "Thursday"],
    ["Please reschedule the appointment to Friday at 3 pm.", "Friday at 3 pm"],
    ["Move it to Thursday", "Thursday"]
  ])("is a move: %s", (text, to) => {
    expect(moveRequest(text)?.to).toBe(to);
  });

  it("names the trade it is about, so a dentist request never moves a plumber", () => {
    expect(moveRequest("Move my dentist appointment to Friday")).toEqual({ to: "Friday", about: "dentist" });
  });

  it.each([
    "Change the kitchen faucet to a new model and call Joe's Plumbing, under 150",
    "Call Joe's Plumbing to move the sink to the other wall"
  ])("is not a move: %s", text => {
    expect(moveRequest(text)).toBeUndefined();
  });
});
