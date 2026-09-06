/** Assemble a self-contained GitHub Pages site without a bundler or CDN dependency. */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const pdfjs = JSON.parse(await readFile(path.join(root, 'node_modules/pdfjs-dist/package.json'), 'utf8'));
if (pdfjs.version !== pkg.dependencies['pdfjs-dist']) throw Error('PDF.js package/worker version mismatch');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const name of ['index.html', 'style.css', 'src', 'LICENSE', 'THIRD_PARTY_NOTICES.md'])
    await cp(path.join(root, name), path.join(out, name), { recursive: true });
await mkdir(path.join(out, 'assets'));
for (const name of ['icon.svg', 'riverside-drawing-set.pdf', 'riverside-revision-b.pdf'])
    await cp(path.join(root, 'assets', name), path.join(out, 'assets', name));
// This marker disables optional server discovery. User PDFs stay in the browser.
const index = await readFile(path.join(out, 'index.html'), 'utf8');
await writeFile(path.join(out, 'index.html'), index.replace('<html lang="en">', '<html lang="en" data-pdf-backend="pdfjs">'));
const target = path.join(out, 'node_modules/pdfjs-dist');
await mkdir(path.join(target, 'build'), { recursive: true });
for (const name of ['pdf.mjs', 'pdf.worker.mjs'])
    await cp(path.join(root, 'node_modules/pdfjs-dist/build', name), path.join(target, 'build', name));
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'LICENSE'])
    await cp(path.join(root, 'node_modules/pdfjs-dist', name), path.join(target, name), { recursive: true });
await mkdir(path.join(out, 'node_modules/pdf-lib/dist'), { recursive: true });
for (const name of ['dist/pdf-lib.min.js', 'LICENSE.md'])
    await cp(path.join(root, 'node_modules/pdf-lib', name), path.join(out, 'node_modules/pdf-lib', name));
await writeFile(path.join(out, '.nojekyll'), '');
await writeFile(path.join(out, 'build.json'), JSON.stringify({
    name: pkg.name, version: pkg.version, commit: process.env.GITHUB_SHA || null,
    pdfjs: pdfjs.version, pdfLib: pkg.dependencies['pdf-lib'], backend: 'browser-only'
}, null, 2) + '\n');
console.log(`Built ${out} with PDF.js ${pdfjs.version}; all runtime assets are same-origin.`);
