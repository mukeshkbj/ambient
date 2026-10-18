import { randomUUID } from "node:crypto";
import type { Brain } from "../calls/brain.js";
import { runCall, type CallHandle } from "../calls/call.js";
import type { Candidate } from "../calls/discover.js";
import type { Line } from "../calls/line.js";
import { EARLIER_CALL } from "../calls/prompt.js";
import { amountsIn, checkDialLimits, noteFromCall, type PlacedCall } from "../calls/rules.js";
import { parsePhoneNumber, type CallBrief, type CallOutcome, type CallRecord, type PhoneNumber } from "../calls/types.js";
import { householdFacts, type Household } from "../household.js";
import { dollarsInWords } from "../words.js";
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

type CallerMemory = {
  history(phone: PhoneNumber): CallRecord[];
  recordCall(call: CallRecord): void;
  facts(phone: PhoneNumber): string[];
  addFact(phone: PhoneNumber, fact: string): void;
  placedCalls(): PlacedCall[];
};

export type CallerOptions = {
  household: Household;
  business: { name: string; phone: PhoneNumber };
  line: () => Line;
  brain: Brain;
  discover?: (goal: string, household: Household) => Promise<Candidate[]>;
  memory?: CallerMemory;
  limitDials?: boolean;
  tickMs?: number;
};

export function spendingLimit(instruction: string): number | undefined {
  const match = /\b(?:under|below|less than|no more than|not more than|at most|up to|max(?:imum)?(?: of)?)\s+\$?([^.,;]+)/i.exec(instruction);
  return match ? amountsIn(match[1]!)[0] : undefined;
}

function dialedNumber(raw: string): PhoneNumber | undefined {
  try {
    return parsePhoneNumber(raw);
  } catch {
    return undefined;
  }
}

function phoneIn(text: string): PhoneNumber | undefined {
  for (const match of text.matchAll(/[+\d][+\d\s().-]*/g)) {
    if (match[0].replace(/\D/g, "").length < 10) continue;
    const phone = dialedNumber(match[0]);
    if (phone) return phone;
  }
  return undefined;
}

function mentions(text: string, name: string): boolean {
  return text.toLowerCase().includes(name.toLowerCase());
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function describeOutcome(outcome: CallOutcome): string {
  if (outcome.kind !== "confirmed") return `${outcome.kind}, ${outcome.reason}`;
  const quoted = outcome.amountUsd !== undefined ? `, quoted ${dollarsInWords(outcome.amountUsd)}` : "";
  const when = outcome.when ? `, ${outcome.when}` : "";
  return `confirmed${quoted}${when}`;
}

type DialChoice = "once" | "deny" | "cancel";

type PendingDial = {
  requestId: string;
  question: string;
  decide(choice: DialChoice): void;
};

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
  private readonly pendingDials = new Map<string, PendingDial>();
  private readonly inFlight = new Map<string, PlacedCall>();
  private readonly cancelled = new Set<string>();
  private closed = false;

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
    this.emit({ type: "message.start", sessionId, payload: { kind: "call" } });
    void this.begin(sessionId, text).catch((error: unknown) => {
      this.emit({
        type: "message.complete",
        sessionId,
        payload: { status: "error", error: error instanceof Error ? error.message : String(error) }
      });
    });
    return Promise.resolve({ state: "streaming" });
  }

  steer(sessionId: string, text: string): Promise<SteerResult> {
    const call = this.calls.get(sessionId);
    call?.ownerSaid(text);
    return Promise.resolve({ state: call ? "accepted" : "no_call" });
  }

  respondToApproval(sessionId: string, requestId: string, choice: string): Promise<ApprovalResponse> {
    const pending = this.pendingDials.get(sessionId);
    if (pending?.requestId === requestId) {
      this.pendingDials.delete(sessionId);
      pending.decide(choice === "deny" ? "deny" : "once");
      return Promise.resolve({ resolved: 1 });
    }
    const resolved = this.calls.get(sessionId)?.ownerDecided(requestId, choice === "deny" ? "deny" : "once") ?? false;
    return Promise.resolve({ resolved: resolved ? 1 : 0 });
  }

  listPendingApprovals(sessionId: string): Promise<ApprovalPayload[]> {
    const pending = this.pendingDials.get(sessionId);
    if (pending) {
      return Promise.resolve([{
        requestId: pending.requestId,
        command: pending.question,
        description: pending.question,
        choices: ["once", "deny"],
        kind: "dial"
      }]);
    }
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
    this.cancelled.add(sessionId);
    const pending = this.pendingDials.get(sessionId);
    if (pending) {
      this.pendingDials.delete(sessionId);
      pending.decide("cancel");
    }
    this.calls.get(sessionId)?.hangUp();
    return Promise.resolve({ state: "interrupted" });
  }

  close(): void {
    this.closed = true;
    for (const pending of this.pendingDials.values()) pending.decide("cancel");
    this.pendingDials.clear();
    for (const call of this.calls.values()) call.hangUp();
  }

  private async begin(sessionId: string, instruction: string): Promise<void> {
    const { household, business } = this.options;
    const maxUsd = spendingLimit(instruction) ?? household.maxUsdDefault;
    const given = phoneIn(instruction);
    if (given) {
      const name = mentions(instruction, business.name) ? business.name : given;
      this.dial(sessionId, { name, phone: given }, instruction, maxUsd);
      return;
    }
    if (mentions(instruction, business.name) || !this.options.discover) {
      this.dial(sessionId, business, instruction, maxUsd);
      return;
    }
    this.emit({ type: "status.update", sessionId, payload: { text: "Looking for a business near you." } });
    const found = await this.options.discover(instruction, household);
    if (this.cancelled.has(sessionId)) return;
    const candidates = this.ranked(found);
    for (const [index, candidate] of candidates.entries()) {
      const decision = await this.askToDial(sessionId, `${sessionId}:dial-${index}`, this.dialQuestion(candidate));
      if (decision === "cancel") return;
      if (decision === "once") {
        this.dial(sessionId, { name: candidate.name, phone: candidate.phone }, instruction, maxUsd);
        return;
      }
    }
    this.emit({
      type: "message.complete",
      sessionId,
      payload: {
        text: "I couldn't find a business you're happy to call.",
        status: "completed",
        outcome: { kind: "no_deal", reason: "no suitable business" }
      }
    });
  }

  private ranked(candidates: Candidate[]): Candidate[] {
    const memory = this.options.memory;
    if (!memory) return candidates;
    const used = new Set(
      candidates
        .filter(candidate => memory.history(candidate.phone).some(call => call.outcome.kind === "confirmed"))
        .map(candidate => candidate.phone)
    );
    return [...candidates].sort((a, b) => Number(used.has(b.phone)) - Number(used.has(a.phone)));
  }

  private dialQuestion(candidate: Candidate): string {
    const used = this.options.memory?.history(candidate.phone).find(call => call.outcome.kind === "confirmed");
    if (!used || used.outcome.kind !== "confirmed") return `I found ${candidate.name}. ${candidate.why} Call them?`;
    const amount = used.outcome.amountUsd !== undefined ? ` for ${dollarsInWords(used.outcome.amountUsd)}` : "";
    return `You used ${candidate.name} on ${dayLabel(used.at)}${amount}. Call them again?`;
  }

  private askToDial(sessionId: string, requestId: string, question: string): Promise<DialChoice> {
    return new Promise(resolve => {
      this.pendingDials.set(sessionId, { requestId, question, decide: resolve });
      this.emit({
        type: "approval.request",
        sessionId,
        payload: { requestId, command: question, description: question, choices: ["once", "deny"], kind: "dial" }
      });
    });
  }

  private dial(sessionId: string, business: { name: string; phone: PhoneNumber }, instruction: string, maxUsd: number | undefined): void {
    const { household, memory } = this.options;
    if (this.cancelled.has(sessionId)) return;
    const now = new Date().toISOString();
    const placed = [...(memory?.placedCalls() ?? []), ...this.inFlight.values()];
    const limit = this.options.limitDials === false ? { ok: true as const } : checkDialLimits(placed, business.phone, now);
    if (!limit.ok) {
      this.emit({
        type: "message.complete",
        sessionId,
        payload: { text: limit.reason, status: "completed", outcome: { kind: "no_deal", reason: "call limit reached" } }
      });
      return;
    }
    const brief: CallBrief = {
      goal: instruction,
      business,
      ownerName: household.ownerName,
      ...(maxUsd !== undefined ? { maxUsd } : {}),
      facts: [...householdFacts(household), ...(memory?.facts(business.phone) ?? []).map(fact => `${EARLIER_CALL} ${fact}`), ...this.pastCalls(business.phone)]
    };
    this.emit({ type: "status.update", sessionId, payload: { text: `Calling ${business.name}`, subject: business.name } });
    const last = memory?.history(business.phone)[0];
    if (last) this.emit({ type: "status.update", sessionId, payload: { text: `Remembered from ${dayLabel(last.at)} — ${describeOutcome(last.outcome)}` } });
    const line = this.options.line();
    const call = runCall({
      brief,
      callId: sessionId,
      line,
      brain: this.options.brain,
      emit: event => this.emit({ ...event, sessionId }),
      ...(memory ? { remember: fact => {
        const note = noteFromCall(fact);
        if (note) memory.addFact(business.phone, note);
      } } : {}),
      ...(this.options.tickMs !== undefined ? { tickMs: this.options.tickMs } : {})
    });
    this.calls.set(sessionId, call);
    this.inFlight.set(sessionId, { to: business.phone, startedAt: now });
    if (line.joinUrl) this.emit({ type: "status.update", sessionId, payload: { text: `Waiting for ${business.name} to answer at ${line.joinUrl}` } });
    void call.done.then(state => {
      this.calls.delete(sessionId);
      this.inFlight.delete(sessionId);
      if (memory && !this.closed && state.phase.kind === "ended") {
        memory.recordCall({
          runId: sessionId,
          businessName: business.name,
          phone: business.phone,
          goal: instruction,
          outcome: state.phase.outcome,
          at: new Date().toISOString()
        });
      }
    });
  }

  private pastCalls(phone: PhoneNumber): string[] {
    const memory = this.options.memory;
    if (!memory) return [];
    return memory.history(phone).slice(0, 3).map(call => `Last call on ${dayLabel(call.at)}: ${describeOutcome(call.outcome)}.`);
  }
}
