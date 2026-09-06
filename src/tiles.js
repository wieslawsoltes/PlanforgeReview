import { transform, inverse, bounds, clamp } from './geometry.js';
/** Visible-only tile rasterization. Quantized resolution, LRU, stale-job cancellation. */
export class TileEngine {
    constructor(onReady, onError = console.error) { this.onReady = onReady; this.onError = onError; this.cache = new Map(); this.pending = new Map(); this.queue = []; this.active = 0; this.bytes = 0; this.limit = 96 * 1024 * 1024; this.tick = 0; this.previews = new Map(); this.needed = new Set(); this.errors = new Set(); }
    begin() { this.tick++; this.needed.clear(); this.queue = []; }
    async preview(source, page, rotation) {
        const key = `${source.key}/${page}/${rotation}/preview`;
        if (this.previews.has(key))
            return this.previews.get(key);
        this.previews.set(key, null);
        try {
            const canvas = await source.thumbnail(page, 1000, rotation);
            if (source.disposed)
                return null;
            const item = { canvas, key };
            this.previews.set(key, item);
            // Keep only eight low-resolution fallbacks; thumbnail images live separately.
            while (this.previews.size > 8)
                this.previews.delete(this.previews.keys().next().value);
            this.onReady();
            return item;
        }
        catch (e) {
            this.previews.delete(key);
            this.onError(e);
            return null;
        }
    }
    layer(source, page, rotation, camera, stage, matrix = [1, 0, 0, 1, 0, 0], style = {}) {
        const vp = source.viewport(page, rotation), z = camera.z, dpr = Math.min(devicePixelRatio || 1, 2.5);
        const mag = Math.hypot(matrix[0], matrix[1]);
        const scale = clamp(2 ** (Math.ceil(Math.log2(z * dpr * mag) * 2) / 2), .125, 8);
        const inv = inverse(matrix), points = [[0, 0], [stage.w, 0], [stage.w, stage.h], [0, stage.h]].map(p => transform(inv, [(p[0] - camera.x) / z, (p[1] - camera.y) / z]));
        const b = bounds(points), xmin = Math.max(0, Math.floor(b.x * scale / 512)), xmax = Math.min(Math.ceil(vp.width * scale / 512) - 1, Math.floor((b.x + b.w) * scale / 512));
        const ymin = Math.max(0, Math.floor(b.y * scale / 512)), ymax = Math.min(Math.ceil(vp.height * scale / 512) - 1, Math.floor((b.y + b.h) * scale / 512));
        const make = (canvas, key, x, y, w, h) => { const o = transform(matrix, [x, y]), rx = transform(matrix, [x + w, y]), ry = transform(matrix, [x, y + h]); return { canvas, key, origin: [camera.x + o[0] * z, camera.y + o[1] * z], ux: [(rx[0] - o[0]) * z, (rx[1] - o[1]) * z], uy: [(ry[0] - o[0]) * z, (ry[1] - o[1]) * z], ...style }; };
        const key = `${source.key}/${page}/${rotation}/preview`, preview = this.previews.get(key);
        if (!this.previews.has(key))
            this.preview(source, page, rotation);
        const commands = [], fallback = preview ? make(preview.canvas, key, 0, 0, vp.width, vp.height) : null;
        let missing = false;
        for (let ty = ymin; ty <= ymax; ty++)
            for (let tx = xmin; tx <= xmax; tx++) {
                const x = tx * 512, y = ty * 512, w = Math.min(512, Math.ceil(vp.width * scale) - x), h = Math.min(512, Math.ceil(vp.height * scale) - y);
                const id = `${source.key}/${page}/${rotation}/${scale}/${tx}/${ty}`;
                this.needed.add(id);
                const cached = this.cache.get(id);
                if (cached) {
                    cached.last = this.tick;
                    commands.push(make(cached.canvas, id, x / scale, y / scale, w / scale, h / scale));
                }
                else {
                    missing = true;
                    if (!this.pending.has(id) && !this.errors.has(id))
                        this.queue.push({ id, source, page, scale, x, y, w, h, rotation, priority: Math.hypot((tx - (xmin + xmax) / 2), (ty - (ymin + ymax) / 2)) });
                }
            }
        if (style.mode === 2 && missing)
            return fallback ? [fallback] : []; // Never double-blend coarse and fine revision layers.
        if (fallback && style.mode !== 2)
            commands.unshift(fallback);
        return commands;
    }
    end() {
        for (const [id, job] of this.pending)
            if (!this.needed.has(id))
                job.controller.abort();
        this.queue.sort((a, b) => a.priority - b.priority);
        this.pump();
        if (this.bytes > this.limit)
            for (const [id, t] of [...this.cache].sort((a, b) => a[1].last - b[1].last)) {
                if (this.bytes <= this.limit)
                    break;
                if (this.needed.has(id))
                    continue;
                this.bytes -= t.bytes;
                this.cache.delete(id);
            }
    }
    pump() {
        while (this.active < 2 && this.queue.length) {
            const job = this.queue.shift();
            if (this.pending.has(job.id) || this.cache.has(job.id) || !this.needed.has(job.id))
                continue;
            this.active++;
            job.controller = new AbortController();
            this.pending.set(job.id, job);
            job.source.renderTile(job.page, job.scale, job.x, job.y, job.w, job.h, job.rotation, job.controller.signal).then(canvas => {
                if (job.controller.signal.aborted || job.source.disposed)
                    return;
                const bytes = canvas.width * canvas.height * 4;
                this.cache.set(job.id, { canvas, bytes, last: this.tick });
                this.bytes += bytes;
            }).catch(e => { if (!['AbortError', 'RenderingCancelledException'].includes(e.name)) {
                this.errors.add(job.id);
                this.onError(e);
            } }).finally(() => { this.active--; this.pending.delete(job.id); this.onReady(); this.pump(); });
        }
    }
    clear() { this.queue = []; for (const p of this.pending.values())
        p.controller.abort(); this.cache.clear(); this.previews.clear(); this.errors.clear(); this.bytes = 0; }
}
