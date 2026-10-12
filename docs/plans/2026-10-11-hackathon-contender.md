# Ambient → Hackathon Contender: Critique and Plan

> Target: **Build, Ship, Shape — Amazon Developer Hackathon**, Alexa+ track.
> Deadline **Fri 2026-10-23 12:00 PT** (12 days from this plan). Judging Nov 9–20.
> Scoring: four equally weighted criteria, each 1–5: **Technical Implementation,
> Design, Potential Impact, Quality of the Idea**. A friction log adds up to a
> **10% bonus**. Open Source mini challenge: $5k. Judges include Amazon Devices
> VPs (mostly Fire TV), Alexa's Chief Evangelist, and an Alexa Solutions Architect.
> Judging "may utilize automated AI-driven analysis", so the repo itself gets
> read by an LLM.

Execution note: this is a 12-day roadmap, not a 2-minute-step TDD script.
Each task names exact files, interfaces, acceptance checks, and the test to
write first. Use `test-driven-development` per task and
`verification-before-completion` before each commit.

---

## Part 1 — Critique

### 1.1 Baseline (measured 2026-10-11)

| Check | Result |
|---|---|
| `tsc --noEmit`, `eslint`, `knip` | clean |
| `vitest run` | 13 files, 60 tests, all pass |
| Gateway overhead (`scripts/latency.ts`, 30 samples, local) | `list_assistants` p50 1.8 ms / p95 3.4 ms; `dashboard` p50 1.7 ms |
| Fresh install on Node 22.23 | works, but warns `Unsupported engine: wanted >=24` and `ExperimentalWarning: SQLite` |
| Public repo / git remote | **none** |
| Commits since 2026-09-17 | **none** |
| Friction log entries | **zero** (template only) |
| Demo video, Devpost text, product feedback | **none** |
| Live-verified runtimes | Hermes only (2026-09-06). Townie only against a mock. Others: not live-verified. |

The engineering underneath is better than most hackathon entries. The
**submission** is close to non-existent, and the product framing works against
these judges.

### 1.2 The five problems that decide the outcome

**1. Judges cannot run it.** The FAQ says judges "can download, build, and test
it themselves." All six adapters need private infrastructure: a local Hermes
gateway, a self-hosted OpenClaw gateway, an *unofficial* Grok host gateway, a
Meta Model API key, a deployed Val Town val, and a raw Gmail OAuth token.
Nothing works with zero credentials. There is no demo mode and no bundled agent,
so a judge who clones the repo sees `/healthz` with every runtime `offline`. An
automated reviewer reaches the same verdict.

**2. The framing is aimed at the wrong audience.** "One voice surface in front
of Grok, Meta Muse, Val Town and Instinct" pitches Alexa as a dumb pipe to
competitors' assistants, and the judges are Amazon executives. "Who has six
assistants?" caps Potential Impact. The rules also say not to include
third-party trademarks in the video without permission, and Grok/Meta/Muse
appear across the README, the interaction model, and the example config.

**3. There is no product surface to demo.** The Alexa+ MCP toolkit and web
simulator are gated (per the FAQ). The FAQ says to "demo it via your own
web-based simulator or front end." The repo has neither. The only UI is a
developer dashboard, and it does not follow the MCP Apps spec (details in 1.4).
Design is one of the four criteria, and right now it has nothing to score.

**4. The voice UX reads UUIDs aloud.** `viewText()` in `src/mcp.ts:15-24`
returns `"Work id 3f2a…-… is accepted. Ask get_work with this id for the
result."` For Hermes and OpenClaw, `ask` returns immediately with `accepted`.
On Alexa that is a dead end, the exact failure the Alexa+ design guide warns
about. `GetWorkIntent` and `CancelWorkIntent` take `workId` as
`AMAZON.SearchQuery`, which assumes people will speak UUIDs.

**5. The strongest idea is buried.** The interesting parts are the
honest-state engine (`unknown` instead of guessing), runtime-namespaced
approvals that clear only on assistant confirmation, replay-gap detection, and
async work tracking. Together they are a **human-in-the-loop control plane for
autonomous agents**, and that maps exactly onto the organizers' "push past the
obvious" note: *"an agentic workflow that orchestrates across services or keeps
context across sessions stands out more."* The demo runbook spends its time on
switching between assistants instead.

### 1.3 Scorecard (current vs. after this plan)

| Criterion | Now | Why | Target | What moves it |
|---|---|---|---|---|
| Technical Implementation | 2.5–3 | Solid engine and tests, but judges can't verify it, MCP Apps is wrong, no elicitation/tasks, no signature verification, no deployment evidence | 4.5 | Zero-cred run, Bedrock agent, elicitation approvals, MCP Apps-compliant UI, deployed on AWS with receipts |
| Design | 1.5 | No demoable surface; voice reads ids; dashboard is a 13px dev tool | 4–4.5 | Alexa+ simulator with device classes, voice-first results, UI built to the Alexa design guide |
| Potential Impact | 2 | Niche (people running six assistants); routes Alexa to competitors | 4 | "Alexa supervises your agents" as a reference pattern for a whole add-on category |
| Quality of the Idea | 3 | "Universal remote" is fine; the honest-state differentiator isn't visible | 4.5 | Lead with approvals, async work, and honesty under failure |
| Friction bonus | 0% | Empty log | up to +10% | 6–8 real, reproduced entries |

### 1.4 Technical critique, file by file

**MCP surface (`src/mcp.ts`)**
- Eleven tools that overlap (`list_conversations`/`select_conversation`,
  `steer_work`/`ask`). The Alexa+ tools guide says one tool per customer intent,
  without overlap, and "declare only what you honor". `ask.conversationId` and
  every `workId`/`approvalId` parameter are ids that a voice model can't
  produce from what the customer said.
- Tool text is engineer-speak (`"Approval request: hermes:abc123."`). Alexa
  builds speech from your data. Return a short, speakable summary plus
  structured data.
- `dashboard` declares `_meta: { "ui/resourceUri": … }`. That flat key is
  **deprecated** in MCP Apps 2026-01-26 ("will be removed before GA"). Use
  `_meta.ui.resourceUri`. Alexa's lifecycle doc also returns `_meta.ui` with
  `invoking`/`invoked` strings on the tool *result*.
- No MCP **elicitation** even though SDK 1.30 has `elicitInput`, and the Alexa+
  lifecycle doc says Alexa+ handles elicitation requests. Approvals are the
  textbook elicitation case.
- No MCP **Tasks** (experimental in 2025-11-25, present in SDK 1.30 under
  `experimental/tasks`), which is the protocol-native primitive for exactly
  this async-work problem.

**Dashboard (`src/dashboard.ts`)**
- Skips the MCP Apps handshake: it posts `ui/notifications/initialized` without
  first sending `ui/initialize`, and never reads `hostContext`. Spec-compliant
  hosts may never deliver data to it.
- Ignores Alexa's `hostContext.deviceClass`/`displayMode`, so it can't adapt
  between Echo Show 8, Echo Show 15, mobile, and voice-only.
- 13px monospace with tiny chips and buttons is unreadable on an Echo Show at
  arm's length and misses the touch-target minimums on the Accessibility page.
- Polls `tools/call dashboard` every 2.5 s forever, with no teardown handling.
  Each poll fans out to `listRuns(10)` × N runtimes, and every run does a
  separate `store.view()` (an N+1 query pattern). It's cheap today but wasteful
  and visibly amateur.
- A 65-line HTML string with inline JS can't be tested or linted.

**HTTP server (`src/server.ts`)**
- No `Origin` validation. The MCP Streamable HTTP spec requires servers to
  validate `Origin` against DNS rebinding. On top of that, `/mcp` sends
  `access-control-allow-origin: *`, and `ALLOW_UNAUTHENTICATED=true` is the
  documented dev path. The SDK already ships `allowedOrigins` and
  `enableDnsRebindingProtection`.
- MCP sessions live in a `Map` that only shrinks on `DELETE`. Alexa+ is
  explicitly *not* MCP-session-based ("the session is based on the customer's
  previous conversations rather than an explicit identifier"), so sessions
  leak. Add idle eviction.
- `enableJsonResponse: true` rules out server-to-client requests during a
  tool call, which elicitation needs. Tool calls that might elicit have to use
  SSE responses.
- `/healthz` is unauthenticated and exposes every runtime id, adapter,
  capability set, and state.
- The Alexa endpoint does **not verify Amazon request signatures** (cert chain
  plus a 150 s timestamp). That is a certification requirement and a real
  hole. `docs/acceptance.md` admits it.

**Alexa skill (`src/alexa.ts`, `alexa/interaction-model.en-GB.json`)**
- `ProvideRequestIntent` has the sample `"{request}"` with an
  `AMAZON.SearchQuery` slot. ASK requires a carrier phrase for SearchQuery, so
  this model will probably **fail to build**. `"ask {assistant} {request}"`
  puts SearchQuery next to another slot, which ASK also restricts. Check both
  by importing the model.
- en-GB only. US judges and the US simulator need en-US.
- The `AssistantName` slot hardcodes `grokbot`, `meta muse`, and `val town`
  (trademarks again).
- Every action needs an id in session attributes. There's no "the latest one"
  or "the flights task" resolution beyond `lastWorkId`.
- The intent dispatch is a 150-line if-chain. Fine for now, but it duplicates
  `mcp.ts` logic instead of sharing one "voice result" layer.

**Engine and types (`src/conversations.ts`, `src/runtimes/types.ts`)**
- Strengths worth keeping: replay-gap handling, approvals that clear only on
  a positive `resolved` count, double-checked active-run guards, and
  `markActiveRunsUnknown` on restart.
- The "neutral" `AssistantClient` interface leaks Hermes wire shapes:
  `ActiveSession.session_key`, `SavedSession.started_at`, approval payloads
  read as `payload.request_id`, and `submitPrompt` returning
  `Record<string, unknown>` with magic `status: "streaming" | "interrupted"`
  strings. `AssistantEvent` is `{ type: string; payload: Record<string,
  unknown> }`, not a discriminated union. An AI-driven code reviewer will flag
  this as stringly typed.
- `ask()` can never wait for an answer, which forces the poll-by-id UX.

**Adapters (`src/runtimes/*`)**
- `instinct.ts`: takes a raw Google OAuth **access token**, which expires
  after about an hour, with no refresh flow. Every 15 s it fetches up to 10
  full messages per pending run (about 40 Gmail calls a minute per run).
- `grokbot.ts`: an unofficial gateway, and completion is a heuristic ("3
  stable polls") that can cut long answers short.
- `muse.ts`: transcripts live only in process memory. It pings `/models`
  every 30 s. The model id `muse-spark-1.1` and the endpoint are unverified.
- `townie.ts`: has only ever run against a mock.
- Net: four of six adapters have never touched their real service. They add
  surface area, trademark risk, and "is this real?" doubt, and they don't
  help with these judges.

**Repo and DX**
- `engines: node >=24` blocks the most common LTS, yet everything works on
  22.23 (`node:sqlite` is unflagged from 22.13).
- `aws-cdk-lib` is a runtime `dependency`, which bloats every install.
- Naming drift: package `hermesambient`, data dir `.hermes-ambient`, product
  "Ambient", page titles "Link Ambient", client names `hermes-ambient-latency`.
- The repo root carries `decisions.tsv` (21 KB), `.audit/`, `.pytest_cache`,
  `.hermes-ambient-smoke/`, and two scan reports in `docs/`. That reads as
  process exhaust, not product.
- The README has no screenshot, GIF, diagram image, or "run it in 60 seconds"
  path, and it doesn't state the track-compliance facts up front (MCP
  `2025-11-25`, Streamable HTTP, entry point).
- No CI. Nothing proves `pnpm scan` is green on a clean machine.

**Infra (`infra/stack.ts`)**
- EC2 in a public subnet with 80/443 open, but TLS isn't wired. "Deploy the
  bridge with HTTPS on AWS" is still open in `acceptance.md`. AWS is barely
  used, which leaves the required "AWS services" feedback section thin.

**Performance**
- The gateway adds about 2 ms. It is not the bottleneck. **Voice latency is**:
  `ask` against a real agent takes seconds to minutes. The Alexa design guide
  wants the first visual content within ~500 ms. Fix this with a bounded wait,
  an immediate acknowledgement, a progress UI, and elicitation, not with
  micro-optimisation.

---

## Part 2 — The reframe

**Name:** Ambient. **Tagline:** *Your AI agents work in the background. Alexa
tells you when they need you.*

**Positioning for Amazon judges:** agents are arriving in every household
(coding agents, research agents, shopping agents, home agents). They run for
minutes or hours, and they hit decisions that need a human. Alexa+ already sits
in the kitchen and the living room, so it is the natural **ambient supervisor**.
Ambient is the reference Alexa+ add-on for that job: delegate work by voice,
see live progress on an Echo Show, approve consequential actions by voice with
exact confirmation, and get an honest answer when something is uncertain. It
works with any agent through a small adapter interface. It ships with an
Amazon Bedrock agent built in, and it can also connect open-source agents
(Hermes, OpenClaw).

**Core loop (this is the demo):**
1. *"Alexa, ask Ambient to have my agent plan Saturday: find a 7pm table for
   four near me and add it to my calendar."* The agent starts; a live task card
   shows its steps.
2. The agent reaches a consequential step and asks for approval. Ambient raises
   an MCP elicitation. Alexa says: *"Your agent wants to book Lupa at 7pm for
   four, with a $40 deposit. Approve once, or deny?"* The user says "approve".
   It clears only after the agent confirms.
3. Later: *"Alexa, what did my agents get done today?"* returns a briefing
   across agents and sessions (context across sessions).
4. Honesty: the laptop running the coding agent goes to sleep. *"Your coding
   agent disconnected before confirming the deploy. I won't retry it. Ask
   again when it's back."*

**Adapter decision:**
- **Keep:** `hermes` (live-verified), `openclaw` (open source, has approvals).
- **Add:** `bedrock` (new default and the zero-friction real agent) and `demo`
  (deterministic, zero credentials).
- **Remove from the pitch, README, interaction model, and video:** `grokbot`,
  `muse`, `townie`, `instinct`. Move them to `src/runtimes/contrib/` behind
  the same interface, or delete them. Rule: **any adapter without a live
  receipt by Oct 18 gets cut.** That reduces trademark risk, review surface,
  and "is this real?" doubt.

---

## Part 3 — Plan

Priorities: **P0** is required to be a contender. **P1** is what separates
1st place from top 10. **P2** is only if time remains. Days are approximate.

### Phase 0 — Setup and hygiene (Day 1, Oct 12)

**Task 0.1 — Public repo plus CI**
- Create a public GitHub repo (MIT already in `LICENSE`) and push.
- Add `.github/workflows/ci.yml` on Node 22 and 24 that runs `pnpm install
  --frozen-lockfile && pnpm scan && pnpm build`.
- Acceptance: green badge in the README.

**Task 0.2 — Node and dependency hygiene**
- `package.json`: set `engines.node` to `>=22.13`; move `aws-cdk-lib` and
  `constructs` to `devDependencies` (they're only used by `infra/`); rename the
  package to `ambient`.
- Silence the SQLite experimental warning in scripts (`NODE_OPTIONS=--no-warnings=ExperimentalWarning`
  in `dev`/`demo` scripts), or document it.
- Rename `.hermes-ambient` to `.ambient` (default `AMBIENT_DATA_DIR` in
  `src/config.ts:30`) and update `.gitignore`.
- Acceptance: `pnpm i && pnpm scan` is warning-free on Node 22.13+.

**Task 0.3 — Repo declutter**
- Move `decisions.tsv`, `docs/scan-*.md`, and `.audit/` to `docs/engineering/`
  (or delete). Delete `.hermes-ambient-smoke/` and `.pytest_cache/`, and
  gitignore them.
- Commit: "Prepare repo for public submission".

### Phase 1 — Zero-credential, real-agent runtime (Days 1–3) — P0

**Task 1.1 — `demo` adapter (deterministic, no network)**
- Create `src/runtimes/demo.ts` implementing `AssistantClient`, with scripted
  agents keyed by keywords:
  - "plan/book/table" → three progress events → an `approval.request`
    (`command: "Book Lupa, 7pm, party of 4 — $40 deposit"`) → `message.complete`
    after approval.
  - "research/compare" → about 8 s of progress → complete with a three-item
    summary.
  - "deploy" → progress → a simulated disconnect (`emitState("offline")`) to
    demonstrate `unknown`.
  - Supports `steer`, `interrupt`, `respondToApproval`, and
    `listPendingApprovals`. Timings come from `options.speed` so tests run
    instantly.
- Register it in `ADAPTERS` (`src/runtimes/registry.ts:333`).
- Tests first (`test/demo-adapter.test.ts`): the approval flow reaches
  `waiting_approval`, `respondToApproval("once")` returns `{resolved:1}` and
  then completes, deny leads to completion with a denial message, and the
  deploy script ends `unknown`.
- Add `runtimes.demo.json` and the script `"demo": "AMBIENT_RUNTIMES_FILE=runtimes.demo.json ALLOW_UNAUTHENTICATED=true tsx src/server.ts"`.

**Task 1.2 — `bedrock` adapter (a real agent on AWS)**
- Create `src/runtimes/bedrock.ts` using `@aws-sdk/client-bedrock-runtime`
  `ConverseCommand` with tool use. Pick a dependency version that has been out
  for at least 7 days.
- Default model: an Amazon Nova model available in the account's region, set
  through `options.model`.
- The agent loop runs in-process: the model calls tools until it ends its
  turn. Each tool call emits `tool.start`/`tool.complete` events, which feed
  the progress UI.
- Tools: `web_search` (stub or a real API if available), `calendar_list` /
  `calendar_add` (local JSON file in the data dir), `reservation_search` (stub
  data), and `reservation_book`. **`requiresApproval: true`** on `book`/`add`
  makes the loop pause, emit `approval.request` with a human-readable
  `command`, and resume on `respondToApproval`. This is the honest-approval
  path end to end.
- Capabilities: `sessions/steer/cancel/approvals/resume: true`, `asyncClass:
  "realtime"`. Persist the conversation transcript in SQLite (new table
  `transcripts(conversation_id, seq, role, json)`) so restarts keep context,
  which fixes the Muse-style amnesia.
- Tests: mock `BedrockRuntimeClient.send` and assert the tool loop, the
  approval pause and resume, cancel via `AbortController`, and transcript
  persistence.
- Credentials: the standard AWS chain (`AWS_PROFILE`/env/instance role). There
  are no secrets in config.
- Acceptance: `pnpm check:runtime bedrock` returns `completed` with real text.

**Task 1.3 — Cut or quarantine the unverified adapters**
- Move `grokbot.ts`, `muse.ts`, `townie.ts`, and `instinct.ts` with their
  tests to `src/runtimes/contrib/`, or delete them. Remove them from
  `runtimes.example.json`, the README, `docs/runtimes.md`, and the
  `AssistantName` slot.
- Update knip config if needed. Run `pnpm scan`.

### Phase 2 — Voice-first MCP contract (Days 3–5) — P0

**Task 2.1 — Bounded wait in `ask`**
- `ConversationEngine.ask(…, { waitMs })`: after submitting, wait for the run
  to reach `completed | failed | cancelled | waiting_approval | unknown` or for
  `waitMs` to elapse. Implement it with an engine-level `EventEmitter` fired
  from `store.updateRun` call sites (add a `private changed(runId)` helper),
  not by polling.
- Default `AMBIENT_ASK_WAIT_MS=6000` (add to `src/config.ts`).
- Tests: a fast demo agent returns `completed` inline; a slow one returns
  `running` at the deadline; an approval returns `waiting_approval` inline.

**Task 2.2 — Speakable results, no ids in speech**
- Create `src/voice.ts` with one `speak(view, ctx)` used by **both**
  `mcp.ts` and `alexa.ts` (delete `viewText`). Rules:
  - Never include ids. Refer to work by a generated short title: the first
    5–7 meaningful words of the instruction, stored as a new `runs.title`
    column.
  - Keep it to two sentences or fewer, put the outcome first, and end
    open states with what the user can say next ("Say 'what's the status' any
    time.").
- Result shape for every tool:
  ```ts
  { content: [{ type: "text", text: speech }],
    structuredContent: { speech, status, assistant, task: { title, status, steps: string[], answer? }, approvals: [...] },
    _meta: { ui: { resourceUri: "ui://ambient/task", invoking: "Asking your agent…", invoked: "Agent replied" } } }
  ```
- Golden tests in `test/voice.test.ts`: one snapshot per status, asserting no
  UUID regex appears in `speech`.

**Task 2.3 — Collapse the tool surface to customer intents**
- New tool set (about six):
  - `delegate(task, agent?)`: start or continue work. Replaces `ask`.
  - `status(about?)`: "how's it going" / "the flights task". Fuzzy-matches the
    title, defaults to the latest run, and covers `get_work` and
    `list_conversations`.
  - `approve(decision, about?)`: resolves the single pending approval or
    fuzzy-matches by title or command. Replaces `respond_to_approval` and
    `list_approvals`.
  - `stop(about?)`: replaces `cancel_work`.
  - `agents()`: replaces `list_assistants`/`select_assistant`. `agent` becomes
    an optional parameter elsewhere.
  - `briefing(since?)`: see 4.2.
- Keep exact-id parameters as optional `id` fields for programmatic clients
  (the dashboard), but voice never needs them.
- Rewrite tool descriptions to say when to call the tool and what it returns,
  following the Alexa tools guide.
- Update `test/mcp.test.ts`, `test/multi-runtime.test.ts`, and
  `scripts/smoke-mcp.ts`.

**Task 2.4 — Approvals via MCP elicitation**
- In `delegate`/`status`, when the run is `waiting_approval` **and**
  `server.server.getClientCapabilities()?.elicitation` is set: call
  `server.server.elicitInput({ message: speech, requestedSchema: { type:
  "object", properties: { decision: { type: "string", enum: ["approve_once",
  "deny"], description: "…" } }, required: ["decision"] } })`.
  - `action: "accept"` → `engine.respondToApproval(...)`.
  - `decline`/`cancel` → leave it pending and say so.
- This needs SSE responses for that request. Set `enableJsonResponse: false`
  in `src/server.ts:273`, or make it conditional, and send through
  `extra.sendRequest` so the elicitation stays tied to the tool call.
- Without elicitation support, return the approval in `structuredContent` and
  speech ("Say approve or deny"), and handle it with the `approve` tool.
- Tests: an in-memory client that declares elicitation and auto-accepts, and
  one without the capability.

**Task 2.5 (P1) — MCP Tasks for long work** — **DONE (2026-10-12, deviated)**
- Use SDK 1.30 `experimental/tasks`: let `delegate` accept task augmentation
  so clients that support it get a task handle and `tasks/get`/`tasks/result`
  map onto engine runs. Keep `status` as the universal fallback.
- Only claim this in the README if a test proves round-trip with the SDK
  client.
- Deviation: shipped as `delegate_task`, not an augmented `delegate` — the
  SDK auto-polls plain calls on `optional` tools with no bound, which would
  break Alexa's bounded ask on approvals. `delegate_task` gives task-capable
  clients the handle (`working`/`input_required`/`completed`/`failed`/
  `cancelled`); round-trip proven in `test/tasks.test.ts` and over HTTP in
  `scripts/smoke-tasks.ts`.

### Phase 3 — Alexa+ simulated experience and UI (Days 5–8) — P0

This is where Design gets won. The rules explicitly allow a simulated Alexa+
experience, and the FAQ recommends demoing through your own front end. Build
both: the **real** MCP server, plus a **simulated Alexa+ host** that talks to
it as a real MCP client.

**Task 3.1 — Sim host server (`src/sim/`)**
- `GET /sim` serves a static app from `web/sim/`.
- `POST /sim/api/turn {utterance, device}`: a server-side orchestrator that
  plays the role of Alexa.
  - It connects to its own `/mcp` with `@modelcontextprotocol/sdk` `Client`
    over `StreamableHTTPClientTransport`. This is a real MCP round-trip, which
    also satisfies the track's runtime-hook requirement.
  - It uses Bedrock Converse to choose tools from `tools/list`. Without AWS
    credentials, it falls back to a deterministic keyword router so `pnpm
    demo` still works offline.
  - It handles `elicitation/create` from the server by returning it to the
    browser as a prompt turn.
  - It streams turn events to the browser over SSE: `speech`,
    `ui-resource`, `elicitation`, `progress`.
- `GET /sim/api/events` is an SSE feed of approvals and state changes, which
  drives the "Alexa has something for you" ring.
- Gate everything behind `AMBIENT_SIM=true`. Off by default in production.

**Task 3.2 — Sim front end (`web/sim/index.html`, `sim.js`, `sim.css`, no build step)**
- An Echo Show frame with a device switcher: **Echo Show 8**, **Echo Show
  15**, **Fire TV** (a nod to the judges), **Mobile**, and **Voice-only (Echo
  Dot)**.
- Voice in through Web Speech `SpeechRecognition` (Chrome). Voice out through
  `speechSynthesis`. A text box as fallback. An animated light bar for
  listening, thinking, speaking, and notification states.
- **The sim is an MCP Apps host.** Render the `ui://` resource in a sandboxed
  iframe, answer the view's `ui/initialize` with `hostContext: { deviceClass,
  displayMode: "inline", maxWidth, maxHeight, theme, platform }`, forward
  `tools/call` to `/mcp`, send `ui/notifications/tool-result`, and send
  `host-context-changed` when the device switcher changes.
- Label it clearly as an "Alexa+ simulation" (it makes the experience obvious
  in the video). Use generic visuals, not Amazon logos.
- Use the `frontend-craft` skill. Verify each device class with the T3
  preview browser and take screenshots.

**Task 3.3 — Rebuild the MCP App views (`web/apps/task.html`, `web/apps/dashboard.html`)**
- Move the HTML out of TS strings into files. Read and inline them at startup
  (`readFileSync` once) so they stay testable and lintable.
- Use `@modelcontextprotocol/ext-apps` (the `App` class: `connect()`,
  `ontoolresult`, `callServerTool`) if a version at least 7 days old is
  available. Otherwise hand-implement `ui/initialize` →
  `ui/notifications/initialized` correctly.
- Declare `_meta: { ui: { resourceUri } }` on tools (not the deprecated flat
  key).
- Follow the Alexa design guide patterns:
  - **Task card** (Card pattern): title, agent, live step list, and the
    answer.
  - **Approval card**: the exact action in plain words, two large buttons
    (Approve once / Deny), and the agent's name. Use the touch-target minimums
    from the Accessibility page.
  - **Agents and work** (List pattern): 3–5 items inline, "See more" goes
    fullscreen.
  - Use a **Block** (landscape) viewport for Echo Show, read `deviceClass`
    once to set a root CSS class, and re-resolve on `host-context-changed`.
  - Large type and high contrast for arm's-length reading, with
    light and dark themes from `hostContext.theme`.
- Remove the 2.5 s poll. Update on `ontoolresult`, plus an optional 5 s poll
  that runs only while visible (`document.visibilityState`) and stops on
  `ui/resource-teardown`.
- Fix the N+1: add `store.recentRunViews(runtimeIds, limit)` as one query.

**Task 3.4 — Proactive "needs you" moment**
- In the sim, a yellow ring plus the chime "Your agent needs approval" when
  `/sim/api/events` emits `approval.created`. Then "Alexa, what does it need?"
  leads to elicitation.
- (P2) Real Echo path: Alexa Proactive Events API
  (`AMAZON.MessageAlert.Activated`) from the custom skill. Only claim it if it
  actually works.

### Phase 4 — Context across sessions (Day 8) — P1

**Task 4.1 — Per-conversation transcript persistence** (done for Bedrock in
1.2). Generalize: the engine stores the final answer and title per run, which
it already mostly does.

**Task 4.2 — `briefing(since?)` tool**
- Aggregates runs across all agents since `since` (default: the last briefing
  or 24 h). Groups them into completed, waiting on you, failed, and uncertain,
  and produces ≤ 3 spoken sentences plus a List view.
- Stores `last_briefing_at` in meta.
- Tests: mixed statuses produce the correct grouping and wording.

### Phase 5 — Security and compliance hardening (Day 9) — P0

**Task 5.1 — Origin and DNS-rebinding protection**: pass `allowedOrigins`
(from `PUBLIC_BASE_URL` plus a configurable list), `allowedHosts`, and
`enableDnsRebindingProtection: true` to the transport. Drop `*` CORS on
`/mcp`. Test that a foreign `Origin` gets a 403.

**Task 5.2 — Session eviction**: track `lastSeenAt` per MCP session and sweep
every 60 s, closing sessions idle for more than 30 min. Test it with fake
timers.

**Task 5.3 — `/healthz`**: return `{ok:true}` publicly. Return the runtime
detail only with a valid bearer token.

**Task 5.4 — Alexa request verification**: verify the
`SignatureCertChainUrl` and `Signature-256` headers and the timestamp
(±150 s). Use `ask-sdk-express-adapter`'s `SkillRequestSignatureVerifier` and
`TimestampVerifier` (check package age and maintenance) or a small
hand-rolled verifier. Pass the raw body and headers into
`handleAlexaRequest`. Tests: tampered body → 400, stale timestamp → 400.

**Task 5.5 — Interaction model**: add carrier phrases to every SearchQuery
sample (`"tell my agent {request}"`, `"ask it to {request}"`), remove
SearchQuery-adjacent slots, drop id slots, add `en-US`, and replace the
trademarked names with "my agent", "my coding agent", "Hermes", "OpenClaw".
Import into the ASK console and **build the model**. Record that in the
friction log if the build fails.

### Phase 6 — AWS deployment and receipts (Day 9–10) — P1

**Task 6.1 — TLS on the CDK stack**: user data installs Node 22 and Caddy,
with Caddy auto-TLS for a domain or `sslip.io` hostname pointed at an Elastic
IP. Run Ambient under systemd with `AWS_REGION` and an instance role granting
`bedrock:InvokeModel` and `bedrock:Converse` scoped to the chosen model ARN.
Secrets go in Secrets Manager (already provisioned) and load into env at boot.

**Task 6.2 — Receipts**: run `pnpm check:runtime bedrock`, `pnpm smoke:mcp`
against the HTTPS URL, and `pnpm latency` against the deployed endpoint, and
paste the sanitized JSON into `docs/acceptance.md`. Tear the stack down after
recording and keep `pnpm infra:deploy` documented. The FAQ says hosting isn't
required for judging.

**Task 6.3 — Real MCP client proof**: connect MCP Inspector, or any MCP Apps
host such as Claude, to the deployed `/mcp`. Screenshot the negotiated
`protocolVersion: 2025-11-25` and the task card rendering. This shows the
server works outside your own simulator.

### Phase 7 — Open source polish (Day 10) — P1 (Open Source mini challenge)

- Add `docs/adapters.md`, "Write an adapter in 80 lines", with the `demo`
  adapter as the template, plus `CONTRIBUTING.md`.
- Tighten `AssistantClient` types: make `AssistantEvent` a discriminated union
  (`{type:"approval.request"; payload: ApprovalPayload} | …`), make
  `submitPrompt` return `{ state: "accepted" | "streaming" }`, rename
  `session_key` → `durableId` in `ActiveSession`, and move the Hermes wire
  mapping into `hermes.ts`. This is the most visible engineering-quality
  upgrade for code reviewers. Keep tests green after each rename.

### Phase 8 — Submission assets (Days 10–11) — P0

**Task 8.1 — README rewrite** (top to bottom):
1. One-line pitch and a GIF of the sim approval moment.
2. A compliance box: *Alexa+ track · self-hosted MCP server · MCP 2025-11-25 ·
   Streamable HTTP · entry point `src/server.ts` (`createMcpServer` in
   `src/mcp.ts`) · plus a simulated Alexa+ host at `/sim`.*
3. Run it in 60 seconds: `pnpm i && pnpm demo`, then open
   `http://localhost:3000/sim`. Zero credentials.
4. With AWS: `AWS_PROFILE=… pnpm dev:bedrock`.
5. An architecture diagram as an SVG (use the `archify` skill from real repo
   evidence).
6. Honesty guarantees: a table of states and what Alexa says for each.
7. Tests and CI badge.
8. Limits, stated plainly.

**Task 8.2 — Friction log (worth up to 10%)**: only entries you actually
reproduce. These are candidates already observed while building:
- Alexa+ MCP toolkit, CLI, and web simulator are gated for hackathon entrants,
  and some setup pages lack the preview banner (the FAQ confirms it).
- The Alexa+ client lifecycle doc shows `initialize` with `protocolVersion
  "2025-03-26"`, while the hackathon requires 2025-11-25 or later, so it's
  unclear what Alexa+ actually negotiates.
- Alexa+ auth guidance says `WWW-Authenticate` isn't supported, which
  conflicts with the MCP authorization spec's 401 + `WWW-Authenticate`
  discovery (already noted in `docs/compatibility.md`).
- MCP Apps: the `ui/resourceUri` → `_meta.ui.resourceUri` deprecation. The
  Alexa docs show `_meta.ui` on tool *results*, the MCP Apps spec on tool
  *definitions*, and neither says which one Alexa+ reads.
- ASK interaction model build errors for SearchQuery samples (if reproduced in
  5.5).
- Bedrock model access, region availability, and onboarding friction (record
  whatever actually happens in 1.2).
- `node:sqlite` experimental warning noise (minor, Node not Amazon. Include
  only if the form allows non-Amazon tools).

Use the template already in `docs/friction-log.md` (task, steps,
expected/actual, severity, workaround, suggestion).

**Task 8.3 — Product feedback (required)**: one section per tool (Alexa+ docs
and design guide, ASK custom skills and account linking, MCP TypeScript SDK,
MCP Apps, Amazon Bedrock Converse, AWS CDK, EC2, Secrets Manager). For each:
what you used it for, what worked, what needs work, the onboarding
time-to-hello-world, and whether you'd build with it again and why. Name
concrete APIs and pages.

**Task 8.4 — Demo video (under 3:00, aim for 2:45, public YouTube, English, no
third-party music or trademarks)**

| Time | Shot | Voiceover beat |
|---|---|---|
| 0:00–0:10 | Sim Echo Show, yellow ring. "Alexa, what do my agents need?" | Cold open: an approval request, spoken |
| 0:10–0:22 | Title card | "Agents now run for hours. Alexa should supervise them." |
| 0:22–1:05 | Delegate the Saturday plan by voice. The live task card shows steps. Elicitation: "Approve once or deny?" "Approve." The card shows it confirmed by the agent. | The core loop, with real Bedrock tool calls |
| 1:05–1:25 | Switch the device: Echo Show 15 → Mobile → Voice-only | Same MCP response adapts per `hostContext.deviceClass` |
| 1:25–1:45 | Kill the coding agent's host. "Is the deploy done?" "It disconnected before confirming. I won't retry it." | Honest state is the differentiator |
| 1:45–2:05 | "What did my agents get done today?" | Briefing across agents and sessions |
| 2:05–2:25 | MCP Inspector against the deployed HTTPS endpoint: `2025-11-25`, the tool list, the task card | It's a real, standards-based MCP server on AWS |
| 2:25–2:40 | Architecture SVG, CI green, test count | Technical credibility |
| 2:40–2:50 | Close | "Ambient: your agents work in the background. Alexa tells you when they need you." |

Record with the deterministic `demo` agent for the honesty beat and a real
Bedrock agent for the core loop. Say on camera which is which.

**Task 8.5 — Devpost text**: Inspiration, What it does, How we built it
(name AWS services), Challenges (replay gaps, honest approvals), What's next
(Alexa+ add-on certification path and agent categories). Map each section
to a judging criterion. Add screenshots of every device class.

### Phase 9 — Freeze and QA (Day 11, Oct 22) — P0

- Do a clean clone on a second machine or in a `cua-sandboxes` VM. Follow only
  the README, with `pnpm i && pnpm demo`, and time it. Target: under 2 minutes
  to the first spoken answer.
- `pnpm scan && pnpm build` green in CI. Then check the video link is public
  and the repo is public with its license.
- **Submit on Oct 22.** Oct 23 morning is buffer only.

---

## Part 4 — Schedule

| Day | Date | Work |
|---|---|---|
| 1 | Sun Oct 12 | Phase 0; Task 1.1 (demo adapter) |
| 2 | Mon Oct 13 | Task 1.2 (Bedrock adapter) |
| 3 | Tue Oct 14 | Task 1.3; Tasks 2.1–2.2 |
| 4 | Wed Oct 15 | Tasks 2.3–2.4 (intent tools, elicitation) |
| 5 | Thu Oct 16 | Task 3.1 (sim orchestrator) |
| 6 | Fri Oct 17 | Task 3.2 (sim front end, voice, device switcher) |
| 7 | Sat Oct 18 | Task 3.3 (MCP App views); **adapter live-receipt cutoff** |
| 8 | Sun Oct 19 | Tasks 3.4, 4.2 (proactive ring, briefing) |
| 9 | Mon Oct 20 | Phase 5 (security, Alexa verification, interaction model) |
| 10 | Tue Oct 21 | Phase 6 (AWS TLS deploy, receipts); Phase 7 types pass |
| 11 | Wed Oct 22 | Phase 8 (README, friction log, feedback, video, Devpost); Phase 9 QA; **submit** |
| — | Thu Oct 23 | Buffer until 12:00 PT |

**Cut order if behind:** 2.5 Tasks → 3.4 Proactive Events (keep the sim ring)
→ Phase 7 type refactor → Fire TV device class → 6.1 TLS (fall back to a
local demo plus an MCP Inspector receipt). **Never cut:** zero-credential
demo, voice-first results, elicitation approvals, the sim with device classes,
the video, the friction log, the feedback.

## Part 5 — Definition of done

- [ ] `git clone && pnpm i && pnpm demo` gets to a spoken answer at `/sim` in under 2 min, with zero credentials
- [ ] No tool `speech` output contains an id (enforced by a test)
- [ ] Approval via MCP elicitation works end to end in the sim and is test-covered
- [ ] MCP App views complete `ui/initialize` and adapt to 4+ device classes
- [ ] Bedrock agent completes a real multi-tool task with an approval gate (receipt in `docs/acceptance.md`)
- [ ] Origin validation, session eviction, Alexa signature verification, minimal `/healthz`
- [ ] The interaction model builds in the ASK console (en-US and en-GB)
- [ ] CI green; README compliance box; architecture SVG; GIF
- [ ] Friction log has 5+ reproduced entries; product feedback covers every tool used
- [ ] Video under 3:00, public; Devpost submitted by Oct 22
