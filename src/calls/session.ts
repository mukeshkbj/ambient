import { dollarsInWords, numberInWords } from "../words.js";
import { agreesInSpanish, lines, plainSpanishTime, sameSpanishTime, spanishPrice } from "./language.js";
import { agreesTo, chargedIn, HOLD_LINE_MS, holdTrailingDigits, offerIn, OPTED_OUT, optsOut, OWNER_PATIENCE_MS, plainTime, redactDigits, sameTime } from "./rules.js";
import type { BrainStep, CallBrief, CallEffect, CallInput, CallOutcome, CallPhase, CallTurn, Recording, Speaker } from "./types.js";

export type CallState = {
  callId: string;
  brief: CallBrief;
  phase: CallPhase;
  turns: CallTurn[];
  turn: number;
  asks: number;
  approved: Grant[];
  deniedUsd: number[];
  disclosed: boolean;
  disclosurePlayed: boolean;
  readBack: ReadBack | undefined;
  readBacks: number;
  readBacksSpoken: number;
  deniedUnpriced: boolean;
  draft: string;
  held: string;
  recording: Recording | undefined;
};

type Confirmed = Extract<CallOutcome, { kind: "confirmed" }>;
type Grant = { amountUsd?: number; when?: string };
type ReadBack = { outcome: Confirmed; line: string; terms: string; armed: boolean; earlyYes: boolean };


export type Transition = { state: CallState; effects: CallEffect[] };

const DIAL_FAILURES = { no_answer: "nobody picked up", busy: "the line was busy", failed: "the call didn't connect", hangup: "the line ended before they answered" } as const;
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
      approved: brief.approvedUsd !== undefined ? [{ amountUsd: brief.approvedUsd }] : [],
      deniedUsd: [],
      disclosed: false,
      disclosurePlayed: false,
      readBack: undefined,
      readBacks: 0,
      readBacksSpoken: 0,
      deniedUnpriced: false,
      draft: "",
      held: "",
      recording: undefined
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
        state: { ...withTurn(state, "agent", lines(brief.language).disclosure(brief.ownerName), now), phase: { kind: "talking" }, disclosed: true, recording: input.recording },
        effects: [status(`Connected to ${brief.business.name}`)]
      };
    case "heard": {
      if (phase.kind === "dialing") {
        const live = transition(state, { kind: "answered" }, now);
        const next = transition(live.state, input, now);
        return { state: next.state, effects: [...live.effects, ...next.effects] };
      }
      const heard = withTurn(flushDraft(state, now), "business", input.text, now);
      if (optsOut(input.text)) {
        const line = lines(brief.language).optOut;
        return end(withTurn(heard, "agent", line, now), { kind: "declined", reason: "they asked not to be called by an AI" }, [{ kind: "remember", fact: OPTED_OUT }, say(line), { kind: "hang_up" }]);
      }
      if (phase.kind === "waiting_for_owner") {
        if (phase.lastHoldLine !== phase.since && !(Date.parse(now) - Date.parse(phase.lastHoldLine) >= HOLD_LINE_MS)) return { state: heard, effects: [] };
        const line = holdLine(state);
        return { state: { ...withTurn(heard, "agent", line, now), phase: { ...phase, lastHoldLine: now }, disclosed: true }, effects: [say(line)] };
      }
      if (!state.disclosed) return think(heard, now);
      if (state.readBack && !state.readBack.armed) {
        if (agrees(state, state.readBack, input.text)) return { state: { ...heard, readBack: { ...state.readBack, earlyYes: true } }, effects: [] };
        return think({ ...heard, readBack: undefined, readBacks: state.readBacks - 1 }, now);
      }
      if (state.readBack) {
        const answered = answerReadBack(heard, state.readBack, input.text, now);
        if (answered) return answered;
      }
      return think({ ...heard, readBack: undefined }, now);
    }
    case "interrupted": {
      if (phase.kind === "dialing") return unchanged(state);
      const last = state.turns.findLast(turn => turn.speaker === "agent");
      const said = state.draft || state.held ? state.draft + state.held : last?.text ?? "";
      const heardText = sharedWords(said, input.spokenSoFar);
      const cutDisclosure = !state.disclosurePlayed && !input.spokenSoFar.includes(lines(brief.language).disclosure(brief.ownerName));
      const unheard = state.readBack && !state.readBack.armed ? { readBack: undefined, readBacks: state.readBacks - 1 } : { readBack: undefined };
      return { state: { ...truncateAgent(state, heardText, now), ...unheard, turn: state.turn + 1, ...(cutDisclosure ? { disclosed: false } : {}) }, effects: [] };
    }
    case "played": {
      if (!state.disclosurePlayed && state.disclosed && input.text.includes(lines(brief.language).disclosure(brief.ownerName))) return transition({ ...state, disclosurePlayed: true }, input, now);
      const readBack = state.readBack;
      if (!readBack || readBack.armed || !endsWithLine(input.text, readBack.line)) return unchanged(state);
      if (readBack.earlyYes) {
        const line = lines(brief.language).talkedOver(readBack.terms);
        const asked = { ...withTurn(state, "agent", line, now), readBack: { ...readBack, line, earlyYes: false } };
        return { state: asked, effects: [say(line)] };
      }
      return { state: { ...state, readBack: { ...readBack, armed: true } }, effects: [] };
    }
    case "line_ended": {
      const reason = phase.kind === "dialing" ? DIAL_FAILURES[input.reason] : DROPPED;
      return end(flushDraft(state, now), { kind: "unconfirmed", reason }, []);
    }
    case "brain":
      if (phase.kind !== "talking" || input.turn !== state.turn) return unchanged(state);
      if (!state.disclosed) {
        const line = lines(brief.language).disclosure(brief.ownerName);
        const next = brainStep({ ...withTurn(flushDraft(state, now), "agent", line, now), disclosed: true }, input.step, now);
        return { state: next.state, effects: [say(line), ...next.effects] };
      }
      return brainStep(state, input.step, now);
    case "owner_said": {
      const offer = offerIn(input.text);
      const asked = phase.kind === "waiting_for_owner" && phase.when ? { when: phase.when } : {};
      const ledger = offer !== undefined ? { approved: [...state.approved, { amountUsd: offer, ...asked }], deniedUsd: state.deniedUsd.filter(amount => amount !== offer) } : {};
      const noted = { ...ownerNote(flushDraft(state, now), input.text, now, ledger), readBack: undefined };
      if (phase.kind === "dialing") return { state: noted, effects: [] };
      return think({ ...noted, phase: { kind: "talking" } }, now);
    }
    case "owner_decided": {
      if (phase.kind !== "waiting_for_owner" || phase.requestId !== input.requestId) return unchanged(state);
      const approved = input.decision === "once";
      const terms = `${phase.amountUsd !== undefined ? price(phase.amountUsd) : "a booking with no price"}${phase.when ? ` for ${phase.when}` : ""}`;
      const note = `${approved ? "Approved" : "Declined"}: ${terms}`;
      const amount = phase.amountUsd;
      const grant: Grant = { ...(amount !== undefined ? { amountUsd: amount } : {}), ...(phase.when ? { when: phase.when } : {}) };
      const ledger = amount === undefined
        ? (phase.unpriced ? (approved ? { approved: [...state.approved, grant] } : { deniedUnpriced: true }) : {})
        : approved ? { approved: [...state.approved, grant] } : { deniedUsd: [...state.deniedUsd, amount] };
      return think({ ...ownerNote(state, note, now, ledger), phase: { kind: "talking" } }, now);
    }
    case "chosen": {
      if (phase.kind !== "waiting_for_owner" || phase.requestId !== input.requestId) return unchanged(state);
      if (phase.amountUsd === undefined || phase.amountUsd > (brief.maxUsd ?? 0)) return unchanged(state);
      const grant: Grant = { amountUsd: phase.amountUsd, ...(phase.when ? { when: phase.when } : {}) };
      return think({ ...state, approved: [...state.approved, grant], phase: { kind: "talking" } }, now);
    }
    case "released": {
      if (phase.kind !== "waiting_for_owner" || phase.requestId !== input.requestId) return unchanged(state);
      const line = lines(brief.language).released(brief.ownerName);
      return end(withTurn(state, "agent", line, now), { kind: "no_deal", reason: `${brief.ownerName} went with another quote` }, [say(line), { kind: "hang_up" }]);
    }
    case "hold_tick": {
      if (phase.kind !== "waiting_for_owner") return unchanged(state);
      const elapsed = (from: string) => Date.parse(now) - Date.parse(from);
      if (elapsed(phase.since) >= OWNER_PATIENCE_MS) {
        const line = lines(brief.language).unreachable(brief.ownerName, state.disclosed);
        const closed = withTurn(state, "agent", line, now);
        return end(closed, { kind: "unconfirmed", reason: "you didn't answer in time" }, [say(line), { kind: "hang_up" }]);
      }
      if (!(elapsed(phase.lastHoldLine) >= HOLD_LINE_MS)) return unchanged(state);
      const line = holdLine(state);
      return { state: { ...withTurn(state, "agent", line, now), phase: { ...phase, lastHoldLine: now }, disclosed: true }, effects: [say(line)] };
    }
  }
}

function brainStep(state: CallState, brain: BrainStep, now: string): Transition {
  switch (brain.kind) {
    case "say": {
      const { ready: raw, held } = brain.last ? { ready: state.held + brain.text, held: "" } : holdTrailingDigits(state.held + brain.text);
      const ready = redactDigits(raw);
      const drafted = { ...state, draft: state.draft + ready, held, readBack: undefined };
      const effects: CallEffect[] = ready || brain.last ? [say(ready, brain.last)] : [];
      return { state: brain.last ? flushDraft(drafted, now) : drafted, effects };
    }
    case "ask_owner":
      return askOwner({ ...state, readBack: undefined }, brain.question, brain.amountUsd, now, false, brain.when);
    case "remember":
      return { state, effects: [{ kind: "remember", fact: brain.fact }] };
    case "end_call":
      return brain.outcome.kind === "confirmed" ? confirm(state, brain.outcome, now) : close(state, brain.outcome, now);
  }
}

function confirm(state: CallState, proposed: Confirmed, now: string): Transition {
  const outcome = proposed.when ? { ...proposed, when: proposed.when.replace(/\b([ap])\.m\b\.?/gi, "$1m").replace(/\.+$/, "") } : proposed;
  const { brief } = state;
  const owner = brief.ownerName;
  const speech = lines(brief.language);
  const spokenWhen = brief.language === "es" ? outcome.spokenWhen : outcome.when;
  const plainWhen = outcome.when === undefined || (plainTime(outcome.when) && (brief.language !== "es" || (spokenWhen !== undefined && plainSpanishTime(spokenWhen) && sameSpanishTime(spokenWhen, outcome.when))));
  if (!plainWhen) {
    const asks: string[] = speech.askTime;
    const flushed = flushDraft(state, now);
    const asked = flushed.turns.filter(turn => turn.speaker === "agent" && asks.includes(turn.text)).length;
    const ask = asks[Math.min(asked, asks.length - 1)]!;
    if (asked >= 2) {
      const line = speech.letKnow(owner);
      return end(withTurn(flushed, "agent", line, now), { kind: "unconfirmed", reason: "they never gave a clear day and time" }, [say(line), { kind: "hang_up" }]);
    }
    return { state: { ...withTurn(flushed, "agent", ask, now), readBack: undefined }, effects: [say(ask)] };
  }
  const claimed = [...(outcome.amountUsd !== undefined ? [outcome.amountUsd] : []), ...chargedIn(outcome.summary)].filter(amount => Number.isFinite(amount) && amount > 0);
  const charge = claimed.length > 0 ? Math.round(Math.max(...claimed) * 100) / 100 : undefined;
  const limit = brief.maxUsd ?? 0;
  if (charge !== undefined && state.deniedUsd.includes(charge)) {
    return close(state, { kind: "no_deal", reason: `${owner} declined ${dollarsInWords(charge)}` }, now,
      speech.passPrice(owner));
  }
  if (charge !== undefined && (charge > limit || brief.compare) && !granted(state, charge, outcome.when)) {
    const question = charge <= limit
      ? `${brief.business.name} can do ${outcome.when ?? "it"} for ${price(charge)}.`
      : `${brief.business.name} wants ${price(charge)}, over your limit of ${price(limit)}. Should I agree?`;
    return askOwner(state, question, charge, now, false, outcome.when);
  }
  if (charge === undefined && state.deniedUnpriced) {
    return close(state, { kind: "no_deal", reason: `${owner} declined a deal with no price` }, now,
      speech.passUnpriced(owner));
  }
  if (charge === undefined && !granted(state, undefined, outcome.when)) {
    const when = outcome.when ? ` for ${outcome.when}` : "";
    return askOwner(state, `${brief.business.name} confirmed${when} but gave no price. Should I agree without a price?`, undefined, now, true, outcome.when);
  }
  const flushed = flushDraft(state, now);
  if (state.readBacks >= 3 || state.readBacksSpoken >= 5) {
    const line = speech.letKnow(owner);
    return end(withTurn(flushed, "agent", line, now), { kind: "unconfirmed", reason: "they never clearly confirmed it" }, [say(line), { kind: "hang_up" }]);
  }
  const terms = speech.terms(charge === undefined ? undefined : brief.language === "es" ? spanishPrice(charge) : price(charge), spokenWhen ?? "");
  const line = `${speech.openers[state.readBacksSpoken % speech.openers.length]} ${terms}. ${speech.question}`;
  const agreed = [outcome.when, charge !== undefined ? `for ${price(charge)}` : outcome.when ? "with no price set" : "with no price or time set"].filter(Boolean).join(" ");
  const summary = `${brief.business.name} confirmed ${agreed}.`;
  const settled = { ...outcome, summary, ...(charge !== undefined ? { amountUsd: charge } : {}) };
  return { state: { ...withTurn(flushed, "agent", line, now), readBack: { outcome: settled, line, terms, armed: false, earlyYes: false }, readBacks: state.readBacks + 1, readBacksSpoken: state.readBacksSpoken + 1 }, effects: [say(line)] };
}

function granted(state: CallState, amountUsd: number | undefined, when: string | undefined): boolean {
  return state.approved.some(grant => grant.amountUsd === amountUsd && (grant.when === undefined || (when !== undefined && sameTime(grant.when, when))));
}

function answerReadBack(state: CallState, readBack: ReadBack, reply: string, now: string): Transition | undefined {
  const lastAgent = state.turns.findLast(turn => turn.speaker === "agent");
  if (lastAgent?.text !== readBack.line) return undefined;
  if (!agrees(state, readBack, reply)) return undefined;
  const full = state.turns.findLast(turn => turn.speaker === "agent" && turn.text.endsWith(`${readBack.terms}. ${lines(state.brief.language).question}`)) ?? lastAgent;
  const english = lines("en");
  const translation = state.brief.language === "es"
    ? { language: "es" as const, inEnglish: `${english.openers[0]} ${english.terms(readBack.outcome.amountUsd === undefined ? undefined : price(readBack.outcome.amountUsd), readBack.outcome.when ?? "")}. ${english.question}` }
    : {};
  const proof = { readBack: full.text, readBackAt: full.at, yes: reply, yesAt: now, ...translation, ...(state.recording ? { recording: state.recording } : {}) };
  return close({ ...state, readBack: undefined }, { ...readBack.outcome, proof }, now);
}

function agrees(state: CallState, readBack: ReadBack, reply: string): boolean {
  return state.brief.language === "es" ? agreesInSpanish(reply) : agreesTo(reply, readBack.terms, readBack.outcome.amountUsd, readBack.outcome.when, readBack.line);
}

function price(amount: number): string {
  const cents = Math.round((amount % 1) * 100);
  return cents === 0 ? dollarsInWords(amount) : `${dollarsInWords(Math.floor(amount))} and ${numberInWords(cents)} ${cents === 1 ? "cent" : "cents"}`;
}

function close(state: CallState, outcome: Exclude<CallOutcome, { kind: "unconfirmed" }>, now: string, line?: string): Transition {
  const speech = lines(state.brief.language);
  const closing = line ?? (outcome.kind === "confirmed" ? speech.booked(state.brief.language === "es" ? outcome.spokenWhen : outcome.when) : speech.noDeal);
  return end(withTurn(flushDraft(state, now), "agent", closing, now), outcome, [say(closing), { kind: "hang_up" }]);
}

function askOwner(state: CallState, question: string, amountUsd: number | undefined, now: string, unpriced = false, when?: string): Transition {
  const asks = state.asks + 1;
  const requestId = `${state.callId}:ask-${asks}`;
  const line = lines(state.brief.language).checking(state.brief.ownerName, asks > 1);
  const amount = amountUsd !== undefined ? { amountUsd } : {};
  const limit = state.brief.maxUsd !== undefined ? { limitUsd: state.brief.maxUsd } : {};
  const waiting = { ...withTurn(flushDraft(state, now), "agent", line, now), readBack: undefined };
  return {
    state: { ...waiting, asks, phase: { kind: "waiting_for_owner", requestId, question, ...amount, ...(unpriced ? { unpriced: true as const } : {}), ...(when ? { when } : {}), since: now, lastHoldLine: now } },
    effects: [
      say(line),
      {
        kind: "emit",
        event: {
          type: "approval.request",
          payload: { requestId, command: question, description: question, choices: ["once", "deny"], kind: amountUsd !== undefined ? "spend" : "other", ...amount, ...limit, ...(when ? { when } : {}) }
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

function holdLine(state: CallState): string {
  const owner = state.brief.ownerName;
  const speech = lines(state.brief.language);
  if (!state.disclosed) return speech.disclosure(owner);
  const holding = speech.holding(owner);
  return holding[state.turns.filter(turn => turn.speaker === "agent" && holding.includes(turn.text)).length % holding.length]!;
}

function think(state: CallState, now: string): Transition {
  const turn = state.turn + 1;
  const thinking = { ...state, turn, draft: "", held: "" };
  if (state.disclosed) return { state: thinking, effects: [{ kind: "think", turn }] };
  const line = lines(state.brief.language).disclosure(state.brief.ownerName);
  return { state: { ...withTurn(thinking, "agent", line, now), disclosed: true }, effects: [say(line), { kind: "think", turn }] };
}

function ownerNote(state: CallState, note: string, now: string, ledger: Partial<Pick<CallState, "approved" | "deniedUsd" | "deniedUnpriced">>): CallState {
  return { ...withTurn(state, "owner", note, now), ...ledger };
}

function flushDraft(state: CallState, now: string): CallState {
  const text = state.draft.trim();
  const flushed = { ...state, draft: "", held: "" };
  return text ? withTurn(flushed, "agent", text, now) : flushed;
}

function endsWithLine(played: string, line: string): boolean {
  const lineWords = line.trim().split(/\s+/).length;
  const tail = played.trim().split(/\s+/).slice(-lineWords).join(" ");
  return sharedWords(line, tail) === line.trim();
}

function sharedWords(said: string, reported: string): string {
  const words = said.trim().split(/\s+/).filter(Boolean);
  const plain = (word: string) => word.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
  const heard = reported.trim().split(/\s+/).filter(Boolean).map(plain);
  const count = words.findIndex((word, at) => at >= heard.length || plain(word) !== heard[at]);
  return words.slice(0, count < 0 ? words.length : count).join(" ");
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
