import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DASHBOARD_HTML, dashboardSnapshot, TASK_HTML } from "./dashboard.js";
import type { PendingApproval, RuntimeEntry, RuntimeRegistry } from "./runtimes/registry.js";
import type { RunStatus, RunView } from "./types.js";
import { approvalAsk, DASHBOARD_RESOURCE_URI, runResult, say, TASK_RESOURCE_URI } from "./voice.js";

export type McpDependencies = {
  registry: RuntimeRegistry;
  askWaitMs?: number;
};

const CANCELLABLE: ReadonlySet<RunStatus> = new Set(["queued", "accepted", "running", "waiting_approval", "cancel_requested"]);

function failure(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }]
  };
}

function parseSince(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const raw = value.trim().toLowerCase();
  if (raw === "today") return new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  if (raw === "yesterday") {
    const day = new Date();
    day.setDate(day.getDate() - 1);
    return new Date(day.setHours(0, 0, 0, 0)).toISOString();
  }
  const relative = /^(\d+)\s*(m|min|minutes?|h|hours?|d|days?)\s*ago$/.exec(raw);
  if (relative) {
    const unit = relative[2]![0]!;
    const ms = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return new Date(Date.now() - Number(relative[1]) * ms).toISOString();
  }
  const absolute = new Date(value);
  return Number.isNaN(absolute.getTime()) ? undefined : absolute.toISOString();
}

function pendingSpeech(candidates: PendingApproval[]): string {
  const parts = candidates.slice(0, 3).map(item => `"${item.approval.command}" from ${item.entry.descriptor.label}`);
  const suffix = candidates.length > 3 ? `, and ${candidates.length - 3} more` : "";
  return `${candidates.length} approvals are waiting: ${parts.join("; ")}${suffix}. Say approve or deny plus which one.`;
}

export function createMcpServer({ registry, askWaitMs = 0 }: McpDependencies): McpServer {
  const server = new McpServer(
    { name: "Ambient", version: "0.1.0" },
    {
      instructions: "Ambient fronts the user's personal AI agents. Talk in terms of tasks, not ids: delegate starts or continues work, status reports the latest or a named task, approve and stop act on work, agents lists who's available, briefing summarizes recent activity. Approvals are answered through elicitation when the client supports it, otherwise tell the user to say approve or deny."
    }
  );

  /** When the run is waiting on a person, try elicitation; otherwise stay pending. */
  const elicitApproval = async (entry: RuntimeEntry, view: RunView): Promise<boolean> => {
    const approval = view.approval;
    if (view.status !== "waiting_approval" || !approval) return false;
    const capabilities = server.server.getClientCapabilities();
    if (!capabilities?.elicitation) return false;
    try {
      const result = await server.server.elicitInput({
        mode: "form",
        message: approvalAsk(view, { label: entry.descriptor.label }),
        requestedSchema: {
          type: "object",
          properties: {
            decision: {
              type: "string",
              title: "Decision",
              description: `Allow or refuse: ${approval.command}`,
              enum: ["approve_once", "deny"],
              enumNames: ["Approve once", "Deny"]
            }
          },
          required: ["decision"]
        }
      });
      if (result.action !== "accept") return false;
      await entry.engine.respondToApproval(approval.id, result.content?.decision === "deny" ? "deny" : "once");
      return true;
    } catch {
      return false;
    }
  };

  const settleApproval = async (entry: RuntimeEntry, view: RunView): Promise<ReturnType<typeof runResult>> => {
    if (await elicitApproval(entry, view)) {
      view = await entry.engine.waitForRun(view.id, askWaitMs);
    }
    return runResult(view, { label: entry.descriptor.label, state: entry.engine.runtime().state });
  };

  server.registerTool("delegate", {
    title: "Delegate a task",
    description: "Give an agent a new instruction or a follow-up in its current conversation. Call when the user asks an agent to do work, answer a question, or adjust work in flight — if that conversation already has active work, the message is sent as a steering instruction. Waits a few seconds for a quick answer, then returns the current status. Never needs ids.",
    inputSchema: {
      task: z.string().min(1).describe("The instruction for the agent, in the user's words"),
      agent: z.string().min(1).optional().describe("Agent name; defaults to the selected agent"),
      conversationId: z.string().min(1).optional().describe("Exact conversation id for programmatic clients; voice never needs it"),
      newConversation: z.boolean().optional().describe("Start a fresh conversation instead of continuing the selected one")
    }
  }, async ({ task, agent, conversationId, newConversation }) => {
    try {
      const entry = registry.resolve(agent);
      const active = entry.engine.activeRunForNextAsk(conversationId);
      if (active && !newConversation) {
        if (!entry.descriptor.capabilities.steer) {
          throw new Error(`${entry.descriptor.label} is still working on "${active.title}" and can't be steered. Wait for it to finish, or say stop first.`);
        }
        const view = await entry.engine.steer(active.id, task);
        return runResult(view, { label: entry.descriptor.label }, `Noted — passed that to ${entry.descriptor.label} while it works on "${view.title}".`);
      }
      const view = await entry.engine.ask(task, conversationId, newConversation ?? false, { waitMs: askWaitMs });
      return await settleApproval(entry, view);
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("status", {
    title: "Check status",
    description: "Check the latest work or a named task — 'what's the status', 'how's the dinner booking'. With nothing named it reports whatever most needs attention (a pending approval) or the most recent work across all agents. Returns speakable status, never an id.",
    inputSchema: {
      about: z.string().min(1).optional().describe("Words from the task — 'dinner', 'flights', 'deploy'. Never an id."),
      agent: z.string().min(1).optional().describe("Agent name to scope the search")
    }
  }, async ({ about, agent }) => {
    try {
      let view: RunView | undefined;
      if (agent) {
        const entry = registry.resolve(agent);
        view = about
          ? entry.engine.listRuns(50).find(run => run.title.toLowerCase().includes(about.toLowerCase()) || run.instruction.toLowerCase().includes(about.toLowerCase()))
          : (entry.engine.listRuns(50).find(run => run.status === "waiting_approval") ?? entry.engine.listRuns(1)[0]);
      } else if (about) {
        view = registry.findRun(about);
      } else {
        view = registry.needsAttention() ?? registry.latestRun();
      }
      if (!view) {
        return say(about ? `I can't find any work about ${about}.` : "Nothing is running yet — delegate something to get started.", { status: "idle" });
      }
      const entry = registry.entry(view.runtimeId)!;
      return await settleApproval(entry, view);
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("approve", {
    title: "Answer an approval",
    description: "Approve once or deny a pending request from an agent. Call when the user says approve, allow, or deny. With a single pending request the decision alone is enough; 'about' picks between several — 'deny the deploy'.",
    inputSchema: {
      decision: z.enum(["approve", "once", "deny"]).describe("'approve' or 'once' allows this one time; 'deny' refuses it"),
      about: z.string().min(1).optional().describe("Words from the request to pick between several pending approvals"),
      approvalId: z.string().min(1).optional().describe("Exact approval id for programmatic clients; voice never needs it")
    }
  }, async ({ decision, about, approvalId }) => {
    try {
      let target: PendingApproval | undefined;
      if (approvalId) {
        const candidate = registry.pendingApprovals().find(item => item.approval.id === approvalId);
        if (!candidate) throw new Error("That approval is no longer pending.");
        target = candidate;
      } else {
        const { match, candidates } = registry.findApproval(about);
        if (candidates.length === 0) throw new Error("There are no pending approvals.");
        if (!match) throw new Error(pendingSpeech(candidates));
        target = match;
      }
      await target.entry.engine.respondToApproval(target.approval.id, decision === "deny" ? "deny" : "once");
      const view = await target.entry.engine.waitForRun(target.approval.runId, askWaitMs);
      return runResult(view, { label: target.entry.descriptor.label, state: target.entry.engine.runtime().state });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("stop", {
    title: "Stop work",
    description: "Cancel active work — 'stop that', 'cancel the deploy'. Defaults to the most recent work that's still running. Returns the confirmed status, including when the outcome can't be confirmed.",
    inputSchema: {
      about: z.string().min(1).optional().describe("Words from the task to pick which active work to stop"),
      runId: z.string().min(1).optional().describe("Exact run id for programmatic clients; voice never needs it")
    }
  }, async ({ about, runId }) => {
    try {
      let view: RunView | undefined;
      if (runId) {
        const engine = registry.engineForRun(runId);
        view = engine.getWork(runId);
      } else if (about) {
        const found = registry.findRun(about);
        if (found && CANCELLABLE.has(found.status)) view = found;
      } else {
        view = registry.recentRuns(25).find(run => CANCELLABLE.has(run.status));
      }
      if (!view) return say(about ? `Nothing active matches ${about}.` : "Nothing is running right now.", { status: "idle" });
      const engine = registry.engineForRun(view.id);
      const stopped = await engine.cancel(view.id);
      return runResult(stopped, { label: registry.label(stopped.runtimeId), state: engine.runtime().state });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("agents", {
    title: "List agents",
    description: "List the configured agents with their state and capabilities — 'what agents do I have', 'is my coding agent online'. Pass 'use' to make one the default for later calls.",
    inputSchema: {
      use: z.string().min(1).optional().describe("Agent name to make the default")
    }
  }, async ({ use }) => {
    try {
      if (use) {
        const entry = registry.select(use);
        return say(`Using ${entry.descriptor.label} now.`, { agents: registry.list(), selected: entry.descriptor.id });
      }
      const assistants = registry.list();
      if (assistants.length === 0) return say("No agents are configured.", { agents: [] });
      const states = assistants.map(item => `${item.label} is ${item.state}`).join(". ");
      const selected = assistants.find(item => item.selected);
      return say(`${states}.${selected ? ` Currently using ${selected.label}.` : ""}`, { agents: assistants });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("briefing", {
    title: "Briefing",
    description: "Summarize what the agents have been doing — 'what did my agents do', 'give me a briefing'. Covers work finished, still running, failed, and anything waiting on the user, since the given time or since the last briefing.",
    inputSchema: {
      since: z.string().min(1).optional().describe("How far back: 'today', '2 hours ago', or an ISO timestamp. Defaults to the last briefing, or 24 hours.")
    }
  }, async ({ since }) => {
    try {
      const cutoff = parseSince(since) ?? registry.meta("last_briefing_at") ?? new Date(Date.now() - 86_400_000).toISOString();
      const runs = registry.recentRuns(50, cutoff);
      const pending = registry.pendingApprovals();
      const done = runs.filter(run => run.status === "completed");
      const failed = runs.filter(run => run.status === "failed");
      const active = runs.filter(run => CANCELLABLE.has(run.status) && run.status !== "waiting_approval");
      const unknown = runs.filter(run => run.status === "unknown");
      const parts: string[] = [];
      if (pending.length > 0) {
        parts.push(`${pending.length} approval${pending.length === 1 ? "" : "s"} need${pending.length === 1 ? "s" : ""} you: ${pending.slice(0, 2).map(item => `"${item.approval.command}" from ${item.entry.descriptor.label}`).join("; ")}.`);
      }
      if (runs.length === 0 && pending.length === 0) {
        parts.push("Nothing on record since then — your agents are quiet.");
      } else if (runs.length > 0) {
        const counts = [
          done.length > 0 ? `${done.length} finished` : "",
          active.length > 0 ? `${active.length} still running` : "",
          failed.length > 0 ? `${failed.length} failed` : "",
          unknown.length > 0 ? `${unknown.length} lost contact` : ""
        ].filter(Boolean).join(", ");
        parts.push(`Since then: ${counts}.`);
        const latest = runs[0]!;
        if (latest.answer) parts.push(`Latest: ${registry.label(latest.runtimeId)} — "${latest.title}": ${latest.answer}`);
        else if (latest.status === "waiting_approval") parts.push(`"${latest.title}" is waiting on you — say approve or deny.`);
        else parts.push(`Latest: ${registry.label(latest.runtimeId)} is ${latest.status.replace("_", " ")} on "${latest.title}".`);
      }
      registry.setMeta("last_briefing_at", new Date().toISOString());
      return say(parts.join(" "), {
        since: cutoff,
        runs: runs.map(run => ({ title: run.title, status: run.status, assistant: registry.label(run.runtimeId), id: run.id })),
        approvals: pending.map(item => ({ id: item.approval.id, command: item.approval.command, agent: item.entry.descriptor.label }))
      });
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("dashboard", {
    title: "Ambient dashboard",
    description: "Open the live Ambient dashboard: agent switcher, live work feed across every runtime, and pending approvals with one-tap answers. Also returns the full snapshot as structured content.",
    inputSchema: {},
    _meta: { ui: { resourceUri: DASHBOARD_RESOURCE_URI } }
  }, async () => {
    try {
      const snapshot = dashboardSnapshot(registry);
      return {
        content: [{ type: "text" as const, text: `${snapshot.assistants.length} agents, ${snapshot.approvals.length} pending approvals, ${snapshot.work.length} recent work items.` }],
        structuredContent: snapshot as unknown as Record<string, unknown>
      };
    } catch (error) {
      return failure(error);
    }
  });

  server.registerResource("ambient-dashboard", DASHBOARD_RESOURCE_URI, {
    title: "Ambient dashboard",
    description: "Live multi-agent dashboard: switcher, work feed, approvals.",
    mimeType: "text/html;profile=mcp-app"
  }, async () => ({
    contents: [{ uri: DASHBOARD_RESOURCE_URI, mimeType: "text/html;profile=mcp-app", text: DASHBOARD_HTML }]
  }));

  server.registerResource("ambient-task", TASK_RESOURCE_URI, {
    title: "Ambient task card",
    description: "A single task: status, step history, answer, and any pending approval.",
    mimeType: "text/html;profile=mcp-app"
  }, async () => ({
    contents: [{ uri: TASK_RESOURCE_URI, mimeType: "text/html;profile=mcp-app", text: TASK_HTML }]
  }));

  return server;
}
