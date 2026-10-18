import type { LineInput, PhoneNumber } from "./types.js";

export type Line = {
  readonly joinUrl?: string | undefined;
  dial(to: PhoneNumber, callId: string, ownerName: string): Promise<void>;
  say(text: string, last: boolean): void;
  hangUp(): void;
  onInput(listener: (input: LineInput) => void): () => void;
};

export type BusinessPersona = {
  name: string;
  opening: string;
  rules: Array<{ when: RegExp; reply?: string; hangUp?: boolean }>;
};

export function simulatedLine(persona: BusinessPersona, options: { speedMs?: number } = {}): Line {
  const speedMs = options.speedMs ?? 500;
  const listeners = new Set<(input: LineInput) => void>();
  const timers = new Set<NodeJS.Timeout>();
  let utterance = "";
  let live = false;
  const send = (input: LineInput) => {
    for (const listener of listeners) listener(input);
  };
  const later = (fn: () => void, delay = speedMs) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (live) fn();
    }, delay);
    timers.add(timer);
  };
  const end = () => {
    if (!live) return;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    send({ kind: "line_ended", reason: "hangup" });
    live = false;
  };
  const respond = (said: string) => {
    if (/\bgoodbye\b/i.test(said)) return later(end);
    const rule = persona.rules.find(item => item.when.test(said));
    const reply = rule?.reply;
    if (reply) later(() => send({ kind: "heard", text: reply }));
    if (rule?.hangUp) later(end, speedMs * 2);
  };
  return {
    dial() {
      live = true;
      later(() => {
        send({ kind: "answered" });
        later(() => send({ kind: "heard", text: persona.opening }));
      });
      return Promise.resolve();
    },
    say(text, last) {
      if (!live) return;
      utterance += text;
      if (!last) return;
      const said = utterance;
      utterance = "";
      later(() => send({ kind: "played", text: said }), 0);
      respond(said);
    },
    hangUp: end,
    onInput(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
