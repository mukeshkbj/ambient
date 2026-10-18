import { dollarsInWords } from "../words.js";
import { affirms, amountsIn, chargedIn, disclosure, HOLD_LINE_MS, holdTrailingDigits, offerIn, OWNER_PATIENCE_MS, redactDigits, refuses } from "./rules.js";
import type { BrainStep, CallBrief, CallEffect, CallInput, CallOutcome, CallPhase, CallTurn, Speaker } from "./types.js";

export type CallState = {
  callId: string;
  brief: CallBrief;
  phase: CallPhase;
  turns: CallTurn[];
  turn: number;
  asks: number;
  approvedUsd: number[];
  deniedUsd: number[];
  disclosed: boolean;
  askedToConfirm: boolean;
  draft: string;
  held: string;
};

export type Transition = { state: CallState; effects: CallEffect[] };

const DIAL_FAILURES = { no_answer: "no answer", busy: "busy", failed: "failed", hangup: "the line ended before they answered" } as const;
const DROPPED = "the line ended before they confirmed";

export function startCall(brief: CallBrief, callId: string): Transition {
  return {
    state: {
      callId,
      brief,
      phase: { kind: "dialing" },
      turns: [],
      turn: 0,
      asks: 0,
      approvedUsd: [],
      deniedUsd: [],
      disclosed: false,
      askedToConfirm: false,
      draft: "",
      held: ""
    },
    effects: []
  };
}

export function step(state: CallState, input: CallInput, now: string): Transition {
  const next = transition(state, input, now);
  const transcript = next.state.turns.slice(state.turns.length).map(turn => status(transcriptLine(state.brief, turn), turn.speaker));
  const isCompletion = (effect: CallEffect) => effect.kind === "emit" && effect.event.type === "message.complete";
  return { state: next.state, effects: [...next.effects.filter(effect => !isCompletion(effect)), ...transcript, ...next.effects.filter(isCompletion)] };
}

function transition(state: CallState, input: CallInput, now: string): Transition {
  const { phase, brief } = state;
  if (phase.kind === "ended") return unchanged(state);
  switch (input.kind) {
    case "answered":
      if (phase.kind !== "dialing") return unchanged(state);
      return {
        state: { ...withTurn(state, "agent", disclosure(brief.ownerName), now), phase: { kind: "talking" }, disclosed: true },
        effects: [status(`Connected to ${brief.business.name}`)]
      };
    case "heard": {
      if (phase.kind === "dialing") {
        const live = transition(state, { kind: "answered" }, now);
        const next = transition(live.state, input, now);
        return { state: next.state, effects: [...live.effects, ...next.effects] };
      }
      const heard = withTurn(flushDraft(state, now), "business", input.text, now);
      if (phase.kind === "waiting_for_owner") {
        if (phase.lastHoldLine !== phase.since && !(Date.parse(now) - Date.parse(phase.lastHoldLine) >= HOLD_LINE_MS)) return { state: heard, effects: [] };
        const line = `Still checking with ${brief.ownerName}, one moment.`;
        return { state: { ...withTurn(heard, "agent", line, now), phase: { ...phase, lastHoldLine: now } }, effects: [say(line)] };
      }
      if (!state.disclosed) {
        const line = disclosure(brief.ownerName);
        const disclosed = { ...withTurn(heard, "agent", line, now), disclosed: true };
        const thought = think(disclosed);
        return { state: thought.state, effects: [say(line), ...thought.effects] };
      }
      return think(heard);
    }
    case "interrupted": {
      if (phase.kind === "dialing") return unchanged(state);
      const last = state.turns.findLast(turn => turn.speaker === "agent");
      const cutDisclosure = !state.draft && last?.text === disclosure(brief.ownerName) && input.spokenSoFar.trim() !== last.text;
      return { state: { ...truncateAgent(state, input.spokenSoFar, now), turn: state.turn + 1, ...(cutDisclosure ? { disclosed: false } : {}) }, effects: [] };
    }
    case "line_ended": {
      const reason = phase.kind === "dialing" ? DIAL_FAILURES[input.reason] : DROPPED;
      return end(flushDraft(state, now), { kind: "unconfirmed", reason }, []);
    }
    case "brain":
      if (phase.kind !== "talking" || input.turn !== state.turn) return unchanged(state);
      return brainStep(state, input.step, now);
    case "owner_said": {
      const offer = offerIn(input.text);
      const ledger = offer !== undefined ? { approvedUsd: [...state.approvedUsd, offer], deniedUsd: state.deniedUsd.filter(amount => amount !== offer) } : {};
      const noted = ownerNote(flushDraft(state, now), input.text, now, ledger);
      if (phase.kind === "dialing") return { state: noted, effects: [] };
      return think({ ...noted, phase: { kind: "talking" } });
    }
    case "owner_decided": {
      if (phase.kind !== "waiting_for_owner" || phase.requestId !== input.requestId) return unchanged(state);
      const approved = input.decision === "once";
      const note = `${brief.ownerName} ${approved ? "approved" : "declined"}: ${phase.question}`;
      const amount = phase.amountUsd;
      const ledger = amount === undefined ? {} : approved ? { approvedUsd: [...state.approvedUsd, amount] } : { deniedUsd: [...state.deniedUsd, amount] };
      return think({ ...ownerNote(state, note, now, ledger), phase: { kind: "talking" } });
    }
    case "hold_tick": {
      if (phase.kind !== "waiting_for_owner") return unchanged(state);
      const elapsed = (from: string) => Date.parse(now) - Date.parse(from);
      if (elapsed(phase.since) >= OWNER_PATIENCE_MS) {
        const line = `I'm sorry, I can't reach ${brief.ownerName} right now. ${brief.ownerName} will call you back. Thank you, goodbye.`;
        const closed = withTurn(state, "agent", line, now);
        return end(closed, { kind: "unconfirmed", reason: `${brief.ownerName} didn't answer in time, so nothing was agreed` }, [say(line), { kind: "hang_up" }]);
      }
      if (!(elapsed(phase.lastHoldLine) >= HOLD_LINE_MS)) return unchanged(state);
      const line = `Still checking with ${brief.ownerName}, thanks for holding.`;
      return { state: { ...withTurn(state, "agent", line, now), phase: { ...phase, lastHoldLine: now } }, effects: [say(line)] };
    }
  }
}

function brainStep(state: CallState, brain: BrainStep, now: string): Transition {
  switch (brain.kind) {
    case "say": {
      const { ready: raw, held } = brain.last ? { ready: state.held + brain.text, held: "" } : holdTrailingDigits(state.held + brain.text);
      const ready = redactDigits(raw);
      const drafted = { ...state, draft: state.draft + ready, held };
      const effects: CallEffect[] = ready || brain.last ? [say(ready, brain.last)] : [];
      return { state: brain.last ? flushDraft(drafted, now) : drafted, effects };
    }
    case "ask_owner":
      return askOwner(state, brain.question, brain.amountUsd, now);
    case "remember":
      return { state, effects: [{ kind: "remember", fact: brain.fact }] };
    case "end_call":
      return brain.outcome.kind === "confirmed" ? confirm(state, brain.outcome, now) : close(state, brain.outcome, now);
  }
}

function confirm(state: CallState, outcome: Extract<CallOutcome, { kind: "confirmed" }>, now: string): Transition {
  const { brief } = state;
  const owner = brief.ownerName;
  const charges = [...(outcome.amountUsd !== undefined ? [outcome.amountUsd] : []), ...chargedIn(outcome.summary)].filter(amount => Number.isFinite(amount) && amount > 0);
  const charge = charges.length > 0 ? Math.max(...charges) : undefined;
  const limit = brief.maxUsd ?? 0;
  if (charge !== undefined && state.deniedUsd.includes(charge)) {
    return close(state, { kind: "no_deal", reason: `${owner} declined ${dollarsInWords(charge)}` }, now,
      `Okay. ${owner} won't go ahead at that price, so we'll leave it there. Thanks for your time, goodbye.`);
  }
  if (charge !== undefined && charge > limit && !state.approvedUsd.includes(charge)) {
    const question = `${brief.business.name} wants ${dollarsInWords(charge)}, over your limit of ${dollarsInWords(limit)}. Should I agree?`;
    return askOwner(state, question, charge, now);
  }
  const flushed = flushDraft(state, now);
  if (!evidenced(flushed, charge)) {
    if (state.askedToConfirm) {
      const line = `I'll have ${owner} follow up to confirm. Thanks for your time, goodbye.`;
      return end(withTurn(flushed, "agent", line, now), { kind: "unconfirmed", reason: "they never clearly confirmed it" }, [say(line), { kind: "hang_up" }]);
    }
    const when = outcome.when ? `, ${outcome.when}` : "";
    const price = charge === undefined ? "" : Number.isInteger(charge) ? dollarsInWords(charge) : `$${charge.toFixed(2)}`;
    const line = charge !== undefined ? `Just to confirm, that's ${price}${when}?` : `Just to confirm, are we all set${when}?`;
    return { state: { ...withTurn(flushed, "agent", line, now), askedToConfirm: true }, effects: [say(line)] };
  }
  const settled = { ...outcome, ...(charge !== undefined ? { amountUsd: charge } : {}) };
  return close(state, settled, now);
}

function evidenced(state: CallState, charge: number | undefined): boolean {
  const line = state.turns.filter(turn => turn.speaker !== "owner");
  const lastBusiness = line.findLast(turn => turn.speaker === "business");
  if (!lastBusiness || refuses(lastBusiness.text)) return false;
  if (charge === undefined) return affirms(lastBusiness.text);
  const mentions = (turn: CallTurn) => amountsIn(turn.text).includes(charge);
  if (line.some(turn => turn.speaker === "business" && mentions(turn) && !refuses(turn.text))) return true;
  return line.some((turn, index) => {
    if (turn.speaker !== "agent" || !mentions(turn)) return false;
    const reply = line.slice(index + 1).find(next => next.speaker === "business");
    return reply !== undefined && affirms(reply.text);
  });
}

function close(state: CallState, outcome: Exclude<CallOutcome, { kind: "unconfirmed" }>, now: string, line?: string): Transition {
  const closing = line ?? (outcome.kind === "confirmed" ? "Great, thank you so much. Goodbye." : "Okay, thanks for your time. Goodbye.");
  return end(withTurn(flushDraft(state, now), "agent", closing, now), outcome, [say(closing), { kind: "hang_up" }]);
}

function askOwner(state: CallState, question: string, amountUsd: number | undefined, now: string): Transition {
  const asks = state.asks + 1;
  const requestId = `${state.callId}:ask-${asks}`;
  const line = `One moment, let me check with ${state.brief.ownerName}.`;
  const amount = amountUsd !== undefined ? { amountUsd } : {};
  const limit = state.brief.maxUsd !== undefined ? { limitUsd: state.brief.maxUsd } : {};
  const waiting = withTurn(flushDraft(state, now), "agent", line, now);
  return {
    state: { ...waiting, asks, phase: { kind: "waiting_for_owner", requestId, question, ...amount, since: now, lastHoldLine: now } },
    effects: [
      say(line),
      {
        kind: "emit",
        event: {
          type: "approval.request",
          payload: { requestId, command: question, description: question, choices: ["once", "deny"], kind: amountUsd !== undefined ? "spend" : "other", ...amount, ...limit }
        }
      }
    ]
  };
}

function end(state: CallState, outcome: CallOutcome, effects: CallEffect[]): Transition {
  const text = outcome.kind === "confirmed" ? outcome.summary : outcome.reason;
  return {
    state: { ...state, phase: { kind: "ended", outcome } },
    effects: [...effects, { kind: "emit", event: { type: "message.complete", payload: { text, status: "completed", outcome } } }]
  };
}

function think(state: CallState): Transition {
  const turn = state.turn + 1;
  return { state: { ...state, turn, draft: "", held: "" }, effects: [{ kind: "think", turn }] };
}

function ownerNote(state: CallState, note: string, now: string, ledger: Partial<Pick<CallState, "approvedUsd" | "deniedUsd">>): CallState {
  return { ...withTurn(state, "owner", note, now), ...ledger };
}

function flushDraft(state: CallState, now: string): CallState {
  const text = state.draft.trim();
  const flushed = { ...state, draft: "", held: "" };
  return text ? withTurn(flushed, "agent", text, now) : flushed;
}

function truncateAgent(state: CallState, spokenSoFar: string, now: string): CallState {
  const heard = spokenSoFar.trim();
  if (state.draft || state.held) {
    const reset = { ...state, draft: "", held: "" };
    return heard ? withTurn(reset, "agent", heard, now) : reset;
  }
  const index = state.turns.findLastIndex(turn => turn.speaker === "agent");
  if (index < 0) return state;
  const turns = state.turns.filter((_, at) => at !== index || heard);
  return { ...state, turns: heard ? turns.map((turn, at) => (at === index ? { ...turn, text: heard } : turn)) : turns };
}

function transcriptLine(brief: CallBrief, turn: CallTurn): string {
  const speaker = turn.speaker === "agent" ? "Ambient" : turn.speaker === "owner" ? brief.ownerName : brief.business.name;
  return `${speaker}: ${turn.text}`;
}

function withTurn(state: CallState, speaker: Speaker, text: string, at: string): CallState {
  return { ...state, turns: [...state.turns, { speaker, text, at }] };
}

function say(text: string, last = true): CallEffect {
  return { kind: "say", text, last };
}

function status(text: string, name?: string): CallEffect {
  return { kind: "emit", event: { type: "status.update", payload: { text, ...(name !== undefined ? { name } : {}) } } };
}

function unchanged(state: CallState): Transition {
  return { state, effects: [] };
}
