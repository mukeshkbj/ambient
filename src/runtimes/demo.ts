import { randomUUID } from "node:crypto";
import {
  AssistantEvented,
  type ActiveSession,
  type ApprovalPayload,
  type ApprovalResponse,
  type AssistantClient,
  type AssistantSession,
  type InterruptResult,
  type RuntimeCapabilities,
  type SavedSession,
  type SteerResult,
  type SubmitResult
} from "./types.js";

export type DemoClientOptions = {
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

type Step = { text?: string; waitApproval?: PendingApprovalSeed; done?: { text: string; status?: "ok" | "error" } };
type PendingApprovalSeed = { command: string; description: string };

const PLANNER_SCRIPT: Step[] = [
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

  /** Live session handles die with the process; discovery re-binds via durable ids. */
  readonly ephemeralSessions = true;

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
      .map(session => ({ id: session.id, durableId: session.durableId, status: "working", title: session.title })));
  }

  listPendingApprovals(runtimeSessionId: string): Promise<ApprovalPayload[]> {
    const pending = this.sessions.get(runtimeSessionId)?.pending;
    return Promise.resolve(pending ? [{ requestId: pending.requestId, command: pending.command, description: pending.description, choices: ["once", "deny"] }] : []);
  }

  submitPrompt(runtimeSessionId: string, text: string): Promise<SubmitResult> {
    const session = this.require(runtimeSessionId);
    session.working = true;
    session.aborted = false;
    session.title = text.split(/\s+/).slice(0, 8).join(" ");
    this.emit({ type: "message.start", sessionId: runtimeSessionId, payload: { kind: "assistant" } });
    void this.runScript(session, PLANNER_SCRIPT);
    return Promise.resolve({ state: "streaming" });
  }

  steer(runtimeSessionId: string, text: string): Promise<SteerResult> {
    const session = this.require(runtimeSessionId);
    this.after(session, () => this.emit({ type: "status.update", sessionId: runtimeSessionId, payload: { text: `Noted — adjusting for: ${text}` } }));
    return Promise.resolve({ state: "queued" });
  }

  interrupt(runtimeSessionId: string): Promise<InterruptResult> {
    const session = this.sessions.get(runtimeSessionId);
    if (session) {
      session.aborted = true;
      session.working = false;
      for (const timer of session.timers) clearTimeout(timer);
      session.timers = [];
      session.pending?.resolve("deny");
      session.pending = undefined;
    }
    return Promise.resolve({ state: "interrupted" });
  }

  respondToApproval(runtimeSessionId: string, requestId: string, choice: string): Promise<ApprovalResponse> {
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
      if (step.waitApproval) {
        const requestId = `ap-${randomUUID().slice(0, 8)}`;
        const choice = await new Promise<string>(resolve => {
          session.pending = { requestId, command: step.waitApproval!.command, description: step.waitApproval!.description, resolve };
          this.emit({
            type: "approval.request",
            sessionId: session.id,
            payload: {
              requestId,
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
