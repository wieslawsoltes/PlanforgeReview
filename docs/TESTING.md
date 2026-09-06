# Verification and reproduction

## Automated deployment checks

The Pages workflow executes the following checks against the committed source. A workflow definition is not proof of a passing run: consult the run conclusion and its `verification-and-lock` artifact for actual results.

| Suite | Command | Coverage |
|---|---|---|
| Core | `npm test` | 26 tests for transforms, native coordinates, calibrated quantities, simple polygons, spatial index, history, schema, reports and archives. |
| Static artifact | `npm run build && npm run test:pages` | 3 tests for repository-relative URLs, browser-only mode, matching PDF worker and packaged dependencies/assets. |
| PDF backend | `python -m unittest discover -s tests -p backend_test.py` | 8 methods, including 16 combinations of crop, rotation and UserUnit; real raster pixels and exported annotation identities/positions. |
| HTTP | `python -m unittest discover -s tests -p http_smoke.py` | Actual loopback requests against Node and Python servers. |
| Static browser | `python tests/pages_browser.py` | Real Chromium HTTP page, PDF.js worker, calibrated sample quantities, pointer-driven count, undo/redo, real IndexedDB reload, navigation, PDF-LIB download, archive/CSV and revision PDF overlay. |

The static browser test serves `dist/` under `/PlanforgeReview/`, blocks external origins and fails on PDF API requests, HTTP asset errors or unhandled page exceptions. It uses Canvas 2D explicitly. It does not mock PDF parsing, storage or download operations. Generated PDFs are reopened by MuPDF, and archive contents/lengths are checked.

## Run browser verification

```sh
npm install
npm run build
python -m pip install -r requirements.txt playwright
python -m playwright install chromium
python tests/pages_browser.py
```

To test a published site in a fresh isolated browser context:

```sh
python tests/pages_browser.py --url https://wieslawsoltes.github.io/PlanforgeReview/
```

Results, screenshots and downloads go to `test-results/pages/`. Chromium browser automation requires its installed browser and system libraries. Linux CI installs them through `python -m playwright install --with-deps chromium`.

## Original interactive test harness

`tests/browser_smoke.py` retains the original broader drawing interaction test, including area drawing, vertex editing, cloud drag, callout text, locked-layer prevention and calibration. Its `--isolated` mode uses an in-process bridge to real MuPDF logic in environments that cannot perform normal local browser fetches. That mode substitutes storage and download transport and must not be described as validation of HTTP, IndexedDB or PDF.js integration. `tests/pages_browser.py` exists specifically to test the real browser-only deployment path without that bridge.

## Remaining verification limits

These tests do not establish native hardware WebGPU performance or correctness on every adapter. The WebGPU compositor and WGSL path are included, but the required browser deployment suite deliberately exercises the fallback path for deterministic hosted runners. Non-Chromium browsers, real GPU device loss, very large/hostile PDFs, long editing sessions, browser quota exhaustion and operating-system PDF reader output parity need additional coverage. Samples are fictional and quantities must be independently checked for construction use.
