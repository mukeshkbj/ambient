# Demo runbook

1. Start the installed Hermes gateway and the local connector; start Ambient
   with the full `runtimes.json`.
2. Open `/healthz` — show every configured runtime, its state, and its
   capability set. Run `pnpm check:runtime <id>` live for at least one cloud
   runtime.
3. `list_assistants` in the MCP client (or "list my assistants" on Alexa), then
   `select_assistant` — show the sticky default change.
4. Ask Hermes a representative question, then a follow-up in the same
   conversation. Then `ask` Grok Bot and Muse Spark in turn — same surface,
   different assistants.
5. Open the `dashboard` tool — switch assistants, watch the live work feed
   update across runtimes.
6. Run a benign reversible task that triggers an approval; answer it by voice
   with the exact action (approve once / deny) or the dashboard buttons. Show it
   clears only on assistant confirmation.
7. Cancel a separate reversible task; show the confirmed or uncertain outcome.
8. Ask Instinct something long-horizon; show the run stay `accepted`, then the
   email reply land in the feed as `completed` minutes later.
9. Disconnect the local host and ask for status — honest `offline`, no replay.

Keep `pnpm latency` handy for transport numbers. No private transcripts, tokens,
or unredacted account details in the recording.
