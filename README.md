# Planforge Review

**[Open the application](https://wieslawsoltes.github.io/PlanforgeReview/)** · [Deployment workflow](https://github.com/wieslawsoltes/PlanforgeReview/actions/workflows/pages.yml)

Local-first PDF drawing review, editable vector markups, and calibrated construction quantity takeoff. Plain HTML, CSS, and JavaScript modules; a real PDF.js parser/worker; tiled WebGPU compositing with Canvas 2D fallback. The optional MuPDF service remains available for local use.

This is an original implementation, not Bluebeam software, a feature-complete Revu replacement, or a construction-certified quantity system. The sample drawings are fictional and **NOT FOR CONSTRUCTION**.

## Run locally

Node.js 22 or newer:

```sh
npm install
npm start
```

Open `http://localhost:8080`. The three-sheet Riverside sample loads automatically. `server.mjs` is a static server; the application and PDF processing run in your browser. Do not open `index.html` through a `file:` URL.

```sh
npm test
npm run build
npm run test:pages
```

`npm run build` creates `dist/` with the parser, matching PDF worker, CMaps, font data, WASM assets, PDF exporter and sample PDFs served from the same origin. No bundler is required. The build forces browser-only PDF processing and uses relative paths, including under `/PlanforgeReview/`. Direct dependencies are pinned; CI uploads its generated dependency lock as verification evidence when no lockfile is checked in.

### GitHub Pages

`.github/workflows/pages.yml` builds and tests pushes to `main`, then publishes the `dist/` artifact to GitHub Pages. Pull requests run the build and checks without deployment. The workflow runs geometry tests, static artifact checks, real MuPDF/HTTP tests, and a real Chromium test of the browser-only build under the repository subpath. Screenshots, downloaded exports and a machine-readable test result are retained in its `verification-and-lock` artifact.

The public application uses PDF.js and PDF-LIB locally in the browser. It does not run the Python service or send opened documents to a PDF processing server. Browser storage belongs to the current browser profile and origin; export archives for backups.

### Optional local MuPDF backend

```sh
python -m venv .venv
# Activate the virtual environment for your platform.
python -m pip install -r requirements.txt
python server.py --port 8080
```

This loopback-only service handles parsing, raster tiles and standard PDF annotation export; the editor remains JavaScript. No npm installation is needed for that mode. It is not an authenticated, multi-tenant server and must not be exposed publicly. PyMuPDF/MuPDF use separate AGPL/commercial licensing; see [third-party notices](THIRD_PARTY_NOTICES.md).

Use `?backend=pdfjs` to force browser parsing in local development; `?renderer=canvas` forces the fallback compositor.

## Working features

| Area | Operations |
|---|---|
| PDF workspace | Real multipage documents, labels, lazy thumbnails, pan, cursor-anchored zoom, fit, rotated views and password challenge. |
| Takeoff | Two-point calibration, nominal scales, metric/imperial units, length, polyline, simple polygon area and individual counts. |
| Markups | Clouds, callouts, stamps, text, rectangles and freehand paths; selection, multiselection, move, vertex editing, duplicate, copy/paste and delete. |
| Review | Persistent UUIDs, subjects, comments, author and status, appearance properties, visible/locked layers and reusable tools. |
| Revisions | A second real PDF, cyan/magenta overlay, opacity, page mapping, translation/rotation/scale and two-point-pair registration. |
| Reports | Filterable/sortable Markups List, compatible grouped totals, detailed/grouped CSV and structured JSON. |
| Persistence | IndexedDB autosave, recent projects, reversible ID-addressed history and portable binary `.planforge` archives. |
| Export | Reviewed PDF, quantity reports, editable project archives and SVG snapshots with raster PDF content plus vector markups. |

The sample starts with quantities computed from geometry: **99 m²**, **30.166666… m**, and **4 counts**. Imported drawings start uncalibrated. Set each sheet's scale from a known dimension before measuring.

The `.planforge` archive is the authoritative editable format. Browser review-PDF export flattens vector markups; the optional MuPDF exporter creates standard PDF annotations with primary UUIDs and review metadata. Neither reproduces the editor appearance perfectly or embeds native PDF measurement dictionaries. Comparison overlays are not included in review-PDF export.

## Engine contracts

Native PDF coordinates are authoritative, including cropped and rotated pages and `/UserUnit`. View matrices are explicit and invertible. Quantities never depend on screen pixels. Visible raster tiles are scheduled at quantized resolutions, stale jobs are cancelled, and CPU/GPU caches have separate budgets. WebGPU composites PDF tiles; SVG renders editable vectors and handles. It is not a fully GPU-resident vector renderer.

See [architecture](docs/ARCHITECTURE.md) and [testing](docs/TESTING.md) for resource budgets, persistence format, API contracts and verification limits.

## Scope boundaries

No OCR, editable import of third-party PDF annotations, snapping to PDF source linework, polygon holes, multiple scale regions per sheet, digital signatures, Studio-style collaboration, proprietary Bluebeam formats, or full Revu parity. Existing PDF content and annotations are rendered, not converted into editable Planforge markups. One uniform scale applies per page. Hidden layers remain in quantity reports. Overlapping areas are not unioned automatically.

Native hardware WebGPU performance, broad browser/device compatibility, accessibility conformance, hostile-document isolation and reader-to-reader PDF export parity are not certified by the included tests. Keep archive backups and independently check quantities before construction use.

## Source layout

```text
index.html / style.css       Workspace layout
src/app.js                  Editor and interaction state machine
src/pdf.js                  PDF adapters and normalized viewport transforms
src/tiles.js                Visible-tile scheduler and CPU cache
src/compositor.js           WebGPU / Canvas compositor
src/geometry.js             Geometry, calibration and spatial index
src/model.js                Project schema, validation, history and reporting
src/markups.js              Shared vector display list, SVG and hit testing
src/storage.js              IndexedDB and portable binary archives
src/export.js               PDF export adapters
src/icons.js                Original SVG icons
server.mjs / server.py       Static server / optional loopback PDF service
assets/                     Original sample PDFs and generator
scripts/build.mjs           Self-contained static distribution
tests/                     Core, backend, HTTP and browser checks
.github/workflows/pages.yml Build, verification and Pages deployment
```

Original application code: MIT. Dependency licenses remain separate.
