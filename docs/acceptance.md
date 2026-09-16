# Acceptance record

This record separates observed behavior from gates that require an Alexa account, an AWS account, or a real deployment. Update it with dated evidence and keep credentials and private transcripts out of the repository.

## Observed locally

- The installed Hermes gateway accepts the pinned WebSocket connection and emits `gateway.ready` as an event frame.
- Saved and active session discovery works through the adapter.
- The local connector authenticates to the bridge and forwards Hermes frames in both directions.
- Streamable HTTP exposes the eight semantic MCP tools through one stateful session.
- SQLite keeps one selected conversation and preserves approval request identity.
- The bridge reports an offline runtime when the connector is absent.
- A reconnect replays observed Hermes events by sequence when the gateway advertises that contract; command mutations are never replayed.
- A replay gap is surfaced as unknown work instead of being presented as a complete answer; the runtime stays unknown until active-session discovery re-reads pending approvals, clears requests absent from Hermes, and keeps their run unknown.
- Type checking, build, contract tests, connector tests, state-transition tests, auth tests, and HTTP tests pass.
- On 2026-09-06, the installed gateway contract checks connected successfully; the authenticated reverse-connector smoke path reported the runtime online, exposed all eight tools, and completed three `list_conversations` calls with zero failures (p50 1.74 ms, p95 3.18 ms, maximum 3.18 ms on loopback).

## Still required for the hackathon submission

- For the Alexa+ primary track, connect the real Alexa+ MCP client and record the accepted MCP protocol and account stage, or use the simulated Alexa+ experience permitted by the rules if preview access is unavailable.
- Link the standard Echo daily-use custom skill separately and record the Echo model and skill stage.
- Before exposing the standard skill publicly, verify Amazon's request signature and certificate headers at the HTTP boundary.
- Speak a representative personal question and a follow-up through Alexa.
- Measure a slow Hermes answer and record whether Alexa speaks it in the same turn or needs a later retrieval.
- Run a benign real task through start, inspect, steer, approval, and cancellation controls.
- Deploy the bridge with HTTPS on AWS and capture the authenticated path from Alexa to the local connector.
- Test connector loss and bridge restart without replaying an uncertain mutation, including a real replay-ring gap and a pending approval that survives reconnect.
- If cloud Hermes is enabled, select it explicitly and prove that its sessions and credentials remain separate from local Hermes.
