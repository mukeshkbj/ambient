import type { Approval, RuntimeState, RunView } from "./types.js";
import { dollarsInWords, priceInWords } from "./words.js";
import { offerIn } from "./calls/rules.js";

// Words that open an instruction but don't identify it.
const FILLER = new Set(["please", "can", "could", "you", "hey", "ok", "okay", "just", "um"]);

// Weak tail words — a title that ends on one reads broken.
const TAIL = new Set(["at", "for", "to", "on", "in", "the", "a", "an", "and", "or", "with", "of", "by", "my", "your"]);

/** A short speakable title: the first meaningful words of the instruction. */
export function titleFor(instruction: string): string {
  const words = instruction.replace(/["“”]/g, "").split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    const clean = word.replace(/^[^\p{L}\p{N}$]+|[^\p{L}\p{N}.'$-]+$/gu, "");
    if (!clean) continue;
    if (kept.length === 0 && FILLER.has(clean.toLowerCase())) continue;
    kept.push(clean);
    if (kept.length === 6) break;
  }
  while (kept.length > 1 && TAIL.has(kept[kept.length - 1]!.toLowerCase())) kept.pop();
  const title = kept.join(" ").replace(/[.,!?;:'-]+$/, "").trim();
  return title || "new task";
}

const UNREACHED = new Set(["nobody picked up", "the line was busy", "the call didn't connect", "the line ended before they answered"]);

const CALENDAR_DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\d{1,2}\/\d{1,2}|\bthe (?:\d{1,2}(?:st|nd|rd|th)|(?:twenty|thirty)?-? ?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\b/i;

function clampSentences(value: string, max = 2): string {
  const sentences = value.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [];
  const picked = sentences.slice(0, max).map(sentence => sentence.trim()).filter(Boolean);
  return picked.length > 0 ? picked.join(" ") : value.trim();
}

function stripEnd(value: string): string {
  return value.replace(/[.!?\s]+$/, "");
}

export type SpeakContext = {
  label: string;
  state?: RuntimeState;
};

function callee(view: RunView): string | undefined {
  if (view.subject) return view.subject;
  for (const step of view.steps) {
    const match = /^(?:Calling|Connected to) (.+)$/.exec(step);
    if (match) return match[1];
  }
  return undefined;
}

function lastLineFrom(view: RunView, speaker: string): string | undefined {
  const prefix = `${speaker}: `;
  return view.steps.findLast(step => step.startsWith(prefix))?.slice(prefix.length);
}

const ownerChoices = (limit: number) => `Say approve to book it, offer followed by a price like ${priceInWords(limit)}, or hang up.`;

/** The approval ask on its own — used as the elicitation message. */
export function approvalAsk(view: RunView, ctx: SpeakContext): string {
  const business = callee(view);
  const approval = view.approval;
  if (business && approval?.kind === "spend" && approval.amountUsd !== undefined && approval.limitUsd !== undefined) {
    const when = approval.when ? ` for ${approval.when}` : "";
    return `${business} wants ${dollarsInWords(approval.amountUsd)}${when}. Your limit is ${dollarsInWords(approval.limitUsd)}. ${ownerChoices(approval.limitUsd)}`;
  }
  const request = view.approval?.description ?? view.approval?.command;
  if (request && view.approval?.amountUsd !== undefined) {
    const amount = dollarsInWords(view.approval.amountUsd);
    const asked = /[?]$/.test(request.trim()) ? request.trim() : `${stripEnd(request)}.`;
    return asked.includes(amount) ? asked : `${asked} That's ${amount}.`;
  }
  return request
    ? `${callee(view) ? "" : `${ctx.label} is asking: `}${/[?]$/.test(request.trim()) ? request.trim() : `${stripEnd(request)}.`}`
    : `${ctx.label} needs your approval to continue "${view.title}".`;
}

/**
 * The single voice contract for run results: two sentences at most, outcome
 * first, open states end by telling the user what to say next, and never an id.
 */
export function speak(view: RunView, ctx: SpeakContext): string {
  const label = ctx.label;
  const title = `"${view.title}"`;
  const business = callee(view);
  if (business) {
    if (view.status === "waiting_approval") {
      const ask = approvalAsk(view, ctx);
      if (ask.endsWith(", or hang up.")) return ask;
      const choices = view.approval?.kind === "dial" ? "Say yes to place the call, or no." : view.approval?.amountUsd === undefined ? "Say approve to book it, or hang up." : "Say approve, offer followed by a price, or hang up.";
      return `${ask} ${choices}`;
    }
    if (view.status === "cancelled") return `You ended the call before ${business} confirmed. Nothing was booked.`;
    if (view.status === "running" || view.status === "accepted" || view.status === "queued") {
      const heard = lastLineFrom(view, business);
      if (heard) return `${label} is on the phone with ${business}. They just said: ${clampSentences(heard, 1)} Say status for the latest, or hang up.`;
      return view.steps.some(step => step.startsWith("Connected to")) ? `${label} is on the phone with ${business}.` : `${label} is calling ${business} now.`;
    }
  }
  switch (view.status) {
    case "completed": {
      const outcome = view.outcome;
      if (outcome?.kind === "confirmed") {
        const undated = outcome.when && !CALENDAR_DATE.test(outcome.when) ? " They gave a day but no date, so check which one." : "";
        return `${clampSentences(outcome.summary, 1)}${undated}`;
      }
      if (outcome?.kind === "unconfirmed") {
        const business = callee(view);
        const reason = stripEnd(outcome.reason);
        const unreached = UNREACHED.has(reason);
        const retry = `To try again, say, for example, call ${business ?? "Joe's Plumbing"}.`;
        return unreached
          ? `${business ?? "The business"} wasn't reached: ${reason}. Nothing is booked. ${retry}`
          : `${business ?? "The business"} didn't confirm: ${reason}. I can't confirm a booking, so check with them before you call again.`;
      }
      const declined = outcome && /^\S+ declined (.+)$/.exec(outcome.reason);
      if (declined) return `You said no to ${stripEnd(declined[1]!)}, so I ended the call. Nothing is booked.`;
      if (outcome) return clampSentences(`${stripEnd(outcome.reason)}.`);
      return clampSentences(view.answer ?? `${label} finished ${title}.`);
    }
    case "failed": {
      const business = callee(view);
      return business ? `The call to ${business} hit an error, so I can't confirm a booking. Say call, followed by who to call, to try again.` : `${label} couldn't finish ${title}. Say call, followed by who to call, to try again.`;
    }
    case "cancelled":
      return `${label} stopped ${title}.`;
    case "cancel_requested":
      return `Asking ${label} to stop ${title}.`;
    case "waiting_approval": {
      return `${approvalAsk(view, ctx)} Say approve to allow it once, or deny.`;
    }
    case "unknown":
      return `${label} lost the connection during ${title}, so the outcome is unknown. It won't retry by itself. Say call, followed by who to call, once it's back.`;
    default: {
      if (ctx.state === "offline") {
        return `${label} is offline; ${title} is marked ${view.status} until it reconnects.`;
      }
      const working = view.progress
        ? `${label} is working on ${title} — ${stripEnd(clampSentences(view.progress, 1))}.`
        : `${label} is working on ${title}.`;
      return `${working} Say status any time.`;
    }
  }
}

export function heldStatus(view: RunView): string | undefined {
  const business = callee(view);
  const amount = view.approval?.amountUsd;
  const limit = view.approval?.limitUsd;
  if (!business || view.status !== "waiting_approval" || view.approval?.kind !== "spend" || amount === undefined) return undefined;
  const offered = view.steps.map(step => offerIn(step.slice(step.indexOf(": ") + 2))).findLast(offer => offer !== undefined);
  const countered = offered !== undefined && offered < amount ? `${business} turned down your offer and` : business;
  if (limit === undefined) return `${countered} is holding at ${dollarsInWords(amount)}. Say approve or hang up.`;
  return `${countered} is holding at ${dollarsInWords(amount)}, over your limit of ${dollarsInWords(limit)}. ${ownerChoices(limit)}`;
}

export function steerReply(view: RunView, ctx: SpeakContext, said?: string): string {
  const business = callee(view);
  const offer = said === undefined ? undefined : offerIn(said);
  if (business && offer !== undefined) return `Okay, offering ${dollarsInWords(offer)}. Say status to hear their answer.`;
  return business ? `Okay, I'll tell ${business}. Say status to hear their answer.` : `Noted — passed that to ${ctx.label} while it works on "${view.title}".`;
}

export type VoiceResult = {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  _meta: Record<string, unknown>;
};

export const TASK_RESOURCE_URI = "ui://ambient/task";

function approvalSummary(approval: Approval, label: string): Record<string, unknown> {
  return {
    id: approval.id,
    command: approval.command,
    ...(approval.description ? { description: approval.description } : {}),
    ...(approval.amountUsd !== undefined ? { amountUsd: approval.amountUsd } : {}),
    ...(approval.limitUsd !== undefined ? { limitUsd: approval.limitUsd } : {}),
    ...(approval.when ? { when: approval.when } : {}),
    ...(approval.kind ? { kind: approval.kind } : {}),
    choices: approval.choices,
    agent: label,
    createdAt: approval.createdAt
  };
}

export function taskCard(view: RunView, label: string): Record<string, unknown> {
  return {
    task: {
      id: view.id,
      title: view.title,
      instruction: view.instruction,
      status: view.status,
      steps: view.steps,
      ...(view.progress ? { progress: view.progress } : {}),
      ...(view.answer ? { answer: view.answer } : {}),
      ...(view.failure ? { failure: view.failure } : {}),
      ...(view.outcome ? { outcome: view.outcome } : {}),
      ...(view.subject ? { subject: view.subject } : {}),
      createdAt: view.createdAt,
      updatedAt: view.updatedAt
    },
    ...(view.approval ? { approvals: [approvalSummary(view.approval, label)] } : {})
  };
}

/** Standard tool result for a run: spoken text plus a structured task card. */
export function runResult(view: RunView, ctx: SpeakContext, text = speak(view, ctx)): VoiceResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      speech: text,
      status: view.status,
      assistant: ctx.label,
      ...taskCard(view, ctx.label),
      ids: {
        run: view.id,
        conversation: view.conversationId,
        ...(view.approval ? { approval: view.approval.id } : {})
      }
    },
    _meta: { ui: { resourceUri: TASK_RESOURCE_URI, invoking: "Talking to your agent…", invoked: "Done" } }
  };
}

/** Plain spoken result with optional structured payload — no task card. */
export function say(text: string, structuredContent: Record<string, unknown> = {}): VoiceResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: { speech: text, ...structuredContent },
    _meta: {}
  };
}
