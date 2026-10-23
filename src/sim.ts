import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { RuntimeRegistry } from "./runtimes/registry.js";
import { taskCard } from "./voice.js";

export type SimDependencies = {
  registry: RuntimeRegistry;
  /** Loopback MCP endpoint this host calls — the sim is a real MCP client. */
  mcpUrl: string;
  token?: string;
  /** Directory holding the sim front end (index.html). */
  assetsDir: string;
};

export type SimEvent =
  | {
      type: "run";
      run: { title: string; status: string; assistant: string };
      /** Same shape the task view renders — lets the UI update without a tool call. */
      view: Record<string, unknown>;
    }
  | { type: "attention"; pending: number }
  | { type: "elicit"; id: string; message: string };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

function structuredOf(result: unknown): Record<string, unknown> | undefined {
  const value = (result as { structuredContent?: unknown }).structuredContent;
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function speechOf(result: unknown, structured: Record<string, unknown> | undefined): string {
  if (typeof structured?.speech === "string") return structured.speech;
  const content = (result as { content?: { type: string; text?: string }[] }).content;
  return content?.find(item => item.type === "text")?.text ?? "";
}

export class SimHost {
  private clientPromise: Promise<Client> | undefined;
  private readonly listeners = new Set<(event: SimEvent) => void>();
  private readonly unwatch: (() => void)[] = [];
  private readonly pendingElicits = new Map<string, {
    message: string;
    resolve: (result: { action: string; content?: Record<string, unknown> }) => void;
  }>();
  private elicitSeq = 0;

  constructor(private readonly options: SimDependencies) {}

  private client(): Promise<Client> {
    this.clientPromise ??= (async () => {
      const client = new Client(
        { name: "ambient-sim", version: "0.1.0" },
        // The sim acts like Alexa+: it can field elicitation requests in-band.
        { capabilities: { elicitation: {} } }
      );
      await client.connect(new StreamableHTTPClientTransport(new URL(this.options.mcpUrl), this.options.token
        ? { requestInit: { headers: { authorization: `Bearer ${this.options.token}` } } }
        : undefined) as Parameters<typeof client.connect>[0]);
      // Hold each elicitation open until the browser answers — the POST that
      // carried it stays live as an SSE stream the whole time.
      const { ElicitRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
      client.setRequestHandler(ElicitRequestSchema, async request => {
        const id = `elicit-${++this.elicitSeq}`;
        const message = request.params.mode === "url" ? request.params.url : request.params.message;
        this.emit({ type: "elicit", id, message });
        this.emitAttention();
        return new Promise(resolve => {
          this.pendingElicits.set(id, { message, resolve });
        });
      });
      return client;
    })();
    return this.clientPromise;
  }

  /** Resolve an open elicitation: the browser's approve/deny becomes the answer. */
  answerElicit(id: string, decision: "approve_once" | "deny" | "decline"): boolean {
    const pending = this.pendingElicits.get(id);
    if (!pending) return false;
    this.pendingElicits.delete(id);
    this.emitAttention();
    pending.resolve(decision === "decline" ? { action: "decline" } : { action: "accept", content: { decision } });
    return true;
  }

  /** Wire run-change notifications from every engine into the event feed. */
  watch(): void {
    if (this.unwatch.length > 0) return;
    for (const info of this.options.registry.list()) {
      const entry = this.options.registry.entry(info.id)!;
      this.unwatch.push(entry.engine.onRunChanged(runId => {
        const run = runId === "*" ? undefined : entry.engine.listRuns(50).find(item => item.id === runId);
        if (run) this.emit({ type: "run", run: { title: run.title, status: run.status, assistant: info.label }, view: taskCard(run, info.label) });
        if (this.options.registry.pendingApprovals().length === 0) this.declineStaleElicits();
        this.emitAttention();
      }));
    }
  }

  private declineStaleElicits(): void {
    for (const [id, elicit] of this.pendingElicits) {
      this.pendingElicits.delete(id);
      elicit.resolve({ action: "decline" });
    }
  }

  close(): void {
    for (const unwatch of this.unwatch) unwatch();
    this.unwatch.length = 0;
    this.listeners.clear();
    void this.clientPromise?.then(client => client.close()).catch(() => undefined);
  }

  onEvent(listener: (event: SimEvent) => void): () => void {
    this.listeners.add(listener);
    // A page that (re)loads while an approval is open still needs the card.
    const latest = this.options.registry.latestRun();
    if (latest) {
      const label = this.options.registry.label(latest.runtimeId);
      listener({ type: "run", run: { title: latest.title, status: latest.status, assistant: label }, view: taskCard(latest, label) });
    }
    listener({ type: "attention", pending: this.attentionCount() });
    for (const [id, elicit] of this.pendingElicits) {
      listener({ type: "elicit", id, message: elicit.message });
    }
    return () => this.listeners.delete(listener);
  }

  private attentionCount(): number {
    return this.options.registry.pendingApprovals().length + this.pendingElicits.size;
  }

  private emitAttention(): void {
    this.emit({ type: "attention", pending: this.attentionCount() });
  }

  private emit(event: SimEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const client = await this.client();
    const result = await client.callTool({ name, arguments: args });
    const structured = structuredOf(result);
    const resourceUri = ((result as { _meta?: { ui?: { resourceUri?: unknown } } })._meta?.ui?.resourceUri);
    let ui: { resourceUri: string; html: string } | undefined;
    if (typeof resourceUri === "string" && resourceUri.startsWith("ui://")) {
      try {
        const resource = await client.readResource({ uri: resourceUri });
        const text = resource.contents.find(item => "text" in item && typeof item.text === "string");
        if (text && "text" in text) ui = { resourceUri, html: text.text };
      } catch {
        ui = { resourceUri, html: "" };
      }
    }
    return {
      speech: speechOf(result, structured),
      structuredContent: structured,
      ui,
      isError: (result as { isError?: boolean }).isError === true
    };
  }

  /** HTML of a ui:// resource so the page can show a view mid-run, before its tool returns. */
  async readResource(uri: string): Promise<{ resourceUri: string; html: string } | undefined> {
    if (!uri.startsWith("ui://")) return undefined;
    const client = await this.client();
    const resource = await client.readResource({ uri });
    const text = resource.contents.find(item => "text" in item && typeof item.text === "string");
    return text && "text" in text ? { resourceUri: uri, html: text.text } : undefined;
  }

  /** Static asset for GET /sim/…; index.html for the bare route. */
  asset(pathname: string): { body: Buffer; type: string } | undefined {
    const rel = pathname === "/sim" || pathname === "/sim/" ? "index.html" : pathname.replace(/^\/sim\//, "");
    if (rel.includes("..") || rel.startsWith("/")) return undefined;
    const file = join(this.options.assetsDir, rel);
    if (!existsSync(file)) return undefined;
    return { body: readFileSync(file), type: MIME[rel.slice(rel.lastIndexOf("."))] ?? "text/plain; charset=utf-8" };
  }
}
