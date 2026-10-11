import { describe, expect, it, vi } from "vitest";
import { ConversationEngine } from "../src/conversations.js";
import {
  BedrockClient,
  type ConverseInput,
  type ConverseOutput,
  type ConverseSender
} from "../src/runtimes/bedrock.js";
import { AmbientStore } from "../src/store.js";

const RUNTIME = { id: "nova", label: "Nova", kind: "cloud" as const, state: "unknown" as const, updatedAt: "2026-10-11T00:00:00.000Z" };

function textMessage(text: string): ConverseOutput {
  return { stopReason: "end_turn", output: { message: { role: "assistant", content: [{ text }] } } };
}

function toolUseMessage(toolUseId: string, name: string, input: Record<string, unknown>): ConverseOutput {
  return { stopReason: "tool_use", output: { message: { role: "assistant", content: [{ toolUse: { toolUseId, name, input } }] } } };
}

function scriptedSend(outputs: ConverseOutput[]): { send: ConverseSender; calls: ConverseInput[] } {
  const calls: ConverseInput[] = [];
  const send = vi.fn(async (input: ConverseInput) => {
    calls.push(input);
    return outputs[Math.min(calls.length, outputs.length) - 1]!;
  }) as unknown as ConverseSender;
  return { send, calls };
}

function engineFor(client: BedrockClient, store: AmbientStore): ConversationEngine {
  return new ConversationEngine(client, store, {
    runtime: RUNTIME,
    id: (() => { let n = 0; return () => `run-${++n}`; })()
  });
}

async function waitFor(predicate: () => boolean, ms = 4_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe("BedrockClient", () => {
  it("answers in a single model turn", async () => {
    const store = new AmbientStore();
    const { send, calls } = scriptedSend([textMessage("Your porch light is on.")]);
    const client = new BedrockClient({ send });
    const engine = engineFor(client, store);
    const run = await engine.ask("Is the porch light on?", undefined, true);
    await waitFor(() => engine.getWork(run.id).status === "completed");
    expect(engine.getWork(run.id).answer).toBe("Your porch light is on.");
    expect(calls[0]!.messages.at(-1)!.content).toEqual([{ text: "Is the porch light on?" }]);
    expect(calls[0]!.toolConfig?.tools.map(tool => tool.toolSpec.name)).toContain("reservation_book");
    engine.close();
    store.close();
  });

  it("runs the tool loop and feeds results back to the model", async () => {
    const store = new AmbientStore();
    const { send, calls } = scriptedSend([
      toolUseMessage("tool-1", "web_search", { query: "best laptop" }),
      textMessage("The Airframe is the pick.")
    ]);
    const client = new BedrockClient({ send });
    const engine = engineFor(client, store);
    const events: string[] = [];
    client.onEvent(event => events.push(event.type));
    const run = await engine.ask("Compare laptops", undefined, true);
    await waitFor(() => engine.getWork(run.id).status === "completed");
    expect(engine.getWork(run.id).answer).toBe("The Airframe is the pick.");
    expect(calls).toHaveLength(2);
    const followUp = calls[1]!.messages.at(-1)!;
    expect(followUp.role).toBe("user");
    expect(followUp.content[0]!.toolResult!.toolUseId).toBe("tool-1");
    expect(followUp.content[0]!.toolResult!.content[0]!.text).toContain("Airframe");
    expect(events).toContain("tool.start");
    expect(events).toContain("tool.complete");
    engine.close();
    store.close();
  });

  it("pauses on an approval-gated tool and books after approval", async () => {
    const store = new AmbientStore();
    const { send, calls } = scriptedSend([
      toolUseMessage("tool-1", "reservation_book", { restaurant: "Lupa", date: "Saturday October 17", time: "7pm", partySize: 4, depositUsd: 40 }),
      textMessage("Done — Lupa is booked for four on Saturday at 7pm.")
    ]);
    const client = new BedrockClient({ send });
    const engine = engineFor(client, store);
    const run = await engine.ask("Book Lupa for four on Saturday at 7pm", undefined, true);
    await waitFor(() => engine.getWork(run.id).status === "waiting_approval");
    expect(calls).toHaveLength(1);
    const approval = engine.getWork(run.id).approval!;
    expect(approval.command).toContain("Lupa");
    expect(approval.command).toContain("$40 deposit");
    expect(await client.listPendingApprovals(engine.getWork(run.id).liveSessionId)).toHaveLength(1);
    await engine.respondToApproval(`${run.runtimeId}:${approval.requestId}`, "once");
    await waitFor(() => engine.getWork(run.id).status === "completed");
    expect(engine.getWork(run.id).answer).toContain("booked");
    const followUp = calls[1]!.messages.at(-1)!;
    expect(followUp.content[0]!.toolResult!.status).toBe("success");
    expect(followUp.content[0]!.toolResult!.content[0]!.text).toContain("confirmed");
    engine.close();
    store.close();
  });

  it("reports the denial back to the model instead of running the tool", async () => {
    const store = new AmbientStore();
    const { send, calls } = scriptedSend([
      toolUseMessage("tool-1", "reservation_book", { restaurant: "Lupa", date: "Saturday", time: "7pm", partySize: 4 }),
      textMessage("Understood — I did not book anything.")
    ]);
    const client = new BedrockClient({ send });
    const engine = engineFor(client, store);
    const run = await engine.ask("Book Lupa", undefined, true);
    await waitFor(() => engine.getWork(run.id).status === "waiting_approval");
    const approval = engine.getWork(run.id).approval!;
    await engine.respondToApproval(`${run.runtimeId}:${approval.requestId}`, "deny");
    await waitFor(() => engine.getWork(run.id).status === "completed");
    expect(engine.getWork(run.id).answer).toContain("did not book");
    const followUp = calls[1]!.messages.at(-1)!;
    expect(followUp.content[0]!.toolResult!.status).toBe("error");
    expect(followUp.content[0]!.toolResult!.content[0]!.text).toContain("denied");
    engine.close();
    store.close();
  });

  it("cancels an in-flight model call via the abort signal", async () => {
    const store = new AmbientStore();
    const send: ConverseSender = (_input, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("The operation was aborted")));
    });
    const client = new BedrockClient({ send });
    const engine = engineFor(client, store);
    const run = await engine.ask("Think forever", undefined, true);
    await waitFor(() => engine.getWork(run.id).status === "running");
    await engine.cancel(run.id);
    await waitFor(() => engine.getWork(run.id).status === "cancelled");
    engine.close();
    store.close();
  });

  it("persists the transcript and resumes it after a restart", async () => {
    const store = new AmbientStore();
    const first = scriptedSend([textMessage("Planning dinner.")]);
    const client = new BedrockClient({ send: first.send, store, runtimeId: "nova" });
    const session = await client.createSession();
    await client.submitPrompt(session.runtimeSessionId, "Plan dinner for Saturday");
    await waitFor(() => store.transcript("nova", session.durableSessionId).length >= 2);

    // A new process (fresh client) resumes the durable session with context.
    const second = scriptedSend([textMessage("Moved to Friday.")]);
    const restarted = new BedrockClient({ send: second.send, store, runtimeId: "nova" });
    const saved = await restarted.listSavedSessions();
    expect(saved.map(item => item.id)).toContain(session.durableSessionId);
    expect(saved.find(item => item.id === session.durableSessionId)?.title).toContain("Plan dinner");
    const resumed = await restarted.resumeSession(session.durableSessionId);
    await restarted.submitPrompt(resumed.runtimeSessionId, "Actually make it Friday");
    await waitFor(() => second.calls.length === 1);
    expect(second.calls[0]!.messages[0]!.content).toEqual([{ text: "Plan dinner for Saturday" }]);
    expect(second.calls[0]!.messages.at(-1)!.content).toEqual([{ text: "Actually make it Friday" }]);
    store.close();
  });

  it("closes out a tool call cut short by a restart", async () => {
    const store = new AmbientStore();
    store.appendTranscript("nova", "durable-1", "user", JSON.stringify({ role: "user", content: [{ text: "Book Lupa" }] }));
    store.appendTranscript("nova", "durable-1", "assistant", JSON.stringify({
      role: "assistant",
      content: [{ toolUse: { toolUseId: "cut-1", name: "reservation_book", input: { restaurant: "Lupa" } } }]
    }));
    const { send, calls } = scriptedSend([textMessage("I could not finish booking Lupa.")]);
    const client = new BedrockClient({ send, store, runtimeId: "nova" });
    const resumed = await client.resumeSession("durable-1");
    await client.submitPrompt(resumed.runtimeSessionId, "What happened?");
    await waitFor(() => calls.length === 1);
    const messages = calls[0]!.messages;
    expect(messages[1]!.role).toBe("assistant");
    const patched = messages[2]!;
    expect(patched.role).toBe("user");
    expect(patched.content[0]!.toolResult!.toolUseId).toBe("cut-1");
    expect(patched.content[0]!.toolResult!.content[0]!.text).toContain("result is unknown");
    store.close();
  });
});
