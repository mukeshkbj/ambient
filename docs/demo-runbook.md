# Demo runbook

1. Start Ambient with the demo config — `pnpm demo` — no credentials needed.
2. Open `/healthz` — show every configured runtime, its state, and its
   capability set. Run `pnpm check:runtime <id>` live for at least one runtime.
3. `agents` in the MCP client (or "what agents do I have" on Alexa), then
   `agents` with `use` — show the sticky default change.
4. `delegate` a Saturday dinner booking to the planner agent — watch progress
   steps, then the approval request for the deposit. Answer through the MCP
   elicitation prompt or by voice (`approve` with decision `deny`); show it
   clears only on agent confirmation.
5. `stop` a separate reversible task; show the confirmed or uncertain outcome.
6. Disconnect a local host and ask for status — honest `offline`, no replay.

Keep `pnpm latency` handy for transport numbers. No private transcripts, tokens,
or unredacted account details in the recording.
