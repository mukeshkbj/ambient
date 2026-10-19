import type { Language } from "./language.js";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Household } from "../household.js";
import { parsePhoneNumber, type PhoneNumber } from "./types.js";

export type Candidate = { name: string; phone: PhoneNumber; why: string; language?: Language };

export type CreateMessage = (params: Anthropic.MessageCreateParamsNonStreaming) => PromiseLike<Anthropic.Message>;

const Report = z.object({
  candidates: z.array(z.object({ name: z.string().min(1), phone: z.string().min(1), why: z.string() }))
});

const REPORT_TOOL: Anthropic.Tool = {
  name: "report_candidates",
  description: "Report the local businesses worth calling for the request, best first.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            why: { type: "string" }
          },
          required: ["name", "phone", "why"],
          additionalProperties: false
        }
      }
    },
    required: ["candidates"],
    additionalProperties: false
  }
};

function locationFor(household: Household): Anthropic.UserLocation | undefined {
  const { city, region, country } = household;
  if (!city && !region && !country) return undefined;
  return {
    type: "approximate",
    ...(city ? { city } : {}),
    ...(region ? { region } : {}),
    ...(country ? { country } : {})
  };
}

function resendable(blocks: Anthropic.ContentBlock[]): Anthropic.ContentBlockParam[] {
  const params: Anthropic.ContentBlockParam[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        params.push({ type: "text", text: block.text });
        break;
      case "tool_use":
        params.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
        break;
      case "server_tool_use":
        params.push({ type: "server_tool_use", id: block.id, name: block.name, input: block.input });
        break;
      case "web_search_tool_result":
        params.push({ type: "web_search_tool_result", tool_use_id: block.tool_use_id, content: block.content });
        break;
      default:
        break;
    }
  }
  return params;
}

function candidatesFrom(response: Anthropic.Message): Candidate[] | undefined {
  const block = response.content.find(item => item.type === "tool_use" && item.name === "report_candidates");
  if (!block || block.type !== "tool_use") return undefined;
  const parsed = Report.safeParse(block.input);
  if (!parsed.success) return [];
  const candidates: Candidate[] = [];
  for (const candidate of parsed.data.candidates.slice(0, 3)) {
    try {
      candidates.push({ name: candidate.name, phone: parsePhoneNumber(candidate.phone), why: candidate.why });
    } catch {
      continue;
    }
  }
  return candidates;
}

export async function discoverBusiness(create: CreateMessage, goal: string, household: Household): Promise<Candidate[]> {
  const location = locationFor(household);
  const tools: Anthropic.ToolUnion[] = [
    {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: 5,
      ...(location ? { user_location: location } : {})
    },
    REPORT_TOOL
  ];
  const place = [household.city, household.region, household.country].filter(Boolean).join(", ");
  const messages: Anthropic.MessageParam[] = [{
    role: "user",
    content: [
      `Search the web for local businesses${place ? ` near ${place}` : ""} that could handle this request: ${goal}.`,
      "Then call report_candidates with up to 3 businesses to call, best first, each with a phone number and a one-line reason."
    ].join(" ")
  }];
  for (let resends = 0; ; resends++) {
    const response = await create({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      output_config: { effort: "low" },
      tools,
      tool_choice: { type: "auto" },
      messages
    });
    const candidates = candidatesFrom(response);
    if (candidates !== undefined) return candidates;
    if (response.stop_reason !== "pause_turn" || resends === 3) return [];
    messages.push({ role: "assistant", content: resendable(response.content) });
  }
}
