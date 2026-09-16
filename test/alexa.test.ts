import { describe, expect, it, vi } from "vitest";
import { handleAlexaRequest, AlexaRequestError, type AlexaSkillDependencies } from "../src/alexa.js";
import type { ConversationEngine } from "../src/conversations.js";
import { RuntimeRegistry, type RuntimeEntry } from "../src/runtimes/registry.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant } from "./fake.js";

function engine() {
  return {
    ask: vi.fn(),
    getWork: vi.fn(),
    listRuns: vi.fn().mockReturnValue([]),
    listConversations: vi.fn().mockReturnValue([]),
    selectConversation: vi.fn(),
    steer: vi.fn(),
    cancel: vi.fn(),
    listApprovals: vi.fn().mockReturnValue([]),
    respondToApproval: vi.fn(),
    runtime: vi.fn().mockReturnValue({ id: "local", label: "My Hermes", kind: "local", state: "online", updatedAt: "2026-09-06T00:00:00.000Z" })
  } as unknown as ConversationEngine;
}

function dependencies(fake: ConversationEngine): AlexaSkillDependencies & { store: AmbientStore } {
  const store = new AmbientStore();
  const entry: RuntimeEntry = {
    descriptor: { id: "local", label: "My Hermes", kind: "local", adapter: "fake", capabilities: fakeAssistant().client.capabilities },
    client: fakeAssistant().client,
    engine: fake,
    start: () => undefined,
    close: async () => undefined
  };
  const registry = new RuntimeRegistry(store, [entry]);
  return { registry, store, applicationId: "skill-id", allowUnauthenticated: true };
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

const run = (status: "accepted" | "running" | "completed" = "accepted") => ({
  id: "work-1",
  conversationId: "conversation-1",
  runtimeId: "local",
  durableSessionId: "durable-1",
  liveSessionId: "live-1",
  instruction: "check my day",
  status,
  ...(status === "completed" ? { answer: "Your day is clear." } : {}),
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z"
});

describe("Alexa custom skill", () => {
  it("asks the selected assistant and keeps the work reference for a follow-up", async () => {
    const fake = engine();
    vi.mocked(fake.ask).mockResolvedValue(run());
    vi.mocked(fake.getWork).mockReturnValue(run("completed"));
    const deps = dependencies(fake);

    const asked = await handleAlexaRequest(request("AskIntent", { request: "check my day" }), deps);
    expect(fake.ask).toHaveBeenCalledWith("check my day");
    expect(asked.response.outputSpeech.ssml).toContain("work-1");

    deps.store.createRun({ ...run("completed"), answer: "Your day is clear." });
    const checked = await handleAlexaRequest(request("GetLastWorkIntent", {}, asked.sessionAttributes ?? {}), deps);
    expect(checked.response.outputSpeech.ssml).toContain("Your day is clear.");
    deps.store.close();
  });

  it("maps a listed approval to its exact namespaced approval id", async () => {
    const fake = engine();
    vi.mocked(fake.listApprovals).mockReturnValue([{
      id: "local:approval-1",
      runId: "work-1",
      runtimeId: "local",
      durableSessionId: "durable-1",
      liveSessionId: "live-1",
      requestId: "approval-1",
      command: "send the draft",
      choices: ["once", "deny"],
      createdAt: "2026-09-06T00:00:00.000Z"
    }]);
    vi.mocked(fake.respondToApproval).mockResolvedValue(run("running"));
    const deps = dependencies(fake);

    const listed = await handleAlexaRequest(request("ListApprovalsIntent"), deps);
    expect(listed.response.outputSpeech.ssml).toContain("My Hermes");
    await handleAlexaRequest(request("AMAZON.YesIntent", {}, listed.sessionAttributes ?? {}), deps);
    expect(fake.respondToApproval).toHaveBeenCalledWith("local:approval-1", "once");
    deps.store.close();
  });

  it("routes an ask to the named assistant slot", async () => {
    const fake = engine();
    vi.mocked(fake.ask).mockResolvedValue(run());
    const deps = dependencies(fake);

    const asked = await handleAlexaRequest(request("AskIntent", { request: "check my day", assistant: "hermes" }), deps);
    expect(fake.ask).toHaveBeenCalledWith("check my day");
    expect(asked.sessionAttributes?.assistant).toBe("local");
    deps.store.close();
  });

  it("lists assistants and switches the selection", async () => {
    const fake = engine();
    const deps = dependencies(fake);

    const listed = await handleAlexaRequest(request("ListAssistantsIntent"), deps);
    expect(listed.response.outputSpeech.ssml).toContain("My Hermes");

    const selected = await handleAlexaRequest(request("SelectAssistantIntent", { assistant: "hermes" }), deps);
    expect(selected.response.outputSpeech.ssml).toContain("My Hermes");
    expect(deps.registry.selectedId()).toBe("local");
    deps.store.close();
  });

  it("rejects a request from another Alexa skill", async () => {
    const fake = engine();
    const payload = request("RuntimeStatusIntent", { assistant: "hermes" });
    payload.session.application.applicationId = "other-skill";
    const deps = dependencies(fake);
    await expect(handleAlexaRequest(payload, deps))
      .rejects.toMatchObject({ status: 401 } satisfies Partial<AlexaRequestError>);
    deps.store.close();
  });
});
