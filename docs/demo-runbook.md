# Demo runbook

1. Start Ambient with the demo config — `pnpm demo` — no credentials needed.
   (For a real agent, start the Hermes gateway or export AWS credentials and
   use `pnpm dev` / `pnpm dev:bedrock` with `runtimes.json`.)
2. Open `/healthz` — show every configured runtime, its state, and its
   capability set. Run `pnpm check:runtime <id>` live for at least one runtime.
3. `list_assistants` in the MCP client (or "list my assistants" on Alexa), then
   `select_assistant` — show the sticky default change.
4. Ask the planner agent to book Saturday dinner — watch progress events, then
   the approval request for the deposit. Answer it by voice (approve once /
   deny) or the dashboard buttons; show it clears only on agent confirmation.
5. Ask a research question; watch the run complete with a summary.
6. Ask the coding agent to deploy — it disconnects mid-run; show the run go
   `unknown` and Alexa say it won't guess.
7. Open the `dashboard` tool — switch assistants, watch the live work feed
   update across runtimes.
8. Cancel a separate reversible task; show the confirmed or uncertain outcome.
9. Disconnect a local host and ask for status — honest `offline`, no replay.

Keep `pnpm latency` handy for transport numbers. No private transcripts, tokens,
or unredacted account details in the recording.
