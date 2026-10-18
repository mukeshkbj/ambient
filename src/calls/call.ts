import type { AssistantEvent } from "../runtimes/types.js";
import type { Brain } from "./brain.js";
import type { Line } from "./line.js";
import { startCall, step, type CallState } from "./session.js";
import type { CallBrief, CallEffect, CallInput } from "./types.js";

export type CallHandle = {
  ownerSaid(text: string): void;
  ownerDecided(requestId: string, decision: "once" | "deny"): boolean;
  hangUp(): void;
  state(): CallState;
  done: Promise<CallState>;
};

export type RunCallOptions = {
  brief: CallBrief;
  callId: string;
  line: Line;
  brain: Brain;
  emit(event: AssistantEvent): void;
  remember?: (fact: string) => void;
  now?: () => string;
  tickMs?: number;
  log?: (message: string) => void;
};

export function runCall(options: RunCallOptions): CallHandle {
  const now = options.now ?? (() => new Date().toISOString());
  const log = options.log ?? ((message: string) => console.error(`[call ${options.callId}] ${message}`));
  let state = startCall(options.brief, options.callId).state;
  let thinking: AbortController | undefined;
  let finish: (state: CallState) => void = () => {};
  const done = new Promise<CallState>(resolve => {
    finish = resolve;
  });
  const queue: CallInput[] = [];
  let draining = false;

  const tick = setInterval(() => {
    if (state.phase.kind === "waiting_for_owner") dispatch({ kind: "hold_tick" });
  }, options.tickMs ?? 1000);
  tick.unref();

  const think = (turn: number) => {
    thinking?.abort();
    const controller = new AbortController();
    thinking = controller;
    const snapshot = state;
    void (async () => {
      try {
        for await (const brainStep of options.brain.respond(snapshot, controller.signal)) {
          if (controller.signal.aborted) return;
          dispatch({ kind: "brain", turn, step: brainStep });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        log(`brain failed: ${error instanceof Error ? error.message : String(error)}`);
        dispatch({
          kind: "brain",
          turn,
          step: { kind: "end_call", outcome: { kind: "no_deal", reason: "The assistant hit an error and ended the call before anything was agreed." } }
        });
      }
    })();
  };

  const perform = (effect: CallEffect) => {
    switch (effect.kind) {
      case "say":
        options.line.say(effect.text, effect.last);
        break;
      case "think":
        think(effect.turn);
        break;
      case "remember":
        options.remember?.(effect.fact);
        break;
      case "hang_up":
        options.line.hangUp();
        break;
      case "emit":
        options.emit(effect.event);
        break;
    }
  };

  function dispatch(input: CallInput): void {
    queue.push(input);
    if (draining) return;
    draining = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        if (next.kind === "interrupted") thinking?.abort();
        const result = step(state, next, now());
        state = result.state;
        for (const effect of result.effects) perform(effect);
      }
    } finally {
      draining = false;
    }
    if (state.phase.kind === "ended") {
      clearInterval(tick);
      thinking?.abort();
      unsubscribe();
      finish(state);
    }
  }

  const unsubscribe = options.line.onInput(dispatch);
  options.line.dial(options.brief.business.phone, options.callId, options.brief.ownerName).catch((error: unknown) => {
    log(`dial failed: ${error instanceof Error ? error.message : String(error)}`);
    dispatch({ kind: "line_ended", reason: "failed" });
  });

  return {
    ownerSaid: text => dispatch({ kind: "owner_said", text }),
    ownerDecided(requestId, decision) {
      const waiting = state.phase.kind === "waiting_for_owner" && state.phase.requestId === requestId;
      dispatch({ kind: "owner_decided", requestId, decision });
      return waiting;
    },
    hangUp() {
      options.line.hangUp();
      if (state.phase.kind !== "ended") dispatch({ kind: "line_ended", reason: "hangup" });
    },
    state: () => state,
    done
  };
}
