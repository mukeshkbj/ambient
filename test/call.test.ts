import { describe, expect, it } from "vitest";
import { scriptedBrain, type Brain } from "../src/calls/brain.js";
import { runCall, type CallHandle } from "../src/calls/call.js";
import { DEMO_SCRIPT, JOES_PLUMBING, JOES_PLUMBING_HANGS_UP } from "../src/calls/demo.js";
import { simulatedLine, type BusinessPersona } from "../src/calls/line.js";
import { parsePhoneNumber, type CallBrief } from "../src/calls/types.js";
import type { AssistantEvent } from "../src/runtimes/types.js";

const brief: CallBrief = {
  goal: "Call Joe's Plumbing and book a visit under 150",
  business: { name: "Joe's Plumbing", phone: parsePhoneNumber("4155550134") },
  ownerName: "Maya",
  maxUsd: 150,
  facts: ["The address is 12 Elm Street"]
};

function start(persona: BusinessPersona = JOES_PLUMBING, brain: Brain = scriptedBrain(DEMO_SCRIPT)) {
  const events: AssistantEvent[] = [];
  const spoken: string[] = [];
  const line = simulatedLine(persona, { speedMs: 1 });
  const say = line.say.bind(line);
  line.say = (text, last) => {
    spoken.push(text);
    say(text, last);
  };
  const call = runCall({ brief, callId: "call-1", line, brain, emit: event => events.push(event), tickMs: 5, log: () => {} });
  return { call, events, spoken };
}

async function until(call: CallHandle, phase: string): Promise<void> {
  for (let tries = 0; tries < 400 && call.state().phase.kind !== phase; tries++) await new Promise(resolve => setTimeout(resolve, 2));
  expect(call.state().phase.kind).toBe(phase);
}

const approvalRequest = (events: AssistantEvent[]) => events.find(event => event.type === "approval.request");

describe("runCall with the simulated line", () => {
  it("asks the owner when the quote is over the limit", async () => {
    const { call, events } = start();
    await until(call, "waiting_for_owner");
    expect(approvalRequest(events)?.payload).toMatchObject({ amountUsd: 180, kind: "spend" });
    expect(call.state().turns[0]).toMatchObject({ speaker: "agent", text: "Hi, this is an AI assistant calling for Maya. This call is transcribed." });
    call.hangUp();
  });

  it("confirms at the owner's counter-offer after a steer", async () => {
    const { call, spoken } = start();
    await until(call, "waiting_for_owner");
    call.ownerSaid("offer 160");
    const final = await call.done;
    expect(final.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 160, when: "Tuesday at ten" } });
    expect(spoken.join("")).toContain("one hundred sixty dollars");
    expect(final.turns.some(turn => turn.speaker === "business" && /one sixty works/i.test(turn.text))).toBe(true);
    expect(final.turns.some(turn => turn.speaker === "owner" && turn.text === "offer 160")).toBe(true);
  });

  it("confirms at the quoted price after the owner approves", async () => {
    const { call, events } = start();
    await until(call, "waiting_for_owner");
    const requestId = String(approvalRequest(events)?.payload.requestId);
    expect(call.ownerDecided(requestId, "once")).toBe(true);
    const final = await call.done;
    expect(final.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 180 } });
  });

  it("ends without a deal when the owner declines", async () => {
    const { call, events } = start();
    await until(call, "waiting_for_owner");
    call.ownerDecided(String(approvalRequest(events)?.payload.requestId), "deny");
    expect((await call.done).phase).toMatchObject({ kind: "ended", outcome: { kind: "no_deal" } });
  });

  it("ends unconfirmed when the business hangs up after quoting", async () => {
    const { call, events } = start(JOES_PLUMBING_HANGS_UP);
    const final = await call.done;
    expect(final.phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed" } });
    expect(events.filter(event => event.type === "message.complete")).toHaveLength(1);
  });

  it("ends unconfirmed when the owner cancels mid-call", async () => {
    const { call } = start();
    await until(call, "waiting_for_owner");
    call.hangUp();
    expect((await call.done).phase).toMatchObject({ kind: "ended", outcome: { kind: "unconfirmed" } });
  });

  it("says the holding line once and does not repeat it within fifteen seconds", async () => {
    const { call, spoken } = start();
    await until(call, "waiting_for_owner");
    const before = spoken.length;
    expect(spoken.at(-1)).toBe("One moment, let me check with Maya.");
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(spoken.length).toBe(before);
    call.hangUp();
  });

  it("ends the call honestly when the brain fails", async () => {
    const failing: Brain = {
      respond: () => ({
        [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("overloaded")) })
      })
    };
    const { call } = start(JOES_PLUMBING, failing);
    const final = await call.done;
    expect(final.phase).toMatchObject({ kind: "ended", outcome: { kind: "no_deal" } });
  });
});
