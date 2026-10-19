# Friction log

This log lists the problems we hit while building Ambient for the Amazon Alexa "Build, Ship, Shape" hackathon. Every entry was reproduced or re-fetched on 2026-10-18, and re-checked on 2026-10-19, on one machine: Windows 11 Home 10.0.26300, Node v24.21.0. Each entry has a pasted capture or a verbatim quote with its URL. We deleted entries we could not reproduce.

We did not run a timer. Where git shows when a problem started and when it was fixed, the entry gives that span and says it is a span, not working time. Where git shows nothing, the entry says "not measured".

## Journey coverage

| Stage | Status | Detail |
|---|---|---|
| Onboarding and SDK install | Hit | `pnpm install` of `@modelcontextprotocol/sdk` 1.30.0 worked with no friction; no entry. The first server run on Windows failed (entry 2). |
| MCP SDK at runtime | Hit | Entry 1. Elicitation inside a tool call hung with no error. |
| Docs | Hit | Entries 3 to 8. Six documentation problems: pages that disagree with each other or leave a field unstated. |
| Alexa developer console and skill registration | Not reached | The owner's developer account step has not run. `alexa/interaction-model.en-US.json`, `alexa/interaction-model.en-GB.json` and `alexa/skill.json` exist but were never imported. `progress.md` phase 7: "Echo Dot run pending". |
| ASK CLI | Not reached | `progress.md` records no `ask` or `alexa-ai` command run. `docs/product-feedback.md` says the Alexa+ MCP toolkit, CLI and web simulator were gated for hackathon entrants during the build. |
| Account linking and OAuth | Not reached live | The OAuth metadata routes and the request verification (`src/alexa-verify.ts`) are written and unit tested. No live Alexa service call exercised them. Entry 4 covers the docs gap. |
| Alexa+ MCP testing | Blocked | The toolkit, CLI and web simulator are gated for hackathon entrants (`docs/product-feedback.md`). We built the `/sim` host as a stand-in. It is our own client, so it proves nothing about what Alexa+ renders. Entries 3 and 5 are the questions it could not answer. |
| Proactive Events and Voice Monkey | Not reached | `src/cue.ts` is written. It needs a Voice Monkey token and an Echo Dot. `reference-alexa.md` marks two facts UNVERIFIED: whether the console accepts an HTTPS `events.endpoint`, and Voice Monkey latency. |
| AWS: credentials | Not reached | `docs/product-feedback.md`: "this machine has no AWS credentials". `aws sts get-caller-identity` was not run. |
| AWS: Bedrock model access | Not reached | Needs credentials. No access request was made. |
| AWS: CDK | Hit, no friction | `pnpm infra:synth` exits 0 on 2026-10-18 with no AWS credentials. |
| AWS: deploy | Blocked | `cdk deploy` costs money and waits for the owner's approval (`progress.md`, phase 10). |
| Twilio | Dropped by decision | The owner has no Twilio budget (`progress.md`, "Decisions taken this session"). See the note below the table. No Twilio account step ran. |
| AssemblyAI | Hit | Entries 6 to 8. The code is tested against fixtures written from the docs. No frame was captured from the live API. `progress.md`, phase 6: "not yet run against the live API". |
| Real-device testing | Not reached | Needs the skill registered, the Voice Monkey token and the Echo Dot run. |

Twilio decision. We chose Twilio ConversationRelay first (`docs/plans/2026-10-18-handle-the-call/decisions.md`). We then dropped it for lack of budget. These facts from `docs/plans/2026-10-18-handle-the-call/reference-twilio.md` drove the decision:

- A trial account cannot run `<ConversationRelay>`. We fetched https://www.twilio.com/docs/usage/trials/try-out-voice on 2026-10-18. Its "Blocked verbs" table lists `<ConversationRelay>`, and the page says: "The \{verb} verb is not available on trial accounts."
- The account also needs the Predictive and Generative AI/ML Features Addendum. We fetched https://www.twilio.com/docs/voice/conversationrelay/onboarding on 2026-10-18 and found the addendum requirement. The page does not mention error 64110, which the reference file lists. Treat 64110 as UNVERIFIED.
- The reference file records the cost as $0.07 per minute for ConversationRelay plus about $0.014 per minute for US outbound voice. We did not re-verify these prices. The pages we fetched did not state them.
- Replacement: the business answers on a web link through the AssemblyAI Voice Agent API. AssemblyAI cannot dial out, so the "a real phone rings" moment is not available. The `Line` seam keeps a Twilio bridge possible later.

## Entry format

Each entry lists: the task attempted, tool and version, date, severity, steps to reproduce, expected result, actual result, time lost ("not measured" unless git gives a span), workaround with commit, and the fix we ask for. Severity uses three levels. High: it blocks the work or fails with no error. Medium: it costs time and has a workaround. Low: a design limit we can live with. "Date" is the date we hit the problem, or for documentation entries the date we re-read and quoted the pages.

## Software entries

### 1. MCP TypeScript SDK 1.30.0: `elicitInput` inside a tool call never reaches the client and never errors

- **Task attempted:** Ask the owner a question in the middle of a tool call, with MCP elicitation.
- **Tool and version:** `@modelcontextprotocol/sdk` 1.30.0 (`node_modules/@modelcontextprotocol/sdk/package.json`), `StreamableHTTPServerTransport`.
- **Date:** 2026-10-18, fix `fd17fa9`.
- **Re-checked:** Re-ran `elicit.mts` against SDK 1.30.0 on 2026-10-19 in all four modes. Same result: only `sse-related` delivers the `elicitation/create` frame.
- **Severity:** High. The call hangs with no error, so the fault is invisible until you read the SDK source.
- **Steps:** Run the script in "Reproduction scripts" below, once per mode: `node --import tsx elicit.mts json`, `sse`, `sse-related`, `json-related`. The script registers one tool. The tool calls `server.server.elicitInput(...)`. A raw `fetch` client declares `capabilities.elicitation` and calls the tool.
- **Expected:** The client receives an `elicitation/create` request on the response to its `tools/call`. In all four modes.
- **Actual:** The server logs `calling elicitInput` and then nothing. No exception, no log, no timeout. Only `sse-related` delivers the request. Capture:

  ```
  === json
  client: tools/call, mode=json
  server: calling elicitInput
  client: no response headers after 3000 ms
  === sse
  client: tools/call, mode=sse
  server: calling elicitInput
  client: status 200 text/event-stream
  client: first frame: <no frame after 3000 ms>
  === sse-related
  client: tools/call, mode=sse-related
  server: calling elicitInput
  client: status 200 text/event-stream
  client: first frame: event: message\ndata: {"method":"elicitation/create","params":{"message":"ok?","requestedSchema":{"type":"object","properties":{"x":{"type":"string"}}},"mode":"form"},"jsonrpc":"2.0","id":0}\n\n
  === json-related
  client: tools/call, mode=json-related
  server: calling elicitInput
  client: no response headers after 3000 ms
  ```

  Two conditions are both required: `enableJsonResponse: false` and `{ relatedRequestId: extra.requestId }` passed to `elicitInput`. Without the second, the SDK sends the request on a standalone GET stream. Our client never opened one, so the request has no route.
- **Time lost:** Not measured. The hang was in the code from `5087aad` (2026-10-11 23:13) until `fd17fa9` (2026-10-18 18:54), seven days, because nothing failed loudly.
- **Workaround:** `enableJsonResponse: false` (`src/server.ts:442`, from `5087aad`) and `{ relatedRequestId: requestId }` in `src/mcp.ts` (`fd17fa9`).
- **Fix we ask for:** Make `elicitInput` throw, or reject its promise, when it has no stream to write to: a JSON-response transport, or no `relatedRequestId` and no standalone GET stream. Better: default `relatedRequestId` from the active request handler, so a call made inside a tool handler uses the tool call's stream.

### 2. pnpm 10.33.0 on Windows: `VAR=value command` in a `package.json` script fails

- **Task attempted:** Start the demo server on Windows with environment variables set in a `package.json` script.
- **Tool and version:** pnpm 10.33.0 (the repo's `packageManager`), Node v24.21.0, Windows 11 Home 10.0.26300.
- **Date:** 2026-10-18, fix `1ffda6a`.
- **Re-checked:** Re-ran on 2026-10-19 with pnpm 10.33.0. Same failure: `'AMBIENT_HOST' is not recognized as an internal or external command`.
- **Severity:** Medium. The documented script syntax fails on Windows, and the error names the variable, not the cause.
- **Steps:** In an empty directory, create this `package.json`, then run `pnpm demo`:

  ```json
  { "name": "repro", "private": true, "packageManager": "pnpm@10.33.0",
    "scripts": { "demo": "AMBIENT_HOST=127.0.0.1 node -e \"console.log(process.env.AMBIENT_HOST)\"" } }
  ```

- **Expected:** The script prints `127.0.0.1`, as it does on macOS and Linux.
- **Actual:** Capture from pnpm 10.33.0:

  ```
  > repro@ demo C:\Users\mukes\AppData\Local\Temp\fr-pnpm-ps2
  > AMBIENT_HOST=127.0.0.1 node -e "console.log(process.env.AMBIENT_HOST)"

  'AMBIENT_HOST' is not recognized as an internal or external command,
  operable program or batch file.
   ELIFECYCLE  Command failed with exit code 1.
  ```

  pnpm runs scripts through `cmd.exe` on Windows. The judge path, `pnpm demo`, failed on its first command.
- **Time lost:** Not measured.
- **Workaround:** Move the variables to the committed file `demo.env` and run `tsx --env-file=demo.env src/server.ts` (`1ffda6a`). Node's `--env-file` works the same on every OS and adds no dependency.
- **Fix we ask for:** When a script starts with a POSIX `VAR=value` assignment and the shell is `cmd.exe`, print one warning that names the problem and links to `script-shell`. Today the error names `AMBIENT_HOST` as a missing program.

## Documentation entries

Access date for every quote below: 2026-10-18.

### 3. Alexa+ MCP docs: three pages show three MCP protocol versions

- **Task attempted:** Choose the MCP protocol version our server should offer to Alexa+.
- **Tool and version:** Alexa+ MCP toolkit documentation, no version published. Pages accessed 2026-10-18.
- **Date:** 2026-10-18, when we re-read and quoted the three pages for this log. We first noted the conflict on 2026-10-12 (`9fc671a`).
- **Re-checked:** Re-read the three pages on 2026-10-19. They still show `2025-03-26`, `2025-11-25` and `2025-06-18`.
- **Severity:** Medium. A client and server can negotiate a version the platform does not support.
- **Steps:** Open these three pages and search for the protocol version:
  1. https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html, section "MCP initialize request payload". The sample request contains `"protocolVersion": "2025-03-26",`.
  2. https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html says: "Alexa+ for Builders supports the 2025-11-25 version of the MCP specification."
  3. https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-local-inspector, "Step 2: Initialize the MCP session". The `curl` example sends `"protocolVersion":"2025-06-18"`.
- **Expected:** One version, or a statement that Alexa+ accepts the version the server answers with.
- **Actual:** Three versions on three pages. No page says which version the real Alexa+ client sends. No error text exists, because the problem is in the docs.
- **Time lost:** Not measured.
- **Workaround:** No code change. We confirmed that our server answers whatever the client asks for, from the SDK's supported list (`SUPPORTED_PROTOCOL_VERSIONS` in `node_modules/@modelcontextprotocol/sdk/dist/esm/types.js` holds `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07`). Capture from the script `negotiate.mts` (initialize against `McpServer` 1.30.0):

  ```
  client asks 2025-03-26 -> server answers 2025-03-26
  client asks 2025-11-25 -> server answers 2025-11-25
  ```

- **Fix we ask for:** Use one version in all three pages, or add one sentence to the lifecycle page: "Alexa+ sends `protocolVersion` X and accepts the version your server returns."

### 4. Alexa+ authentication page lists `WWW-Authenticate` as unsupported; the MCP specification requires clients to parse it

- **Task attempted:** Implement OAuth discovery so Alexa+ can link an account to our MCP server.
- **Tool and version:** Alexa+ MCP toolkit documentation (no version published) and MCP specification 2025-11-25. Accessed 2026-10-18.
- **Date:** 2026-10-18, when we re-read and quoted both pages for this log. We first noted the conflict on 2026-10-12 (`9fc671a`).
- **Re-checked:** Re-read the Alexa page on 2026-10-19. "WWW-Authenticate headers in 401 responses" is still listed as not supported.
- **Severity:** Medium. A spec-compliant server may send a header the platform says it ignores, so auth discovery can fail.
- **Steps:** Read both pages:
  1. https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-authentication.html, section "What isn't supported", list item: "`WWW-Authenticate` headers in 401 responses".
  2. https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization, section "Protected Resource Metadata Discovery Requirements": "MCP servers **MUST** implement one of the following discovery mechanisms", then "WWW-Authenticate Header" or "Well-Known URI". The same section says: "MCP clients **MUST** be able to parse `WWW-Authenticate` headers and respond appropriately to `HTTP 401 Unauthorized` responses from the MCP server."
- **Expected:** An Alexa+ client that follows the MCP specification, or a page that says which discovery method it uses.
- **Actual:** The Alexa page says the header is unsupported. The specification says clients must parse it. The Alexa page does not say whether Alexa+ reads the well-known URI instead. It also says the client uses a service-level token for `initialize` and `tools/list`. No error text exists, because the problem is in the docs.
- **Time lost:** Not measured.
- **Workaround:** The server serves both well-known documents, `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` (`src/server.ts:254` and `:258`, from `bbe260a`). `grep -rin www-authenticate src` finds nothing, so the server does not send the header. An earlier version of this log said it did. That was wrong. We have not tested either path against a live Alexa+ client.
- **Fix we ask for:** State which discovery method Alexa+ uses for a self-hosted MCP server. Add one sentence to the "What isn't supported" list: what to implement in place of the header.

### 5. Alexa+ MCP Apps: `resourceUri` belongs in the tool response (Alexa) or the tool definition (MCP Apps specification)

- **Task attempted:** Show a UI card for a tool result on an Alexa+ device with MCP Apps.
- **Tool and version:** Alexa+ MCP toolkit documentation (no version published) and MCP Apps specification `2026-01-26`. Accessed 2026-10-18.
- **Date:** 2026-10-18, when we re-read and quoted both documents for this log. The workaround dates from `5087aad` (2026-10-11).
- **Re-checked:** Re-read the Alexa page on 2026-10-19. It still says `resourceUri` belongs in the tool response.
- **Severity:** Medium. One of the two placements fails silently on one host.
- **Steps:** Read both pages:
  1. https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html, section "Resource handling and elicitation": "Alexa+ renders your custom visuals for your MCP App UI as long as you have `resourceUri` defined in the tool response."
  2. https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx, section "Resource Discovery": "Tools are associated with UI resources through the `_meta.ui` field:", and under Behavior: "If `ui.resourceUri` is present and host supports MCP Apps, host renders tool results using the specified UI resource". The same section deprecates the flat key: "The flat `_meta["ui/resourceUri"]` format is deprecated."
- **Expected:** One location that both documents name.
- **Actual:** Alexa documents the tool result. The MCP Apps specification documents the tool definition. We cannot tell which reader Alexa+ uses, and no client was available to test. No error text exists, because the problem is in the docs.
- **Time lost:** Not measured.
- **Workaround:** We emit `_meta.ui.resourceUri` on the tool result (`runResult` in `src/voice.ts`, from `5087aad`; an earlier tool result emitted it from `35ed748`) and register the `ui://ambient/task` resource. Our `/sim` host reads that field. It is our own host, so it does not prove what Alexa+ does.
- **Fix we ask for:** Publish a complete tools/list entry and tools/call result for one MCP App tool, and say which of them Alexa+ reads.

### 6. AssemblyAI Voice Agent API: the request sent to a bring-your-own LLM endpoint is not documented

- **Task attempted:** Connect our own LLM endpoint to the AssemblyAI Voice Agent API.
- **Tool and version:** AssemblyAI Voice Agent API, no version published. Page https://www.assemblyai.com/docs/voice-agents/voice-agent-api/connect-your-own-llm.md, fetched with `curl` on 2026-10-18.
- **Date:** 2026-10-18, workaround in `41fb071`.
- **Re-checked:** Re-fetched on 2026-10-19. The page still describes the call only as `POST {base_url}/chat/completions` in the OpenAI schema.
- **Severity:** High. The integration cannot be written from the docs alone; we had to infer the request shape.
- **Steps:** Fetch the page. Search it for the request body, headers, timeouts and tool handling of the call to your endpoint:

  ```
  curl -sSL https://www.assemblyai.com/docs/voice-agents/voice-agent-api/connect-your-own-llm.md -o byo.md
  grep -n -i "header\|timeout\|tools" byo.md
  ```

- **Expected:** The page describes the request AssemblyAI sends to our endpoint: whether the agent's system prompt is in `messages`, how history is shaped, the auth header, `stream` flags, timeouts, and whether `tools` are forwarded.
- **Actual:** The page states only this about the call: "`base_url` | string | Yes | HTTPS base URL of the OpenAI-compatible endpoint. Must be `https` and a public host. The agent calls `POST {base_url}/chat/completions`." Its "Requirements & behavior" list adds: "The endpoint must accept `POST /chat/completions` in the OpenAI schema." and "Realtime voice needs token streaming, so the model must support streamed chat completions." Every `Authorization` header on the page belongs to a call to AssemblyAI. The page does not show the header AssemblyAI sends to us. The page also does not show the field that holds the new agent id in the create response.
- **Time lost:** Not measured. The defensive endpoint arrived in the same commit as the line (`41fb071`).
- **Workaround:** The endpoint (`src/calls/assemblyai.ts`, `41fb071`) reads every `user` message, accepts string or part-array content, reads `agent_id` and then `id` from the create response, and streams OpenAI-shaped chunks. We have not logged a real request, because the line has not run against the live API.
- **Fix we ask for:** Publish one recorded request and response for the bring-your-own LLM call, with headers and with `tools` present and absent.

### 7. AssemblyAI Voice Agent API: two docs pages disagree on event fields, and the example repository points at a second endpoint

- **Task attempted:** Read the business's and the agent's transcript events on the browser answer page.
- **Tool and version:** AssemblyAI Voice Agent API, no version published. Pages `events-reference.md` and `message-sequence.md` under https://www.assemblyai.com/docs/voice-agents/voice-agent-api/, fetched with `curl` on 2026-10-18. Example repository https://github.com/AssemblyAI/voice-agent-api-twilio-example, last pushed 2026-10-14T17:42:51Z.
- **Date:** 2026-10-18, workaround in `41fb071`.
- **Re-checked:** Re-ran the commands on 2026-10-19. Same output: `delta` in one page, `reply_id` and `item_id` in one page and none in the other, and the example still uses `/v1/realtime`.
- **Severity:** Medium. Code written from one page fails against the other.
- **Steps:**

  ```
  B=https://www.assemblyai.com/docs/voice-agents/voice-agent-api
  curl -sSL $B/events-reference.md -o ev.md; curl -sSL $B/message-sequence.md -o seq.md
  sed -n 353,362p ev.md
  grep -n -A3 '"type": "transcript.user.delta"' seq.md
  grep -n -A4 '"type": "reply.started"' ev.md; grep -n '"type": "reply.started"' seq.md
  curl -sSL https://raw.githubusercontent.com/AssemblyAI/voice-agent-api-twilio-example/main/src/index.ts | grep -n "v1/"
  ```

- **Expected:** One field name per event, one endpoint.
- **Actual:** `events-reference.md` shows:

  ```
  "type": "transcript.user.delta",
  "item_id": "item_abc123",
  "text": "What's the weather in"
  ```

  `message-sequence.md` shows:

  ```
  "type": "transcript.user.delta",
  "delta": "hey there"
  ```

  `events-reference.md` shows `reply.started` with `reply_id` and `item_id`. `message-sequence.md` shows `{ "type": "reply.started" }` with no fields. The example repository's `src/index.ts` line 35 reads `const AAI_AGENT_URL = process.env.AAI_AGENT_URL || "wss://agents.assemblyai.com/v1/realtime";`. The docs use `wss://agents.assemblyai.com/v1/ws`. We opened both paths with an unauthenticated WebSocket upgrade. Both answered `HTTP/1.1 101 Switching Protocols`, then the same frame: `{"code":"unauthorized","message":"Authentication failed","session_id":null,"param":null,"type":"session.error",...}`. So `/v1/realtime` is not retired. No page says whether it is an alias.
- **Time lost:** Not measured.
- **Workaround:** The business page reads `event.text ?? event.delta ?? ""` (the `transcript.user` handler in `web/call/index.html`) and connects to `wss://agents.assemblyai.com/v1/ws` (the answer handler in the same file), both since `41fb071`.
- **Fix we ask for:** Generate both pages and the example repository from the AsyncAPI specification. State whether `/v1/realtime` is an alias of `/v1/ws`.

### 8. AssemblyAI Voice Agent API: a per-call greeting needs a new stored agent per call

- **Task attempted:** Make the agent's first words a per-call AI disclosure that names the owner.
- **Tool and version:** AssemblyAI Voice Agent API, no version published. Pages `greeting.md`, `connect-your-own-llm.md` and `events-reference.md`, fetched with `curl` on 2026-10-18.
- **Date:** 2026-10-18, workaround in `41fb071`.
- **Re-checked:** Re-read on 2026-10-19. `session.agent_id` is still "mutually exclusive with the inline fields", and `agent_id_not_first` is unchanged.
- **Severity:** Low. It is a design limit with a workaround, at the cost of one API call per phone call.
- **Steps:** Read these three statements:
  1. `greeting.md`: the greeting "lives on the agent ... or inline over the WebSocket via [`session.update`]". It also says: "Whatever string you put here is exactly what the user hears, word for word."
  2. `connect-your-own-llm.md`: "Add an `llm` array to a [create] or [update] request." Our own endpoint therefore needs a stored agent.
  3. `events-reference.md`, row `session.agent_id`: "Bind a stored agent by ID. First `session.update` only, and mutually exclusive with the inline fields below."
- **Expected:** We can bind a stored agent that has our `llm` and still set a per-call `greeting`. Every call must open with an exact disclosure that names the household member.
- **Actual:** A session bound by `agent_id` cannot carry an inline `greeting`. The disclosure differs per call, so each call needs its own stored agent. The error code for a violation is `agent_id_not_first`, defined in `events-reference.md` as "`agent_id` was sent after the first `session.update`, or alongside inline fields in the same message". We did not trigger it, because we read the rule before coding.
- **Time lost:** Not measured. The cost that remains is one extra REST call before every call, plus a cleanup of the agent afterwards (`de30e8d`).
- **Workaround:** One stored agent per call (`src/calls/rooms.ts`, `41fb071`). Retire it when the line ends (`de30e8d`).
- **Fix we ask for:** Accept `greeting` and `system_prompt` in the same `session.update` as `agent_id`.

## Our own bugs (not vendor friction)

These bugs were in our code. We list them so judges can see the whole path. We do not count them as friction with a vendor.

### A. A `PORT` override without `PUBLIC_BASE_URL` returns `forbidden_origin`

- **Task attempted:** Run the demo server on a non-default port.
- **Version:** Ambient at `8330e91` (2026-10-12), when we noted it, and reproduced again at `1bb0ca3`. Node v24.21.0.
- **Date:** 2026-10-12, note added in `8330e91`.
- **Steps:** `PORT=3102 pnpm demo`, then request `/sim/api/state` with the browser's origin:

  ```
  curl -i -H 'Origin: http://127.0.0.1:3102' http://127.0.0.1:3102/sim/api/state
  HTTP/1.1 403 Forbidden
  {"error":"forbidden_origin"}
  ```

- **Cause:** The origin allowlist comes from `PUBLIC_BASE_URL`, which defaults to `http://127.0.0.1:3000` (`src/config.ts:21`).
- **Workaround:** Set `PUBLIC_BASE_URL` to match `PORT`, or list the origin in `AMBIENT_ALLOWED_ORIGINS`. `.env.example` now says so (`8330e91`). Deriving the allowlist from the bound port would remove the trap.

### B. The `import.meta.url === \`file://${process.argv[1]}\`` entry guard never matches on Windows

- **Task attempted:** Start the server from its ESM entry point on Windows.
- **Version:** Node v24.21.0, Windows 11.
- **Date:** 2026-10-18, fix `1ffda6a`.
- **Re-checked:** Re-ran on 2026-10-19 with Node v24.21.0. Same output: `guard: no match`.
- **Steps:** Save this as `main.mjs` and run `node main.mjs`:

  ```js
  console.log(import.meta.url); console.log(process.argv[1]);
  if (import.meta.url === `file://${process.argv[1]}`) console.log("guard: match"); else console.log("guard: no match");
  ```

- **Result:**

  ```
  file:///C:/Users/mukes/AppData/Local/Temp/fr-esm/main.mjs
  C:\Users\mukes\AppData\Local\Temp\fr-esm\main.mjs
  guard: no match
  ```

  With this guard, our server exited with code 0 and printed nothing.
- **Workaround:** Compare against `pathToFileURL(process.argv[1]).href` (`1ffda6a`).

### C. `findLast` does not type-check with `lib: ES2022`

- **Task attempted:** Use `Array.prototype.findLast` with the repository's TypeScript library setting.
- **Version:** TypeScript 5.9.3 (`pnpm exec tsc -v`), Node v24.21.0.
- **Date:** 2026-10-18, fix `fab717c`.
- **Re-checked:** Re-ran on 2026-10-19. Same error, `TS2550`.
- **Steps:** Save `const turns: number[] = [1, 2, 3]; export const last = turns.findLast(n => n > 1);` as `fl.ts`, then run `pnpm exec tsc --noEmit --target ES2022 --lib ES2022 fl.ts`.
- **Result:** `fl.ts(2,27): error TS2550: Property 'findLast' does not exist on type 'number[]'. Do you need to change your target library? Try changing the 'lib' compiler option to 'es2023' or later.`
- **Cause:** `findLast` is in `lib.es2023.array`. Our `lib` did not include it. TypeScript behaves as designed.
- **Workaround:** `"lib": ["ES2023", "DOM", "DOM.Iterable"]` in `tsconfig.json` (`fab717c`).

## Reproduction scripts

`elicit.mts` for entry 1. Save it inside a project that has `@modelcontextprotocol/sdk` 1.30.0 and `tsx`, and run it with `node --import tsx elicit.mts <mode>`, where `<mode>` is `json`, `sse`, `sse-related` or `json-related`.

```ts
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";

const mode = process.argv[2];
const server = new McpServer({ name: "repro", version: "0.0.1" });
server.registerTool("ask", { description: "elicit" }, async (extra) => {
  console.log("server: calling elicitInput");
  const schema = { type: "object" as const, properties: { x: { type: "string" as const } } };
  const options = mode.endsWith("related") ? { relatedRequestId: extra.requestId } : undefined;
  const r = await server.server.elicitInput({ message: "ok?", requestedSchema: schema }, options);
  console.log("server: elicitInput returned", r.action);
  return { content: [{ type: "text", text: "done" }] };
});
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), enableJsonResponse: mode.startsWith("json") });
await server.connect(transport);
const srv = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", c => chunks.push(c));
  req.on("end", () => void transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined));
});
await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;
const H = { accept: "application/json, text/event-stream", "content-type": "application/json" };
const init = await fetch(url, { method: "POST", headers: H, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: { elicitation: {} }, clientInfo: { name: "raw", version: "0" } } }) });
const S = { ...H, "mcp-session-id": init.headers.get("mcp-session-id")! };
await init.text();
await fetch(url, { method: "POST", headers: S, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
console.log(`client: tools/call, mode=${mode}`);
const call = fetch(url, { method: "POST", headers: S, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ask", arguments: {} } }) });
const res = await Promise.race([call, new Promise<null>(r => setTimeout(() => r(null), 3000))]);
if (!res) console.log("client: no response headers after 3000 ms");
else {
  console.log("client: status", res.status, res.headers.get("content-type"));
  const reader = res.body!.getReader();
  const first = await Promise.race([reader.read().then(x => (x.done ? "<closed>" : new TextDecoder().decode(x.value))), new Promise<string>(r => setTimeout(() => r("<no frame after 3000 ms>"), 3000))]);
  console.log("client: first frame:", first.replace(/\n/g, "\\n").slice(0, 260));
}
process.exit(0);
```

`negotiate.mts` for entry 3: create an `McpServer` and a JSON-response `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`, `POST` an `initialize` request with `protocolVersion` set to `2025-03-26` and then `2025-11-25`, and print `result.protocolVersion` from each response.
