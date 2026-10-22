#!/usr/bin/env python3
"""Record real screen captures of Ambient's /sim page for film 3.

Usage: python launch/film3/tools/capture_sim.py [call] [around] [fool] [devices]
Each flow starts a fresh zero-key demo server on a temp data dir at normal demo
speed, drives /sim with playwright at 1600x1000 and 2x scale, grabs frames with
the Chrome screencast, and encodes assets/video/sim-<flow>.mp4 (H.264, 1920x1080,
30 fps, padded onto #efebe4). Prints the key moments in seconds from the clip start.
"""
import asyncio
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parents[1] / "assets" / "video"
W, H, FPS = 1920, 1080, 30
VW, VH = 1600, 1000
GROUND = "0xefebe4"
TAIL = 0.3


class Server:
    def __init__(self, port):
        self.data = Path(tempfile.mkdtemp(prefix="ambient-sim-"))
        runtimes = (ROOT / "runtimes.demo.json").read_text(encoding="utf-8")
        (self.data / "runtimes.json").write_text(runtimes, encoding="utf-8")
        env = {**os.environ, "PORT": str(port), "PUBLIC_BASE_URL": f"http://127.0.0.1:{port}", "AMBIENT_DATA_DIR": str(self.data), "AMBIENT_RUNTIMES_FILE": str(self.data / "runtimes.json")}
        self.process = subprocess.Popen("pnpm -s demo", cwd=ROOT, env=env, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.base = f"http://127.0.0.1:{port}"
        for _ in range(60):
            try:
                urllib.request.urlopen(f"{self.base}/healthz", timeout=1)
                return
            except OSError:
                time.sleep(0.5)
        self.stop()
        raise RuntimeError(f"demo server on {port} did not start")

    def stop(self):
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(self.process.pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            self.process.kill()
        shutil.rmtree(self.data, ignore_errors=True)


class Screencast:
    def __init__(self, folder):
        self.folder = folder
        self.frames = []
        self.marks = {}
        self.cdp = None
        self.pending = set()

    async def start(self, page):
        self.cdp = await page.context.new_cdp_session(page)
        self.cdp.on("Page.screencastFrame", self.on_frame)
        await self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "everyNthFrame": 1})
        for _ in range(20):
            if self.frames:
                return
            await asyncio.sleep(0.1)
        await page.evaluate("document.body.style.opacity = '0.999'")
        await asyncio.sleep(0.15)
        await page.evaluate("document.body.style.opacity = ''")
        while not self.frames:
            await asyncio.sleep(0.05)

    def on_frame(self, event):
        index = len(self.frames)
        path = self.folder / f"f{index:05d}.jpg"
        path.write_bytes(base64.b64decode(event["data"]))
        self.frames.append((event["metadata"]["timestamp"], path))
        self.pending.add(asyncio.ensure_future(self.cdp.send("Page.screencastFrameAck", {"sessionId": event["sessionId"]})))

    def mark(self, name):
        self.marks[name] = time.time()

    async def stop(self):
        await asyncio.sleep(TAIL)
        await self.cdp.send("Page.stopScreencast")
        await asyncio.gather(*self.pending, return_exceptions=True)

    def encode(self, out):
        first = self.frames[0][0]
        total = self.frames[-1][0] - first + TAIL
        listing = self.folder / "frames.txt"
        lines = []
        for (t, path), (next_t, _) in zip(self.frames, self.frames[1:] + [(self.frames[-1][0] + TAIL, None)]):
            lines.append(f"file '{path.name}'\nduration {max(next_t - t, 0.001):.4f}\n")
        lines.append(f"file '{self.frames[-1][1].name}'\n")
        listing.write_text("".join(lines), encoding="utf-8")
        filters = f"scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={GROUND},fps={FPS},scale=in_range=pc:out_range=tv,format=yuv420p"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listing.name, "-t", f"{total:.3f}", "-vf", filters,
                        "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-r", str(FPS), "-an", "-movflags", "+faststart", str(out)], cwd=self.folder, check=True)
        length = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(out)], capture_output=True, text=True, check=True).stdout)
        return length, {name: round(when - first, 2) for name, when in self.marks.items()}


def tap(page, label):
    return page.frame_locator("#show8").get_by_role("button", name=re.compile(label)).click()


async def ready(page, base):
    await page.goto(f"{base}/sim")
    await page.frame_locator("#show8").get_by_role("button").first.wait_for()
    await asyncio.sleep(1.2)


async def call(page, cast):
    show = page.frame_locator("#show8")
    said = page.locator("#transcript")
    cast.mark("idle")
    await asyncio.sleep(0.6)
    cast.mark("tap_call")
    await tap(page, "^Call Joe")
    await page.wait_for_selector(".bubble.business", timeout=20000)
    cast.mark("joe_speaks")
    await page.wait_for_selector('body[data-phase="needs"]', timeout=60000)
    cast.mark("asks_180")
    await asyncio.sleep(2.2)
    cast.mark("tap_offer")
    await tap(page, r"^Offer \$150")
    await show.get_by_role("button", name=re.compile(r"^Book \$160")).wait_for(timeout=60000)
    cast.mark("asks_160")
    await asyncio.sleep(2.2)
    cast.mark("tap_book")
    await tap(page, r"^Book \$160")
    await said.get_by_text("Yes, plus parts.").wait_for(timeout=60000)
    cast.mark("plus_parts_said")
    await said.get_by_text("What is the total with parts?").wait_for(timeout=60000)
    cast.mark("refused")
    await page.wait_for_selector(".outcome.ok", timeout=60000)
    cast.mark("booked")
    await asyncio.sleep(2.0)


async def around(page, cast):
    show = page.frame_locator("#show8")
    cast.mark("idle")
    await asyncio.sleep(0.6)
    cast.mark("tap_quotes")
    await tap(page, "^Get 3 quotes")
    await show.get_by_role("button", name=re.compile("^Call all three")).wait_for(timeout=20000)
    cast.mark("call_all_offered")
    await asyncio.sleep(1.5)
    cast.mark("tap_call_all")
    await tap(page, "^Call all three")
    await show.get_by_text("Comparing quotes").or_(show.get_by_text("Booking the best quote")).first.wait_for(timeout=90000)
    cast.mark("quotes_visible")
    await page.wait_for_selector(".outcome.ok", timeout=120000)
    cast.mark("booked")
    await asyncio.sleep(2.0)


async def fool(page, cast):
    box = page.locator("#foolVerdict")
    cast.mark("idle")
    await asyncio.sleep(0.6)
    for index, reply in enumerate(["Yes, plus parts.", "Yes, that's right. See you then."], 1):
        before = await box.inner_text()
        await page.locator("#foolReply").fill("")
        cast.mark(f"type_{index}")
        await page.locator("#foolReply").press_sequentially(reply, delay=70)
        await asyncio.sleep(0.5)
        cast.mark(f"submit_{index}")
        await page.press("#foolReply", "Enter")
        await page.wait_for_function("([before]) => document.getElementById('foolVerdict').innerText !== before && document.getElementById('foolVerdict').innerText !== ''", arg=[before], timeout=10000)
        cast.mark(f"verdict_{index}")
        await asyncio.sleep(2.2)


DEVICES = [
    ("Echo Show 8", "display", 1280, 800, None),
    ("Echo Show 15", "display", 1920, 1080, (960, 540, "wide")),
    ("Fire TV", "tv", 600, 200, (600, 200, "wide")),
    ("Mobile", "mobile", 390, 844, (390, 844, "tall")),
    ("Voice-only", "voice", 0, 0, "hide"),
]

SWITCH = """([cls, w, h, native, mode]) => {
  const frame = document.getElementById('show8'), box = frame.parentElement;
  frame.dataset.device = cls; frame.dataset.w = w; frame.dataset.h = h;
  for (const el of [box, frame]) el.removeAttribute('style');
  if (mode === 'hide') { box.style.visibility = 'hidden'; return; }
  if (!native) {
    const k = Math.min((box.clientWidth - 24) / 960, (box.clientHeight - 24) / 600);
    box.style.setProperty('--k', k);
    box.style.setProperty('--x', (12 + (box.clientWidth - 24 - 960 * k) / 2) + 'px');
    box.style.setProperty('--y', (12 + (box.clientHeight - 24 - 600 * k) / 2) + 'px');
    frame.style.setProperty('--k', k);
    frame.style.setProperty('--x', (12 + (box.clientWidth - 24 - 960 * k) / 2) + 'px');
    frame.style.setProperty('--y', (12 + (box.clientHeight - 24 - 600 * k) / 2) + 'px');
  }
  if (native) {
    const [iw, ih] = native;
    const col = box.parentElement.clientWidth;
    const outer = mode === 'tall' ? 330 : col;
    const k = (outer - 24) / iw;
    box.style.aspectRatio = 'auto';
    box.style.width = outer + 'px';
    box.style.height = (ih * k + 24) + 'px';
    box.style.margin = '0 auto';
    frame.style.width = iw + 'px';
    frame.style.height = ih + 'px';
    frame.style.left = '12px';
    frame.style.top = '12px';
    frame.style.transform = 'scale(' + k + ')';
    frame.style.borderRadius = (12 / k) + 'px';
  }
  frame.srcdoc = frame.srcdoc;
}"""


async def devices_prep(page):
    await tap(page, "^Call Joe")
    await page.wait_for_selector('body[data-phase="needs"]', timeout=60000)
    await asyncio.sleep(0.8)


async def devices(page, cast):
    for index, (name, cls, w, h, native) in enumerate(DEVICES):
        mode = native[2] if isinstance(native, tuple) else native
        size = native[:2] if isinstance(native, tuple) else None
        cast.mark(name)
        if index:
            await page.evaluate(SWITCH, [cls, w, h, size, mode])
        await asyncio.sleep(1.5)


FLOWS = {"call": (3311, call, None), "around": (3312, around, None), "fool": (3313, fool, None), "devices": (3314, devices, devices_prep)}


async def record(name, port, flow, prep, work):
    server = Server(port)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            context = await browser.new_context(viewport={"width": VW, "height": VH}, device_scale_factor=2)
            page = await context.new_page()
            await ready(page, server.base)
            if prep:
                await prep(page)
            cast = Screencast(work)
            await cast.start(page)
            await flow(page, cast)
            await cast.stop()
            await browser.close()
        return cast.encode(OUT / f"sim-{name}.mp4")
    finally:
        server.stop()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    names = sys.argv[1:] or list(FLOWS)
    for name in names:
        port, flow, prep = FLOWS[name]
        work = Path(tempfile.mkdtemp(prefix=f"ambient-cast-{name}-"))
        try:
            length, marks = asyncio.run(record(name, port, flow, prep, work))
        finally:
            shutil.rmtree(work, ignore_errors=True)
        print(json.dumps({"file": f"sim-{name}.mp4", "seconds": round(length, 2), "marks": marks}, indent=1))


main()
