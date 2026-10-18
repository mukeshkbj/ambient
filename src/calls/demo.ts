import { dollarsInWords } from "../words.js";
import type { ScriptedTurn } from "./brain.js";
import type { BusinessPersona } from "./line.js";
import { amountsIn } from "./rules.js";

export const JOES_PLUMBING: BusinessPersona = {
  name: "Joe's Plumbing",
  opening: "Oh, okay. Joe's Plumbing, this is Joe. How can I help?",
  rules: [
    { when: /\b(one (hundred )?sixty|160)\b/i, reply: "Alright, one sixty works. I'll put you down for Tuesday at ten." },
    { when: /\b(go ahead|book it|that works)\b/i, reply: "Great, you're booked for Tuesday at ten. That's one eighty." },
    { when: /\b(sink|leak|visit|plumb)/i, reply: "Sure, we can come Tuesday at ten. It'll be one eighty for the call-out and the repair." }
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
      text: ["Hi Joe. I'd like to book a visit to fix a leaking kitchen sink.", state.brief.facts[0] && `${state.brief.facts[0]}.`, "When could you come, and what would it cost?"].filter(Boolean).join(" "),
      last: true
    }]
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
      : [{
          kind: "ask_owner",
          question: `Joe's Plumbing can come Tuesday at ten for one hundred eighty dollars, over your ${dollarsInWords(state.brief.maxUsd ?? 0)} limit. Should I book it?`,
          amountUsd: 180
        }]
  },
  {
    when: /approved:/i,
    reply: () => [{ kind: "say", text: "Thanks for waiting. That works, please go ahead and book Tuesday at ten.", last: true }]
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
      return [{ kind: "say", text: `Thanks for waiting. Could you do it for ${dollarsInWords(amount)}?`, last: true }];
    }
  }
];
