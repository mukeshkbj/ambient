import { ConversationEngine } from "../conversations.js";
import type { AppConfig, RuntimeConfigEntry } from "../config.js";
import { HermesClient, HermesConnection } from "../hermes.js";
import type { AmbientStore } from "../store.js";
import type { RunView, RuntimeState } from "../types.js";
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

export function buildRuntimeRegistry(
  config: Pick<AppConfig, "runtimes" | "defaultRuntimeId">,
  env: Record<string, string | undefined>,
  store: AmbientStore
): RuntimeRegistry {
  const entries = config.runtimes.map(item => {
    if (item.adapter !== "hermes") {
      throw new Error(`Assistant adapter "${item.adapter}" is not available in this build`);
    }
    return hermesRuntime(item, env, store);
  });
  return new RuntimeRegistry(store, entries, config.defaultRuntimeId);
}
