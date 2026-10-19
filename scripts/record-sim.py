#!/usr/bin/env python3
"""Record the main /sim call as docs/media/demo.gif.

Usage: python scripts/record-sim.py [base_url]
Needs a fresh `pnpm demo` server started with AMBIENT_DATA_DIR set to an
empty directory, playwright with chromium installed, and ffmpeg on PATH.
"""
import asyncio
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
OUT = Path(__file__).resolve().parent.parent / "docs" / "media" / "demo.gif"
WIDTH = 1440
FPS = 12


async def tap(page, label):
    await page.frame_locator("#show8").get_by_role("button", name=re.compile(label)).click()


async def beat(seconds=1.2):
    await asyncio.sleep(seconds)


async def record(video_dir):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=str(video_dir),
            record_video_size={"width": 1440, "height": 900},
        )
        page = await context.new_page()
        page.on("pageerror", lambda e: print("pageerror:", str(e)[:200]))
        await page.goto(f"{BASE}/sim")
        await page.frame_locator("#show8").get_by_role("button").first.wait_for()
        await beat(1.0)
        await tap(page, "^Call Joe")
        await page.wait_for_function("document.getElementById('callstate').textContent.startsWith('Ringing')", timeout=10000)
        await beat(1.5)
        await page.wait_for_selector(".bubble.business", timeout=15000)
        await page.wait_for_selector('body[data-phase="needs"]', timeout=30000)
        await beat(2.5)
        await tap(page, r"^Offer \$150")
        await page.wait_for_selector(".note", timeout=10000)
        await beat(1.5)
        await page.frame_locator("#show8").get_by_role("button", name=re.compile(r"^Book \$160")).wait_for(timeout=30000)
        await beat(2.5)
        await tap(page, r"^Book \$160")
        await page.get_by_text("What is the total with parts?").wait_for(timeout=30000)
        await beat(2.0)
        await page.wait_for_selector(".outcome.ok", timeout=30000)
        await beat(3.0)
        video = page.video
        await context.close()
        path = Path(await video.path())
        await browser.close()
        return path


def convert(video, gif):
    gif.parent.mkdir(parents=True, exist_ok=True)
    filters = f"fps={FPS},scale={WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-vf", filters, "-loop", "0", str(gif)], check=True)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        video = asyncio.run(record(Path(tmp)))
        convert(video, OUT)
    print(f"saved {OUT} ({OUT.stat().st_size / 1_000_000:.1f} MB)")


main()
