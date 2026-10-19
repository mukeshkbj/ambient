const DEFAULT_API = "https://agents.assemblyai.com/v1";

export type AiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

type AgentSpec = { name: string; greeting: string; systemPrompt: string; voice: string; languageCodes?: string[]; baseUrl: string; secret: string };

type Turn = { agent_text?: string | null; agent_reply_started_at_ms?: number };
type Timeline = { started_at_unix_ms: number; turns?: Turn[] };
export type SessionRecording = { agentId: string | null; audioUrl: string; timeline: Timeline };
export type Clip = { url: string; fromMs: number; toMs: number };

export type AssemblyAi = {
  readonly wsUrl: string;
  mintToken(): Promise<string>;
  createAgent(spec: AgentSpec): Promise<string>;
  retireAgent(id: string): Promise<void>;
  recording(sessionId: string): Promise<SessionRecording | undefined>;
};

async function failed(response: { status: number; text(): Promise<string> }, what: string): Promise<Error> {
  return new Error(`AssemblyAI ${what} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
}

export function assemblyAi(options: { apiKey: string; apiBase?: string; fetch?: AiFetch }): AssemblyAi {
  const send = options.fetch ?? fetch;
  const API = options.apiBase ?? DEFAULT_API;
  return {
    wsUrl: `${API.replace(/^http/, "ws")}/ws`,
    async mintToken() {
      const response = await send(`${API}/token?expires_in_seconds=60&max_session_duration_seconds=1800`, {
        method: "GET",
        headers: { authorization: `Bearer ${options.apiKey}` }
      });
      if (!response.ok) throw await failed(response, "token");
      const body = await response.json() as { token?: unknown };
      if (typeof body.token !== "string") throw new Error("AssemblyAI token response had no token");
      return body.token;
    },
    async createAgent(spec) {
      const response = await send(`${API}/agents`, {
        method: "POST",
        headers: { authorization: options.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          name: spec.name,
          system_prompt: spec.systemPrompt,
          greeting: spec.greeting,
          voice: { voice_id: spec.voice },
          ...(spec.languageCodes ? { input: { language_codes: spec.languageCodes } } : {}),
          llm: [{ base_url: spec.baseUrl, model: "ambient-call", api_key: spec.secret }]
        })
      });
      if (!response.ok) throw await failed(response, "agent create");
      const body = await response.json() as { agent_id?: unknown; id?: unknown };
      const id = body.agent_id ?? body.id;
      if (typeof id !== "string") throw new Error("AssemblyAI agent response had no id");
      return id;
    },
    async retireAgent(id) {
      const response = await send(`${API}/agents/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { authorization: options.apiKey, "content-type": "application/json" },
        body: JSON.stringify({ llm: [] })
      });
      if (!response.ok) throw await failed(response, "agent retire");
    },
    async recording(sessionId) {
      const response = await send(`${API}/sessions/${encodeURIComponent(sessionId)}`, { method: "GET", headers: { authorization: options.apiKey } });
      if (!response.ok) throw await failed(response, "session");
      const body = await response.json() as { agent_id?: unknown; artifacts?: { type?: unknown; url?: unknown }[] };
      const artifact = (type: string) => body.artifacts?.find(item => item.type === type)?.url;
      const audioUrl = artifact("audio");
      const timelineUrl = artifact("timeline");
      if (typeof audioUrl !== "string" || typeof timelineUrl !== "string") return undefined;
      const timeline = await send(timelineUrl, { method: "GET", headers: {} });
      if (!timeline.ok) throw await failed(timeline, "timeline");
      return { agentId: typeof body.agent_id === "string" ? body.agent_id : null, audioUrl, timeline: await timeline.json() as Timeline };
    }
  };
}

export function chatChunk(text: string, finish = false): string {
  const choice = finish ? { index: 0, delta: {}, finish_reason: "stop" } : { index: 0, delta: { role: "assistant", content: text }, finish_reason: null };
  return `data: ${JSON.stringify({ id: "chatcmpl-ambient", object: "chat.completion.chunk", created: 0, model: "ambient-call", choices: [choice] })}\n\n`;
}

export const CHAT_DONE = "data: [DONE]\n\n";

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

export function proofClip(recording: SessionRecording, readBack: string, readBackAt: string): Clip {
  const { started_at_unix_ms: start, turns = [] } = recording.timeline;
  const spoken = turns.filter(turn => typeof turn.agent_reply_started_at_ms === "number");
  const at = spoken.findLastIndex(turn => squash(turn.agent_text ?? "").includes(squash(readBack)));
  const from = at >= 0 ? spoken[at]!.agent_reply_started_at_ms! - start : Math.max(0, Date.parse(readBackAt) - start - 500);
  const next = at >= 0 ? spoken[at + 1]?.agent_reply_started_at_ms : undefined;
  return { url: recording.audioUrl, fromMs: from, toMs: next !== undefined ? next - start + 2_500 : from + 20_000 };
}
