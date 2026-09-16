import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ConversationEngine } from "./conversations.js";
import type { RunView, RuntimeState } from "./types.js";

export type McpDependencies = {
  engine: ConversationEngine;
};

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function viewText(view: RunView): string {
  if (view.status === "completed") return view.answer ?? "Hermes completed the request without text.";
  if (view.status === "failed") return `Hermes failed: ${view.failure ?? view.answer ?? "unknown error"}`;
  if (view.status === "unknown") return "Hermes disconnected before the work outcome was confirmed. Ask again after it reconnects.";
  if (view.status === "waiting_approval" && view.approval) {
    return `Hermes is waiting for approval to ${view.approval.command}. Approval request: ${view.approval.requestId}.`;
  }
  if (view.status === "cancelled") return "Hermes cancelled the work.";
  return `Hermes accepted the request. Work id ${view.id} is ${view.status}. Ask get_work with this id for the result.`;
}

function success(view: RunView, runtimeState: RuntimeState = "online") {
  const text = runtimeState === "online" || ["completed", "failed", "cancelled"].includes(view.status)
    ? viewText(view)
    : `Hermes is ${runtimeState}; work ${view.id} is currently ${view.status}. Ask again after the runtime reconnects.`;
  return { content: [{ type: "text" as const, text }], structuredContent: view };
}

function failure(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }]
  };
}

export function createMcpServer({ engine }: McpDependencies): McpServer {
  const server = new McpServer(
    { name: "Hermes Ambient", version: "0.1.0" },
    {
      instructions: "Hermes Ambient gives Alexa access to one configured Hermes runtime. Use ask_hermes for a question or instruction. It returns quickly; call get_work for a later result. Use the exact work and approval ids for controls. Ask before selecting a new conversation."
    }
  );

  server.registerTool("ask_hermes", {
    title: "Ask Hermes",
    description: "Send a personal question or work instruction to Hermes in the selected conversation. Returns quickly with a work id; call get_work to retrieve a result that is still running.",
    inputSchema: {
      text: z.string().min(1),
      conversationId: z.string().min(1).optional(),
      newConversation: z.boolean().optional()
    }
  }, async ({ text, conversationId, newConversation }) => {
    try {
      return success(await engine.ask(text, conversationId, newConversation ?? false));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("get_work", {
    title: "Get Hermes work",
    description: "Inspect a Hermes work item by its exact work id. Use this after ask_hermes for a completed answer, progress, failure, cancellation, or pending approval.",
    inputSchema: { workId: z.string().min(1) }
  }, async ({ workId }) => {
    try {
      return success(engine.getWork(workId), engine.runtime().state);
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("list_conversations", {
    title: "List Hermes conversations",
    description: "List conversations and recent work in the configured Hermes runtime. Use this when the user refers to an existing conversation without an exact id.",
    inputSchema: {}
  }, async () => {
    try {
      const conversations = engine.listConversations();
      return {
        content: [{ type: "text" as const, text: json(conversations) }],
        structuredContent: { runtime: engine.runtime(), conversations, work: engine.listRuns() }
      };
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("select_conversation", {
    title: "Select a Hermes conversation",
    description: "Select an existing Hermes conversation by its exact conversation id for later ask_hermes calls.",
    inputSchema: { conversationId: z.string().min(1) }
  }, async ({ conversationId }) => {
    try {
      const conversation = await engine.selectConversation(conversationId);
      return { content: [{ type: "text" as const, text: `Selected ${conversation.title}.` }], structuredContent: conversation };
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("steer_work", {
    title: "Steer Hermes work",
    description: "Add an instruction to a confirmed running Hermes work item. Use the exact work id and do not use this for a new conversation.",
    inputSchema: { workId: z.string().min(1), text: z.string().min(1) }
  }, async ({ workId, text }) => {
    try {
      return success(await engine.steer(workId, text));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("cancel_work", {
    title: "Cancel Hermes work",
    description: "Request interruption of a confirmed Hermes work item. The result distinguishes confirmed cancellation from an uncertain outcome.",
    inputSchema: { workId: z.string().min(1) }
  }, async ({ workId }) => {
    try {
      return success(await engine.cancel(workId));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("list_approvals", {
    title: "List Hermes approvals",
    description: "List pending Hermes approval requests in the configured runtime, including the exact approval ids needed to answer them.",
    inputSchema: {}
  }, async () => {
    try {
      const approvals = engine.listApprovals();
      return { content: [{ type: "text" as const, text: json(approvals) }], structuredContent: { approvals } };
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool("respond_to_approval", {
    title: "Respond to a Hermes approval",
    description: "Approve once or deny one exact pending Hermes request. Never guess an approval id or silently approve a consequential action.",
    inputSchema: { approvalId: z.string().min(1), decision: z.enum(["once", "deny"]) }
  }, async ({ approvalId, decision }) => {
    try {
      return success(await engine.respondToApproval(approvalId, decision));
    } catch (error) {
      return failure(error);
    }
  });

  return server;
}
