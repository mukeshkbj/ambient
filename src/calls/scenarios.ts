import { dollarsInWords } from "../words.js";
import { scriptedBrain, type Brain, type ScriptedTurn } from "./brain.js";
import { DEMO_SCRIPT, JOES_PLUMBING } from "./demo.js";
import { simulatedLine, type BusinessPersona, type Line } from "./line.js";
import { parsePhoneNumber, type CallBrief, type CallOutcome, type LineInput } from "./types.js";

export type Scenario = {
  title: string;
  story: string;
  brief: CallBrief;
  line(): Line;
  brain: Brain;
  owner?: "once" | "deny";
  expect: { kind: CallOutcome["kind"]; transcript: RegExp[] };
};

const THURSDAY = "Thursday the twenty-second at 3 pm";

const VET: BusinessPersona = {
  name: "Happy Paws Veterinary",
  opening: "Happy Paws Veterinary, how can I help?",
  rules: [
    { when: /\bis that right\?$/i, reply: "Yes, that's right." },
    { when: /\b(appointment|checkup)\b/i, reply: "We can see Biscuit on Thursday the twenty-second at three pm." }
  ]
};

const DENTIST: BusinessPersona = {
  name: "Bright Smile Dental",
  opening: "Bright Smile Dental, how can I help?",
  rules: [
    { when: /\bis that right\?$/i, reply: "Probably, let me check with my manager." },
    { when: /\b(appointment|cleaning)\b/i, reply: "We can fit you in on Thursday the twenty-second at three pm for one hundred twenty." }
  ]
};

function bookingScript(business: string, request: string, amountUsd?: number): ScriptedTurn[] {
  const price = amountUsd !== undefined ? ` for ${dollarsInWords(amountUsd)}` : "";
  return [
    { when: /how can i help/i, reply: () => [{ kind: "say", text: request, last: true }] },
    {
      when: /.+/,
      reply: () => [{
        kind: "end_call",
        outcome: { kind: "confirmed", summary: `${business} confirmed ${THURSDAY}${price}.`, when: THURSDAY, ...(amountUsd !== undefined ? { amountUsd } : {}) }
      }]
    }
  ];
}

function unansweredLine(): Line {
  const listeners = new Set<(input: LineInput) => void>();
  return {
    dial() {
      setTimeout(() => {
        for (const listener of listeners) listener({ kind: "line_ended", reason: "no_answer" });
      }, 1);
      return Promise.resolve();
    },
    say() {},
    hangUp() {},
    onInput(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

const brief = (name: string, goal: string, maxUsd: number): CallBrief => ({
  goal,
  business: { name, phone: parsePhoneNumber("4155550199") },
  ownerName: "Maya",
  maxUsd,
  facts: []
});

const simulated = (persona: BusinessPersona) => () => simulatedLine(persona, { speedMs: 5 });

export const SCENARIOS: Scenario[] = [
  {
    title: "A vet clinic books an appointment but gives no price",
    story: "Ambient must ask the owner before agreeing to no price, say so in the read-back, then book.",
    brief: brief(VET.name, "Book a checkup for Biscuit, the dog", 100),
    line: simulated(VET),
    brain: scriptedBrain(bookingScript(VET.name, "Hi, I'd like to book a checkup appointment for Maya's dog Biscuit. When do you have an opening?")),
    owner: "once",
    expect: { kind: "confirmed", transcript: [/Maya: Approved: a booking with no price/, /Okay, so just to confirm, no price is set/] }
  },
  {
    title: "A dental office hedges every read-back",
    story: "The business never says yes, so the call must end unconfirmed after the read-back cap.",
    brief: brief(DENTIST.name, "Book a cleaning", 150),
    line: simulated(DENTIST),
    brain: scriptedBrain(bookingScript(DENTIST.name, "Hi, I'd like to book a cleaning appointment for Maya. When do you have an opening?", 120)),
    expect: { kind: "unconfirmed", transcript: [/Probably, let me check with my manager\.[^]*Probably, let me check with my manager\.[^]*Probably, let me check with my manager\./] }
  },
  {
    title: "Nobody picks up (no answer)",
    story: "The line rings out, so the call ends unconfirmed with the dial-failure reason.",
    brief: brief("Joe's Plumbing", "Book a plumber", 150),
    line: unansweredLine,
    brain: scriptedBrain(DEMO_SCRIPT),
    expect: { kind: "unconfirmed", transcript: [] }
  },
  {
    title: "The owner declines the over-limit price",
    story: "The plumber holds at one hundred eighty against a limit of one hundred fifty; Maya says no.",
    brief: brief(JOES_PLUMBING.name, "Book a visit to fix the kitchen sink", 150),
    line: simulated(JOES_PLUMBING),
    brain: scriptedBrain(DEMO_SCRIPT),
    owner: "deny",
    expect: { kind: "no_deal", transcript: [/Maya: Declined: /] }
  }
];
