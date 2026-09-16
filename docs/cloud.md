# Optional cloud Hermes

Set `HERMES_RUNTIME_KIND=cloud` and point `HERMES_WS_URL` at the separately provisioned cloud Hermes gateway when the cloud deployment is ready. Give it its own data directory, tool configuration, credentials, and session store. The bridge then exposes that runtime through the same control contract.

The cloud mode is an explicit deployment choice. It does not copy the local home directory, transfer an in-flight approval, or replay a request after the local host disconnects. If both runtimes are needed at once, add a runtime registry and selection operation only after the local path has evidence; the current bridge deliberately keeps one owner and one configured runtime per process.

Prove cloud work with a capability that is configured in the cloud environment and identify the owning runtime in the spoken and displayed result. If a cloud-only tool is missing, report that limitation instead of routing the request to local Hermes.
