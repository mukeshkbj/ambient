import { describe, expect, it } from "vitest";
import { errandStep, startErrand, type ErrandEffect, type ErrandInput, type ErrandState } from "../src/calls/errand.js";

const NOW = "2026-10-19T10:00:00.000Z";
const three = () => startErrand({ limitUsd: 150, calls: [{ callId: "a", business: "Joe's Plumbing" }, { callId: "b", business: "Pete's Pipes" }, { callId: "c", business: "Drain Bros" }] });
const quoted = (callId: string, amountUsd: number | undefined, when = "Tuesday the 20th at 10 am"): ErrandInput => ({ kind: "quoted", callId, requestId: `${callId}:ask-1`, ...(amountUsd !== undefined ? { amountUsd } : {}), when });
const confirmed = (callId: string): ErrandInput => ({ kind: "ended", callId, outcome: { kind: "confirmed", summary: "booked" } });
const noDeal = (callId: string): ErrandInput => ({ kind: "ended", callId, outcome: { kind: "no_deal", reason: "released" } });

function play(state: ErrandState, inputs: ErrandInput[]): { state: ErrandState; effects: ErrandEffect[] } {
  const effects: ErrandEffect[] = [];
  for (const input of inputs) {
    const result = errandStep(state, input, NOW);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

const approvals = (effects: ErrandEffect[]) => effects.filter(effect => effect.kind === "approve").map(effect => effect.kind === "approve" ? effect.callId : "");
const releases = (effects: ErrandEffect[]) => effects.filter(effect => effect.kind === "release").map(effect => effect.kind === "release" ? effect.callId : "").sort();

describe("errand", () => {
  it("waits for every business before choosing", () => {
    expect(play(three(), [quoted("a", 140), quoted("b", 120)]).effects).toEqual([]);
  });

  it("books the cheapest quote within the limit and releases the others", () => {
    const { effects } = play(three(), [quoted("a", 140), quoted("b", 120), quoted("c", 135)]);
    expect(approvals(effects)).toEqual(["b"]);
    expect(releases(effects)).toEqual(["a", "c"]);
  });

  it("chooses among the quotes it has once the others have ended", () => {
    const { effects } = play(three(), [quoted("a", 140), { kind: "ended", callId: "b", outcome: { kind: "unconfirmed", reason: "nobody picked up" } }, quoted("c", 145)]);
    expect(approvals(effects)).toEqual(["a"]);
    expect(releases(effects)).toEqual(["c"]);
  });

  it("chooses at the deadline with the quotes it has", () => {
    const { effects } = play(three(), [quoted("a", 140), quoted("c", 130), { kind: "deadline" }]);
    expect(approvals(effects)).toEqual(["c"]);
    expect(releases(effects)).toEqual(["a"]);
  });

  it("releases a quote that arrives after the choice", () => {
    const { effects } = play(three(), [quoted("a", 140), quoted("c", 130), { kind: "deadline" }, quoted("b", 90)]);
    expect(approvals(effects)).toEqual(["c"]);
    expect(releases(effects)).toEqual(["a", "b"]);
  });

  it("asks the owner about the cheapest quote when every quote is over the limit", () => {
    const { state, effects } = play(three(), [quoted("a", 190), quoted("b", 170), quoted("c", 180)]);
    expect(approvals(effects)).toEqual([]);
    expect(effects).toContainEqual(expect.objectContaining({ kind: "ask_owner", callId: "b", amountUsd: 170 }));
    expect(releases(effects)).toEqual(["a", "c"]);
    expect(approvals(play(state, [{ kind: "owner_decided", decision: "once" }]).effects)).toEqual(["b"]);
    expect(releases(play(state, [{ kind: "owner_decided", decision: "deny" }]).effects)).toEqual(["b"]);
  });

  it("never books a quote with no price without the owner", () => {
    const { effects } = play(three(), [quoted("a", undefined), noDeal("b"), noDeal("c")]);
    expect(approvals(effects)).toEqual([]);
    expect(effects).toContainEqual(expect.objectContaining({ kind: "ask_owner", callId: "a" }));
  });

  it("ends with the winner's booking once every call has ended", () => {
    const { effects } = play(three(), [quoted("a", 140), quoted("b", 120), quoted("c", 135), noDeal("a"), noDeal("c"), confirmed("b")]);
    expect(effects.at(-1)).toEqual({ kind: "done", booked: "b" });
  });

  it("ends with no booking when nobody quoted", () => {
    const { effects } = play(three(), [noDeal("a"), noDeal("b"), noDeal("c")]);
    expect(effects).toEqual([{ kind: "done" }]);
  });

  it("holds every rule across 4,000 random orderings of three businesses", () => {
    for (let seed = 1; seed <= 4000; seed++) {
      let rand = seed;
      const next = () => (rand = (rand * 1103515245 + 12345) % 2147483648) / 2147483648;
      const limit = 100 + Math.floor(next() * 100);
      let state = three();
      const effects: ErrandEffect[] = [];
      const prices = new Map<string, number | undefined>();
      const owner: Array<"once" | "deny"> = [];
      const pending = ["a", "b", "c"].flatMap(callId => {
        const steps: ErrandInput[] = [];
        if (next() < 0.8) {
          const amount = next() < 0.1 ? undefined : 60 + Math.floor(next() * 160);
          prices.set(callId, amount);
          steps.push(quoted(callId, amount));
        }
        steps.push(next() < 0.5 ? confirmed(callId) : noDeal(callId));
        return [steps];
      });
      state = { ...state, limitUsd: limit };
      const order: ErrandInput[] = [];
      while (pending.some(steps => steps.length > 0)) {
        if (next() < 0.1) order.push({ kind: "deadline" });
        if (next() < 0.1) {
          const decision = next() < 0.5 ? "once" : "deny";
          owner.push(decision);
          order.push({ kind: "owner_decided", decision });
        }
        const live = pending.filter(steps => steps.length > 0);
        order.push(live[Math.floor(next() * live.length)]!.shift()!);
      }
      for (const input of order) {
        const result = errandStep(state, input, NOW);
        state = result.state;
        effects.push(...result.effects);
        if (state.decided) expect(state.calls.filter(call => call.status === "quoted"), `seed ${seed}: a call was left on hold`).toEqual([]);
      }
      const approved = approvals(effects);
      expect(approved.length, `seed ${seed}`).toBeLessThanOrEqual(1);
      const asked = effects.filter(effect => effect.kind === "ask_owner").map(effect => effect.kind === "ask_owner" ? effect.callId : "");
      for (const callId of approved) {
        const amount = prices.get(callId);
        const withinLimit = amount !== undefined && amount <= limit;
        expect(withinLimit || (asked.includes(callId) && owner.includes("once")), `seed ${seed}: approved ${callId} at ${amount} over ${limit}`).toBe(true);
      }
      expect(effects.filter(effect => effect.kind === "done"), `seed ${seed}`).toHaveLength(1);
    }
  });
});
