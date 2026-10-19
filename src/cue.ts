import { randomUUID } from "node:crypto";

export type Cue = {
  needsYou(question: string): Promise<void>;
};

export type CueFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const VOICE_MONKEY_ANNOUNCE_URL = "https://api-v3.voicemonkey.io/announce";
const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const PROACTIVE_EVENTS_URL = "https://api.amazonalexa.com/v1/proactiveEvents/stages/development";
const EVENT_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

export function voiceMonkeyCue(options: { token: string; device: string; fetch?: CueFetch }): Cue {
  const send = options.fetch ?? fetch;
  return {
    async needsYou(question) {
      const result = await send(VOICE_MONKEY_ANNOUNCE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: options.token,
          device: options.device,
          speech: `${question.replace(/\s*Say [^.?!]*[.?!]$/, "")} To answer, say: Alexa, open Ambient.`
        })
      });
      if (!result.ok) throw new Error(`Voice Monkey announce failed (${result.status})`);
    }
  };
}

export function proactiveEventsCue(options: {
  clientId: string;
  clientSecret: string;
  fetch?: CueFetch;
  now?: () => number;
}): Cue {
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | undefined;
  const bearer = async (): Promise<string> => {
    if (cached && now() < cached.expiresAt) return cached.token;
    const result = await send(LWA_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: options.clientId,
        client_secret: options.clientSecret,
        scope: "alexa::proactive_events"
      }).toString()
    });
    if (!result.ok) throw new Error(`Alexa token request failed (${result.status})`);
    const payload = await result.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw new Error("Alexa token response is missing access_token");
    }
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
    cached = { token: payload.access_token, expiresAt: now() + Math.max(0, expiresIn * 1000 - TOKEN_REFRESH_MARGIN_MS) };
    return cached.token;
  };
  return {
    async needsYou() {
      const token = await bearer();
      const at = now();
      const result = await send(PROACTIVE_EVENTS_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          timestamp: new Date(at).toISOString(),
          referenceId: randomUUID(),
          expiryTime: new Date(at + EVENT_TTL_MS).toISOString(),
          event: {
            name: "AMAZON.MessageAlert.Activated",
            payload: {
              state: { status: "UNREAD", freshness: "NEW" },
              messageGroup: { creator: { name: "Ambient" }, count: 1 }
            }
          },
          localizedAttributes: [{ locale: "en-US" }],
          relevantAudience: { type: "Multicast", payload: {} }
        })
      });
      if (!result.ok) throw new Error(`Alexa proactive event failed (${result.status})`);
    }
  };
}

export function combinedCue(cues: Cue[]): Cue {
  return {
    async needsYou(question) {
      const results = await Promise.allSettled(cues.map(cue => cue.needsYou(question)));
      for (const result of results) {
        if (result.status === "rejected") {
          console.error(result.reason instanceof Error ? result.reason.message : String(result.reason));
        }
      }
    }
  };
}
