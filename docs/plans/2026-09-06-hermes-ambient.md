# Hermes Ambient plan

Status: revised architecture; local bridge implemented, Alexa and AWS acceptance pending.

This replaces the attached 8,333-line implementation recipe. The attachment remains historical input. Its embedded execution instructions, code examples, and expected test results are not an execution contract.

## Goal and decisions

Use the owner's existing Hermes through Alexa+ MCP for the primary hackathon submission, while keeping a standard Alexa custom skill as an optional daily-use route for the owner's existing Echo. The same Ambient controls should serve both hosts without duplicating Hermes's tools or state.

The owner wants both personal daily use and a hackathon demo. Existing-computer or existing-server Hermes is the default. Cloud-hosted Hermes is an additional deployment option. Quick questions are part of the product, but do not replace the requested ability to start, inspect, steer, approve, cancel, and continue work.

The downstairs utterance is illustrative, not a product integration requirement. The product value is reaching the owner's existing Hermes for personal questions, follow-ups, and agent work without adding a second tool or data system to Ambient.

“Fully use Hermes through Alexa” means Alexa can send instructions to Hermes and expose the results and controls needed to complete work. Hermes retains responsibility for reasoning, tools, skills, memory, and its approval policy. Ambient does not duplicate Hermes's tools as separate Alexa tools.

Some Hermes interactions may require a display, a file, a login, or an original-device action. Report that requirement explicitly and preserve the session. Do not promise that voice can perform every graphical interaction or that every Hermes permission prompt is already remotely answerable.

## Product behavior

| Intent | Required behavior |
| --- | --- |
| Ask a personal question | Send the question to the selected Hermes, return its answer, and retain conversational context for follow-ups. |
| Ask a follow-up | Continue the selected conversation; do not create a new session for every utterance. |
| Start work | Submit an instruction, distinguish queued from accepted work, and return a reference without waiting indefinitely for completion. |
| Inspect work | Report the selected run's current status and result, including offline, unknown, or waiting states. |
| Steer work | Send an instruction to a confirmed live run in the same Hermes runtime. |
| Approve or deny | Identify the actual pending request, present what it authorizes, and resolve that request through Hermes. |
| Cancel work | Request interruption of the owning live run and distinguish the request from confirmed cancellation. |
| Continue a conversation | Resume durable history through the installed Hermes contract without claiming the old worker is still running. |
| Use another surface | Open or attach a supported Hermes client to the same backend and verify that it observes the same conversation. |
| Use cloud Hermes | Explicitly select a separately configured cloud runtime with its own environment and sessions. |

The demo must include a useful personal question and a task that uses a real Hermes capability. A control demonstration alone is insufficient. Use benign, reversible activity for the approval demonstration and preserve the actual Hermes approval boundary.

## Architecture

The default submission topology is:

```text
Alexa+ MCP add-on
  -> authenticated Streamable HTTP MCP endpoint on AWS
  -> Ambient bridge
  -> authenticated connection initiated by the owner's machine
  -> local connector
  -> existing Hermes gateway
  -> existing tools, files, memory, and credentials
```

The optional standard Echo topology is:

```text
Alexa custom skill
  -> authenticated AWS skill handler
  -> Ambient bridge
  -> authenticated connection initiated by the owner's machine
  -> local connector
  -> existing Hermes gateway
```

The optional cloud runtime keeps the same host split:

```text
Alexa+ MCP add-on or Alexa custom skill
  -> the same AWS MCP endpoint and Ambient controls
  -> explicitly selected cloud Hermes runtime
  -> its own persistent files, memory, tools, and credentials
```

These are two supported placements of Hermes, not two agents collaborating on every request. One request belongs to one runtime. The local connector is transport only; it does not reason, summarize, schedule tasks, or maintain a second conversation database.

Use one small, long-lived AWS bridge process first. A single EC2 instance with persistent EBS storage is the baseline deployment because it can host the HTTP endpoint and a persistent connector connection without introducing a separate relay service. Terminate HTTPS with an established reverse proxy. Use an instance role for AWS access and Secrets Manager for service secrets. Add log shipping only when the deployed process and retention policy are defined. Keep the Hermes port private. Provision the final topology with one CDK stack after the connection proof works.

This is a single-owner deployment, not a multi-tenant service. One configured owner maps to approved runtime identities. Reject other principals. A public product would require a separate identity, isolation, quota, and provisioning design.

### Why this shape

Two candidates were considered:

| Candidate | Benefit | Cost | Decision |
| --- | --- | --- | --- |
| Existing Hermes behind an AWS bridge | Preserves the owner's environment and supports the requested daily use. | Needs an outbound connector; the existing host must be awake. | Default. |
| Fresh Hermes hosted entirely on AWS | Can stay available independently of the owner's computer. | Requires separate tools, credentials, files, and session setup. | Optional deployment using the same control contract. |

A cloud runtime is not an automatic substitute for a sleeping local machine. Automatically replaying a local instruction in another environment could act with different context or repeat work. When local Hermes is unavailable, report that state. Offer cloud execution only for a new, explicitly directed request to an already configured cloud runtime.

“Automatic” in the cloud path means reproducible provisioning, startup after reboot, and connection recovery. It does not mean copying private local state, switching task ownership, replaying uncertain commands, or transferring in-flight approvals.

### Connection boundary

First verify whether a maintained transport already available in the owner's environment meets the required outbound-only connectivity. Reuse it if it does. Otherwise implement one authenticated outbound WSS connector to the AWS bridge, forwarding the pinned Hermes JSON-RPC frames over one local Hermes connection.

The connection must bind to a configured runtime identity and a current connection generation. Only that owner's bridge may issue commands. Authenticate the connector separately from Alexa account linking; keep bridge tokens out of URLs and logs. The installed Hermes v0.21.0 loopback gateway currently exposes only its legacy `?token=` WebSocket credential, so keep that hop private to the Hermes host and do not enable a public or cloud endpoint until it supports a header or short-lived ticket. Reject an unexpected second connection for the same runtime rather than silently replacing its ownership.

On disconnect, mark live observation unavailable, fail or classify pending RPCs, and reconnect with bounded backoff. Do not replay mutations. When the installed Hermes contract advertises session event sequence replay, replay observed events after reconnect with sequence and epoch guards. On reconnect, establish runtime liveness and event attachment using the actual Hermes contract before enabling controls. An open socket alone does not establish recovered observation.

The local connector should start through the host's existing service manager after the manual proof works. On macOS, use launchd. Do not alter sleep settings or install system services during the initial contract investigation.

## State and ownership

Hermes owns conversation history, tool execution, agent memory, live workers, and pending approvals. Ambient owns Alexa-facing references, command receipts, runtime connectivity, and a small projection of observed state.

Keep these identities distinct:

| Identity | Meaning |
| --- | --- |
| Runtime identity | The configured Hermes installation, such as the owner's machine or cloud instance. |
| Durable session identity | A Hermes conversation that can be reopened; use the pinned version's actual identity lifecycle. |
| Live session handle | A current worker/session in a particular Hermes gateway process. |
| Run identity | One submitted instruction and its subsequent activity within a conversation. |
| Approval identity | The actual pending Hermes request, scoped to its owning runtime and session. |

Do not route run events using only a durable conversation ID. Multiple instructions can occur in one conversation. If Hermes does not provide a run identifier, permit one active submitted run per conversation and bind events to that run until the verified completion boundary. Reconstructing historical runs is not required for the first version.

Use a single SQLite database on the bridge's persistent volume for the small amount of Ambient-owned durable state. Reuse an installed SQLite facility or a maintained driver verified against the chosen Node runtime. Do not create an in-memory repository and DynamoDB repository in parallel merely to make them interchangeable.

Store only the minimal projection and delivery state needed for operation; leave full transcripts and tool output in Hermes unless a result must temporarily survive delivery to Alexa. Record the source runtime and observation time. Define configurable retention for temporary results, and document deletion behavior before daily use.

One module owns state transitions. Update related fields atomically. Prevent an older observation or a late command acknowledgement from changing completed work back to running. Do not expose arbitrary whole-record patches to every component.

If runtime state cannot be re-established after a restart, report unknown or unavailable. Do not infer that a task failed, completed, or can be resumed merely because its old handle exists in storage.

## Alexa conversation and response delivery

Use one selected Hermes conversation for follow-ups, scoped to the authenticated owner and runtime. Allow explicit new-conversation and conversation-selection actions. Do not rely on an undocumented Alexa conversation identifier or browser storage. Ambiguous references should trigger an Alexa clarification before mutation.

Start with these semantic MCP operations, adjusting names only if real Alexa evaluation shows a problem:

| Operation | Purpose |
| --- | --- |
| `ask_hermes` | Submit a question or instruction in the selected or specified conversation. |
| `get_work` | Read a run's current status, result, or pending input. |
| `list_conversations` | Find conversations, recent work, and pending approvals for the selected runtime. |
| `select_conversation` | Select an existing conversation or explicitly request a new one. |
| `steer_work` | Add an instruction to a confirmed running task. |
| `cancel_work` | Request interruption of the identified live task. |
| `respond_to_approval` | Resolve a specific pending request through Hermes. |

Add runtime selection only when the cloud path is implemented. Add `show_dashboard` only when the voice flow works. Keep one implementation of each control operation for voice and display; use MCP Apps visibility metadata where supported instead of cloning approve, deny, and cancel into another control layer.

### Fast acknowledgement is not a fast answer

Amazon currently documents a round-trip query budget below 500 ms. Do not wait for arbitrary model work inside an MCP request, and do not report successful acknowledgement as successful answer delivery.

The first Alexa proof must determine how a question that takes longer than this budget yields its answer. Test supported continuation or subsequent tool retrieval in the real host. Do not assume background polling, unsolicited speech, server notifications, or an Echo Show dashboard can keep a voice turn alive.

If Alexa can retrieve the completed result within a supported interaction, use that behavior. If it cannot, expose honest asynchronous work and a subsequent status question. Record this as a limitation of the quick-question experience; do not mark a question complete merely because Alexa says it has started checking.

For command acceptance, first measure actual Hermes acknowledgement latency. If it meets the response budget with margin, return after acknowledgement. If it does not, add a small durable command receipt in the existing SQLite store and dispatch it from the same bridge process. This is an evidence-triggered addition, not a separate queue service.

If receipts are needed, return queued only after the receipt is committed. Distinguish queued, dispatched, accepted, and outcome-unknown. After a crash during dispatch, do not automatically retry a consequential command unless Hermes supplies a verified idempotency mechanism. Deduplicate known delivery retries using a stable identity the actual host supplies; do not assume an MCP JSON-RPC request number is a global idempotency key or deduplicate by instruction text.

Prefer Hermes's current answer and Alexa's normal spoken rendering. Do not create a second model pipeline to paraphrase every result. Preserve dates, times, time zones, and uncertainty in personal answers.

## Authentication and approvals

Validate Alexa account linking before building the full application. Amazon documents separate service discovery and user authorization flows. Use an existing standards-based OAuth implementation or provider if it satisfies the observed client contract. Do not assume that advertising OAuth support makes an arbitrary provider compatible with Alexa's resource and scope behavior.

The compatibility check covers service discovery, authorization code with PKCE S256, resource binding, refresh, revocation, and the separation between service and user operations. Prefer provider-owned authorization state. Do not write a bespoke token issuer and refresh store as the default implementation.

Personal results and control operations require the configured owner's user authorization. Service credentials may expose capability metadata and static UI resources only. Do not expose personal state through a resource readable with service credentials. Enforce ownership at both the MCP operation and connector boundaries.

Preserve the exact approval request identity and authoritative action details. Reject missing, expired, already answered, or no-longer-owned approvals. Never resume a conversation merely to answer an old approval. Confirm Hermes accepted the decision before clearing it; if delivery is uncertain, reconcile instead of replaying it.

Offer approve-once and deny in the first version. Defer persistent allow-always grants. Account linking authorizes an account; it does not prove who is speaking near a shared device. Preserve any stronger confirmation required by Hermes. When the actual platform cannot provide the required confirmation, continue the same session on a suitable surface and state that limitation.

## Scope cuts

Remove the following from the original mandatory path:

- EventBridge, the voice-summary Lambda, Bedrock paraphrasing, and their extra database writer.
- ECS Fargate, EFS, DynamoDB task projections, and custom OAuth persistence as baseline requirements.
- The keyword-overlap resolver, identity helpers such as `choosePersistence`, duplicate dashboard controls, and per-layer workspace packages.
- An upstream Hermes contribution, extra Amazon device tracks, and infrastructure added only to increase service count.
- Prescribed replacement code, fictional protocol fixtures, predetermined passing test counts, and friction entries written before a failure occurs.

Keep real protocol tests, authentication, approval identity, honest failure states, an AWS deployment, and the requested Hermes controls. Optional cloud hosting remains in scope after the local path works. An Echo Show view is useful but follows the voice experience.

## Proposed repository shape

Use a single Node/TypeScript package for the bridge and connector. Add the display build only when needed. Use pnpm, the official MCP SDK, schema validation at external boundaries, a maintained WebSocket implementation, and one focused test runner. Resolve and pin compatible versions during bootstrap; use the runtime required by the installed Alexa tooling rather than copying stale version numbers.

```text
hermesambient/
  package.json
  src/
    server.ts
    mcp.ts
    hermes.ts
    conversations.ts
    store.ts
    auth.ts
    connector.ts
  test/
    fixtures/hermes/
    hermes-contract.test.ts
    conversations.test.ts
    auth.test.ts
    connector.test.ts
    mcp.test.ts
  scripts/
    check-hermes.ts
    check-hermes-contract.ts
    smoke-mcp.ts
    latency.ts
  infra/
    app.ts
    stack.ts
  docs/
    plans/2026-09-06-hermes-ambient.md
    compatibility.md
    acceptance.md
    deployment.md
    friction-log.md
    demo-runbook.md
    submission.md
```

These are planned paths, not instructions to create empty files. `hermes.ts` owns wire-protocol adaptation; `conversations.ts` owns selection and run/approval transitions; `store.ts` owns storage details. The connector owns transport lifecycle. Keep these boundaries cohesive without adding controller/service/repository chains. No implementation comments; use clear names and structure.

## Implementation sequence

The implementation follows these gates. The steps below specify behavior and evidence rather than supplying unverified replacement code.

### 1. Establish the installed Hermes and Alexa contracts

Planned files: `docs/compatibility.md`, `scripts/check-hermes.ts`, `test/fixtures/hermes/`, `test/hermes-contract.test.ts`.

1. Resolve the actual `hermes` executable and its repository revision. There are multiple local checkouts; do not assume the checkout under `honey` is the executable's source. Record relevant local modifications without changing them.
2. Inspect the running-client topology and determine whether the desired native client and connector can attach to the same gateway. Starting a new gateway must not be presented as discovery of an existing independent worker.
3. Capture sanitized real request/response and event fixtures for creation, question submission, completion, session listing, live attachment, steering, interruption, and approval resolution. Include `method: event`, payload wrapping, list wrapping, active-session fields, and durable identity changes present in that revision.
4. Verify Alexa+ preview access or the permitted simulated Alexa+ route, the required runtime, developer-stage testing, and the available locale. Record the standard Alexa Skills Kit route separately if the Echo daily-use path is also built.
5. Choose a representative personal question for the demo after inspecting the owner's existing Hermes capabilities. Do not add a question-specific integration.

Gate: a supported shared-backend route and a viable Alexa development route are recorded. Every unverified capability is labeled. Fixtures contain no credentials or personal transcripts. No claim of live continuity rests solely on a mock.

### 2. Prove a complete spoken question and follow-up

Planned files: `src/server.ts`, `src/mcp.ts`, `src/hermes.ts`, `src/auth.ts`, `test/mcp.test.ts`, `test/auth.test.ts`, `docs/acceptance.md`.

1. Bootstrap only the package and files needed for this proof. Set up build, typecheck, lint, and focused test commands with distinct meanings.
2. Establish the smallest authenticated Alexa+ MCP route using a development tunnel or AWS proof deployment. The endpoint must negotiate MCP spec 2025-11-25 or newer. Expose Ambient, never the raw Hermes gateway. A standard Alexa skill handler can call the same bridge as an optional secondary route.
3. Submit one personal question to real Hermes and get its actual answer spoken by Alexa. Include the user's local date/time context without inventing information.
4. Ask a follow-up and prove it reaches the selected conversation.
5. Measure both tool response latency and utterance-to-spoken-answer latency, including a slow Hermes response.

Gate: the entire answer delivery behavior is observed. Record whether delayed results require a second utterance. A fake server, Inspector screen, or “started checking” response does not satisfy the spoken-answer gate.

### 3. Add the requested work controls

Planned files: `src/conversations.ts`, `src/store.ts`, `test/conversations.test.ts`, extensions to `src/mcp.ts` and `test/mcp.test.ts`.

1. Add explicit new/select conversation behavior and one active run per conversation unless the pinned Hermes contract supports a stronger model.
2. Add start, inspect, steer, cancel, resume, and approval response operations through the real adapter.
3. Retain actual approval identities and preserve uncertainty on interrupted delivery.
4. Prove supported native-client attachment to the same backend. Separately prove reopening durable history after completion.
5. Persist only Ambient-owned state required for restarts and result delivery.

Gate: controls affect the intended run and pending request. Cover a completion arriving before submission acknowledgement, a duplicate approval response, an unavailable runtime, and a stale live handle. Do not add generic resilience machinery beyond these demonstrated boundaries.

### 4. Put the bridge on AWS and connect the existing host

Planned files: `src/connector.ts`, `test/connector.test.ts`, `infra/app.ts`, `infra/stack.ts`, `docs/deployment.md`.

1. Prove the outbound connection manually, reusing a suitable installed transport if available; otherwise implement the narrow connector described above.
2. Provision the single bridge host, persistent volume, HTTPS, instance permissions, service secrets, and operational logging with one stack. Select region and instance size from account access, measured latency, and cost; document an estimate before deployment.
3. Verify authenticated Alexa calls traverse AWS to the existing Hermes installation and use its existing capabilities.
4. Disconnect the local machine, reconnect it, and restart the bridge. Confirm honest offline/unknown states and no replay of uncertain mutations.
5. Add host service startup after the manual path passes. Document teardown, retained storage, secret rotation, and the daily-use availability ceiling: local Hermes is unavailable while its host sleeps.

Gate: the AWS bridge is necessary to the demonstrated path, Hermes is not publicly exposed, runtime identity survives reconnect correctly, and a bridge restart does not silently repeat work.

### 5. Add cloud Hermes as an optional deployment

Planned files: additions to `infra/stack.ts`, `docs/deployment.md`, `docs/acceptance.md`, and runtime-selection behavior/tests in the existing modules.

1. Provision a pinned Hermes runtime with separate persistent storage and explicitly configured tool access. It may share the single-owner host initially if resource measurements permit, but keep its process, secrets, and data boundary explicit.
2. Reuse the same Ambient controls and adapter. Keep the cloud Hermes socket on loopback or a private network.
3. Add explicit runtime selection; display and speak the runtime when a switch affects context. Conversation and approval references must include their source runtime.
4. Prove cloud work continues while the local host is offline, using a task the cloud runtime is configured to perform.
5. Automate provisioning and startup. Do not automatically copy the local home directory, credentials, or session database.

Gate: cloud is a usable alternative deployment, not an implicit failover claim. Demonstrate that a local conversation cannot be mistaken for a cloud conversation with a similar title. Failure to configure a required cloud tool produces an honest limitation.

### 6. Add the display surface where it helps

Planned files: `dashboard/index.html`, `dashboard/src/App.tsx`, `dashboard/src/app.css`, dashboard build configuration, and MCP resource registration in `src/mcp.ts`.

1. Add a compact MCP App showing selected runtime, recent work, results, and pending approvals.
2. Reuse the same control operations; do not create independent approval state or a second set of handlers.
3. Use the host bridge for interaction and server-owned state. Verify actual iframe capabilities and lifecycle; do not rely on local storage or direct network access.
4. Support light and dark modes, keyboard operation, readable controls, and honest disconnected states. Load the applicable design skills when implementing the UI.

Gate: the actual Alexa host renders the app and its controls affect the same Hermes state. Voice-only use remains functional.

### 7. Validate the daily-use behavior and submission

Planned files: `scripts/smoke-mcp.ts`, `scripts/latency.ts`, `docs/acceptance.md`, `docs/demo-runbook.md`, `docs/submission.md`, `docs/friction-log.md`, `README.md`, `LICENSE`.

1. Run a clean-install build and focused boundary tests, then the real end-to-end acceptance cases below.
2. Measure authenticated user operations as well as discovery. Include actual Hermes acceptance, storage, AWS routing, and the selected host. Report sample count, p50, p95, maximum, errors, and overruns. Amazon's stated budget is not a p95 exemption.
3. Record evidence for the exact hardware/simulator, account locale, software revisions, and deployment used. Keep credentials and private content out of the public evidence.
4. Write setup instructions, the actual retention/deletion behavior, and the known limitations. Write friction entries only from observed failures.
5. Record a short demo: personal question and follow-up; real work plus steer/approval; same-backend continuity; optional cloud availability if complete. Show the AWS path and explain what it does.
6. Re-check current hackathon eligibility, deadline, and deliverables. Prepare the public repository and submission materials. Publishing and submitting require the user's authorization at that time.

Gate: submission claims match recorded behavior. Do not claim hardware success from Inspector-only evidence or claim personal-data access from seeded fictional data.

## Acceptance cases

| Case | Evidence required |
| --- | --- |
| Personal question | Alexa speaks a useful answer from the selected Hermes conversation. |
| Follow-up | Context is retained in the selected Hermes conversation. |
| Slow answer | Actual delayed-delivery behavior is demonstrated and documented. |
| Start and steer | A real running task receives the new instruction without opening a second worker by accident. |
| Approval | The exact pending action is shown or spoken, answered once, and confirmed by Hermes. |
| Cancel | Interruption reaches the owning runtime; no invented guarantee that already completed effects were undone. |
| Native continuity | A supported native client observes the same backend conversation; saved-history resume is tested separately. |
| Local offline | Alexa reports unavailability without redirecting or replaying work in cloud. |
| Cloud option | An explicitly selected configured cloud runtime works while the local machine is offline. |
| Restart during control | The bridge reports an uncertain outcome or reconciles it; it does not blindly resubmit. |
| Authorization | Unauthenticated callers and service-only tokens cannot obtain personal results or issue controls. |
| Latency | Actual user-tool calls meet the observed host contract; spoken-answer latency is measured separately. |

## Schedule and cut order

Use evidence gates rather than the original calendar that delayed real continuity until October. Complete Alexa+ host access or the permitted simulation, exact MCP protocol verification, and the spoken-answer proof first. Then implement work controls and the AWS bridge. Cloud hosting follows the working default path; display polish follows both.

Under time pressure, cut upstream contributions, extra device tracks, visual polish, and optional cloud deployment before compromising the existing-Hermes experience. If cloud deployment is cut, retain the useful AWS bridge and describe the limitation honestly. Do not cut account linking, real answer delivery, approval correctness, or the real-Hermes acceptance evidence to preserve a larger infrastructure diagram.

## Sources and evidence boundaries

Review date: September 6, 2026. Re-check external requirements when execution starts and before submission. This plan records design choices; it does not claim that any integration or acceptance case has passed.

- [Alexa+ QuickStart](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html): remote Streamable HTTP, MCP Apps for visuals, and the stated response budget.
- [Alexa+ authentication](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-authentication.html) and [account linking](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-account-linking.html): client authentication and user authorization contracts.
- [Alexa+ development setup](https://developer.amazon.com/docs/alexaplus/add-ons/set-up-your-development-environment.html): access and tooling prerequisites.
- [Alexa+ client lifecycle](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-client-lifecycle.html): verify supported answer delivery and host lifecycle behavior against the actual client.
- [Alexa custom skills](https://developer.amazon.com/en-US/docs/alexa/custom-skills/steps-to-build-a-custom-skill.html): the optional standard Echo-compatible voice route and AWS hosting choices.
- [Alexa+ device compatibility](https://digprjsurvey.amazon.co.uk/csad/help/node/TNchvgYCsQJ0gP4M): optional Alexa+ device and account availability.
- [Hermes integration documentation](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration): session control and gateway scope. Pin and inspect the installed implementation before relying on examples.
- [Amazon hackathon](https://amazonappdev2026.devpost.com/): submission requirements. AWS service selection in this plan is an engineering choice, not a claim that the competition requires this topology.

## Revision summary

Retained full Hermes interaction as the goal. Made Alexa+ MCP the primary hackathon route, kept a standard Alexa skill as an optional Echo daily-use layer, and made cloud Hermes an explicit alternative. Assigned AWS the public bridge role. Replaced speculative code with contract-first execution gates. Removed the summary pipeline and unnecessary persistence/workspace layers. Moved real Alexa answer delivery, live ownership, and authentication ahead of infrastructure expansion.
