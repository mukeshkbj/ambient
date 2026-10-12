# Demo video script — Ambient (target 2:45, hard cap 3:00)

Record against `pnpm demo` (deterministic demo agent — the honesty beats are
scripted in it). If AWS creds are available, do the core-loop shot with a
Bedrock runtime and say "real agent" on camera; otherwise say "scripted demo
agent" — same supervisor, different worker. Say which is which either way.

**Recording prep**
- [ ] `pnpm demo` running; browser at `http://127.0.0.1:3000/sim`, Echo Show 8 class.
- [ ] Full-screen browser; hide bookmarks bar; font-size comfortable on camera.
- [ ] Second terminal tab ready for the deploy-kill shot (or a second sim window).
- [ ] Screen recorder at 1080p; narration dry-run once so beats land under 3:00.
- [ ] No third-party music or trademarks anywhere in frame or audio.

| Time | Shot | Voiceover (say it close to verbatim) |
|---|---|---|
| 0:00–0:10 | Sim, Echo Show 8. Yellow attention ring already up. Press talk: "Alexa, what do my agents need?" Card answers aloud. | *(cold open, no narration — let the product speak)* |
| 0:10–0:22 | Title card: **Ambient** — *Your agents work in the background. Alexa tells you when they need you.* | "Agents run for hours now. They shouldn't have to shout into a chat window to reach you. Alexa already lives in the room — she should be the one supervising them." |
| 0:22–1:05 | "Have my agent book Lupa for Saturday at seven." Task card appears with live steps. Approval card: "Wants to charge a $40 deposit — approve once or deny?" Say "Approve." Card shows agent-confirmed. | "This is the core loop. I delegate, the agent works, and when it wants to spend money, Alexa asks *me* — a real elicitation, not a button the agent could press itself." |
| 1:05–1:25 | Click the device switcher: Echo Show 15 → Mobile → Voice-only. Same task card reflows; voice-only shows transcript. | "Same MCP response, every Alexa form factor. The task card adapts to the device class — voice-only just talks." |
| 1:25–1:45 | Trigger the deploy disconnect (demo agent's deploy script drops mid-run). "Is the deploy done?" → "It disconnected before confirming. I won't retry it." | "Here's the part most demos fake. The agent's host died mid-run — Ambient says *unknown*, not 'failed', not a guess. An honest 'I don't know' is the feature." |
| 1:45–2:05 | "What did my agents get done today?" Briefing speaks the digest across agents. | "One briefing across every agent I supervise — what finished, what needs me, what's still running." |
| 2:05–2:25 | Terminal: MCP Inspector (or the curl transcript) against `/mcp` — initialize `2025-11-25`, tool list, the `ui://ambient/task` resource. | "Underneath it's a real MCP server — spec 2025-11-25 over Streamable HTTP. Any MCP client can supervise; the sim you just saw is one." |
| 2:25–2:40 | README on screen: architecture, CI badge, 90 tests. | "Ninety tests, typed end to end, runs with zero credentials. The Bedrock path lights up the moment AWS keys exist." |
| 2:40–2:50 | Title card again. | "Ambient. Your agents work in the background — Alexa tells you when they need you." |

**Post checklist**
- [x] Trim to ≤3:00 — `docs/media/ambient-demo.mp4` built by
  `scripts/video/build.py` is 1:50 (Playwright captures of the real sim +
  `say` narration + real /mcp transcript). Re-record with a human voice if
  preferred; the beat timings above are what it plays.
- [ ] Upload public YouTube; verify the link unauthenticated in a private window.
- [ ] Paste the link into Devpost and README.
