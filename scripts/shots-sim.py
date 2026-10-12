#!/usr/bin/env python3
"""Screenshot the /sim Alexa+ simulator across device classes and flows.

Usage: python3 scripts/shots-sim.py [base_url]
Requires a running demo server (pnpm demo) and playwright + chromium installed.
"""
import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
OUT = Path(__file__).resolve().parent.parent / "docs" / "media"


async def say(page, text):
    await page.fill("#utter", text)
    await page.click("#send")


async def wait_agent_reply(page, timeout=45000):
    """Wait for a new agent bubble. Works for fast acks and slow turns alike."""
    before = await page.locator(".msg.agent").count()
    await page.wait_for_function(
        f"document.querySelectorAll('.msg.agent').length > {before}", timeout=timeout
    )
    return await page.locator(".msg.agent").last.inner_text()


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1500, "height": 900})
        page.on("pageerror", lambda e: print("pageerror:", str(e)[:200]))
        await page.goto(f"{BASE}/sim")
        await page.wait_for_selector(".orb")
        await asyncio.sleep(0.5)
        await page.screenshot(path=OUT / "sim-echo-show-8.png")

        # delegate a booking → run goes to waiting_approval → elicit card + ring
        await say(page, "Book a table at Lupa for 4 on Saturday at 7pm")
        await page.wait_for_selector("#elicit.show", timeout=30000)
        await asyncio.sleep(0.5)
        await page.screenshot(path=OUT / "sim-needs-you.png")

        # approve it — the elicitation resolves through the real MCP path
        await page.click("#elicit .approve")
        reply = await wait_agent_reply(page)
        print("approved →", reply[:100])
        await asyncio.sleep(1.2)  # let the task view re-render to completed
        await page.screenshot(path=OUT / "sim-approved.png")

        # briefing
        await say(page, "What's happening?")
        reply = await wait_agent_reply(page)
        print("briefing →", reply[:100])
        await asyncio.sleep(1.0)

        # device classes
        for device in ["mobile", "echo-show-15", "fire-tv", "voice-only"]:
            await page.click(f"#devices button[data-d='{device}']")
            await asyncio.sleep(0.7)
            await page.screenshot(path=OUT / f"sim-{device}.png")

        await browser.close()
        print("saved", len(list(OUT.glob("sim-*.png"))), "screenshots to", OUT)


asyncio.run(main())
