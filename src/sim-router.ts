import { BedrockRuntimeClient, ConverseCommand, type Tool } from "@aws-sdk/client-bedrock-runtime";

export type RoutedCall = {
  name: string;
  args: Record<string, unknown>;
};

export type AgentName = { id: string; label: string };

const FILLER = new Set([
  "the", "a", "an", "my", "me", "to", "of", "for", "on", "in", "it", "that", "this", "please",
  "can", "could", "you", "what", "whats", "what's", "is", "are", "any", "status", "work", "task",
  "about", "tell", "check", "how", "how's", "hows", "the", "doing", "going", "now", "agent", "agents", "assistant"
]);

function tail(utterance: string, trigger: RegExp): string | undefined {
  const rest = utterance.replace(trigger, " ").replace(/[?!.]+$/, "").trim();
  const words = rest.split(/\s+/).filter(word => word && !FILLER.has(word.toLowerCase()));
  return words.length > 0 ? words.join(" ") : undefined;
}

/** Which agent label/id is named inside the utterance, if any. */
function namedAgent(utterance: string, agents: AgentName[]): string | undefined {
  const norm = utterance.toLowerCase();
  return agents.find(agent =>
    norm.includes(agent.label.toLowerCase()) || norm.includes(agent.id.toLowerCase().replace(/-/g, " "))
  )?.label;
}

/**
 * Deterministic utterance → tool mapping so the simulator works with zero
 * credentials. Bedrock (when present) upgrades this to real intent routing.
 */
export function keywordRoute(utterance: string, agents: AgentName[]): RoutedCall {
  const text = utterance.toLowerCase().trim();
  const agent = namedAgent(text, agents);

  if (/\b(deny|denied|decline|declined|reject|refuse|no\b)/.test(text) && /\b(approve|deny|decline|reject|request|approval|booking|deploy|it|that|them)/.test(text)) {
    const about = tail(text, /\b(deny|decline|reject|refuse|no)\b/);
    return { name: "approve", args: { decision: "deny", ...(about ? { about } : {}) } };
  }
  if (/\b(approve|allow|accept|yes|go ahead|do it|book it|confirm)\b/.test(text)) {
    const about = tail(text, /\b(approve|allow|accept|yes|go ahead|confirm)\b/);
    return { name: "approve", args: { decision: "approve", ...(about && about !== "it" ? { about } : {}) } };
  }
  if (/\b(stop|cancel|abort|kill)\b/.test(text)) {
    const about = tail(text, /\b(stop|cancel|abort|kill)\b/);
    return { name: "stop", args: { ...(about ? { about } : {}) } };
  }
  if (/^(use|switch to|talk to)\s+/.test(text)) {
    return { name: "agents", args: { use: text.replace(/^(use|switch to|talk to)\s+/, "").trim() } };
  }
  if (/\b(briefing|brief me|catch me up|what did|summary of|summarize|recap)\b/.test(text)) {
    return { name: "briefing", args: {} };
  }
  if (/\b(agents?|assistants?)\b/.test(text) && /\b(list|what|who|which|have|got|available|online|there)\b/.test(text)) {
    return { name: "agents", args: {} };
  }
  if (/\b(status|how'?s|hows|where'?s|wheres|check on|progress|update on|happening|what'?s up with|doing)\b/.test(text)) {
    const about = tail(text, /\b(status|how'?s|hows|where'?s|wheres|check on|progress|update on|happening|what'?s up with|doing)\b/);
    return { name: "status", args: { ...(about ? { about } : {}), ...(agent ? { agent } : {}) } };
  }
  return { name: "delegate", args: { task: utterance, ...(agent ? { agent } : {}) } };
}

/**
 * Bedrock-backed tool choice: the real intent router when AWS credentials are
 * available. Returns undefined when Bedrock is unreachable so callers fall back
 * to the keyword router.
 */
export async function bedrockRoute(
  utterance: string,
  tools: { name: string; description?: string; inputSchema?: Record<string, unknown> | undefined }[],
  agents: AgentName[],
  env: Record<string, string | undefined>
): Promise<RoutedCall | undefined> {
  if (!env.AWS_REGION && !env.AWS_DEFAULT_REGION && !env.AWS_ACCESS_KEY_ID && !env.BEDROCK_MODEL_ID) return undefined;
  try {
    const client = new BedrockRuntimeClient({ region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "us-east-1" });
    const toolSpecs: Tool[] = tools.map(tool => ({
      toolSpec: {
        name: tool.name,
        description: tool.description ?? tool.name,
        inputSchema: { json: (tool.inputSchema ?? { type: "object", properties: {} }) as never }
      }
    }));
    const response = await client.send(new ConverseCommand({
      modelId: env.SIM_MODEL_ID ?? env.BEDROCK_MODEL_ID ?? "amazon.nova-lite-v1:0",
      system: [{
        text: `You are the voice layer between a user and their personal AI agents (known: ${agents.map(a => a.label).join(", ")}). ` +
          "Map each spoken utterance to exactly one tool call. For delegate, pass the user's words as the task. " +
          "Use 'about' with a few words from the task the user means — never invent ids."
      }],
      messages: [{ role: "user", content: [{ text: utterance }] }],
      toolConfig: { tools: toolSpecs, toolChoice: { auto: {} } }
    }));
    const toolUse = response.output?.message?.content?.find(block => "toolUse" in block)?.toolUse;
    if (!toolUse?.name) return undefined;
    return { name: toolUse.name, args: (toolUse.input ?? {}) as Record<string, unknown> };
  } catch {
    return undefined;
  }
}
