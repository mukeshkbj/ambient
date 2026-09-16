import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { LocalHermesConnector } from "../src/connector.js";
import { rawText } from "../src/raw.js";

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not expose a TCP address");
  return address.port;
}

async function closeServer(server: Server, sockets: WebSocketServer): Promise<void> {
  for (const client of sockets.clients) client.close();
  await new Promise<void>(resolve => sockets.close(() => resolve()));
  await new Promise<void>(resolve => server.close(() => resolve()));
}

describe("Local Hermes connector", () => {
  let connector: LocalHermesConnector | undefined;
  let bridgeServer: Server | undefined;
  let hermesServer: Server | undefined;
  let bridgeSockets: WebSocketServer | undefined;
  let hermesSockets: WebSocketServer | undefined;

  afterEach(async () => {
    await connector?.close();
    if (bridgeServer && bridgeSockets) await closeServer(bridgeServer, bridgeSockets);
    if (hermesServer && hermesSockets) await closeServer(hermesServer, hermesSockets);
    connector = undefined;
    bridgeServer = undefined;
    hermesServer = undefined;
    bridgeSockets = undefined;
    hermesSockets = undefined;
  });

  it("forwards the Hermes stream over an authenticated outbound socket", async () => {
    bridgeServer = createServer();
    bridgeSockets = new WebSocketServer({ server: bridgeServer });
    hermesServer = createServer();
    hermesSockets = new WebSocketServer({ server: hermesServer });
    const bridgePort = await listen(bridgeServer);
    const hermesPort = await listen(hermesServer);
    const ready = new Promise<WebSocket>(resolve => {
      bridgeSockets!.on("connection", (socket, request) => {
        expect(request.headers.authorization).toBe("Bearer bridge-secret");
        expect(request.headers["x-ambient-runtime-id"]).toBe("local");
        resolve(socket);
      });
    });
    hermesSockets.on("connection", socket => {
      socket.send(JSON.stringify({ jsonrpc: "2.0", method: "event", params: { type: "gateway.ready", payload: {} } }));
      socket.on("message", data => {
        const request = JSON.parse(rawText(data)) as { id: string };
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { ok: true } }));
      });
    });
    connector = new LocalHermesConnector({
      bridgeUrl: `http://127.0.0.1:${bridgePort}/connector`,
      bridgeToken: "bridge-secret",
      runtimeId: "local",
      hermesUrl: `ws://127.0.0.1:${hermesPort}/api/ws`
    });
    connector.start();
    const bridge = await ready;
    const forwardedReady = new Promise<void>(resolve => {
      const handler = (data: WebSocket.RawData) => {
        const frame = JSON.parse(rawText(data)) as { method?: string; params?: { type?: string } };
        if (frame.method === "event" && frame.params?.type === "gateway.ready") {
          bridge.off("message", handler);
          resolve();
        }
      };
      bridge.on("message", handler);
    });
    await forwardedReady;
    const response = new Promise<Record<string, unknown>>(resolve => {
      bridge.once("message", data => resolve(JSON.parse(rawText(data)) as Record<string, unknown>));
    });
    bridge.send(JSON.stringify({ jsonrpc: "2.0", id: "bridge-1", method: "session.list", params: {} }));
    await expect(response).resolves.toMatchObject({ id: "bridge-1", result: { ok: true } });
  });
});
