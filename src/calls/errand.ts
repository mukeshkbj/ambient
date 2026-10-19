import type { CallOutcome } from "./types.js";

type Quote = { requestId: string; amountUsd?: number; when?: string };

type ErrandCall = {
  callId: string;
  business: string;
  status: "open" | "quoted" | "approved" | "asking" | "released" | "ended";
  quote?: Quote;
  outcome?: CallOutcome;
};

export type ErrandState = {
  limitUsd?: number;
  calls: ErrandCall[];
  decided: boolean;
  deadline: boolean;
  finished: boolean;
  winner?: string;
};

export type ErrandInput =
  | { kind: "quoted"; callId: string; requestId: string; amountUsd?: number; when?: string }
  | { kind: "ended"; callId: string; outcome: CallOutcome }
  | { kind: "owner_decided"; decision: "once" | "deny" }
  | { kind: "deadline" };

export type ErrandEffect =
  | { kind: "approve"; callId: string; requestId: string }
  | { kind: "release"; callId: string; requestId: string }
  | { kind: "ask_owner"; callId: string; requestId: string; business: string; amountUsd?: number; when?: string }
  | { kind: "done"; booked?: string };

export function startErrand(options: { limitUsd?: number; calls: Array<{ callId: string; business: string }> }): ErrandState {
  return {
    ...(options.limitUsd !== undefined ? { limitUsd: options.limitUsd } : {}),
    calls: options.calls.map(call => ({ ...call, status: "open" })),
    decided: false,
    deadline: false,
    finished: false
  };
}

export function errandStep(state: ErrandState, input: ErrandInput, _now: string): { state: ErrandState; effects: ErrandEffect[] } {
  const effects: ErrandEffect[] = [];
  let calls = state.calls;
  const set = (callId: string, patch: Partial<ErrandCall>) => {
    calls = calls.map(call => call.callId === callId ? { ...call, ...patch } : call);
  };
  const release = (call: ErrandCall) => {
    if (!call.quote) return;
    set(call.callId, { status: "released" });
    effects.push({ kind: "release", callId: call.callId, requestId: call.quote.requestId });
  };
  let { decided, deadline, winner } = state;

  switch (input.kind) {
    case "quoted": {
      const call = calls.find(item => item.callId === input.callId);
      if (!call || call.status !== "open") break;
      const quote: Quote = { requestId: input.requestId, ...(input.amountUsd !== undefined ? { amountUsd: input.amountUsd } : {}), ...(input.when !== undefined ? { when: input.when } : {}) };
      set(call.callId, { status: "quoted", quote });
      if (decided) release({ ...call, quote });
      break;
    }
    case "ended":
      set(input.callId, { status: "ended", outcome: input.outcome });
      break;
    case "owner_decided": {
      const asking = calls.find(call => call.status === "asking");
      if (!asking?.quote) break;
      if (input.decision === "once") {
        set(asking.callId, { status: "approved" });
        winner = asking.callId;
        effects.push({ kind: "approve", callId: asking.callId, requestId: asking.quote.requestId });
      } else {
        release(asking);
      }
      break;
    }
    case "deadline":
      deadline = true;
      break;
  }

  if (!decided && (deadline || calls.every(call => call.status !== "open"))) {
    decided = true;
    const quoted = calls.filter(call => call.status === "quoted");
    const best = [...quoted].sort((a, b) => (a.quote?.amountUsd ?? Infinity) - (b.quote?.amountUsd ?? Infinity))[0];
    if (best?.quote) {
      const amount = best.quote.amountUsd;
      if (amount !== undefined && state.limitUsd !== undefined && amount <= state.limitUsd) {
        set(best.callId, { status: "approved" });
        winner = best.callId;
        effects.push({ kind: "approve", callId: best.callId, requestId: best.quote.requestId });
      } else {
        set(best.callId, { status: "asking" });
        effects.push({
          kind: "ask_owner",
          callId: best.callId,
          requestId: best.quote.requestId,
          business: best.business,
          ...(amount !== undefined ? { amountUsd: amount } : {}),
          ...(best.quote.when !== undefined ? { when: best.quote.when } : {})
        });
      }
      for (const other of quoted) if (other.callId !== best.callId) release(other);
    }
  }

  let finished = state.finished;
  if (!finished && calls.every(call => call.status === "ended")) {
    finished = true;
    const booked = calls.find(call => call.callId === winner && call.outcome?.kind === "confirmed");
    effects.push(booked ? { kind: "done", booked: booked.callId } : { kind: "done" });
  }

  return { state: { ...state, calls, decided, deadline, finished, ...(winner !== undefined ? { winner } : {}) }, effects };
}
