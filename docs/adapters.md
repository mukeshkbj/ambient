# Writing an adapter

An adapter teaches Ambient to talk to one agent runtime. It implements
`AssistantClient` (`src/runtimes/types.ts`) and maps that runtime's protocol —
events, sessions, approvals — onto the canonical shapes the engine consumes.
Everything wire-specific stays inside the adapter; nothing else in the repo
knows what a Hermes `session_key` is.

The [`demo` adapter](../src/runtimes/demo.ts) is the template. It needs no
credentials and no network — the whole lifecycle is scripted on a timer — so
you can read it end to end in a few minutes. The client surface is about 80
lines; the rest is the script that makes it behave like a real agent.

## The contract

```ts
export class DemoClient extends AssistantEvented implements AssistantClient {
  readonly capabilities: RuntimeCapabilities = { sessions: true, steer: true, ... };

  createSession(): Promise<AssistantSession>;            // { runtimeSessionId, durableSessionId }
  submitPrompt(liveId: string, text: string): Promise<SubmitResult>;   // { state: "accepted" | "streaming" }
  steer?(liveId: string, text: string): Promise<SteerResult>;
  interrupt?(liveId: string): Promise<InterruptResult>;  // { state: "interrupted" | "acknowledged" }
  resumeSession?(durableId: string): Promise<AssistantSession>;
  listSavedSessions?(): Promise<SavedSession[]>;
  listActiveSessions?(): Promise<ActiveSession[]>;       // { id, durableId, title, status, ... }
  listPendingApprovals?(liveId: string): Promise<ApprovalPayload[]>;   // { requestId, command, ... }
  respondToApproval?(liveId: string, requestId: string, choice: string): Promise<ApprovalResponse>; // { resolved: n }
}
```

Plus three listener hooks — `onEvent`, `onConnectionState`, `onReplayGap` —
which `AssistantEvented` gives you for free (call `this.emit(...)` /
`this.emitState(...)`).

## Events drive everything

`AssistantEvent` is a discriminated union — emit exactly one of these:

| Event | Payload | Meaning |
|---|---|---|
| `message.start` | `{ kind? }` | a run began producing output |
| `message.delta` / `message.interim` | `{ text? }` | partial answer |
| `message.complete` | `{ text?, status?, error? }` | run settled — `status` `"ok" \| "error" \| "cancelled"` |
| `tool.start` / `tool.complete` | `{ name? }` | tool activity |
| `status.update` | `{ text?, name?, summary?, message? }` | progress the UI can show |
| `approval.request` | `{ requestId, command, description?, choices? }` | pause for the user's call |

The engine turns these into run status transitions — you never tell it "the
run completed"; you emit `message.complete` and it does the bookkeeping.

```ts
this.emit({ type: "status.update", sessionId, payload: { text: "Comparing venues" } });
this.emit({ type: "approval.request", sessionId, payload: { requestId, command, choices: ["once", "deny"] } });
this.emit({ type: "message.complete", sessionId, payload: { status: "ok", text: "Booked it." } });
```

## Sessions: live vs durable

Two ids, deliberately:

- `runtimeSessionId` — the live handle you pass to `submitPrompt`/`steer`/
  `interrupt`. May die with the connection.
- `durableSessionId` — what survives restarts. `resumeSession` turns it back
  into a live handle.

If live ids die with your connection, set `ephemeralSessions = true` so
discovery re-binds them after reconnect (Hermes does this). If your ids are
already durable keys (OpenClaw, Bedrock, demo), leave it unset.

## Approvals: honest or absent

If the runtime can't gate actions, set `capabilities.approvals = false` —
Ambient will say so instead of faking a gate. If it can:

1. Emit `approval.request` with a stable `requestId`.
2. Wait for `respondToApproval(liveId, requestId, choice)` and return
   `{ resolved: 1 }` (or `0` if the request was already gone).
3. Also implement `listPendingApprovals` — after a reconnect the engine
   replays the snapshot so nothing gets stuck `waiting_approval` forever.

## State honesty

`onConnectionState` reports `"online" | "offline"`. When your transport drops,
emit `offline` — the engine marks in-flight work `unknown` rather than
guessing. Never synthesize a `message.complete` for a run whose fate you
don't know; an honest unknown is a feature, not a failure.

## Wiring it in

1. Write the client (`src/runtimes/<name>.ts`), extending `AssistantEvented`.
2. Register it in `src/runtimes/registry.ts`'s adapter table with a config
   schema.
3. Add a fixture to `runtimes.example.json` and tests in `test/` — the
   `FakeSocket`-driven contract tests in `test/adapters.test.ts` and
   `test/hermes-contract.test.ts` show how to exercise the client without a
   live backend.
4. `pnpm scan` must stay green.

Don't claim a runtime works until it's been exercised against the real
service — mark it as verified in `docs/acceptance.md` only with a receipt you
actually produced.
