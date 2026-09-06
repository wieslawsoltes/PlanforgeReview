/** All persisted geometry uses the PDF's native, unrotated user space. */
export const EPS = 1e-9;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const transform = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
export function inverse(m) {
    const d = m[0] * m[3] - m[1] * m[2];
    if (!Number.isFinite(d) || Math.abs(d) < EPS)
        throw Error('Singular coordinate transform');
    return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}
export function multiply(a, b) {
    return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
export function bounds(points, pad = 0) {
    if (!points.length)
        return { x: 0, y: 0, w: 0, h: 0 };
    let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity;
    for (const p of points) {
        x = Math.min(x, p[0]);
        y = Math.min(y, p[1]);
        r = Math.max(r, p[0]);
        b = Math.max(b, p[1]);
    }
    return { x: x - pad, y: y - pad, w: r - x + 2 * pad, h: b - y + 2 * pad };
}
export const intersects = (a, b) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
export function lineDistance(p, a, b) {
    const x = b[0] - a[0], y = b[1] - a[1], d = x * x + y * y;
    const t = d ? clamp(((p[0] - a[0]) * x + (p[1] - a[1]) * y) / d, 0, 1) : 0;
    return dist(p, [a[0] + t * x, a[1] + t * y]);
}
export const length = ps => ps.slice(1).reduce((s, p, i) => s + dist(ps[i], p), 0);
export function area(ps) {
    if (ps.length < 3)
        return 0;
    const [x, y] = ps[0];
    let s = 0;
    for (let i = 1; i < ps.length - 1; i++)
        s += (ps[i][0] - x) * (ps[i + 1][1] - y) - (ps[i + 1][0] - x) * (ps[i][1] - y);
    return Math.abs(s) / 2;
}
export function pointInPolygon(p, ps) {
    let inside = false;
    for (let i = 0, j = ps.length - 1; i < ps.length; j = i++) {
        const a = ps[i], b = ps[j];
        if (lineDistance(p, a, b) < EPS)
            return true;
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])
            inside = !inside;
    }
    return inside;
}
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export function segmentIntersects(a, b, c, d) {
    const x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b);
    if (((x > EPS && y < -EPS) || (x < -EPS && y > EPS)) && ((z > EPS && w < -EPS) || (z < -EPS && w > EPS)))
        return true;
    return Math.abs(x) < EPS && lineDistance(c, a, b) < EPS || Math.abs(y) < EPS && lineDistance(d, a, b) < EPS || Math.abs(z) < EPS && lineDistance(a, c, d) < EPS || Math.abs(w) < EPS && lineDistance(b, c, d) < EPS;
}
export function validPolygon(ps) {
    if (ps.length < 3 || area(ps) < EPS)
        return false;
    for (let i = 0; i < ps.length; i++) {
        if (dist(ps[i], ps[(i + 1) % ps.length]) < EPS)
            return false;
        for (let j = i + 1; j < ps.length; j++) {
            if (j === i + 1 || i === 0 && j === ps.length - 1)
                continue;
            if (segmentIntersects(ps[i], ps[(i + 1) % ps.length], ps[j], ps[(j + 1) % ps.length]))
                return false;
        }
    }
    return true;
}
/** A bounded uniform-grid broad phase. Oversize entries avoid unbounded cell insertion. */
export class SpatialIndex {
    constructor(cell = 96) { this.cell = cell; this.cells = new Map(); this.items = new Map(); this.large = new Set(); }
    range(b) { return [Math.floor(b.x / this.cell), Math.floor(b.y / this.cell), Math.floor((b.x + b.w) / this.cell), Math.floor((b.y + b.h) / this.cell)]; }
    insert(id, b) {
        this.items.set(id, b);
        const [x, y, r, t] = this.range(b);
        if ((r - x + 1) * (t - y + 1) > 256) {
            this.large.add(id);
            return;
        }
        for (let j = y; j <= t; j++)
            for (let i = x; i <= r; i++) {
                const k = `${i},${j}`;
                if (!this.cells.has(k))
                    this.cells.set(k, new Set());
                this.cells.get(k).add(id);
            }
    }
    query(b) {
        const ids = new Set(this.large), [x, y, r, t] = this.range(b);
        if ((r - x + 1) * (t - y + 1) > 4096)
            return [...this.items].filter(([, v]) => intersects(b, v)).map(([id]) => id);
        for (let j = y; j <= t; j++)
            for (let i = x; i <= r; i++)
                for (const id of this.cells.get(`${i},${j}`) || [])
                    ids.add(id);
        return [...ids].filter(id => intersects(b, this.items.get(id)));
    }
}
export const UNITS = { m: { label: 'm', m: 1 }, mm: { label: 'mm', m: .001 }, cm: { label: 'cm', m: .01 }, ft: { label: 'ft', m: .3048 }, in: { label: 'in', m: .0254 } };
export function measurement(markup, page, unit = 'm') {
    if (markup.type === 'count')
        return { value: 1, unit: 'ea', kind: 'count', calibrated: true };
    const kind = markup.type === 'area' ? 'area' : ['length', 'polyline'].includes(markup.type) ? 'length' : null;
    if (!kind)
        return null;
    const calibration = page?.calibration;
    if (!calibration)
        return { value: null, unit: kind === 'area' ? `${unit}²` : unit, kind, calibrated: false };
    const f = calibration.metersPerUnit / UNITS[unit].m;
    return { value: kind === 'area' ? area(markup.points) * f * f : length(markup.points) * f, unit: kind === 'area' ? `${unit}²` : unit, kind, calibrated: true };
}
export const formatQty = q => !q ? '—' : q.value === null ? 'Uncalibrated' : `${q.value.toLocaleString('en-US', { maximumFractionDigits: q.kind === 'count' ? 0 : 2 })} ${q.unit}`;
export const overlayMatrix = o => { const a = o.angle * Math.PI / 180, c = Math.cos(a) * o.scale, s = Math.sin(a) * o.scale; return [c, s, -s, c, o.dx, o.dy]; };
export function alignTwoPoints(srcA, srcB, dstA, dstB) {
    const scale = dist(dstA, dstB) / dist(srcA, srcB);
    if (!Number.isFinite(scale) || scale < .01 || scale > 100)
        throw Error('Alignment points are coincident or have an excessive scale ratio.');
    const angle = (Math.atan2(dstB[1] - dstA[1], dstB[0] - dstA[0]) - Math.atan2(srcB[1] - srcA[1], srcB[0] - srcA[0])) * 180 / Math.PI;
    const m = overlayMatrix({ dx: 0, dy: 0, angle, scale }), p = transform(m, srcA);
    return { scale, angle, dx: dstA[0] - p[0], dy: dstA[1] - p[1] };
}
