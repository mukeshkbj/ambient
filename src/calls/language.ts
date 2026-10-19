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
};

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
  unreachable: (owner, disclosed) => `${disclosed ? "" : `${ENGLISH.disclosure(owner)} `}I'm sorry, I can't reach ${owner} right now. I'll tell ${owner} you were holding. Thank you, goodbye.`
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
  unreachable: (owner, disclosed) => `${disclosed ? "" : `${SPANISH.disclosure(owner)} `}Lo siento, no puedo comunicarme con ${owner} ahora. Le diré a ${owner} que usted esperó. Gracias, adiós.`
};

export function lines(language: Language | undefined): Lines {
  return language === "es" ? SPANISH : ENGLISH;
}

const plain = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[.,!;:¡"“”'’…]/g, " ").replace(/\s+/g, " ").trim();

const YES = /(?:^| )(?:sí|así es|correcto|exacto|de acuerdo|eso es|perfecto|claro que sí)(?= |$)/g;
const COURTESY = new Set("gracias muchas muy bien está vale nos vemos hasta luego entonces señor señora listo adiós buenas perfecto".split(" "));

export function agreesInSpanish(reply: string): boolean {
  if (/[?¿]/.test(reply)) return false;
  const words = plain(reply);
  if (words.split(" ").length > 10 || !YES.test(words)) return false;
  YES.lastIndex = 0;
  return words.replace(YES, " ").split(" ").filter(Boolean).every(word => COURTESY.has(word));
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
