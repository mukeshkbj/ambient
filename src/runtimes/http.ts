export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function firstString(value: unknown, ...fields: string[]): string | undefined {
  const row = record(value);
  for (const field of fields) {
    const direct = row[field];
    if (typeof direct === "string" && direct) return direct;
    const nested = field.includes(".") ? field.split(".").reduce<unknown>((acc, part) => record(acc)[part], row) : undefined;
    if (typeof nested === "string" && nested) return nested;
  }
  return undefined;
}
