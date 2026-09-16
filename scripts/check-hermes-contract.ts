import { HermesConnection } from "../src/hermes.js";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Hermes returned a non-object");
  return value as Record<string, unknown>;
}

function keys(value: unknown): string[] {
  return Object.keys(record(value)).sort();
}

function requireContract(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Hermes contract check failed: ${message}`);
}

const url = process.env.HERMES_WS_URL;
if (!url) throw new Error("HERMES_WS_URL is required");

const connection = new HermesConnection({
  url,
  ...(process.env.HERMES_WS_TOKEN ? { token: process.env.HERMES_WS_TOKEN } : {})
});
let readyPayload: Record<string, unknown> | undefined;
let probeSessionId: string | undefined;
const unsubscribe = connection.onEvent(event => {
  if (event.type === "gateway.ready") readyPayload = event.payload;
});

try {
  await connection.connect();
  const ping = await connection.request<Record<string, unknown>>("gateway.ping");
  const replayStats = await connection.request<Record<string, unknown>>("session.events.stats");
  const createdSession = await connection.request<Record<string, unknown>>("session.create", {
    source: "ambient",
    close_on_disconnect: false
  });
  const runtimeSessionId = typeof createdSession.session_id === "string" ? createdSession.session_id : "";
  const durableSessionId = typeof createdSession.stored_session_id === "string" ? createdSession.stored_session_id : "";
  if (!runtimeSessionId || !durableSessionId) throw new Error("Hermes session.create did not return both session identities");
  probeSessionId = runtimeSessionId;
  requireContract(readyPayload, "gateway.ready was not observed");
  requireContract(readyPayload.heartbeat === true, "gateway.ready heartbeat capability is missing");
  requireContract(readyPayload.change_events === true, "gateway.ready change_events capability is missing");
  requireContract(typeof readyPayload.replay_epoch === "string" && readyPayload.replay_epoch.length > 0, "gateway.ready replay_epoch is missing");
  requireContract(ping.ok === true, "gateway.ping did not return ok=true");
  requireContract(typeof replayStats.max_per_session === "number" && replayStats.max_per_session > 0, "replay buffer size is missing");
  const created = await connection.request<Record<string, unknown>>("session.events.since", {
    session_id: runtimeSessionId,
    last_seen: 0
  });
  requireContract(Array.isArray(created.events), "session.events.since events is missing");
  requireContract(typeof created.count === "number" && Number.isFinite(created.count), "session.events.since count is missing");
  requireContract(typeof created.latest_seq === "number" && Number.isFinite(created.latest_seq), "session.events.since latest_seq is missing");
  requireContract(typeof created.truncated === "boolean", "session.events.since truncated is missing");
  requireContract(typeof created.epoch === "string" && created.epoch.length > 0, "session.events.since epoch is missing");
  const pendingResponse = await connection.request<Record<string, unknown>>("approval.pending", {
    session_id: runtimeSessionId
  });
  const pending = pendingResponse.approvals;
  if (!Array.isArray(pending)) throw new Error("Hermes approval.pending did not return approvals");
  const response = await connection.request<Record<string, unknown>>("approval.respond", {
    session_id: runtimeSessionId,
    request_id: "ambient-contract-probe-missing",
    choice: "deny"
  });
  const closed = await connection.request<Record<string, unknown>>("session.close", {
    session_id: runtimeSessionId
  });
  requireContract(typeof response.resolved === "number" && response.resolved === 0, "approval.respond did not return resolved=0 for a missing request");
  requireContract(closed.closed === true, "session.close did not return closed=true");
  probeSessionId = undefined;
  console.log(JSON.stringify({
    gatewayReady: {
      frameMethod: "event",
      payloadKeys: readyPayload ? keys(readyPayload) : [],
      heartbeat: readyPayload?.heartbeat === true,
      changeEvents: readyPayload?.change_events === true,
      replayEpochPresent: typeof readyPayload?.replay_epoch === "string" && readyPayload.replay_epoch.length > 0
    },
    ping: { keys: keys(ping), ok: ping.ok === true },
    replayStats: {
      keys: keys(replayStats),
      sessions: typeof replayStats.sessions === "number" ? replayStats.sessions : null,
      events: typeof replayStats.events === "number" ? replayStats.events : null,
      maxPerSession: typeof replayStats.max_per_session === "number" ? replayStats.max_per_session : null
    },
    sessionCreate: {
      keys: keys(createdSession),
      liveIdPresent: Boolean(runtimeSessionId),
      durableIdPresent: Boolean(durableSessionId),
      lazy: typeof createdSession.lazy === "boolean" ? createdSession.lazy : null
    },
    replaySince: {
      keys: keys(created),
      eventCount: Array.isArray(created.events) ? created.events.length : null,
      count: typeof created.count === "number" ? created.count : null,
      latestSeq: typeof created.latest_seq === "number" ? created.latest_seq : null,
      truncated: created.truncated === true,
      epochPresent: typeof created.epoch === "string" && created.epoch.length > 0
    },
    approvalPending: {
      keys: keys(pendingResponse),
      approvalCount: pending.length
    },
    approvalRespond: {
      keys: keys(response),
      resolved: typeof response.resolved === "number" ? response.resolved : null
    },
    sessionClose: {
      keys: keys(closed),
      closed: closed.closed === true
    }
  }, null, 2));
} finally {
  unsubscribe();
  if (probeSessionId && connection.isConnected) {
    await connection.request("session.close", { session_id: probeSessionId }).catch(() => undefined);
  }
  await connection.close();
}
