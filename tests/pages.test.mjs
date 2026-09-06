import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const read = name => readFile(path.join(root, name), 'utf8');
test('Pages artifact contains a browser-only entry point with relative asset URLs', async () => {
    const html = await read('index.html');
    assert.match(html, /data-pdf-backend="pdfjs"/);
    assert.doesNotMatch(html, /(?:src|href)=["']\//);
    assert.match(await read('src/pdf.js'), /dataset\.pdfBackend/);
    assert.match(await read('src/pdf.js'), /\.\.\/node_modules\/pdfjs-dist\/build\/pdf\.mjs/);
});
test('PDF parser, matching worker, exporter and original sample drawings are bundled', async () => {
    for (const f of ['node_modules/pdfjs-dist/build/pdf.mjs', 'node_modules/pdfjs-dist/build/pdf.worker.mjs',
        'node_modules/pdf-lib/dist/pdf-lib.min.js', 'node_modules/pdfjs-dist/LICENSE',
        'node_modules/pdf-lib/LICENSE.md', 'assets/riverside-drawing-set.pdf', 'assets/riverside-revision-b.pdf'])
        assert.ok((await stat(path.join(root, f))).size > 0, f);
    for (const dir of ['cmaps', 'standard_fonts', 'wasm'])
        assert.ok((await readdir(path.join(root, 'node_modules/pdfjs-dist', dir))).length > 0);
    const info = JSON.parse(await read('build.json'));
    assert.equal(info.backend, 'browser-only');
    assert.ok((await read('node_modules/pdfjs-dist/build/pdf.mjs')).includes(info.pdfjs));
    assert.ok((await read('node_modules/pdfjs-dist/build/pdf.worker.mjs')).includes(info.pdfjs));
});
test('Pages artifact excludes local servers, tests and development files', async () => {
    for (const f of ['server.py', 'server.mjs', '.git', '.github', 'tests', 'assets/generate_demo.py'])
        await assert.rejects(stat(path.join(root, f)), { code: 'ENOENT' });
    assert.ok((await stat(path.join(root, '.nojekyll'))).isFile());
});
