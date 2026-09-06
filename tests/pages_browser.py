"""Real static-site integration test. No transport bridge, CDN or PDF API service."""
import argparse
import asyncio
import functools
import json
import struct
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import fitz
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]


async def verify(url, output):
    output.mkdir(parents=True, exist_ok=True)
    errors, external, api_requests, bad_responses = [], [], [], []
    result = {"url": url, "checks": [], "renderer": None}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = await browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        origin = urlparse(url).netloc

        async def restrict(route):
            target = urlparse(route.request.url)
            if target.scheme in ("http", "https") and target.netloc != origin:
                external.append(route.request.url)
                await route.abort()
            else:
                if target.path.startswith("/api/"):
                    api_requests.append(target.path)
                await route.continue_()

        await context.route("**/*", restrict)
        page = await context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("response", lambda response: bad_responses.append(f"{response.status} {response.url}") if response.status >= 400 else None)
        try:
            await page.goto(url + "?renderer=canvas", wait_until="networkidle")
            await page.wait_for_function("window.planforge?.source?.doc && window.planforge.tiles.cache.size > 0", timeout=60000)
            snapshot = await page.evaluate("""() => ({
                backend: planforge.source.backend, pages: planforge.source.meta.length,
                count: Object.keys(planforge.project.markups).length,
                area: document.querySelector('#total-area').textContent,
                length: document.querySelector('#total-length').textContent,
                counts: document.querySelector('#total-count').textContent,
                renderer: planforge.compositor.mode
            })""")
            assert snapshot["backend"].startswith("PDF.js "), snapshot
            assert snapshot["pages"] == 3 and snapshot["count"] == 11, snapshot
            assert snapshot["area"] == "99" and snapshot["length"] == "30.17" and snapshot["counts"] == "4", snapshot
            result["renderer"] = snapshot["renderer"]
            result["checks"].append("PDF.js parser, real worker, tiles and calibrated sample quantities")
            await page.screenshot(path=str(output / "workspace.png"), full_page=True)

            await page.locator('#drawing-tools [data-tool="count"]').click()
            point = await page.evaluate("planforge.toScreen([520,600])")
            box = await page.locator("#stage").bounding_box()
            await page.mouse.click(box["x"] + point[0], box["y"] + point[1])
            await page.wait_for_function("document.querySelector('#total-count').textContent === '5'")
            added = await page.evaluate("Object.values(planforge.project.markups).at(-1).id")
            await page.keyboard.press("Control+z")
            await page.wait_for_function("document.querySelector('#total-count').textContent === '4'")
            await page.keyboard.press("Control+Shift+z")
            await page.wait_for_function("document.querySelector('#total-count').textContent === '5'")
            result["checks"].append("Pointer-driven count placement, undo and redo")

            project_id = await page.evaluate("planforge.project.id")
            await page.evaluate("() => planforge.persist()")
            await page.reload(wait_until="networkidle")
            await page.wait_for_function("window.planforge?.project && window.planforge.tiles.cache.size > 0", timeout=60000)
            assert await page.evaluate("planforge.project.id") == project_id
            assert await page.evaluate("id => !!planforge.project.markups[id]", added)
            assert await page.locator("#total-count").text_content() == "5"
            result["checks"].append("Real IndexedDB project/asset persistence across reload")

            await page.evaluate("() => planforge.go(2)")
            await page.wait_for_function("planforge.page === 2 && planforge.tiles.cache.size > 0")
            await page.evaluate("() => planforge.action('rotate')")
            assert await page.evaluate("planforge.pg.extraRotation") == 90
            await page.evaluate("() => planforge.go(1)")
            result["checks"].append("Multipage navigation and rotated viewport")

            async with page.expect_download(timeout=60000) as info:
                await page.evaluate("() => planforge.action('exportpdf')")
            exported = await info.value
            pdf_path = output / "reviewed.pdf"
            await exported.save_as(str(pdf_path))
            with fitz.open(pdf_path) as doc:
                assert len(doc) == 3
                assert "PDF-LIB" in doc.metadata.get("producer", ""), doc.metadata
                assert len(doc[0].get_drawings()) > 0
            result["checks"].append("Same-origin PDF-LIB export creates a readable three-page PDF")

            async with page.expect_download() as info:
                await page.evaluate("() => planforge.action('save')")
            archive_path = output / "review.planforge"
            await (await info.value).save_as(str(archive_path))
            raw = archive_path.read_bytes()
            assert raw[:8] == b"PLNFRG01"
            size = struct.unpack_from("<I", raw, 8)[0]
            meta = json.loads(raw[12:12 + size])
            assert meta["project"]["id"] == project_id
            assert added in meta["project"]["markups"]
            assert len(raw) == 12 + size + meta["pdfLength"] + meta["overlayLength"]
            async with page.expect_download() as info:
                await page.evaluate("() => planforge.action('csv')")
            csv_path = output / "quantities.csv"
            await (await info.value).save_as(str(csv_path))
            assert added in csv_path.read_text(encoding="utf-8-sig")
            result["checks"].append("Binary project archive and quantity CSV downloads retain markup IDs")

            await page.evaluate("() => planforge.action('demooverlay')")
            await page.wait_for_function("planforge.overlaySource?.doc && [...planforge.tiles.cache.keys()].some(k => k.startsWith(planforge.overlaySource.key))", timeout=60000)
            await page.screenshot(path=str(output / "overlay.png"), full_page=True)
            result["checks"].append("Second real PDF and revision overlay rasterization")
            assert not errors, errors
            assert not external, external
            assert not api_requests, api_requests
            assert not bad_responses, bad_responses
            result["checks"].append("No page exceptions, failed HTTP assets, external CDN or PDF API requests")
            result["status"] = "passed"
        except Exception as exc:
            result["status"] = "failed"
            result["failure"] = str(exc)
            await page.screenshot(path=str(output / "failure.png"), full_page=True)
            raise
        finally:
            result.update(errors=errors, external_requests=external, api_requests=api_requests, bad_responses=bad_responses,
                          not_tested=["Native WebGPU hardware execution and performance", "Non-Chromium browsers"])
            (output / "results.json").write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps(result, indent=2), flush=True)
            await browser.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", help="Existing site URL, including trailing slash")
    parser.add_argument("--output", type=Path, default=ROOT / "test-results/pages")
    args = parser.parse_args()
    if args.url:
        asyncio.run(verify(args.url.rstrip("/") + "/", args.output))
        return
    with tempfile.TemporaryDirectory() as temp:
        (Path(temp) / "PlanforgeReview").symlink_to(ROOT / "dist", target_is_directory=True)
        handler = functools.partial(SimpleHTTPRequestHandler, directory=temp)
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            asyncio.run(verify(f"http://127.0.0.1:{server.server_port}/PlanforgeReview/", args.output))
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
