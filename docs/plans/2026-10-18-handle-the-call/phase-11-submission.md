# Phase 11: Submission

[Back to overview](overview.md)

## Goal

Every judging criterion has visible evidence, the repo reads true to an automated reviewer, and the Devpost entry is submitted by Thu 2026-10-22. Load `technical-writing` and `prose` for every prose file.

## Changes

1. **Video** (under 3 minutes, English, public YouTube, no third-party music or trademarks). Plan it in `docs/video-script.md` before recording. Required beats, in order:
   1. The pain in one line: nobody wants to call the plumber.
   2. "Alexa, tell Ambient to find a plumber for tomorrow under one fifty." Real Echo Dot.
   3. A real phone rings (a family member plays the business). The disclosure is audible.
   4. The quote comes in over the limit. The Echo Dot speaks the question.
   5. "Alexa, tell Ambient offer one sixty." The agent says it on the call.
   6. Confirmation, then Alexa reports only what was confirmed.
   7. The honest failure: a call where the business hangs up; Alexa says she won't assume it's booked.
   8. Memory: "You used Joe's Plumbing last time for one forty. Call them again?"
   9. Architecture in 15 seconds: Alexa skill, MCP server, caller runtime, Twilio, Claude on Bedrock, AWS.
   Use `earshot` to check the audio mix before upload.
2. **Friction log** (`docs/friction-log.md`): real entries only, dated the day they happened, from `progress.md`. Candidates: ConversationRelay blocked on trial; the AI addendum error 64110; Proactive Events speaking only a fixed template; the `events.endpoint` Lambda-only question; SearchQuery slot rules breaking the v1 model; no first-party way to speak unprompted; Alexa+ custom skill invocation.
3. **Product feedback** (`docs/product-feedback.md`): one section per tool used (ASK, Proactive Events, Alexa+ MCP docs, Bedrock, CDK). Each: what we used it for, what worked, what needs work, onboarding, would we build with it again.
4. **README**: the one-line pitch, a 20-second GIF of the needs-you moment, "run it in one minute" (`pnpm i && pnpm demo`), architecture diagram, the honesty rules, measured latency, and a table of what is real versus simulated.
5. **Devpost text** (`docs/submission.md`): rewrite for the new product. Track: Alexa+. Mini challenges: AWS Builder (Bedrock, EC2, Secrets Manager, CDK, Polly via ConversationRelay). Explain that the repo started 2026-09-16, inside the window.
6. **Blind judge re-run.** Three judge-persona subagents (Devices VP, Alexa evangelist, Solutions Architect) score the repo and video against KiroWhisper and Spoken.ai pages without knowing which is ours. Fix the top weakness each names if it takes under two hours.
7. **Public repo.** After user approval, create `ambient` on GitHub with an MIT license in the About section and push `main`.

## Verification

- Static: `pnpm scan`, `pnpm build` green in a fresh clone (`git clone` to `/tmp`, `pnpm i`, `pnpm demo` reaches a confirmed simulated call).
- Runtime: watch the uploaded video end to end once. Check every README claim against `progress.md` evidence.

## Done when

The Devpost entry is submitted and its URL is in `progress.md`.
