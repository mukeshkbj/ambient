import { randomUUID } from "node:crypto";
import type { Brain } from "../calls/brain.js";
import { runCall, type CallHandle } from "../calls/call.js";
import type { Candidate } from "../calls/discover.js";
import type { Line } from "../calls/line.js";
import { EARLIER_CALL } from "../calls/prompt.js";
import { amountsIn, blockedNumber, checkDialLimits, noteFromCall, OPTED_OUT, type PlacedCall } from "../calls/rules.js";
import { parsePhoneNumber, type CallBrief, type CallOutcome, type CallRecord, type PhoneNumber } from "../calls/types.js";
import { householdFacts, type Household } from "../household.js";
import { dollarsInWords, numberInWords } from "../words.js";
import { errandStep, startErrand, type ErrandEffect, type ErrandInput, type ErrandState } from "../calls/errand.js";
import type { BoardCall } from "../types.js";
import type { Language } from "../calls/language.js";
import {
  AssistantEvented,
  type ApprovalPayload,
  type AssistantEvent,
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
  line: (business: Business) => Line;
  brain: Brain;
  discover?: (goal: string, household: Household) => Promise<Candidate[]>;
  memory?: CallerMemory;
  limitDials?: boolean;
  tickMs?: number;
  quoteWindowMs?: number;
};

type Business = { name: string; phone: PhoneNumber; language?: Language };

type Errand = {
  state: ErrandState;
  calls: Map<string, CallHandle>;
  board: BoardCall[];
  maxUsd?: number;
  ask?: { requestId: string; question: string; amountUsd?: number; when?: string };
  timer?: NodeJS.Timeout;
  feed(input: ErrandInput): void;
};

const AROUND_WORDS = /\b(?:call around|shop around|compare|cheapest|quotes?)\b/i;

function names(businesses: Business[]): string {
  const list = businesses.map(business => business.name);
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] ?? "";
}

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
  private readonly errands = new Map<string, Errand>();
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
    void this.begin(sessionId, text).finally(() => this.cancelled.delete(sessionId)).catch((error: unknown) => {
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
    const errand = this.errands.get(sessionId);
    if (errand?.ask?.requestId === requestId) {
      delete errand.ask;
      errand.feed({ kind: "owner_decided", decision: choice === "deny" ? "deny" : "once" });
      return Promise.resolve({ resolved: 1 });
    }
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
    const ask = this.errands.get(sessionId)?.ask;
    if (ask) {
      return Promise.resolve([{
        requestId: ask.requestId,
        command: ask.question,
        description: ask.question,
        choices: ["once", "deny"],
        kind: ask.amountUsd !== undefined ? "spend" : "other",
        ...(ask.amountUsd !== undefined ? { amountUsd: ask.amountUsd } : {}),
        ...(ask.when ? { when: ask.when } : {})
      }]);
    }
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
    for (const errandCall of this.errands.get(sessionId)?.calls.values() ?? []) errandCall.hangUp();
    const call = this.calls.get(sessionId);
    if (call) call.hangUp();
    else this.cancelled.add(sessionId);
    const pending = this.pendingDials.get(sessionId);
    if (pending) {
      this.pendingDials.delete(sessionId);
      pending.decide("cancel");
    }
    return Promise.resolve({ state: "interrupted" });
  }

  close(): void {
    this.closed = true;
    for (const pending of this.pendingDials.values()) pending.decide("cancel");
    this.pendingDials.clear();
    for (const call of this.calls.values()) call.hangUp();
    for (const errand of this.errands.values()) {
      clearTimeout(errand.timer);
      for (const call of errand.calls.values()) call.hangUp();
    }
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
    if (AROUND_WORDS.test(instruction) && candidates.length > 1) {
      const chosen = candidates.slice(0, 3);
      const decision = await this.askToDial(sessionId, `${sessionId}:dial-all`, `I found ${names(chosen)}. Call ${chosen.length === 2 ? "both" : `all ${numberInWords(chosen.length)}`} and book the best quote under your limit?`);
      if (decision === "once") this.callAround(sessionId, chosen.map(candidate => ({ name: candidate.name, phone: candidate.phone, ...(candidate.language ? { language: candidate.language } : {}) })), instruction, maxUsd);
      if (decision !== "deny") return;
      candidates.length = 0;
    }
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

  private dial(sessionId: string, business: Business, instruction: string, maxUsd: number | undefined): void {
    if (this.cancelled.has(sessionId)) return;
    const call = this.placeCall(sessionId, business, instruction, maxUsd, event => this.emit({ ...event, sessionId }));
    if (!call) return;
    this.calls.set(sessionId, call);
    void call.done.then(() => this.calls.delete(sessionId));
  }

  private callAround(sessionId: string, chosen: Business[], instruction: string, maxUsd: number | undefined): void {
    if (this.cancelled.has(sessionId)) return;
    const errand: Errand = {
      state: startErrand({ ...(maxUsd !== undefined ? { limitUsd: maxUsd } : {}), calls: chosen.map((business, index) => ({ callId: `${sessionId}:${index}`, business: business.name })) }),
      calls: new Map(),
      board: chosen.map(business => ({ business: business.name, state: "calling" })),
      ...(maxUsd !== undefined ? { maxUsd } : {}),
      feed: () => {}
    };
    this.errands.set(sessionId, errand);
    const publish = (text: string) => this.emit({ type: "status.update", sessionId, payload: { text, board: errand.board } });
    const mark = (index: number, patch: Partial<BoardCall>) => {
      errand.board = errand.board.map((item, at) => at === index ? { ...item, ...patch } : item);
    };
    errand.feed = input => {
      const result = errandStep(errand.state, input, new Date().toISOString());
      errand.state = result.state;
      for (const effect of result.effects) this.applyErrand(sessionId, errand, effect, mark, publish);
    };
    publish(`Calling ${names(chosen)} at once`);
    errand.timer = setTimeout(() => errand.feed({ kind: "deadline" }), this.options.quoteWindowMs ?? 120_000);
    errand.timer.unref();
    chosen.forEach((business, index) => {
      const callId = `${sessionId}:${index}`;
      const call = this.placeCall(callId, business, instruction, maxUsd, event => {
        if (event.type === "approval.request") {
          const { requestId, amountUsd, when } = event.payload;
          mark(index, { state: "quoted", ...(amountUsd !== undefined ? { amountUsd } : {}), ...(when ? { when } : {}) });
          publish(`${business.name} quoted ${amountUsd !== undefined ? dollarsInWords(amountUsd) : "no price"}${when ? ` for ${when}` : ""}`);
          errand.feed({ kind: "quoted", callId, requestId, ...(amountUsd !== undefined ? { amountUsd } : {}), ...(when ? { when } : {}) });
          return;
        }
        if (event.type === "message.complete") {
          const outcome = event.payload.outcome ?? { kind: "unconfirmed" as const, reason: "the call ended" };
          const state = errand.board[index]!.state;
          mark(index, { state: outcome.kind === "confirmed" ? "booked" : state === "released" ? "released" : "ended" });
          errand.feed({ kind: "ended", callId, outcome });
          return;
        }
        if (event.type === "status.update") {
          const text = event.payload.text?.replace(/^Ambient: /, `Ambient to ${business.name}: `);
          if (errand.board[index]!.state === "calling" && (text?.startsWith(`${business.name}: `) || text === `Connected to ${business.name}`)) mark(index, { state: "talking" });
          if (text) this.emit({ type: "status.update", sessionId, payload: { text, board: errand.board } });
        }
      }, true);
      if (call) errand.calls.set(callId, call);
    });
  }

  private applyErrand(sessionId: string, errand: Errand, effect: ErrandEffect, mark: (index: number, patch: Partial<BoardCall>) => void, publish: (text: string) => void): void {
    const index = errand.state.calls.findIndex(call => "callId" in effect && call.callId === effect.callId);
    switch (effect.kind) {
      case "approve":
        mark(index, { state: "booking" });
        publish(`Booking ${errand.board[index]!.business}`);
        if (effect.byOwner) errand.calls.get(effect.callId)?.ownerDecided(effect.requestId, "once");
        else errand.calls.get(effect.callId)?.choose(effect.requestId);
        return;
      case "release":
        mark(index, { state: "released" });
        errand.calls.get(effect.callId)?.release(effect.requestId);
        return;
      case "ask_owner": {
        const terms = `${effect.amountUsd !== undefined ? dollarsInWords(effect.amountUsd) : "no price"}${effect.when ? ` for ${effect.when}` : ""}`;
        const over = effect.amountUsd !== undefined && errand.maxUsd !== undefined ? `, over your limit of ${dollarsInWords(errand.maxUsd)}` : "";
        const question = `${effect.business} has the best quote: ${terms}${over}. Should I book it?`;
        errand.ask = { requestId: `${sessionId}:best`, question, ...(effect.amountUsd !== undefined ? { amountUsd: effect.amountUsd } : {}), ...(effect.when ? { when: effect.when } : {}) };
        this.emit({
          type: "approval.request",
          sessionId,
          payload: {
            requestId: errand.ask.requestId,
            command: question,
            description: question,
            choices: ["once", "deny"],
            kind: effect.amountUsd !== undefined ? "spend" : "other",
            ...(effect.amountUsd !== undefined ? { amountUsd: effect.amountUsd } : {}),
            ...(errand.maxUsd !== undefined ? { limitUsd: errand.maxUsd } : {}),
            ...(effect.when ? { when: effect.when } : {})
          }
        });
        return;
      }
      case "done": {
        clearTimeout(errand.timer);
        this.errands.delete(sessionId);
        const booked = errand.state.calls.find(call => call.callId === effect.booked)?.outcome;
        const outcome = booked ?? { kind: "no_deal" as const, reason: "no quote was booked" };
        this.emit({ type: "status.update", sessionId, payload: { text: booked ? `Booked ${errand.board[index >= 0 ? index : 0]!.business}` : "No quote was booked", board: errand.board } });
        this.emit({ type: "message.complete", sessionId, payload: { text: outcome.kind === "confirmed" ? outcome.summary : outcome.reason, status: "completed", outcome } });
      }
    }
  }

  private placeCall(callId: string, business: Business, instruction: string, maxUsd: number | undefined, emit: (event: AssistantEvent) => void, compare = false): CallHandle | undefined {
    const { household, memory } = this.options;
    if (memory?.facts(business.phone).includes(OPTED_OUT)) {
      emit({
        type: "message.complete",
        payload: { text: `${business.name} asked not to be called by an AI, so I didn't call.`, status: "completed", outcome: { kind: "no_deal", reason: "they asked not to be called by an AI" } }
      });
      return undefined;
    }
    const now = new Date().toISOString();
    const placed = [...(memory?.placedCalls() ?? []), ...this.inFlight.values()];
    const blocked = blockedNumber(business.phone);
    const limit = blocked ?? (this.options.limitDials === false ? { ok: true as const } : checkDialLimits(placed, business.phone, now));
    if (!limit.ok) {
      emit({
        type: "message.complete",
        payload: { text: limit.reason, status: "completed", outcome: { kind: "no_deal", reason: blocked ? "premium-rate number" : "call limit reached" } }
      });
      return undefined;
    }
    const brief: CallBrief = {
      goal: instruction,
      business,
      ownerName: household.ownerName,
      ...(maxUsd !== undefined ? { maxUsd } : {}),
      ...(compare ? { compare: true as const } : {}),
      ...(business.language ? { language: business.language } : {}),
      facts: [...householdFacts(household), ...(memory?.facts(business.phone) ?? []).map(fact => `${EARLIER_CALL} ${fact}`), ...this.pastCalls(business.phone)]
    };
    emit({ type: "status.update", payload: { text: `Calling ${business.name}`, ...(compare ? {} : { subject: business.name }) } });
    const last = memory?.history(business.phone)[0];
    if (last) emit({ type: "status.update", payload: { text: `Remembered from ${dayLabel(last.at)} — ${describeOutcome(last.outcome)}` } });
    const line = this.options.line(business);
    const call = runCall({
      brief,
      callId,
      line,
      brain: this.options.brain,
      emit,
      ...(memory ? { remember: fact => {
        const note = noteFromCall(fact);
        if (note) memory.addFact(business.phone, note);
      } } : {}),
      ...(this.options.tickMs !== undefined ? { tickMs: this.options.tickMs } : {})
    });
    this.inFlight.set(callId, { to: business.phone, startedAt: now });
    if (line.joinUrl) emit({ type: "status.update", payload: { text: `Waiting for ${business.name} to answer at ${line.joinUrl}` } });
    void call.done.then(state => {
      this.inFlight.delete(callId);
      if (memory && !this.closed && state.phase.kind === "ended") {
        memory.recordCall({
          runId: callId,
          businessName: business.name,
          phone: business.phone,
          goal: instruction,
          outcome: state.phase.outcome,
          at: new Date().toISOString()
        });
      }
    });
    return call;
  }

  private pastCalls(phone: PhoneNumber): string[] {
    const memory = this.options.memory;
    if (!memory) return [];
    return memory.history(phone).slice(0, 3).flatMap(call => {
      const note = noteFromCall(`${dayLabel(call.at)}, ${describeOutcome(call.outcome)}.`);
      return note ? [`${EARLIER_CALL} ${note}`] : [];
    });
  }
}
