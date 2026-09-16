import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Approval, Conversation, Run, RunStatus, Runtime, RuntimeId, RuntimeState, RunView } from "./types.js";

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
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

function run(row: Row): Run {
  return {
    id: text(row.id),
    conversationId: text(row.conversation_id),
    runtimeId: text(row.runtime_id),
    durableSessionId: text(row.durable_session_id),
    liveSessionId: text(row.live_session_id),
    instruction: text(row.instruction),
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
        request_id TEXT NOT NULL UNIQUE,
        command TEXT NOT NULL,
        description TEXT,
        choices_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS runs_live_session_idx ON runs(live_session_id, status);
      CREATE INDEX IF NOT EXISTS approvals_open_idx ON approvals(runtime_id, resolved_at);
    `);
    this.purge(retentionDays);
  }

  close(): void {
    this.db.close();
  }

  clearLiveSessionIds(runtimeId: RuntimeId): void {
    this.db.prepare("UPDATE conversations SET live_session_id = NULL WHERE runtime_id = ?").run(runtimeId);
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
        (id, conversation_id, runtime_id, durable_session_id, live_session_id, instruction, status,
         answer, progress, failure, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id,
      value.conversationId,
      value.runtimeId,
      value.durableSessionId,
      value.liveSessionId,
      value.instruction,
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

  markActiveRunsUnknown(runtimeId: RuntimeId, updatedAt: string): void {
    this.db.prepare(`
      UPDATE runs SET status = 'unknown', progress = ?, updated_at = ?
      WHERE runtime_id = ?
        AND status IN ('queued', 'accepted', 'running', 'waiting_approval', 'cancel_requested')
    `).run("Hermes disconnected; the work outcome is unknown", updatedAt, runtimeId);
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
    this.db.prepare(`
      UPDATE runs SET status = ?, answer = ?, progress = ?, failure = ?, live_session_id = ?, updated_at = ?
      WHERE id = ?
    `).run(
      changes.status ?? current.status,
      changes.answer === undefined ? current.answer ?? null : changes.answer,
      changes.progress === undefined ? current.progress ?? null : changes.progress,
      changes.failure === undefined ? current.failure ?? null : changes.failure,
      changes.liveSessionId ?? current.liveSessionId,
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
      ON CONFLICT(request_id) DO UPDATE SET command = excluded.command,
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

  approval(requestId: string): Approval | undefined {
    const row = this.db.prepare("SELECT * FROM approvals WHERE request_id = ?").get(requestId) as Row | undefined;
    return row ? approval(row) : undefined;
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

  resolveApproval(requestId: string, resolvedAt: string): Approval | undefined {
    this.db.prepare("UPDATE approvals SET resolved_at = ? WHERE request_id = ? AND resolved_at IS NULL")
      .run(resolvedAt, requestId);
    return this.approval(requestId);
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
    return pending ? { ...value, approval: pending } : value;
  }
}
