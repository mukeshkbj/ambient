import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RuntimeRegistry } from "./runtimes/registry.js";
import type { RunView, RuntimeState } from "./types.js";

export type McpDependencies = {
  registry: RuntimeRegistry;
};

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function viewText(view: RunView, label = "The assistant"): string {
  if (view.status === "completed") return view.answer ?? `${label} completed the request without text.`;
  if (view.status === "failed") return `${label} failed: ${view.failure ?? view.answer ?? "unknown error"}`;
  if (view.status === "unknown") return `${label} disconnected before the work outcome was confirmed. Ask again after it reconnects.`;
  if (view.status === "waiting_approval" && view.approval) {
    return `${label} is waiting for approval to ${view.approval.command}. Approval request: ${view.approval.id}.`;
  }
  if (view.status === "cancelled") return `${label} cancelled the work.`;
  return `${label} accepted the request. Work id ${view.id} is ${view.status}. Ask get_work with this id for the result.`;
}

function success(view: RunView, label: string, runtimeState: RuntimeState = "online") {
  const text = runtimeState === "online" || ["completed", "failed", "cancelled"].includes(view.status)
    ? viewText(view, label)
    : `${label} is ${runtimeState}; work ${view.id} is currently ${view.status}. Ask again after the runtime reconnects.`;
  return { content: [{ type: "text" as const, text }], structuredContent: view };
}

function failure(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }]
  };
}

export function createMcpServer({ registry }: McpDependencies): McpServer {
  const server = new McpServer(
    { name: "Ambient", version: "0.1.0" },
    {
      instructions: "Ambient is a gateway to several personal assistants. Use list_assistants to see which assistants are configured and online, and select_assistant to change the default. Use ask for a question or instruction; pass assistant to route to a specific one, otherwise the selected assistant is used. ask returns quickly with a work id; call get_work for a later result. Work, conversation, and approval ids are exact — never guess them. Ask before selecting a new conversation."
    }
  );

  server.registerTool("ask", {
    title: "Ask an assistant",
    description: "Send a personal question or work instruction to an assistant in the selected conversation. Routes to the selected assistant unless assistant names another. Returns quickly with a work id; call get_work to retrieve a result that is still running.",
    inputSchema: {
      text: z.string().min(1),
      assistant: z.string().min(1).optional(),
      conversationId: z.string().min(1).optional(),
      newConversation: z.boolean().optional()
    }
  }, async ({ text, assistant, conversationId, newConversation }) => {
    try {
      const entry = registry.resolve(assistant);
      return success(await entry.engine.ask(text, conversationId, newConversation ?? false), entry.descriptor.label);
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("get_work", {
    title: "Get work",
    description: "Inspect a work item by its exact work id, on whichever assistant owns it. Use this after ask for a completed answer, progress, failure, cancellation, or pending approval.",
    inputSchema: { workId: z.string().min(1) }
  }, async ({ workId }) => {
    try {
      const engine = registry.engineForRun(workId);
      const view = engine.getWork(workId);
      return success(view, registry.label(view.runtimeId), engine.runtime().state);
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("list_assistants", {
    title: "List assistants",
    description: "List the configured assistant runtimes with their state, capabilities, and which one is currently selected.",
    inputSchema: {}
  }, async () => {
    try {
      const assistants = registry.list();
      const summary = assistants.map(item => `${item.label} (${item.id}): ${item.state}${item.selected ? ", selected" : ""}`).join(". ");
      return { content: [{ type: "text" as const, text: summary }], structuredContent: { assistants } };
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("select_assistant", {
    title: "Select an assistant",
    description: "Make an assistant the selected default for later ask calls. Accepts an assistant id or name.",
    inputSchema: { assistant: z.string().min(1) }
  }, async ({ assistant }) => {
    try {
      const entry = registry.select(assistant);
      return {
        content: [{ type: "text" as const, text: `Selected ${entry.descriptor.label}.` }],
        structuredContent: registry.list().find(item => item.id === entry.descriptor.id)!
      };
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("list_conversations", {
    title: "List conversations",
    description: "List conversations and recent work for an assistant. Uses the selected assistant unless assistant names another.",
    inputSchema: { assistant: z.string().min(1).optional() }
  }, async ({ assistant }) => {
    try {
      const entry = registry.resolve(assistant);
      const conversations = entry.engine.listConversations();
      return {
        content: [{ type: "text" as const, text: json(conversations) }],
        structuredContent: { runtime: entry.engine.runtime(), conversations, work: entry.engine.listRuns() }
      };
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("select_conversation", {
    title: "Select a conversation",
    description: "Select an existing conversation by its exact conversation id for later ask calls on the assistant that owns it.",
    inputSchema: { conversationId: z.string().min(1) }
  }, async ({ conversationId }) => {
    try {
      const conversation = await registry.engineForConversation(conversationId).selectConversation(conversationId);
      return { content: [{ type: "text" as const, text: `Selected ${conversation.title}.` }], structuredContent: conversation };
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("steer_work", {
    title: "Steer work",
    description: "Add an instruction to a confirmed running work item. Use the exact work id and do not use this for a new conversation. Not all assistants support steering.",
    inputSchema: { workId: z.string().min(1), text: z.string().min(1) }
  }, async ({ workId, text }) => {
    try {
      const engine = registry.engineForRun(workId);
      const view = await engine.steer(workId, text);
      return success(view, registry.label(view.runtimeId));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("cancel_work", {
    title: "Cancel work",
    description: "Request interruption of a confirmed work item. The result distinguishes confirmed cancellation from an uncertain outcome. Not all assistants support cancellation.",
    inputSchema: { workId: z.string().min(1) }
  }, async ({ workId }) => {
    try {
      const engine = registry.engineForRun(workId);
      const view = await engine.cancel(workId);
      return success(view, registry.label(view.runtimeId));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("list_approvals", {
    title: "List approvals",
    description: "List pending approval requests. With no assistant given, pending approvals from every assistant are included. Use the exact approval ids to answer them.",
    inputSchema: { assistant: z.string().min(1).optional() }
  }, async ({ assistant }) => {
    try {
      const approvals = assistant
        ? registry.resolve(assistant).engine.listApprovals()
        : registry.list().flatMap(item => registry.entry(item.id)!.engine.listApprovals());
      approvals.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const labelled = approvals.map(approval => ({ ...approval, assistant: registry.label(approval.runtimeId) }));
      return { content: [{ type: "text" as const, text: json(labelled) }], structuredContent: { approvals: labelled } };
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("respond_to_approval", {
    title: "Respond to an approval",
    description: "Approve once or deny one exact pending request on the assistant that raised it. Never guess an approval id or silently approve a consequential action.",
    inputSchema: { approvalId: z.string().min(1), decision: z.enum(["once", "deny"]) }
  }, async ({ approvalId, decision }) => {
    try {
      const engine = registry.engineForApproval(approvalId);
      const view = await engine.respondToApproval(approvalId, decision);
      return success(view, registry.label(view.runtimeId));
    } catch (error) {
      return failure(error);
    }
  });

  return server;
}
