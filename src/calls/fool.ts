import { spanishVerdict, type Language } from "./language.js";
import { readBackVerdict } from "./rules.js";
import { startCall, step, type CallState } from "./session.js";
import { parsePhoneNumber, type CallBrief, type CallInput } from "./types.js";

export type Attempt = { readBack: string; reply: string; result: "booked" | "not_booked" | "opted_out"; why: string };

const DEALS = {
  en: { business: "Joe's Plumbing", quote: "We can do one sixty, Tuesday the 20th at 10 am.", amountUsd: 160, when: "Tuesday the 20th at 10 am" },
  es: { business: "Plomería Ruiz", quote: "Le cobro ciento veinte dólares, el martes 20 a las 9 de la mañana.", amountUsd: 120, when: "Tuesday the 20th at 9 am", spokenWhen: "el martes 20 a las 9 de la mañana" }
} as const;

export function tryToFool(reply: string, language: Language = "en"): Attempt {
  const deal = DEALS[language];
  const brief: CallBrief = {
    goal: "Fix the kitchen sink",
    business: { name: deal.business, phone: parsePhoneNumber("4155550134") },
    ownerName: "Maya",
    maxUsd: 200,
    facts: [],
    ...(language === "es" ? { language } : {})
  };
  const at = (second: number) => new Date(Date.UTC(2026, 9, 20, 17, 0, second)).toISOString();
  let state: CallState = startCall(brief, "try").state;
  const run = (input: CallInput, second: number) => {
    state = step(state, input, at(second)).state;
  };
  run({ kind: "answered" }, 0);
  run({ kind: "heard", text: deal.quote }, 1);
  const { business: _business, quote: _quote, ...terms } = deal;
  run({ kind: "brain", turn: state.turn, step: { kind: "end_call", outcome: { kind: "confirmed", summary: "", ...terms } } }, 2);
  const readBack = state.readBack;
  if (!readBack) throw new Error("The demo deal did not produce a read-back");
  run({ kind: "played", text: readBack.line }, 3);
  run({ kind: "heard", text: reply }, 4);
  const outcome = state.phase.kind === "ended" ? state.phase.outcome : undefined;
  if (outcome?.kind === "confirmed") return { readBack: readBack.line, reply, result: "booked", why: "It is a clean yes to the exact terms that were read back." };
  if (outcome?.kind === "declined") return { readBack: readBack.line, reply, result: "opted_out", why: "The business asked not to be called. Ambient ends the call and never calls this number again." };
  const verdict = language === "es" ? spanishVerdict(reply) : readBackVerdict(reply, readBack.terms, deal.amountUsd, deal.when, readBack.line);
  return { readBack: readBack.line, reply, result: "not_booked", why: verdict.books ? "Ambient does not book it." : verdict.why };
}
