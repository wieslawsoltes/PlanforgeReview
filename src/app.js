import { PdfSource } from './pdf.js';
import { Compositor } from './compositor.js';
import { TileEngine } from './tiles.js';
import * as G from './geometry.js';
import { newProject, newMarkup, History, clone, uid, STATUSES, reportRows, csv, summarize, validateProject } from './model.js';
import { primitives, svgPrimitives, markupBounds, hitMarkup, escapeHTML as esc } from './markups.js';
import * as Storage from './storage.js';
import { icon, hydrateIcons } from './icons.js';
const $ = s => document.querySelector(s);
const labels = { select: 'Select', hand: 'Pan', length: 'Length', area: 'Area', count: 'Count', polyline: 'Polyline', cloud: 'Cloud', callout: 'Callout', stamp: 'Stamp', rectangle: 'Rectangle', text: 'Text', pen: 'Freehand', calibrate: 'Calibrate', align: 'Align overlay' };
const shortcuts = { select: 'V', hand: 'H', length: 'L', area: 'A', count: 'C', polyline: 'P', cloud: 'R', callout: 'Q', stamp: 'S', text: 'T', pen: 'B', calibrate: 'K' };
const hints = { select: 'Drag to move · Drag a handle to reshape · Shift to multi-select', hand: 'Drag to pan · Scroll to zoom around the cursor', length: 'Click start, then end · Shift constrains to 45°', area: 'Click polygon vertices · Double-click or Enter to finish', polyline: 'Click each vertex · Double-click or Enter to finish', cloud: 'Drag a box around the revision', rectangle: 'Drag to draw a rectangle', count: 'Click to place each count · Each marker is an individual item', callout: 'Click the arrow tip, then the note position', text: 'Click to place text', stamp: 'Click to place a review stamp', pen: 'Drag to draw · Escape to cancel', calibrate: 'Click two points whose real-world separation you know', align: 'Click base point A, base point B, revision point A, revision point B' };
const defaultStyle = { color: '#e6545b', fill: 'none', width: 1.5, opacity: 1, fontSize: 11, subject: '', label: '', status: 'Open' };
const options = (items, value) => items.map(v => `<option value="${esc(Array.isArray(v) ? v[0] : v)}" ${value === (Array.isArray(v) ? v[0] : v) ? 'selected' : ''}>${esc(Array.isArray(v) ? v[1] : v)}</option>`).join('');
const field = (label, name, value, type = 'text', extra = '') => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
const selectField = (label, name, values, value) => `<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options(values, value)}</select></div>`;
class App {
    constructor() {
        this.page = 1;
        this.tool = 'select';
        this.panel = 'pages';
        this.selection = new Set();
        this.camera = { x: 40, y: 30, z: 1 };
        this.style = { ...defaultStyle };
        this.draft = null;
        this.gesture = null;
        this.snap = true;
        this.scope = 'all';
        this.clipboard = [];
        this.sort = { key: 'created', dir: 1 };
        this.previewEdits = new Map();
        this.pointers = new Map();
        this.assetsSaved = false;
        this.assetGeneration = 0;
        this.saveChain = Promise.resolve();
        this.tiles = new TileEngine(() => this.invalidate(), e => this.toast(e.message, true));
        this.compositor = new Compositor($('#pdf-canvas'), s => { $('#gpu-status').textContent = s; this.invalidate(); });
        this.bind();
    }
    toast(message, error = false) { clearTimeout(this.toastTimer); $('#toast').textContent = message; $('#toast').classList.toggle('error', error); $('#toast').hidden = false; this.toastTimer = setTimeout(() => $('#toast').hidden = true, error ? 8500 : 4300); }
    async busy(label, fn) { $('#loading-text').textContent = label; $('#loading').hidden = false; try {
        return await fn();
    }
    catch (e) {
        console.error(e);
        this.toast(e.message, true);
        return null;
    }
    finally {
        $('#loading').hidden = true;
    } }
    ask(title, html, submit = 'Apply') {
        return new Promise(resolve => {
            const d = $('#dialog');
            if (d.open)
                d.close();
            $('#dialog-title').textContent = title;
            $('#dialog-body').innerHTML = html;
            $('#dialog-submit').textContent = submit;
            $('#dialog-submit').hidden = false;
            $('#dialog-cancel').hidden = false;
            let done = false;
            const finish = value => { if (done)
                return; done = true; d.close(); resolve(value); };
            $('#dialog-form').onsubmit = e => { e.preventDefault(); if ($('#dialog-form').reportValidity())
                finish(Object.fromEntries(new FormData($('#dialog-form')))); };
            $('#dialog-close').onclick = $('#dialog-cancel').onclick = () => finish(null);
            d.oncancel = e => { e.preventDefault(); finish(null); };
            d.showModal();
            setTimeout(() => d.querySelector('input,select,textarea')?.focus(), 20);
        });
    }
    info(title, html) { this.ask(title, html, 'Close'); $('#dialog-cancel').hidden = true; }
    async start() {
        await this.compositor.init();
        this.resize();
        let restored = false;
        try {
            const id = localStorage.getItem('planforge-last');
            if (id) {
                const saved = await Storage.loadProject(id);
                await this.busy('Restoring local project…', async () => { await this.open(await saved.pdf.arrayBuffer(), saved.project.name, saved.project, saved.overlay ? await saved.overlay.arrayBuffer() : null); restored = true; });
            }
        }
        catch (e) {
            console.warn(e);
        }
        if (!restored)
            await this.demo();
    }
    async demo() { return this.busy('Opening architectural drawing set…', async () => { const r = await fetch('assets/riverside-drawing-set.pdf'); if (!r.ok)
        throw Error('Sample PDF could not be loaded'); await this.open(await r.arrayBuffer(), 'Riverside House — Drawing Set.pdf', null, null, true); }); }
    async open(bytes, name, saved = null, overlayBytes = null, demo = false) {
        if (this.project)
            await this.persist();
        const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
        if (saved && saved.fingerprint && saved.fingerprint !== fingerprint)
            throw Error('PDF fingerprint does not match this project.');
        const src = await PdfSource.open(bytes, name, async () => { const f = await this.ask('PDF password', field('Password', 'password', '', 'password', 'required'), 'Open PDF'); return f?.password ?? null; });
        if (saved && Object.keys(saved.pages).length !== src.meta.length) {
            await src.dispose();
            throw Error('Project page count does not match its PDF.');
        }
        const old = this.source, oldOverlay = this.overlaySource;
        this.tiles.clear();
        this.compositor.dropAll();
        this.source = src;
        this.overlaySource = null;
        this.project = saved ? validateProject(clone(saved)) : newProject(name, src.meta, fingerprint);
        // Refresh parser coordinate metadata; only calibrated scale and extra view rotation are user state.
        src.meta.forEach((m, i) => Object.assign(this.project.pages[i + 1], m, { extraRotation: saved?.pages[i + 1]?.extraRotation || 0 }));
        this.page = 1;
        this.selection.clear();
        this.draft = null;
        this.gesture = null;
        this.previewEdits.clear();
        this.assetsSaved = false;
        this.assetGeneration++;
        this.template = null;
        this.history = new History(this.project, label => this.changed(label));
        if (demo)
            this.seedDemo();
        if (overlayBytes && this.project.overlay.config) {
            try {
                this.overlaySource = await PdfSource.open(overlayBytes, this.project.overlay.name || 'Revision.pdf');
            }
            catch (e) {
                this.toast('Revision could not be restored: ' + e.message, true);
            }
        }
        if (old)
            old.dispose();
        if (oldOverlay)
            oldOverlay.dispose();
        this.reindex();
        this.updateAll();
        this.setTool('select');
        this.fit();
        this.scheduleSave();
    }
    seedDemo() {
        for (const pg of Object.values(this.project.pages))
            pg.calibration = { metersPerUnit: 1 / 30, label: 'Calibrated · 18.00 m', method: 'two-point', points: [[180, 200], [720, 200]], distance: 18, unit: 'm' };
        const add = (type, points, s) => { const m = newMarkup(type, 1, points, { author: 'Jordan Miller', ...s }); this.project.markups[m.id] = m; };
        add('area', [[190, 250], [430, 250], [430, 490], [190, 490]], { subject: 'Oak flooring · Living', color: '#00a58e', fill: '#00a58e', layer: 'takeoff', status: 'Accepted' });
        add('area', [[440, 500], [650, 500], [650, 650], [440, 650]], { subject: 'Porcelain tile · Kitchen', color: '#638ace', fill: '#638ace', layer: 'takeoff', status: 'Open' });
        add('length', [[190, 226], [730, 226]], { subject: 'External wall · South', color: '#dd9a44', layer: 'takeoff', status: 'Accepted' });
        add('polyline', [[665, 500], [665, 360], [890, 360]], { subject: 'Internal partition', color: '#917dc6', layer: 'takeoff', status: 'In progress' });
        for (const p of [[755, 540], [850, 540], [755, 610], [850, 610]])
            add('count', [p], { subject: 'Recessed downlight', color: '#ce9945', layer: 'takeoff', status: 'Open' });
        add('cloud', [[660, 230], [920, 355]], { subject: 'Door clearance revision', color: '#e15660', layer: 'review', status: 'Open' });
        add('callout', [[860, 285], [880, 167]], { subject: 'Verify clear opening', label: 'Verify 900 mm clear\nopening with architect.', color: '#d34d59', layer: 'review', status: 'Open', fontSize: 10 });
        add('stamp', [[230, 120]], { subject: 'FOR COORDINATION', label: 'FOR COORDINATION', color: '#427e79', layer: 'review', status: 'Accepted', fontSize: 13 });
    }
    changed(label) { this.selection = new Set([...this.selection].filter(id => { const m = this.project.markups[id]; return m && this.project.layers[m.layer]?.visible; })); this.reindex(); this.updateAll(); this.invalidate(); this.scheduleSave(); $('#selection-status').textContent = label; }
    scheduleSave() { clearTimeout(this.saveTimer); $('#dirty-dot').style.display = 'block'; $('#save-status').textContent = 'Saving locally…'; this.saveTimer = setTimeout(() => this.persist(), 600); }
    async persist() {
        if (!this.project)
            return;
        clearTimeout(this.saveTimer);
        const project = clone(this.project), source = this.source, overlay = this.overlaySource, saveAssets = !this.assetsSaved, assetGeneration = this.assetGeneration;
        this.saveChain = this.saveChain.catch(() => { }).then(async () => {
            try {
                await Storage.saveProject(project, saveAssets ? source.bytes : null, saveAssets ? overlay?.bytes : null);
                if (this.project.id === project.id && this.assetGeneration === assetGeneration) {
                    if (saveAssets)
                        this.assetsSaved = true;
                    if (this.project.revision === project.revision) {
                        $('#save-status').textContent = 'Saved locally';
                        $('#dirty-dot').style.display = 'none';
                    }
                }
            }
            catch (e) {
                $('#save-status').textContent = 'Not saved · export a project';
                this.toast('Local storage unavailable or full. Export your project archive. ' + e.message, true);
            }
        });
        return this.saveChain;
    }
    get pg() { return this.project?.pages[this.page]; }
    get vp() { return this.source?.viewport(this.page, this.pg?.extraRotation || 0); }
    get visible() { return this.project ? Object.values(this.project.markups).filter(m => m.page === this.page && this.project.layers[m.layer]?.visible) : []; }
    get selected() { return [...this.selection].map(id => this.project.markups[id]).filter(Boolean); }
    get editable() { return this.selected.filter(m => !this.project.layers[m.layer]?.locked); }
    reindex() { this.index = new G.SpatialIndex(); if (!this.source)
        return; for (const m of this.visible)
        this.index.insert(m.id, markupBounds(m, this.vp)); }
    resize() { const r = $('#stage').getBoundingClientRect(); this.stage = { w: r.width, h: r.height }; this.compositor.resize(r.width, r.height, Math.min(devicePixelRatio || 1, 2.5)); this.invalidate(); }
    fit() { if (!this.source || !this.stage)
        return; const v = this.vp; this.camera.z = G.clamp(Math.min((this.stage.w - 76) / v.width, (this.stage.h - 76) / v.height), .04, 16); this.camera.x = (this.stage.w - v.width * this.camera.z) / 2 + 8; this.camera.y = (this.stage.h - v.height * this.camera.z) / 2 + 7; this.invalidate(); }
    zoom(factor, at = [this.stage.w / 2, this.stage.h / 2]) { const old = this.camera.z, n = G.clamp(old * factor, .04, 16); this.camera.x = at[0] - (at[0] - this.camera.x) * n / old; this.camera.y = at[1] - (at[1] - this.camera.y) * n / old; this.camera.z = n; this.invalidate(); }
    async go(page) { page = G.clamp(Math.round(page), 1, this.source.meta.length); if (page === this.page)
        return; this.page = page; this.selection.clear(); this.draft = null; this.previewEdits.clear(); this.gesture = null; this.reindex(); this.updateAll(); this.fit(); }
    setTool(tool, template = null) {
        this.tool = tool;
        this.template = template;
        this.draft = null;
        this.gesture = null;
        this.previewEdits.clear();
        if (tool !== 'select')
            this.selection.clear();
        document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        $('#tool-hint').textContent = template ? 'Click to place saved markup · ' + template.name : hints[tool] || hints.select;
        $('#stage').style.cursor = tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
        this.renderInspector();
        this.renderTable();
        this.invalidate();
    }
    invalidate() { if (this.frameRequested)
        return; this.frameRequested = true; requestAnimationFrame(() => { this.frameRequested = false; if (this.source)
        this.render(); }); }
    toView(pdf) { return this.vp.convertToViewportPoint(...pdf); }
    toScreen(pdf) { const p = this.toView(pdf); return [this.camera.x + p[0] * this.camera.z, this.camera.y + p[1] * this.camera.z]; }
    eventPoint(e) { const b = $('#stage').getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }
    screenToView(p) { return [(p[0] - this.camera.x) / this.camera.z, (p[1] - this.camera.y) / this.camera.z]; }
    screenToPdf(p) { return this.vp.convertToPdfPoint(...this.screenToView(p)); }
    inside(p) { const v = this.vp; return p[0] >= 0 && p[1] >= 0 && p[0] <= v.width && p[1] <= v.height; }
    overlayTransform() { const view = G.multiply(this.vp.transform, G.inverse(this.source.viewport(this.page, 0).transform)); return G.multiply(view, G.overlayMatrix(this.project.overlay.config)); }
    render() {
        this.tiles.begin();
        const cfg = this.project.overlay.config, revisionPage = cfg?.page || this.page, compare = cfg?.visible && this.overlaySource && revisionPage <= this.overlaySource.meta.length;
        const commands = this.tiles.layer(this.source, this.page, this.pg.extraRotation || 0, this.camera, this.stage, [1, 0, 0, 1, 0, 0], compare ? { mode: 1, tint: [.07, .52, .67] } : {});
        if (compare) {
            commands.push(...this.tiles.layer(this.overlaySource, revisionPage, 0, this.camera, this.stage, this.overlayTransform(), { mode: 2, tint: [.91, .12, .44], opacity: cfg.opacity }));
        }
        this.tiles.end();
        this.compositor.render(commands);
        this.renderVectors();
        this.renderRulers();
        $('#zoom-level').textContent = Math.round(this.camera.z * 100) + '%';
        $('#render-stats').textContent = `${this.tiles.cache.size} tiles · ${(this.tiles.bytes / 1048576).toFixed(1)} MB`;
        $('#page-number').value = this.page;
    }
    renderVectors() {
        const v = this.vp, z = this.camera.z, viewbox = { x: -this.camera.x / z, y: -this.camera.y / z, w: this.stage.w / z, h: this.stage.h / z };
        const ids = new Set(this.index.query(viewbox));
        let html = '';
        for (const item of this.visible) {
            if (!ids.has(item.id))
                continue;
            const m = this.previewEdits.get(item.id) || item;
            html += `<g data-markup-id="${m.id}">${svgPrimitives(primitives(m, v, this.pg, this.project.settings.unit))}</g>`;
        }
        if (this.draft && this.draft.points.length) {
            let ps = [...this.draft.points];
            if (this.draft.hover)
                ps.push(this.draft.hover);
            const type = ['calibrate', 'align'].includes(this.tool) ? 'polyline' : this.tool;
            const temp = newMarkup(type, this.page, ps, { ...this.style, color: '#6ee4cf', fill: type === 'area' ? '#6ee4cf' : 'none', label: this.style.label || 'Note', subject: 'Draft' });
            if (['cloud', 'rectangle', 'callout'].includes(type) && ps.length === 1)
                ps.push(ps[0]);
            html += `<g opacity=".75" stroke-dasharray="5 3">${svgPrimitives(primitives(temp, v, this.pg, this.project.settings.unit))}</g>`;
            for (const p of ps) {
                const c = this.toView(p);
                html += `<circle cx="${c[0]}" cy="${c[1]}" r="${3 / z}" fill="#7feeda"/>`;
            }
        }
        $('#markup-world').setAttribute('transform', `translate(${this.camera.x} ${this.camera.y}) scale(${z})`);
        $('#markup-world').innerHTML = html;
        let handles = '';
        for (const m0 of this.selected) {
            if (!this.project.layers[m0.layer]?.visible)
                continue;
            const m = this.previewEdits.get(m0.id) || m0, b = markupBounds(m, v);
            const x = this.camera.x + b.x * z, y = this.camera.y + b.y * z;
            handles += `<rect x="${x}" y="${y}" width="${b.w * z}" height="${b.h * z}" fill="none" stroke="#65ead4" stroke-width="1" stroke-dasharray="4 3"/>`;
            if (this.selected.length === 1 && !this.project.layers[m.layer].locked)
                m.points.forEach((p, i) => { const s = this.toScreen(p); handles += `<rect x="${s[0] - 3.5}" y="${s[1] - 3.5}" width="7" height="7" fill="#183b38" stroke="#87f5e0" stroke-width="1.4"/>`; });
        }
        if (this.gesture?.kind === 'box') {
            const b = G.bounds([this.gesture.start, this.gesture.current]);
            handles += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#43c4b322" stroke="#7ae5d4" stroke-dasharray="4 3"/>`;
        }
        if (this.snapPoint) {
            const s = this.toScreen(this.snapPoint);
            handles += `<circle cx="${s[0]}" cy="${s[1]}" r="6" fill="none" stroke="#f5d270" stroke-width="1.4"/>`;
        }
        $('#screen-ui').innerHTML = handles;
    }
    renderRulers() { const z = this.camera.z, step = 2 ** Math.ceil(Math.log2(65 / z)), r = (size, offset, shift) => { let text = ''; for (let n = Math.floor(-offset / z / step); n < Math.ceil((size - offset) / z / step); n++) {
        const pos = offset + n * step * z - shift;
        text += `<span style="${shift === 22 ? 'left' : 'top'}:${pos}px">${Math.round(n * step)}</span>`;
    } return text; }; $('#ruler-top').innerHTML = r(this.stage.w, this.camera.x, 22); $('#ruler-left').innerHTML = r(this.stage.h, this.camera.y, 20); }
    updateAll() { if (!this.project)
        return; $('#document-name').textContent = this.project.name; $('#document-name').title = this.project.name; $('#backend-status').textContent = this.source.backend; $('#page-total').textContent = '/ ' + this.source.meta.length; $('#page-number').max = this.source.meta.length; $('#page-title').textContent = `${this.pg.label || this.page} · ${this.page === 1 && this.project.name.startsWith('Riverside') ? 'Ground floor plan' : 'Sheet ' + this.page}`; $('#project-caption').textContent = this.source.meta.length + ' sheets · local project'; $('#scale-status').textContent = this.pg.calibration?.label || 'Uncalibrated · set scale'; $('#undo').disabled = !this.history.undoStack.length; $('#redo').disabled = !this.history.redoStack.length; $('#undo').title = 'Undo ' + (this.history.undoStack.at(-1)?.label || ''); $('#redo').title = 'Redo ' + (this.history.redoStack.at(-1)?.label || ''); this.renderLeft(); this.renderInspector(); this.renderTable(); }
    renderLeft() {
        if (!this.project)
            return;
        const titles = { pages: 'Thumbnails', tools: 'Tool Chest', layers: 'Layers', measure: 'Measurements', overlay: 'Document Overlay' };
        $('#panel-title').textContent = titles[this.panel];
        $('#panel-count').textContent = this.panel === 'pages' ? this.source.meta.length + ' sheets' : '';
        document.querySelectorAll('[data-panel]').forEach(b => b.classList.toggle('active', b.dataset.panel === this.panel));
        const host = $('#left-content'), scroll = host.scrollTop;
        this.thumbObserver?.disconnect();
        if (this.panel === 'pages') {
            const count = {};
            for (const m of Object.values(this.project.markups))
                count[m.page] = (count[m.page] || 0) + 1;
            host.innerHTML = this.source.meta.map((m, i) => `<button class="thumb ${i + 1 === this.page ? 'active' : ''}" data-page="${i + 1}"><div class="thumb-paper" data-thumbnail="${i + 1}"><span class="thumb-loader">${icon('pdf')}</span></div><div class="thumb-info"><b>${esc(m.label || 'Sheet ' + (i + 1))}</b><small>${count[i + 1] || 0} markups</small></div><div class="thumb-sheet">${i === 0 && this.project.name.startsWith('Riverside') ? 'GROUND FLOOR PLAN' : i === 1 && this.project.name.startsWith('Riverside') ? 'REFLECTED CEILING PLAN' : 'DRAWING SHEET ' + (i + 1)}</div></button>`).join('');
            const source = this.source;
            this.thumbURLs ??= new Map();
            this.thumbQueue ??= Promise.resolve();
            this.thumbObserver = new IntersectionObserver(entries => {
                for (const e of entries)
                    if (e.isIntersecting) {
                        this.thumbObserver.unobserve(e.target);
                        const n = +e.target.dataset.thumbnail, key = source.key + '/' + n;
                        const set = url => { if (e.target.isConnected) {
                            e.target.innerHTML = '';
                            const image = new Image();
                            image.alt = 'PDF page ' + n;
                            image.src = url;
                            e.target.append(image);
                        } };
                        if (this.thumbURLs.has(key)) {
                            set(this.thumbURLs.get(key));
                            continue;
                        }
                        this.thumbQueue = this.thumbQueue.catch(() => { }).then(async () => { if (source !== this.source)
                            return; const c = await source.thumbnail(n, 220); const url = c.toDataURL('image/png'); this.thumbURLs.set(key, url); while (this.thumbURLs.size > 80)
                            this.thumbURLs.delete(this.thumbURLs.keys().next().value); set(url); }).catch(e => console.warn('Thumbnail:', e.message));
                    }
            }, { root: host, rootMargin: '100px' });
            host.querySelectorAll('[data-thumbnail]').forEach(e => this.thumbObserver.observe(e));
        }
        else if (this.panel === 'tools') {
            const builtins = [['area', 'Floor finish', '#00a58e'], ['length', 'Linear takeoff', '#df9c49'], ['count', 'Light fixture', '#cf9944'], ['cloud', 'Design revision', '#e25561'], ['callout', 'Review comment', '#e25561'], ['stamp', 'APPROVED', '#3dac8c'], ['stamp', 'REVISE & RESUBMIT', '#e25561']];
            host.innerHTML = `<p class="panel-note">Reusable tools keep your team’s markup styles consistent.</p><div class="chest-heading">STANDARD TOOL SET <span>7 tools</span></div>` + builtins.map(([type, name, color], i) => `<button class="chest-item" data-preset="${i}"><span style="color:${color}">${icon(type)}</span>${name}</button>`).join('') + `<div class="section-label">MY TOOLS</div>` + Object.values(this.project.tools).map(t => `<button class="chest-item" data-saved-tool="${t.id}">${icon(t.type)}${esc(t.name)}</button>`).join('') + `<button class="panel-button" data-action="savetool">${icon('plus')} Save selected markup</button><p class="tiny">Saved tools retain style and geometry. Select one, then click to place another instance.</p>`;
            this.builtins = builtins;
        }
        else if (this.panel === 'layers') {
            host.innerHTML = `<p class="panel-note">Control visibility and protect completed work. The selected layer receives new markups.</p>` + Object.values(this.project.layers).map(l => `<div class="layer-item"><input type="radio" name="active-layer" data-layer-active="${l.id}" ${this.project.settings.activeLayer === l.id ? 'checked' : ''} aria-label="Draw on ${esc(l.name)}"><span class="swatch" style="background:${l.color}"></span><span class="layer-name" title="${esc(l.name)}">${esc(l.name)}</span><button data-layer-visible="${l.id}" style="opacity:${l.visible ? 1 : .35}" title="Toggle visibility">${icon('eye')}</button><button data-layer-lock="${l.id}" title="${l.locked ? 'Unlock' : 'Lock'} layer">${icon(l.locked ? 'lock' : 'unlock')}</button></div>`).join('') + `<button class="panel-button" data-action="addlayer">${icon('plus')} Add layer</button><p class="tiny">Hidden layers remain in quantity reports. Locked layers cannot be edited, moved, or deleted.</p>`;
        }
        else if (this.panel === 'measure') {
            const c = this.pg.calibration;
            host.innerHTML = `<p class="panel-note">Calibrate this sheet using a known dimension before measuring.</p><div class="scale-display">${c ? 'Calibrated' : 'Set scale'}<small>${esc(c?.label || 'No real-world scale has been assigned')}</small></div><button class="panel-button" data-tool="calibrate">${icon('ruler')} Calibrate two points</button><button class="panel-button" data-action="scale">Enter drawing scale</button><button class="panel-button" data-action="allscale">Apply scale to all sheets</button>${selectField('Display & report units', 'displayUnit', Object.keys(G.UNITS), this.project.settings.unit)}<div class="notice">Verify the drawing scale against a printed dimension. Scans may be distorted. One uniform scale is used per sheet.</div><div class="section-label">MEASUREMENT TOOLS</div>` + ['length', 'area', 'polyline', 'count'].map(t => `<button class="chest-item" data-tool="${t}">${icon(t)}${labels[t]}<span class="top-spacer"></span><span class="muted">${shortcuts[t]}</span></button>`).join('') + `<p class="tiny">Geometry is stored in PDF user space. Quantities are recomputed from the calibrated geometry, never from screen pixels.</p>`;
        }
        else if (this.panel === 'overlay') {
            const c = this.project.overlay.config;
            host.innerHTML = `<p class="panel-note">Compare a revision in <span style="color:#e77099">magenta</span> against the base drawing in <span style="color:#66bdcf">cyan</span>.</p><button class="panel-button" data-action="openoverlay">${icon('folder')} Open revision PDF</button><button class="panel-button" data-action="demooverlay">Load sample revision</button>`;
            if (c && this.overlaySource) {
                host.innerHTML += `<div class="section-label">${esc(this.project.overlay.name)}</div><label class="field-label"><input type="checkbox" name="overlay-visible" ${c.visible ? 'checked' : ''}> Show revision overlay</label><div class="section-label">REGISTRATION</div><div class="field-row">${field('Offset X · pt', 'ov-dx', c.dx, 'number', 'step="0.1"')}${field('Offset Y · pt', 'ov-dy', c.dy, 'number', 'step="0.1"')}</div><div class="field-row">${field('Scale', 'ov-scale', c.scale, 'number', 'min="0.01" max="100" step="0.001"')}${field('Rotation · °', 'ov-angle', c.angle, 'number', 'step="0.1"')}</div>${field('Opacity', 'ov-opacity', c.opacity, 'range', 'min="0" max="1" step="0.02"')}${selectField('Revision page', 'ov-page', [[0, 'Match current sheet'], ...this.overlaySource.meta.map((m, i) => [i + 1, (i + 1) + ' · ' + m.label])], c.page)}<button class="panel-button" data-action="align">Register with two point pairs</button><button class="panel-button" data-action="resetoverlay">Reset registration</button><p class="tiny">Choose base A and B, then the corresponding revision A and B. Registration uses uniform scale, rotation and translation. Overlays are comparison-only, not exported into the review PDF.</p>`;
            }
        }
        host.scrollTop = scroll;
    }
    renderInspector() {
        if (!this.project)
            return;
        const selected = this.selected, m = selected[0], s = m || this.style, n = selected.length, q = m ? G.measurement(m, this.project.pages[m.page], this.project.settings.unit) : null;
        $('#inspector').innerHTML = `<div class="inspector-heading">${icon(m?.type || this.tool)}<div><b>${n > 1 ? n + ' markups selected' : m ? labels[m.type] : (labels[this.tool] || 'Markup') + ' properties'}</b><small>${m ? 'Selected markup' : 'Defaults for new markups'}</small></div></div><div class="field"><label for="prop-subject">Subject</label><input id="prop-subject" data-property="subject" value="${esc(s.subject)}" placeholder="${m ? '' : 'Automatic tool subject'}"></div><div class="field"><label for="prop-label">Comment / text</label><textarea id="prop-label" data-property="label" placeholder="Add a review comment…">${esc(s.label)}</textarea></div><div class="section-label">APPEARANCE</div><div class="field-row"><div class="field"><label>Color</label><div class="color-row"><input aria-label="Markup color" type="color" data-property="color" value="${s.color}"><span>${s.color.toUpperCase()}</span></div></div><div class="field"><label>Line width · pt</label><input aria-label="Line width" type="number" data-property="width" value="${s.width}" min="0.1" max="100" step="0.25"></div></div><div class="field-row"><div class="field"><label>Text size · pt</label><input aria-label="Text size" type="number" data-property="fontSize" value="${s.fontSize}" min="1" max="300" step="1"></div><div class="field"><label>Opacity</label><input aria-label="Opacity" type="number" data-property="opacity" value="${s.opacity}" min="0" max="1" step="0.1"></div></div><div class="section-label">ORGANIZATION</div><div class="field"><label>Layer</label><select aria-label="Markup layer" data-property="layer">${options(Object.values(this.project.layers).map(l => [l.id, l.name]), m?.layer || this.project.settings.activeLayer)}</select></div><div class="field"><label>Review status</label><select aria-label="Review status" data-property="status">${options(STATUSES, s.status)}</select></div><div class="field"><label>Author</label><input aria-label="Author" data-property="author" value="${esc(m?.author || this.project.settings.author)}"></div>` +
            (q ? `<div class="quantity-card"><small>CALCULATED QUANTITY</small><b>${esc(G.formatQty(q))}</b><p>${q.calibrated ? 'From native PDF geometry · ' + esc(this.project.pages[m.page].calibration?.label || 'Individual count') : 'Calibrate this page to calculate a quantity.'}</p></div>` : '') +
            (m ? `<div class="property-actions"><button data-action="duplicate">${icon('copy')} Duplicate</button><button data-action="savetool">${icon('chest')} Save tool</button><button data-action="delete">${icon('trash')} Delete</button></div><div class="section-label">IDENTITY</div><p class="tiny">${esc(m.id)}<br>Updated ${esc(new Date(m.modified).toLocaleString())}</p>` : `<div class="quantity-card"><small>CURRENT SHEET SCALE</small><b style="font-size:17px">${this.pg.calibration ? 'Calibrated' : 'Uncalibrated'}</b><p>${esc(this.pg.calibration?.label || 'Set a scale before measuring.')}</p></div><button class="panel-button" data-action="measurepanel">${icon('ruler')} Measurements & scale</button>`);
    }
    filteredRows() { let rows = reportRows(this.project, m => (this.scope === 'all' || m.page === this.page) && (!$('#status-filter').value || m.status === $('#status-filter').value)); const f = $('#filter').value.toLowerCase(); if (f)
        rows = rows.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(f))); const { key, dir } = this.sort; return rows.sort((a, b) => (typeof a[key] === 'number' && typeof b[key] === 'number' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]), undefined, { numeric: true })) * dir); }
    renderTable() {
        if (!this.project)
            return;
        const rows = this.filteredRows();
        $('#markup-count').textContent = rows.length;
        $('#scope-toggle').textContent = this.scope === 'all' ? 'All sheets' : 'Current sheet';
        $('#quantity-scope').textContent = (this.scope === 'all' ? 'All sheets' : 'Sheet ' + this.page) + ' · filtered rows';
        $('#markup-rows').innerHTML = rows.map(r => { const m = this.project.markups[r.id], q = G.measurement(m, this.project.pages[m.page], this.project.settings.unit); return `<tr data-row="${r.id}" class="${this.selection.has(r.id) ? 'selected' : ''}"><td><span class="row-dot" style="background:${m.color}"></span>${esc(r.subject)}</td><td>${r.page}</td><td>${esc(labels[r.type])}</td><td>${esc(G.formatQty(q))}</td><td><span class="status-chip ${r.status.toLowerCase().replaceAll(' ', '-')}">${esc(r.status)}</span></td><td>${esc(r.layer)}</td><td>${esc(r.author)}</td><td>${esc(r.label)}</td></tr>`; }).join('');
        let area = 0, length = 0, count = 0, unknown = 0;
        for (const r of rows) {
            if (r.quantity === '') {
                if (['area', 'length', 'polyline'].includes(r.type))
                    unknown++;
                continue;
            }
            if (r.type === 'area')
                area += r.quantity;
            else if (['length', 'polyline'].includes(r.type))
                length += r.quantity;
            else if (r.type === 'count')
                count += r.quantity;
        }
        const fmt = x => x.toLocaleString('en-US', { maximumFractionDigits: 2 });
        $('#total-area').textContent = fmt(area);
        $('#total-length').textContent = fmt(length);
        $('#total-count').textContent = count;
        $('#area-unit').textContent = this.project.settings.unit + '²';
        $('#length-unit').textContent = this.project.settings.unit;
        $('#uncalibrated-warning').textContent = unknown ? `${unknown} uncalibrated measurement${unknown > 1 ? 's' : ''} excluded` : '';
        $('#selection-status').textContent = this.selection.size ? this.selection.size + ' selected' : 'Ready · ' + labels[this.tool];
    }
    changeProperty(key, value) {
        const numeric = ['width', 'fontSize', 'opacity'];
        if (numeric.includes(key)) {
            value = Number(value);
            const [lo, hi] = key === 'opacity' ? [0, 1] : key === 'fontSize' ? [1, 300] : [.1, 100];
            if (!Number.isFinite(value) || value < lo || value > hi) {
                this.toast('Property is outside the supported range.', true);
                this.renderInspector();
                return;
            }
        }
        if (this.selection.size) {
            const ops = [];
            for (const m of this.editable) {
                if (key === 'layer' && this.project.layers[value].locked) {
                    this.toast('Destination layer is locked.', true);
                    return;
                }
                const next = { ...m, [key]: value, modified: new Date().toISOString() };
                if (key === 'color' && m.type === 'area')
                    next.fill = value;
                ops.push(this.history.op('markups', m.id, next));
            }
            this.history.commit('Change ' + key, ops);
            if (!ops.length)
                this.toast('The selected layer is locked.');
        }
        else if (key === 'layer' || key === 'author') {
            this.history.commit('Set ' + key, [this.history.op('settings', key === 'layer' ? 'activeLayer' : key, value)]);
        }
        else {
            this.style[key] = value;
            this.renderInspector();
        }
    }
    snapped(pdf, e, exclude = new Set()) {
        this.snapPoint = null;
        let point = pdf;
        if (e.shiftKey && this.draft?.points.length) {
            const a = this.draft.points.at(-1), d = G.dist(a, pdf), t = Math.round(Math.atan2(pdf[1] - a[1], pdf[0] - a[0]) / (Math.PI / 4)) * Math.PI / 4;
            point = [a[0] + d * Math.cos(t), a[1] + d * Math.sin(t)];
        }
        if (this.snap && !e.altKey) {
            const v = this.toView(point), tol = 9 / this.camera.z, candidates = this.index.query({ x: v[0] - tol, y: v[1] - tol, w: tol * 2, h: tol * 2 });
            let best = tol;
            for (const id of candidates) {
                if (exclude.has(id))
                    continue;
                for (const p of this.project.markups[id].points) {
                    const d = G.dist(v, this.toView(p));
                    if (d < best) {
                        best = d;
                        point = [...p];
                        this.snapPoint = point;
                    }
                }
            }
        }
        return point;
    }
    pick(screen) { const p = this.screenToView(screen), tol = 7 / this.camera.z, ids = new Set(this.index.query({ x: p[0] - tol, y: p[1] - tol, w: tol * 2, h: tol * 2 })); return [...this.visible].reverse().find(m => ids.has(m.id) && hitMarkup(m, this.vp, p, tol)); }
    pointerDown(e) {
        if (!this.source || e.target.closest('button,input,.page-navigator'))
            return;
        $('#stage').focus({ preventScroll: true });
        e.preventDefault();
        const screen = this.eventPoint(e);
        this.pointers.set(e.pointerId, screen);
        $('#stage').setPointerCapture(e.pointerId);
        if (this.pointers.size === 2) {
            const p = [...this.pointers.values()];
            this.gesture = { kind: 'pinch', distance: G.dist(...p), center: [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2], camera: { ...this.camera } };
            this.draft = null;
            this.previewEdits.clear();
            return;
        }
        if (this.pointers.size > 2)
            return;
        if (e.button === 1 || this.space || this.tool === 'hand') {
            this.gesture = { kind: 'pan', start: screen, camera: { ...this.camera } };
            return;
        }
        if (e.button !== 0)
            return;
        const pdf = this.screenToPdf(screen);
        if (this.tool === 'select') {
            if (this.selected.length === 1 && !this.project.layers[this.selected[0].layer].locked) {
                const m = this.selected[0], i = m.points.findIndex(p => G.dist(this.toScreen(p), screen) < 9);
                if (i >= 0) {
                    this.gesture = { kind: 'vertex', markup: clone(m), index: i, start: screen };
                    return;
                }
            }
            const hit = this.pick(screen);
            if (hit) {
                if (e.shiftKey) {
                    if (this.selection.has(hit.id)) {
                        this.selection.delete(hit.id);
                        this.renderInspector();
                        this.renderTable();
                        this.invalidate();
                        return;
                    }
                    this.selection.add(hit.id);
                }
                else if (!this.selection.has(hit.id))
                    this.selection = new Set([hit.id]);
                this.gesture = { kind: 'move', start: screen, pdf, markups: this.editable.map(clone) };
            }
            else {
                if (!e.shiftKey)
                    this.selection.clear();
                this.gesture = { kind: 'box', start: screen, current: screen, add: e.shiftKey };
            }
            this.renderInspector();
            this.renderTable();
            this.invalidate();
            return;
        }
        if (!this.inside(this.screenToView(screen)))
            return;
        const layer = this.project.layers[this.project.settings.activeLayer];
        if (layer.locked || !layer.visible) {
            this.toast('Choose an unlocked, visible layer before drawing.', true);
            return;
        }
        const p = this.snapped(pdf, e);
        if (this.template) {
            const t = this.template, m = newMarkup(t.type, this.page, t.points.map(v => [v[0] + p[0], v[1] + p[1]]), { ...t.style, layer: this.project.settings.activeLayer, author: this.project.settings.author });
            this.commitMarkup(m);
            return;
        }
        if (['cloud', 'rectangle', 'pen'].includes(this.tool)) {
            this.gesture = { kind: this.tool === 'pen' ? 'pen' : 'drawbox', start: screen, pdf: p };
            this.draft = { points: [p], hover: null };
            this.invalidate();
            return;
        }
        if (['text', 'stamp'].includes(this.tool)) {
            this.placeText(this.tool, p);
            return;
        }
        if (this.tool === 'count') {
            this.commitMarkup(this.makeMarkup('count', [p]));
            return;
        }
        if (e.detail >= 2)
            return;
        if (this.tool === 'area' && this.draft?.points.length >= 3 && G.dist(this.toScreen(this.draft.points[0]), screen) < 10) {
            this.finishPath();
            return;
        }
        this.draft ??= { points: [], hover: null };
        if (!this.draft.points.length || G.dist(p, this.draft.points.at(-1)) > 1e-7)
            this.draft.points.push(p);
        this.draft.hover = null;
        if (['length', 'callout', 'calibrate'].includes(this.tool) && this.draft.points.length === 2)
            this.finishPath();
        else if (this.tool === 'align' && this.draft.points.length === 4)
            this.finishPath();
        else if (this.tool === 'align')
            $('#tool-hint').textContent = ['', 'Choose base point B', 'Choose revision point A', 'Choose revision point B'][this.draft.points.length] || hints.align;
        this.invalidate();
    }
    pointerMove(e) {
        if (!this.source)
            return;
        const s = this.eventPoint(e);
        if (this.pointers.has(e.pointerId))
            this.pointers.set(e.pointerId, s);
        const g = this.gesture;
        if (g?.kind === 'pinch') {
            if (this.pointers.size < 2)
                return;
            const ps = [...this.pointers.values()], c = [(ps[0][0] + ps[1][0]) / 2, (ps[0][1] + ps[1][1]) / 2];
            this.camera.z = G.clamp(g.camera.z * G.dist(...ps) / (g.distance || 1), .04, 16);
            const f = this.camera.z / g.camera.z;
            this.camera.x = c[0] - (g.center[0] - g.camera.x) * f;
            this.camera.y = c[1] - (g.center[1] - g.camera.y) * f;
            this.invalidate();
            return;
        }
        const pdf = this.screenToPdf(s);
        $('#cursor-position').textContent = `PDF ${pdf[0].toFixed(1)}, ${pdf[1].toFixed(1)}`;
        if (g?.kind === 'pan') {
            this.camera.x = g.camera.x + s[0] - g.start[0];
            this.camera.y = g.camera.y + s[1] - g.start[1];
        }
        else if (g?.kind === 'move') {
            if (G.dist(s, g.start) > 3) {
                g.moved = true;
                const dx = pdf[0] - g.pdf[0], dy = pdf[1] - g.pdf[1];
                for (const m of g.markups)
                    this.previewEdits.set(m.id, { ...m, points: m.points.map(p => [p[0] + dx, p[1] + dy]) });
            }
        }
        else if (g?.kind === 'vertex') {
            const p = this.snapped(pdf, e, new Set([g.markup.id])), m = clone(g.markup);
            m.points[g.index] = p;
            g.moved = G.dist(s, g.start) > 1;
            this.previewEdits.set(m.id, m);
        }
        else if (g?.kind === 'box')
            g.current = s;
        else if (g?.kind === 'drawbox')
            this.draft.points = [g.pdf, this.snapped(pdf, e)];
        else if (g?.kind === 'pen') {
            const ps = this.draft.points;
            if (G.dist(this.toScreen(ps.at(-1)), s) > 1.8)
                ps.push(pdf);
        }
        else if (this.draft) {
            this.draft.hover = this.snapped(pdf, e);
        }
        else if (!['select', 'hand'].includes(this.tool))
            this.snapped(pdf, e);
        this.invalidate();
    }
    pointerUp(e) {
        this.pointers.delete(e.pointerId);
        if (!this.source)
            return;
        const g = this.gesture;
        if (!g)
            return;
        if (g.kind === 'pinch') {
            if (!this.pointers.size)
                this.gesture = null;
            return;
        }
        if (['move', 'vertex'].includes(g.kind) && g.moved) {
            const edits = [...this.previewEdits.values()];
            if (edits.some(m => m.type === 'area' && !G.validPolygon(m.points)))
                this.toast('A takeoff polygon cannot self-intersect or have zero area.', true);
            else
                this.history.commit(g.kind === 'move' ? 'Move markup' : 'Edit vertex', edits.map(m => this.history.op('markups', m.id, { ...m, modified: new Date().toISOString() })));
        }
        else if (g.kind === 'box' && G.dist(g.start, g.current) > 4) {
            const box = G.bounds([this.screenToView(g.start), this.screenToView(g.current)]);
            if (!g.add)
                this.selection.clear();
            for (const id of this.index.query(box))
                this.selection.add(id);
            this.renderInspector();
            this.renderTable();
        }
        else if (g.kind === 'drawbox') {
            if (this.draft?.points.length === 2 && G.dist(this.toScreen(this.draft.points[0]), this.toScreen(this.draft.points[1])) > 5)
                this.commitMarkup(this.makeMarkup(this.tool, this.draft.points));
            this.draft = null;
        }
        else if (g.kind === 'pen') {
            if (this.draft?.points.length > 1)
                this.commitMarkup(this.makeMarkup('pen', this.draft.points));
            this.draft = null;
        }
        this.previewEdits.clear();
        this.gesture = null;
        this.snapPoint = null;
        this.invalidate();
    }
    makeMarkup(type, points) {
        const style = { ...this.style };
        if (!style.subject)
            delete style.subject;
        if (!style.label)
            delete style.label;
        if (type === 'area')
            style.fill = style.color;
        return newMarkup(type, this.page, points, { ...style, layer: this.project.settings.activeLayer, author: this.project.settings.author });
    }
    commitMarkup(m) {
        if (m.type === 'area' && !G.validPolygon(m.points)) {
            this.toast('Area requires a nonzero, simple polygon without intersecting edges.', true);
            return false;
        }
        this.history.commit('Add ' + labels[m.type], [this.history.op('markups', m.id, m)]);
        return true;
    }
    async placeText(type, p, points = null) { const initial = this.style.label || (type === 'stamp' ? 'APPROVED' : ''); const f = await this.ask(type === 'stamp' ? 'Place review stamp' : 'Place ' + labels[type], field('Subject', 'subject', this.style.subject || (type === 'stamp' ? 'Review stamp' : 'Review note')) + `<div class="field"><label>Text</label><textarea name="label" required rows="3">${esc(initial)}</textarea></div>`, 'Place markup'); if (!f)
        return; this.commitMarkup({ ...this.makeMarkup(type, points || [p]), ...f }); }
    async finishPath() {
        if (!this.draft)
            return;
        const points = clone(this.draft.points), type = this.tool;
        if (points.length < (type === 'area' ? 3 : type === 'align' ? 4 : 2))
            return;
        this.draft = null;
        this.invalidate();
        if (type === 'calibrate') {
            const len = G.dist(...points);
            if (len < 1e-8) {
                this.toast('Calibration points must be distinct.', true);
                return;
            }
            const f = await this.ask('Calibrate sheet ' + this.page, `<p class="dialog-note">Enter the real-world distance between the two selected points. All measurements on this sheet will update.</p><div class="field-row">${field('Known distance', 'distance', 10, 'number', 'min="0.000001" step="any" required')}${selectField('Units', 'unit', Object.keys(G.UNITS), this.project.settings.unit)}</div>`, 'Calibrate');
            if (f) {
                const distance = Number(f.distance), calibration = { metersPerUnit: distance * G.UNITS[f.unit].m / len, method: 'two-point', points, distance, unit: f.unit, label: `Calibrated · ${distance.toFixed(2)} ${f.unit}` };
                this.history.commit('Calibrate sheet', [this.history.op('pages', this.page, { ...this.pg, calibration })]);
                this.panel = 'measure';
                this.renderLeft();
                this.toast('Scale calibrated. Existing quantities have been recalculated.');
            }
            this.setTool('select');
        }
        else if (type === 'align') {
            try {
                const cfg = this.project.overlay.config, base = this.source.viewport(this.page, 0), dst = points.slice(0, 2).map(p => base.convertToViewportPoint(...p)), inv = G.inverse(this.overlayTransform()), src = points.slice(2).map(p => G.transform(inv, this.toView(p)));
                const fit = G.alignTwoPoints(src[0], src[1], dst[0], dst[1]);
                this.history.commit('Register revision', [this.history.op('overlay', 'config', { ...cfg, ...fit })]);
                this.toast('Revision registered from two corresponding point pairs.');
            }
            catch (e) {
                this.toast(e.message, true);
            }
            this.setTool('select');
        }
        else if (type === 'callout')
            await this.placeText(type, points[1], points);
        else
            this.commitMarkup(this.makeMarkup(type, points));
    }
    cancelGesture() { this.gesture = null; this.draft = null; this.previewEdits.clear(); this.pointers.clear(); this.snapPoint = null; this.invalidate(); }
    deleteSelected() { const ops = this.editable.map(m => this.history.op('markups', m.id, undefined)); if (ops.length)
        this.history.commit('Delete markups', ops);
    else if (this.selection.size)
        this.toast('The selected layer is locked.'); }
    duplicate() { const ops = [], ids = []; for (const m of this.editable) {
        const n = { ...clone(m), id: uid(), points: m.points.map(p => [p[0] + 12, p[1] - 12]), created: new Date().toISOString(), modified: new Date().toISOString() };
        ops.push(this.history.op('markups', n.id, n));
        ids.push(n.id);
    } this.selection = new Set(ids); this.history.commit('Duplicate markups', ops); }
    async openOverlay(bytes, name) { const src = await PdfSource.open(bytes, name); const old = this.overlaySource; this.overlaySource = src; this.project.overlay = { name, config: { visible: true, page: 0, dx: 0, dy: 0, scale: 1, angle: 0, opacity: .8 } }; this.project.revision++; this.history.undoStack = []; this.history.redoStack = []; this.history.bytes = 0; this.assetsSaved = false; this.assetGeneration++; this.panel = 'overlay'; old?.dispose(); this.changed('Revision file loaded'); this.toast('Revision loaded. File replacement starts a new undo history.'); }
    async loadFile(file, overlay = false) {
        if (!file)
            return;
        if (file.size > 150 * 1024 * 1024 && !file.name.endsWith('.planforge')) {
            this.toast('PDF size limit: 150 MiB', true);
            return;
        }
        return this.busy('Opening ' + file.name + '…', async () => {
            if (file.name.toLowerCase().endsWith('.planforge')) {
                const a = await Storage.readArchive(file);
                await this.open(a.pdf, a.project.name, a.project, a.overlay);
            }
            else {
                const bytes = await file.arrayBuffer();
                if (overlay)
                    await this.openOverlay(bytes, file.name);
                else
                    await this.open(bytes, file.name);
            }
        });
    }
    async action(action) {
        if (action === 'open')
            return $('#file-input').click();
        if (action === 'help')
            return this.info('Planforge Review · Workspace guide', `<p class="dialog-note">A working local-first PDF review and quantity-takeoff workspace. PDF pages are parsed by PDF.js in static mode, or by the optional local MuPDF service. WebGPU composites visible tiles; vector markup editing uses SVG.</p><div class="shortcut-grid">` + Object.entries(shortcuts).map(([t, k]) => `<div><kbd>${k}</kbd><span>${labels[t]}</span></div>`).join('') + `<div><kbd>F</kbd><span>Fit page</span></div><div><kbd>Space + drag</kbd><span>Pan</span></div><div><kbd>Enter</kbd><span>Finish polygon / polyline</span></div><div><kbd>Esc</kbd><span>Cancel current operation</span></div><div><kbd>Ctrl/Cmd + Z</kbd><span>Undo</span></div><div><kbd>Ctrl/Cmd + Shift + Z</kbd><span>Redo</span></div><div><kbd>Ctrl/Cmd + S</kbd><span>Export project archive</span></div><div><kbd>Shift + click</kbd><span>Multi-select</span></div><div><kbd>Shift</kbd><span>Constrain to 45°</span></div><div><kbd>Alt</kbd><span>Temporarily disable snapping</span></div><div><kbd>Delete</kbd><span>Delete selected</span></div><div><kbd>Ctrl/Cmd + D</kbd><span>Duplicate selected</span></div></div><p class="notice">Calibrate imported drawings before measuring. This implementation uses one uniform scale per page and simple area polygons without holes. Reports are not certified quantities. Existing PDF content and third-party annotations are displayed, not edited. PDF export excludes comparison overlays; retain a project archive for full editable semantics.</p><p class="tiny">Page rulers show viewport points, not calibrated physical units. Snapping targets existing markup vertices, not the PDF’s source linework. No Bluebeam affiliation or native .bax/.btx/Studio protocol support.</p>`);
        if (!this.project)
            return;
        switch (action) {
            case 'properties':
                await this.mobileProperties();
                break;
            case 'undo':
                this.cancelGesture();
                this.history.undo();
                break;
            case 'redo':
                this.cancelGesture();
                this.history.redo();
                break;
            case 'delete':
                this.deleteSelected();
                break;
            case 'duplicate':
                this.duplicate();
                break;
            case 'fit':
                this.fit();
                break;
            case 'zoomin':
                this.zoom(1.25);
                break;
            case 'zoomout':
                this.zoom(.8);
                break;
            case 'zoomvalue': {
                const f = await this.ask('Zoom', field('Zoom · %', 'zoom', Math.round(this.camera.z * 100), 'number', 'min="4" max="1600" required'));
                if (f)
                    this.zoom(Number(f.zoom) / 100 / this.camera.z);
                break;
            }
            case 'rotate':
                this.history.commit('Rotate page view', [this.history.op('pages', this.page, { ...this.pg, extraRotation: ((this.pg.extraRotation || 0) + 90) % 360 })]);
                this.fit();
                break;
            case 'prev':
                this.go(this.page - 1);
                break;
            case 'next':
                this.go(this.page + 1);
                break;
            case 'sidebar':
                document.body.classList.toggle('body-sidebar');
                this.resize();
                break;
            case 'scope':
                this.scope = this.scope === 'all' ? 'page' : 'all';
                this.renderTable();
                break;
            case 'snap':
                this.snap = !this.snap;
                $('#snap-toggle').textContent = 'SNAP ' + (this.snap ? 'ON' : 'OFF');
                break;
            case 'ledger':
                $('#ledger').classList.toggle('collapsed');
                break;
            case 'measurepanel':
                this.panel = 'measure';
                this.renderLeft();
                document.body.classList.add('body-sidebar');
                break;
            case 'save':
                await this.persist();
                Storage.download(Storage.archive(this.project, this.source.bytes, this.overlaySource?.bytes), this.project.name.replace(/\.pdf$/i, '') + '.planforge');
                this.toast('Project archive exported with original PDF and revision assets.');
                break;
            case 'csv':
                Storage.download(csv(this.filteredRows()), 'planforge-markups.csv', 'text/csv;charset=utf-8');
                break;
            case 'summary': {
                const rows = summarize(this.filteredRows());
                this.info('Quantity summary', `<p class="dialog-note">Grouped by subject, unit, layer and review status. Uncalibrated quantities are excluded. Hidden layers are included unless filtered out.</p><table class="summary-table"><thead><tr><th>Subject</th><th>Quantity</th><th>Status</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.subject)}<div class="tiny">${esc(r.layer)}</div></td><td>${r.quantity.toFixed(2)} ${esc(r.unit)}</td><td>${esc(r.status)}</td></tr>`).join('')}</tbody></table><button class="panel-button" data-action="summarycsv">${icon('export')} Export summary CSV</button>`);
                break;
            }
            case 'summarycsv':
                Storage.download(csv(summarize(this.filteredRows())), 'planforge-quantities.csv', 'text/csv;charset=utf-8');
                break;
            case 'report': {
                const f = await this.ask('Export construction quantities', `<p class="dialog-note">Export the ${this.filteredRows().length} rows currently shown in the Markups List. Clear its filters to include every markup. Detailed CSV preserves markup identities; summary CSV groups compatible quantities.</p>${selectField('Report format', 'format', [['detail', 'Detailed markup ledger · CSV'], ['summary', 'Grouped quantities · CSV'], ['json', 'Structured quantity report · JSON']], 'detail')}`, 'Export report');
                if (f) {
                    const rows = this.filteredRows();
                    if (f.format === 'json')
                        Storage.download(JSON.stringify({ project: this.project.name, generated: new Date().toISOString(), unit: this.project.settings.unit, pages: this.project.pages, rows, summary: summarize(rows) }, null, 2), 'planforge-quantity-report.json', 'application/json');
                    else
                        Storage.download(csv(f.format === 'summary' ? summarize(rows) : rows), 'planforge-' + f.format + '.csv', 'text/csv;charset=utf-8');
                }
                break;
            }
            case 'scale': {
                const current = this.pg.calibration?.ratio || 100;
                const f = await this.ask('Set drawing scale', `<p class="dialog-note">For an undistorted drawing printed at its native PDF page size. A 1:100 drawing means one unit on paper represents 100 of the same units in the building. Two-point calibration is safer for rescaled scans.</p>${field('Scale denominator · 1 :', 'ratio', current, 'number', 'min="0.0001" step="any" required')}`, 'Set scale');
                if (f) {
                    const ratio = Number(f.ratio), u = Math.hypot(...this.source.meta[this.page - 1].transform.slice(0, 2)), calibration = { method: 'ratio', ratio, metersPerUnit: .0254 / 72 * ratio * u, label: 'Scale 1:' + ratio };
                    this.history.commit('Set drawing scale', [this.history.op('pages', this.page, { ...this.pg, calibration })]);
                }
                break;
            }
            case 'allscale': {
                if (!this.pg.calibration) {
                    this.toast('Calibrate the current sheet first.', true);
                    break;
                }
                const f = await this.ask('Apply calibration to every sheet?', `<p class="dialog-note">This copies the current sheet’s physical scale to all ${this.source.meta.length} pages. Use only when the entire set has the same plotted scale. This action can be undone.</p>`, 'Apply to all sheets');
                if (f) {
                    const reference = Math.hypot(...this.source.meta[this.page - 1].transform.slice(0, 2)), c = this.pg.calibration;
                    this.history.commit('Apply scale to all pages', Object.entries(this.project.pages).map(([n, p]) => { const unit = Math.hypot(...this.source.meta[Number(n) - 1].transform.slice(0, 2)); return this.history.op('pages', n, { ...p, calibration: { ...clone(c), metersPerUnit: c.metersPerUnit * unit / reference } }); }));
                }
                break;
            }
            case 'addlayer': {
                const f = await this.ask('Create layer', field('Layer name', 'name', 'New layer', 'text', 'required maxlength="120"') + field('Layer color', 'color', '#7d91bb', 'color'), 'Create layer');
                if (f) {
                    const id = uid();
                    this.history.commit('Create layer', [this.history.op('layers', id, { id, name: f.name, color: f.color, visible: true, locked: false }), this.history.op('settings', 'activeLayer', id)]);
                }
                break;
            }
            case 'savetool': {
                if (this.selected.length !== 1) {
                    this.toast('Select one markup to save it as a reusable tool.');
                    break;
                }
                const m = clone(this.selected[0]), f = await this.ask('Save markup to Tool Chest', field('Tool name', 'name', m.subject, 'text', 'required maxlength="120"'), 'Save tool');
                if (f) {
                    const { type, points, ...style } = m;
                    for (const key of ['id', 'page', 'created', 'modified'])
                        delete style[key];
                    const id = uid(), origin = points[0];
                    this.history.commit('Save reusable tool', [this.history.op('tools', id, { id, name: f.name, type, points: points.map(p => [p[0] - origin[0], p[1] - origin[1]]), style })]);
                    this.panel = 'tools';
                    this.renderLeft();
                }
                break;
            }
            case 'author': {
                const f = await this.ask('Reviewer identity', field('Display name', 'author', this.project.settings.author, 'text', 'required maxlength="120"'), 'Set reviewer');
                if (f)
                    this.history.commit('Set reviewer', [this.history.op('settings', 'author', f.author)]);
                break;
            }
            case 'openoverlay':
                $('#overlay-input').click();
                break;
            case 'demooverlay':
                await this.busy('Opening sample revision…', async () => { const r = await fetch('assets/riverside-revision-b.pdf'); if (!r.ok)
                    throw Error('Missing sample revision'); await this.openOverlay(await r.arrayBuffer(), 'Riverside — Revision B.pdf'); });
                break;
            case 'align':
                if (this.overlaySource && this.project.overlay.config?.visible)
                    this.setTool('align');
                else
                    this.toast('Load and show a revision before registration.');
                break;
            case 'resetoverlay':
                if (this.project.overlay.config)
                    this.history.commit('Reset overlay registration', [this.history.op('overlay', 'config', { ...this.project.overlay.config, dx: 0, dy: 0, scale: 1, angle: 0 })]);
                break;
            case 'demo':
                await this.demo();
                break;
            case 'recent': {
                const list = await Storage.listProjects();
                this.info('Local projects', `<p class="dialog-note">Saved in this browser’s IndexedDB. Export project archives for backups or transfer to another device.</p>` + list.map(p => `<button class="recent" data-restore="${esc(p.id)}"><b>${esc(p.name)}</b><small>${Object.keys(p.pages).length} sheets · ${Object.keys(p.markups).length} markups · ${esc(p.saved || '')}</small></button>`).join(''));
                break;
            }
            case 'exportpdf':
                await this.busy('Exporting review PDF…', async () => { const { exportPDF } = await import('./export.js'); await exportPDF(this); });
                break;
            case 'svg':
                await this.busy('Exporting vector markup snapshot…', async () => { const c = await this.source.thumbnail(this.page, 1800, this.pg.extraRotation || 0), v = this.vp; const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${v.width}" height="${v.height}" viewBox="0 0 ${v.width} ${v.height}"><image width="${v.width}" height="${v.height}" href="${c.toDataURL('image/png')}"/>${this.visible.map(m => svgPrimitives(primitives(m, v, this.pg, this.project.settings.unit))).join('')}</svg>`; Storage.download(svg, `planforge-sheet-${this.page}.svg`, 'image/svg+xml'); });
                break;
        }
    }
    menu(name, target) {
        const menus = { File: [['Open PDF / project…', 'open', 'Ctrl+O'], ['Recent local projects…', 'recent', ''], ['Export project archive', 'save', 'Ctrl+S'], null, ['Export reviewed PDF', 'exportpdf', ''], ['Export sheet SVG', 'svg', ''], ['Export quantity report…', 'report', ''], null, ['Open sample drawing set', 'demo', '']], Edit: [['Undo', 'undo', 'Ctrl+Z'], ['Redo', 'redo', 'Ctrl+Shift+Z'], null, ['Duplicate selected', 'duplicate', 'Ctrl+D'], ['Delete selected', 'delete', 'Delete'], ['Save selected as tool…', 'savetool', '']], View: [['Fit page', 'fit', 'F'], ['Zoom in', 'zoomin', '+'], ['Zoom out', 'zoomout', '−'], ['Rotate page view', 'rotate', ''], null, ['Thumbnails', 'panel:pages', ''], ['Tool Chest', 'panel:tools', ''], ['Layers', 'panel:layers', ''], ['Toggle Markups List', 'ledger', '']], Measure: [['Length', 'tool:length', 'L'], ['Area', 'tool:area', 'A'], ['Count', 'tool:count', 'C'], ['Polyline', 'tool:polyline', 'P'], null, ['Calibrate two points', 'tool:calibrate', 'K'], ['Enter drawing scale…', 'scale', ''], ['Measurement settings', 'measurepanel', '']], Markup: [...['cloud', 'callout', 'rectangle', 'text', 'stamp', 'pen'].map(t => [labels[t], 'tool:' + t, shortcuts[t] || '']), null, ['Review properties…', 'mobileprops', '']], Document: [['Overlay revision…', 'openoverlay', ''], ['Overlay settings', 'panel:overlay', ''], ['Rotate view', 'rotate', ''], null, ['Export review PDF', 'exportpdf', '']], Help: [['Workspace guide & shortcuts', 'help', '?'], ['Reviewer identity…', 'author', '']] };
        const pop = $('#menu-popup');
        pop.innerHTML = menus[name].map(row => row ? `<button data-menu-action="${row[1]}">${row[0]}<small>${row[2]}</small></button>` : '<hr>').join('');
        const r = target.getBoundingClientRect();
        pop.style.left = Math.min(r.left, innerWidth - 240) + 'px';
        pop.style.top = r.bottom + 3 + 'px';
        pop.hidden = false;
    }
    async mobileProperties() { const m = this.selected[0]; if (!m) {
        this.toast('Select a markup first.');
        return;
    } const f = await this.ask('Markup properties', field('Subject', 'subject', m.subject) + field('Comment', 'label', m.label) + field('Color', 'color', m.color, 'color') + selectField('Review status', 'status', STATUSES, m.status)); if (f) {
        if (this.project.layers[m.layer].locked) {
            this.toast('The layer is locked.', true);
            return;
        }
        this.history.commit('Edit properties', [this.history.op('markups', m.id, { ...m, ...f, modified: new Date().toISOString() })]);
    } }
    bind() {
        $('#menus').innerHTML = ['File', 'Edit', 'View', 'Measure', 'Markup', 'Document', 'Help'].map(n => `<button data-menu="${n}">${n}</button>`).join('');
        $('#navigation-tools').innerHTML = ['select', 'hand'].map(t => `<button data-tool="${t}" title="${labels[t]} (${shortcuts[t]})">${icon(t)}</button>`).join('');
        $('#drawing-tools').innerHTML = ['length', 'area', 'count', 'polyline', 'cloud', 'callout', 'stamp'].map(t => `<button data-tool="${t}" title="${labels[t]} (${shortcuts[t]})">${icon(t)}<span class="tool-label">${labels[t]}</span></button>`).join('') + `<button data-tool="pen" title="Freehand (B)">${icon('pen')}</button><button data-tool="text" title="Text (T)">${icon('text')}</button>`;
        $('#status-filter').insertAdjacentHTML('beforeend', options(STATUSES, ''));
        hydrateIcons();
        document.addEventListener('click', async (e) => {
            try {
                const menu = e.target.closest('[data-menu]');
                if (menu) {
                    this.menu(menu.dataset.menu, menu);
                    return;
                }
                const ma = e.target.closest('[data-menu-action]');
                if (ma) {
                    $('#menu-popup').hidden = true;
                    const a = ma.dataset.menuAction;
                    if (a.startsWith('tool:'))
                        this.setTool(a.slice(5));
                    else if (a.startsWith('panel:')) {
                        this.panel = a.slice(6);
                        this.renderLeft();
                        document.body.classList.add('body-sidebar');
                    }
                    else if (a === 'mobileprops')
                        await this.mobileProperties();
                    else
                        await this.action(a);
                    return;
                }
                if (!e.target.closest('#menu-popup'))
                    $('#menu-popup').hidden = true;
                const action = e.target.closest('[data-action]');
                if (action) {
                    await this.action(action.dataset.action);
                    return;
                }
                const tool = e.target.closest('[data-tool]');
                if (tool) {
                    this.setTool(tool.dataset.tool);
                    return;
                }
                const panel = e.target.closest('[data-panel]');
                if (panel) {
                    this.panel = panel.dataset.panel;
                    this.renderLeft();
                    document.body.classList.add('body-sidebar');
                    return;
                }
                const page = e.target.closest('[data-page]');
                if (page) {
                    this.go(Number(page.dataset.page));
                    if (innerWidth < 650)
                        document.body.classList.remove('body-sidebar');
                    return;
                }
                const row = e.target.closest('[data-row]');
                if (row) {
                    const id = row.dataset.row, m = this.project.markups[id];
                    await this.go(m.page);
                    this.setTool('select');
                    if (e.shiftKey)
                        this.selection.add(id);
                    else
                        this.selection = new Set([id]);
                    this.renderInspector();
                    this.renderTable();
                    this.invalidate();
                    return;
                }
                const preset = e.target.closest('[data-preset]');
                if (preset) {
                    const [type, name, color] = this.builtins[+preset.dataset.preset];
                    this.style = { ...defaultStyle, color, subject: name, label: type === 'stamp' ? name : '' };
                    this.setTool(type);
                    return;
                }
                const saved = e.target.closest('[data-saved-tool]');
                if (saved) {
                    const t = this.project.tools[saved.dataset.savedTool];
                    this.setTool(t.type, t);
                    return;
                }
                const lv = e.target.closest('[data-layer-visible]');
                if (lv) {
                    const id = lv.dataset.layerVisible, l = this.project.layers[id];
                    this.history.commit('Toggle layer visibility', [this.history.op('layers', id, { ...l, visible: !l.visible })]);
                    return;
                }
                const lk = e.target.closest('[data-layer-lock]');
                if (lk) {
                    const id = lk.dataset.layerLock, l = this.project.layers[id];
                    this.history.commit('Toggle layer lock', [this.history.op('layers', id, { ...l, locked: !l.locked })]);
                    return;
                }
                const restore = e.target.closest('[data-restore]');
                if (restore) {
                    $('#dialog').close();
                    await this.busy('Restoring project…', async () => { const r = await Storage.loadProject(restore.dataset.restore); await this.open(await r.pdf.arrayBuffer(), r.project.name, r.project, r.overlay ? await r.overlay.arrayBuffer() : null); });
                    return;
                }
            }
            catch (err) {
                console.error(err);
                this.toast(err.message, true);
            }
        });
        $('#left-content').addEventListener('change', e => {
            const t = e.target;
            if (t.dataset.layerActive)
                this.history.commit('Select active layer', [this.history.op('settings', 'activeLayer', t.dataset.layerActive)]);
            else if (t.name === 'displayUnit')
                this.history.commit('Change display units', [this.history.op('settings', 'unit', t.value)]);
            else if (t.name === 'overlay-visible')
                this.history.commit('Toggle revision overlay', [this.history.op('overlay', 'config', { ...this.project.overlay.config, visible: t.checked })]);
            else if (t.name.startsWith('ov-')) {
                const key = t.name.slice(3), value = Number(t.value);
                if (!t.checkValidity() || !Number.isFinite(value))
                    return;
                this.history.commit('Change overlay ' + key, [this.history.op('overlay', 'config', { ...this.project.overlay.config, [key]: value })]);
            }
        });
        $('#inspector').addEventListener('change', e => { if (e.target.dataset.property)
            this.changeProperty(e.target.dataset.property, e.target.value); });
        $('#filter').addEventListener('input', () => this.renderTable());
        $('#status-filter').addEventListener('change', () => this.renderTable());
        const columns = ['subject', 'page', 'type', 'quantity', 'status', 'layer', 'author', 'label'];
        document.querySelectorAll('thead th').forEach((th, i) => { th.title = 'Sort by ' + columns[i]; th.onclick = () => { this.sort = { key: columns[i], dir: this.sort.key === columns[i] ? -this.sort.dir : 1 }; this.renderTable(); }; });
        $('#page-number').addEventListener('change', e => this.go(Number(e.target.value) || 1));
        $('#file-input').onchange = async (e) => { await this.loadFile(e.target.files[0]); e.target.value = ''; };
        $('#overlay-input').onchange = async (e) => { await this.loadFile(e.target.files[0], true); e.target.value = ''; };
        const stage = $('#stage');
        stage.addEventListener('pointerdown', e => this.pointerDown(e));
        stage.addEventListener('pointermove', e => this.pointerMove(e));
        stage.addEventListener('pointerup', e => this.pointerUp(e));
        stage.addEventListener('pointercancel', () => this.cancelGesture());
        stage.addEventListener('dblclick', e => { if (['area', 'polyline'].includes(this.tool)) {
            e.preventDefault();
            this.finishPath();
        }
        else if (this.tool === 'select' && this.selection.size === 1)
            this.mobileProperties(); });
        stage.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(-e.deltaY * .0018), this.eventPoint(e)); }, { passive: false });
        stage.addEventListener('contextmenu', e => { e.preventDefault(); if (this.draft)
            this.finishPath(); });
        stage.addEventListener('dragover', e => { e.preventDefault(); $('#dropzone').hidden = false; });
        stage.addEventListener('dragleave', e => { if (!stage.contains(e.relatedTarget))
            $('#dropzone').hidden = true; });
        stage.addEventListener('drop', e => { e.preventDefault(); $('#dropzone').hidden = true; this.loadFile(e.dataTransfer.files[0]); });
        new ResizeObserver(() => this.resize()).observe(stage);
        const resize = $('#ledger-resize');
        resize.addEventListener('pointerdown', e => { resize.setPointerCapture(e.pointerId); this.ledgerDrag = { y: e.clientY, height: $('#ledger').offsetHeight }; });
        resize.addEventListener('pointermove', e => { if (this.ledgerDrag)
            document.documentElement.style.setProperty('--ledger', G.clamp(this.ledgerDrag.height + this.ledgerDrag.y - e.clientY, 100, innerHeight * .55) + 'px'); });
        resize.addEventListener('pointerup', () => this.ledgerDrag = null);
        window.addEventListener('keydown', e => {
            if (e.target.closest('input,textarea,select,[contenteditable]') || $('#dialog').open)
                return;
            const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
            if (mod) {
                if (['o', 's', 'z', 'y', 'a', 'd', 'c', 'v', '+', '=', '-'].includes(key))
                    e.preventDefault();
                if (key === 'o')
                    this.action('open');
                else if (key === 's')
                    this.action('save');
                else if (key === 'z')
                    this.action(e.shiftKey ? 'redo' : 'undo');
                else if (key === 'y')
                    this.action('redo');
                else if (key === 'a') {
                    this.selection = new Set(this.visible.map(m => m.id));
                    this.renderInspector();
                    this.renderTable();
                    this.invalidate();
                }
                else if (key === 'd')
                    this.duplicate();
                else if (key === 'c')
                    this.clipboard = this.selected.map(clone);
                else if (key === 'v' && this.clipboard.length) {
                    const layer = this.project.layers[this.project.settings.activeLayer];
                    if (layer.locked || !layer.visible)
                        return;
                    const ms = this.clipboard.map(m => ({ ...clone(m), id: uid(), page: this.page, layer: layer.id, points: m.points.map(p => [p[0] + 15, p[1] - 15]), created: new Date().toISOString(), modified: new Date().toISOString() }));
                    this.selection = new Set(ms.map(m => m.id));
                    this.history.commit('Paste markups', ms.map(m => this.history.op('markups', m.id, m)));
                }
                else if (['+', '='].includes(key))
                    this.zoom(1.2);
                else if (key === '-')
                    this.zoom(1 / 1.2);
                return;
            }
            if (key === ' ') {
                e.preventDefault();
                this.space = true;
                stage.style.cursor = 'grab';
                return;
            }
            if (key === 'escape') {
                this.cancelGesture();
                this.setTool('select');
                $('#menu-popup').hidden = true;
                return;
            }
            if (key === 'enter') {
                e.preventDefault();
                this.finishPath();
                return;
            }
            if (['delete', 'backspace'].includes(key)) {
                e.preventDefault();
                this.deleteSelected();
                return;
            }
            if (key === 'pageup') {
                e.preventDefault();
                this.go(this.page - 1);
                return;
            }
            if (key === 'pagedown') {
                e.preventDefault();
                this.go(this.page + 1);
                return;
            }
            if (key === 'f')
                this.fit();
            else if (key === '?')
                this.action('help');
            else {
                const t = Object.entries(shortcuts).find(([, s]) => s.toLowerCase() === key);
                if (t)
                    this.setTool(t[0]);
            }
        });
        window.addEventListener('keyup', e => { if (e.code === 'Space') {
            this.space = false;
            stage.style.cursor = this.tool === 'hand' ? 'grab' : this.tool === 'select' ? 'default' : 'crosshair';
        } });
        window.addEventListener('blur', () => { this.space = false; this.cancelGesture(); });
        document.addEventListener('visibilitychange', () => { if (document.hidden)
            this.persist(); });
        window.addEventListener('pagehide', () => this.persist());
    }
}
const app = new App();
window.planforge = app; // Intentional developer console/test inspection surface.
app.start().catch(e => { console.error(e); app.toast('Startup failed: ' + e.message, true); $('#loading').hidden = true; $('#save-status').textContent = 'Open a PDF to begin'; });
