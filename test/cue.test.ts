import { describe, expect, it, vi } from "vitest";
import { proactiveEventsCue, voiceMonkeyCue, type CueFetch } from "../src/cue.js";
import { watchApprovals } from "../src/server.js";
import { fakeAssistant, fakeRuntimeEntry } from "./fake.js";
import { RuntimeRegistry } from "../src/runtimes/registry.js";
import { AmbientStore } from "../src/store.js";

const okResponse = (body: unknown = {}, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("voiceMonkeyCue", () => {
  it("posts the question plus the answer hint to the announce endpoint", async () => {
    const send = vi.fn<CueFetch>().mockImplementation(() => okResponse({ success: true }));
    const cue = voiceMonkeyCue({ token: "vm-token", device: "echo-dot", fetch: send });
    await cue.needsYou("The plumber wants one hundred eighty dollars.");
    expect(send).toHaveBeenCalledWith("https://api-v3.voicemonkey.io/announce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "vm-token",
        device: "echo-dot",
        speech: "The plumber wants one hundred eighty dollars. To answer, say: Alexa, open Ambient."
      })
    });
  });

  it("gives one answer instruction instead of the spoken choices", async () => {
    const send = vi.fn<CueFetch>().mockImplementation(() => okResponse({ success: true }));
    const cue = voiceMonkeyCue({ token: "vm-token", device: "echo-dot", fetch: send });
    await cue.needsYou("The plumber wants one hundred eighty dollars. Say approve to book it, offer a price like one fifty, or hang up.");
    const body = JSON.parse(String(send.mock.calls[0]?.[1]?.body)) as { speech: string };
    expect(body.speech).toBe("The plumber wants one hundred eighty dollars. To answer, say: Alexa, open Ambient.");
  });
});

describe("proactiveEventsCue", () => {
  it("reuses one LWA token within its lifetime and posts a multicast MessageAlert", async () => {
    const now = () => 1_800_000_000_000;
    const send = vi.fn<CueFetch>().mockImplementation((url: string) =>
      url.includes("/auth/o2/token")
        ? okResponse({ access_token: "lwa-token", expires_in: 3600, token_type: "bearer" })
        : okResponse({}, 202));
    const cue = proactiveEventsCue({ clientId: "client-id", clientSecret: "client-secret", fetch: send, now });
    await cue.needsYou("first question");
    await cue.needsYou("second question");
    const tokenCalls = send.mock.calls.filter(([url]) => url.includes("/auth/o2/token"));
    expect(tokenCalls).toHaveLength(1);
    const eventCalls = send.mock.calls.filter(([url]) => url.includes("proactiveEvents"));
    expect(eventCalls).toHaveLength(2);
    const [, init] = eventCalls[0]!;
    expect(init.headers.authorization).toBe("Bearer lwa-token");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      timestamp: new Date(now()).toISOString(),
      expiryTime: new Date(now() + 10 * 60 * 1000).toISOString(),
      event: { name: "AMAZON.MessageAlert.Activated" },
      relevantAudience: { type: "Multicast", payload: {} }
    });
    expect(body.referenceId).not.toBe((JSON.parse(eventCalls[1]![1].body) as Record<string, unknown>).referenceId);
  });
});

describe("approval cue wiring", () => {
  it("calls needsYou once per new approval, not once per run change", async () => {
    const store = new AmbientStore();
    const fake = fakeAssistant();
    const entry = fakeRuntimeEntry("caller", "Ambient", fake.client, store);
    const registry = new RuntimeRegistry(store, [entry]);
    const needsYou = vi.fn().mockResolvedValue(undefined);
    const unwatch = watchApprovals(registry, { needsYou });
    await entry.engine.ask("call the plumber", undefined, true);
    fake.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { requestId: "req-1", command: "book at one hundred eighty dollars", amountUsd: 180, kind: "spend" }
    });
    await flush();
    expect(needsYou).toHaveBeenCalledTimes(1);
    expect(needsYou).toHaveBeenLastCalledWith(expect.stringContaining("one hundred eighty dollars"), "ask");
    fake.emit({ type: "status.update", sessionId: "runtime-1", payload: { text: "still talking" } });
    await flush();
    expect(needsYou).toHaveBeenCalledTimes(1);
    fake.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { requestId: "req-2", command: "move it to tomorrow morning" }
    });
    await flush();
    expect(needsYou).toHaveBeenCalledTimes(2);
    unwatch();
    entry.engine.close();
    store.close();
  });

  it("tells the owner once when a call ends without a booking", async () => {
    const store = new AmbientStore();
    const fake = fakeAssistant();
    const entry = fakeRuntimeEntry("caller", "Ambient", fake.client, store);
    const registry = new RuntimeRegistry(store, [entry]);
    const needsYou = vi.fn().mockResolvedValue(undefined);
    const unwatch = watchApprovals(registry, { needsYou });
    await entry.engine.ask("call the plumber", undefined, true);
    fake.emit({ type: "status.update", sessionId: "runtime-1", payload: { text: "Calling Joe's Plumbing", subject: "Joe's Plumbing" } });
    fake.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "done", outcome: { kind: "unconfirmed", reason: "nobody picked up" } } });
    await flush();
    fake.emit({ type: "status.update", sessionId: "runtime-1", payload: { text: "late" } });
    await flush();
    expect(needsYou).toHaveBeenCalledTimes(1);
    expect(needsYou).toHaveBeenLastCalledWith(expect.stringContaining("Joe's Plumbing wasn't reached: nobody picked up, so nothing is booked."), "result");
    await entry.engine.ask("call the plumber again");
    fake.emit({ type: "status.update", sessionId: "runtime-1", payload: { text: "Calling Joe's Plumbing", subject: "Joe's Plumbing" } });
    fake.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "done", outcome: { kind: "confirmed", summary: "Joe's Plumbing confirmed Tuesday the 20th at 10 am for one hundred sixty dollars.", amountUsd: 160, when: "Tuesday the 20th at 10 am" } } });
    await flush();
    expect(needsYou).toHaveBeenCalledTimes(2);
    expect(needsYou).toHaveBeenLastCalledWith("Joe's Plumbing confirmed Tuesday the 20th at 10 am for one hundred sixty dollars.", "result");
    unwatch();
    entry.engine.close();
    store.close();
  });

  it("tells the owner when the business turns the job down, but not when the owner said no", async () => {
    const store = new AmbientStore();
    const fake = fakeAssistant();
    const entry = fakeRuntimeEntry("caller", "Ambient", fake.client, store);
    const registry = new RuntimeRegistry(store, [entry]);
    const needsYou = vi.fn().mockResolvedValue(undefined);
    const unwatch = watchApprovals(registry, { needsYou });
    await entry.engine.ask("call the plumber", undefined, true);
    fake.emit({ type: "status.update", sessionId: "runtime-1", payload: { text: "Calling Joe's Plumbing", subject: "Joe's Plumbing" } });
    fake.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "done", outcome: { kind: "declined", reason: "Joe's Plumbing declined to take the job." } } });
    await flush();
    expect(needsYou).toHaveBeenCalledTimes(1);
    expect(needsYou).toHaveBeenLastCalledWith(expect.stringContaining("Joe's Plumbing turned it down, so nothing is booked."), "result");
    await entry.engine.ask("call the plumber again");
    fake.emit({ type: "status.update", sessionId: "runtime-1", payload: { text: "Calling Joe's Plumbing", subject: "Joe's Plumbing" } });
    fake.emit({ type: "message.complete", sessionId: "runtime-1", payload: { text: "done", outcome: { kind: "no_deal", reason: "Maya declined one hundred eighty dollars" } } });
    await flush();
    expect(needsYou).toHaveBeenCalledTimes(1);
    unwatch();
    entry.engine.close();
    store.close();
  });
});

describe("result cues", () => {
  it("names the retry phrase with the invocation, or offers to replay the result", async () => {
    const send = vi.fn<CueFetch>().mockImplementation(() => okResponse({ success: true }));
    const cue = voiceMonkeyCue({ token: "vm-token", device: "echo-dot", fetch: send });
    await cue.needsYou("Mr. Rooter wasn't reached: nobody picked up, so nothing is booked. To try again, say: call them again.", "result");
    await cue.needsYou("Joe's Plumbing confirmed Tuesday the 20th at 10 am for one hundred sixty dollars.", "result");
    await cue.needsYou("I can't confirm a booking with Joe's Plumbing: they never clearly confirmed it. Check with them before you try again.", "result");
    const spoken = send.mock.calls.map(call => (JSON.parse(String(call[1]?.body)) as { speech: string }).speech);
    expect(spoken).toEqual([
      "Mr. Rooter wasn't reached: nobody picked up, so nothing is booked. To try again, say: Alexa, tell Ambient to call them again.",
      "Joe's Plumbing confirmed Tuesday the 20th at 10 am for one hundred sixty dollars. To hear it again, say: Alexa, open Ambient.",
      "I can't confirm a booking with Joe's Plumbing: they never clearly confirmed it. Check with them before you try again. Then say: Alexa, tell Ambient to call them again."
    ]);
  });
});
