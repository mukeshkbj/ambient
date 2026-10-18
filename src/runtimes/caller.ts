import { randomUUID } from "node:crypto";
import type { Brain } from "../calls/brain.js";
import { runCall, type CallHandle } from "../calls/call.js";
import type { Line } from "../calls/line.js";
import { amountsIn } from "../calls/rules.js";
import type { CallBrief, PhoneNumber } from "../calls/types.js";
import { householdFacts, type Household } from "../household.js";
import {
  AssistantEvented,
  type ApprovalPayload,
  type ApprovalResponse,
  type AssistantClient,
  type AssistantSession,
  type InterruptResult,
  type RuntimeCapabilities,
  type SteerResult,
  type SubmitResult
} from "./types.js";

export type CallerOptions = {
  household: Household;
  business: { name: string; phone: PhoneNumber };
  line: () => Line;
  brain: Brain;
  tickMs?: number;
};

export function spendingLimit(instruction: string): number | undefined {
  const match = /\b(?:under|below|less than|no more than|not more than|at most|up to|max(?:imum)?(?: of)?)\s+\$?([^.,;]+)/i.exec(instruction);
  return match ? amountsIn(match[1]!)[0] : undefined;
}

export class CallerClient extends AssistantEvented implements AssistantClient {
  readonly capabilities: RuntimeCapabilities = {
    sessions: true,
    steer: true,
    cancel: true,
    approvals: true,
    resume: false,
    events: true,
    asyncClass: "async"
  };

  readonly ephemeralSessions = true;

  private readonly calls = new Map<string, CallHandle>();

  constructor(private readonly options: CallerOptions) {
    super();
  }

  ping(): Promise<void> {
    this.emitState("online");
    return Promise.resolve();
  }

  createSession(): Promise<AssistantSession> {
    const id = randomUUID();
    return Promise.resolve({ runtimeSessionId: id, durableSessionId: id });
  }

  submitPrompt(sessionId: string, text: string): Promise<SubmitResult> {
    const { household, business } = this.options;
    const maxUsd = spendingLimit(text) ?? household.maxUsdDefault;
    const brief: CallBrief = {
      goal: text,
      business,
      ownerName: household.ownerName,
      ...(maxUsd !== undefined ? { maxUsd } : {}),
      facts: householdFacts(household)
    };
    this.emit({ type: "message.start", sessionId, payload: { kind: "call" } });
    this.emit({ type: "status.update", sessionId, payload: { text: `Calling ${business.name}` } });
    const call = runCall({
      brief,
      callId: sessionId,
      line: this.options.line(),
      brain: this.options.brain,
      emit: event => this.emit({ ...event, sessionId }),
      ...(this.options.tickMs !== undefined ? { tickMs: this.options.tickMs } : {})
    });
    this.calls.set(sessionId, call);
    void call.done.then(() => this.calls.delete(sessionId));
    return Promise.resolve({ state: "streaming" });
  }

  steer(sessionId: string, text: string): Promise<SteerResult> {
    const call = this.calls.get(sessionId);
    call?.ownerSaid(text);
    return Promise.resolve({ state: call ? "accepted" : "no_call" });
  }

  respondToApproval(sessionId: string, requestId: string, choice: string): Promise<ApprovalResponse> {
    const resolved = this.calls.get(sessionId)?.ownerDecided(requestId, choice === "deny" ? "deny" : "once") ?? false;
    return Promise.resolve({ resolved: resolved ? 1 : 0 });
  }

  listPendingApprovals(sessionId: string): Promise<ApprovalPayload[]> {
    const phase = this.calls.get(sessionId)?.state().phase;
    if (phase?.kind !== "waiting_for_owner") return Promise.resolve([]);
    const { requestId, question, amountUsd } = phase;
    return Promise.resolve([{
      requestId,
      command: question,
      description: question,
      choices: ["once", "deny"],
      kind: amountUsd !== undefined ? "spend" : "other",
      ...(amountUsd !== undefined ? { amountUsd } : {})
    }]);
  }

  interrupt(sessionId: string): Promise<InterruptResult> {
    this.calls.get(sessionId)?.hangUp();
    return Promise.resolve({ state: "interrupted" });
  }

  close(): void {
    for (const call of this.calls.values()) call.hangUp();
  }
}
