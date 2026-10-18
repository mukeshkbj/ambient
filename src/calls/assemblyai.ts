const API = "https://agents.assemblyai.com/v1";

export type AiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

type AgentSpec = { name: string; greeting: string; systemPrompt: string; voice: string; baseUrl: string; secret: string };

export type AssemblyAi = {
  mintToken(): Promise<string>;
  createAgent(spec: AgentSpec): Promise<string>;
  retireAgent(id: string): Promise<void>;
};

async function failed(response: { status: number; text(): Promise<string> }, what: string): Promise<Error> {
  return new Error(`AssemblyAI ${what} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
}

export function assemblyAi(options: { apiKey: string; fetch?: AiFetch }): AssemblyAi {
  const send = options.fetch ?? fetch;
  return {
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
    }
  };
}

export function chatChunk(text: string, finish = false): string {
  const choice = finish ? { index: 0, delta: {}, finish_reason: "stop" } : { index: 0, delta: { role: "assistant", content: text }, finish_reason: null };
  return `data: ${JSON.stringify({ id: "chatcmpl-ambient", object: "chat.completion.chunk", created: 0, model: "ambient-call", choices: [choice] })}\n\n`;
}

export const CHAT_DONE = "data: [DONE]\n\n";
