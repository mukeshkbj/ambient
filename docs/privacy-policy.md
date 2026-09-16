# Hermes Ambient privacy policy

Hermes Ambient is a single-owner bridge. It receives Alexa requests, forwards approved instructions to the owner's configured Hermes runtime, and stores only conversation references, work status, short-lived results, and pending approval metadata needed to deliver those requests.

Hermes remains the source of conversation history, files, tools, credentials, and memory. Ambient does not copy the Hermes home directory or send gateway credentials to Alexa. The bridge stores terminal work and resolved approval projections for the configured `AMBIENT_RETENTION_DAYS`; pending work and unresolved approvals remain until they finish or are cleared through the owning runtime.

The owner can stop the bridge, remove its SQLite data directory, rotate connector and OAuth secrets, or request deletion of stored Ambient projections. Requests are not sold or shared with unrelated parties. A local Hermes runtime is unavailable while its host is asleep or disconnected.

This policy is a hackathon single-owner notice. Replace it with the final publicly hosted policy and contact details before publishing an Alexa integration.
