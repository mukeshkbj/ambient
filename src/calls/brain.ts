import type {
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaTool
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import { z } from "zod";
import { systemPrompt, toMessages } from "./prompt.js";
import type { CallState } from "./session.js";
import type { BrainStep } from "./types.js";

export type Brain = { respond(state: CallState, signal: AbortSignal): AsyncIterable<BrainStep> };

export type StreamRequest = BetaMessageStreamParams;
type Stream = (request: StreamRequest, options: { signal: AbortSignal }) => AsyncIterable<BetaRawMessageStreamEvent>;

const TOOLS: BetaTool[] = [
  {
    name: "ask_owner",
    description: "Pause and ask the owner a question, such as approving a price above the limit. The business hears a short holding line.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "One short question the owner can answer yes or no, or with an instruction." },
        amount_usd: { type: "number", description: "The price in dollars the question is about, if any." }
      },
      required: ["question"],
      additionalProperties: false
    }
  },
  {
    name: "end_call",
    description: "Say goodbye and hang up. Use confirmed only when the business clearly agreed to a specific time and price.",
    input_schema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["confirmed", "declined", "no_deal"] },
        summary: { type: "string", description: "One sentence for the owner: what was agreed, or why not." },
        amount_usd: { type: "number", description: "The agreed price in dollars." },
        when: { type: "string", description: "The agreed time, as the business said it." }
      },
      required: ["outcome", "summary"],
      additionalProperties: false
    }
  },
  {
    name: "remember",
    description: "Save a durable fact about this business for the owner's future calls.",
    input_schema: {
      type: "object",
      properties: { fact: { type: "string" } },
      required: ["fact"],
      additionalProperties: false
    }
  }
].map(tool => ({ ...tool, strict: true, eager_input_streaming: true }) as BetaTool);

const AskOwner = z.object({ question: z.string().min(1), amount_usd: z.number().positive().optional() });
const EndCall = z.object({
  outcome: z.enum(["confirmed", "declined", "no_deal"]),
  summary: z.string().min(1),
  amount_usd: z.number().positive().optional(),
  when: z.string().min(1).optional()
});
const Remember = z.object({ fact: z.string().min(1) });

function toStep(name: string, input: unknown): BrainStep | undefined {
  switch (name) {
    case "ask_owner": {
      const parsed = AskOwner.safeParse(input);
      if (!parsed.success) return undefined;
      const { question, amount_usd } = parsed.data;
      return { kind: "ask_owner", question, ...(amount_usd !== undefined ? { amountUsd: amount_usd } : {}) };
    }
    case "end_call": {
      const parsed = EndCall.safeParse(input);
      if (!parsed.success) return undefined;
      const { outcome, summary, amount_usd, when } = parsed.data;
      if (outcome !== "confirmed") return { kind: "end_call", outcome: { kind: outcome, reason: summary } };
      const amount = amount_usd !== undefined ? { amountUsd: amount_usd } : {};
      return { kind: "end_call", outcome: { kind: "confirmed", summary, ...amount, ...(when !== undefined ? { when } : {}) } };
    }
    case "remember": {
      const parsed = Remember.safeParse(input);
      return parsed.success ? { kind: "remember", fact: parsed.data.fact } : undefined;
    }
    default:
      return undefined;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return undefined;
  }
}

export function claudeBrain(options: { stream: Stream; model: string; fallbacks?: boolean; log?: (message: string) => void }): Brain {
  const log = options.log ?? ((message: string) => console.error(`[brain] ${message}`));
  return {
    async *respond(state, signal) {
      const request: StreamRequest = {
        model: options.model,
        max_tokens: 1024,
        output_config: { effort: "low" },
        system: [{ type: "text", text: systemPrompt(state.brief), cache_control: { type: "ephemeral" } }],
        messages: toMessages(state),
        tools: TOOLS,
        tool_choice: { type: "auto" },
        ...(options.fallbacks ? { fallbacks: "default" as const, betas: ["server-side-fallback-2026-07-01"] } : {})
      };
      const tools = new Map<number, { name: string; json: string }>();
      const pending: BrainStep[] = [];
      let held: string | undefined;
      try {
        for await (const event of options.stream(request, { signal })) {
          if (signal.aborted) return;
          switch (event.type) {
            case "content_block_start":
              if (event.content_block.type === "tool_use") tools.set(event.index, { name: event.content_block.name, json: "" });
              break;
            case "content_block_delta":
              if (event.delta.type === "text_delta") {
                if (held) yield { kind: "say", text: held, last: false };
                held = event.delta.text;
              } else if (event.delta.type === "input_json_delta") {
                const tool = tools.get(event.index);
                if (tool) tool.json += event.delta.partial_json;
              }
              break;
            case "content_block_stop": {
              const tool = tools.get(event.index);
              if (tool) {
                const parsed = toStep(tool.name, parseJson(tool.json));
                if (parsed) pending.push(parsed);
                else log(`dropped invalid ${tool.name} input: ${tool.json}`);
              } else if (held !== undefined) {
                yield { kind: "say", text: held, last: true };
                held = undefined;
              }
              break;
            }
            case "message_delta":
              if (event.delta.stop_reason === "max_tokens" || event.delta.stop_reason === "refusal") {
                if (pending.length > 0) log(`dropped ${pending.length} tool call(s) after stop_reason ${event.delta.stop_reason}`);
                pending.length = 0;
              }
              break;
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
      if (signal.aborted) return;
      yield* pending;
    }
  };
}

export type ScriptedTurn = { when: RegExp; reply: (match: RegExpMatchArray, state: CallState) => BrainStep[] };

function chunks(text: string): string[] {
  const words = text.split(/(?<= )/);
  const out: string[] = [];
  for (let index = 0; index < words.length; index += 2) out.push(words.slice(index, index + 2).join(""));
  return out;
}

export function scriptedBrain(script: ScriptedTurn[]): Brain {
  return {
    async *respond(state, signal) {
      const latest = state.turns.findLast(turn => turn.speaker !== "agent");
      if (!latest) return;
      for (const rule of script) {
        const match = latest.text.match(rule.when);
        if (!match) continue;
        for (const brainStep of rule.reply(match, state)) {
          if (brainStep.kind !== "say") {
            if (signal.aborted) return;
            yield brainStep;
            continue;
          }
          const parts = chunks(brainStep.text);
          for (const [index, text] of parts.entries()) {
            await Promise.resolve();
            if (signal.aborted) return;
            yield { kind: "say", text, last: brainStep.last && index === parts.length - 1 };
          }
        }
        return;
      }
    }
  };
}
