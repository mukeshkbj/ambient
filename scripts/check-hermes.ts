import { HermesClient, HermesConnection } from "../src/hermes.js";

const url = process.env.HERMES_WS_URL;
if (!url) throw new Error("HERMES_WS_URL is required");

const connection = new HermesConnection({
  url,
  ...(process.env.HERMES_WS_TOKEN ? { token: process.env.HERMES_WS_TOKEN } : {})
});
const client = new HermesClient(connection);

try {
  await connection.connect();
  const [saved, active] = await Promise.all([client.listSavedSessions(), client.listActiveSessions()]);
  console.log(JSON.stringify({ connected: connection.isConnected, savedCount: saved.length, activeCount: active.length }, null, 2));
} finally {
  await connection.close();
}
