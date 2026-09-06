import { bounds, dist, lineDistance, pointInPolygon, measurement, formatQty } from './geometry.js';
export const escapeHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function cloudPath(a, b) {
    const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
    let d = `M ${x} ${y}`;
    const edges = [[[x, y], [x + w, y], [0, -1]], [[x + w, y], [x + w, y + h], [1, 0]], [[x + w, y + h], [x, y + h], [0, 1]], [[x, y + h], [x, y], [-1, 0]]];
    for (const [s, e, n] of edges) {
        const len = dist(s, e), count = Math.max(1, Math.ceil(len / 14)), step = len / count;
        for (let i = 0; i < count; i++) {
            const t = (i + .5) / count, u = (i + 1) / count;
            d += ` Q ${s[0] + (e[0] - s[0]) * t + n[0] * step * .6} ${s[1] + (e[1] - s[1]) * t + n[1] * step * .6} ${s[0] + (e[0] - s[0]) * u} ${s[1] + (e[1] - s[1]) * u}`;
        }
    }
    return d + ' Z';
}
const path = (p, close = false) => p.map((v, i) => `${i ? 'L' : 'M'} ${v[0]} ${v[1]}`).join(' ') + (close ? ' Z' : '');
function lines(text, max = 27) { const result = []; for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
        if ((line + ' ' + word).length > max && line) {
            result.push(line);
            line = '';
        }
        line += (line ? ' ' : '') + word;
    }
    result.push(line);
} return result.slice(0, 12); }
/** Shared vector display list. SVG editor and browser PDF export consume the same primitives. */
export function primitives(m, vp, page, unit = 'm') {
    const p = m.points.map(v => vp.convertToViewportPoint(...v)), b = bounds(p), out = [], q = measurement(m, page, unit), label = m.label || m.subject;
    if (['cloud', 'rectangle', 'callout'].includes(m.type) && p.length < 2)
        return out;
    const pushPath = (d, fill = 'none', opacity = m.opacity) => out.push({ kind: 'path', d, stroke: m.color, width: m.width, fill, opacity });
    const text = (x, y, s, opts = {}) => out.push({ kind: 'text', x, y, text: s, size: m.fontSize, fill: m.color, ...opts });
    if (['length', 'polyline', 'pen', 'area'].includes(m.type)) {
        pushPath(path(p, m.type === 'area'), m.type === 'area' ? m.color : 'none', m.type === 'area' ? .22 * m.opacity : m.opacity);
        if (m.type === 'area')
            pushPath(path(p, true));
        if (m.type === 'length' && p.length > 1) {
            const a = p[0], b = p[1], len = dist(a, b) || 1, n = [-(b[1] - a[1]) / len * 5, (b[0] - a[0]) / len * 5];
            for (const t of p)
                pushPath(`M ${t[0] - n[0]} ${t[1] - n[1]} L ${t[0] + n[0]} ${t[1] + n[1]}`);
        }
        if (q) {
            const at = m.type === 'area' ? p.reduce((a, v) => [a[0] + v[0] / p.length, a[1] + v[1] / p.length], [0, 0]) : [(p[0][0] + p.at(-1)[0]) / 2, (p[0][1] + p.at(-1)[1]) / 2 - 8];
            text(at[0], at[1], formatQty(q), { anchor: 'middle', badge: true, size: 11 });
        }
    }
    else if (m.type === 'rectangle')
        pushPath(`M ${b.x} ${b.y} h ${b.w} v ${b.h} h ${-b.w} Z`, m.fill);
    else if (m.type === 'cloud')
        pushPath(cloudPath(p[0], p[1]));
    else if (m.type === 'count') {
        out.push({ kind: 'circle', x: p[0][0], y: p[0][1], r: 7, fill: m.color, stroke: 'white', width: 1.2, opacity: m.opacity });
        text(p[0][0], p[0][1] + 3.3, '1', { fill: 'white', size: 10, anchor: 'middle' });
    }
    else if (m.type === 'callout') {
        const a = p[0], z = p[1], theta = Math.atan2(z[1] - a[1], z[0] - a[0]), tip1 = [a[0] + 8 * Math.cos(theta + .4), a[1] + 8 * Math.sin(theta + .4)], tip2 = [a[0] + 8 * Math.cos(theta - .4), a[1] + 8 * Math.sin(theta - .4)];
        pushPath(path([a, z]));
        pushPath(path([tip1, a, tip2]));
        const ls = lines(label), width = Math.max(...ls.map(s => s.length), 6) * m.fontSize * .56 + 16, height = ls.length * m.fontSize * 1.3 + 14;
        out.push({ kind: 'rect', x: z[0], y: z[1] - m.fontSize - 7, w: width, h: height, fill: '#fffaf2', stroke: m.color, width: m.width, opacity: m.opacity });
        ls.forEach((s, i) => text(z[0] + 8, z[1] + i * m.fontSize * 1.3, s));
    }
    else if (m.type === 'stamp') {
        const w = Math.max(110, label.length * m.fontSize * .68 + 20), h = m.fontSize + 20;
        out.push({ kind: 'rect', x: p[0][0], y: p[0][1] - m.fontSize - 8, w, h, fill: 'none', stroke: m.color, width: 2, opacity: m.opacity });
        text(p[0][0] + w / 2, p[0][1] + 1, label, { size: m.fontSize, weight: 800, anchor: 'middle' });
    }
    else if (m.type === 'text')
        lines(label).forEach((s, i) => text(p[0][0], p[0][1] + i * m.fontSize * 1.3, s));
    return out;
}
export function markupBounds(m, vp) {
    const p = m.points.map(v => vp.convertToViewportPoint(...v)), b = bounds(p, 12);
    if (['callout', 'text', 'stamp'].includes(m.type)) {
        const last = p.at(-1), text = m.label || m.subject;
        const w = Math.min(440, Math.max(140, text.length * m.fontSize * .6));
        b.w = Math.max(b.x + b.w, last[0] + w) - b.x;
        b.h = Math.max(b.y + b.h, last[1] + 70) - b.y;
    }
    return b;
}
export function hitMarkup(m, vp, p, tolerance) {
    const ps = m.points.map(v => vp.convertToViewportPoint(...v));
    if (['callout', 'text', 'stamp'].includes(m.type)) {
        const b = markupBounds(m, vp);
        return p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
    }
    if (m.type === 'count')
        return dist(p, ps[0]) < 7 + tolerance;
    if (['cloud', 'rectangle'].includes(m.type)) {
        const b = bounds(ps);
        return p[0] >= b.x - tolerance && p[0] <= b.x + b.w + tolerance && p[1] >= b.y - tolerance && p[1] <= b.y + b.h + tolerance;
    }
    if (m.type === 'area' && pointInPolygon(p, ps))
        return true;
    for (let i = 1; i < ps.length; i++)
        if (lineDistance(p, ps[i - 1], ps[i]) < tolerance + m.width / 2)
            return true;
    return false;
}
export function svgPrimitives(items) {
    return items.map(p => {
        const common = `opacity="${p.opacity ?? 1}"`;
        if (p.kind === 'path')
            return `<path d="${p.d}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.width}" stroke-linejoin="round" stroke-linecap="round" ${common}/>`;
        if (p.kind === 'rect')
            return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="1" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.width}" ${common}/>`;
        if (p.kind === 'circle')
            return `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.width}" ${common}/>`;
        return `<text x="${p.x}" y="${p.y}" fill="${p.fill}" font-family="Arial, sans-serif" font-size="${p.size}" font-weight="${p.weight || 600}" text-anchor="${p.anchor || 'start'}" ${p.badge ? 'stroke="white" stroke-width="4" stroke-linejoin="round" paint-order="stroke"' : ''}>${escapeHTML(p.text)}</text>`;
    }).join('');
}
