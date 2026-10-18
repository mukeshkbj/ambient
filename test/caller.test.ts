import { describe, expect, it } from "vitest";
import { scriptedBrain } from "../src/calls/brain.js";
import { DEMO_SCRIPT, JOES_PLUMBING, JOES_PLUMBING_HANGS_UP } from "../src/calls/demo.js";
import { simulatedLine, type BusinessPersona } from "../src/calls/line.js";
import { parsePhoneNumber } from "../src/calls/types.js";
import { ConversationEngine } from "../src/conversations.js";
import { CallerClient, spendingLimit } from "../src/runtimes/caller.js";
import { AmbientStore } from "../src/store.js";
import type { RunView } from "../src/types.js";
import { speak } from "../src/voice.js";

function setup(persona: BusinessPersona = JOES_PLUMBING) {
  const client = new CallerClient({
    household: { ownerName: "Maya", address: "12 Elm Street", maxUsdDefault: 200, facts: [] },
    business: { name: "Joe's Plumbing", phone: parsePhoneNumber("4155550134") },
    line: () => simulatedLine(persona, { speedMs: 1 }),
    brain: scriptedBrain(DEMO_SCRIPT),
    tickMs: 5
  });
  const store = new AmbientStore();
  const engine = new ConversationEngine(client, store, {
    runtime: { id: "caller", label: "Ambient", kind: "cloud", state: "unknown", updatedAt: new Date().toISOString() }
  });
  return { client, store, engine, close: () => { client.close(); engine.close(); store.close(); } };
}

async function until(engine: ConversationEngine, runId: string, done: (view: RunView) => boolean): Promise<RunView> {
  for (let tries = 0; tries < 500; tries++) {
    const view = engine.getWork(runId);
    if (done(view)) return view;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  return engine.getWork(runId);
}

describe("CallerClient through the engine", () => {
  it("reaches waiting_approval with the over-limit amount", async () => {
    const { engine, close } = setup();
    const run = await engine.ask("Call Joe's Plumbing and book a visit under 150", undefined, true);
    const view = await until(engine, run.id, item => item.status === "waiting_approval");
    expect(view.status).toBe("waiting_approval");
    expect(view.approval).toMatchObject({ amountUsd: 180, kind: "spend" });
    close();
  });

  it("completes confirmed at the steered price with no approval left open", async () => {
    const { engine, store, close } = setup();
    const run = await engine.ask("Call Joe's Plumbing and book a visit under 150", undefined, true);
    await until(engine, run.id, item => item.status === "waiting_approval");
    await engine.steer(run.id, "offer 160");
    const view = await until(engine, run.id, item => item.status === "completed");
    expect(view).toMatchObject({ status: "completed", outcome: { kind: "confirmed", amountUsd: 160 } });
    expect(view.approval).toBeUndefined();
    expect(store.listApprovals?.("caller") ?? []).toEqual([]);
    expect(view.steps.some(line => /Joe's Plumbing: .*one sixty works/i.test(line))).toBe(true);
    expect(view.steps).toContain("Maya: offer 160");
    close();
  });

  it("completes confirmed at the quoted price when approved", async () => {
    const { engine, close } = setup();
    const run = await engine.ask("Call Joe's Plumbing and book a visit under 150", undefined, true);
    const waiting = await until(engine, run.id, item => item.status === "waiting_approval");
    await engine.respondToApproval(waiting.approval!.id, "once");
    const view = await until(engine, run.id, item => item.status === "completed");
    expect(view.outcome).toMatchObject({ kind: "confirmed", amountUsd: 180 });
    close();
  });

  it("speaks an honest unconfirmed result when the business hangs up", async () => {
    const { engine, close } = setup(JOES_PLUMBING_HANGS_UP);
    const run = await engine.ask("Call Joe's Plumbing and book a visit under 150", undefined, true);
    const view = await until(engine, run.id, item => item.status === "completed");
    expect(view.outcome?.kind).toBe("unconfirmed");
    expect(speak(view, { label: "Ambient", state: "online" })).toContain("The call ended before they confirmed, so I won't assume it's booked.");
    close();
  });

  it("hangs up and marks the run cancelled on cancel", async () => {
    const { engine, close } = setup();
    const run = await engine.ask("Call Joe's Plumbing and book a visit under 150", undefined, true);
    await until(engine, run.id, item => item.status === "waiting_approval");
    await engine.cancel(run.id);
    const view = await until(engine, run.id, item => item.status === "cancelled");
    expect(view.status).toBe("cancelled");
    close();
  });

  it("uses the household default limit when the instruction names none", async () => {
    const { engine, close } = setup();
    const run = await engine.ask("Call Joe's Plumbing and book a visit", undefined, true);
    const view = await until(engine, run.id, item => item.status === "completed" || item.status === "waiting_approval");
    expect(view).toMatchObject({ status: "completed", outcome: { kind: "confirmed", amountUsd: 180 } });
    close();
  });
});

describe("spendingLimit", () => {
  it.each([
    ["book a visit under 150", 150],
    ["no more than $200 please", 200],
    ["keep it under one fifty", 150],
    ["up to 90 dollars", 90],
    ["book a visit", undefined]
  ] as const)("%s", (text, expected) => {
    expect(spendingLimit(text)).toBe(expected);
  });
});
