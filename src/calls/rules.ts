import type { PhoneNumber } from "./types.js";

export const HOLD_LINE_MS = 15_000;
export const OWNER_PATIENCE_MS = 90_000;
const MAX_DIGIT_RUN = 11;
const MAX_CALLS_PER_NUMBER_PER_DAY = 3;
const MAX_CALLS_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

export function disclosure(ownerName: string): string {
  return `Hi, this is an AI assistant calling for ${ownerName}. This call is transcribed.`;
}

const DIGIT = "(?:\\p{Nd}|\\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\\b)";
const SEPARATOR = "(?:[\\s,.\\-\\u2010-\\u2015/_:()+*#&\\u200b]|\\ufe0f|\\u20e3|\\band\\b)*";
const LONG_RUN = new RegExp(`${DIGIT}(?:${SEPARATOR}${DIGIT}){${MAX_DIGIT_RUN},}`, "giu");
const TRAILING_RUN = new RegExp(`${DIGIT}(?:${SEPARATOR}${DIGIT})*${SEPARATOR}$`, "iu");

export function redactDigits(text: string): string {
  return text.normalize("NFKC").replace(LONG_RUN, "that number");
}

export function holdTrailingDigits(text: string): { ready: string; held: string } {
  const word = /\S+$/.exec(text)?.index ?? text.length;
  const cut = TRAILING_RUN.exec(text.slice(0, word))?.index ?? word;
  return { ready: text.slice(0, cut), held: text.slice(cut) };
}

const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = new Set(["hundred", "thousand"]);

function underHundred(words: string[]): number | undefined {
  const [first, second, ...rest] = words;
  if (first === undefined || rest.length > 0) return undefined;
  if (second === undefined) return ONES[first] ?? TEENS[first] ?? TENS[first];
  const tens = TENS[first];
  const ones = ONES[second];
  return tens !== undefined && ones !== undefined && ones > 0 ? tens + ones : undefined;
}

function scaled(words: string[], scale: string, factor: number, below: (words: string[]) => number | undefined): number | undefined {
  const at = words.indexOf(scale);
  const head = words.slice(0, at);
  const multiplier = head.length === 0 || (head.length === 1 && head[0] === "a") ? 1 : below(head);
  const tail = words.slice(at + 1).filter(word => word !== "and");
  const rest = tail.length === 0 ? 0 : below(tail);
  return multiplier !== undefined && rest !== undefined ? multiplier * factor + rest : undefined;
}

function belowThousand(words: string[]): number | undefined {
  if (words.includes("hundred")) return scaled(words, "hundred", 100, underHundred);
  const [first, ...tail] = words;
  const lead = first === undefined ? undefined : ONES[first];
  const rest = underHundred(tail);
  if (lead !== undefined && lead > 0 && rest !== undefined && rest >= 10) return lead * 100 + rest;
  return underHundred(words);
}

function wordsToNumber(words: string[]): number | undefined {
  return words.includes("thousand") ? scaled(words, "thousand", 1000, belowThousand) : belowThousand(words);
}

const NUMBER_WORDS = new Set([...Object.keys(ONES), ...Object.keys(TEENS), ...Object.keys(TENS), ...SCALES]);

export function amountsIn(text: string): number[] {
  const found = [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map(match => Number(match[0].replace(/,/g, "")));
  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
  let run: string[] = [];
  const flush = () => {
    const words = run.filter((word, index) => word !== "a" || SCALES.has(run[index + 1] ?? ""));
    const value = words.length > 0 ? wordsToNumber(words) : undefined;
    if (value !== undefined) found.push(value);
    run = [];
  };
  tokens.forEach((token, index) => {
    const joins = (token === "and" && run.some(word => SCALES.has(word))) || (token === "a" && SCALES.has(tokens[index + 1] ?? ""));
    if (NUMBER_WORDS.has(token) || (joins && (run.length > 0 || token === "a"))) run.push(token);
    else flush();
  });
  flush();
  return found;
}

const NEGATION = /\b(not|never|no|nope|nah|don'?t|won'?t|can'?t|cannot|refuse|over|above|under|more|less|max(imum)?|at most|limit|too|without|instead|last time|paid|only if|unless|if|maybe|ridiculous|rip-?off|insane|crazy|outrageous|out)\b|n't\b/i;
const OFFER_CUE = /\b(offer|counter|tell (him|her|them)|say|make it|how about|go (up )?to|go with|try|accept|agree( to)?|approve|pay|okay|ok|sure|yes|yeah|fine|works|deal)\b/i;
const AMOUNT_ONLY = /^(?:[\s$.,!?-]|\d|\b(?:a|and|dollars|bucks|hundred|thousand|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b)+$/i;

export function offerIn(text: string): number | undefined {
  const amounts = amountsIn(text);
  if (amounts.length !== 1 || NEGATION.test(text) || text.includes("?")) return undefined;
  return OFFER_CUE.test(text) || AMOUNT_ONLY.test(text) ? amounts[0] : undefined;
}

const phrases = (list: string[]) => new RegExp(`(?:^|\\s)(?:${[...list].sort((a, b) => b.length - a.length).join("|")})(?=\\s|$)`, "g");
const CONFIRMATION = phrases([
  "that's right", "that is right", "that's correct", "that is correct", "sounds good", "sounds great", "looks good", "you bet", "of course", "that'll work",
  "that works", "works for me", "no problem", "not a problem", "no worries", "all set", "you're all set", "you got it", "you're booked", "sure thing",
  "all right", "mm-hmm", "mm hmm", "uh-huh", "uh huh", "yes", "yeah", "yep", "yup", "correct", "right", "sure", "okay", "ok", "alright", "perfect",
  "exactly", "definitely", "certainly", "absolutely", "mhm", "indeed", "deal"
]);
const COURTESY = phrases(["thank you", "see you then", "see you", "thanks", "great", "good"]);
const NEGATIVE_WORDS = new Set(["no", "not", "never", "nope", "nah"]);
const FILLER = new Set(["and", "then", "so", "oh", "um", "uh", "sorry", "sir", "ma'am", "we'll", "the", "that's", "that", "it's", "it", "is", "o'clock", "am", "pm"]);
const isNumber = (token: string) => /^\$?\d+(\.\d+)?$/.test(token) || NUMBER_WORDS.has(token);

function plainWords(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/(\d+):00\b/g, "$1")
    .replace(/[,;!]/g, " | ")
    .replace(/[^a-z0-9'$.|\s-]/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numberRuns(tokens: string[]): string[][] {
  const runs: string[][] = [];
  let run: string[] = [];
  for (const token of [...tokens, "|"]) {
    if (isNumber(token) || ((token === "a" || token === "and") && run.length > 0)) run.push(token);
    else {
      while (run.length > 0 && !isNumber(run.at(-1)!)) run.pop();
      if (run.length > 0) runs.push(run);
      run = [];
    }
  }
  return runs;
}

export function agreesTo(reply: string, terms: string, amountUsd: number | undefined): boolean {
  if (reply.includes("?")) return false;
  const words = plainWords(reply);
  const tokens = words.split(" ").filter(token => token && token !== "|").flatMap(token => token.split("-").filter(Boolean));
  if (tokens.length > 14) return false;
  if (!CONFIRMATION.test(words)) return false;
  CONFIRMATION.lastIndex = 0;
  const numbers = [...amountsIn(terms), ...(amountUsd !== undefined ? [amountUsd] : [])];
  if (!chargedIn(words.replaceAll("|", " ")).every(charge => charge === amountUsd)) return false;
  const runs = numberRuns(words.split(" ").flatMap(token => token.split("-").filter(Boolean)));
  if (!runs.every(run => {
    const values = amountsIn(run.join(" "));
    return values.length === 1 && numbers.includes(values[0]!);
  })) return false;
  const known = new Set(plainWords(terms).split(" ").filter(word => !NEGATIVE_WORDS.has(word)));
  const rest = words.replace(CONFIRMATION, " ").replace(COURTESY, " ").split(" ").filter(token => token && token !== "|").flatMap(token => token.split("-").filter(Boolean));
  return rest.every(token => isNumber(token) || token === "a" || FILLER.has(token) || known.has(token));
}

export function noteFromCall(fact: string): string | undefined {
  const note = fact.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
  return note && note.length <= 200 ? note : undefined;
}

const money = (raw: string, thousands?: string) => Number(raw.replace(/,/g, "")) * (thousands ? 1000 : 1);

export function chargedIn(text: string): number[] {
  const symbols = [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)(k\b)?/gi)].map(match => money(match[1]!, match[2]));
  const trailing = [...text.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s?\$/g)].map(match => money(match[1]!));
  const named = [...text.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s*(?:dollars?|bucks|usd)\b/gi)].map(match => money(match[1]!));
  const labelled = [...text.matchAll(/\b(?:usd|total|price|cost|fee|charge)\s*:?\s*\$?(\d[\d,]*(?:\.\d+)?)\b/gi)].map(match => money(match[1]!));
  const spoken = [...text.matchAll(/((?:\b[a-z]+[\s-]+){1,8})(?:dollars?|bucks)\b/gi)].flatMap(match => amountsIn(match[1]!).slice(-1));
  return [...symbols, ...trailing, ...named, ...labelled, ...spoken];
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
