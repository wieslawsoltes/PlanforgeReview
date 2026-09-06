# Third-party notices and references

The downloadable source contains original application code, original interface icons, and generated fictional sample drawings. It does not bundle dependency packages or stand-alone font files. Runtime dependencies are installed separately. Preserve their own license notices when building a distribution.

| Dependency | Purpose | Upstream license / official reference |
|---|---|---|
| Mozilla PDF.js (`pdfjs-dist`, pinned 5.4.624) | Browser PDF parser, worker, rasterization, CMaps, standard-font data | Apache-2.0; https://mozilla.github.io/pdf.js/ and https://mozilla.github.io/pdf.js/examples/ |
| PDF-LIB (pinned 1.17.1) | Browser flattened vector review-PDF export | MIT; https://pdf-lib.js.org/ |
| PyMuPDF / MuPDF (optional backend) | Local parsing, tile rendering, native annotation export | AGPL / commercial alternatives; https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright |
| ReportLab (optional development dependency) | Regenerate original sample PDFs | BSD-style; https://www.reportlab.com/opensource/ |
| Playwright (optional test dependency) | Browser interaction tests | Apache-2.0; https://playwright.dev/python/ |

The optional MuPDF/PyMuPDF dependency's licensing is materially different from the browser-only dependencies. The application's MIT license does not waive or replace any dependency's obligations. Review the applicable upstream license and intended deployment/distribution model before adopting the Python backend commercially.

Other engineering references:

- WebGPU specification: https://www.w3.org/TR/webgpu/
- WGSL specification: https://www.w3.org/TR/WGSL/
- MuPDF page transforms and annotation methods: https://pymupdf.readthedocs.io/en/latest/page.html
- MuPDF PDF coordinate examples: https://pymupdf.readthedocs.io/en/latest/app3.html

Bluebeam and Revu are referenced only to describe the requested class of workflow. No Bluebeam source, product artwork, proprietary format implementation, or endorsement is included. “Planforge Review” is an original working title, not a trademark-clearance opinion.
