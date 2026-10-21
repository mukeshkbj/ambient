#!/usr/bin/env python3
"""Capture the real Ambient UI, state by state, at 2x for the launch film.

Usage: python launch/capture/capture.py [base_url]
Needs a fresh `pnpm demo` server started with AMBIENT_DATA_DIR set to an empty directory.
Writes PNGs and the live HTML of each Echo Show card state to launch/film/assets/ui/.
"""
import asyncio
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
OUT = Path(__file__).resolve().parents[1] / "film" / "assets" / "ui"
CARD_HTML = "() => { const d = document.cloneNode(true); d.querySelectorAll('script').forEach(s => s.remove()); return '<!doctype html>' + d.documentElement.outerHTML; }"


async def card(page, name):
    await asyncio.sleep(0.9)
    frame = page.frame_locator("#show8")
    await page.locator("#show8").screenshot(path=OUT / f"card-{name}.png")
    inner = await (await page.query_selector("#show8")).content_frame()
    (OUT / f"card-{name}.html").write_text(await inner.evaluate(CARD_HTML), encoding="utf-8")
    await page.locator(".call").screenshot(path=OUT / f"phone-{name}.png")
    print("saved", name)


async def tap(page, label):
    await page.frame_locator("#show8").get_by_role("button", name=re.compile(label)).click()


async def joe(browser):
    page = await browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    await page.goto(f"{BASE}/sim")
    await page.frame_locator("#show8").get_by_role("button").first.wait_for()
    await card(page, "idle")
    await tap(page, "^Call Joe")
    await page.wait_for_function("document.getElementById('callstate').textContent.startsWith('Ringing')", timeout=10000)
    await card(page, "ringing")
    await page.wait_for_selector(".bubble.business", timeout=15000)
    await card(page, "talking")
    await page.wait_for_selector('body[data-phase="needs"]', timeout=30000)
    await card(page, "needs-180")
    await tap(page, r"^Offer \$150")
    await page.wait_for_selector(".note", timeout=10000)
    await card(page, "offered-150")
    await page.frame_locator("#show8").get_by_role("button", name=re.compile(r"^Book \$160")).wait_for(timeout=30000)
    await card(page, "needs-160")
    await tap(page, r"^Book \$160")
    await page.get_by_text("Yes, plus parts.").wait_for(timeout=30000)
    await card(page, "plus-parts")
    await page.locator("#caption", has_text="one total price").wait_for(timeout=30000)
    await card(page, "one-total")
    await page.wait_for_selector(".outcome.ok", timeout=30000)
    await card(page, "booked")
    await page.locator("#transcript").screenshot(path=OUT / "transcript-joe.png")
    await page.close()


async def around(browser):
    page = await browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    await page.goto(f"{BASE}/sim")
    show = page.frame_locator("#show8")
    await show.get_by_role("button").first.wait_for()
    await tap(page, "^Get 3 quotes")
    await show.get_by_role("button", name=re.compile("^Call all three")).wait_for(timeout=15000)
    await card(page, "around-ask")
    await tap(page, "^Call all three")
    await show.get_by_text("Comparing quotes").or_(show.get_by_text("Booking the best quote")).first.wait_for(timeout=30000)
    await card(page, "around-quotes")
    await page.wait_for_selector(".outcome.ok", timeout=60000)
    await card(page, "around-booked")
    await page.close()


async def business(browser):
    call = await browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=3)
    page_html = Path(__file__).resolve().parents[2] / "web" / "call" / "index.html"
    for lang, info in (("en", {"ownerName": "Maya", "about": "Book a plumber visit to fix a leaking kitchen sink"}), ("es", {"ownerName": "Maya", "about": "Reservar una visita para arreglar el fregadero", "language": "es"})):
        await call.route("**/call/demo/info", lambda route, request, info=info: route.fulfill(json=info))
        await call.route("**/call/demo/events", lambda route: route.fulfill(status=204, body=""))
        await call.route("**/call/demo", lambda route: route.fulfill(path=str(page_html), content_type="text/html"))
        await call.goto(f"{BASE}/call/demo")
        await asyncio.sleep(0.9)
        await call.screenshot(path=OUT / f"business-ringing-{lang}.png")
        await call.unroute("**/call/demo/info")
        print("saved business", lang)
    await call.close()


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        flow = sys.argv[2] if len(sys.argv) > 2 else "all"
        if flow in ("all", "joe"):
            await joe(browser)
        if flow in ("all", "around"):
            await around(browser)
        if flow in ("all", "business"):
            await business(browser)
        await browser.close()


asyncio.run(main())
