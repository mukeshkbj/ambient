import { dollarsInWords, priceInWords } from "../words.js";
import type { ScriptedTurn } from "./brain.js";
import type { BusinessPersona } from "./line.js";
import { amountsIn } from "./rules.js";
import type { Candidate } from "./discover.js";
import type { CallState } from "./session.js";
import { parsePhoneNumber } from "./types.js";

export const JOES_PLUMBING: BusinessPersona = {
  name: "Joe's Plumbing",
  opening: "Oh, okay. Joe's Plumbing, this is Joe. How can I help?",
  rules: [
    { when: /^okay, so just to confirm\b/i, reply: "Yes, plus parts." },
    { when: /^let me say it back\b/i, reply: "Yes, that's right. See you then." },
    { when: /\bwith parts\b/i, reply: "Fair enough. A sink like that needs no parts, so that's all in." },
    { when: /\bwhat would it cost\b/i, reply: "It'll be one eighty for the call-out and the repair." },
    { when: /\b(one (hundred )?sixty|160)\b/i, reply: "Hmm, one sixty. Alright, that works. I'll put you down for Tuesday the 20th at 10 am." },
    { when: /\bone (hundred )?fifty\b/i, reply: "One fifty is too low for me. I could do one sixty." },
    { when: /\bany room on the price\b/i, reply: "Best I can do is one eighty, honestly. Parts went up this year." },
    { when: /\b(go ahead|book it|that works)\b/i, reply: "Great, you're booked for Tuesday at ten. That's one eighty." },
    { when: /\b(sink|leak|visit|plumb)/i, reply: "Sure, we can come Tuesday the twentieth at ten." }
  ]
};

export const JOES_PLUMBING_HANGS_UP: BusinessPersona = {
  ...JOES_PLUMBING,
  rules: [{ when: /\b(sink|leak|visit|plumb)/i, reply: "It's one eighty, take it or leave it. I've got another call.", hangUp: true }]
};

const WHEN = "Tuesday the 20th at 10 am";

function quoting(name: string, phone: string, why: string, quote: string): { candidate: Candidate; persona: BusinessPersona } {
  return {
    candidate: { name, phone: parsePhoneNumber(phone), why },
    persona: {
      name,
      opening: `${name}, what do you need?`,
      rules: [
        { when: /\bwhat would the total be\?$/i, reply: `${quote}, all in.` },
        { when: /\bgo ahead and book\b/i, reply: "Done, that's booked." },
        { when: /\bis that right\?$/i, reply: "Yes, that's right." }
      ]
    }
  };
}

export const AROUND = [
  quoting("Pete's Pipes", "4155550199", "Rated for same-week visits.", "We can do Tuesday the 20th at 9 am for one forty"),
  quoting("Drain Bros", "4155550142", "Family-run, on your street.", "We can do Tuesday the 20th at 11 am for one twenty-five"),
  {
    candidate: { name: "Plomería Ruiz", phone: parsePhoneNumber("4155550177"), why: "Family-run, speaks Spanish.", language: "es" as const },
    persona: {
      name: "Plomería Ruiz",
      opening: "Plomería Ruiz, ¿en qué le puedo ayudar?",
      rules: [
        { when: /cuánto sería el total\?$/i, reply: "Podemos ir el martes 20 a las 9 de la mañana por ciento veinte, todo incluido." },
        { when: /\bpor favor reserve\b/i, reply: "Listo, queda reservado." },
        { when: /¿es correcto\?$/i, reply: "Sí, correcto." }
      ]
    }
  }
];

const SPANISH_QUOTE = { amountUsd: 120, when: "Tuesday the 20th at 9 am" };

const approvedTerms = (state: CallState) => {
  const note = state.turns.findLast(turn => turn.speaker === "owner" && turn.text.startsWith("Approved: "))?.text ?? "";
  const match = /^Approved: (.+?)(?: for (.+))?$/.exec(note);
  return { amountUsd: amountsIn(match?.[1] ?? "").at(-1), when: match?.[2] };
};

const spokenQuote = (state: CallState) => /podemos ir (.+?) por /i.exec(state.turns.findLast(turn => turn.speaker === "business" && /podemos ir/i.test(turn.text))?.text ?? "")?.[1];

const AROUND_SCRIPT: ScriptedTurn[] = [
  {
    when: /en qué le puedo ayudar\?$/i,
    reply: (_, state) => [{
      kind: "say",
      text: ["Hola. Necesito un plomero para arreglar una fuga en el fregadero de la cocina.", state.brief.facts[0] && `La dirección es ${state.brief.facts[0].replace(/^The address is /i, "")}.`, "¿Cuándo es lo más pronto que pueden venir, y cuánto sería el total?"].filter(Boolean).join(" "),
      last: true
    }]
  },
  {
    when: /\bpodemos ir (.+?) por ciento veinte, todo incluido\b/i,
    reply: (match, state) => [{
      kind: "end_call",
      outcome: { kind: "confirmed", summary: `${state.brief.business.name} can do ${SPANISH_QUOTE.when} for ${dollarsInWords(SPANISH_QUOTE.amountUsd)}.`, ...SPANISH_QUOTE, spokenWhen: match[1]! }
    }]
  },
  {
    when: /^listo, queda reservado\.$/i,
    reply: (_, state) => {
      const spoken = spokenQuote(state);
      return [{ kind: "end_call", outcome: { kind: "confirmed", summary: `${state.brief.business.name} confirmed ${SPANISH_QUOTE.when} for ${dollarsInWords(SPANISH_QUOTE.amountUsd)}.`, ...SPANISH_QUOTE, ...(spoken ? { spokenWhen: spoken } : {}) } }];
    }
  },
  {
    when: /\bwhat do you need\?$/i,
    reply: (_, state) => [{
      kind: "say",
      text: ["Hi. I'd like a plumber to fix a leaking kitchen sink.", state.brief.facts[0] && `${state.brief.facts[0]}.`, "What's your earliest time, and what would the total be?"].filter(Boolean).join(" "),
      last: true
    }]
  },
  {
    when: /\bwe can do (.+?) for (.+?), all in\b/i,
    reply: (match, state) => {
      const amount = amountsIn(match[2] ?? "")[0];
      const when = match[1]!;
      return [{
        kind: "end_call",
        outcome: { kind: "confirmed", summary: `${state.brief.business.name} can do ${when}${amount !== undefined ? ` for ${dollarsInWords(amount)}` : ""}.`, ...(amount !== undefined ? { amountUsd: amount } : {}), when }
      }];
    }
  },
  {
    when: /^done, that's booked\.$/i,
    reply: (_, state) => {
      const { amountUsd, when } = approvedTerms(state);
      return [{
        kind: "end_call",
        outcome: { kind: "confirmed", summary: `${state.brief.business.name} confirmed ${when ?? "the visit"}${amountUsd !== undefined ? ` for ${dollarsInWords(amountUsd)}` : ""}.`, ...(amountUsd !== undefined ? { amountUsd } : {}), ...(when ? { when } : {}) }
      }];
    }
  }
];

export const DEMO_SCRIPT: ScriptedTurn[] = [
  ...AROUND_SCRIPT,
  {
    when: /how can i help/i,
    reply: (_, state) => [{
      kind: "say",
      text: ["Hi Joe. I'd like to book a visit to fix a leaking kitchen sink.", state.brief.facts[0] && `${state.brief.facts[0]}.`, "When could you come?"].filter(Boolean).join(" "),
      last: true
    }]
  },
  {
    when: /\bplus parts\b/i,
    reply: () => [{ kind: "say", text: "Sorry, I need one total price. What is the total with parts?", last: true }]
  },
  {
    when: /\ball in\b/i,
    reply: (_, state) => {
      const readBack = state.turns.findLast(turn => turn.speaker === "agent" && /\bIs that right\?$/.test(turn.text))?.text ?? "";
      const amount = amountsIn(readBack.split(" total")[0] ?? "").at(-1);
      return [{
        kind: "end_call",
        outcome: { kind: "confirmed", summary: `Joe's Plumbing confirmed ${WHEN}${amount !== undefined ? ` for ${dollarsInWords(amount)}` : ""}.`, ...(amount !== undefined ? { amountUsd: amount } : {}), when: WHEN }
      }];
    }
  },
  {
    when: /\bwe can come tuesday the twentieth at ten\.$/i,
    reply: () => [{ kind: "say", text: "Tuesday the twentieth at ten works. What would it cost?", last: true }]
  },
  {
    when: /\b(booked|works)\b/i,
    reply: match => {
      const amounts = amountsIn(match.input ?? "");
      const amount = amounts.length > 0 ? Math.max(...amounts) : undefined;
      return [{
        kind: "end_call",
        outcome: {
          kind: "confirmed",
          summary: `Joe's Plumbing confirmed ${WHEN}${amount !== undefined ? ` for ${dollarsInWords(amount)}` : ""}.`,
          ...(amount !== undefined ? { amountUsd: amount } : {}),
          when: WHEN
        }
      }];
    }
  },
  {
    when: /\b(it'll be|it's) one eighty\b/i,
    reply: (_, state) => (state.brief.maxUsd ?? 0) >= 180
      ? [{ kind: "say", text: "That works. Please go ahead and book Tuesday at ten.", last: true }]
      : [{ kind: "say", text: "Hmm, okay. Is there any room on the price?", last: true }]
  },
  {
    when: /\bbest i can do is one eighty\b/i,
    reply: (_, state) => [{
      kind: "ask_owner",
      question: `Joe's Plumbing can come ${WHEN} for one hundred eighty dollars, over your limit of ${dollarsInWords(state.brief.maxUsd ?? 0)}. Should I book it?`,
      amountUsd: 180,
      when: WHEN
    }]
  },
  {
    when: /approved:/i,
    reply: (match, state) => {
      if (state.brief.compare && state.brief.language === "es") return [{ kind: "say", text: `Perfecto, por favor reserve ${spokenQuote(state) ?? "esa hora"}.`, last: true }];
      if (state.brief.compare) return [{ kind: "say", text: `Great, please go ahead and book ${approvedTerms(state).when ?? "that"}.`, last: true }];
      const amount = Math.max(...amountsIn(match.input ?? ""));
      return [{ kind: "say", text: `Okay, ${state.brief.ownerName} says ${priceInWords(amount)} is fine. Please go ahead and book Tuesday at ten.`, last: true }];
    }
  },
  {
    when: /\bi could do one sixty\b/i,
    reply: (_, state) => [{
      kind: "ask_owner",
      question: `Joe's Plumbing came down to one hundred sixty dollars for ${WHEN}, still over your limit of ${dollarsInWords(state.brief.maxUsd ?? 0)}. Should I book it?`,
      amountUsd: 160,
      when: WHEN
    }]
  },
  {
    when: /declined:/i,
    reply: () => [{ kind: "end_call", outcome: { kind: "no_deal", reason: "Maya declined the one hundred eighty dollar quote." } }]
  },
  {
    when: /.+/,
    reply: match => {
      const amount = amountsIn(match.input ?? "")[0];
      if (amount === undefined) return [{ kind: "say", text: "Sorry about the wait, thanks for holding.", last: true }];
      return [{ kind: "say", text: `Okay, thanks for waiting. Could you do ${priceInWords(amount)}?`, last: true }];
    }
  }
];
