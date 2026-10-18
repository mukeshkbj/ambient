#!/usr/bin/env python3
"""Screenshot the /sim page through full simulated calls.

Usage: python scripts/shots-sim.py [base_url]
Needs a fresh `pnpm demo` server, and playwright with chromium installed.
"""
import asyncio
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
OUT = Path(__file__).resolve().parent.parent / "docs" / "media"


async def phase(page, value, timeout=30000):
    await page.wait_for_selector(f'body[data-phase="{value}"]', timeout=timeout)


async def shot(page, name):
    await asyncio.sleep(0.7)
    await page.screenshot(path=OUT / f"sim-{name}.png")
    print("saved", name)


async def tap(page, label):
    await page.frame_locator("#show8").get_by_role("button", name=re.compile(label)).click()


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for scheme in ("light", "dark"):
            page = await browser.new_page(viewport={"width": 1440, "height": 900}, color_scheme=scheme)
            page.on("pageerror", lambda e: print("pageerror:", str(e)[:200]))
            await page.goto(f"{BASE}/sim")
            await page.frame_locator("#show8").get_by_role("button").first.wait_for()
            if scheme == "dark":
                await tap(page, "^Call (Joe|again)")
                await phase(page, "needs")
                await shot(page, "needs-you-dark")
                await page.click("#hangup")
                await phase(page, "ended")
                await page.close()
                continue
            await shot(page, "idle")
            await tap(page, "^Call Joe")
            await page.wait_for_function("document.getElementById('callstate').textContent.startsWith('Ringing')", timeout=10000)
            await page.screenshot(path=OUT / "sim-ringing.png")
            print("saved ringing")
            await page.wait_for_selector(".bubble.business", timeout=15000)
            await shot(page, "talking")
            await phase(page, "needs")
            await shot(page, "needs-you")
            await tap(page, r"^Offer \$160")
            await page.wait_for_selector(".note", timeout=10000)
            await shot(page, "steered")
            await page.wait_for_selector(".outcome.ok", timeout=30000)
            await shot(page, "confirmed")
            await page.click("#again")
            await phase(page, "needs")
            await tap(page, "^Approve")
            await page.wait_for_selector(".outcome.ok", timeout=30000)
            await shot(page, "approved")
            await page.click("#again")
            await phase(page, "needs")
            await page.set_viewport_size({"width": 390, "height": 844})
            await shot(page, "mobile-needs-you")
            await page.set_viewport_size({"width": 1440, "height": 900})
            await page.click("#hangup")
            await page.wait_for_selector(".outcome.not", timeout=15000)
            await shot(page, "unconfirmed")
            await page.set_viewport_size({"width": 390, "height": 844})
            await shot(page, "mobile")
            await page.close()
        call = await browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        await call.route("**/call/demo/info", lambda route: route.fulfill(json={"ownerName": "Maya"}))
        await call.route("**/call/demo/events", lambda route: route.fulfill(status=204, body=""))
        await call.route("**/call/demo", lambda route: route.fulfill(path=str(Path(__file__).resolve().parent.parent / "web" / "call" / "index.html"), content_type="text/html"))
        await call.goto(f"{BASE}/call/demo")
        await asyncio.sleep(0.8)
        await call.screenshot(path=OUT / "call-business-ringing.png")
        print("saved call-business-ringing")
        await browser.close()


asyncio.run(main())
