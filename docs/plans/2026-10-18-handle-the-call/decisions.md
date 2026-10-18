# Decisions

[Back to overview](overview.md)

Decided with the user on 2026-10-18. This record replaces `../2026-10-18-household-consent-design.md`.

## The product

Alexa+ can book anything with an API. Ambient calls everything that doesn't. The phone is the one API every business already has.

## Why this direction

- Three judge-persona reviews scored v1 ("Alexa supervises your agents") 10.5, 12, and 13 of 20. Every judge flagged a developer audience.
- KiroWhisper ships the v1 pitch on a real Echo. About a dozen other entries gate agent actions behind voice approval.
- The consent-layer redesign had no demo moment: an interruption that does not happen does not film.
- A personal-agent-through-Alexa pitch matches the organizers' "obvious" list ("basic MCP wrapper around an existing API") and invites "why not Alexa+?".
- Spoken.ai (another hackathon) calls providers from a mobile app with text results. The new part here is the live, in-room step-in from Alexa during the call.

## Decision table

| Topic | Decision | Reason |
|---|---|---|
| Brain | Anthropic API in the demo; the same code on Claude through Bedrock | User choice; Bedrock keeps the AWS Builder mini challenge |
| Phone | Twilio ConversationRelay | Twilio handles speech; the engine already speaks text turns |
| Speech provider | Amazon Polly voice through ConversationRelay | One attribute; adds visible AWS |
| AssemblyAI | Rejected | ConversationRelay transcribes only with Google or Deepgram; using AssemblyAI means building the audio pipeline |
| Nova 2 Sonic | Rejected | User choice |
| Device | User's Echo Dot through the custom skill | Real hardware; KiroWhisper's advantage |
| Cue | Voice Monkey spoken cue and Proactive Events chime | No first-party way to speak unprompted |
| Judge path | `pnpm demo` with zero keys | Rules let judges build and test |
| Businesses | Real businesses allowed; the hero call goes to a family member | User choice |
| Disclosure | First sentence on every call | Legal and judge perception; non-negotiable |
| Memory | SQLite | Supermemory adds a key with no judge value |
| Codebase | Keep and subtract | Repo started 2026-09-16, inside the window; rebuilding costs 1.5 days |
| Hermes, OpenClaw, Bedrock Nova adapter | Deleted | Unused by the product; unverifiable by judges |
| Go/no-go gate | None | User choice: commit fully |
| Stretch | Three parallel calls, decided day 3 | User approved |
| Video | Planned after implementation | User choice |

## Open question for the user

If `pnpm brain:latency` shows p95 time to first token above 1.5 s on `claude-opus-5-5` at low effort, may in-call turns use `claude-haiku-5-5`?
