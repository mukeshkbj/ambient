import { describe, expect, it } from "vitest";
import { handleAlexaRequest, AlexaRequestError, type AlexaSkillDependencies, type AlexaSkillResponse } from "../src/alexa.js";
import { fakeAssistant, fakeRuntimeEntry } from "./fake.js";
import { RuntimeRegistry } from "../src/runtimes/registry.js";
import { AmbientStore } from "../src/store.js";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function setup() {
  const store = new AmbientStore();
  const fake = fakeAssistant();
  const entry = fakeRuntimeEntry("caller", "Ambient", fake.client, store);
  const registry = new RuntimeRegistry(store, [entry]);
  const deps: AlexaSkillDependencies = { registry, applicationId: "skill-id", allowUnauthenticated: true };
  return {
    store,
    fake,
    entry,
    registry,
    deps,
    close: () => {
      entry.engine.close();
      store.close();
    }
  };
}

function request(name: string, slots: Record<string, string> = {}, attributes: Record<string, unknown> = {}) {
  return {
    version: "1.0",
    session: { attributes, application: { applicationId: "skill-id" }, user: { userId: "user-1" } },
    request: {
      type: "IntentRequest",
      requestId: "request-1",
      intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([key, value]) => [key, { name: key, value }])) }
    }
  };
}

function speechOf(result: AlexaSkillResponse): string {
  const ssml = result.response.outputSpeech.ssml;
  expect(ssml).not.toMatch(UUID);
  return ssml;
}

async function startCall(deps: AlexaSkillDependencies, task = "a plumber for tomorrow") {
  return handleAlexaRequest(request("StartCallIntent", { task }), deps);
}

describe("Alexa call intents", () => {
  it("reprompts with the open question when the reply ends in one", async () => {
    const { deps, close } = setup();
    const result = await handleAlexaRequest(request("OfferAmountIntent"), deps);
    expect(speechOf(result)).toContain("How much should I offer?");
    expect(result.response.reprompt?.outputSpeech.ssml).toBe("<speak>How much should I offer?</speak>");
    close();
  });

  it("says the call keeps going when the owner stops talking to Alexa mid-call", async () => {
    const { deps, close } = setup();
    const started = await startCall(deps);
    const result = await handleAlexaRequest(request("AMAZON.StopIntent", {}, started.sessionAttributes), deps);
    expect(speechOf(result)).toContain("The call is still going.");
    close();
  });

  it("StartCallIntent starts a run on the caller runtime", async () => {
    const { deps, entry, fake, close } = setup();
    const result = await startCall(deps);
    const runs = entry.engine.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runtimeId: "caller", instruction: "a plumber for tomorrow" });
    expect(fake.client.createSession).toHaveBeenCalled();
    expect(speechOf(result)).toContain("Calling");
    expect(speechOf(result)).toContain("Ask me how it&apos;s going any time.");
    expect(result.response.reprompt?.outputSpeech.ssml).toBe("<speak>Say status, or hang up.</speak>");
    close();
  });

  it("SteerCallIntent in a fresh session steers the active call", async () => {
    const { deps, fake, close } = setup();
    await startCall(deps);
    const result = await handleAlexaRequest(request("SteerCallIntent", { message: "tell him one sixty" }), deps);
    expect(fake.client.steer).toHaveBeenCalledWith("runtime-1", "tell him one sixty");
    expect(speechOf(result)).toContain("Okay, I&apos;ll tell them.");
    close();
  });

  it("OfferAmountIntent steers with an exact amount sentence", async () => {
    const { deps, fake, close } = setup();
    await startCall(deps);
    const result = await handleAlexaRequest(request("OfferAmountIntent", { amount: "160" }), deps);
    expect(fake.client.steer).toHaveBeenCalledWith("runtime-1", "offer 160 dollars");
    expect(speechOf(result)).toContain("Okay, I&apos;ll tell them.");
    close();
  });

  it("AMAZON.YesIntent in a fresh session approves the newest open approval of the active call", async () => {
    const { deps, fake, close } = setup();
    await startCall(deps);
    fake.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { requestId: "req-1", command: "book at one hundred eighty dollars", amountUsd: 180, kind: "spend" }
    });
    const result = await handleAlexaRequest(request("AMAZON.YesIntent"), deps);
    expect(fake.client.respondToApproval).toHaveBeenCalledWith("runtime-1", "req-1", "once");
    expect(speechOf(result)).toContain("telling them yes at one hundred eighty dollars");
    close();
  });

  it("opens on the held call's choices when the owner launches the skill mid-call", async () => {
    const { deps, fake, close } = setup();
    await startCall(deps);
    fake.emit({ type: "approval.request", sessionId: "runtime-1", payload: { requestId: "req-1", command: "book at one hundred eighty dollars", amountUsd: 180, limitUsd: 150, kind: "spend" } });
    const launched = await handleAlexaRequest({ ...request("unused"), request: { type: "LaunchRequest", requestId: "request-2" } }, deps);
    expect(speechOf(launched)).not.toContain("Who should I call?");
    expect(speechOf(launched)).toContain("one hundred eighty dollars");
    expect(launched.response.reprompt?.outputSpeech.ssml).toMatch(/^<speak>Say approve to /);
    const stopped = await handleAlexaRequest(request("AMAZON.StopIntent"), deps);
    expect(speechOf(stopped)).toContain("is holding for now and will hang up soon");
    close();
  });

  it("hears \"book it\" as approval", async () => {
    const { deps, fake, close } = setup();
    await startCall(deps);
    fake.emit({ type: "approval.request", sessionId: "runtime-1", payload: { requestId: "req-1", command: "book at one hundred eighty dollars", amountUsd: 180, kind: "spend" } });
    await handleAlexaRequest(request("RespondApprovalIntent", { decision: "book" }), deps);
    expect(fake.client.respondToApproval).toHaveBeenCalledWith("runtime-1", "req-1", "once");
    close();
  });

  it("answers an unclear request during a call with the choices that fit the moment", async () => {
    const { deps, fake, close } = setup();
    await startCall(deps);
    expect(speechOf(await handleAlexaRequest(request("AMAZON.FallbackIntent"), deps))).toBe("<speak>Sorry, I didn&apos;t catch that. Say status, or hang up.</speak>");
    fake.emit({ type: "approval.request", sessionId: "runtime-1", payload: { requestId: "req-1", command: "book at one hundred eighty dollars", amountUsd: 180, kind: "spend" } });
    expect(speechOf(await handleAlexaRequest(request("AMAZON.FallbackIntent"), deps))).toBe("<speak>Sorry, I didn&apos;t catch that. Say approve, offer an amount, or hang up.</speak>");
    close();
  });

  it.each(["en-US", "en-GB"])("the %s model hears every phrase the skill tells the owner to say", async locale => {
    const { readFile } = await import("node:fs/promises");
    const model = JSON.parse(await readFile(new URL(`../alexa/interaction-model.${locale}.json`, import.meta.url), "utf8"));
    const language = model.interactionModel.languageModel;
    const samples = (name: string): string[] => language.intents.find((intent: { name: string }) => intent.name === name)?.samples ?? [];
    const approve = language.types.find((type: { name: string }) => type.name === "Decision").values.find((value: { name: { value: string } }) => value.name.value === "approve").name;
    expect(samples("CallStatusIntent")).toEqual(expect.arrayContaining(["status", "what's the status", "how it went", "how it's going"]));
    expect(samples("HangUpIntent")).toContain("hang up");
    expect(samples("OfferAmountIntent")).toContain("offer {amount}");
    expect([approve.value, ...approve.synonyms]).toEqual(expect.arrayContaining(["approve", "book"]));
  });

  it("AMAZON.NoIntent in a fresh session denies the newest open approval of the active call", async () => {
    const { deps, fake, close } = setup();
    await startCall(deps);
    fake.emit({
      type: "approval.request",
      sessionId: "runtime-1",
      payload: { requestId: "req-1", command: "book at one hundred eighty dollars", amountUsd: 180, kind: "spend" }
    });
    const result = await handleAlexaRequest(request("AMAZON.NoIntent"), deps);
    expect(fake.client.respondToApproval).toHaveBeenCalledWith("runtime-1", "req-1", "deny");
    expect(speechOf(result)).toContain("say no");
    close();
  });

  it("SteerCallIntent with no active call says there is no call in progress", async () => {
    const { deps, fake, close } = setup();
    const result = await handleAlexaRequest(request("SteerCallIntent", { message: "tell him one sixty" }), deps);
    expect(speechOf(result)).toContain("no call in progress.");
    expect(fake.client.steer).not.toHaveBeenCalled();
    close();
  });

  it("rejects a request from another Alexa skill", async () => {
    const { deps, close } = setup();
    const payload = request("CallStatusIntent");
    payload.session.application.applicationId = "other-skill";
    await expect(handleAlexaRequest(payload, deps))
      .rejects.toMatchObject({ status: 401 } satisfies Partial<AlexaRequestError>);
    close();
  });
});
