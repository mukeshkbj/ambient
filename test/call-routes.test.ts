import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleCallRoute } from "../src/call-routes.js";
import type { AiFetch } from "../src/calls/assemblyai.js";
import { assemblyAi } from "../src/calls/assemblyai.js";
import { CallRooms } from "../src/calls/rooms.js";
import { parsePhoneNumber, type LineInput } from "../src/calls/types.js";

const CALL = "0b8a0a2e-5c55-4e47-9a51-3d7c0f6a2b10";
const fakeFetch: AiFetch = async url => {
  const payload = url.includes("/token") ? { token: "tok" } : { agent_id: "agent-9" };
  return { ok: true, status: 200, json: async () => payload, text: async () => "" };
};

let server: Server | undefined;
let captureDir: string | undefined;
afterEach(async () => {
  await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
  if (captureDir) rmSync(captureDir, { recursive: true, force: true });
  captureDir = undefined;
});

async function start(capture = false) {
  if (capture) captureDir = mkdtempSync(join(tmpdir(), "ambient-capture-"));
  const rooms = new CallRooms({ ai: assemblyAi({ apiKey: "k", fetch: fakeFetch }), publicBaseUrl: "https://a.example.com", chatTimeoutMs: 50 });
  const line = rooms.line();
  const inputs: LineInput[] = [];
  line.onInput(input => inputs.push(input));
  await line.dial(parsePhoneNumber("4155550134"), CALL, "Maya");
  server = createServer((request, response) => {
    void handleCallRoute(rooms, join(process.cwd(), "web", "call"), request, response, new URL(request.url ?? "/", "http://x").pathname, captureDir).then(handled => {
      if (!handled) { response.statusCode = 404; response.end(); }
    });
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/call/${CALL}`;
  return { rooms, line, inputs, base };
}

describe("call routes", () => {
  it("serves the answer page while the call is live and an ended page after", async () => {
    const { base, rooms } = await start();
    const live = await fetch(base);
    expect(live.status).toBe(200);
    expect(await live.text()).toContain("AI assistant");
    rooms.room(CALL)!.pageEvent({ type: "ended" });
    const gone = await fetch(base);
    expect(gone.status).toBe(404);
    expect(await gone.text()).toContain("This call has ended");
  });

  it("tells the page who the call is for before anyone answers", async () => {
    const { base } = await start();
    expect(await (await fetch(`${base}/info`)).json()).toEqual({ ownerName: "Maya" });
  });

  it("hands the page a session and accepts events only with that session's key", async () => {
    const { base, inputs } = await start();
    const session = await (await fetch(`${base}/session`, { method: "POST" })).json() as { pageKey: string };
    expect(session).toEqual({ token: "tok", agentId: "agent-9", ownerName: "Maya", pageKey: expect.stringMatching(/^[0-9a-f-]{36}$/), wsUrl: "wss://agents.assemblyai.com/v1/ws" });
    const event = (body: string, key = session.pageKey) => fetch(`${base}/event`, { method: "POST", headers: { "x-page-key": key }, body });
    expect((await event(JSON.stringify({ type: "ended" }), "wrong")).status).toBe(403);
    expect((await fetch(`${base}/event`, { method: "POST", body: JSON.stringify({ type: "ended" }) })).status).toBe(403);
    expect((await event(JSON.stringify({ type: "ready" }))).status).toBe(200);
    expect((await event(JSON.stringify({ type: "bogus" }))).status).toBe(400);
    expect((await event("{not json")).status).toBe(400);
    expect((await event("x".repeat(2_000_001))).status).toBe(413);
    expect(inputs).toEqual([{ kind: "answered" }]);
  });

  it("streams chat completions only for the call's secret", async () => {
    const { base, rooms, line } = await start();
    const denied = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { authorization: "Bearer wrong" }, body: "{}" });
    expect(denied.status).toBe(401);
    const reply = fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${rooms.room(CALL)!.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content: "Hello?" }] })
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    line.say("Hi, it's Ambient.", true);
    const response = await reply;
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const text = await response.text();
    expect(text).toContain('"content":"Hi, it\'s Ambient."');
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  describe("capturing the first chat request", () => {
    const post = (base: string, secret: string, content: string) => fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", "x-api-key": "sk-live", cookie: "a=b", "x-agent-id": "agent-9" },
      body: JSON.stringify({ stream: true, messages: [{ role: "user", content }] })
    }).then(response => response.text());

    const saved = () => JSON.parse(readFileSync(join(captureDir!, `llm-request-${CALL}.json`), "utf8")) as { method: string; path: string; headers: Record<string, string>; body: unknown };

    it("writes the first request per call with secrets redacted, and never the second", async () => {
      const { base, rooms } = await start(true);
      const secret = rooms.room(CALL)!.secret;
      expect(existsSync(join(captureDir!, `llm-request-${CALL}.json`))).toBe(false);
      expect(await post(base, secret, "first")).toContain("data: [DONE]");
      await post(base, secret, "second");
      const file = saved();
      expect(file.method).toBe("POST");
      expect(file.path).toBe(`/call/${CALL}/v1/chat/completions`);
      expect(file.headers).toMatchObject({ authorization: "<redacted>", "x-api-key": "<redacted>", cookie: "<redacted>", "x-agent-id": "agent-9", "content-type": "application/json" });
      expect(file.body).toEqual({ stream: true, messages: [{ role: "user", content: "first" }] });
      expect(JSON.stringify(file)).not.toContain(secret);
    });

    it("still captures a first request that fails authorization, and still answers 401", async () => {
      const { base } = await start(true);
      const denied = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { authorization: "Token wrong", "x-agent-id": "agent-9" }, body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }) });
      expect(denied.status).toBe(401);
      expect(saved()).toMatchObject({ headers: { authorization: "<redacted>", "x-agent-id": "agent-9" }, body: { messages: [{ role: "user", content: "hello" }] } });
    });
  });
});
