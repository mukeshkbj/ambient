import { describe, expect, it } from "vitest";
import { assemblyAi, type AiFetch } from "../src/calls/assemblyai.js";
import { scriptedBrain } from "../src/calls/brain.js";
import { runCall } from "../src/calls/call.js";
import { DEMO_SCRIPT } from "../src/calls/demo.js";
import { CallRooms, type PageEvent } from "../src/calls/rooms.js";
import { disclosure } from "../src/calls/rules.js";
import { parsePhoneNumber, type CallBrief, type LineInput } from "../src/calls/types.js";

type Sent = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeFetch(sent: Sent[]): AiFetch {
  return async (url, init) => {
    sent.push({ url, ...init });
    const payload = url.includes("/v1/token") ? { token: "tok-1", expires_in_seconds: 60 } : { agent_id: "agent-1" };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
}

function writer() {
  const chunks: string[] = [];
  let ended = false;
  return {
    sink: { write: (chunk: string) => { chunks.push(chunk); }, end: () => { ended = true; } },
    text: () => chunks.filter(chunk => chunk.startsWith("data: {")).map(chunk => JSON.parse(chunk.slice(6)) as { choices: { delta: { content?: string } }[] })
      .map(chunk => chunk.choices[0]?.delta.content ?? "").join(""),
    done: () => ended && chunks.at(-1) === "data: [DONE]\n\n"
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setup() {
  const sent: Sent[] = [];
  const rooms = new CallRooms({ ai: assemblyAi({ apiKey: "aai-key", fetch: fakeFetch(sent) }), publicBaseUrl: "https://ambient.example.com", chatTimeoutMs: 50 });
  const line = rooms.line();
  const inputs: LineInput[] = [];
  line.onInput(input => inputs.push(input));
  const page: PageEvent[] = [];
  return { sent, rooms, line, inputs, page };
}

const user = (content: string) => ({ role: "user", content });

describe("assemblyAi", () => {
  it("mints a one-use browser token with the key as a bearer token", async () => {
    const sent: Sent[] = [];
    expect(await assemblyAi({ apiKey: "aai-key", fetch: fakeFetch(sent) }).mintToken()).toBe("tok-1");
    expect(sent[0]).toMatchObject({ method: "GET", headers: { authorization: "Bearer aai-key" } });
    expect(sent[0]?.url).toMatch(/^https:\/\/agents\.assemblyai\.com\/v1\/token\?expires_in_seconds=60&max_session_duration_seconds=1800$/);
  });
});

describe("CallRooms line", () => {
  it("creates a per-call agent whose verbatim greeting is the AI disclosure and whose LLM is our endpoint", async () => {
    const { sent, line } = setup();
    await line.dial(parsePhoneNumber("4155550134"), "call-1", "Maya");
    const create = sent.find(item => item.url === "https://agents.assemblyai.com/v1/agents");
    const body = JSON.parse(create?.body ?? "{}") as { greeting: string; llm: { base_url: string; api_key: string }[] };
    expect(create).toMatchObject({ method: "POST", headers: { authorization: "aai-key" } });
    expect(body.greeting).toBe(disclosure("Maya"));
    expect(body.llm).toHaveLength(1);
    expect(body.llm[0]?.base_url).toBe("https://ambient.example.com/call/call-1/v1");
    expect(body.llm[0]?.api_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(line.joinUrl).toBe("https://ambient.example.com/call/call-1");
  });

  it("answers when the business's page is ready, and hands the page a token and agent", async () => {
    const { rooms, line, inputs } = setup();
    await line.dial(parsePhoneNumber("4155550134"), "call-1", "Maya");
    const room = rooms.room("call-1")!;
    expect(await room.session()).toEqual({ token: "tok-1", agentId: "agent-1", ownerName: "Maya" });
    room.pageEvent({ type: "ready" });
    expect(inputs).toEqual([{ kind: "answered" }]);
  });

  it("turns each new business turn into heard and streams back exactly what the call says", async () => {
    const { rooms, line, inputs } = setup();
    await line.dial(parsePhoneNumber("4155550134"), "call-1", "Maya");
    const room = rooms.room("call-1")!;
    room.pageEvent({ type: "ready" });
    const reply = writer();
    const secret = room.secret;
    expect(room.chat({ messages: [{ role: "system", content: "x" }, user("Joe's Plumbing, how can I help?")] }, `Bearer ${secret}`, reply.sink)).toBe(true);
    expect(inputs.at(-1)).toEqual({ kind: "heard", text: "Joe's Plumbing, how can I help?" });
    line.say("Hi Joe. ", false);
    line.say("I need a plumber.", true);
    expect(reply.text()).toBe("Hi Joe. I need a plumber.");
    expect(reply.done()).toBe(true);
  });

  it("does not repeat a business turn it already passed on", async () => {
    const { rooms, line, inputs } = setup();
    await line.dial(parsePhoneNumber("4155550134"), "call-1", "Maya");
    const room = rooms.room("call-1")!;
    room.chat({ messages: [user("Hello?")] }, `Bearer ${room.secret}`, writer().sink);
    room.chat({ messages: [user("Hello?"), { role: "assistant", content: "Hi" }] }, `Bearer ${room.secret}`, writer().sink);
    expect(inputs.filter(input => input.kind === "heard")).toHaveLength(1);
  });

  it("rejects chat calls without the call's secret", async () => {
    const { rooms, line } = setup();
    await line.dial(parsePhoneNumber("4155550134"), "call-1", "Maya");
    expect(rooms.room("call-1")!.chat({ messages: [user("hi")] }, "Bearer nope", writer().sink)).toBe(false);
  });

  it("asks the page to prompt a reply when the call speaks between business turns, then streams it", async () => {
    const { rooms, line } = setup();
    await line.dial(parsePhoneNumber("4155550134"), "call-1", "Maya");
    const room = rooms.room("call-1")!;
    const page: PageEvent[] = [];
    room.attach(event => page.push(event));
    line.say("Still checking with Maya, thanks for holding.", true);
    expect(page).toEqual([{ type: "speak" }]);
    const reply = writer();
    room.chat({ messages: [] }, `Bearer ${room.secret}`, reply.sink);
    expect(reply.text()).toBe("Still checking with Maya, thanks for holding.");
    expect(reply.done()).toBe(true);
  });

  it("ends an empty reply when the call has nothing to say yet", async () => {
    const { rooms, line } = setup();
    await line.dial(parsePhoneNumber("4155550134"), "call-1", "Maya");
    const room = rooms.room("call-1")!;
    const reply = writer();
    room.chat({ messages: [user("Are you there?")] }, `Bearer ${room.secret}`, reply.sink);
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(reply.done()).toBe(true);
    expect(reply.text()).toBe("");
  });

  it("reports what the business actually heard when they talk over the agent", async () => {
    const { rooms, line, inputs } = setup();
    await line.dial(parsePhoneNumber("4155550134"), "call-1", "Maya");
    rooms.room("call-1")!.pageEvent({ type: "interrupted", spokenSoFar: "We could do" });
    expect(inputs.at(-1)).toEqual({ kind: "interrupted", spokenSoFar: "We could do" });
  });

  it("hangs up through the page after the last words, and ends the line when the page closes", async () => {
    const { rooms, line, inputs } = setup();
    await line.dial(parsePhoneNumber("4155550134"), "call-1", "Maya");
    const room = rooms.room("call-1")!;
    const page: PageEvent[] = [];
    room.attach(event => page.push(event));
    room.pageEvent({ type: "ready" });
    line.hangUp();
    expect(page).toContainEqual({ type: "hangup" });
    room.pageEvent({ type: "ended" });
    expect(inputs.at(-1)).toEqual({ kind: "line_ended", reason: "hangup" });
    expect(rooms.room("call-1")).toBeUndefined();
  });

  it("ends with no answer when nobody opens the link in time", async () => {
    const sent: Sent[] = [];
    const rooms = new CallRooms({ ai: assemblyAi({ apiKey: "k", fetch: fakeFetch(sent) }), publicBaseUrl: "https://a.example.com", joinTimeoutMs: 20 });
    const line = rooms.line();
    const inputs: LineInput[] = [];
    line.onInput(input => inputs.push(input));
    await line.dial(parsePhoneNumber("4155550134"), "call-2", "Maya");
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(inputs).toEqual([{ kind: "line_ended", reason: "no_answer" }]);
  });

  it("runs a whole scripted call through the room to an honest outcome", async () => {
    const sent: Sent[] = [];
    const rooms = new CallRooms({ ai: assemblyAi({ apiKey: "k", fetch: fakeFetch(sent) }), publicBaseUrl: "https://a.example.com", chatTimeoutMs: 500 });
    const brief: CallBrief = { goal: "Book a sink repair", business: { name: "Joe's Plumbing", phone: parsePhoneNumber("4155550134") }, ownerName: "Maya", maxUsd: 200, facts: [] };
    const call = runCall({ brief, callId: "call-3", line: rooms.line(), brain: scriptedBrain(DEMO_SCRIPT), emit: () => {}, log: () => {} });
    await flush();
    await flush();
    const room = rooms.room("call-3")!;
    room.attach(() => {});
    room.pageEvent({ type: "ready" });
    const turns = ["Joe's Plumbing, how can I help?", "Sure, we can come Tuesday at ten. It'll be one eighty.", "Great, you're booked for Tuesday at ten. That's one eighty."];
    const said: string[] = [];
    const history: { role: string; content: string }[] = [];
    for (const turn of turns) {
      history.push(user(turn));
      const reply = writer();
      room.chat({ messages: history }, `Bearer ${room.secret}`, reply.sink);
      for (let tries = 0; tries < 50 && !reply.done(); tries++) await flush();
      said.push(reply.text());
      history.push({ role: "assistant", content: reply.text() });
    }
    room.pageEvent({ type: "ended" });
    const final = await call.done;
    expect(said[0]).toMatch(/^Hi Joe\./);
    expect(final.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", amountUsd: 180 } });
  });
});
