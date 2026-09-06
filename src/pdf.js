import { transform, inverse, multiply } from './geometry.js';
const VERSION = '5.4.624';
let libraryPromise;
export async function pdfLibrary() {
    if (!libraryPromise)
        libraryPromise = (async () => {
            let pdfjs, root;
            try {
                pdfjs = await import('../node_modules/pdfjs-dist/build/pdf.mjs');
                root = new URL('../node_modules/pdfjs-dist/', import.meta.url).href;
            }
            catch {
                root = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSION}/`;
                pdfjs = await import(root + 'build/pdf.mjs');
            }
            pdfjs.GlobalWorkerOptions.workerSrc = root + 'build/pdf.worker.mjs';
            return { pdfjs, root };
        })();
    return libraryPromise;
}
export function makeViewport(meta, scale = 1, rotation = 0) {
    let m = meta.transform.slice(), w = meta.width, h = meta.height;
    for (let n = 0; n < ((rotation % 360 + 360) % 360) / 90; n++) {
        m = multiply([0, 1, -1, 0, h, 0], m);
        [w, h] = [h, w];
    }
    m = m.map(v => v * scale);
    const inv = inverse(m);
    return { width: w * scale, height: h * scale, transform: m, convertToViewportPoint: (x, y) => transform(m, [x, y]), convertToPdfPoint: (x, y) => transform(inv, [x, y]) };
}
export class PdfSource {
    static async open(bytes, name, passwordPrompt = async () => null) {
        const self = new PdfSource();
        self.bytes = new Uint8Array(bytes).slice();
        self.name = name;
        self.key = crypto.randomUUID();
        self.pages = new Map();
        let local = false;
        if (document.documentElement.dataset.pdfBackend !== 'pdfjs' && new URLSearchParams(location.search).get('backend') !== 'pdfjs') {
            try {
                const res = await fetch('/api/health', { signal: AbortSignal.timeout(1200) });
                local = res.ok && (await res.json()).backend === 'mupdf';
            }
            catch { }
        }
        if (local) {
            let res = await fetch('/api/docs', { method: 'POST', body: self.bytes });
            if (res.status === 401) {
                const password = await passwordPrompt();
                if (password === null)
                    throw Error('Password entry cancelled');
                res = await fetch('/api/docs', { method: 'POST', body: self.bytes, headers: { 'X-PDF-Password': password } });
            }
            const info = await res.json();
            if (!res.ok)
                throw Error(info.error || 'Incorrect PDF password');
            self.backend = 'MuPDF';
            self.serverID = info.id;
            self.meta = info.pages;
        }
        else {
            const { pdfjs, root } = await pdfLibrary();
            self.backend = `PDF.js ${pdfjs.version}`;
            self.loading = pdfjs.getDocument({ data: self.bytes.slice(), isEvalSupported: false, cMapUrl: root + 'cmaps/', cMapPacked: true, standardFontDataUrl: root + 'standard_fonts/', wasmUrl: root + 'wasm/', enableXfa: false });
            self.loading.onPassword = async (update) => { const p = await passwordPrompt(); if (p === null) {
                self.loading.destroy();
                return;
            } update(p); };
            self.doc = await self.loading.promise;
            self.meta = [];
            if (self.doc.numPages > 3000) {
                await self.dispose();
                throw Error('Maximum 3000 pages');
            }
            // Bounded metadata fetch, avoiding thousands of simultaneous page promises.
            let labels;
            try {
                labels = await self.doc.getPageLabels();
            }
            catch { }
            for (let n = 1; n <= self.doc.numPages; n++) {
                const p = await self.doc.getPage(n), v = p.getViewport({ scale: 1 });
                self.meta.push({ width: v.width, height: v.height, transform: v.transform, rotation: p.rotate, extraRotation: 0, label: labels?.[n - 1] || String(n) });
            }
        }
        return self;
    }
    viewport(page, rotation = 0) { return makeViewport(this.meta[page - 1], 1, rotation); }
    async renderTile(page, scale, x, y, w, h, rotation = 0, signal) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, w, h);
        if (this.serverID) {
            const query = new URLSearchParams({ id: this.serverID, page, scale, x, y, w, h, rotation });
            const res = await fetch('/api/tile?' + query, { signal });
            if (!res.ok)
                throw Error('PDF tile rendering failed');
            const bitmap = await createImageBitmap(await res.blob());
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
        }
        else {
            if (signal?.aborted)
                throw new DOMException('Cancelled', 'AbortError');
            const p = await this.doc.getPage(page), viewport = p.getViewport({ scale, rotation: p.rotate + rotation });
            const task = p.render({ canvasContext: ctx, canvas, viewport, transform: [1, 0, 0, 1, -x, -y], background: 'white', intent: 'display' });
            const abort = () => task.cancel();
            signal?.addEventListener('abort', abort, { once: true });
            try {
                if (signal?.aborted)
                    abort();
                await task.promise;
            }
            finally {
                signal?.removeEventListener('abort', abort);
            }
        }
        return canvas;
    }
    async thumbnail(page, max = 220, rotation = 0) { const v = this.viewport(page, rotation), s = Math.min(max / v.width, max / v.height); return this.renderTile(page, s, 0, 0, Math.ceil(v.width * s), Math.ceil(v.height * s), rotation); }
    async dispose() { this.disposed = true; if (this.serverID)
        await fetch('/api/docs?id=' + this.serverID, { method: 'DELETE' }).catch(() => { }); if (this.loading)
        await this.loading.destroy(); this.pages.clear(); }
}
