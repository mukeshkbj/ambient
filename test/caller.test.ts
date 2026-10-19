import { describe, expect, it } from "vitest";
import { scriptedBrain, type Brain } from "../src/calls/brain.js";
import type { Candidate } from "../src/calls/discover.js";
import { AROUND, DEMO_SCRIPT, JOES_PLUMBING, JOES_PLUMBING_HANGS_UP } from "../src/calls/demo.js";
import { simulatedLine, type BusinessPersona, type Line } from "../src/calls/line.js";
import { parsePhoneNumber } from "../src/calls/types.js";
import { ConversationEngine } from "../src/conversations.js";
import { CallerClient, spendingLimit } from "../src/runtimes/caller.js";
import { AmbientStore } from "../src/store.js";
import type { RunView } from "../src/types.js";
import { speak } from "../src/voice.js";

function setup(persona: BusinessPersona = JOES_PLUMBING, options: { discover?: () => Promise<Candidate[]>; memory?: boolean; brain?: Brain; limitDials?: boolean; personas?: BusinessPersona[] } = {}) {
  const store = new AmbientStore();
  const client = new CallerClient({
    household: { ownerName: "Maya", address: "12 Elm Street", maxUsdDefault: 200, facts: [] },
    business: { name: "Joe's Plumbing", phone: parsePhoneNumber("4155550134") },
    line: business => simulatedLine(options.personas?.find(item => item.name === business.name) ?? persona, { speedMs: 1 }),
    brain: options.brain ?? scriptedBrain(DEMO_SCRIPT),
    tickMs: 5,
    ...(options.discover ? { discover: options.discover } : {}),
    ...(options.memory ? { memory: store } : {}),
    ...(options.limitDials !== undefined ? { limitDials: options.limitDials } : {})
  });
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
    expect(view.steps.some(line => /Joe's Plumbing: .*one sixty\. Alright, that works/i.test(line))).toBe(true);
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
    expect(speak(view, { label: "Ambient", state: "online" })).toContain("I can't confirm a booking with Joe's Plumbing: the line ended before they confirmed. Check with them before you try again.");
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

describe("CallerClient discovery and memory", () => {
  it("asks to dial the first candidate and moves to the next on deny", async () => {
    const { engine, close } = setup(JOES_PLUMBING, {
      discover: async () => [
        { name: "Pete's Pipes", phone: parsePhoneNumber("4155550199"), why: "Rated for same-week visits" },
        { name: "Roto Ruth", phone: parsePhoneNumber("4155550177"), why: "Open weekends" }
      ]
    });
    const run = await engine.ask("find a plumber for tomorrow", undefined, true);
    const first = await until(engine, run.id, item => item.status === "waiting_approval");
    expect(first.approval).toMatchObject({ kind: "dial" });
    expect(first.approval?.command).toContain("Pete's Pipes");
    await engine.respondToApproval(first.approval!.id, "deny");
    const second = await until(engine, run.id, item => item.approval?.command.includes("Roto Ruth") === true);
    expect(second.approval).toMatchObject({ kind: "dial" });
    close();
  });

  it("shows what it remembers from the last call to the same business", async () => {
    const { engine, close } = setup(JOES_PLUMBING, { memory: true });
    const first = await engine.ask("Call Joe's Plumbing and book a visit", undefined, true);
    await until(engine, first.id, item => item.status === "completed");
    const second = await engine.ask("Call Joe's Plumbing again", undefined, true);
    const view = await until(engine, second.id, item => item.steps.some(step => step.startsWith("Remembered from")));
    expect(view.steps.find(step => step.startsWith("Remembered from"))).toMatch(/— confirmed, quoted one hundred eighty dollars/);
    close();
  });

  it("never calls a business again after it asked not to be called by an AI", async () => {
    const optOut: BusinessPersona = { ...JOES_PLUMBING, rules: [{ when: /\b(sink|leak|visit|plumb)/i, reply: "Take us off your list, we don't take AI calls." }] };
    const { engine, close } = setup(optOut, { memory: true });
    const first = await engine.ask("Call Joe's Plumbing and book a visit", undefined, true);
    expect((await until(engine, first.id, item => item.status === "completed")).outcome).toEqual({ kind: "declined", reason: "they asked not to be called by an AI" });
    const second = await engine.ask("Call Joe's Plumbing again", undefined, true);
    const view = await until(engine, second.id, item => item.status === "completed");
    expect(view.outcome).toEqual({ kind: "no_deal", reason: "they asked not to be called by an AI" });
    expect(view.steps.some(line => line.startsWith("Calling "))).toBe(false);
    close();
  });

  it("never dials a premium-rate number, even with dial limits off", async () => {
    const { engine, close } = setup(JOES_PLUMBING, { discover: async () => [], limitDials: false });
    const run = await engine.ask("call 1-900-555-0100 and book a visit", undefined, true);
    const view = await until(engine, run.id, item => item.status === "completed");
    expect(view.outcome).toMatchObject({ kind: "no_deal", reason: "premium-rate number" });
    expect(view.steps.some(line => line.includes("Connected to"))).toBe(false);
    close();
  });

  it("dials a number given in the instruction with no dial approval", async () => {
    const { client, engine, close } = setup(JOES_PLUMBING, { discover: async () => [] });
    const dialRequests: string[] = [];
    client.onEvent(event => {
      if (event.type === "approval.request" && event.payload.kind === "dial") dialRequests.push(event.payload.requestId);
    });
    const run = await engine.ask("call 415 555 0100 and book a visit", undefined, true);
    const view = await until(engine, run.id, item => item.status === "completed");
    expect(view.outcome).toMatchObject({ kind: "confirmed" });
    expect(dialRequests).toEqual([]);
    close();
  });

  it("includes the last outcome in the next brief for the same number", async () => {
    const seen: string[][] = [];
    const memory = new AmbientStore();
    const client = new CallerClient({
      household: { ownerName: "Maya", address: "12 Elm Street", maxUsdDefault: 200, facts: [] },
      business: { name: "Joe's Plumbing", phone: parsePhoneNumber("4155550134") },
      line: () => simulatedLine(JOES_PLUMBING, { speedMs: 1 }),
      brain: {
        respond: (state, signal) => {
          seen.push(state.brief.facts);
          return scriptedBrain(DEMO_SCRIPT).respond(state, signal);
        }
      },
      memory,
      tickMs: 5
    });
    const engine = new ConversationEngine(client, memory, {
      runtime: { id: "caller", label: "Ambient", kind: "cloud", state: "unknown", updatedAt: new Date().toISOString() }
    });
    const first = await engine.ask("Call Joe's Plumbing and book a visit", undefined, true);
    await until(engine, first.id, item => item.status === "completed");
    const second = await engine.ask("Call Joe's Plumbing and book a visit", undefined, true);
    await until(engine, second.id, item => item.status === "completed");
    expect(seen.flat().some(fact => fact.startsWith("Noted on an earlier call:") && fact.includes("quoted") && fact.includes("one hundred eighty"))).toBe(true);
    client.close();
    engine.close();
    memory.close();
  });

  it("counts calls still in progress against the daily limit", async () => {
    const silent: Line = { dial: () => Promise.resolve(), say: () => {}, hangUp: () => {}, onInput: () => () => {} };
    const store = new AmbientStore();
    const client = new CallerClient({
      household: { ownerName: "Maya", maxUsdDefault: 200, facts: [] },
      business: { name: "Joe's Plumbing", phone: parsePhoneNumber("4155550134") },
      line: () => silent,
      brain: scriptedBrain(DEMO_SCRIPT),
      memory: store
    });
    const outcomes: unknown[] = [];
    client.onEvent(event => { if (event.type === "message.complete") outcomes.push(event.payload.outcome); });
    for (let index = 0; index < 4; index++) {
      const session = await client.createSession();
      await client.submitPrompt(session.runtimeSessionId, "Call Joe's Plumbing");
    }
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(outcomes).toEqual([{ kind: "no_deal", reason: "call limit reached" }]);
    client.close();
    store.close();
  });

  it("stops looking for a business when the run is cancelled mid-search", async () => {
    let finish: (value: Candidate[]) => void = () => {};
    const { client, engine, close } = setup(JOES_PLUMBING, { discover: () => new Promise(resolve => { finish = resolve; }) });
    const dials: string[] = [];
    client.onEvent(event => { if (event.type === "approval.request") dials.push(event.payload.requestId); });
    const run = await engine.ask("find a plumber for tomorrow", undefined, true);
    await engine.cancel(run.id);
    finish([{ name: "Pete's Pipes", phone: parsePhoneNumber("4155550199"), why: "Close by" }]);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(dials).toEqual([]);
    close();
  });

  it("does not limit calls to the simulated business", async () => {
    const { engine, close } = setup(JOES_PLUMBING, { memory: true, limitDials: false });
    for (let index = 0; index < 4; index++) {
      const run = await engine.ask("Call Joe's Plumbing and book a visit", undefined, true);
      const view = await until(engine, run.id, item => item.status === "completed");
      expect(view.outcome).toMatchObject({ kind: "confirmed" });
    }
    close();
  });

  it("ends no_deal at the per-number daily limit without dialing", async () => {
    const { engine, store, close } = setup(JOES_PLUMBING, { memory: true });
    for (let index = 0; index < 3; index++) {
      const run = await engine.ask("Call Joe's Plumbing and book a visit", undefined, true);
      await until(engine, run.id, item => item.status === "completed");
    }
    const run = await engine.ask("Call Joe's Plumbing and book a visit", undefined, true);
    const view = await until(engine, run.id, item => item.status === "completed");
    expect(view.outcome).toMatchObject({ kind: "no_deal", reason: "call limit reached" });
    expect(view.steps.some(line => line.includes("Connected to"))).toBe(false);
    expect(store.history(parsePhoneNumber("4155550134"))).toHaveLength(3);
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

describe("CallerClient calling around", () => {
  const around = () => setup(JOES_PLUMBING, { discover: async () => AROUND.map(item => item.candidate), personas: AROUND.map(item => item.persona) });

  it("asks once to call every business it found", async () => {
    const { engine, close } = around();
    const run = await engine.ask("Get quotes from plumbers to fix the kitchen sink, under 150", undefined, true);
    const ask = await until(engine, run.id, item => item.status === "waiting_approval");
    expect(ask.approval).toMatchObject({ kind: "dial" });
    expect(ask.approval?.command).toBe("I found Pete's Pipes, Drain Bros and Rapid Rooter. Call all three and book the best quote under your limit?");
    close();
  });

  it("calls them at once, books the cheapest quote under the limit, and releases the others", async () => {
    const { engine, close } = around();
    const run = await engine.ask("Get quotes from plumbers to fix the kitchen sink, under 150", undefined, true);
    const ask = await until(engine, run.id, item => item.status === "waiting_approval");
    await engine.respondToApproval(ask.approval!.id, "once");
    const view = await until(engine, run.id, item => item.status === "completed");
    expect(view.outcome).toMatchObject({ kind: "confirmed", amountUsd: 125 });
    expect(view.board).toEqual([
      { business: "Pete's Pipes", state: "released", amountUsd: 140, when: "Tuesday the 20th at 9 am" },
      { business: "Drain Bros", state: "booked", amountUsd: 125, when: "Tuesday the 20th at 11 am" },
      { business: "Rapid Rooter", state: "released", amountUsd: 160, when: "Wednesday the 21st at 8 am" }
    ]);
    expect(view.steps).toContain("Ambient to Pete's Pipes: Thanks so much for the quote. Maya is going with another option this time. Bye.");
    expect(view.steps.some(step => step.startsWith("Maya: "))).toBe(false);
    expect(view.steps.some(step => /^Ambient to Drain Bros: .*one hundred twenty-five dollars total, Tuesday the 20th at 11 am\. Is that right\?$/.test(step))).toBe(true);
    close();
  });

  it("asks the owner about the best quote when every quote is over the limit", async () => {
    const { engine, close } = around();
    const run = await engine.ask("Get quotes from plumbers to fix the kitchen sink, under 100", undefined, true);
    const dial = await until(engine, run.id, item => item.status === "waiting_approval");
    await engine.respondToApproval(dial.approval!.id, "once");
    const best = await until(engine, run.id, item => item.approval?.kind === "spend");
    expect(best.approval?.command).toBe("Drain Bros has the best quote: one hundred twenty-five dollars for Tuesday the 20th at 11 am, over your limit of one hundred dollars. Should I book it?");
    expect(best.board?.map(item => item.state)).toEqual(["released", "quoted", "released"]);
    await engine.respondToApproval(best.approval!.id, "once");
    const view = await until(engine, run.id, item => item.status === "completed");
    expect(view.outcome).toMatchObject({ kind: "confirmed", amountUsd: 125 });
    close();
  });
});
