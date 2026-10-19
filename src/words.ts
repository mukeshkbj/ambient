const SMALL = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function belowThousand(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts = hundreds > 0 ? [`${SMALL[hundreds]} hundred`] : [];
  if (rest > 0 || parts.length === 0) {
    const tens = Math.floor(rest / 10);
    parts.push(rest < 20 ? SMALL[rest]! : `${TENS[tens]}${rest % 10 ? `-${SMALL[rest % 10]}` : ""}`);
  }
  return parts.join(" ");
}

export function numberInWords(value: number): string {
  const whole = Math.round(value);
  if (whole < 1000) return belowThousand(whole);
  const thousands = Math.floor(whole / 1000);
  const rest = whole % 1000;
  return rest > 0 ? `${belowThousand(thousands)} thousand ${belowThousand(rest)}` : `${belowThousand(thousands)} thousand`;
}

export function priceInWords(value: number): string {
  const whole = Math.round(value);
  return whole === value && whole >= 100 && whole < 1000 && whole % 100 >= 10 ? `${numberInWords(Math.floor(whole / 100))} ${numberInWords(whole % 100)}` : dollarsInWords(value);
}

export function dollarsInWords(value: number): string {
  const total = Math.round(value * 100);
  const whole = Math.floor(total / 100);
  const cents = total % 100;
  const dollars = `${numberInWords(whole)} ${whole === 1 ? "dollar" : "dollars"}`;
  return cents === 0 ? dollars : `${dollars} and ${numberInWords(cents)} ${cents === 1 ? "cent" : "cents"}`;
}
