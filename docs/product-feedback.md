# Product feedback

One section per tool, from building Ambient against them. Honest scope notes
are included where we could not reach a live environment from this machine.

## Alexa+ developer documentation and design guide

- **Used for:** the voice-first tool surface (`delegate`, `status`, `approve`,
  `stop`, `agents`, `briefing`) — descriptions written in the guide's
  "when + what" style; device-class adaptation (`deviceClass` voice-only /
  mobile / display / TV) in the bundled simulator.
- **Worked:** the voice guidance translated directly into testable rules —
  two sentences, outcome first, never an internal id — and our golden speech
  corpus (`test/voice.test.ts`) enforces it mechanically.
- **Needs work:** the Alexa+ MCP toolkit, CLI, and web simulator were gated
  for hackathon entrants during the build, and some setup pages lacked the
  preview banner the FAQ describes; we built `/sim` — a real MCP client host
  — as the verifiable stand-in. The protocol-version and `WWW-Authenticate`
  ambiguities are in `docs/friction-log.md`.
- **Time to hello world:** unmeasurable — gated. For the public docs alone,
  roughly an afternoon to internalize the lifecycle + tools guidance.
- **Build again?** Yes — the approval/elicitation model is the right shape
  for ambient agents; we'd want the toolkit available for the end-to-end
  check.

## ASK custom skills and account linking

- **Used for:** the `/alexa` endpoint (`src/alexa.ts`), the en-US/en-GB
  interaction models (`alexa/interaction-model.*.json`), and request
  verification (`src/alexa-verify.ts` — SignatureCertChainUrl pinning, SAN
  `echo-api.amazon.com`, chain + signature checks over the raw body, ±150 s
  timestamps).
- **Worked:** the interaction model JSON format is clean; carrier-phrase +
  `SearchQuery` slots covered every utterance we needed without id-bearing
  slots. The documented signature-verification contract was precise enough
  to implement and test offline with generated cert chains.
- **Needs work:** verification could not be exercised against the live Alexa
  service from this machine (skill registration needs the developer account);
  it is implemented to spec and unit-tested, not live-verified — stated in
  `docs/acceptance.md`.
- **Time to hello world:** ~1 hour to a buildable model + handler; live
  console verification still pending.
- **Build again?** Yes, if the project targets the skill surface; for this
  submission the MCP host path carries more weight.

## MCP TypeScript SDK (`@modelcontextprotocol/sdk` 1.30)

- **Used for:** the entire server — `McpServer`, `registerTool`,
  `registerResource`, `StreamableHTTPServerTransport`, `server.server.elicitInput`,
  client-side `Client` + `StreamableHTTPClientTransport` (the `/sim` host is
  a real client on loopback), `InMemoryTransport` in tests.
- **Worked:** the 2025-11-25 surface is current — elicitation with form-mode
  schemas, capability negotiation, `ui://` resources, sessions with
  `Mcp-Session-Id`. In-memory transports made the elicitation round-trips
  unit-testable (3 tests).
- **Needs work:** `enableJsonResponse: true` silently cannot deliver in-call
  server→client requests — elicitations hang with no diagnostic (friction
  entry). Concurrent in-call elicitations across outstanding requests are
  not multiplexed (friction entry). Transport security options were
  deprecated mid-build with no named successor.
- **Time to hello world:** ~30 minutes to a working server; a day to
  elicitation + sessions + resources done carefully.
- **Build again?** Yes — the only practical path to a standards MCP server
  in TS today, and it tracks the spec closely.

## MCP Apps (tool-result UI resources)

- **Used for:** `ui://ambient/task` — the live task card the sim renders in
  an iframe with the `ui/initialize` handshake and `hostContext.deviceClass`
  re-fit on `host-context-changed`.
- **Worked:** resource-URI indirection keeps tool results small; the
  handshake is one round-trip; device-class adaptation is a clean contract.
- **Needs work:** field placement ambiguity (definition `_meta.ui` vs result
  `_meta.ui.resourceUri` vs deprecated flat `ui/resourceUri`) — which reader
  honors which is undocumented (friction entry).
- **Time to hello world:** ~2 hours including the host side.
- **Build again?** Yes — a task card beside the transcript is exactly what
  ambient supervision needs.

## Amazon Bedrock Converse

- **Used for:** `src/runtimes/bedrock.ts` — a real runtime adapter built on
  the Converse API shape (`modelId`, `messages`, `toolConfig.tools[].toolSpec`,
  `stopReason: "tool_use"` loop) with approval-gated tools, transcript
  persistence, and abort → interrupt.
- **Worked:** the tool-loop shape mapped cleanly onto our event model —
  `toolUse`/`toolResult` blocks become `tool.start`/`tool.complete`,
  `stopReason` becomes `message.complete`.
- **Needs work:** honest note — this machine has no AWS credentials (no CLI,
  `~/.aws`, or env vars), so the adapter is unit-tested against a mocked
  `send` (7 tests covering the tool loop, approval gate, cancel, and
  transcript resume) but not live-verified. Model access/region onboarding
  friction is unmeasured.
- **Time to hello world:** adapter implementation ~4 hours; live onboarding
  unmeasured.
- **Build again?** Yes — Converse's uniform tool interface across models is
  the right abstraction for multi-agent supervision.

## AWS CDK, EC2, Secrets Manager

- **Used for:** deployment preparation — `aws-cdk-lib`/`constructs` are
  devDependencies with `docs/deployment.md` covering the TLS + secrets path.
- **Worked:** moving CDK to devDependencies keeps `pnpm i` light for judges.
- **Needs work:** deployment is pending (requires the account owner's go-ahead
  — it's paid infrastructure); the receipt is blocked in
  `docs/acceptance.md`, not faked.
- **Build again?** Yes for the real deployment; the honest answer is it's
  the one path we haven't exercised end-to-end.
