# Engine and data contracts

## Coordinate contract

A markup point is `[x, y]` in the native PDF user space of its page. A six-value affine matrix is `[a,b,c,d,e,f]`, with `x' = a*x + c*y + e`, `y' = b*x + d*y + f`. Each backend returns the same normalized top-left display contract:

```js
{ width, height, transform, rotation, extraRotation: 0, label }
```

`width`/`height` are physical PDF-point dimensions at scale 1, including `/UserUnit` and original page rotation. `transform` maps native PDF coordinates to this rotated display. PDF.js obtains it from `getViewport({scale:1})`. The MuPDF adapter temporarily sets page rotation to zero, reads the native transform and physical unrotated dimensions, composes an explicit quarter-turn, then restores the page rotation. This avoids a tested discrepancy in the rotated MuPDF transformation matrix for cropped/UserUnit pages.

`makeViewport(meta, scale, extraRotation)` composes extra rotation and uniform scale, then computes the inverse. Pointer coordinates go CSS pixel -> camera inverse -> normalized page -> inverse viewport -> native PDF. Reporting never references the camera or raster resolution. The browser SVG display operates in normalized page space with an outer camera transform.

Calibration stores `metersPerUnit`, meaning meters in the building per native PDF coordinate unit. Two-point calibration is `knownMeters / hypot(dx,dy)`. Nominal 1:N calibration is `0.0254 / 72 * N * UserUnit`. Changing report units divides by meters-per-output-unit; area divides by its square. A missing calibration produces an unavailable quantity, not an assumed scale. Counts have no physical scale dependency.

Area evaluation translates vertices by the first vertex before the shoelace sum to reduce cancellation for large coordinate offsets. Simple polygon validation checks minimum area and nonadjacent-edge intersections. Complexity is O(n²); this is appropriate for ordinary takeoff polygons, not a hardened hostile-input polygon service. Polygons with holes and overlapping-area union accounting are not implemented.

## Raster and compositor pipeline

1. Invert the page/overlay affine transform to bound the visible viewport in source-page space.
2. Choose half-octave quantized tile resolution, clamped to 0.125..8 raster pixels per normalized point, including a bounded device-pixel ratio contribution.
3. Enumerate visible 512-pixel tiles and prioritize by distance from the view center. At most two tile raster jobs are active; thumbnails/previews have separate requests.
4. Cache successful tiles by source UUID, page, rotation, raster scale, and tile origin. Cancel no-longer-needed jobs and reject late results from disposed sources.
5. Draw a bounded-resolution page preview where high-resolution base tiles are not ready. For a revision layer, display either its preview or complete requested tiles, avoiding duplicate semitransparent blending.
6. Upload changed canvases to `rgba8unorm` WebGPU textures, retain an affine instance record per visible tile, and draw in one render pass. Color mode 0 is original PDF; 1 maps base ink to cyan on white; 2 maps revision ink to premultiplied magenta with a transparent background.
7. Overlay SVG markups and selection handles using the same viewport/camera. Rebuild the SVG presentation on invalidated frames, culling offscreen objects with the spatial index.

This implementation has a per-tile binding/draw call and recreates a Float32Array for each rendered frame. It is deliberately not presented as a zero-allocation or texture-array batched compositor. PDF.js clips output into a tile canvas but may still evaluate substantial page operator lists for each tile. A page texture cache does not imply bounded PDF parser memory. Tile caches are soft-budgeted, allowing currently visible tiles to remain resident.

## Semantic state and history

`project.schema = 1`. The project contains dictionaries keyed by stable identifiers: `pages`, `markups`, `layers`, `tools`, plus `settings` and `overlay`. Markups carry immutable identity, page, type, native vertices, style, layer, author, subject, comment, status, and timestamps. Geometry lives independently of SVG DOM nodes and textures.

Every ordinary committed edit creates keyed operations `{table,key,before,after}`. A drag updates preview geometry only, then commits once on pointer release. History replays forward or in reverse order and increments a monotonic project revision. Branching clears redo. Opening a document or replacing the revision file starts new history. History is in-memory and not in project archives.

Selection uses a uniform-grid broad phase with an oversized-entry path. Candidate IDs pass type-specific narrow-phase geometry tests. Layer visibility filters drawing and selection; layer locking prevents edits. Layer changes and active-layer changes can be one history transaction. Changing a page's calibration recomputes dependent quantities without mutating every markup.

Reusable tools store a relative copy of markup geometry plus its style; placement translates it to the clicked native point and creates a new UUID. Tools belong to the project, not a proprietary external tool-set format.

## Persistence and archive

IndexedDB database `planforge-review-v1` has `projects` and `assets` object stores. Project JSON and optional PDF blobs are saved in one transaction. A serialized save chain prevents out-of-order writes. A source-generation check prevents stale asset saves from setting the current generation's `assetsSaved` flag. Local storage remembers only the last project ID.

The binary `.planforge` format is:

| Offset | Encoding | Meaning |
|---|---|---|
| 0 | 8 ASCII bytes | `PLNFRG01` |
| 8 | uint32 little-endian | UTF-8 JSON header byte length |
| 12 | UTF-8 JSON | `{project,pdfLength,overlayLength}` |
| following header | bytes | Exact source PDF |
| following source | bytes | Exact revision PDF, when present |

The archive reader enforces total/header lengths and validates the semantic schema before opening PDFs. The project stores a SHA-256 fingerprint of the source PDF, checked on reopening. There is no archive encryption or cryptographic signing. Resource limits are defensive bounds, not proof of denial-of-service resistance. Undo stacks and rendered caches are intentionally not serialized.

## Reporting contract

Detailed CSV rows expose ID, page, subject, type, computed quantity, unit, calibration state, review status, layer, author, comment, and timestamps. CSV escaping includes quoting and spreadsheet-formula-prefix guarding. Grouped reports use subject+unit+layer+status as the grouping key; unlike dimensions are never summed together. Reports reflect current Markups List scope and filters. Hidden layers are included, preventing visibility changes from silently removing cost items. Unknown physical quantities are excluded and counted as uncalibrated warnings.

## Optional HTTP API

The Python service is loopback-only, keeps at most eight open documents, accepts up to 150 MiB per POST, and limits a document to 3000 pages. Its process-global lock serializes MuPDF calls. It is not a worker farm or production untrusted-document sandbox.

| Method | Endpoint | Contract |
|---|---|---|
| GET | `/api/health` | JSON `{backend:'mupdf',version}` |
| POST | `/api/docs` | Raw PDF bytes. Optional `X-PDF-Password`; 401 on password challenge. Returns `{id,pages,backend}`. |
| GET | `/api/tile` | `id,page,scale,x,y,w,h,rotation` query fields; PNG tile. Page is 1-based, x/y are raster pixel offsets, extra rotation is in degrees. |
| DELETE | `/api/docs?id=...` | Closes a server document handle. |
| POST | `/api/export` | JSON `{document,project}`; returns reviewed PDF bytes. |

Document handles are random tokens, not persistent storage IDs. The server retains original PDF bytes until disposal. Replacing files drops browser resources and closes old server handles. The service has no login, TLS termination, durable database, authorization model, or isolated parser subprocess. Do not expose it to the public internet or use it as a general remote PDF-processing API.
