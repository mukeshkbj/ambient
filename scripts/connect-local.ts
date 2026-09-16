import { LocalHermesConnector } from "../src/connector.js";

const bridgeUrl = process.env.AMBIENT_BRIDGE_URL;
const bridgeToken = process.env.CONNECTOR_TOKEN;
const hermesUrl = process.env.HERMES_WS_URL;
if (!bridgeUrl || !bridgeToken || !hermesUrl) {
  throw new Error("AMBIENT_BRIDGE_URL, CONNECTOR_TOKEN, and HERMES_WS_URL are required");
}

const connector = new LocalHermesConnector({
  bridgeUrl,
  bridgeToken,
  runtimeId: process.env.HERMES_RUNTIME_ID ?? "local",
  hermesUrl,
  ...(process.env.HERMES_WS_TOKEN ? { hermesToken: process.env.HERMES_WS_TOKEN } : {})
});
connector.start();

const shutdown = () => void connector.close().finally(() => process.exit(0));
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
