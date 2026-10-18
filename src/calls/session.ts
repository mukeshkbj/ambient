import { amountsIn, disclosure, HOLD_LINE_MS, holdTrailingDigits, redactDigits } from "./rules.js";
import type { BrainStep, CallBrief, CallEffect, CallInput, CallOutcome, CallPhase, CallTurn, Speaker } from "./types.js";

export type CallState = {
  callId: string;
  brief: CallBrief;
  phase: CallPhase;
  turns: CallTurn[];
  ownerNotes: string[];
  learned: string[];
  approvedUsd: number[];
  agentDraft: string;
  unsent: string;
  asks: number;
  awaitingBusiness: boolean;
  heldSince?: string;
};

export type Transition = { state: CallState; effects: CallEffect[] };

const DIAL_FAILURES = { no_answer: "no answer", busy: "busy", failed: "failed", hangup: "no answer" } as const;
const DROPPED = "the line ended before they confirmed";

export function startCall(brief: CallBrief, callId: string): Transition {
  return {
    state: {
      callId,
      brief,
      phase: { kind: "dialing" },
      turns: [],
      ownerNotes: [],
      learned: [],
      approvedUsd: [],
      agentDraft: "",
      unsent: "",
      asks: 0,
      awaitingBusiness: false
    },
    effects: []
  };
}

export function step(state: CallState, input: CallInput, now: string): Transition {
  const { phase } = state;
  if (phase.kind === "ended") return unchanged(state);
  switch (input.kind) {
    case "answered":
      if (phase.kind !== "dialing") return unchanged(state);
      return {
        state: { ...withTurn(state, "agent", disclosure(state.brief.ownerName), now), phase: { kind: "talking" } },
        effects: [status(`Connected to ${state.brief.business.name}`)]
      };
    case "heard": {
      if (phase.kind === "dialing") return unchanged(state);
      const heard = withTurn(flushDraft(state, now), "business", input.text, now);
      if (phase.kind === "waiting_for_owner") {
        const line = `Still checking with ${state.brief.ownerName}, one moment.`;
        return { state: { ...withTurn(heard, "agent", line, now), heldSince: now }, effects: [say(line)] };
      }
      return { state: thinking(heard), effects: [status(`${state.brief.business.name}: "${input.text}"`), { kind: "think" }] };
    }
    case "interrupted":
      if (phase.kind === "dialing") return unchanged(state);
      return { state: { ...truncateAgent(state, input.spokenSoFar, now), awaitingBusiness: phase.kind === "talking" }, effects: [] };
    case "line_ended": {
      const reason = phase.kind === "dialing" ? DIAL_FAILURES[input.reason] : DROPPED;
      return end(flushDraft(state, now), { kind: "unconfirmed", reason }, []);
    }
    case "brain":
      if (phase.kind !== "talking" || state.awaitingBusiness) return unchanged(state);
      return brainStep(state, input.step, now);
    case "owner_said": {
      const noted = ownerNote(state, input.text, amountsIn(input.text), now);
      if (phase.kind === "dialing") return { state: noted, effects: [] };
      return { state: resumeTalking(noted), effects: [{ kind: "think" }] };
    }
    case "owner_decided": {
      if (phase.kind !== "waiting_for_owner" || phase.requestId !== input.requestId) return unchanged(state);
      const approved = input.decision === "once";
      const note = `${state.brief.ownerName} ${approved ? "approved" : "declined"}: ${phase.question}`;
      const amounts = approved && phase.amountUsd !== undefined ? [phase.amountUsd] : [];
      const noted = ownerNote(state, note, amounts, now);
      return { state: resumeTalking(noted), effects: [{ kind: "think" }] };
    }
    case "hold_tick": {
      if (phase.kind !== "waiting_for_owner" || state.heldSince === undefined) return unchanged(state);
      if (Date.parse(now) - Date.parse(state.heldSince) < HOLD_LINE_MS) return unchanged(state);
      const line = `Still checking with ${state.brief.ownerName}, thanks for holding.`;
      return { state: { ...withTurn(state, "agent", line, now), heldSince: now }, effects: [say(line)] };
    }
  }
}

function brainStep(state: CallState, brain: BrainStep, now: string): Transition {
  switch (brain.kind) {
    case "say": {
      const redacted = redactDigits(state.unsent + brain.text);
      const { ready, held } = brain.last ? { ready: redacted, held: "" } : holdTrailingDigits(redacted);
      const drafted = { ...state, agentDraft: state.agentDraft + ready, unsent: held };
      const effects: CallEffect[] = ready || brain.last ? [say(ready, brain.last)] : [];
      return { state: brain.last ? flushDraft(drafted, now) : drafted, effects };
    }
    case "ask_owner":
      return askOwner(state, brain.question, brain.amountUsd, now);
    case "remember":
      return { state: { ...state, learned: [...state.learned, brain.fact] }, effects: [] };
    case "end_call": {
      const { outcome } = brain;
      const { maxUsd } = state.brief;
      const amount = outcome.kind === "confirmed" ? outcome.amountUsd : undefined;
      if (amount !== undefined && maxUsd !== undefined && amount > maxUsd && !state.approvedUsd.includes(amount)) {
        const question = `${state.brief.business.name} wants $${amount}, over your $${maxUsd} limit. Agree to it?`;
        return askOwner(state, question, amount, now);
      }
      const closing = outcome.kind === "confirmed" ? "Great, thank you so much. Goodbye." : "Okay, thanks for your time. Goodbye.";
      const closed = withTurn(flushDraft(state, now), "agent", closing, now);
      return end(closed, outcome, [say(closing), { kind: "hang_up" }]);
    }
  }
}

function askOwner(state: CallState, question: string, amountUsd: number | undefined, now: string): Transition {
  const asks = state.asks + 1;
  const requestId = `${state.callId}:ask-${asks}`;
  const line = `One moment, let me check with ${state.brief.ownerName}.`;
  const amount = amountUsd !== undefined ? { amountUsd } : {};
  const waiting = withTurn(flushDraft(state, now), "agent", line, now);
  return {
    state: { ...waiting, asks, heldSince: now, phase: { kind: "waiting_for_owner", requestId, question, ...amount } },
    effects: [
      say(line),
      {
        kind: "emit",
        event: {
          type: "approval.request",
          payload: { requestId, command: question, description: question, choices: ["once", "deny"], kind: amountUsd !== undefined ? "spend" : "other", ...amount }
        }
      }
    ]
  };
}

function end(state: CallState, outcome: CallOutcome, effects: CallEffect[]): Transition {
  const text = outcome.kind === "confirmed" ? outcome.summary : outcome.reason;
  const { heldSince: _, ...rest } = state;
  return {
    state: { ...rest, phase: { kind: "ended", outcome } },
    effects: [...effects, { kind: "emit", event: { type: "message.complete", payload: { text, status: "completed", outcome } } }]
  };
}

function ownerNote(state: CallState, note: string, amounts: number[], now: string): CallState {
  return {
    ...withTurn(state, "owner", note, now),
    ownerNotes: [...state.ownerNotes, note],
    approvedUsd: [...state.approvedUsd, ...amounts]
  };
}

function thinking(state: CallState): CallState {
  return { ...state, awaitingBusiness: false, agentDraft: "", unsent: "" };
}

function resumeTalking(state: CallState): CallState {
  const { heldSince: _, ...rest } = state;
  return thinking({ ...rest, phase: { kind: "talking" } });
}

function flushDraft(state: CallState, now: string): CallState {
  const text = (state.agentDraft + state.unsent).trim();
  const flushed = { ...state, agentDraft: "", unsent: "" };
  return text ? withTurn(flushed, "agent", redactDigits(text), now) : flushed;
}

function truncateAgent(state: CallState, spokenSoFar: string, now: string): CallState {
  const heard = spokenSoFar.trim();
  if (state.agentDraft || state.unsent) {
    const reset = { ...state, agentDraft: "", unsent: "" };
    return heard ? withTurn(reset, "agent", heard, now) : reset;
  }
  const last = state.turns.at(-1);
  if (last?.speaker !== "agent") return state;
  const earlier = state.turns.slice(0, -1);
  return { ...state, turns: heard ? [...earlier, { ...last, text: heard }] : earlier };
}

function withTurn(state: CallState, speaker: Speaker, text: string, at: string): CallState {
  return { ...state, turns: [...state.turns, { speaker, text, at }] };
}

function say(text: string, last = true): CallEffect {
  return { kind: "say", text, last };
}

function status(text: string): CallEffect {
  return { kind: "emit", event: { type: "status.update", payload: { text } } };
}

function unchanged(state: CallState): Transition {
  return { state, effects: [] };
}
