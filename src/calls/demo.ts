import { dollarsInWords, priceInWords } from "../words.js";
import type { ScriptedTurn } from "./brain.js";
import type { BusinessPersona } from "./line.js";
import { amountsIn } from "./rules.js";

export const JOES_PLUMBING: BusinessPersona = {
  name: "Joe's Plumbing",
  opening: "Oh, okay. Joe's Plumbing, this is Joe. How can I help?",
  rules: [
    { when: /^just to confirm\b/i, reply: "Yes, plus parts." },
    { when: /^let me check once more\b/i, reply: "Yes, that's right. See you then." },
    { when: /\bwith parts\b/i, reply: "Fair enough. A sink like that needs no parts, so that's all in." },
    { when: /\bwhat would it cost\b/i, reply: "It'll be one eighty for the call-out and the repair." },
    { when: /\b(one (hundred )?sixty|160)\b/i, reply: "Hmm, one sixty. Alright, that works if you're my first job that morning. I'll put you down for Tuesday at ten." },
    { when: /\bone (hundred )?fifty\b/i, reply: "One fifty is too low for me. I could do one sixty." },
    { when: /\bany room on the price\b/i, reply: "Best I can do is one eighty, honestly. Parts went up this year." },
    { when: /\b(go ahead|book it|that works)\b/i, reply: "Great, you're booked for Tuesday at ten. That's one eighty." },
    { when: /\b(sink|leak|visit|plumb)/i, reply: "Sure, we can come Tuesday at ten." }
  ]
};

export const JOES_PLUMBING_HANGS_UP: BusinessPersona = {
  ...JOES_PLUMBING,
  rules: [{ when: /\b(sink|leak|visit|plumb)/i, reply: "It's one eighty, take it or leave it. I've got another call.", hangUp: true }]
};

export const DEMO_SCRIPT: ScriptedTurn[] = [
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
      const readBack = state.turns.findLast(turn => turn.speaker === "agent" && /^Just to confirm:/.test(turn.text))?.text ?? "";
      const amount = amountsIn(readBack.split(" total")[0] ?? "").at(-1);
      return [{
        kind: "end_call",
        outcome: { kind: "confirmed", summary: `Joe's Plumbing confirmed Tuesday at ten${amount !== undefined ? ` for ${dollarsInWords(amount)}` : ""}.`, ...(amount !== undefined ? { amountUsd: amount } : {}), when: "Tuesday at ten" }
      }];
    }
  },
  {
    when: /\bwe can come tuesday at ten\.$/i,
    reply: () => [{ kind: "say", text: "Tuesday at ten works. What would it cost?", last: true }]
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
          summary: `Joe's Plumbing confirmed Tuesday at ten${amount !== undefined ? ` for ${dollarsInWords(amount)}` : ""}.`,
          ...(amount !== undefined ? { amountUsd: amount } : {}),
          when: "Tuesday at ten"
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
      question: `Joe's Plumbing can come Tuesday at ten for one hundred eighty dollars, over your limit of ${dollarsInWords(state.brief.maxUsd ?? 0)}. Should I book it?`,
      amountUsd: 180,
      when: "Tuesday at ten"
    }]
  },
  {
    when: /approved:/i,
    reply: (match, state) => {
      const amount = Math.max(...amountsIn(match.input ?? ""));
      return [{ kind: "say", text: `Thanks for waiting. ${state.brief.ownerName} says ${priceInWords(amount)} is fine. Please go ahead and book Tuesday at ten.`, last: true }];
    }
  },
  {
    when: /\bi could do one sixty\b/i,
    reply: (_, state) => [{
      kind: "ask_owner",
      question: `Joe's Plumbing came down to one hundred sixty dollars for Tuesday at ten, still over your limit of ${dollarsInWords(state.brief.maxUsd ?? 0)}. Should I book it?`,
      amountUsd: 160,
      when: "Tuesday at ten"
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
      return [{ kind: "say", text: `Thanks for waiting. Could you do ${priceInWords(amount)}?`, last: true }];
    }
  }
];
