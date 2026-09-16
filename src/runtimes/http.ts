export type JsonRequestOptions = {
  method?: string | undefined;
  token?: string | undefined;
  body?: unknown;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch | undefined;
};

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

export function contentText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const parts = value
      .map(part => (typeof part === "string" ? part : firstString(part, "text", "content")))
      .filter((part): part is string => typeof part === "string" && part.length > 0);
    if (parts.length) return parts.join("");
  }
  return undefined;
}

export async function jsonRequest(url: string, options: JsonRequestOptions = {}): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = options.timeoutMs && options.timeoutMs > 0
    ? setTimeout(() => controller.abort(), options.timeoutMs)
    : undefined;
  try {
    const response = await fetchImpl(url, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: {
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      const detail = text.length > 0 && text.length <= 300 ? `: ${text}` : "";
      throw new Error(`HTTP ${response.status} ${response.statusText}${detail}`);
    }
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
