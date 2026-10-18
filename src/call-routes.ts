import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { CallRooms, PageReport } from "./calls/rooms.js";

const ROUTE = /^\/call\/([0-9a-f-]{36})(\/session|\/info|\/events|\/event|\/v1\/chat\/completions)?$/;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 2_000_000) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function report(value: unknown): PageReport | undefined {
  if (!value || typeof value !== "object" || !("type" in value)) return undefined;
  if (value.type === "ready" || value.type === "ended") return { type: value.type };
  if (value.type === "interrupted") return { type: "interrupted", spokenSoFar: "spokenSoFar" in value && typeof value.spokenSoFar === "string" ? value.spokenSoFar : "" };
  return undefined;
}

export async function handleCallRoute(rooms: CallRooms, assetsDir: string, request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
  const match = ROUTE.exec(pathname);
  if (!match) return false;
  const room = rooms.room(match[1]!);
  const action = match[2];
  if (!action && request.method === "GET") {
    const file = join(assetsDir, room ? "index.html" : "ended.html");
    const html = existsSync(file) ? readFileSync(file, "utf8") : "This call has ended.";
    response.writeHead(room ? 200 : 404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(html);
    return true;
  }
  if (!room) {
    json(response, 404, { error: "This call has ended." });
    return true;
  }
  try {
    if (action === "/info" && request.method === "GET") {
      json(response, 200, room.info());
      return true;
    }
    if (action === "/session" && request.method === "POST") {
      json(response, 200, await room.session());
      return true;
    }
    if (action === "/event" && request.method === "POST") {
      const value = report(await readJson(request));
      if (!value) json(response, 400, { error: "Unknown event" });
      else {
        room.pageEvent(value);
        json(response, 200, { ok: true });
      }
      return true;
    }
    if (action === "/events" && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
      const detach = room.attach(event => response.write(`data: ${JSON.stringify(event)}\n\n`));
      const heartbeat = setInterval(() => response.write(": ping\n\n"), 15_000);
      request.on("close", () => {
        clearInterval(heartbeat);
        detach();
      });
      return true;
    }
    if (action === "/v1/chat/completions" && request.method === "POST") {
      if (!room.accepts(request.headers.authorization)) {
        json(response, 401, { error: "unauthorized" });
        return true;
      }
      const body = await readJson(request);
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
      room.chat(body, request.headers.authorization, { write: chunk => response.write(chunk), end: () => response.end() });
      return true;
    }
  } catch (error) {
    if (response.headersSent) response.end();
    else if (error instanceof SyntaxError) json(response, 400, { error: "Request body is not valid JSON." });
    else json(response, 500, { error: "The call could not handle that request." });
    return true;
  }
  json(response, 405, { error: "Method not allowed" });
  return true;
}
