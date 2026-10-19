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
        speech: "The plumber wants one hundred eighty dollars. Start with: Alexa, tell Ambient."
      })
    });
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
    expect(needsYou).toHaveBeenLastCalledWith(expect.stringContaining("one hundred eighty dollars"));
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
});
