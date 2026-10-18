import type { PhoneNumber } from "./types.js";

export const HOLD_LINE_MS = 15_000;
const MAX_DIGIT_RUN = 11;
const MAX_CALLS_PER_NUMBER_PER_DAY = 3;
const MAX_CALLS_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export function disclosure(ownerName: string): string {
  return `Hi, this is an AI assistant calling for ${ownerName}. This call is transcribed.`;
}

const DIGIT = "(?:\\d|\\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\\b)";
const SEPARATOR = "[\\s,.-]*";
const LONG_RUN = new RegExp(`${DIGIT}(?:${SEPARATOR}${DIGIT}){${MAX_DIGIT_RUN},}`, "gi");
const TRAILING_RUN = new RegExp(`${DIGIT}(?:${SEPARATOR}${DIGIT})*${SEPARATOR}$`, "i");

export function redactDigits(text: string): string {
  return text.replace(LONG_RUN, "that number");
}

export function holdTrailingDigits(text: string): { ready: string; held: string } {
  const match = TRAILING_RUN.exec(text);
  if (!match) return { ready: text, held: "" };
  return { ready: text.slice(0, match.index), held: text.slice(match.index) };
}

const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function underHundred(words: string[]): number | undefined {
  const [first, second, ...rest] = words;
  if (first === undefined || rest.length > 0) return undefined;
  if (second === undefined) return ONES[first] ?? TEENS[first] ?? TENS[first];
  const tens = TENS[first];
  const ones = ONES[second];
  return tens !== undefined && ones !== undefined && ones > 0 ? tens + ones : undefined;
}

function wordsToNumber(words: string[]): number | undefined {
  const hundred = words.indexOf("hundred");
  if (hundred >= 0) {
    const head = words.slice(0, hundred);
    const multiplier = head.length === 0 || (head.length === 1 && head[0] === "a") ? 1 : underHundred(head);
    const tail = words.slice(hundred + 1).filter(word => word !== "and");
    const rest = tail.length === 0 ? 0 : underHundred(tail);
    return multiplier !== undefined && rest !== undefined ? multiplier * 100 + rest : undefined;
  }
  const [first, ...tail] = words;
  const lead = first === undefined ? undefined : ONES[first];
  const rest = underHundred(tail);
  if (lead !== undefined && lead > 0 && rest !== undefined && rest >= 10) return lead * 100 + rest;
  return underHundred(words);
}

const NUMBER_WORDS = new Set([...Object.keys(ONES), ...Object.keys(TEENS), ...Object.keys(TENS), "hundred"]);

export function amountsIn(text: string): number[] {
  const found = [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(match => Number(match[0].replace(/,/g, "")));
  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
  let run: string[] = [];
  const flush = () => {
    const words = run.filter((word, index) => word !== "a" || run[index + 1] === "hundred");
    const value = words.length > 0 ? wordsToNumber(words) : undefined;
    if (value !== undefined) found.push(value);
    run = [];
  };
  tokens.forEach((token, index) => {
    const joins = (token === "and" && run.includes("hundred")) || (token === "a" && tokens[index + 1] === "hundred");
    if (NUMBER_WORDS.has(token) || (joins && (run.length > 0 || token === "a"))) run.push(token);
    else flush();
  });
  flush();
  return found;
}

export type PlacedCall = { to: PhoneNumber; startedAt: string };
export type DialCheck = { ok: true } | { ok: false; reason: string };

export function checkDialLimits(history: PlacedCall[], to: PhoneNumber, now: string): DialCheck {
  const since = Date.parse(now) - DAY_MS;
  const recent = history.filter(call => Date.parse(call.startedAt) > since);
  if (recent.length >= MAX_CALLS_PER_DAY) return { ok: false, reason: `Already placed ${MAX_CALLS_PER_DAY} calls in the last day.` };
  if (recent.filter(call => call.to === to).length >= MAX_CALLS_PER_NUMBER_PER_DAY) {
    return { ok: false, reason: `Already called this number ${MAX_CALLS_PER_NUMBER_PER_DAY} times in the last day.` };
  }
  return { ok: true };
}
