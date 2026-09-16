import { timingSafeEqual } from "node:crypto";
import type { OAuthProvider } from "./auth.js";
import type { ConversationEngine } from "./conversations.js";
import { viewText } from "./mcp.js";
import type { Conversation, RunView } from "./types.js";

type AlexaEnvelope = Record<string, unknown>;

export type AlexaSkillResponse = {
  version: "1.0";
  sessionAttributes?: Record<string, unknown>;
  response: {
    outputSpeech: { type: "SSML"; ssml: string };
    reprompt?: { outputSpeech: { type: "SSML"; ssml: string } };
    shouldEndSession: boolean;
  };
};

export type AlexaSkillDependencies = {
  engine: ConversationEngine;
  applicationId?: string;
  auth?: OAuthProvider;
  accessToken?: string;
  allowUnauthenticated?: boolean;
};

export class AlexaRequestError extends Error {
  constructor(readonly status: 400 | 401, message: string) {
    super(message);
    this.name = "AlexaRequestError";
  }
}

function object(value: unknown): AlexaEnvelope | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AlexaEnvelope : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function secureEqual(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const actual = Buffer.from(left);
  const expected = Buffer.from(right);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function speech(value: string): { type: "SSML"; ssml: string } {
  return { type: "SSML", ssml: `<speak>${escapeXml(value)}</speak>` };
}

function response(value: string, sessionAttributes: Record<string, unknown>, shouldEndSession = false): AlexaSkillResponse {
  const outputSpeech = speech(value);
  return {
    version: "1.0",
    sessionAttributes,
    response: {
      outputSpeech,
      ...(shouldEndSession ? {} : { reprompt: { outputSpeech: speech("What would you like Hermes to do?") } }),
      shouldEndSession
    }
  };
}

function slotValue(intent: AlexaEnvelope, ...names: string[]): string | undefined {
  const slots = object(intent.slots);
  if (!slots) return undefined;
  for (const name of names) {
    const slot = object(slots[name]);
    const value = text(slot?.value);
    if (value) return value;
  }
  return undefined;
}

function sessionAttributes(envelope: AlexaEnvelope): Record<string, unknown> {
  const session = object(envelope.session);
  const attributes = object(session?.attributes);
  return attributes ? { ...attributes } : {};
}

function requestType(envelope: AlexaEnvelope): string {
  const request = object(envelope.request);
  const type = text(request?.type);
  if (!type) throw new AlexaRequestError(400, "Alexa request type is required");
  return type;
}

function requestObject(envelope: AlexaEnvelope): AlexaEnvelope {
  const request = object(envelope.request);
  if (!request) throw new AlexaRequestError(400, "Alexa request is required");
  return request;
}

function applicationId(envelope: AlexaEnvelope): string | undefined {
  const session = object(envelope.session);
  const sessionApplication = object(session?.application);
  const context = object(envelope.context);
  const system = object(context?.System);
  const contextApplication = object(system?.application);
  return text(contextApplication?.applicationId) ?? text(sessionApplication?.applicationId);
}

function accessToken(envelope: AlexaEnvelope): string | undefined {
  const session = object(envelope.session);
  const sessionUser = object(session?.user);
  const context = object(envelope.context);
  const system = object(context?.System);
  const contextUser = object(system?.user);
  return text(contextUser?.accessToken) ?? text(sessionUser?.accessToken);
}

async function authorize(envelope: AlexaEnvelope, dependencies: AlexaSkillDependencies): Promise<void> {
  if (dependencies.applicationId && applicationId(envelope) !== dependencies.applicationId) {
    throw new AlexaRequestError(401, "Invalid Alexa application");
  }
  const token = accessToken(envelope);
  if (dependencies.auth) {
    if (!token) throw new AlexaRequestError(401, "Alexa account linking is required");
    try {
      const principal = await dependencies.auth.verifyAccessToken(token);
      if (principal.kind !== "user" || !principal.scopes.includes("mcp:tools")) throw new Error("invalid scope");
    } catch {
      throw new AlexaRequestError(401, "Alexa account linking is required");
    }
    return;
  }
  if (dependencies.accessToken) {
    if (!secureEqual(token, dependencies.accessToken)) throw new AlexaRequestError(401, "Alexa account linking is required");
    return;
  }
  if (!dependencies.allowUnauthenticated) throw new AlexaRequestError(401, "Alexa account linking is required");
}

function lastWorkId(attributes: Record<string, unknown>, intent: AlexaEnvelope): string | undefined {
  return slotValue(intent, "workId", "work", "id") ?? text(attributes.lastWorkId);
}

function lastApprovalId(attributes: Record<string, unknown>, intent: AlexaEnvelope): string | undefined {
  const explicit = slotValue(intent, "approvalId", "approval");
  if (explicit) return explicit;
  const ordinal = slotValue(intent, "approvalNumber", "number");
  const ids = Array.isArray(attributes.pendingApprovalIds)
    ? attributes.pendingApprovalIds.filter((value): value is string => typeof value === "string")
    : [];
  if (ordinal) {
    const index = ordinalIndex(ordinal);
    if (index !== undefined) return ids[index];
  }
  return text(attributes.lastApprovalId) ?? (ids.length === 1 ? ids[0] : undefined);
}

function ordinalIndex(value: string): number | undefined {
  const normalized = value.trim().toLowerCase();
  const numeric = Number.parseInt(normalized, 10);
  if (Number.isInteger(numeric) && numeric > 0) return numeric - 1;
  return { first: 0, one: 0, second: 1, two: 1, third: 2, three: 2 }[normalized];
}

function decision(value: string | undefined): "once" | "deny" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["once", "approve", "approved", "allow", "yes", "y"].includes(normalized)) return "once";
  if (["deny", "denied", "decline", "declined", "reject", "no", "n"].includes(normalized)) return "deny";
  return undefined;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("not found")) return "I could not find that Hermes item.";
  if (message.includes("already has active")) return "That conversation already has active Hermes work.";
  if (message.includes("already finished")) return "That Hermes work is already finished.";
  if (message.includes("unknown")) return "Hermes needs to reconnect before I can do that.";
  if (message.includes("approval")) return "Hermes could not confirm that approval response.";
  return "Hermes could not complete that request.";
}

function runAttributes(attributes: Record<string, unknown>, run: RunView): Record<string, unknown> {
  const next: Record<string, unknown> = { ...attributes, lastWorkId: run.id };
  if (run.approval) {
    next.lastApprovalId = run.approval.id;
  } else {
    delete next.lastApprovalId;
  }
  return next;
}

function conversationMatches(conversations: Conversation[], query: string): Conversation[] {
  const normalized = query.trim().toLowerCase();
  const exact = conversations.filter(conversation => conversation.id === query || conversation.title.toLowerCase() === normalized);
  return exact.length > 0 ? exact : conversations.filter(conversation => conversation.title.toLowerCase().includes(normalized));
}

async function intentResponse(intent: AlexaEnvelope, attributes: Record<string, unknown>, dependencies: AlexaSkillDependencies): Promise<AlexaSkillResponse> {
  const name = text(intent.name);
  if (!name) throw new AlexaRequestError(400, "Alexa intent name is required");
  if (name === "AMAZON.HelpIntent") {
    return response("You can ask Hermes a question, ask for work status, list conversations, steer or cancel work, or list and answer approvals.", attributes);
  }
  if (name === "AMAZON.StopIntent" || name === "AMAZON.CancelIntent") {
    return response("Goodbye.", attributes, true);
  }
  if (name === "AMAZON.YesIntent" || name === "AMAZON.NoIntent") {
    const approvalId = lastApprovalId(attributes, intent);
    if (!approvalId) return response("I do not have one pending approval selected. Say list approvals first.", attributes);
    try {
      const run = await dependencies.engine.respondToApproval(approvalId, name === "AMAZON.YesIntent" ? "once" : "deny");
      const next = { ...attributes };
      delete next.lastApprovalId;
      delete next.pendingApprovalIds;
      return response(name === "AMAZON.YesIntent" ? `Approved once. ${viewText(run)}` : `Denied. ${viewText(run)}`, runAttributes(next, run));
    } catch (error) {
      return response(errorText(error), attributes);
    }
  }
  if (name === "AMAZON.FallbackIntent") return response("I did not understand that. Ask Hermes a question or say help.", attributes);
  if (name === "ListConversationsIntent") {
    const conversations = dependencies.engine.listConversations();
    if (conversations.length === 0) return response("There are no saved Hermes conversations yet.", attributes);
    const names = conversations.slice(0, 5).map(conversation => conversation.title);
    return response(`I found ${conversations.length} conversation${conversations.length === 1 ? "" : "s"}: ${names.join(", ")}.`, attributes);
  }
  if (name === "SelectConversationIntent") {
    const query = slotValue(intent, "conversation", "conversationName", "name");
    if (!query) return response("Which Hermes conversation should I select?", attributes);
    const matches = conversationMatches(dependencies.engine.listConversations(), query);
    if (matches.length === 0) return response("I could not find that Hermes conversation.", attributes);
    if (matches.length > 1) return response(`I found more than one conversation matching ${query}. Say the full conversation name.`, attributes);
    const match = matches[0];
    if (!match) return response("I could not find that Hermes conversation.", attributes);
    const selected = await dependencies.engine.selectConversation(match.id);
    return response(`Selected ${selected.title}.`, attributes);
  }
  if (name === "ListApprovalsIntent") {
    const approvals = dependencies.engine.listApprovals();
    if (approvals.length === 0) return response("There are no pending Hermes approvals.", { ...attributes, pendingApprovalIds: [] });
    const firstApproval = approvals[0];
    if (!firstApproval) return response("There are no pending Hermes approvals.", { ...attributes, pendingApprovalIds: [] });
    const descriptions = approvals.slice(0, 3).map((approval, index) => `Approval ${index + 1}: ${approval.description ?? approval.command}`);
    return response(`I found ${approvals.length} pending approval${approvals.length === 1 ? "" : "s"}. ${descriptions.join(". ")}. Say approve once or deny followed by the approval number.`, {
      ...attributes,
      pendingApprovalIds: approvals.map(approval => approval.id),
      ...(approvals.length === 1 ? { lastApprovalId: firstApproval.id } : {})
    });
  }
  if (name === "RespondApprovalIntent") {
    const approvalId = lastApprovalId(attributes, intent);
    const selectedDecision = decision(slotValue(intent, "decision", "choice"));
    if (!approvalId) return response("Say list approvals first, then give the approval number.", attributes);
    if (!selectedDecision) return response("Say approve once or deny.", attributes);
    try {
      const run = await dependencies.engine.respondToApproval(approvalId, selectedDecision);
      const next = { ...attributes };
      delete next.lastApprovalId;
      delete next.pendingApprovalIds;
      return response(`${selectedDecision === "once" ? "Approved once." : "Denied."} ${viewText(run)}`, runAttributes(next, run));
    } catch (error) {
      return response(errorText(error), attributes);
    }
  }
  if (name === "AskHermesIntent" || name === "ProvideHermesRequestIntent" || name === "StartHermesWorkIntent") {
    const instruction = slotValue(intent, "request", "instruction", "text");
    if (!instruction) return response("What should I ask Hermes to do?", attributes);
    try {
      const run = await dependencies.engine.ask(instruction);
      return response(viewText(run), runAttributes(attributes, run));
    } catch (error) {
      return response(errorText(error), attributes);
    }
  }
  if (name === "GetWorkIntent" || name === "GetLastWorkIntent") {
    const workId = lastWorkId(attributes, intent) ?? (name === "GetLastWorkIntent" ? dependencies.engine.listRuns(1)[0]?.id : undefined);
    if (!workId) return response("Which Hermes work should I check?", attributes);
    try {
      const run = dependencies.engine.getWork(workId);
      return response(viewText(run), runAttributes(attributes, run));
    } catch (error) {
      return response(errorText(error), attributes);
    }
  }
  if (name === "SteerWorkIntent") {
    const workId = lastWorkId(attributes, intent);
    const instruction = slotValue(intent, "instruction", "text", "request");
    if (!workId) return response("Which Hermes work should I steer?", attributes);
    if (!instruction) return response("What should I tell the Hermes work to do next?", attributes);
    try {
      const run = await dependencies.engine.steer(workId, instruction);
      return response(viewText(run), runAttributes(attributes, run));
    } catch (error) {
      return response(errorText(error), attributes);
    }
  }
  if (name === "CancelWorkIntent") {
    const workId = lastWorkId(attributes, intent);
    if (!workId) return response("Which Hermes work should I cancel?", attributes);
    try {
      const run = await dependencies.engine.cancel(workId);
      return response(viewText(run), runAttributes(attributes, run));
    } catch (error) {
      return response(errorText(error), attributes);
    }
  }
  if (name === "RuntimeStatusIntent") {
    const runtime = dependencies.engine.runtime();
    return response(`The ${runtime.label} Hermes runtime is ${runtime.state}.`, attributes);
  }
  return response("I do not know that Hermes command yet. Say help for the available commands.", attributes);
}

export async function handleAlexaRequest(input: unknown, dependencies: AlexaSkillDependencies): Promise<AlexaSkillResponse> {
  const envelope = object(input);
  if (!envelope || envelope.version !== "1.0") throw new AlexaRequestError(400, "Alexa request version must be 1.0");
  await authorize(envelope, dependencies);
  const attributes = sessionAttributes(envelope);
  const type = requestType(envelope);
  if (type === "LaunchRequest") return response("What would you like Hermes to do?", attributes);
  if (type === "SessionEndedRequest") return response("Goodbye.", attributes, true);
  if (type !== "IntentRequest") throw new AlexaRequestError(400, "Unsupported Alexa request type");
  const intent = object(requestObject(envelope).intent);
  if (!intent) throw new AlexaRequestError(400, "Alexa intent is required");
  return intentResponse(intent, attributes, dependencies);
}
