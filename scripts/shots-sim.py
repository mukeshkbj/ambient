#!/usr/bin/env python3
"""Screenshot the /sim page through a full simulated call.

Usage: python scripts/shots-sim.py [base_url]
Needs a fresh `pnpm demo` server, and playwright with chromium installed.
"""
import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
OUT = Path(__file__).resolve().parent.parent / "docs" / "media"


async def phase(page, value, timeout=30000):
    await page.wait_for_selector(f'#call[data-phase="{value}"]', timeout=timeout)


async def shot(page, name):
    await asyncio.sleep(0.6)
    await page.screenshot(path=OUT / f"sim-{name}.png")
    print("saved", name)


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for scheme in ("light", "dark"):
            page = await browser.new_page(viewport={"width": 1440, "height": 900}, color_scheme=scheme)
            page.on("pageerror", lambda e: print("pageerror:", str(e)[:200]))
            await page.goto(f"{BASE}/sim")
            await page.click("#sound")
            if scheme == "dark":
                await page.click("#start")
                await phase(page, "needs")
                await shot(page, "needs-you-dark")
                await page.click("#hangup")
                await phase(page, "ended")
                await page.close()
                continue
            await shot(page, "idle")
            await page.click("#start")
            await page.wait_for_function("document.getElementById('callstate').textContent.startsWith('Ringing')", timeout=10000)
            await page.screenshot(path=OUT / "sim-ringing.png")
            print("saved ringing")
            await page.wait_for_selector(".bubble.business", timeout=15000)
            await shot(page, "talking")
            await phase(page, "needs")
            await shot(page, "needs-you")
            await page.click("#offerBtn")
            await page.fill("#amount", "160")
            await page.click("#offer button[type=submit]")
            await page.wait_for_selector(".note", timeout=10000)
            await shot(page, "steered")
            await page.wait_for_selector(".outcome.ok", timeout=30000)
            await shot(page, "confirmed")
            await page.click("#start")
            await phase(page, "needs")
            await page.click("#hangup")
            await page.wait_for_selector(".outcome.not", timeout=15000)
            await shot(page, "unconfirmed")
            await page.set_viewport_size({"width": 390, "height": 844})
            await shot(page, "mobile")
            await page.close()
        await browser.close()


asyncio.run(main())
