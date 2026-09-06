import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.png': 'image/png', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };
http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        const rel = decodeURIComponent(url.pathname);
        const file = path.resolve(root, '.' + (rel === '/' ? '/index.html' : rel));
        if (!file.startsWith(root + path.sep)) {
            res.writeHead(403);
            return res.end();
        }
        const s = await stat(file);
        if (!s.isFile())
            throw Error('Not a file');
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': s.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
        createReadStream(file).pipe(res);
    }
    catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
}).listen(Number(process.env.PORT || 8080), '127.0.0.1', () => console.log(`Planforge Review — http://localhost:${process.env.PORT || 8080}`));
