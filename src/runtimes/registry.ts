import { ConversationEngine } from "../conversations.js";
import type { AppConfig, RuntimeConfigEntry } from "../config.js";
import type { AmbientStore } from "../store.js";
import type { Approval, RunView, RuntimeState } from "../types.js";
import Anthropic from "@anthropic-ai/sdk";
import { claudeBrain, scriptedBrain } from "../calls/brain.js";
import { AROUND, DEMO_SCRIPT, JOES_PLUMBING, JOES_PLUMBING_HANGS_UP } from "../calls/demo.js";
import { discoverBusiness } from "../calls/discover.js";
import { simulatedLine } from "../calls/line.js";
import { parsePhoneNumber } from "../calls/types.js";
import { readHousehold, type Household } from "../household.js";
import { CallerClient } from "./caller.js";
import type { CallRooms } from "../calls/rooms.js";
import type { AssistantClient, RuntimeDescriptor } from "./types.js";

export type RuntimeEntry = {
  descriptor: RuntimeDescriptor;
  client: AssistantClient;
  engine: ConversationEngine;
  start(): void;
  close(): Promise<void>;
};

export type AssistantInfo = RuntimeDescriptor & {
  state: RuntimeState;
  selected: boolean;
};

const SELECTED_RUNTIME_KEY = "selected_runtime";

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Words people say around a task name that carry no matching signal.
const STOPWORDS = new Set([
  "the", "a", "an", "my", "to", "of", "for", "on", "in", "it", "its", "that", "this", "task", "work",
  "job", "thing", "about", "agent", "agents", "assistant", "assistants", "please", "can", "could", "you",
  "what", "whats", "what's", "is", "are", "any", "status", "did", "do", "does", "me", "with", "and", "or"
]);

function keywords(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter(token => token && !STOPWORDS.has(token)))];
}

/** Count of query tokens that match a token of the candidate text (prefix either way). */
function score(text: string, tokens: string[]): number {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.filter(token => words.some(word => word.startsWith(token) || token.startsWith(word))).length;
}

export type PendingApproval = {
  approval: Approval;
  entry: RuntimeEntry;
};

export type ApprovalMatch = {
  match?: PendingApproval;
  candidates: PendingApproval[];
};

export class RuntimeRegistry {
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly defaultId: string;

  constructor(
    private readonly store: AmbientStore,
    entries: RuntimeEntry[],
    defaultId?: string
  ) {
    for (const entry of entries) {
      if (this.entries.has(entry.descriptor.id)) throw new Error(`Duplicate runtime id "${entry.descriptor.id}"`);
      this.entries.set(entry.descriptor.id, entry);
    }
    if (this.entries.size === 0) throw new Error("At least one assistant runtime is required");
    this.defaultId = defaultId && this.entries.has(defaultId) ? defaultId : entries[0]!.descriptor.id;
  }

  list(): AssistantInfo[] {
    const selected = this.selectedId();
    return [...this.entries.values()].map(entry => ({
      ...entry.descriptor,
      state: entry.engine.runtime().state,
      selected: entry.descriptor.id === selected
    }));
  }

  selectedId(): string {
    const sticky = this.store.getMeta(SELECTED_RUNTIME_KEY);
    return sticky && this.entries.has(sticky) ? sticky : this.defaultId;
  }

  entry(runtimeId: string): RuntimeEntry | undefined {
    return this.entries.get(runtimeId);
  }

  resolve(query?: string): RuntimeEntry {
    const needle = query?.trim();
    if (!needle) return this.entries.get(this.selectedId())!;
    const wanted = normalize(needle);
    const all = [...this.entries.values()];
    const match = all.find(entry => normalize(entry.descriptor.id) === wanted)
      ?? all.find(entry => normalize(entry.descriptor.label) === wanted)
      ?? all.find(entry => normalize(entry.descriptor.id).startsWith(wanted) || normalize(entry.descriptor.label).startsWith(wanted))
      ?? all.find(entry => normalize(entry.descriptor.label).includes(wanted) || wanted.includes(normalize(entry.descriptor.id)));
    if (!match) {
      const names = all.map(entry => entry.descriptor.label).join(", ");
      throw new Error(`Unknown assistant "${needle}". Available: ${names}.`);
    }
    return match;
  }

  select(query: string): RuntimeEntry {
    const entry = this.resolve(query);
    this.store.setMeta(SELECTED_RUNTIME_KEY, entry.descriptor.id);
    return entry;
  }

  label(runtimeId: string): string {
    return this.entries.get(runtimeId)?.descriptor.label ?? runtimeId;
  }

  engineForRun(runId: string): ConversationEngine {
    const run = this.store.run(runId);
    const entry = run ? this.entries.get(run.runtimeId) : undefined;
    if (!entry) throw new Error("Work item not found");
    return entry.engine;
  }

  engineForConversation(conversationId: string): ConversationEngine {
    const conversation = this.store.conversation(conversationId);
    const entry = conversation ? this.entries.get(conversation.runtimeId) : undefined;
    if (!entry) throw new Error("Conversation not found");
    return entry.engine;
  }

  engineForApproval(approvalId: string): ConversationEngine {
    const approval = this.store.approvalById(approvalId);
    // Approval ids are namespaced `${runtimeId}:${requestId}` — the prefix still routes
    // when the row is gone (e.g. stale id surfaced by a client).
    const runtimeId = approval?.runtimeId ?? approvalId.split(":")[0];
    const entry = runtimeId ? this.entries.get(runtimeId) : undefined;
    if (!entry) throw new Error("Approval is no longer pending");
    return entry.engine;
  }

  runtimeIds(): string[] {
    return [...this.entries.keys()];
  }

  /** Recent runs across every runtime, newest first — one store query. */
  recentRuns(limit = 25, since?: string): RunView[] {
    return this.store.recentRunViews(this.runtimeIds(), limit, since);
  }

  latestRun(): RunView | undefined {
    return this.recentRuns(1)[0];
  }

  /** The run that most needs a human right now: something waiting on an approval. */
  needsAttention(): RunView | undefined {
    return this.recentRuns(50).find(run => run.status === "waiting_approval");
  }

  /**
   * Fuzzy-find a run by words from its title or instruction — "the dinner
   * booking" finds "Book Lupa for four…". Newest wins on a tie.
   */
  findRun(about: string): RunView | undefined {
    const tokens = keywords(about);
    if (tokens.length === 0) return undefined;
    let best: RunView | undefined;
    let bestScore = 0;
    for (const run of this.recentRuns(50)) {
      const matched = score(`${run.title} ${run.instruction}`, tokens);
      if (matched > bestScore) {
        best = run;
        bestScore = matched;
      }
    }
    return best;
  }

  /** Open approvals across every runtime, with the owning entry attached. */
  pendingApprovals(): PendingApproval[] {
    return this.store.openApprovals(this.runtimeIds()).flatMap(approval => {
      const entry = this.entries.get(approval.runtimeId);
      return entry ? [{ approval, entry }] : [];
    });
  }

  /**
   * Resolve which pending approval "about" refers to. No query matches only
   * when exactly one is pending; several plausible matches stay ambiguous.
   */
  findApproval(about?: string): ApprovalMatch {
    const candidates = this.pendingApprovals();
    const tokens = about?.trim() ? keywords(about) : [];
    if (tokens.length === 0) {
      const only = candidates[0];
      return candidates.length === 1 && only ? { match: only, candidates } : { candidates };
    }
    let best: PendingApproval | undefined;
    let bestScore = 0;
    let tied = false;
    for (const candidate of candidates) {
      const run = this.store.run(candidate.approval.runId);
      const matched = score(
        `${candidate.approval.command} ${candidate.approval.description ?? ""} ${run?.title ?? ""} ${run?.instruction ?? ""}`,
        tokens
      );
      if (matched > bestScore) {
        best = candidate;
        bestScore = matched;
        tied = false;
      } else if (matched === bestScore && matched > 0) {
        tied = true;
      }
    }
    return best && !tied ? { match: best, candidates } : { candidates };
  }

  meta(key: string): string | undefined {
    return this.store.getMeta(key);
  }

  setMeta(key: string, value: string): void {
    this.store.setMeta(key, value);
  }

  startAll(): void {
    for (const entry of this.entries.values()) {
      // A restarted process can't have verified in-flight work: anything left
      // active in the store is stale until discovery/replay re-establishes it.
      this.store.markActiveRunsUnknown(entry.descriptor.id, new Date().toISOString(),
        "Ambient restarted before this work finished; the outcome is unknown");
      entry.start();
    }
  }

  async close(): Promise<void> {
    for (const entry of this.entries.values()) await entry.close();
  }
}

type ClosableClient = AssistantClient & { close?(): void | Promise<void> };

function engineFor(item: RuntimeConfigEntry, store: AmbientStore, client: ClosableClient): ConversationEngine {
  return new ConversationEngine(client, store, {
    runtime: { id: item.id, label: item.label, kind: item.kind, state: "unknown", updatedAt: new Date().toISOString() }
  });
}

function entryFor(
  item: RuntimeConfigEntry,
  client: ClosableClient,
  engine: ConversationEngine,
  start: () => void,
  close: () => Promise<void>
): RuntimeEntry {
  return {
    descriptor: { id: item.id, label: item.label, kind: item.kind, adapter: item.adapter, capabilities: client.capabilities },
    client,
    engine,
    start,
    close
  };
}

function numberOption(item: RuntimeConfigEntry, name: string): number | undefined {
  const raw = item.options?.[name];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Runtime "${item.id}" option "${name}" must be a positive number`);
  return value;
}

/** Poll-free adapters: a discovery pass on start plus a re-check every 30s keeps /healthz honest. */
function polledRuntime(item: RuntimeConfigEntry, env: Record<string, string | undefined>, store: AmbientStore, client: ClosableClient): RuntimeEntry {
  const engine = engineFor(item, store, client);
  let timer: NodeJS.Timeout | undefined;
  const discover = () => {
    engine.discover().catch(() => undefined);
  };
  return entryFor(item, client, engine,
    () => {
      discover();
      timer = setInterval(discover, 30_000);
      timer.unref();
    },
    async () => {
      if (timer) clearInterval(timer);
      engine.close();
      await client.close?.();
    });
}

export type RuntimeServices = { rooms?: CallRooms };

function callerRuntime(item: RuntimeConfigEntry, env: Record<string, string | undefined>, store: AmbientStore, services: RuntimeServices): RuntimeEntry {
  const option = (name: string) => item.options?.[name];
  const lineKind = option("line") ?? "simulated";
  if (lineKind !== "simulated" && lineKind !== "assemblyai") throw new Error(`Runtime "${item.id}" line "${lineKind}" is not available; supported: simulated, assemblyai`);
  const rooms = services.rooms;
  if (lineKind === "assemblyai" && !rooms) throw new Error(`Runtime "${item.id}" line "assemblyai" needs ASSEMBLYAI_API_KEY and an https PUBLIC_BASE_URL`);
  const persona = option("persona") === "hangs-up" ? JOES_PLUMBING_HANGS_UP : JOES_PLUMBING;
  const speedMs = numberOption(item, "speedMs");
  const brainKind = option("brain") ?? "scripted";
  if (brainKind !== "scripted" && brainKind !== "claude") throw new Error(`Runtime "${item.id}" brain "${brainKind}" is not available; supported: scripted, claude`);
  const anthropic = brainKind === "claude" ? new Anthropic() : undefined;
  const brain = anthropic
    ? claudeBrain({
        stream: (request, options) => anthropic.beta.messages.stream(request, options),
        model: option("model") ?? env.CALLER_MODEL ?? "claude-opus-5-5",
        fallbacks: true
      })
    : scriptedBrain(DEMO_SCRIPT);
  const client = new CallerClient({
    household: readHousehold(env.AMBIENT_HOUSEHOLD_FILE ?? "household.example.json"),
    business: { name: option("business") ?? persona.name, phone: parsePhoneNumber(option("phone") ?? "+14155550134") },
    line: business => (rooms && lineKind === "assemblyai" ? rooms.line() : simulatedLine(AROUND.find(item => item.persona.name === business.name)?.persona ?? persona, speedMs !== undefined ? { speedMs } : {})),
    brain,
    memory: store,
    limitDials: lineKind !== "simulated",
    ...(anthropic
      ? { discover: (goal: string, household: Household) => discoverBusiness(params => anthropic.messages.create(params), goal, household) }
      : lineKind === "simulated" ? { discover: () => Promise.resolve(AROUND.map(item => item.candidate)) } : {})
  });
  return polledRuntime(item, env, store, client);
}

const ADAPTERS: Record<string, (item: RuntimeConfigEntry, env: Record<string, string | undefined>, store: AmbientStore, services: RuntimeServices) => RuntimeEntry> = {
  caller: callerRuntime
};

export function buildRuntimeRegistry(
  config: Pick<AppConfig, "runtimes" | "defaultRuntimeId"> & { dataDir?: string },
  env: Record<string, string | undefined>,
  store: AmbientStore,
  services: RuntimeServices = {}
): RuntimeRegistry {
  const entries = config.runtimes.map(item => {
    const factory = ADAPTERS[item.adapter];
    if (!factory) {
      throw new Error(`Assistant adapter "${item.adapter}" is not available; supported: ${Object.keys(ADAPTERS).join(", ")}`);
    }
    return factory(item, env, store, services);
  });
  return new RuntimeRegistry(store, entries, config.defaultRuntimeId);
}
