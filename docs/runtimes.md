# Assistant runtimes

Ambient is a gateway: one authenticated MCP endpoint + Alexa skill in front of
whatever personal assistants you can actually reach. Each runtime is an entry in
`runtimes.json` (`AMBIENT_RUNTIMES_FILE`, default `$AMBIENT_DATA_DIR/runtimes.json`)
naming an **adapter**. Secrets never live in the runtime file — a `tokenEnv`
entry names the environment variable that holds the credential.

```json
{ "id": "planner", "label": "My Agent", "kind": "cloud", "adapter": "demo" }
```

`options` is a string map for per-adapter settings (`speedMs`, …). Verify any
runtime end-to-end with:

```bash
pnpm check:runtime <id-or-name>     # handshake → trivial prompt → verdict JSON
```

## Adapter matrix

| Adapter | Assistant | Transport | Sessions | Steer | Cancel | Approvals | Resume | Class |
|---|---|---|---|---|---|---|---|---|
| `demo` | Scripted agent | none | yes | yes | yes | yes | yes | realtime |

Capabilities are reported per runtime in `agents` and `/healthz`;
unsupported controls fail with a clear error instead of pretending.

## Demo (`demo`)

A scripted, deterministic agent with no network and no credentials — the
zero-setup path for judges, tests, and demos. Every prompt runs the planner
script: it searches restaurants, then pauses for a deposit approval before
booking. Step timing is `options.speedMs` (default 1.2 s; tests use ~1 ms).

## Adding an assistant

Implement `AssistantClient` (`src/runtimes/types.ts`), register a factory in
`ADAPTERS` in `src/runtimes/registry.ts`, and be honest in `capabilities` —
the engine surfaces unsupported controls as clear errors and unreachable hosts
as `offline`/`unknown` automatically.
