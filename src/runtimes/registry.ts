import { ConversationEngine } from "../conversations.js";
import type { AppConfig, RuntimeConfigEntry } from "../config.js";
import { HermesClient, HermesConnection } from "../hermes.js";
import type { AmbientStore } from "../store.js";
import type { RunView, RuntimeState } from "../types.js";
import { GrokBotClient } from "./grokbot.js";
import { InstinctClient } from "./instinct.js";
import { MuseClient } from "./muse.js";
import { OpenClawClient, OpenClawConnection } from "./openclaw.js";
import { TownieClient } from "./townie.js";
import type { AssistantClient, ConnectorConnection, RuntimeDescriptor } from "./types.js";

export type RuntimeEntry = {
  descriptor: RuntimeDescriptor;
  client: AssistantClient;
  engine: ConversationEngine;
  start(): void;
  close(): Promise<void>;
  connector?: { token: string; connection: ConnectorConnection };
};

export type AssistantInfo = RuntimeDescriptor & {
  state: RuntimeState;
  selected: boolean;
};

const SELECTED_RUNTIME_KEY = "selected_runtime";

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

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

  latestRun(): RunView | undefined {
    const runs = [...this.entries.values()].flatMap(entry => entry.engine.listRuns(1));
    runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return runs[0];
  }

  connectors(): Map<string, { token: string; connection: ConnectorConnection }> {
    const map = new Map<string, { token: string; connection: ConnectorConnection }>();
    for (const entry of this.entries.values()) {
      if (entry.connector) map.set(entry.descriptor.id, entry.connector);
    }
    return map;
  }

  startAll(): void {
    for (const entry of this.entries.values()) entry.start();
  }

  async close(): Promise<void> {
    for (const entry of this.entries.values()) await entry.close();
  }
}

function hermesRuntime(item: RuntimeConfigEntry, env: Record<string, string | undefined>, store: AmbientStore): RuntimeEntry {
  const token = item.tokenEnv ? env[item.tokenEnv] : undefined;
  const connectorToken = item.connectorTokenEnv ? env[item.connectorTokenEnv] : undefined;
  if (!item.endpoint && !connectorToken) {
    throw new Error(`Runtime "${item.id}" needs an endpoint or ${item.connectorTokenEnv ?? "a connector token env"} to be reachable`);
  }
  const connection = new HermesConnection({
    url: item.endpoint ?? "ws://ambient-connector.invalid",
    ...(token ? { token } : {})
  });
  const client = new HermesClient(connection);
  const engine = new ConversationEngine(client, store, {
    runtime: { id: item.id, label: item.label, kind: item.kind, state: "unknown", updatedAt: new Date().toISOString() }
  });
  const discover = async () => {
    try {
      await engine.discover();
    } catch {
      engine.setRuntimeState("offline");
    }
  };
  let reconnect: NodeJS.Timeout | undefined;
  const start = item.endpoint
    ? () => {
        const connect = async () => {
          try {
            await connection.connect();
            await discover();
          } catch {
            engine.setRuntimeState("offline");
          }
        };
        void connect();
        reconnect = setInterval(() => {
          if (!connection.isConnected) void connect();
        }, 5_000);
        reconnect.unref();
      }
    : () => {
        connection.on("open", () => void discover());
      };
  return {
    descriptor: { id: item.id, label: item.label, kind: item.kind, adapter: "hermes", capabilities: client.capabilities },
    client,
    engine,
    start,
    close: async () => {
      if (reconnect) clearInterval(reconnect);
      engine.close();
      await connection.close();
    },
    ...(connectorToken ? { connector: { token: connectorToken, connection } } : {})
  };
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

function openclawRuntime(item: RuntimeConfigEntry, env: Record<string, string | undefined>, store: AmbientStore): RuntimeEntry {
  if (!item.endpoint) throw new Error(`Runtime "${item.id}" (openclaw) needs an endpoint, e.g. ws://127.0.0.1:18789`);
  const token = item.tokenEnv ? env[item.tokenEnv] : undefined;
  const connection = new OpenClawConnection({
    url: item.endpoint,
    ...(token ? { token } : {}),
    ...(numberOption(item, "requestTimeoutMs") ? { requestTimeoutMs: numberOption(item, "requestTimeoutMs")! } : {})
  });
  const client = new OpenClawClient(connection);
  const engine = engineFor(item, store, client);
  let reconnect: NodeJS.Timeout | undefined;
  const discover = () => {
    engine.discover().catch(() => undefined);
  };
  return entryFor(item, client, engine,
    () => {
      const connect = () => {
        connection.connect().then(discover).catch(() => engine.setRuntimeState("offline"));
      };
      connect();
      connection.on("open", discover);
      reconnect = setInterval(() => {
        if (!connection.isConnected) connect();
      }, 5_000);
      reconnect.unref();
    },
    async () => {
      if (reconnect) clearInterval(reconnect);
      engine.close();
      await connection.close();
    });
}

function grokbotRuntime(item: RuntimeConfigEntry, env: Record<string, string | undefined>, store: AmbientStore): RuntimeEntry {
  if (!item.endpoint) throw new Error(`Runtime "${item.id}" (grokbot) needs an endpoint, e.g. http://127.0.0.1:1340`);
  const client = new GrokBotClient({
    endpoint: item.endpoint,
    ...(item.tokenEnv && env[item.tokenEnv] ? { token: env[item.tokenEnv]! } : {}),
    ...(numberOption(item, "pollMs") ? { pollMs: numberOption(item, "pollMs")! } : {}),
    ...(numberOption(item, "timeoutMs") ? { timeoutMs: numberOption(item, "timeoutMs")! } : {})
  });
  return polledRuntime(item, env, store, client);
}

function museRuntime(item: RuntimeConfigEntry, env: Record<string, string | undefined>, store: AmbientStore): RuntimeEntry {
  const client = new MuseClient({
    ...(item.endpoint ? { endpoint: item.endpoint } : {}),
    ...(item.tokenEnv && env[item.tokenEnv] ? { token: env[item.tokenEnv]! } : {}),
    ...(item.options?.model ? { model: item.options.model } : {}),
    ...(numberOption(item, "timeoutMs") ? { timeoutMs: numberOption(item, "timeoutMs")! } : {})
  });
  return polledRuntime(item, env, store, client);
}

function townieRuntime(item: RuntimeConfigEntry, env: Record<string, string | undefined>, store: AmbientStore): RuntimeEntry {
  if (!item.endpoint) throw new Error(`Runtime "${item.id}" (townie) needs an endpoint, e.g. https://api.val.town/v1/run/<user>.<val>`);
  const client = new TownieClient({
    endpoint: item.endpoint,
    ...(item.tokenEnv && env[item.tokenEnv] ? { token: env[item.tokenEnv]! } : {}),
    ...(numberOption(item, "timeoutMs") ? { timeoutMs: numberOption(item, "timeoutMs")! } : {})
  });
  return polledRuntime(item, env, store, client);
}

function instinctRuntime(item: RuntimeConfigEntry, env: Record<string, string | undefined>, store: AmbientStore): RuntimeEntry {
  const to = item.options?.to;
  if (!to) throw new Error(`Runtime "${item.id}" (instinct) needs options.to — the assistant's email address`);
  const client = new InstinctClient({
    to,
    ...(item.tokenEnv && env[item.tokenEnv] ? { token: env[item.tokenEnv]! } : {}),
    ...(item.options?.gmailEndpoint ? { gmailEndpoint: item.options.gmailEndpoint } : {}),
    ...(numberOption(item, "pollMs") ? { pollMs: numberOption(item, "pollMs")! } : {}),
    ...(numberOption(item, "timeoutMs") ? { timeoutMs: numberOption(item, "timeoutMs")! } : {})
  });
  return polledRuntime(item, env, store, client);
}

const ADAPTERS: Record<string, (item: RuntimeConfigEntry, env: Record<string, string | undefined>, store: AmbientStore) => RuntimeEntry> = {
  hermes: hermesRuntime,
  openclaw: openclawRuntime,
  grokbot: grokbotRuntime,
  muse: museRuntime,
  townie: townieRuntime,
  instinct: instinctRuntime
};

export function buildRuntimeRegistry(
  config: Pick<AppConfig, "runtimes" | "defaultRuntimeId">,
  env: Record<string, string | undefined>,
  store: AmbientStore
): RuntimeRegistry {
  const entries = config.runtimes.map(item => {
    const factory = ADAPTERS[item.adapter];
    if (!factory) {
      throw new Error(`Assistant adapter "${item.adapter}" is not available; supported: ${Object.keys(ADAPTERS).join(", ")}`);
    }
    return factory(item, env, store);
  });
  return new RuntimeRegistry(store, entries, config.defaultRuntimeId);
}
