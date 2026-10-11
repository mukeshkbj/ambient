import { randomUUID } from "node:crypto";
import {
  AssistantEvented,
  type ActiveSession,
  type AssistantClient,
  type AssistantSession,
  type RuntimeCapabilities,
  type SavedSession
} from "./types.js";

export type DemoClientOptions = {
  /** Force one script for every prompt: planner | research | deploy | fail | echo. */
  script?: string;
  /** Milliseconds between scripted steps. Keep small in tests. */
  speedMs?: number;
};

type PendingApproval = {
  requestId: string;
  command: string;
  description: string;
  resolve(choice: string): void;
};

type DemoSession = {
  id: string;
  durableId: string;
  title: string;
  timers: NodeJS.Timeout[];
  working: boolean;
  aborted: boolean;
  pending?: PendingApproval | undefined;
};

type Step = { text?: string; waitApproval?: PendingApprovalSeed; goOffline?: boolean; done?: { text: string; status?: "ok" | "error" } };
type PendingApprovalSeed = { command: string; description: string };

function scriptFor(instruction: string, forced?: string): Step[] {
  const text = instruction.toLowerCase();
  const kind = forced === "planner" || forced === "research"
    ? forced
    : /deploy|ship|release/.test(text) ? "deploy"
      : /book|table|restaurant|dinner|plan|reserve/.test(text) ? "planner"
        : /fail|error|crash/.test(text) ? "fail"
          : /research|compare|find|look/.test(text) ? "research" : "echo";
  if (kind === "planner") return [
    { text: "Searching restaurants near you with a table for four" },
    { text: "Lupa has a 7pm opening on Saturday — checking the booking terms" },
    { text: "Ready to book. The reservation needs a deposit, so I'm checking with you first." },
    {
      waitApproval: {
        command: "Book Lupa, Saturday 7pm, table for 4",
        description: "Book Lupa for 4 people on Saturday at 7pm. The restaurant charges a $40 deposit to your card on file."
      }
    },
    { done: { text: "Done — Lupa is booked for 4 people on Saturday at 7pm, and I added it to your calendar." } }
  ];
  if (kind === "research") return [
    { text: "Gathering options from your saved sources" },
    { text: "Comparing the top three results" },
    { done: { text: "Top pick: the 14-inch Airframe — lightest under $1,200 with all-day battery. Runner-up: the Camber 13, $220 cheaper but 40 minutes less battery." } }
  ];
  if (kind === "deploy") return [
    { text: "Deploying the change to staging" },
    { text: "Running the staging smoke checks" },
    { goOffline: true }
  ];
  if (kind === "fail") return [
    { text: "Starting the task" },
    { done: { text: "The agent hit an error: the deployment target refused the connection.", status: "error" } }
  ];
  return [
    { text: "Working on it" },
    { done: { text: `Done. ${instruction}` } }
  ];
}

/**
 * Deterministic zero-credential agent for demos, judge evaluation, and tests.
 * Each session runs a scripted sequence of steps on a timer so the whole
 * lifecycle — progress, approval, completion, disconnect — is observable
 * without any external service.
 */
export class DemoClient extends AssistantEvented implements AssistantClient {
  readonly capabilities: RuntimeCapabilities = {
    sessions: true,
    steer: true,
    cancel: true,
    approvals: true,
    resume: true,
    events: true,
    asyncClass: "realtime"
  };

  private readonly speedMs: number;
  private readonly sessions = new Map<string, DemoSession>();

  constructor(private readonly options: DemoClientOptions = {}) {
    super();
    this.speedMs = options.speedMs ?? 1_200;
  }

  ping(): Promise<void> {
    this.emitState("online");
    return Promise.resolve();
  }

  createSession(): Promise<AssistantSession> {
    const session = this.newSession();
    return Promise.resolve({ runtimeSessionId: session.id, durableSessionId: session.durableId });
  }

  resumeSession(durableSessionId: string): Promise<AssistantSession> {
    const session = [...this.sessions.values()].find(item => item.durableId === durableSessionId) ?? this.newSession(durableSessionId);
    return Promise.resolve({ runtimeSessionId: session.id, durableSessionId: session.durableId });
  }

  listSavedSessions(): Promise<SavedSession[]> {
    return Promise.resolve([...this.sessions.values()].map(session => ({ id: session.durableId, title: session.title })));
  }

  listActiveSessions(): Promise<ActiveSession[]> {
    return Promise.resolve([...this.sessions.values()]
      .filter(session => session.working)
      .map(session => ({ id: session.id, session_key: session.durableId, status: "working", title: session.title })));
  }

  listPendingApprovals(runtimeSessionId: string): Promise<Record<string, unknown>[]> {
    const pending = this.sessions.get(runtimeSessionId)?.pending;
    return Promise.resolve(pending ? [{ request_id: pending.requestId, command: pending.command, description: pending.description, choices: ["once", "deny"] }] : []);
  }

  submitPrompt(runtimeSessionId: string, text: string): Promise<Record<string, unknown>> {
    const session = this.require(runtimeSessionId);
    session.working = true;
    session.aborted = false;
    session.title = text.split(/\s+/).slice(0, 8).join(" ");
    this.emit({ type: "message.start", sessionId: runtimeSessionId, payload: { kind: "assistant" } });
    void this.runScript(session, scriptFor(text, this.options.script));
    return Promise.resolve({ status: "streaming" });
  }

  steer(runtimeSessionId: string, text: string): Promise<Record<string, unknown>> {
    const session = this.require(runtimeSessionId);
    this.after(session, () => this.emit({ type: "status.update", sessionId: runtimeSessionId, payload: { text: `Noted — adjusting for: ${text}` } }));
    return Promise.resolve({ status: "queued" });
  }

  interrupt(runtimeSessionId: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(runtimeSessionId);
    if (session) {
      session.aborted = true;
      session.working = false;
      for (const timer of session.timers) clearTimeout(timer);
      session.timers = [];
      session.pending?.resolve("deny");
      session.pending = undefined;
    }
    return Promise.resolve({ status: "interrupted" });
  }

  respondToApproval(runtimeSessionId: string, requestId: string, choice: string): Promise<Record<string, unknown>> {
    const pending = this.sessions.get(runtimeSessionId)?.pending;
    if (!pending || pending.requestId !== requestId) return Promise.resolve({ resolved: 0 });
    pending.resolve(choice);
    return Promise.resolve({ resolved: 1 });
  }

  private newSession(durableId = `demo-${randomUUID()}`): DemoSession {
    const session: DemoSession = {
      id: `live-${randomUUID()}`,
      durableId,
      title: "Demo conversation",
      timers: [],
      working: false,
      aborted: false
    };
    this.sessions.set(session.id, session);
    return session;
  }

  private require(id: string): DemoSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown demo session ${id}`);
    return session;
  }

  private after(session: DemoSession, fn: () => void, delay = this.speedMs): void {
    session.timers.push(setTimeout(() => {
      if (!session.aborted) fn();
    }, delay));
  }

  private async runScript(session: DemoSession, steps: Step[]): Promise<void> {
    for (const step of steps) {
      if (session.aborted) return;
      await new Promise<void>(resolve => this.after(session, resolve));
      if (session.aborted) return;
      if (step.text) this.emit({ type: "status.update", sessionId: session.id, payload: { text: step.text } });
      if (step.goOffline) {
        session.working = false;
        session.timers = [];
        this.emitState("offline");
        this.after(session, () => this.emitState("online"), this.speedMs * 4);
        return;
      }
      if (step.waitApproval) {
        const requestId = `ap-${randomUUID().slice(0, 8)}`;
        const choice = await new Promise<string>(resolve => {
          session.pending = { requestId, command: step.waitApproval!.command, description: step.waitApproval!.description, resolve };
          this.emit({
            type: "approval.request",
            sessionId: session.id,
            payload: {
              request_id: requestId,
              command: step.waitApproval!.command,
              description: step.waitApproval!.description,
              choices: ["once", "deny"]
            }
          });
        });
        session.pending = undefined;
        if (session.aborted) return;
        if (choice !== "once") {
          this.emit({ type: "message.complete", sessionId: session.id, payload: { text: "Understood — I didn't book anything.", status: "ok" } });
          session.working = false;
          return;
        }
        this.emit({ type: "status.update", sessionId: session.id, payload: { text: "Approved — booking now" } });
        continue;
      }
      if (step.done) {
        session.working = false;
        this.emit({
          type: "message.complete",
          sessionId: session.id,
          payload: step.done.status === "error"
            ? { status: "error", error: step.done.text, text: step.done.text }
            : { status: "ok", text: step.done.text }
        });
        return;
      }
    }
    session.working = false;
    this.emit({ type: "message.complete", sessionId: session.id, payload: { status: "ok", text: "Done." } });
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      for (const timer of session.timers) clearTimeout(timer);
      session.timers = [];
      session.working = false;
    }
  }
}
