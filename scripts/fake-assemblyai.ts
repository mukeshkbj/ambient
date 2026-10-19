import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import type { BusinessPersona } from "../src/calls/line.js";

export const REQUEST_SHAPE =
  "Request shape to /chat/completions is our assumption from the docs, which do not publish it (friction log 6): " +
  "Bearer <llm.api_key>, model, stream true, messages = system prompt then user and assistant turns, no tools.";

type Agent = { greeting: string; systemPrompt: string; llm: { base_url: string; model: string; api_key: string }[] };
type Session = { agent: Agent; history: { role: "user" | "assistant"; content: string }[]; turn: Promise<void> };
type Recorded = { agentId: string; startedAt: number; turns: { agent_text: string; agent_reply_started_at_ms: number }[]; completed: boolean };

export type FakeAssemblyAi = {
  apiBase: string;
  transcript: string[];
  agents: Map<string, Agent>;
  close(): Promise<void>;
};

const SILENCE = Buffer.alloc(480).toString("base64");

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

function reply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

export async function sseData(response: Response, onData: (data: string) => void): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    buffered += decoder.decode(part.value, { stream: true });
    const frames = buffered.split("\n\n");
    buffered = frames.pop() ?? "";
    for (const frame of frames) if (frame.startsWith("data: ")) onData(frame.slice(6));
  }
}

async function completion(agent: Agent, history: Session["history"]): Promise<string> {
  const llm = agent.llm[0]!;
  const response = await fetch(`${llm.base_url}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${llm.api_key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: llm.model, stream: true, messages: [{ role: "system", content: agent.systemPrompt }, ...history] })
  });
  if (!response.ok) throw new Error(`/chat/completions answered ${response.status}`);
  let text = "";
  await sseData(response, data => {
    if (data === "[DONE]") return;
    text += (JSON.parse(data) as { choices: { delta: { content?: string } }[] }).choices[0]?.delta.content ?? "";
  });
  return text;
}

export async function startFakeAssemblyAi(options: { apiKey: string; persona: BusinessPersona; pauseMs?: number }): Promise<FakeAssemblyAi> {
  const agents = new Map<string, Agent>();
  const recorded = new Map<string, Recorded>();
  const tokens = new Set<string>();
  const transcript: string[] = [];
  const sockets = new Set<WebSocket>();
  const pauseMs = options.pauseMs ?? 40;
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const http = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://fake.invalid");
      const agentId = /^\/v1\/agents\/([^/]+)$/.exec(url.pathname)?.[1];
      const artifact = /^\/artifacts\/([^/]+)\/(audio\.ogg|timeline\.json)$/.exec(url.pathname);
      if (artifact && request.method === "GET") {
        const session = recorded.get(artifact[1]!);
        if (!session) return reply(response, 404, { error: "not_found" });
        return reply(response, 200, { session_id: artifact[1], started_at_unix_ms: session.startedAt, turns: session.turns });
      }
      if (url.pathname === "/v1/token" && request.method === "GET") {
        if (request.headers.authorization !== `Bearer ${options.apiKey}`) return reply(response, 401, { error: "unauthorized" });
        const token = randomUUID();
        tokens.add(token);
        return reply(response, 200, { token, expires_in_seconds: 60 });
      }
      if (request.headers.authorization !== options.apiKey) return reply(response, 401, { error: "unauthorized" });
      if (url.pathname === "/v1/agents" && request.method === "POST") {
        const body = await readBody(request);
        const id = randomUUID();
        agents.set(id, {
          greeting: String(body.greeting),
          systemPrompt: String(body.system_prompt),
          llm: body.llm as Agent["llm"]
        });
        return reply(response, 200, { agent_id: id });
      }
      const sessionId = /^\/v1\/sessions\/([^/]+)$/.exec(url.pathname)?.[1];
      const session = sessionId ? recorded.get(sessionId) : undefined;
      if (session && request.method === "GET") {
        const root = `http://127.0.0.1:${(http.address() as AddressInfo).port}/artifacts/${sessionId}`;
        const artifacts = session.completed ? [{ type: "audio", url: `${root}/audio.ogg`, content_type: "audio/ogg" }, { type: "timeline", url: `${root}/timeline.json`, content_type: "application/json" }] : [];
        return reply(response, 200, { id: sessionId, agent_id: session.agentId, status: session.completed ? "completed" : "active", artifacts });
      }
      const agent = agentId ? agents.get(agentId) : undefined;
      if (agent && request.method === "PUT") {
        agent.llm = (await readBody(request)).llm as Agent["llm"];
        return reply(response, 200, { agent_id: agentId });
      }
      reply(response, 404, { error: "not_found" });
    })().catch(() => reply(response, 500, { error: "fake failed" }));
  });

  const wss = new WebSocketServer({ noServer: true });
  http.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://fake.invalid");
    const token = url.searchParams.get("token") ?? "";
    if (url.pathname !== "/v1/ws" || !tokens.delete(token)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, ws => connect(ws));
  });

  function connect(ws: WebSocket): void {
    sockets.add(ws);
    ws.on("close", () => {
      sockets.delete(ws);
      if (recording) recording.completed = true;
    });
    let session: Session | undefined;
    let recording: Recorded | undefined;
    const send = (value: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(value));
    const speak = (text: string) => {
      const replyId = randomUUID();
      send({ type: "reply.started", reply_id: replyId, item_id: randomUUID() });
      send({ type: "reply.audio", data: SILENCE });
      recording?.turns.push({ agent_text: text, agent_reply_started_at_ms: Date.now() });
      send({ type: "transcript.agent", text, reply_id: replyId, item_id: randomUUID(), interrupted: false });
      send({ type: "reply.done", reply_id: replyId, status: "completed" });
      transcript.push(`Ambient: ${text}`);
    };
    const businessSays = async (text: string) => {
      await sleep(pauseMs);
      send({ type: "transcript.user", text, item_id: randomUUID() });
      transcript.push(`${options.persona.name}: ${text}`);
      session!.history.push({ role: "user", content: text });
      await agentReplies();
    };
    const agentReplies = async () => {
      const current = session!;
      const text = await completion(current.agent, current.history);
      if (!text) return;
      current.history.push({ role: "assistant", content: text });
      speak(text);
      const rule = /\bgoodbye\b/i.test(text) ? undefined : options.persona.rules.find(item => item.when.test(text));
      if (rule?.reply) await businessSays(rule.reply);
    };
    const queue = (work: () => Promise<void>) => {
      session!.turn = session!.turn.then(work).catch((error: unknown) => {
        send({ type: "session.error", code: "server_error", message: error instanceof Error ? error.message : String(error) });
      });
    };
    ws.on("message", raw => {
      const message = JSON.parse((raw as Buffer).toString()) as { type?: string; session?: { agent_id?: string } };
      if (message.type === "session.update" && !session) {
        const agent = agents.get(message.session?.agent_id ?? "");
        if (!agent) return void send({ type: "session.error", code: "agent_not_found", message: "No such agent" });
        session = { agent, history: [], turn: Promise.resolve() };
        const id = `sess_${randomUUID().replaceAll("-", "")}`;
        recording = { agentId: message.session!.agent_id!, startedAt: Date.now(), turns: [], completed: false };
        recorded.set(id, recording);
        send({ type: "session.ready", session_id: id });
        speak(agent.greeting);
        queue(() => businessSays(options.persona.opening));
      } else if (message.type === "reply.create" && session) {
        queue(agentReplies);
      } else if (message.type === "session.end") {
        send({ type: "session.ended" });
        ws.close();
      }
    });
  }

  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  return {
    apiBase: `http://127.0.0.1:${(http.address() as AddressInfo).port}/v1`,
    transcript,
    agents,
    close: async () => {
      for (const ws of sockets) ws.terminate();
      wss.close();
      http.closeAllConnections();
      await new Promise<void>(resolve => http.close(() => resolve()));
    }
  };
}
