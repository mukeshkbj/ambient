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
  if (amounts.length !== 1 || NEGATION.test(text)) return undefined;
  return OFFER_CUE.test(text) || AMOUNT_ONLY.test(text) ? amounts[0] : undefined;
}

const AFFIRMATIVE = /\b(yes|yeah|yep|yup|sure|correct|right|ok|okay|deal|fine|works|sounds good|confirmed|booked|perfect|great|absolutely|can do|will do|you got it|alright|all set|see you)\b/i;
const LEADING_YES = /^\W*(yes|yeah|yep|yup|sure|correct|right|ok|okay|alright|absolutely|perfect|great|deal|you got it)\b/i;
const REFUSAL = /\b(no|not|nope|nah|never|sorry|can'?t|cannot|won'?t|don'?t|unfortunately|too (much|low|high|expensive|steep|pricey))\b|n't\b/i;
const FIRST_SENTENCE_NO = /\b(no|not|nope|nah|never|too|can'?t|cannot|won'?t|don'?t|unfortunately|unable)\b|n't\b/i;
const POLITE = /\b(no problem|not a problem|no worries|not at all|no trouble)\b/gi;

const HOLDING = /\b(hold on|hang on|one (sec|second|moment|minute)|just a (sec|second|moment|minute)|give me a (sec|second|moment|minute)|let me (check|see|ask)|check with|ask my|get back to you|call you back)\b/i;

export function noteFromCall(fact: string): string | undefined {
  const note = fact.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
  return note && note.length <= 200 ? note : undefined;
}

export function affirms(text: string): boolean {
  if (HOLDING.test(text)) return false;
  const plain = text.replace(POLITE, "");
  const first = plain.split(/[.!?;]/)[0] ?? "";
  return (LEADING_YES.test(plain) && !FIRST_SENTENCE_NO.test(first)) || (AFFIRMATIVE.test(plain) && !REFUSAL.test(plain));
}

export function refuses(text: string): boolean {
  return REFUSAL.test(text.replace(POLITE, "")) && !affirms(text);
}

const PRICE_BEFORE = new Set(["be", "is", "it's", "its", "that's", "was", "cost", "costs", "charge", "charges", "fee", "price", "total", "quote", "run", "runs", "pay", "for", "only", "just", "about", "around", "do", "another", "plus", "extra"]);
const PRICE_AFTER = new Set(["dollar", "dollars", "bucks", "usd"]);
const THOUSANDS = new Set(["k", "grand"]);
const NOT_PRICE_AFTER = new Set(["hour", "hours", "hr", "hrs", "minute", "minutes", "min", "mins", "day", "days", "week", "weeks", "month", "months", "year", "years", "am", "pm", "a", "p", "o'clock", "percent", "%", "mile", "miles", "people", "time", "times", ":"]);
const JOINERS = new Set(["a", "and"]);
const RATE_UNITS = new Set(["hour", "hr", "day", "item", "unit", "piece", "foot", "room"]);
const RANGE = /\b(to|or|between|up to|from)\b|\d\s*-\s*\$?\d/i;
const ADDING = /\b(and|plus|another|extra|on top)\b/i;

type Mention = { value: number; priced: boolean; strict: boolean; rate: boolean; address: boolean };

function isRate(tokens: string[], end: number): boolean {
  const at = PRICE_AFTER.has(tokens[end] ?? "") ? end + 1 : end;
  const next = tokens[at] ?? "";
  return ["per", "each", "hourly", "/"].includes(next) || ((next === "an" || next === "a") && RATE_UNITS.has(tokens[at + 1] ?? ""));
}

function pricesIn(text: string, strict = false): number[] {
  return mentions(text).filter(item => (strict ? item.strict : item.priced) && !item.rate && !item.address).map(item => item.value);
}

export function quoteIn(text: string, strict = false): number | undefined {
  const prices = pricesIn(text, strict);
  if (prices.length === 0) return undefined;
  return prices.length > 1 && ADDING.test(text) && !RANGE.test(text) ? prices.reduce((sum, price) => sum + price, 0) : Math.max(...prices);
}

export function ratesIn(text: string): number[] {
  return mentions(text).filter(item => item.rate).map(item => item.value);
}

export function spokenAmountsIn(text: string): number[] {
  return mentions(text).filter(item => !item.address).map(item => item.value);
}

function mentions(text: string): Mention[] {
  const raw = (text.match(/\$|\d[\d,]*(?:\.\d+)?|[A-Za-z]+(?:'[A-Za-z]+)?|[^\s\w]/g) ?? []).filter(token => token !== "-");
  const tokens = raw.map(token => token.toLowerCase());
  const found: Mention[] = [];
  let at = 0;
  while (at < tokens.length) {
    const start = at;
    if (/^\d/.test(tokens[at]!)) at += 1;
    else while (at < tokens.length && (NUMBER_WORDS.has(tokens[at]!) || JOINERS.has(tokens[at]!))) at += 1;
    let end = at;
    while (end > start && JOINERS.has(tokens[end - 1]!)) end -= 1;
    if (end === start) {
      at = start + 1;
      continue;
    }
    at = end;
    const before = tokens[start - 1] ?? "";
    const after = tokens[end] ?? "";
    const scale = THOUSANDS.has(after) ? 1000 : 1;
    const strict = before === "$" || PRICE_AFTER.has(after) || scale > 1;
    const priced = strict || (PRICE_BEFORE.has(before) && !NOT_PRICE_AFTER.has(after));
    const address = before !== "$" && /^[A-Z][a-z]/.test(raw[end] ?? "");
    const rate = isRate(tokens, scale > 1 ? end + 1 : end);
    for (const value of amountsIn(tokens.slice(start, end).join(" ")).slice(0, 1)) found.push({ value: value * scale, priced, strict, rate, address });
  }
  return found;
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
