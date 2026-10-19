import { timingSafeEqual } from "node:crypto";
import type { OAuthProvider } from "./auth.js";
import type { RuntimeEntry, RuntimeRegistry } from "./runtimes/registry.js";
import type { RunStatus, RunView } from "./types.js";
import { heldStatus, speak, steerReply } from "./voice.js";
import { dollarsInWords, priceInWords } from "./words.js";

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
  registry: RuntimeRegistry;
  applicationId?: string;
  auth?: OAuthProvider;
  accessToken?: string;
  allowUnauthenticated?: boolean;
  askWaitMs?: number;
};

export class AlexaRequestError extends Error {
  constructor(readonly status: 400 | 401, message: string) {
    super(message);
    this.name = "AlexaRequestError";
  }
}

const ACTIVE_STATUSES: ReadonlySet<RunStatus> = new Set(["queued", "accepted", "running", "waiting_approval", "cancel_requested"]);

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

function repromptFor(value: string, live: boolean): string {
  const question = value.match(/[^.?!]+\?$/)?.[0]?.trim();
  const choices = value.match(/Say (?:approve|yes)[^.?!]*\.$/)?.[0];
  return question ?? choices ?? (live ? "Say status, or hang up." : "Who should I call?");
}

const ENDED: RunStatus[] = ["completed", "failed", "cancelled", "unknown"];
const isLive = (run: RunView) => !ENDED.includes(run.status);

function response(value: string, sessionAttributes: Record<string, unknown>, shouldEndSession = false, live = false): AlexaSkillResponse {
  return {
    version: "1.0",
    sessionAttributes,
    response: {
      outputSpeech: speech(value),
      ...(shouldEndSession ? {} : { reprompt: { outputSpeech: speech(repromptFor(value, live)) } }),
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

function decision(value: string | undefined): "once" | "deny" | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["once", "approve", "approved", "allow", "yes", "y", "book"].includes(normalized)) return "once";
  if (["deny", "denied", "decline", "declined", "reject", "no", "n"].includes(normalized)) return "deny";
  return undefined;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("not found")) return "I could not find that item.";
  if (message.includes("already has active")) return "A call is already in progress. Say status, or hang up.";
  if (message.includes("already finished")) return "That call is already finished.";
  if (message.includes("unknown")) return "The assistant needs to reconnect before I can do that.";
  if (message.includes("approval")) return "I could not pass that decision on.";
  return "I could not do that. Say status, or try again.";
}

function runAttributes(attributes: Record<string, unknown>, run: RunView): Record<string, unknown> {
  return { ...attributes, lastWorkId: run.id };
}

type ActiveCall = { entry: RuntimeEntry; run: RunView };

function defaultEntry(registry: RuntimeRegistry): RuntimeEntry | undefined {
  try {
    return registry.resolve();
  } catch {
    return undefined;
  }
}

function hintedRun(entry: RuntimeEntry, attributes: Record<string, unknown>): RunView | undefined {
  const id = text(attributes.lastWorkId);
  if (!id) return undefined;
  try {
    const run = entry.engine.getWork(id);
    return run.runtimeId === entry.descriptor.id ? run : undefined;
  } catch {
    return undefined;
  }
}

function activeCall(registry: RuntimeRegistry, attributes: Record<string, unknown>): ActiveCall | undefined {
  const entry = defaultEntry(registry);
  if (!entry) return undefined;
  const hinted = hintedRun(entry, attributes);
  const run = hinted && ACTIVE_STATUSES.has(hinted.status)
    ? hinted
    : entry.engine.listRuns(50).find(item => ACTIVE_STATUSES.has(item.status));
  return run ? { entry, run } : undefined;
}

const RECENT_CALL_MS = 60 * 60 * 1000;

function lastCall(registry: RuntimeRegistry, attributes: Record<string, unknown>): ActiveCall | undefined {
  const entry = defaultEntry(registry);
  const run = entry && (hintedRun(entry, attributes) ?? entry.engine.listRuns(1)[0]);
  return entry && run ? { entry, run } : undefined;
}

function startedCall(entry: RuntimeEntry, run: RunView): string {
  if (ACTIVE_STATUSES.has(run.status) && run.status !== "waiting_approval") {
    const business = run.subject ?? /^calling\s+(.+?)\.?$/i.exec(run.progress ?? "")?.[1];
    return business
      ? `I'm calling ${business} now. Say status any time.`
      : "I'm calling now. Say status any time.";
  }
  return speak(run, { label: entry.descriptor.label, state: entry.engine.runtime().state });
}

function callStatus(target: ActiveCall): string {
  const ctx = { label: target.entry.descriptor.label, state: target.entry.engine.runtime().state };
  return heldStatus(target.run) ?? speak(target.run, ctx);
}

async function retryCall(registry: RuntimeRegistry, attributes: Record<string, unknown>, dependencies: AlexaSkillDependencies): Promise<AlexaSkillResponse> {
  const live = activeCall(registry, attributes);
  if (live) return response(callStatus(live), attributes, false, isLive(live.run));
  const last = lastCall(registry, attributes);
  if (!last) return response("Who should I call? Say, for example, call Joe's Plumbing.", attributes);
  if (last.run.outcome?.kind === "confirmed") {
    return response(`That one is already booked with ${last.run.subject ?? "them"}. To book something else, say call, then what you need.`, attributes);
  }
  try {
    const run = await last.entry.engine.ask(last.run.instruction, last.run.conversationId, false, { waitMs: dependencies.askWaitMs ?? 0 });
    return response(startedCall(last.entry, run), runAttributes(attributes, run), false, isLive(run));
  } catch (error) {
    return response(errorText(error), attributes);
  }
}

async function intentResponse(intent: AlexaEnvelope, attributes: Record<string, unknown>, dependencies: AlexaSkillDependencies): Promise<AlexaSkillResponse> {
  const name = text(intent.name);
  if (!name) throw new AlexaRequestError(400, "Alexa intent name is required");
  const registry = dependencies.registry;
  if (name === "AMAZON.HelpIntent") {
    return response("Say call, followed by what you need, and I'll phone them. During the call you can ask how it's going, tell them something, offer an amount, say yes or no, or hang up.", attributes);
  }
  if (name === "AMAZON.StopIntent" || name === "AMAZON.CancelIntent") {
    const live = activeCall(registry, attributes);
    const goodbye = !live ? "Goodbye." : live.run.approval
      ? `Goodbye. ${live.run.subject ?? "The business"} is holding for now and will hang up soon. Say, Alexa, open Ambient, to answer.`
      : "Goodbye. The call is still going. Say, Alexa, open Ambient, when you're back.";
    return response(goodbye, attributes, true);
  }
  if (name === "AMAZON.FallbackIntent") {
    const live = activeCall(registry, attributes);
    const limit = live?.run.approval?.limitUsd;
    if (live?.run.approval) return response(`Sorry, I didn't catch that. Say yes, offer a price${limit !== undefined ? ` like ${priceInWords(limit)}` : ""}, or say no.`, attributes, false, true);
    if (live) return response("Sorry, I didn't catch that. Say status, or hang up.", attributes, false, true);
    return response("I did not understand that. Say call, followed by what you need, or say help.", attributes);
  }
  if (name === "StartCallIntent") {
    const task = slotValue(intent, "task", "request");
    if (!task) return response("Who should I call? Say, for example, call Joe's Plumbing.", attributes);
    if (/^(?:(?:them|him|her|it|that|the call) )?(?:again|back)$/i.test(task)) return retryCall(registry, attributes, dependencies);
    const entry = defaultEntry(registry);
    if (!entry) return response("I could not reach the assistant.", attributes);
    try {
      const run = await entry.engine.ask(task, undefined, true, { waitMs: dependencies.askWaitMs ?? 0 });
      return response(startedCall(entry, run), runAttributes(attributes, run), false, isLive(run));
    } catch (error) {
      return response(errorText(error), attributes);
    }
  }
  if (name === "RetryCallIntent") return retryCall(registry, attributes, dependencies);
  if (name === "SteerCallIntent" || name === "OfferAmountIntent") {
    const amount = name === "OfferAmountIntent" ? slotValue(intent, "amount") : undefined;
    const message = name === "OfferAmountIntent"
      ? (amount ? `offer ${amount} dollars` : undefined)
      : slotValue(intent, "message", "instruction");
    if (!message) return response(name === "OfferAmountIntent" ? "How much should I offer?" : "What should I tell them?", attributes);
    const target = activeCall(registry, attributes);
    if (!target) return response("There's no call in progress. To start one, say call, then what you need.", attributes);
    try {
      const run = await target.entry.engine.steer(target.run.id, message);
      const ctx = { label: target.entry.descriptor.label, state: target.entry.engine.runtime().state };
      return response(run.subject ? steerReply(run, ctx, message) : "Okay, I'll tell them. Say status to hear their answer.", runAttributes(attributes, run), false, isLive(run));
    } catch (error) {
      return response(errorText(error), attributes);
    }
  }
  if (name === "AMAZON.YesIntent" || name === "AMAZON.NoIntent" || name === "RespondApprovalIntent") {
    const choice = name === "RespondApprovalIntent"
      ? decision(slotValue(intent, "decision"))
      : name === "AMAZON.YesIntent" ? "once" : "deny";
    if (!choice) return response("Say yes or no.", attributes);
    const target = activeCall(registry, attributes);
    const approval = target?.run.approval;
    if (!target || !approval) return response("Nothing is waiting on you. Say status to hear where the call stands.", attributes);
    try {
      let run = await target.entry.engine.respondToApproval(approval.id, choice);
      if (dependencies.askWaitMs) run = await target.entry.engine.waitForRun(run.id, dependencies.askWaitMs);
      const ctx = { label: target.entry.descriptor.label, state: target.entry.engine.runtime().state };
      const amount = approval.amountUsd !== undefined ? ` at ${dollarsInWords(approval.amountUsd)}` : "";
      const reply = run.status === "completed" || run.status === "waiting_approval"
        ? `Okay. ${speak(run, ctx)}`
        : choice === "once" ? `Okay, telling them yes${amount}. Say status to hear how it went.` : "Okay, telling them no. Say status to hear how it went.";
      return response(reply, runAttributes(attributes, run), false, isLive(run));
    } catch (error) {
      return response(errorText(error), attributes);
    }
  }
  if (name === "CallStatusIntent") {
    const target = activeCall(registry, attributes) ?? lastCall(registry, attributes);
    if (!target) return response("There's no call yet. Say call, followed by what you need.", attributes);
    return response(callStatus(target), attributes, false, isLive(target.run));
  }
  if (name === "HangUpIntent") {
    const target = activeCall(registry, attributes);
    if (!target) return response("There's no call in progress.", attributes);
    try {
      const run = await target.entry.engine.cancel(target.run.id);
      return response(speak(run, { label: target.entry.descriptor.label, state: target.entry.engine.runtime().state }), runAttributes(attributes, run));
    } catch (error) {
      return response(errorText(error), attributes);
    }
  }
  return response("I do not know that command yet. Say help for the available commands.", attributes);
}

export async function handleAlexaRequest(input: unknown, dependencies: AlexaSkillDependencies): Promise<AlexaSkillResponse> {
  const envelope = object(input);
  if (!envelope || envelope.version !== "1.0") throw new AlexaRequestError(400, "Alexa request version must be 1.0");
  await authorize(envelope, dependencies);
  const attributes = sessionAttributes(envelope);
  const type = requestType(envelope);
  if (type === "LaunchRequest") {
    const live = activeCall(dependencies.registry, attributes);
    if (live) return response(callStatus(live), runAttributes(attributes, live.run), false, true);
    const last = lastCall(dependencies.registry, attributes);
    const recent = last && Date.now() - Date.parse(last.run.updatedAt) < RECENT_CALL_MS && (last.run.status === "failed" || last.run.status === "unknown" || last.run.outcome !== undefined);
    if (last && recent) return response(`Your last call: ${callStatus(last)}`, runAttributes(attributes, last.run));
    return response("Who should I call? You can say: call Joe's Plumbing to fix the kitchen sink.", attributes);
  }
  if (type === "SessionEndedRequest") return response("Goodbye.", attributes, true);
  if (type !== "IntentRequest") throw new AlexaRequestError(400, "Unsupported Alexa request type");
  const intent = object(requestObject(envelope).intent);
  if (!intent) throw new AlexaRequestError(400, "Alexa intent is required");
  return intentResponse(intent, attributes, dependencies);
}
