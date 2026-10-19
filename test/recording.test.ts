import { describe, expect, it } from "vitest";
import { assemblyAi, proofClip, type AiFetch, type SessionRecording } from "../src/calls/assemblyai.js";
import { lines } from "../src/calls/language.js";
import { CallRooms } from "../src/calls/rooms.js";
import { startCall, step, type CallState } from "../src/calls/session.js";
import { parsePhoneNumber, type CallBrief, type CallInput, type LineInput, type ProofOfYes } from "../src/calls/types.js";
import { createMcpServer } from "../src/mcp.js";
import type { RuntimeRegistry } from "../src/runtimes/registry.js";

type Sent = { url: string; method: string; body?: string };

const START = 1_800_000_000_000;
const READ_BACK = "Okay, so just to confirm, one hundred sixty dollars total, Tuesday at three. Is that right?";
const TIMELINE = {
  started_at_unix_ms: START,
  turns: [
    { agent_text: "Hi, this is an AI assistant calling for Maya. This call is transcribed.", agent_reply_started_at_ms: START + 200 },
    { agent_text: READ_BACK, agent_reply_started_at_ms: START + 41_000 },
    { agent_text: null },
    { agent_text: "Great, that's set for Tuesday at three. Thanks so much, bye.", agent_reply_started_at_ms: START + 49_000 }
  ]
};

function fakeFetch(sent: Sent[], session: unknown = {
  agent_id: "agent-1",
  artifacts: [
    { type: "audio", url: "https://s3.example.com/audio.ogg?sig=1", content_type: "audio/ogg" },
    { type: "timeline", url: "https://s3.example.com/timeline.json?sig=1", content_type: "application/json" }
  ]
}): AiFetch {
  return async (url, init) => {
    sent.push({ url, method: init.method, ...(init.body ? { body: init.body } : {}) });
    const payload = url.includes("/v1/token") ? { token: "tok-1" } : url.includes("/sessions/") ? session : url.includes("timeline.json") ? TIMELINE : { agent_id: "agent-1" };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
}

const recording = (timeline = TIMELINE): SessionRecording => ({ agentId: "agent-1", audioUrl: "https://s3.example.com/audio.ogg", timeline });

describe("the live line speaks the business's language", () => {
  it("gives a Spanish call the Spanish voice, Spanish speech recognition and the Spanish disclosure", async () => {
    const sent: Sent[] = [];
    const rooms = new CallRooms({ ai: assemblyAi({ apiKey: "k", fetch: fakeFetch(sent) }), publicBaseUrl: "https://ambient.example.com" });
    await rooms.line().dial(parsePhoneNumber("4155550134"), "call-es", "Maya", "Fix the sink", "es");
    expect(rooms.room("call-es")!.info()).toMatchObject({ ownerName: "Maya", language: "es" });
    const body = JSON.parse(sent.find(item => item.url.endsWith("/v1/agents"))?.body ?? "{}") as Record<string, unknown>;
    expect(body.voice).toEqual({ voice_id: "lola" });
    expect(body.input).toEqual({ language_codes: ["es"] });
    expect(body.greeting).toBe(lines("es").disclosure("Maya"));
  });

  it("leaves an English call on the configured voice with automatic language detection", async () => {
    const sent: Sent[] = [];
    const line = new CallRooms({ ai: assemblyAi({ apiKey: "k", fetch: fakeFetch(sent) }), publicBaseUrl: "https://ambient.example.com", voice: "mary" }).line();
    await line.dial(parsePhoneNumber("4155550134"), "call-en", "Maya");
    const body = JSON.parse(sent.find(item => item.url.endsWith("/v1/agents"))?.body ?? "{}") as Record<string, unknown>;
    expect(body.voice).toEqual({ voice_id: "mary" });
    expect(body).not.toHaveProperty("input");
  });
});

describe("the proof of yes points at the call recording", () => {
  it("ties the recording to the call when the business page reports its voice session", async () => {
    const rooms = new CallRooms({ ai: assemblyAi({ apiKey: "k", fetch: fakeFetch([]) }), publicBaseUrl: "https://ambient.example.com" });
    const line = rooms.line();
    const inputs: LineInput[] = [];
    line.onInput(input => inputs.push(input));
    await line.dial(parsePhoneNumber("4155550134"), "call-1", "Maya");
    rooms.room("call-1")!.pageEvent({ type: "ready", sessionId: "sess_1" });
    expect(inputs).toEqual([{ kind: "answered", recording: { sessionId: "sess_1", agentId: "agent-1" } }]);
  });

  it("keeps the recording in the confirmed outcome's proof", () => {
    const brief: CallBrief = { goal: "Fix the sink", business: { name: "Joe's Plumbing", phone: parsePhoneNumber("4155550134") }, ownerName: "Maya", maxUsd: 200, facts: [] };
    let state: CallState = startCall(brief, "call-1").state;
    const inputs: CallInput[] = [
      { kind: "answered", recording: { sessionId: "sess_1", agentId: "agent-1" } },
      { kind: "heard", text: "It's $160 for Tuesday at three." },
      { kind: "brain", turn: 1, step: { kind: "end_call", outcome: { kind: "confirmed", summary: "", amountUsd: 160, when: "Tuesday at three" } } },
      { kind: "played", text: READ_BACK },
      { kind: "heard", text: "Yes, that's right." }
    ];
    inputs.forEach((input, index) => { state = step(state, input, new Date(START + index * 1000).toISOString()).state; });
    expect(state.phase).toMatchObject({ kind: "ended", outcome: { kind: "confirmed", proof: { readBack: READ_BACK, yes: "Yes, that's right.", recording: { sessionId: "sess_1", agentId: "agent-1" } } } });
  });

  it("clips the recording from the read-back to just after the business's yes", () => {
    expect(proofClip(recording(), READ_BACK, new Date(START + 40_000).toISOString())).toEqual({ url: "https://s3.example.com/audio.ogg", fromMs: 41_000, toMs: 51_500 });
  });

  it("falls back to the read-back's own clock time when the timeline does not hold its words", () => {
    const clip = proofClip(recording({ started_at_unix_ms: START, turns: [] }), READ_BACK, new Date(START + 30_000).toISOString());
    expect(clip).toEqual({ url: "https://s3.example.com/audio.ogg", fromMs: 29_500, toMs: 49_500 });
  });

  it("refuses a recording from another agent, so a business page cannot point the proof at a different call", async () => {
    const proof: ProofOfYes = { readBack: READ_BACK, readBackAt: new Date(START).toISOString(), yes: "Yes.", yesAt: new Date(START).toISOString(), recording: { sessionId: "sess_1", agentId: "agent-2" } };
    const rooms = new CallRooms({ ai: assemblyAi({ apiKey: "k", fetch: fakeFetch([]) }), publicBaseUrl: "https://ambient.example.com" });
    expect(await rooms.proofAudio(proof)).toBeUndefined();
    expect(await rooms.proofAudio({ ...proof, recording: { sessionId: "sess_1", agentId: "agent-1" } })).toMatchObject({ fromMs: 41_000 });
  });

  it("has no recording while the session has no artifacts yet", async () => {
    const sent: Sent[] = [];
    expect(await assemblyAi({ apiKey: "k", fetch: fakeFetch(sent, { agent_id: "agent-1", artifacts: [] }) }).recording("sess_1")).toBeUndefined();
    expect(sent.map(item => item.url)).toEqual(["https://agents.assemblyai.com/v1/sessions/sess_1"]);
  });

  it("answers the card's hear_proof call with the clip, and offers no such tool without a live line", async () => {
    const proof: ProofOfYes = { readBack: READ_BACK, readBackAt: new Date(START).toISOString(), yes: "Yes.", yesAt: new Date(START).toISOString(), recording: { sessionId: "sess_1", agentId: "agent-1" } };
    const registry = { engineForRun: () => ({ getWork: () => ({ outcome: { kind: "confirmed", summary: "", proof } }) }) } as unknown as RuntimeRegistry;
    const tools = (server: unknown) => (server as { _registeredTools: Record<string, { handler(args: unknown, extra: unknown): Promise<{ structuredContent: Record<string, unknown> }> }> })._registeredTools;
    expect(tools(createMcpServer({ registry }))).not.toHaveProperty("hear_proof");
    const clip = { url: "https://s3.example.com/audio.ogg", fromMs: 41_000, toMs: 51_500 };
    const result = await tools(createMcpServer({ registry, hearProof: async given => given === proof ? clip : undefined })).hear_proof!.handler({ taskId: "run-1" }, {});
    expect(result.structuredContent).toMatchObject(clip);
  });
});
