import type { Verdict } from "./rules.js";

export type Language = "en" | "es";

export type Lines = {
  disclosure(owner: string): string;
  openers: string[];
  terms(price: string | undefined, when: string): string;
  question: string;
  talkedOver(terms: string): string;
  askTime: [string, string];
  optOut: string;
  released(owner: string): string;
  letKnow(owner: string): string;
  passPrice(owner: string): string;
  passUnpriced(owner: string): string;
  booked(when: string | undefined): string;
  noDeal: string;
  checking(owner: string, again: boolean): string;
  holding(owner: string): string[];
  unreachable(owner: string, disclosed: boolean): string;
  receipt(owner: string, amountUsd: number | undefined, when: string | undefined): string;
};

const usd = (amount: number) => `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;

const ENGLISH: Lines = {
  disclosure: owner => `Hi, this is an AI assistant calling for ${owner}. This call is transcribed.`,
  openers: ["Okay, so just to confirm,", "Let me say it back,", "One more time,", "Just so I'm sure,"],
  terms: (price, when) => price !== undefined ? `${price} total${when ? `, ${when}` : ""}` : `no price is set${when ? `, ${when}` : ""}`,
  question: "Is that right?",
  talkedOver: terms => `Sorry, I talked over you. Was that a yes to ${terms}?`,
  askTime: ["Sorry, could you give me just the day and time?", "Sorry, I missed that. What day and time?"],
  optOut: "Understood, I won't call again. Sorry to bother you, goodbye.",
  released: owner => `Thanks so much for the quote. ${owner} is going with another option this time. Bye.`,
  letKnow: owner => `I'll let ${owner} know. Thanks for your time, goodbye.`,
  passPrice: owner => `Okay, no problem. ${owner} will pass at that price. Thanks for your time, bye.`,
  passUnpriced: owner => `Okay, no problem. ${owner} won't book it without a price. Thanks for your time, bye.`,
  booked: when => when ? `Great, that's set for ${when}. Thanks so much, bye.` : "Perfect, thanks so much. Bye.",
  noDeal: "Okay, no worries. Thanks for your time, bye.",
  checking: (owner, again) => again ? `Sorry, one more moment, let me check with ${owner}.` : `One moment, let me check with ${owner}.`,
  holding: owner => [`Still checking with ${owner}, thanks for holding.`, `Still here. ${owner} hasn't answered yet.`, `Sorry, one more moment with ${owner}.`],
  unreachable: (owner, disclosed) => `${disclosed ? "" : `${ENGLISH.disclosure(owner)} `}I'm sorry, I can't reach ${owner} right now. I'll tell ${owner} you were holding. Thank you, goodbye.`,
  receipt: (owner, amount, when) => `Booked for ${owner}: ${[amount !== undefined ? `${usd(amount)} total` : "no price set", when].filter(Boolean).join(", ")}.`
};

const SPANISH: Lines = {
  disclosure: owner => `Hola, le habla un asistente de inteligencia artificial que llama de parte de ${owner}. Esta llamada se transcribe.`,
  openers: ["Muy bien, para confirmar,", "Déjeme repetirlo,", "Una vez más,", "Solo para estar seguro,"],
  terms: (price, when) => price !== undefined ? `${price} en total${when ? `, ${when}` : ""}` : `sin precio fijo${when ? `, ${when}` : ""}`,
  question: "¿Es correcto?",
  talkedOver: terms => `Perdón, le interrumpí. ¿Eso fue un sí a ${terms}?`,
  askTime: ["Perdón, ¿me puede dar solo el día y la hora?", "Perdón, no le entendí. ¿Qué día y a qué hora?"],
  optOut: "Entendido, no volveré a llamar. Disculpe la molestia, adiós.",
  released: owner => `Muchas gracias por el presupuesto. ${owner} va a elegir otra opción esta vez. Adiós.`,
  letKnow: owner => `Se lo diré a ${owner}. Gracias por su tiempo, adiós.`,
  passPrice: owner => `Muy bien, no hay problema. ${owner} no acepta ese precio. Gracias por su tiempo, adiós.`,
  passUnpriced: owner => `Muy bien, no hay problema. ${owner} no reserva sin precio. Gracias por su tiempo, adiós.`,
  booked: when => when ? `Perfecto, queda para ${when}. Muchas gracias, adiós.` : "Perfecto, muchas gracias. Adiós.",
  noDeal: "Muy bien, gracias por su tiempo. Adiós.",
  checking: (owner, again) => again ? `Perdón, un momento más, lo consulto con ${owner}.` : `Un momento, lo consulto con ${owner}.`,
  holding: owner => [`Sigo consultando con ${owner}, gracias por esperar.`, `Sigo aquí. ${owner} todavía no responde.`, `Perdón, un momento más con ${owner}.`],
  unreachable: (owner, disclosed) => `${disclosed ? "" : `${SPANISH.disclosure(owner)} `}Lo siento, no puedo comunicarme con ${owner} ahora. Le diré a ${owner} que usted esperó. Gracias, adiós.`,
  receipt: (owner, amount, when) => `Reservado para ${owner}: ${[amount !== undefined ? `${usd(amount)} en total` : "sin precio fijo", when].filter(Boolean).join(", ")}.`
};

export function lines(language: Language | undefined): Lines {
  return language === "es" ? SPANISH : ENGLISH;
}

const plain = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[.,!;:¡"“”'’…]/g, " ").replace(/\s+/g, " ").trim();

const YES = /(?:^| )(?:sí|si|así es|correcto|exacto|de acuerdo|eso es|perfecto|claro que sí|claro|vale|está bien)(?= |$)/g;
const COURTESY = new Set("gracias muchas muy bien está vale nos vemos hasta luego entonces señor señora listo adiós buenas perfecto".split(" "));

export function spanishVerdict(reply: string): Verdict {
  if (/[?¿]/.test(reply)) return { books: false, why: "It is a question." };
  const words = plain(reply);
  if (words.split(" ").length > 10) return { books: false, why: "It is too long to be a clean yes." };
  if (!YES.test(words)) return { books: false, why: "It has no word of agreement." };
  YES.lastIndex = 0;
  const extra = words.replace(YES, " ").split(" ").filter(word => word && !COURTESY.has(word));
  return extra.length === 0 ? { books: true } : { books: false, why: `It adds words that can change the deal: "${extra.join(" ")}".` };
}

export function agreesInSpanish(reply: string): boolean {
  return spanishVerdict(reply).books;
}

const DAYS = "lunes martes miércoles jueves viernes sábado domingo hoy mañana pasado";
const MONTHS = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre";
const ANCHORS = new Set(`${DAYS} ${MONTHS}`.split(" "));
const TIME_WORDS = new Set(`el la las los a de del y media cuarto en punto tarde noche mediodía ${DAYS} ${MONTHS}`.split(" "));

export function plainSpanishTime(when: string): boolean {
  const words = plain(when).split(" ").filter(Boolean);
  if (words.length === 0 || /[^\p{L}\p{Nd}\s:.,]/u.test(when)) return false;
  const known = words.every(word => TIME_WORDS.has(word) || /^\d{1,2}(?::\d{2})?$/.test(word));
  return known && words.some(word => ANCHORS.has(word) || /^\d/.test(word));
}

const SPANISH_DAYS: Record<string, string> = { lunes: "monday", martes: "tuesday", miércoles: "wednesday", jueves: "thursday", viernes: "friday", sábado: "saturday", domingo: "sunday", hoy: "today", mañana: "tomorrow" };
const SPANISH_MONTHS = MONTHS.split(" ");
const ENGLISH_MONTHS = "january february march april may june july august september october november december".split(" ");

function spanishTerms(spoken: string) {
  let words = plain(spoken);
  const period = /\bde la (?:tarde|noche)\b/.test(words) ? "pm" : /\bde la mañana\b/.test(words) ? "am" : undefined;
  words = words.replace(/\bde la (?:mañana|tarde|noche)\b/g, " ");
  const tokens = words.split(" ").filter(Boolean);
  return {
    numbers: tokens.flatMap(token => token.match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b),
    days: tokens.flatMap(token => SPANISH_DAYS[token] ?? []).sort(),
    months: tokens.flatMap(token => SPANISH_MONTHS.includes(token) ? [ENGLISH_MONTHS[SPANISH_MONTHS.indexOf(token)]!] : []).sort(),
    period
  };
}

function englishTerms(when: string) {
  const words = when.toLowerCase().replace(/\b([ap])\.m\.?/g, "$1m");
  const tokens = words.split(/[^a-z0-9]+/).filter(Boolean);
  return {
    numbers: (words.match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b),
    days: tokens.filter(token => Object.values(SPANISH_DAYS).includes(token)).sort(),
    months: tokens.filter(token => ENGLISH_MONTHS.includes(token)).sort(),
    period: /\bpm\b/.test(words) ? "pm" : /\bam\b/.test(words) ? "am" : undefined
  };
}

export function sameSpanishTime(spoken: string, when: string): boolean {
  const es = spanishTerms(spoken);
  const en = englishTerms(when);
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, index) => value === b[index]);
  return same(es.numbers, en.numbers) && same(es.days, en.days) && same(es.months, en.months) && (es.period === undefined || en.period === undefined || es.period === en.period);
}

const UNITS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

function belowThousand(value: number): string {
  if (value === 100) return "cien";
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const tail = rest === 0 ? "" : rest < 30 ? UNITS[rest]! : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? ` y ${UNITS[rest % 10]}` : ""}`;
  return [HUNDREDS[hundreds], tail].filter(Boolean).join(" ") || "cero";
}

const beforeNoun = (words: string) => words.replace(/veintiuno$/, "veintiún").replace(/uno$/, "un");

function spanishNumber(value: number): string {
  const thousands = Math.floor(value / 1000);
  const rest = value % 1000;
  const head = thousands === 0 ? "" : thousands === 1 ? "mil" : `${beforeNoun(belowThousand(thousands))} mil`;
  return [head, rest || !head ? belowThousand(rest) : ""].filter(Boolean).join(" ");
}

export function spanishPrice(amount: number): string {
  const total = Math.round(amount * 100);
  const whole = Math.floor(total / 100);
  const cents = total % 100;
  const dollars = whole === 1 ? "un dólar" : `${beforeNoun(spanishNumber(whole))} dólares`;
  return cents === 0 ? dollars : `${dollars} con ${spanishNumber(cents)} centavos`;
}
