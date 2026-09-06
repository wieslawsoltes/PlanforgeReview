import { measurement, validPolygon, UNITS } from './geometry.js';
export const TYPES = ['length', 'area', 'count', 'polyline', 'cloud', 'callout', 'stamp', 'rectangle', 'text', 'pen'];
export const STATUSES = ['Open', 'In progress', 'Accepted', 'Rejected', 'Completed'];
export const uid = () => crypto.randomUUID();
export const clone = x => structuredClone(x);
export function newProject(name, pages, fingerprint = '') {
    return { schema: 1, id: uid(), name, created: new Date().toISOString(), fingerprint, revision: 0,
        pages: Object.fromEntries(pages.map((p, i) => [i + 1, { ...p, calibration: null }])), markups: {},
        layers: { review: { id: 'review', name: 'Design review', color: '#e6545b', visible: true, locked: false }, takeoff: { id: 'takeoff', name: 'Quantity takeoff', color: '#08a99d', visible: true, locked: false } },
        tools: {}, settings: { unit: 'm', author: 'Reviewer', activeLayer: 'takeoff' }, overlay: {} };
}
export function newMarkup(type, page, points, settings = {}) {
    return { id: uid(), type, page, points: clone(points), subject: { area: 'Floor finish', length: 'Linear measurement', polyline: 'Partition', count: 'Fixture', cloud: 'Revision cloud', callout: 'Review note', stamp: 'APPROVED', rectangle: 'Rectangle', text: 'Text', pen: 'Freehand' }[type] || type,
        label: '', color: type === 'area' ? '#00aa9c' : type === 'count' ? '#ca9736' : '#e6545b', fill: type === 'area' ? '#00aa9c' : 'none', opacity: 1, width: 1.5, fontSize: 11, layer: 'review', status: 'Open', author: 'Reviewer', created: new Date().toISOString(), modified: new Date().toISOString(), ...settings };
}
/** Reversible ID-addressed deltas. PDF bytes and raster data are never in history. */
export class History {
    constructor(project, onChange = () => { }, budget = 16 * 1024 * 1024) { this.project = project; this.onChange = onChange; this.budget = budget; this.undoStack = []; this.redoStack = []; this.bytes = 0; }
    op(table, key, after) {
        if (!['markups', 'pages', 'layers', 'tools', 'settings', 'overlay'].includes(table))
            throw Error('Invalid history table');
        return { table, key: String(key), before: clone(this.project[table][key]), after: clone(after) };
    }
    commit(label, ops) {
        ops = ops.filter(o => JSON.stringify(o.before) !== JSON.stringify(o.after));
        if (!ops.length)
            return;
        const c = { label, ops, bytes: JSON.stringify(ops).length * 2 };
        this.apply(c, true);
        this.undoStack.push(c);
        this.bytes += c.bytes;
        this.redoStack = [];
        while (this.undoStack.length > 1 && (this.bytes > this.budget || this.undoStack.length > 250))
            this.bytes -= this.undoStack.shift().bytes;
        this.onChange(label);
    }
    apply(c, forward) {
        for (const o of (forward ? c.ops : [...c.ops].reverse())) {
            const value = forward ? o.after : o.before;
            if (value === undefined)
                delete this.project[o.table][o.key];
            else
                this.project[o.table][o.key] = clone(value);
        }
        this.project.revision++;
    }
    undo() { const c = this.undoStack.pop(); if (c) {
        this.apply(c, false);
        this.bytes -= c.bytes;
        this.redoStack.push(c);
        this.onChange(`Undo ${c.label}`);
    } }
    redo() { const c = this.redoStack.pop(); if (c) {
        this.apply(c, true);
        this.bytes += c.bytes;
        this.undoStack.push(c);
        this.onChange(`Redo ${c.label}`);
    } }
}
export function validateProject(p) {
    if (!p || p.schema !== 1 || typeof p.id !== 'string' || !p.pages || !p.markups || !p.layers || !p.settings || !p.tools || !p.overlay)
        throw Error('Not a supported Planforge project (schema 1).');
    if (!(p.settings.unit in UNITS) || !p.layers[p.settings.activeLayer])
        throw Error('Invalid units or active layer.');
    const safeID = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
    if (!safeID(p.id) || typeof p.name !== 'string')
        throw Error('Invalid project identity');
    for (const [id, l] of Object.entries(p.layers))
        if (!safeID(id) || l.id !== id || typeof l.name !== 'string' || !/^#[\da-f]{6}$/i.test(l.color) || typeof l.visible !== 'boolean' || typeof l.locked !== 'boolean')
            throw Error('Invalid layer');
    for (const [n, pg] of Object.entries(p.pages))
        if (!/^\d+$/.test(n) || +n < 1 || +n > 3000 || ![0, 90, 180, 270].includes(pg.extraRotation || 0))
            throw Error('Invalid page');
    for (let n = 1; n <= Object.keys(p.pages).length; n++)
        if (!p.pages[n])
            throw Error('Noncontiguous page metadata');
    for (const [id, t] of Object.entries(p.tools)) {
        if (!safeID(id) || t.id !== id || typeof t.name !== 'string' || !TYPES.includes(t.type) || !Array.isArray(t.points) || !t.style)
            throw Error('Invalid reusable tool');
        const candidate = { ...t.style, id, type: t.type, page: 1, points: t.points, layer: p.settings.activeLayer };
        const check = { ...p, tools: {}, markups: { [id]: candidate } };
        validateProject(check);
    }
    for (const table of ['pages', 'markups', 'layers', 'tools', 'settings', 'overlay'])
        for (const k of Object.keys(p[table]))
            if (['__proto__', 'prototype', 'constructor'].includes(k))
                throw Error('Unsafe project key');
    if (Object.keys(p.markups).length > 100000)
        throw Error('Project exceeds the 100,000 markup import limit.');
    for (const [id, m] of Object.entries(p.markups)) {
        if (!safeID(id) || m.id !== id || !TYPES.includes(m.type) || !p.pages[m.page] || !p.layers[m.layer] || !Array.isArray(m.points) || m.points.length < 1 || m.points.length > 100000 || m.points.some(pt => !Array.isArray(pt) || pt.length !== 2 || pt.some(v => !Number.isFinite(v) || Math.abs(v) > 1e9)))
            throw Error(`Invalid markup ${id}`);
        if (['length', 'cloud', 'callout', 'rectangle', 'polyline'].includes(m.type) && m.points.length < 2)
            throw Error(`Incomplete markup ${id}`);
        if (m.type === 'area' && !validPolygon(m.points))
            throw Error(`Invalid polygon ${id}`);
        if (!/^#[\da-f]{6}$/i.test(m.color) || !(m.fill === 'none' || /^#[\da-f]{6}$/i.test(m.fill)))
            throw Error('Invalid color');
        if (!Number.isFinite(m.width) || m.width < .1 || m.width > 100 || !Number.isFinite(m.opacity) || m.opacity < 0 || m.opacity > 1 || !Number.isFinite(m.fontSize) || m.fontSize < 1 || m.fontSize > 300)
            throw Error('Invalid markup appearance');
        if (!STATUSES.includes(m.status) || typeof m.subject !== 'string' || typeof m.label !== 'string')
            throw Error('Invalid markup metadata');
    }
    for (const pg of Object.values(p.pages))
        if (pg.calibration && (!Number.isFinite(pg.calibration.metersPerUnit) || pg.calibration.metersPerUnit <= 0))
            throw Error('Invalid calibration');
    const o = p.overlay.config;
    if (o && (!['dx', 'dy', 'angle', 'scale', 'opacity'].every(k => Number.isFinite(o[k])) || o.scale < .01 || o.scale > 100 || o.opacity < 0 || o.opacity > 1))
        throw Error('Invalid overlay transform');
    return p;
}
export function reportRows(p, filter = () => true) {
    return Object.values(p.markups).filter(filter).map(m => {
        const q = measurement(m, p.pages[m.page], p.settings.unit);
        return { id: m.id, page: m.page, subject: m.subject, type: m.type, quantity: q?.value ?? '', unit: q?.unit ?? '', calibrated: q?.calibrated ?? '', status: m.status, layer: p.layers[m.layer]?.name || '', author: m.author, label: m.label, created: m.created, modified: m.modified };
    });
}
export function csv(rows) {
    if (!rows.length)
        return '';
    const keys = Object.keys(rows[0]);
    const cell = v => { let s = String(v ?? ''); if (/^[=+@\-\t\r]/.test(s))
        s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
    return '\ufeff' + [keys, ...rows.map(r => keys.map(k => r[k]))].map(r => r.map(cell).join(',')).join('\r\n');
}
export function summarize(rows) {
    const groups = new Map();
    for (const r of rows) {
        if (r.quantity === '' || !r.unit)
            continue;
        const key = JSON.stringify([r.subject, r.unit, r.layer, r.status]);
        let g = groups.get(key);
        if (!g) {
            g = { subject: r.subject, unit: r.unit, layer: r.layer, status: r.status, quantity: 0, markups: 0 };
            groups.set(key, g);
        }
        g.quantity += r.quantity;
        g.markups++;
    }
    return [...groups.values()];
}
