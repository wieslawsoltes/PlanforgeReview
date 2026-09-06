import { validateProject } from './model.js';
const DB = 'planforge-review-v1';
export async function database() { return new Promise((resolve, reject) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => { r.result.createObjectStore('projects', { keyPath: 'id' }); r.result.createObjectStore('assets'); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function txRun(stores, mode, fn) { const db = await database(); try {
    return await new Promise((resolve, reject) => { const tx = db.transaction(stores, mode); let value; try {
        value = fn(tx);
    }
    catch (e) {
        tx.abort();
        reject(e);
        return;
    } tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || Error('Storage transaction aborted')); });
}
finally {
    db.close();
} }
export async function saveProject(project, pdfBytes, overlayBytes) {
    const p = structuredClone(project);
    p.saved = new Date().toISOString();
    await txRun(['projects', 'assets'], 'readwrite', tx => {
        tx.objectStore('projects').put(p);
        if (pdfBytes)
            tx.objectStore('assets').put(new Blob([pdfBytes], { type: 'application/pdf' }), p.id + ':pdf');
        if (overlayBytes)
            tx.objectStore('assets').put(new Blob([overlayBytes], { type: 'application/pdf' }), p.id + ':overlay');
    });
    localStorage.setItem('planforge-last', p.id);
    return p.saved;
}
export async function listProjects() { const db = await database(); return new Promise((resolve, reject) => { const tx = db.transaction('projects'), r = tx.objectStore('projects').getAll(); r.onsuccess = () => resolve(r.result.sort((a, b) => (b.saved || '').localeCompare(a.saved || ''))); r.onerror = () => reject(r.error); tx.oncomplete = () => db.close(); }); }
export async function loadProject(id) { const db = await database(); return new Promise((resolve, reject) => { const tx = db.transaction(['projects', 'assets']), p = tx.objectStore('projects').get(id), a = tx.objectStore('assets').get(id + ':pdf'), o = tx.objectStore('assets').get(id + ':overlay'); tx.oncomplete = () => { db.close(); if (!p.result || !a.result)
    return reject(Error('Project is missing its PDF asset')); resolve({ project: validateProject(p.result), pdf: a.result, overlay: o.result }); }; tx.onerror = () => { db.close(); reject(tx.error); }; }); }
export function download(data, name, type = 'application/octet-stream') {
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })), a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
// Binary archive, not giant base64 JSON. [magic:8][headerLength:u32 LE][JSON][PDF][overlay PDF].
const MAGIC = 'PLNFRG01';
export function archive(project, pdfBytes, overlayBytes) {
    const meta = { project, pdfLength: pdfBytes.byteLength, overlayLength: overlayBytes?.byteLength || 0 };
    const json = new TextEncoder().encode(JSON.stringify(meta)), head = new Uint8Array(12);
    head.set(new TextEncoder().encode(MAGIC));
    new DataView(head.buffer).setUint32(8, json.length, true);
    return new Blob([head, json, pdfBytes, ...(overlayBytes ? [overlayBytes] : [])], { type: 'application/x-planforge' });
}
export async function readArchive(file) {
    if (file.size > 350 * 1024 * 1024)
        throw Error('Archive limit: 350 MiB');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length < 12 || new TextDecoder().decode(bytes.slice(0, 8)) !== MAGIC)
        throw Error('Not a Planforge archive');
    const n = new DataView(bytes.buffer).getUint32(8, true);
    if (n > 32 * 1024 * 1024 || n + 12 > bytes.length)
        throw Error('Corrupt archive header');
    const meta = JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + n)));
    validateProject(meta.project);
    if (!Number.isSafeInteger(meta.pdfLength) || !Number.isSafeInteger(meta.overlayLength) || meta.pdfLength <= 0 || meta.overlayLength < 0 || 12 + n + meta.pdfLength + meta.overlayLength !== bytes.length)
        throw Error('Corrupt archive asset lengths');
    const start = 12 + n;
    return { project: meta.project, pdf: bytes.slice(start, start + meta.pdfLength), overlay: meta.overlayLength ? bytes.slice(start + meta.pdfLength) : null };
}
