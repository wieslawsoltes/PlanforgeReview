/** WebGPU compositor: one pass, per-instance affine quads, premultiplied alpha.
 * PDF rasterization is deliberately owned by the real PDF backend, not WGSL.
 */
const SHADER = `
struct Frame { size: vec2f, pad: vec2f };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var image: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f,
 @location(1) tint: vec4f, @location(2) settings: vec4f };
@vertex fn vs(@builtin(vertex_index) vi:u32,@location(0) origin:vec2f,
 @location(1) ux:vec2f,@location(2) uy:vec2f,@location(3) tint:vec4f,@location(4) settings:vec4f)->Out {
 let uv=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(0,1),vec2f(0,1),vec2f(1,0),vec2f(1,1))[vi];
 let p=origin+uv.x*ux+uv.y*uy;
 var o:Out;o.position=vec4f(p.x/frame.size.x*2-1,1-p.y/frame.size.y*2,0,1);o.uv=uv;o.tint=tint;o.settings=settings;return o;
}
@fragment fn fs(i:Out)->@location(0) vec4f {
 let c=textureSample(image,samp,i.uv);let ink=clamp(1-dot(c.rgb,vec3f(.2126,.7152,.0722)),0,1);
 if(i.settings.x>1.5){let a=ink*i.settings.y;return vec4f(i.tint.rgb*a,a);}
 if(i.settings.x>.5){return vec4f(mix(vec3f(1),i.tint.rgb,ink),1);}
 return vec4f(c.rgb*i.settings.y,i.settings.y);
}`;
export class Compositor {
    constructor(canvas, onState = () => { }) { this.canvas = canvas; this.onState = onState; this.cache = new Map(); this.bytes = 0; this.limit = 128 * 1024 * 1024; this.frame = 0; this.mode = 'Initializing'; this.disposed = false; }
    async init() {
        if (new URLSearchParams(location.search).get('renderer') === 'canvas')
            return this.fallback('Canvas 2D · forced');
        try {
            if (!navigator.gpu)
                throw Error('WebGPU unavailable');
            const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
            if (!adapter)
                throw Error('No GPU adapter');
            this.device = await adapter.requestDevice();
            const d = this.device;
            this.context = this.canvas.getContext('webgpu');
            this.format = navigator.gpu.getPreferredCanvasFormat();
            this.context.configure({ device: d, format: this.format, alphaMode: 'opaque' });
            const module = d.createShaderModule({ code: SHADER });
            this.pipeline = await d.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 56, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x2' }, { shaderLocation: 2, offset: 16, format: 'float32x2' }, { shaderLocation: 3, offset: 24, format: 'float32x4' }, { shaderLocation: 4, offset: 40, format: 'float32x4' }] }] }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] }, primitive: { topology: 'triangle-list' } });
            this.uniform = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            this.frameGroup = d.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
            this.sampler = d.createSampler({ minFilter: 'linear', magFilter: 'linear' });
            this.capacity = 0;
            this.mode = 'WebGPU';
            this.onState(this.mode);
            d.addEventListener('uncapturederror', e => { console.error(e.error); this.onState('WebGPU validation error: ' + e.error.message); });
            d.lost.then(info => { if (!this.disposed && this.mode === 'WebGPU')
                this.fallback('Canvas 2D · GPU device lost'); });
            return this;
        }
        catch (e) {
            return this.fallback('Canvas 2D · ' + e.message);
        }
    }
    fallback(reason) {
        this.mode = 'Canvas 2D';
        this.dropAll();
        this.instances?.destroy();
        this.uniform?.destroy();
        this.device?.destroy();
        this.device = null;
        this.instances = null;
        this.uniform = null;
        // A canvas cannot switch context type once a WebGPU context was acquired.
        const next = this.canvas.cloneNode(false);
        this.canvas.replaceWith(next);
        this.canvas = next;
        this.context = this.canvas.getContext('2d', { alpha: false });
        this.mode = 'Canvas 2D';
        this.onState(reason);
        return this;
    }
    resize(w, h, dpr) { this.dpr = dpr; const width = Math.max(1, Math.round(w * dpr)), height = Math.max(1, Math.round(h * dpr)); if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
    } this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'; }
    texture(cmd) {
        let item = this.cache.get(cmd.key);
        if (item) {
            item.last = this.frame;
            return item;
        }
        const d = this.device, texture = d.createTexture({ size: [cmd.canvas.width, cmd.canvas.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
        d.queue.copyExternalImageToTexture({ source: cmd.canvas }, { texture }, [cmd.canvas.width, cmd.canvas.height]);
        const group = d.createBindGroup({ layout: this.pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: texture.createView() }, { binding: 1, resource: this.sampler }] });
        item = { texture, group, last: this.frame, bytes: cmd.canvas.width * cmd.canvas.height * 4 };
        this.cache.set(cmd.key, item);
        this.bytes += item.bytes;
        return item;
    }
    tinted(cmd) {
        if (!cmd.mode)
            return cmd.canvas;
        const key = cmd.key + ':' + cmd.mode;
        let item = this.cache.get(key);
        if (item) {
            item.last = this.frame;
            return item.canvas;
        }
        const c = document.createElement('canvas');
        c.width = cmd.canvas.width;
        c.height = cmd.canvas.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(cmd.canvas, 0, 0);
        const im = ctx.getImageData(0, 0, c.width, c.height), t = cmd.tint;
        for (let i = 0; i < im.data.length; i += 4) {
            const ink = 1 - (im.data[i] * .2126 + im.data[i + 1] * .7152 + im.data[i + 2] * .0722) / 255;
            for (let k = 0; k < 3; k++)
                im.data[i + k] = cmd.mode === 2 ? t[k] * 255 : 255 * (1 - ink + t[k] * ink);
            im.data[i + 3] = cmd.mode === 2 ? ink * 255 : 255;
        }
        ctx.putImageData(im, 0, 0);
        item = { canvas: c, last: this.frame, bytes: c.width * c.height * 4 };
        this.bytes += item.bytes;
        this.cache.set(key, item);
        return c;
    }
    render(commands) {
        this.frame++;
        if (this.mode === 'WebGPU') {
            const d = this.device, n = commands.length;
            if (n > this.capacity) {
                this.instances?.destroy();
                this.capacity = Math.max(64, 2 ** Math.ceil(Math.log2(n)));
                this.instances = d.createBuffer({ size: this.capacity * 56, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
            }
            const data = new Float32Array(n * 14);
            commands.forEach((c, i) => data.set([...c.origin.map(v => v * this.dpr), ...c.ux.map(v => v * this.dpr), ...c.uy.map(v => v * this.dpr), ...(c.tint || [1, 1, 1]), 1, c.mode || 0, c.opacity ?? 1, 0, 0], i * 14));
            d.queue.writeBuffer(this.uniform, 0, new Float32Array([this.canvas.width, this.canvas.height, 0, 0]));
            if (n)
                d.queue.writeBuffer(this.instances, 0, data);
            const textures = commands.map(c => this.texture(c));
            const encoder = d.createCommandEncoder();
            const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: { r: .125, g: .145, b: .168, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
            pass.setPipeline(this.pipeline);
            pass.setBindGroup(0, this.frameGroup);
            if (n)
                pass.setVertexBuffer(0, this.instances);
            textures.forEach((t, i) => { pass.setBindGroup(1, t.group); pass.draw(6, 1, 0, i); });
            pass.end();
            d.queue.submit([encoder.finish()]);
        }
        else {
            const c = this.context;
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.fillStyle = '#20252b';
            c.fillRect(0, 0, this.canvas.width, this.canvas.height);
            for (const cmd of commands) {
                const im = this.tinted(cmd), d = this.dpr;
                c.setTransform(cmd.ux[0] * d / im.width, cmd.ux[1] * d / im.width, cmd.uy[0] * d / im.height, cmd.uy[1] * d / im.height, cmd.origin[0] * d, cmd.origin[1] * d);
                c.globalAlpha = cmd.opacity ?? 1;
                c.drawImage(im, 0, 0);
            }
            c.globalAlpha = 1;
        }
        if (this.bytes > this.limit)
            for (const [key, t] of [...this.cache].sort((a, b) => a[1].last - b[1].last)) {
                if (this.bytes <= this.limit || t.last === this.frame)
                    break;
                this.drop(key);
            }
    }
    drop(key) { const t = this.cache.get(key); if (t) {
        t.texture?.destroy();
        this.bytes -= t.bytes;
        this.cache.delete(key);
    } }
    dropAll() { for (const k of this.cache.keys())
        this.drop(k); }
    dispose() { this.disposed = true; this.dropAll(); this.instances?.destroy(); this.uniform?.destroy(); this.device?.destroy(); }
}
