import { primitives } from './markups.js';
import { inverse } from './geometry.js';
import { download } from './storage.js';
async function pdfLib() {
    if (window.PDFLib)
        return window.PDFLib;
    const load = url => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = url; s.onload = () => resolve(window.PDFLib); s.onerror = () => { s.remove(); reject(Error('PDF export library could not be loaded')); }; document.head.append(s); });
    try {
        return await load('node_modules/pdf-lib/dist/pdf-lib.min.js');
    }
    catch {
        return load('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js');
    }
}
export async function exportPDF(app) {
    const { source, project } = app;
    if (source.serverID) {
        const r = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: source.serverID, project }) });
        if (!r.ok)
            throw Error((await r.json()).error);
        download(await r.blob(), 'planforge-reviewed.pdf', 'application/pdf');
        app.toast('Review PDF exported with standard PDF annotations. Keep the project for quantity semantics.');
        return;
    }
    const L = await pdfLib(), doc = await L.PDFDocument.load(source.bytes), font = await doc.embedFont(L.StandardFonts.Helvetica);
    let replaced = false;
    const safe = s => [...String(s)].map(ch => { try {
        font.encodeText(ch);
        return ch;
    }
    catch {
        replaced = true;
        return ({ 'Ł': 'L', 'ł': 'l', '²': '2' }[ch] || ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?'));
    } }).join('');
    const color = hex => { if (!hex || hex === 'none')
        return undefined; if (hex === 'white')
        return L.rgb(1, 1, 1); return L.rgb(...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)); };
    for (const m of Object.values(project.markups)) {
        if (!project.layers[m.layer].visible)
            continue;
        const page = doc.getPage(m.page - 1), vp = source.viewport(m.page, 0), matrix = inverse(vp.transform), items = primitives(m, vp, project.pages[m.page], project.settings.unit);
        page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(...matrix), L.concatTransformationMatrix(1, 0, 0, -1, 0, 0));
        for (const p of items) {
            const opts = { color: color(p.fill), opacity: p.opacity ?? 1, borderColor: color(p.stroke), borderWidth: p.width || 0, borderOpacity: p.opacity ?? 1 };
            if (p.kind === 'path')
                page.drawSvgPath(p.d, { x: 0, y: 0, scale: 1, ...opts });
            else if (p.kind === 'rect')
                page.drawRectangle({ x: p.x, y: -p.y - p.h, width: p.w, height: p.h, ...opts });
            else if (p.kind === 'circle')
                page.drawCircle({ x: p.x, y: -p.y, size: p.r, ...opts });
            else {
                const text = safe(p.text), width = font.widthOfTextAtSize(text, p.size), x = p.x - (p.anchor === 'middle' ? width / 2 : 0);
                page.drawText(text, { x, y: -p.y, font, size: p.size, color: color(p.fill) });
            }
        }
        page.pushOperators(L.popGraphicsState());
    }
    doc.setProducer('Planforge Review · PDF-LIB');
    download(await doc.save(), 'planforge-reviewed.pdf', 'application/pdf');
    app.toast('PDF exported with flattened vector markups.' + (replaced ? ' Unsupported font characters were transliterated; the project retains original text.' : ''));
}
