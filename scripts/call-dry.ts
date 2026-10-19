import { createServer as createTcpServer, type AddressInfo } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebSocket } from "ws";
import { assemblyAi } from "../src/calls/assemblyai.js";
import { JOES_PLUMBING } from "../src/calls/demo.js";
import { CallRooms } from "../src/calls/rooms.js";
import { disclosure } from "../src/calls/rules.js";
import { createAmbientHttpServer } from "../src/server.js";
import { buildRuntimeRegistry } from "../src/runtimes/registry.js";
import { AmbientStore } from "../src/store.js";
import { REQUEST_SHAPE, sseData, startFakeAssemblyAi } from "./fake-assemblyai.js";

const API_KEY = "dry-run-key";
const OWNER = "Maya";
const TASK = "Call Joe's Plumbing and book a visit to fix the kitchen sink, keep it under 150";

type Result = { structuredContent?: { speech?: string; status?: string; task?: { steps?: string[] } }; content?: Array<{ type: string; text?: string }> };

export type DryResult = { transcript: string[]; summary: string; requestShape: string };

const speech = (result: Result) => result.structuredContent?.speech ?? result.content?.find(item => item.type === "text")?.text ?? "";
const status = (result: Result) => result.structuredContent?.status ?? "";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function freePort(): Promise<number> {
  const probe = createTcpServer();
  await new Promise<void>(resolve => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  return port;
}

async function events(url: string, onEvent: (event: { type: string }) => void, signal: AbortSignal): Promise<void> {
  await sseData(await fetch(url, { signal }), data => onEvent(JSON.parse(data) as { type: string }));
}

function businessPage(callUrl: string): { done: Promise<void> } {
  const post = (path: string, body: unknown, pageKey = "") =>
    fetch(callUrl + path, { method: "POST", headers: { "content-type": "application/json", "x-page-key": pageKey }, body: JSON.stringify(body) });
  const done = (async () => {
    const info = await fetch(`${callUrl}/info`).then(response => response.json()) as { ownerName: string };
    check(info.ownerName === OWNER, "the call page did not name the owner");
    const session = await post("/session", {}).then(response => response.json()) as { token: string; agentId: string; pageKey: string; wsUrl: string };
    const url = new URL(session.wsUrl);
    url.searchParams.set("token", session.token);
    const ws = new WebSocket(url);
    const stream = new AbortController();
    const page = { replying: false, expectReply: false, endAfterReply: false, ended: false, agentText: "" };
    const finished = new Promise<void>(resolve => {
      const end = () => {
        if (page.ended) return;
        page.ended = true;
        stream.abort();
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "session.end" }));
        ws.close();
        void post("/event", { type: "ended" }, session.pageKey).then(() => resolve());
      };
      ws.on("open", () => ws.send(JSON.stringify({ type: "session.update", session: { agent_id: session.agentId } })));
      ws.on("close", end);
      ws.on("message", raw => {
        const event = JSON.parse((raw as Buffer).toString()) as { type: string; text?: string; interrupted?: boolean; status?: string };
        if (event.type === "session.ready") void post("/event", { type: "ready" }, session.pageKey);
        if (event.type === "reply.started") Object.assign(page, { replying: true, expectReply: false, agentText: "" });
        if (event.type === "transcript.agent") {
          page.agentText = event.text ?? "";
          if (event.interrupted) void post("/event", { type: "interrupted", spokenSoFar: page.agentText }, session.pageKey);
        }
        if (event.type === "reply.done") {
          page.replying = false;
          if (event.status !== "interrupted") void post("/event", { type: "played", text: page.agentText }, session.pageKey);
          if (page.endAfterReply) setTimeout(end, 300);
        }
        if (event.type === "session.error") throw new Error(`fake AssemblyAI session error: ${JSON.stringify(event)}`);
      });
      events(`${callUrl}/events`, event => {
        if (event.type === "speak" && ws.readyState === ws.OPEN) {
          page.expectReply = true;
          ws.send(JSON.stringify({ type: "reply.create" }));
        }
        if (event.type === "hangup") {
          page.endAfterReply = true;
          if (!page.replying && !page.expectReply) setTimeout(end, 400);
        }
      }, stream.signal).catch(() => {});
    });
    await finished;
  })();
  return { done };
}

export async function runCallDry(options: { log?: (line: string) => void } = {}): Promise<DryResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const fake = await startFakeAssemblyAi({ apiKey: API_KEY, persona: JOES_PLUMBING });
  const port = await freePort();
  const publicBaseUrl = `http://127.0.0.1:${port}`;
  const store = new AmbientStore();
  const rooms = new CallRooms({ ai: assemblyAi({ apiKey: API_KEY, apiBase: fake.apiBase }), publicBaseUrl, chatTimeoutMs: 400 });
  const registry = buildRuntimeRegistry(
    {
      runtimes: [{ id: "caller", label: "Ambient", kind: "cloud", adapter: "caller", default: true, options: { line: "assemblyai", brain: "scripted", business: JOES_PLUMBING.name, phone: "+14155550134" } }],
      defaultRuntimeId: "caller"
    },
    {},
    store,
    { rooms }
  );
  const http = createAmbientHttpServer({ registry, allowUnauthenticated: true, calls: { rooms, assetsDir: fileURLToPath(new URL("../web/call/", import.meta.url)) } });
  await new Promise<void>(resolve => http.server.listen(port, "127.0.0.1", resolve));
  registry.startAll();
  const client = new Client({ name: "ambient-call-dry", version: "0.1.0" });
  try {
    log("call:dry: brain: scripted (the demo script in src/calls/demo.ts, not Claude); AssemblyAI: a local fake");
    log(`call:dry: ${REQUEST_SHAPE}`);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${publicBaseUrl}/mcp`)) as Parameters<typeof client.connect>[0]);
    const waitFor = async (wanted: string[], timeoutMs = 20_000): Promise<Result> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const result = await client.callTool({ name: "status", arguments: {} }) as Result;
        if (wanted.includes(status(result))) return result;
        check(Date.now() < deadline, `timed out waiting for ${wanted.join(" or ")}; last ${status(result)}: ${speech(result)}`);
        await sleep(150);
      }
    };
    await client.callTool({ name: "delegate", arguments: { task: TASK, newConversation: true } });
    let joinUrl: string | undefined;
    for (const deadline = Date.now() + 10_000; !joinUrl; await sleep(100)) {
      const steps = ((await client.callTool({ name: "status", arguments: {} })) as Result).structuredContent?.task?.steps ?? [];
      joinUrl = steps.map(step => /at (http\S*\/call\/[0-9a-f-]{36})/.exec(step)?.[1]).find(Boolean);
      check(Date.now() < deadline, "the call never published its join link");
    }
    const page = businessPage(joinUrl);
    const waiting = await waitFor(["waiting_approval"]);
    check(/one hundred eighty dollars/.test(speech(waiting)), `the owner was not asked at one hundred eighty dollars: ${speech(waiting)}`);
    await client.callTool({ name: "approve", arguments: { decision: "once" } });
    const finalStatus = await waitFor(["completed", "failed", "cancelled", "unknown"]);
    await Promise.race([page.done, sleep(3000)]);
    const summary = speech(finalStatus);
    const transcript = [...fake.transcript];
    const agentId = [...fake.agents.keys()][0]!;
    const greeting = fake.agents.get(agentId)!.greeting;
    check(greeting === disclosure(OWNER), "the stored agent greeting is not the disclosure");
    check(transcript[0] === `Ambient: ${disclosure(OWNER)}`, `the disclosure was not the first agent line: ${transcript[0]}`);
    const plus = transcript.indexOf(`${JOES_PLUMBING.name}: Yes, plus parts.`);
    check(plus >= 0, "the business never said \"Yes, plus parts.\"");
    check(transcript[plus + 1]?.startsWith("Ambient: Sorry, I need one total price"), `"Yes, plus parts." was not refused: ${transcript[plus + 1]}`);
    check(status(finalStatus) === "completed" && /one hundred eighty dollars/.test(summary), `the call did not confirm at the approved price: ${status(finalStatus)}: ${summary}`);
    for (let waited = 0; fake.agents.get(agentId)!.llm.length > 0 && waited < 1000; waited += 50) await sleep(50);
    check(fake.agents.get(agentId)!.llm.length === 0, "the stored agent kept our endpoint after the call");
    log(transcript.join("\n"));
    log(`call:dry: ok, the disclosure came first, the owner was asked at one hundred eighty dollars, "Yes, plus parts." was refused, and the call confirmed at one hundred eighty dollars`);
    return { transcript, summary, requestShape: REQUEST_SHAPE };
  } finally {
    await client.close().catch(() => {});
    await registry.close();
    await http.close();
    store.close();
    await fake.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCallDry().then(() => process.exit(0), (error: unknown) => {
    console.error(`call:dry: FAILED, ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
