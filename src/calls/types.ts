import type { AssistantEvent } from "../runtimes/types.js";

export type PhoneNumber = string & { readonly brand: "E164" };

export type CallBrief = {
  goal: string;
  business: { name: string; phone: PhoneNumber };
  ownerName: string;
  maxUsd?: number;
  compare?: true;
  facts: string[];
};

export type ProofOfYes = { readBack: string; readBackAt: string; yes: string; yesAt: string };

export type Speaker = "agent" | "business" | "owner";
export type CallTurn = { speaker: Speaker; text: string; at: string };

export type CallOutcome =
  | { kind: "confirmed"; summary: string; amountUsd?: number; when?: string; proof?: ProofOfYes }
  | { kind: "declined"; reason: string }
  | { kind: "no_deal"; reason: string }
  | { kind: "unconfirmed"; reason: string };

export type CallPhase =
  | { kind: "dialing" }
  | { kind: "talking" }
  | { kind: "waiting_for_owner"; requestId: string; question: string; amountUsd?: number; unpriced?: true; when?: string; since: string; lastHoldLine: string }
  | { kind: "ended"; outcome: CallOutcome };

export type LineInput =
  | { kind: "answered" }
  | { kind: "heard"; text: string }
  | { kind: "interrupted"; spokenSoFar: string }
  | { kind: "played"; text: string }
  | { kind: "line_ended"; reason: "hangup" | "no_answer" | "busy" | "failed" };

export type CallInput =
  | LineInput
  | { kind: "brain"; turn: number; step: BrainStep }
  | { kind: "owner_said"; text: string }
  | { kind: "owner_decided"; requestId: string; decision: "once" | "deny" }
  | { kind: "released"; requestId: string }
  | { kind: "chosen"; requestId: string }
  | { kind: "hold_tick" };

export type BrainStep =
  | { kind: "say"; text: string; last: boolean }
  | { kind: "ask_owner"; question: string; amountUsd?: number; when?: string }
  | { kind: "remember"; fact: string }
  | { kind: "end_call"; outcome: Exclude<CallOutcome, { kind: "unconfirmed" }> };

export type CallEffect =
  | { kind: "say"; text: string; last: boolean }
  | { kind: "think"; turn: number }
  | { kind: "remember"; fact: string }
  | { kind: "hang_up" }
  | { kind: "emit"; event: AssistantEvent };

export type CallRecord = {
  runId: string;
  businessName: string;
  phone: PhoneNumber;
  goal: string;
  outcome: CallOutcome;
  at: string;
};

export function parsePhoneNumber(raw: string): PhoneNumber {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (/[a-z]/i.test(trimmed)) throw new Error(`Not a phone number: ${raw}`);
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}` as PhoneNumber;
  if (digits.length === 10) return `+1${digits}` as PhoneNumber;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}` as PhoneNumber;
  throw new Error(`Not a phone number: ${raw}`);
}
