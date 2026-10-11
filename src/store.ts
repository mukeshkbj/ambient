import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Approval, Conversation, Run, RunStatus, Runtime, RuntimeId, RuntimeState, RunView } from "./types.js";

type Row = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  return "";
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean {
  return Number(value) === 1;
}

function conversation(row: Row): Conversation {
  return {
    id: text(row.id),
    runtimeId: text(row.runtime_id),
    durableSessionId: text(row.durable_session_id),
    title: text(row.title),
    ...(optionalText(row.live_session_id) ? { liveSessionId: text(row.live_session_id) } : {}),
    selected: booleanValue(row.selected),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at)
  };
}

function stepsList(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function run(row: Row): Run {
  return {
    id: text(row.id),
    conversationId: text(row.conversation_id),
    runtimeId: text(row.runtime_id),
    durableSessionId: text(row.durable_session_id),
    liveSessionId: text(row.live_session_id),
    instruction: text(row.instruction),
    ...(optionalText(row.title) ? { title: text(row.title) } : {}),
    steps: stepsList(row.steps_json),
    status: text(row.status) as RunStatus,
    ...(optionalText(row.answer) ? { answer: text(row.answer) } : {}),
    ...(optionalText(row.progress) ? { progress: text(row.progress) } : {}),
    ...(optionalText(row.failure) ? { failure: text(row.failure) } : {}),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at)
  };
}

function approval(row: Row): Approval {
  const choices = JSON.parse(text(row.choices_json)) as unknown;
  return {
    id: text(row.id),
    runId: text(row.run_id),
    runtimeId: text(row.runtime_id),
    durableSessionId: text(row.durable_session_id),
    liveSessionId: text(row.live_session_id),
    requestId: text(row.request_id),
    command: text(row.command),
    ...(optionalText(row.description) ? { description: text(row.description) } : {}),
    choices: Array.isArray(choices) ? choices.filter((value): value is string => typeof value === "string") : [],
    createdAt: text(row.created_at),
    ...(optionalText(row.resolved_at) ? { resolvedAt: text(row.resolved_at) } : {})
  };
}

export type NewConversation = Omit<Conversation, "selected" | "createdAt" | "updatedAt"> & {
  selected?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NewRun = Omit<Run, "status" | "createdAt" | "updatedAt"> & {
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
};

export type TranscriptEntry = {
  seq: number;
  role: string;
  json: string;
};

export class AmbientStore {
  private readonly db: DatabaseSync;

  constructor(path = ":memory:", retentionDays = 30) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runtimes (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        runtime_id TEXT NOT NULL,
        durable_session_id TEXT NOT NULL,
        title TEXT NOT NULL,
        live_session_id TEXT,
        selected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(runtime_id, durable_session_id)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        durable_session_id TEXT NOT NULL,
        live_session_id TEXT NOT NULL,
        instruction TEXT NOT NULL,
        title TEXT,
        steps_json TEXT,
        status TEXT NOT NULL,
        answer TEXT,
        progress TEXT,
        failure TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        durable_session_id TEXT NOT NULL,
        live_session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        command TEXT NOT NULL,
        description TEXT,
        choices_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        UNIQUE(runtime_id, request_id)
      );
      CREATE INDEX IF NOT EXISTS runs_live_session_idx ON runs(live_session_id, status);
      CREATE INDEX IF NOT EXISTS approvals_open_idx ON approvals(runtime_id, resolved_at);
      CREATE TABLE IF NOT EXISTS transcripts (
        runtime_id TEXT NOT NULL,
        durable_session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (runtime_id, durable_session_id, seq)
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.migrate();
    this.purge(retentionDays);
  }

  close(): void {
    this.db.close();
  }

  clearLiveSessionIds(runtimeId: RuntimeId): void {
    this.db.prepare("UPDATE conversations SET live_session_id = NULL WHERE runtime_id = ?").run(runtimeId);
  }

  private migrate(): void {
    this.migrateRuns();
    this.migrateApprovals();
  }

  private migrateRuns(): void {
    const columns = new Set(
      (this.db.prepare("SELECT name FROM pragma_table_info('runs')").all() as Row[]).map(column => text(column.name))
    );
    if (!columns.has("title")) this.db.exec("ALTER TABLE runs ADD COLUMN title TEXT");
    if (!columns.has("steps_json")) this.db.exec("ALTER TABLE runs ADD COLUMN steps_json TEXT");
  }

  // approvals.request_id used to carry a global UNIQUE constraint, which breaks
  // once two runtimes can raise the same request id. Rebuild the table when a
  // single-column index on request_id survives from an older schema.
  private migrateApprovals(): void {
    const indexes = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'approvals'").all() as Row[];
    const stale = indexes.some(index => {
      const columns = this.db.prepare("SELECT name FROM pragma_index_info(?)").all(text(index.name)) as Row[];
      return columns.length === 1 && text(columns[0]!.name) === "request_id";
    });
    if (!stale) return;
    this.db.exec(`
      BEGIN;
      CREATE TABLE approvals_next (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        durable_session_id TEXT NOT NULL,
        live_session_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        command TEXT NOT NULL,
        description TEXT,
        choices_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        UNIQUE(runtime_id, request_id)
      );
      INSERT INTO approvals_next SELECT * FROM approvals;
      DROP TABLE approvals;
      ALTER TABLE approvals_next RENAME TO approvals;
      CREATE INDEX approvals_open_idx ON approvals(runtime_id, resolved_at);
      COMMIT;
    `);
  }

  private purge(retentionDays: number): void {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1_000).toISOString();
    this.db.prepare("DELETE FROM approvals WHERE resolved_at IS NOT NULL AND resolved_at < ?").run(cutoff);
    this.db.prepare("DELETE FROM runs WHERE status IN ('completed', 'failed', 'cancelled') AND updated_at < ?").run(cutoff);
  }

  upsertRuntime(value: Runtime): void {
    this.db.prepare(`
      INSERT INTO runtimes (id, label, kind, state, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET label = excluded.label, kind = excluded.kind,
        state = excluded.state, updated_at = excluded.updated_at
    `).run(value.id, value.label, value.kind, value.state, value.updatedAt);
  }

  runtime(id: RuntimeId): Runtime | undefined {
    const row = this.db.prepare("SELECT * FROM runtimes WHERE id = ?").get(id) as Row | undefined;
    if (!row) return undefined;
    return {
      id: text(row.id),
      label: text(row.label),
      kind: text(row.kind) as Runtime["kind"],
      state: text(row.state) as RuntimeState,
      updatedAt: text(row.updated_at)
    };
  }

  createConversation(value: NewConversation): Conversation {
    if (value.selected) this.db.prepare("UPDATE conversations SET selected = 0 WHERE runtime_id = ?").run(value.runtimeId);
    this.db.prepare(`
      INSERT INTO conversations
        (id, runtime_id, durable_session_id, title, live_session_id, selected, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.runtimeId,
      value.durableSessionId,
      value.title,
      value.liveSessionId ?? null,
      value.selected ? 1 : 0,
      value.createdAt,
      value.updatedAt
    );
    return this.conversation(value.id)!;
  }

  conversation(id: string): Conversation | undefined {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Row | undefined;
    return row ? conversation(row) : undefined;
  }

  conversationByDurable(runtimeId: RuntimeId, durableSessionId: string): Conversation | undefined {
    const row = this.db.prepare("SELECT * FROM conversations WHERE runtime_id = ? AND durable_session_id = ?")
      .get(runtimeId, durableSessionId) as Row | undefined;
    return row ? conversation(row) : undefined;
  }

  selectedConversation(runtimeId: RuntimeId): Conversation | undefined {
    const row = this.db.prepare(
      "SELECT * FROM conversations WHERE runtime_id = ? AND selected = 1 ORDER BY updated_at DESC LIMIT 1"
    ).get(runtimeId) as Row | undefined;
    return row ? conversation(row) : undefined;
  }

  listConversations(runtimeId: RuntimeId): Conversation[] {
    const rows = this.db.prepare(
      "SELECT * FROM conversations WHERE runtime_id = ? ORDER BY selected DESC, updated_at DESC"
    ).all(runtimeId) as Row[];
    return rows.map(conversation);
  }

  updateConversation(id: string, changes: {
    durableSessionId?: string;
    title?: string;
    liveSessionId?: string | null;
    selected?: boolean;
    updatedAt: string;
  }): Conversation {
    const current = this.conversation(id);
    if (!current) throw new Error(`Conversation ${id} not found`);
    if (changes.selected) {
      this.db.prepare("UPDATE conversations SET selected = 0 WHERE runtime_id = ?").run(current.runtimeId);
    }
    this.db.prepare(`
      UPDATE conversations SET durable_session_id = ?, title = ?, live_session_id = ?,
        selected = ?, updated_at = ? WHERE id = ?
    `).run(
      changes.durableSessionId ?? current.durableSessionId,
      changes.title ?? current.title,
      changes.liveSessionId === undefined ? current.liveSessionId ?? null : changes.liveSessionId,
      changes.selected === undefined ? (current.selected ? 1 : 0) : changes.selected ? 1 : 0,
      changes.updatedAt,
      id
    );
    return this.conversation(id)!;
  }

  createRun(value: NewRun): Run {
    this.db.prepare(`
      INSERT INTO runs
        (id, conversation_id, runtime_id, durable_session_id, live_session_id, instruction, title, steps_json,
         status, answer, progress, failure, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.conversationId,
      value.runtimeId,
      value.durableSessionId,
      value.liveSessionId,
      value.instruction,
      value.title ?? null,
      JSON.stringify(value.steps ?? []),
      value.status,
      value.answer ?? null,
      value.progress ?? null,
      value.failure ?? null,
      value.createdAt,
      value.updatedAt
    );
    return this.run(value.id)!;
  }

  run(id: string): Run | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    return row ? run(row) : undefined;
  }

  listRuns(runtimeId: RuntimeId, limit = 20): Run[] {
    const rows = this.db.prepare(
      "SELECT * FROM runs WHERE runtime_id = ? ORDER BY updated_at DESC LIMIT ?"
    ).all(runtimeId, limit) as Row[];
    return rows.map(run);
  }

  private placeholders(count: number): string {
    return Array.from({ length: count }, () => "?").join(", ");
  }

  /** Latest runs across runtimes in one query — no per-runtime fan-out. */
  recentRuns(runtimeIds: RuntimeId[], limit = 25, since?: string): Run[] {
    if (runtimeIds.length === 0) return [];
    const clause = `runtime_id IN (${this.placeholders(runtimeIds.length)})`;
    const rows = since
      ? this.db.prepare(`SELECT * FROM runs WHERE ${clause} AND updated_at >= ? ORDER BY updated_at DESC LIMIT ?`)
        .all(...runtimeIds, since, limit) as Row[]
      : this.db.prepare(`SELECT * FROM runs WHERE ${clause} ORDER BY updated_at DESC LIMIT ?`)
        .all(...runtimeIds, limit) as Row[];
    return rows.map(run);
  }

  /** Every open approval for a set of runtimes, in one query. */
  openApprovals(runtimeIds: RuntimeId[]): Approval[] {
    if (runtimeIds.length === 0) return [];
    const rows = this.db.prepare(`
      SELECT * FROM approvals WHERE resolved_at IS NULL
        AND runtime_id IN (${this.placeholders(runtimeIds.length)}) ORDER BY created_at
    `).all(...runtimeIds) as Row[];
    return rows.map(approval);
  }

  /** Runs with their pending approvals attached, without a per-run lookup. */
  recentRunViews(runtimeIds: RuntimeId[], limit = 25, since?: string): RunView[] {
    const runs = this.recentRuns(runtimeIds, limit, since);
    const pending = this.openApprovals(runtimeIds);
    const byRun = new Map<string, Approval>();
    for (const item of pending) if (!byRun.has(item.runId)) byRun.set(item.runId, item);
    return runs.map(value => this.asView(value, byRun.get(value.id)));
  }

  private asView(value: Run, pending?: Approval): RunView {
    return {
      ...value,
      title: value.title ?? value.instruction,
      steps: value.steps ?? [],
      ...(pending ? { approval: pending } : {})
    };
  }

  activeRunByLiveSession(runtimeId: RuntimeId, liveSessionId: string): Run | undefined {
    const row = this.db.prepare(`
      SELECT * FROM runs WHERE runtime_id = ? AND live_session_id = ?
        AND status IN ('queued', 'accepted', 'running', 'waiting_approval', 'cancel_requested', 'unknown')
      ORDER BY created_at DESC LIMIT 1
    `).get(runtimeId, liveSessionId) as Row | undefined;
    return row ? run(row) : undefined;
  }

  activeRunForConversation(runtimeId: RuntimeId, conversationId: string): Run | undefined {
    const row = this.db.prepare(`
      SELECT * FROM runs WHERE runtime_id = ? AND conversation_id = ?
        AND status IN ('queued', 'accepted', 'running', 'waiting_approval', 'cancel_requested', 'unknown')
      ORDER BY created_at DESC LIMIT 1
    `).get(runtimeId, conversationId) as Row | undefined;
    return row ? run(row) : undefined;
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as Row | undefined;
    return row ? text(row.value) : undefined;
  }

  setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  markActiveRunsUnknown(runtimeId: RuntimeId, updatedAt: string, message: string): void {
    this.db.prepare(`
      UPDATE runs SET status = 'unknown', progress = ?, updated_at = ?
      WHERE runtime_id = ?
        AND status IN ('queued', 'accepted', 'running', 'waiting_approval', 'cancel_requested')
    `).run(message, updatedAt, runtimeId);
  }

  markUnknownRunsRunning(runtimeId: RuntimeId, conversationId: string, updatedAt: string): void {
    this.db.prepare(`
      UPDATE runs SET status = 'running', updated_at = ?
      WHERE runtime_id = ? AND conversation_id = ? AND status = 'unknown'
    `).run(updatedAt, runtimeId, conversationId);
  }

  rebindActiveRuns(runtimeId: RuntimeId, conversationId: string, liveSessionId: string, updatedAt: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`
        UPDATE runs SET live_session_id = ?, updated_at = ?
        WHERE runtime_id = ? AND conversation_id = ?
          AND status IN ('queued', 'accepted', 'running', 'waiting_approval', 'cancel_requested', 'unknown')
      `).run(liveSessionId, updatedAt, runtimeId, conversationId);
      this.db.prepare(`
        UPDATE approvals SET live_session_id = ?
        WHERE runtime_id = ? AND run_id IN (SELECT id FROM runs WHERE conversation_id = ?) AND resolved_at IS NULL
      `).run(liveSessionId, runtimeId, conversationId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  updateRun(id: string, changes: {
    status?: RunStatus;
    answer?: string | null;
    progress?: string | null;
    failure?: string | null;
    liveSessionId?: string;
    updatedAt: string;
  }): Run {
    const current = this.run(id);
    if (!current) throw new Error(`Run ${id} not found`);
    const progress = changes.progress === undefined ? current.progress : changes.progress ?? undefined;
    // Keep a bounded step history so task views can show what the agent has done.
    const steps = progress && progress !== current.progress
      ? [...(current.steps ?? []), progress].slice(-30)
      : current.steps ?? [];
    this.db.prepare(`
      UPDATE runs SET status = ?, answer = ?, progress = ?, failure = ?, live_session_id = ?, steps_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      changes.status ?? current.status,
      changes.answer === undefined ? current.answer ?? null : changes.answer,
      progress ?? null,
      changes.failure === undefined ? current.failure ?? null : changes.failure,
      changes.liveSessionId ?? current.liveSessionId,
      JSON.stringify(steps),
      changes.updatedAt,
      id
    );
    return this.run(id)!;
  }

  createOrUpdateApproval(value: Approval): Approval {
    this.db.prepare(`
      INSERT INTO approvals
        (id, run_id, runtime_id, durable_session_id, live_session_id, request_id, command,
         description, choices_json, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(runtime_id, request_id) DO UPDATE SET command = excluded.command,
        description = excluded.description, choices_json = excluded.choices_json, resolved_at = NULL
    `).run(
      value.id,
      value.runId,
      value.runtimeId,
      value.durableSessionId,
      value.liveSessionId,
      value.requestId,
      value.command,
      value.description ?? null,
      JSON.stringify(value.choices),
      value.createdAt,
      value.resolvedAt ?? null
    );
    return this.approvalForRuntime(value.runtimeId, value.requestId)!;
  }

  approvalForRuntime(runtimeId: RuntimeId, requestId: string): Approval | undefined {
    const row = this.db.prepare("SELECT * FROM approvals WHERE runtime_id = ? AND request_id = ?").get(runtimeId, requestId) as Row | undefined;
    return row ? approval(row) : undefined;
  }

  approvalById(id: string): Approval | undefined {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Row | undefined;
    return row ? approval(row) : undefined;
  }

  listApprovals(runtimeId: RuntimeId): Approval[] {
    const rows = this.db.prepare(
      "SELECT * FROM approvals WHERE runtime_id = ? AND resolved_at IS NULL ORDER BY created_at"
    ).all(runtimeId) as Row[];
    return rows.map(approval);
  }

  resolveApprovalForRuntime(runtimeId: RuntimeId, requestId: string, resolvedAt: string): Approval | undefined {
    this.db.prepare("UPDATE approvals SET resolved_at = ? WHERE runtime_id = ? AND request_id = ? AND resolved_at IS NULL")
      .run(resolvedAt, runtimeId, requestId);
    return this.approvalForRuntime(runtimeId, requestId);
  }

  resolveApprovalsForRun(runId: string, resolvedAt: string): void {
    this.db.prepare("UPDATE approvals SET resolved_at = ? WHERE run_id = ? AND resolved_at IS NULL")
      .run(resolvedAt, runId);
  }

  view(runId: string): RunView | undefined {
    const value = this.run(runId);
    if (!value) return undefined;
    const pending = this.listApprovals(value.runtimeId).find(item => item.runId === runId);
    return this.asView(value, pending);
  }

  appendTranscript(runtimeId: RuntimeId, durableSessionId: string, role: string, json: string): void {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM transcripts WHERE runtime_id = ? AND durable_session_id = ?"
    ).get(runtimeId, durableSessionId) as Row;
    this.db.prepare(
      "INSERT INTO transcripts (runtime_id, durable_session_id, seq, role, json) VALUES (?, ?, ?, ?, ?)"
    ).run(runtimeId, durableSessionId, Number(row.next), role, json);
  }

  transcript(runtimeId: RuntimeId, durableSessionId: string): TranscriptEntry[] {
    const rows = this.db.prepare(
      "SELECT seq, role, json FROM transcripts WHERE runtime_id = ? AND durable_session_id = ? ORDER BY seq"
    ).all(runtimeId, durableSessionId) as Row[];
    return rows.map(row => ({ seq: Number(row.seq), role: text(row.role), json: text(row.json) }));
  }

  listTranscriptSessions(runtimeId: RuntimeId): string[] {
    const rows = this.db.prepare(`
      SELECT durable_session_id, MAX(seq) AS last FROM transcripts
      WHERE runtime_id = ? GROUP BY durable_session_id ORDER BY last DESC
    `).all(runtimeId) as Row[];
    return rows.map(row => text(row.durable_session_id));
  }
}
