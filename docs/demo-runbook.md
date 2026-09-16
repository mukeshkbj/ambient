# Demo runbook

1. Start the installed Hermes gateway and the local connector.
2. Open the bridge health endpoint and show the runtime as online.
3. Invoke the `hermes` custom skill on the Echo and ask a representative personal question, then ask one follow-up in the same conversation.
4. Ask Alexa to start a benign reversible Hermes task. Read the returned work reference and retrieve it with `get_work`.
5. Steer the live work. If Hermes asks for approval, speak the exact action and use approve once or deny; show that the approval clears only after Hermes confirms it.
6. Cancel a separate reversible task and show the confirmed or uncertain outcome.
7. Disconnect the local host and ask Alexa for status. Show an honest offline response without cloud replay.
8. If the cloud runtime is configured, explicitly select it and run a task that uses a cloud-only capability. Say which runtime owns the result.

Keep a terminal with `pnpm latency` available for transport measurements. Do not include private transcripts, gateway tokens, or unredacted account details in the recording.
