import { describe, expect, it, vi } from "vitest";
import { handleAlexaRequest, AlexaRequestError } from "../src/alexa.js";
import type { ConversationEngine } from "../src/conversations.js";

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
  it("asks Hermes and keeps the work reference for a follow-up", async () => {
    const fake = engine();
    vi.mocked(fake.ask).mockResolvedValue(run());
    vi.mocked(fake.getWork).mockReturnValue(run("completed"));
    const dependencies = { engine: fake, applicationId: "skill-id", allowUnauthenticated: true };

    const asked = await handleAlexaRequest(request("AskHermesIntent", { request: "check my day" }), dependencies);
    expect(fake.ask).toHaveBeenCalledWith("check my day");
    expect(asked.response.outputSpeech.ssml).toContain("work-1");

    const checked = await handleAlexaRequest(request("GetLastWorkIntent", {}, asked.sessionAttributes ?? {}), dependencies);
    expect(fake.getWork).toHaveBeenCalledWith("work-1");
    expect(checked.response.outputSpeech.ssml).toContain("Your day is clear.");
  });

  it("maps a listed approval to an exact Hermes approval id", async () => {
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
    const dependencies = { engine: fake, applicationId: "skill-id", allowUnauthenticated: true };

    const listed = await handleAlexaRequest(request("ListApprovalsIntent"), dependencies);
    await handleAlexaRequest(request("AMAZON.YesIntent", {}, listed.sessionAttributes ?? {}), dependencies);
    expect(fake.respondToApproval).toHaveBeenCalledWith("local:approval-1", "once");
  });

  it("finds the latest work when a new Alexa session has no attributes", async () => {
    const fake = engine();
    vi.mocked(fake.listRuns).mockReturnValue([run("completed")]);
    vi.mocked(fake.getWork).mockReturnValue(run("completed"));
    const dependencies = { engine: fake, applicationId: "skill-id", allowUnauthenticated: true };

    const checked = await handleAlexaRequest(request("GetLastWorkIntent"), dependencies);
    expect(fake.getWork).toHaveBeenCalledWith("work-1");
    expect(checked.response.outputSpeech.ssml).toContain("Your day is clear.");
  });

  it("rejects a request from another Alexa skill", async () => {
    const fake = engine();
    const payload = request("RuntimeStatusIntent");
    payload.session.application.applicationId = "other-skill";
    await expect(handleAlexaRequest(payload, { engine: fake, applicationId: "skill-id", allowUnauthenticated: true }))
      .rejects.toMatchObject({ status: 401 } satisfies Partial<AlexaRequestError>);
  });
});
