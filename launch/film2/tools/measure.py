import asyncio
import json
import sys
from pathlib import Path

from playwright.async_api import async_playwright

PAGE = (Path(__file__).resolve().parents[1] / "index.html").as_uri()


async def main(t, selectors):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1920, "height": 1080})
        await page.goto(PAGE)
        await page.wait_for_timeout(3000)
        await page.evaluate("document.fonts.ready")
        boxes = await page.evaluate(
            """([t, sels]) => { window.__timelines.main.seek(t, false);
            return sels.map(s => { const g = document.createRange(); g.selectNodeContents(document.querySelector(s)); const r = g.getBoundingClientRect();
            return [s, Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2), Math.round(r.width), Math.round(r.height)]; }); }""",
            [t, selectors],
        )
        print(json.dumps(boxes))
        await browser.close()


asyncio.run(main(float(sys.argv[1]), sys.argv[2:]))
