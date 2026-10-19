#!/usr/bin/env python3
"""Render a draft of the submission video from the simulator.

Usage: python scripts/render-video.py
Starts fresh zero-key demo servers on ports 3301 to 3303 at half the demo
speed, records the flows in docs/video-script.md with playwright, and cuts
them with ffmpeg into .ambient/video/ambient-draft.mp4. Needs playwright
with chromium and ffmpeg. The draft has captions and no voice; the
simulator's speech is not recorded.
"""
import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / "docs" / "media"
OUT = ROOT / ".ambient" / "video"
W, H, FPS = 1920, 1080, 30
VW, VH = 1600, 900
SPEED_MS = "2200"
FONT = "C\\:/Windows/Fonts/seguisb.ttf" if os.name == "nt" else "DejaVuSans-Bold"
FONT_LIGHT = "C\\:/Windows/Fonts/segoeui.ttf" if os.name == "nt" else "DejaVuSans"
BG = "0xF5F3EF"
INK = "0x1E2430"
SIMULATED = "Simulated business and Alexa+ host. Every action is a real MCP tool call."


class Server:
    def __init__(self, port):
        self.data = Path(tempfile.mkdtemp(prefix="ambient-video-"))
        runtimes = json.loads((ROOT / "runtimes.demo.json").read_text(encoding="utf-8"))
        for runtime in runtimes:
            runtime["options"]["speedMs"] = SPEED_MS
        (self.data / "runtimes.json").write_text(json.dumps(runtimes), encoding="utf-8")
        env = {**os.environ, "PORT": str(port), "PUBLIC_BASE_URL": f"http://127.0.0.1:{port}", "AMBIENT_DATA_DIR": str(self.data), "AMBIENT_RUNTIMES_FILE": str(self.data / "runtimes.json")}
        self.process = subprocess.Popen("pnpm -s demo", cwd=ROOT, env=env, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.base = f"http://127.0.0.1:{port}"
        for _ in range(60):
            try:
                urllib.request.urlopen(f"{self.base}/healthz", timeout=1)
                return
            except OSError:
                time.sleep(0.5)
        raise RuntimeError(f"demo server on {port} did not start")

    def stop(self):
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(self.process.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            self.process.kill()
        shutil.rmtree(self.data, ignore_errors=True)


class Take:
    def __init__(self):
        self.started = time.monotonic()
        self.marks = {}

    def mark(self, name):
        self.marks[name] = time.monotonic() - self.started


async def tap(page, label):
    await page.frame_locator("#show8").get_by_role("button", name=re.compile(label)).click()


async def record(base, flow, folder):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(viewport={"width": VW, "height": VH}, record_video_dir=str(folder), record_video_size={"width": VW, "height": VH})
        page = await context.new_page()
        take = Take()
        await page.goto(f"{base}/sim")
        await page.frame_locator("#show8").get_by_role("button").first.wait_for()
        await asyncio.sleep(1.5)
        await flow(page, take)
        video = page.video
        await context.close()
        path = Path(await video.path())
        await browser.close()
        return path, take.marks


async def single(page, take):
    said = page.locator("#transcript")
    take.mark("call")
    await tap(page, "^Call Joe")
    await page.wait_for_selector(".bubble.business", timeout=20000)
    take.mark("business")
    await page.wait_for_selector('body[data-phase="needs"]', timeout=60000)
    take.mark("needs")
    await asyncio.sleep(7)
    take.mark("offer")
    await tap(page, r"^Offer \$150")
    await page.frame_locator("#show8").get_by_role("button", name=re.compile(r"^Book \$160")).wait_for(timeout=60000)
    await asyncio.sleep(4)
    take.mark("book")
    await tap(page, r"^Book \$160")
    await said.get_by_text("Okay, so just to confirm").wait_for(timeout=60000)
    take.mark("read_back")
    await said.get_by_text("What is the total with parts?").wait_for(timeout=60000)
    take.mark("refused")
    await page.wait_for_selector(".outcome.ok", timeout=60000)
    take.mark("booked")
    await asyncio.sleep(7)
    take.mark("end")


async def around(page, take):
    show = page.frame_locator("#show8")
    take.mark("ask")
    await tap(page, "^Get 3 quotes")
    await show.get_by_role("button", name=re.compile("^Call all three")).wait_for(timeout=20000)
    await asyncio.sleep(3)
    await tap(page, "^Call all three")
    await page.wait_for_selector(".outcome.ok", timeout=120000)
    await asyncio.sleep(7)
    take.mark("end")


async def fool(page, take):
    take.mark("start")
    for reply in ["Yes, plus parts.", "Sure, one eighty.", "Yes, that's right."]:
        await page.fill("#foolReply", "")
        await page.locator("#foolReply").press_sequentially(reply, delay=60)
        await page.press("#foolReply", "Enter")
        await asyncio.sleep(2.4)
        take.marks.setdefault("box", await page.locator(".fool").bounding_box())
    take.mark("end")


def text_file(folder, text):
    path = Path(tempfile.mkstemp(suffix=".txt", dir=folder)[1])
    path.write_text(text, encoding="utf-8")
    return str(path).replace("\\", "/").replace(":", "\\:")


def caption(folder, text, size=44):
    return (f"drawtext=fontfile='{FONT}':textfile='{text_file(folder, text)}':fontsize={size}:fontcolor=white:"
            f"box=1:boxcolor=0x111827@0.85:boxborderw=24:x=(w-tw)/2:y=28")


def label(folder):
    return (f"drawtext=fontfile='{FONT_LIGHT}':textfile='{text_file(folder, SIMULATED)}':fontsize=22:fontcolor=white:"
            f"box=1:boxcolor=0x111827@0.6:boxborderw=10:x=24:y=h-th-24")


def encode(args, out):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args, "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-an", str(out)], check=True)


def clip(folder, video, start, end, text, out, hold=1.5, frame=None):
    start = max(0.0, start)
    seconds = end - start
    view = f"crop={frame}," if frame else ""
    filters = (f"{view}scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={BG},"
               f"tpad=stop_mode=clone:stop_duration={hold},{label(folder)},{caption(folder, text)}")
    encode(["-ss", f"{start:.2f}", "-i", str(video), "-t", f"{seconds + hold:.2f}", "-vf", filters], out)


def still(folder, image, seconds, text, out):
    filters = (f"scale={W - 240}:{H - 260}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2-50:color={BG},"
               f"{caption(folder, text)}")
    encode(["-loop", "1", "-t", f"{seconds}", "-i", str(image), "-vf", filters], out)


def card(folder, seconds, title, line, out):
    filters = (f"drawtext=fontfile='{FONT}':textfile='{text_file(folder, title)}':fontsize=120:fontcolor={INK}:x=(w-tw)/2:y=(h/2)-160,"
               f"drawtext=fontfile='{FONT_LIGHT}':textfile='{text_file(folder, line)}':fontsize=48:fontcolor={INK}@0.75:x=(w-tw)/2:y=(h/2)+10")
    encode(["-f", "lavfi", "-t", f"{seconds}", "-i", f"color=c={BG}:s={W}x{H}:r={FPS}", "-vf", filters], out)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="ambient-cut-"))
    servers = [Server(3301), Server(3302), Server(3303)]
    try:
        one, m = asyncio.run(record(servers[0].base, single, work / "single"))
        many, a = asyncio.run(record(servers[1].base, around, work / "around"))
        panel, f = asyncio.run(record(servers[2].base, fool, work / "fool"))
    finally:
        for server in servers:
            server.stop()
    parts = []

    def part(name):
        path = work / f"{len(parts):02d}-{name}.mp4"
        parts.append(path)
        return path

    box = f["box"]
    side = f"{int(box['width']) + 40}:{min(VH, int(box['height']) + 40)}:{int(box['x']) - 20}:{max(0, int(box['y']) - 20)}"
    clip(work, one, m["read_back"] - 0.5, m["refused"] + 2.5, "It will not take a false yes.", part("cold-open"), hold=2.5)
    card(work, 7, "Ambient", "Alexa, handle the call. An AI caller that cannot lie for you or be lied to.", part("idea"))
    clip(work, one, m["call"] - 0.5, m["business"] + 4, "The first words say it is an AI.", part("disclosure"))
    clip(work, one, m["needs"] - 3, m["offer"], "Over your limit, the call holds and asks you.", part("over-limit"))
    clip(work, one, m["offer"] - 0.5, m["book"] + 1, "A counter goes back to the owner.", part("counter"))
    clip(work, one, m["book"], m["end"], "It books only on a clean yes, and keeps proof of it.", part("clean-yes"))
    clip(work, many, a["ask"] - 0.5, a["end"], "Three plumbers at once. The cheapest speaks Spanish, so Ambient books in Spanish.", part("around"))
    clip(work, panel, f["start"], f["end"], "Try to fool it yourself. The real call reducer answers.", part("fool"), frame=side)
    still(work, MEDIA / "sim-unconfirmed.png", 3, "No clean yes, no booking.", part("unconfirmed"))
    still(work, MEDIA / "call-business-receipt.png", 3, "The business gets a receipt.", part("receipt"))
    still(work, MEDIA / "call-business-ringing-es.png", 3, "The business sees its own language.", part("spanish-page"))
    still(work, MEDIA / "architecture.png", 10, "One pure function decides every word on the call. This demo run is simulated.", part("how"))
    card(work, 6, "Ambient", "Alexa, handle the call.", part("end"))

    listing = work / "parts.txt"
    listing.write_text("".join(f"file '{path.as_posix()}'\n" for path in parts), encoding="utf-8")
    final = OUT / "ambient-draft.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(final)], check=True)
    seconds = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(final)], capture_output=True, text=True, check=True).stdout)
    print(f"saved {final} ({seconds:.1f} s, {final.stat().st_size / 1_000_000:.1f} MB)")
    print("marks:", {key: round(value, 1) for key, value in m.items()}, {key: round(value, 1) for key, value in a.items()})
    shutil.rmtree(work, ignore_errors=True)


main()
