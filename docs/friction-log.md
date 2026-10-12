# Friction log

Record an entry while a failure is reproducible. Do not invent entries for failures that have not occurred.

## Entry template

### YYYY-MM-DD HH:MM — tool or SDK

- **Task:**
- **Steps:**
- **Expected:**
- **Actual:**
- **Severity:** Critical | Important | Nice-to-have
- **Workaround:**
- **Suggestion:**

---

### 2026-10-16 — MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.30): `elicitInput` silently requires SSE responses

- **Task:** Send an approval elicitation to the client inside a `tools/call` (`server.server.elicitInput`) while the transport ran with `enableJsonResponse: true`.
- **Steps:** Enable JSON responses; call the `delegate` tool with a client that advertises `capabilities.elicitation`; the server calls `elicitInput` mid-call.
- **Expected:** The elicitation request reaches the client on the same HTTP response, like a normal result.
- **Actual:** The tool call hangs — an in-call request cannot ride a single JSON body; it needs the POST's SSE stream. Nothing in the error surface says why; the client just never sees the request.
- **Severity:** Important
- **Workaround:** Run the transport with `enableJsonResponse: false`. Every response then arrives as SSE `data:` frames, which forced a rewrite of test and script response parsing.
- **Suggestion:** `StreamableHTTPServerTransport` should throw when `elicitInput` (or any in-call server→client request) is attempted under `enableJsonResponse: true`, instead of queueing a request that can never be delivered.

### 2026-10-16 — MCP TypeScript SDK: only one in-call elicitation per outstanding request

- **Task:** A second eliciting tool call (`status`) issued while a `delegate` call's `elicitInput` was still open.
- **Steps:** Browser approves the open elicitation via `sim/api/elicit` → POST returns 200; the original `tools/call` never resolves.
- **Expected:** Each `elicitInput` is bound to its own call and resolves independently.
- **Actual:** The newer elicitation consumed the answer path; the delegate call stayed open forever. Reproduced live in the `/sim` browser and again with raw curl against `/mcp`.
- **Severity:** Critical
- **Workaround:** Never issue a second eliciting request while one is outstanding — `/sim` now pushes task-view refreshes on SSE run events instead of calling `status` for refresh.
- **Suggestion:** Document the constraint on `elicitInput`, or have the SDK multiplex concurrent in-call requests by id so callers don't have to serialize eliciting tools by hand.

### 2026-10-19 — MCP TypeScript SDK 1.30: transport security options deprecated mid-build

- **Task:** Turn on DNS-rebinding protection and host/origin allowlists on `StreamableHTTPServerTransport`.
- **Steps:** Follow the documented `allowedOrigins` / `allowedHosts` / `enableDnsRebindingProtection` constructor options.
- **Expected:** The transport rejects foreign origins itself.
- **Actual:** In 1.30 those options are deprecated (the type is still present but flagged); a fresh install lands you on the deprecated surface with no replacement named in the deprecation message.
- **Severity:** Important
- **Workaround:** Enforced origin/host allowlists as explicit middleware in `src/server.ts` ahead of the transport — same checks, ours to own.
- **Suggestion:** Name the replacement in the deprecation notice, or keep the options stable until the successor API ships.

### 2026-10-19 — MCP Apps spec vs Alexa docs: where does `ui.resourceUri` live?

- **Task:** Attach an MCP App view to a tool result.
- **Steps:** Compare the MCP Apps spec (resource URI on the tool *definition*) with the Alexa-side docs (`_meta.ui` on tool *results*), plus the deprecated flat `ui/resourceUri` key.
- **Expected:** One documented location both sides read.
- **Actual:** Three candidate locations, none of which documents which reader Alexa+ honors. Reproduced by reading both specs during Task 3.3; no client exists to disambiguate.
- **Severity:** Important
- **Workaround:** Emit `_meta.ui.resourceUri` on tool results and register the `ui://ambient/task` resource; the bundled sim host renders it, which is the only verifiable contract available.
- **Suggestion:** Publish the exact field path Alexa+ reads, with a minimal working tool result example.

### 2026-10-19 — Alexa+ documentation: protocol version ambiguity

- **Task:** Decide which MCP `protocolVersion` to negotiate for the Alexa+ client lifecycle.
- **Steps:** Read the Alexa+ client lifecycle documentation and the hackathon rules together.
- **Expected:** A single required version.
- **Actual:** The lifecycle doc shows `initialize` with `protocolVersion "2025-03-26"`; the hackathon requires 2025-11-25 or later. It is unclear which version Alexa+ actually sends.
- **Severity:** Important
- **Workaround:** The server advertises `2025-11-25` (its real supported spec); MCP version negotiation tolerates a newer client.
- **Suggestion:** Update the lifecycle doc to the hackathon-required version, or state that Alexa+ negotiates whatever the server advertises.

### 2026-10-19 — Alexa+ documentation vs MCP authorization spec: `WWW-Authenticate`

- **Task:** Decide how an unauthorized client discovers OAuth endpoints on our MCP server.
- **Steps:** Read the Alexa+ guidance on unsupported headers alongside the MCP authorization spec.
- **Expected:** Compatible discovery rules.
- **Actual:** Alexa+ guidance says `WWW-Authenticate` is unsupported, while the MCP authorization spec uses `401 + WWW-Authenticate` for discovery — a documented conflict (also noted in `docs/compatibility.md`).
- **Severity:** Important
- **Workaround:** The server still returns `WWW-Authenticate` per the MCP spec (standards clients need it) and additionally documents the OAuth endpoints in README/`.env.example` for Alexa-style configuration.
- **Suggestion:** State whether Alexa+ performs its own discovery (e.g. a well-known URI) so self-hosted servers can expose exactly one mechanism.

### 2026-10-12 — Node.js: `node:sqlite` experimental warning on every process

- **Task:** Start the server and run tests on Node 26.
- **Steps:** `pnpm demo`, `pnpm test`, any `node`/`tsx` invocation importing `node:sqlite`.
- **Expected:** Stable API warnings only where behavior may change.
- **Actual:** `ExperimentalWarning: SQLite` prints once per process start — including every test file — adding noise to logs judges will read.
- **Severity:** Nice-to-have
- **Workaround:** None needed; cosmetic. (Non-Amazon tool — include only if the friction form allows it.)
- **Suggestion:** Graduate `node:sqlite` out of experimental status, or de-duplicate the warning per install rather than per process.

### 2026-10-12 — Node.js 26: `pnpm` absent until manually installed

- **Task:** Bootstrap the toolchain on a fresh Node 26 install.
- **Steps:** `pnpm i` → `command not found`; `corepack enable` → corepack itself is no longer shipped with Node 26.
- **Expected:** `packageManager: pnpm@10.33.0` in `package.json` activates the pinned toolchain.
- **Actual:** Corepack was removed from the Node distribution; the documented bootstrap path no longer works.
- **Severity:** Nice-to-have (cost ~1 minute, but blocks a cold start)
- **Workaround:** `npm i -g pnpm@10.33.0`. (Non-Amazon tool.)
- **Suggestion:** Re-ship corepack, or have Node honor `packageManager` natively so one `package.json` field is the whole bootstrap story.

### 2026-10-12 — This project: `PORT` override without `PUBLIC_BASE_URL` 403s the browser

- **Task:** Record the demo video against `pnpm demo` on a non-default port (3102) because the default was already in use.
- **Steps:** `PORT=3102 pnpm demo`, then drive `/sim` from a headless browser.
- **Expected:** The page works; same-origin fetches to `/sim/api/*` succeed.
- **Actual:** Every browser request carried `Origin: http://127.0.0.1:3102`, which was not in the origin allowlist (seeded only from `PUBLIC_BASE_URL`, still `…:3000`) — `/sim` returned `forbidden_origin` and the elicitation card silently never appeared. Correct behavior from the middleware (DNS-rebinding protection is the point), but the failure mode was opaque: turns "worked" while follow-up calls were rejected.
- **Severity:** Important
- **Workaround:** Run with `PUBLIC_BASE_URL=http://127.0.0.1:<port>` (or add the origin via `AMBIENT_ALLOWED_ORIGINS`) whenever `PORT` differs.
- **Suggestion:** For loopback dev, derive the origin allowlist from the bound port automatically — `PUBLIC_BASE_URL` and `PORT` disagreeing is an easy trap. (Self-friction, not an Amazon tool.)
