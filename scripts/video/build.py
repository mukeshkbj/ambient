#!/usr/bin/env python3
"""Build docs/media/ambient-demo.mp4 — the hackathon demo video.

Captures the real /sim experience with Playwright, narrates each beat with
macOS `say`, and muxes segments with ffmpeg. Beats follow docs/video-script.md.
Requires: `pnpm demo` running on PORT (default 3102), playwright, ffmpeg, `say`.

Usage:  PORT=3102 python3 scripts/video/build.py
"""
import json, os, re, subprocess, sys, tempfile, textwrap, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PORT = int(os.environ.get("PORT", "3102"))
BASE = f"http://127.0.0.1:{PORT}"
WORK = Path(tempfile.mkdtemp(prefix="ambient-video-"))
OUT = ROOT / "docs" / "media" / "ambient-demo.mp4"
W, H, FPS = 1280, 720, 30

VOICE, RATE = "Samantha", 176

# ---------------------------------------------------------------- narration
NARR = {
  "s2": "Agents run for hours now. They shouldn't have to shout into a chat window to reach you. Alexa already lives in the room — she should be the one supervising them.",
  "s3": "This is the core loop. I delegate, the agent works, and when it wants to spend money, Alexa asks me — a real elicitation, not a button the agent could press itself.",
  "s4": "Same M C P response, every Alexa form factor. The task card adapts to the device class. Voice only just talks.",
  "s5": "Here's the part most demos fake. The agent's host died mid-run. Ambient says unknown — not failed, not a guess. An honest I-don't-know is the feature.",
  "s6": "One briefing across every agent I supervise. What finished, what needs me, what's still running.",
  "s7": "Underneath it's a real M C P server — spec twenty twenty-five, eleven, twenty-five, over streamable H T T P. Any M C P client can supervise; the sim you just saw is one.",
  "s8": "Ninety tests, typed end to end, runs with zero credentials. The Bedrock path lights up the moment A W S keys exist.",
  "s9": "Ambient. Your agents work in the background. Alexa tells you when they need you.",
}

def say(text: str, out: Path):
    subprocess.run(["say", "-v", VOICE, "-r", str(RATE), "-o", str(out), text], check=True)

def dur(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "stream=duration",
                        "-of", "csv=p=0", "-select_streams", "v:0" if path.suffix != ".aiff" else "a:0",
                        str(path)], capture_output=True, text=True)
    try:
        return float(r.stdout.strip().split("\n")[0])
    except ValueError:
        r = subprocess.run(["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                            "-of", "csv=p=0", str(path)], capture_output=True, text=True)
        return float(r.stdout.strip())

def norm_segment(video: Path, audio: Path | None, target: float, out: Path):
    """Scale video to 1280x720@30, freeze-frame or silence-pad to `target` seconds, h264+aac."""
    a_in = ["-i", str(audio)] if audio else ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]
    af = f"apad,atrim=0:{target}"
    vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x0b0e13,fps={FPS},tpad=stop=-1:stop_mode=clone"
    subprocess.run([
        "ffmpeg", "-y", "-i", str(video), *a_in,
        "-vf", vf, "-af", af, "-t", str(target),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", str(out)
    ], check=True, capture_output=True)

def concat(segments: list[Path], out: Path):
    ins: list[str] = []
    for s in segments:
        ins += ["-i", str(s)]
    fc = "".join(f"[{i}:v][{i}:a]" for i in range(len(segments))) + f"concat=n={len(segments)}:v=1:a=1[outv][outa]"
    subprocess.run(["ffmpeg", "-y", *ins, "-filter_complex", fc, "-map", "[outv]", "-map", "[outa]",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
                    "-movflags", "+faststart", str(out)], check=True, capture_output=True)

# ------------------------------------------------------------------ cards
CARD_CSS = """
  *{box-sizing:border-box;margin:0}
  body{width:1280px;height:720px;background:radial-gradient(60% 90% at 50% 40%,#121722 0%,#0b0e13 70%);
       color:#e8edf4;font:16px/1.5 -apple-system,'SF Pro Text',Helvetica,sans-serif;
       display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:60px}
  h1{font-size:64px;letter-spacing:-1px}
  .ring{width:110px;height:110px;border-radius:50%;border:3px solid #58d6ff;opacity:.9;
        box-shadow:0 0 40px #58d6ff55,inset 0 0 24px #58d6ff33;background:radial-gradient(circle at 38% 35%,#1d2735,#0d1118)}
  .pitch{font-size:26px;color:#9fb3c8;max-width:760px;text-align:center}
  .fine{font-size:15px;color:#5f7089}
  .term{background:#0d1117;border:1px solid #223044;border-radius:14px;padding:22px 26px;width:980px;
        font:15px/1.65 'SF Mono',Menlo,monospace;color:#c9d4e3;white-space:pre-wrap;text-align:left}
  .term .k{color:#58d6ff}.term .d{color:#7e8ea3}
  .cap{font-size:14px;color:#5f7089;letter-spacing:.04em;text-transform:uppercase}
  .stats{display:flex;gap:26px}
  .stat{background:#10151f;border:1px solid #223044;border-radius:14px;padding:26px 30px;text-align:center;min-width:210px}
  .stat b{display:block;font-size:44px;color:#58d6ff}
  .stat span{font-size:15px;color:#9fb3c8}
"""

def write_cards(transcript: str):
    title = f"""<html><style>{CARD_CSS}</style><body>
      <div class="ring"></div><h1>Ambient</h1>
      <div class="pitch">Your AI agents work in the background.<br>Alexa tells you when they need you.</div>
      <div class="fine">a self-hosted MCP supervisor for Alexa+</div></body></html>"""
    term = f"""<html><style>{CARD_CSS}</style><body>
      <div class="cap">MCP Inspector &nbsp;·&nbsp; POST /mcp &nbsp;·&nbsp; Streamable HTTP</div>
      <div class="term">{transcript}</div>
      <div class="fine">real responses, captured from this server just now</div></body></html>"""
    stats = f"""<html><style>{CARD_CSS}</style><body>
      <div class="cap">Verified on this repo</div>
      <div class="stats">
        <div class="stat"><b>90</b><span>tests · pnpm scan</span></div>
        <div class="stat"><b>8</b><span>voice-first tools</span></div>
        <div class="stat"><b>0</b><span>credentials to demo</span></div>
        <div class="stat"><b>~11s</b><span>clean clone → first answer</span></div>
      </div>
      <div class="fine">typecheck + eslint + knip green · runtimes: demo · bedrock · hermes · openclaw</div></body></html>"""
    (WORK / "title.html").write_text(title)
    (WORK / "term.html").write_text(term)
    (WORK / "stats.html").write_text(stats)

# ------------------------------------------------------- real MCP transcript
_SESSION = {"id": None}

def mcp_call(payload: dict) -> str:
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if _SESSION["id"]:
        headers["Mcp-Session-Id"] = _SESSION["id"]
    req = urllib.request.Request(f"{BASE}/mcp", data=json.dumps(payload).encode(), headers=headers)
    resp = urllib.request.urlopen(req, timeout=20)
    if resp.headers.get("Mcp-Session-Id"):
        _SESSION["id"] = resp.headers["Mcp-Session-Id"]
    body = resp.read().decode()
    m = re.search(r"data:\s*(\{.*)", body)
    return m.group(1) if m else body

def capture_transcript() -> str:
    init = json.loads(mcp_call({"jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "video", "version": "1"}}}))
    ver = init["result"]["protocolVersion"]
    tools = json.loads(mcp_call({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}))
    names = [t["name"] for t in tools["result"]["tools"]]
    res = json.loads(mcp_call({"jsonrpc": "2.0", "id": 3, "method": "resources/list", "params": {}}))
    uris = [r["uri"] for r in res["result"]["resources"]]
    call = json.loads(mcp_call({"jsonrpc": "2.0", "id": 4, "method": "tools/call",
        "params": {"name": "agents", "arguments": {}}}))
    speech = call["result"]["structuredContent"]["speech"]
    lines = [
        f'<span class="d">$ initialize →</span> protocolVersion <span class="k">"{ver}"</span>',
        f'<span class="d">$ tools/list →</span> {", ".join(names[:4])}',
        f'<span class="d">  …</span> {", ".join(names[4:])}',
        f'<span class="d">$ resources/list →</span> ' + " &nbsp;".join(f'<span class="k">{u}</span>' for u in uris),
        f'<span class="d">$ tools/call agents →</span> "{speech}"',
    ]
    return "\n".join(lines)

# -------------------------------------------------------------- playwright
def record(fn, name: str) -> Path:
    from playwright.sync_api import sync_playwright
    vdir = WORK / "rec" / name
    vdir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": W, "height": H},
                                  record_video_dir=str(vdir), record_video_size={"width": W, "height": H})
        page = ctx.new_page()
        try:
            fn(page)
        finally:
            ctx.close()
            browser.close()
    files = sorted(vdir.glob("*.webm"), key=lambda f: f.stat().st_mtime)
    return files[-1]

def shot(html: str, name: str) -> Path:
    """Render a card HTML file to a PNG, then wrap as a still 'video' via lavfi color? No —
    ffmpeg image2: use -loop 1 on the png inside norm_segment."""
    from playwright.sync_api import sync_playwright
    out = WORK / f"{name}.png"
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": W, "height": H})
        page.goto(f"file://{WORK}/{html}")
        page.wait_for_timeout(400)
        page.screenshot(path=str(out))
        b.close()
    return out

def png_to_video(png: Path, seconds: float, name: str) -> Path:
    out = WORK / f"{name}.mp4"
    subprocess.run(["ffmpeg", "-y", "-loop", "1", "-i", str(png), "-t", str(seconds),
                    "-vf", f"scale={W}:{H},fps={FPS}", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    str(out)], check=True, capture_output=True)
    return out

# ------------------------------------------------------------------ beats
def beat_s1(page):
    page.goto(f"{BASE}/sim"); page.wait_for_selector(".orb")
    page.wait_for_timeout(1200)
    page.fill("#utter", "What's the status of my agents?"); page.wait_for_timeout(400)
    page.click("#send")
    page.wait_for_timeout(6500)

def beat_s3(page):
    page.goto(f"{BASE}/sim"); page.wait_for_selector(".orb")
    page.wait_for_timeout(800)
    page.fill("#utter", "Book a table at Lupa for Saturday at seven."); page.wait_for_timeout(400)
    page.click("#send")
    page.wait_for_selector("#elicit.show", timeout=30000)
    page.wait_for_timeout(2500)
    page.click("#elicit .approve")
    page.wait_for_timeout(5000)

def beat_s4(page):
    page.goto(f"{BASE}/sim"); page.wait_for_selector(".orb")
    page.wait_for_timeout(600)
    for dev in ["echo-show-15", "mobile", "voice-only", "echo-show-8"]:
        page.click(f"#devices button[data-d='{dev}']")
        page.wait_for_timeout(2400)

def beat_s5(page):
    page.goto(f"{BASE}/sim"); page.wait_for_selector(".orb")
    page.wait_for_timeout(600)
    page.fill("#utter", "Ship the deploy to staging."); page.wait_for_timeout(400)
    page.click("#send")
    page.wait_for_timeout(9000)
    page.fill("#utter", "What's the status of the deploy?"); page.wait_for_timeout(400)
    page.click("#send")
    page.wait_for_timeout(6000)

def beat_s6(page):
    page.goto(f"{BASE}/sim"); page.wait_for_selector(".orb")
    page.wait_for_timeout(600)
    page.fill("#utter", "What did my agents get done today?"); page.wait_for_timeout(400)
    page.click("#send")
    page.wait_for_timeout(8000)

def main():
    import shutil
    for tool in ["ffmpeg", "ffprobe", "say"]:
        assert shutil.which(tool), f"missing {tool}"
    try:
        urllib.request.urlopen(f"{BASE}/healthz", timeout=3)
    except Exception:
        sys.exit(f"server not up at {BASE} — run: PORT={PORT} pnpm demo")

    print("· capturing real MCP transcript"); transcript = capture_transcript()
    write_cards(transcript)

    audio = {}
    for key, text in NARR.items():
        af = WORK / f"{key}.aiff"; say(text, af); audio[key] = af
        print(f"· narration {key}: {dur(af):.1f}s")

    segs: list[Path] = []
    print("· s1 cold open (sim status)");  v = record(beat_s1, "s1"); segs.append(("s1", v, None, max(dur(v), 9)))
    print("· s3 core loop (approval)");    v3 = record(beat_s3, "s3")
    print("· s4 device switch");          v4 = record(beat_s4, "s4")
    print("· s5 honest unknown");         v5 = record(beat_s5, "s5")
    print("· s6 briefing");               v6 = record(beat_s6, "s6")

    print("· rendering cards")
    t_png = shot("title.html", "title"); m_png = shot("term.html", "term"); st_png = shot("stats.html", "stats")

    order = [
        ("s1", segs[0][1], None),
        ("s2", png_to_video(t_png, 12.0, "s2v"), audio["s2"]),
        ("s3", v3, audio["s3"]),
        ("s4", v4, audio["s4"]),
        ("s5", v5, audio["s5"]),
        ("s6", v6, audio["s6"]),
        ("s7", png_to_video(m_png, 15.0, "s7v"), audio["s7"]),
        ("s8", png_to_video(st_png, 13.0, "s8v"), audio["s8"]),
        ("s9", png_to_video(t_png, 9.0, "s9v"), audio["s9"]),
    ]
    parts = []
    total = 0.0
    for name, video, aud in order:
        vlen, alen = dur(video), (dur(aud) if aud else 0.0)
        target = max(vlen, alen)
        part = WORK / f"{name}.mp4"
        print(f"· {name}: video {vlen:.1f}s + audio {alen:.1f}s → {target:.1f}s")
        norm_segment(video, aud, target, part)
        parts.append(part); total += target
    concat(parts, OUT)
    print(f"\n✓ {OUT.relative_to(ROOT)} — {dur(OUT):.1f}s ({'UNDER' if dur(OUT) < 180 else 'OVER'} 3:00)")
    print(f"  work dir kept at {WORK}")

if __name__ == "__main__":
    main()
