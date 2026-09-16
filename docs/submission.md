# Submission notes

Hermes Ambient is an Alexa+ primary-track submission: it gives the Alexa+ MCP client a voice path to the owner's existing Hermes agent through a self-hosted Streamable HTTP MCP server. A standard Alexa custom skill on the owner's Echo is an optional daily-use route. Alexa reaches the authenticated AWS bridge, which keeps the Hermes gateway private and receives an outbound connector from the owner's computer. Hermes continues to own tools, memory, conversation history, and approvals.

The final submission should claim only the acceptance cases recorded in [docs/acceptance.md](acceptance.md). Include the deployed AWS region, bridge instance size, connector and Hermes revisions, Alexa account stage and locale, hardware or simulator, measured tool and spoken-answer latency, and the known limitation that local Hermes is unavailable while its host sleeps.

Do not describe the cloud mode as failover. If it is demonstrated, describe it as a separately selected Hermes runtime with independent storage and credentials. If it is not demonstrated, submit the local path and AWS bridge only.
