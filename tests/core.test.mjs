import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../src/geometry.js';
import { newProject, newMarkup, History, validateProject, reportRows, csv, summarize, clone } from '../src/model.js';
import { makeViewport } from '../src/pdf.js';
import { archive, readArchive } from '../src/storage.js';
import { primitives, svgPrimitives } from '../src/markups.js';
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const project = () => newProject('test.pdf', [{ width: 600, height: 800, transform: [1, 0, 0, -1, 30, 820], extraRotation: 0 }]);
const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
test('affine composition and inverse preserve native coordinates', () => { const m = [0, 2, -2, 0, 235, 891], p = [77, -45]; const v = G.transform(m, p), back = G.transform(G.inverse(m), v); near(back[0], p[0]); near(back[1], p[1]); assert.deepEqual(G.multiply(m, G.inverse(m)), [1, 0, 0, 1, 0, 0]); });
test('singular transforms are rejected', () => assert.throws(() => G.inverse([0, 0, 0, 0, 0, 0])));
test('viewport conversion is invariant across all quarter rotations and user units', () => { const meta = { width: 600, height: 800, transform: [2, 0, 0, -2, -20, 1640] }; for (const r of [0, 90, 180, 270])
    for (const z of [.1, 1, 8]) {
        const v = makeViewport(meta, z, r), p = [132, 457], s = v.convertToViewportPoint(...p), q = v.convertToPdfPoint(...s);
        near(p[0], q[0]);
        near(p[1], q[1]);
        near(v.width, r % 180 ? 800 * z : 600 * z);
    } });
test('length uses every polyline segment', () => near(G.length([[0, 0], [3, 4], [6, 8]]), 10));
test('area translation mitigates cancellation and handles either winding', () => { near(G.area(square), 100); near(G.area([...square].reverse()), 100); near(G.area(square.map(p => p.map(v => v + 1e8))), 100); });
test('concave simple area is accepted', () => assert.equal(G.validPolygon([[0, 0], [10, 0], [10, 10], [5, 5], [0, 10]]), true));
test('self crossing, degenerate and repeated polygon edges rejected', () => { for (const ps of [[[0, 0], [10, 10], [0, 10], [10, 0]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [10, 0], [10, 0], [0, 10]]])
    assert.equal(G.validPolygon(ps), false); });
test('polygon boundary is included in hit tests', () => { assert.equal(G.pointInPolygon([0, 5], square), true); assert.equal(G.pointInPolygon([5, 5], square), true); assert.equal(G.pointInPolygon([11, 5], square), false); });
test('spatial broad phase returns only overlapping bounds including large entries', () => { const i = new G.SpatialIndex(10); i.insert('a', { x: 0, y: 0, w: 5, h: 5 }); i.insert('b', { x: 100, y: 100, w: 9, h: 9 }); i.insert('large', { x: -1000, y: -1000, w: 2000, h: 2000 }); assert.deepEqual(i.query({ x: 1, y: 1, w: 1, h: 1 }).sort(), ['a', 'large']); });
test('calibration distinguishes linear and squared physical units', () => { const pg = { calibration: { metersPerUnit: .1 } }; const a = newMarkup('area', 1, square), l = newMarkup('length', 1, [[0, 0], [10, 0]]); near(G.measurement(a, pg, 'm').value, 1); near(G.measurement(l, pg, 'm').value, 1); near(G.measurement(l, pg, 'ft').value, 1 / .3048); near(G.measurement(a, pg, 'ft').value, 1 / (.3048 * .3048)); });
test('uncalibrated measurements never imply physical quantities', () => assert.equal(G.measurement(newMarkup('length', 1, [[0, 0], [10, 0]]), {}, 'm').value, null));
test('counts do not depend on calibration', () => assert.equal(G.measurement(newMarkup('count', 1, [[1, 1]]), {}, 'm').value, 1));
test('two-point registration reconstructs similarity transform', () => { const expected = { dx: 30, dy: -25, scale: 1.3, angle: 31 }, m = G.overlayMatrix(expected), a = [10, 12], b = [100, 20], actual = G.alignTwoPoints(a, b, G.transform(m, a), G.transform(m, b)); for (const k of Object.keys(expected))
    near(actual[k], expected[k]); });
test('registration rejects coincident control points', () => assert.throws(() => G.alignTwoPoints([0, 0], [0, 0], [1, 2], [3, 4])));
test('history restores IDs and exact geometry', () => { const p = project(), h = new History(p), m = newMarkup('length', 1, [[1, 2], [3, 4]]); h.commit('add', [h.op('markups', m.id, m)]); h.commit('edit', [h.op('markups', m.id, { ...m, points: [[4, 5], [8, 9]] })]); h.undo(); assert.deepEqual(p.markups[m.id], m); h.undo(); assert.equal(p.markups[m.id], undefined); h.redo(); assert.deepEqual(p.markups[m.id], m); });
test('history branching invalidates redo and never includes PDF bytes', () => { const p = project(), h = new History(p); h.commit('units', [h.op('settings', 'unit', 'ft')]); h.undo(); h.commit('author', [h.op('settings', 'author', 'A')]); assert.equal(h.redoStack.length, 0); assert.ok(!JSON.stringify(h.undoStack).includes('pdfLength')); });
test('one transaction can create a layer and change active layer atomically', () => { const p = project(), h = new History(p), l = { id: 'x', name: 'X', color: '#123456', visible: true, locked: false }; h.commit('layer', [h.op('layers', 'x', l), h.op('settings', 'activeLayer', 'x')]); h.undo(); assert.equal(p.layers.x, undefined); assert.equal(p.settings.activeLayer, 'takeoff'); h.redo(); assert.equal(p.layers.x.id, 'x'); });
test('history budget trims oldest transactions', () => { const p = project(), h = new History(p, () => { }, 1024); for (let i = 0; i < 100; i++)
    h.commit('name', [h.op('settings', 'author', 'name ' + i)]); assert.ok(h.bytes < 1100); assert.ok(h.undoStack.length < 100); });
test('import validation rejects corrupt geometry, colors and unsafe identities', () => { for (const patch of [{ points: [[NaN, 0]] }, { color: '" onload="alert(1)' }, { id: '"><img>' }]) {
    const p = project(), m = newMarkup('count', 1, [[1, 1]]);
    p.markups[m.id] = { ...m, ...patch };
    assert.throws(() => validateProject(p));
} });
test('reusable tools are independently validated', () => { const p = project(), m = newMarkup('count', 1, [[0, 0]]); p.tools.t = { id: 't', name: 'Count', type: 'count', points: [[0, 0]], style: m }; validateProject(p); p.tools.t.style.color = 'red;injected'; assert.throws(() => validateProject(p)); });
test('CSV escapes delimiters, quotes, line breaks and formula injection', () => { const s = csv([{ a: '=1+1', b: 'x,"z"\ny' }]); assert.ok(s.includes('"\'=1+1"')); assert.ok(s.includes('"x,""z""\ny"')); assert.equal(s[0], '\ufeff'); });
test('summary never combines units, layers, or review statuses', () => { const rows = [{ subject: 'Wall', unit: 'm', layer: 'A', status: 'Open', quantity: 3 }, { subject: 'Wall', unit: 'm', layer: 'A', status: 'Open', quantity: 4 }, { subject: 'Wall', unit: 'm²', layer: 'A', status: 'Open', quantity: 9 }, { subject: 'Wall', unit: 'm', layer: 'A', status: 'Accepted', quantity: 2 }]; const s = summarize(rows); assert.equal(s.length, 3); near(s[0].quantity, 7); });
test('archival binary roundtrip preserves PDF bytes and exact markup identity', async () => { const p = project(), m = newMarkup('count', 1, [[4, 5]]); p.markups[m.id] = m; const pdf = new Uint8Array([37, 80, 68, 70, 0, 255]), ov = new Uint8Array([2, 3, 4]); const a = archive(p, pdf, ov), r = await readArchive(a); assert.deepEqual(r.project, p); assert.deepEqual(r.pdf, pdf); assert.deepEqual(r.overlay, ov); });
test('archive length corruption is rejected before PDF parse', async () => { const p = project(), a = archive(p, new Uint8Array([1, 2])); const buf = new Uint8Array(await a.arrayBuffer()); await assert.rejects(() => readArchive(new Blob([buf.slice(0, -1)]))); });
test('SVG output escapes comments and handles an unfinished cloud', () => { const m = newMarkup('text', 1, [[10, 10]], { label: '<script>alert("x")</script>' }), vp = makeViewport({ width: 100, height: 100, transform: [1, 0, 0, -1, 0, 100] }); const s = svgPrimitives(primitives(m, vp, {}, 'm')); assert.ok(!s.includes('<script>')); assert.ok(s.includes('&lt;script&gt;')); assert.deepEqual(primitives(newMarkup('cloud', 1, [[1, 1]]), vp, {}, 'm'), []); });
test('demo takeoff analytical quantities: 64 + 35 m², 18 + 12.1667 m, 4 counts', () => { const p = project(); p.pages[1].calibration = { metersPerUnit: 1 / 30 }; for (const [t, pts] of [['area', [[190, 250], [430, 250], [430, 490], [190, 490]]], ['area', [[440, 500], [650, 500], [650, 650], [440, 650]]], ['length', [[190, 226], [730, 226]]], ['polyline', [[665, 500], [665, 360], [890, 360]]]]) {
    const m = newMarkup(t, 1, pts);
    p.markups[m.id] = m;
} const r = reportRows(p); near(r[0].quantity + r[1].quantity, 99); near(r[2].quantity, 18); near(r[3].quantity, 365 / 30); });
