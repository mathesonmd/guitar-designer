// Loads the artifact build the way the claude.ai viewer serves it (page content wrapped in the viewer's
// document skeleton) with a stand-in for the viewer's "downloads" capability, and checks that saving
// goes through it. Usage: node test/viewer.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, out, fetched } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const content = fs.readFileSync(path.join(root, 'dist/artifact.html'), 'utf8');
// the skeleton the Artifact tool wraps a page in: charset + viewport meta and a small reset
const skeleton = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>'
  + ':root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}'
  + '</style></head><body>' + content + '</body></html>';
fs.writeFileSync(path.join(root, 'dist/_viewer-test.html'), skeleton);

const results = [];
const check = (ok, msg) => { results.push({ ok, msg }); console.log((ok ? 'PASS  ' : 'FAIL  ') + msg); };

// page content rules the Artifact tool sets
check(content.trimStart().startsWith('<title>Black Chapel Guitar Designer</title>'), 'page starts with its <title>');
check(/<meta name="claude:viewport-fit-sides" content="cover">/.test(content), 'viewport-fit-sides meta is present');
check(!/<!doctype|<html|<head|<body/i.test(content), 'no document tags of its own');
const srcs = [...content.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
check(srcs.length === 5 && srcs.every((u) => /^https:\/\/(cdnjs\.cloudflare\.com\/ajax\/libs\/[^/]+\/\d+\.\d+\.\d+\/|cdn\.jsdelivr\.net\/npm\/[^@/]+@\d+\.\d+\.\d+\/)/.test(u)), 'five libraries, each from an allowed CDN at an exact version');
check(!/https?:\/\/(?!cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com|www\.w3\.org|blackchapelstudios\.com|www\.blackchapelstudios\.com|warmoth\.com|www\.stewmac\.com|www\.fralinpickups\.com|docs\.hipshotproducts\.com|www\.wood-database\.com|www\.amanatool\.com)[a-z0-9.-]+/i.test(content.replace(/href="https:[^"]+"/g, '')), 'nothing else is loaded from another site');
check(content.length < 16 * 1024 * 1024, `page is ${(content.length / 1024).toFixed(0)} KB`);

const init = () => {
  window.__saves = []; window.__mode = 'accept';
  window.claude = {
    use: (name) => new Promise((res) => setTimeout(() => res(name === 'downloads' ? {
      save: async ({ filename, data }) => {
        if (window.__mode === 'decline') { const e = new Error('declined'); e.code = 'declined'; throw e; }
        const ext = filename.split('.').pop();
        if (!['gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov', 'txt', 'json', 'md', 'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip', 'fig'].includes(ext)) { const e = new Error('ext'); e.code = 'rejected_extension'; throw e; }
        const kind = typeof data === 'string' ? 'string' : data instanceof Blob ? 'blob' : data instanceof ArrayBuffer ? 'arraybuffer' : 'other';
        const size = typeof data === 'string' ? data.length : data.size !== undefined ? data.size : data.byteLength;
        let head = '';
        if (data instanceof Blob) head = Array.from(new Uint8Array(await data.slice(0, 4).arrayBuffer())).map((b) => b.toString(16).padStart(2, '0')).join('');
        window.__saves.push({ filename, kind, size, head });
        return { status: 'saved' };
      },
    } : null), 30)),
  };
};

const { page, browser, errors } = await open({ file: 'dist/_viewer-test.html', init });
let anchorDownloads = 0;
page.on('download', () => { anchorDownloads++; });
const toast = async (re) => { for (let i = 0; i < 40; i++) { const t = await page.evaluate(() => { const e = document.querySelector('.toast'); return e ? e.innerText : ''; }); if (re.test(t)) return t; await page.waitForTimeout(100); } return null; };

const box = await page.evaluate(() => { const a = document.querySelector('.app').getBoundingClientRect(); return { w: a.width, h: a.height, iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight }; });
check(Math.abs(box.w - box.iw) < 1 && Math.abs(box.h - box.ih) < 1 && box.sw <= box.iw && box.sh <= box.ih, `fills the viewer frame exactly (${box.w} × ${box.h} in ${box.iw} × ${box.ih})`);
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check(bg === 'rgb(20, 18, 16)', 'body paints its own dark background: ' + bg);
check(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme) === 'dark', 'color-scheme is dark, so form controls match');

await page.click('.top .seg[aria-label="View"] button:has-text("Templates")');
await page.waitForTimeout(1200);
check(await page.locator('.tbar button:text-is("DXF")').count() === 0, 'the lone DXF button is hidden in the viewer (it cannot save .dxf); the pack carries the DXF');
await page.click('.tbar button:has-text("Save template pack")');
check(!!(await toast(/Saved untitled-guitar-template-pack\.zip/)), 'template pack saved through the viewer');
await page.click('.tbar button:text-is("SVG")');
check(!!(await toast(/Saved untitled-guitar-templates\.svg/)), 'SVG saved through the viewer');
await page.click('.tbar button:text-is("PDF, Letter")');
check(!!(await toast(/Saved untitled-guitar-templates-letter\.pdf/)), 'PDF saved through the viewer');
await page.click('.menuwrap > button'); await page.click('.menu button:has-text("Save this design")');
check(!!(await toast(/Saved untitled-guitar\.guitar\.json/)), 'design file saved through the viewer');
const saves = await page.evaluate(() => window.__saves);
check(saves.length === 4 && saves[0].kind === 'blob' && saves[0].head === '504b0304' && saves[0].size > 100000, `pack handed over as a zip blob (${saves[0] ? (saves[0].size / 1024).toFixed(0) : '?'} KB)`);
check(saves[1] && saves[1].kind === 'string' && saves[2].kind === 'blob' && saves[2].head === '25504446' && saves[3].kind === 'string', 'SVG and design as text, PDF as a blob starting %PDF');
await page.click('.menuwrap > button'); await page.click('.menu button:has-text("Save files for CNC")');
const model = page.locator('.dialog[aria-label="Save files for CNC"]');
await model.locator('button:has-text("Save CNC vectors (.zip)")').click();
check(!!(await toast(/Saved untitled-guitar-cnc-vectors\.zip/)), 'the CNC vector pack saves through the viewer (a zip can carry the DXF files)');
check(/Saving a 3D model does not work inside claude\.ai/.test(await model.innerText()) && await model.locator('button:has-text("Save 3D model (.step)")').count() === 0, 'the 3D model dialog says it cannot save inside claude.ai and offers no button that would fail');
check(fetched.length === 0, 'the viewer build never fetches the 3D engine');
await page.keyboard.press('Escape');
await page.evaluate(() => { window.__mode = 'decline'; });
await page.click('.top .seg[aria-label="View"] button:has-text("Templates")');
await page.click('.tbar button:text-is("SVG")');
check(!!(await toast(/Save canceled/)), 'a declined save says so and nothing else happens');
check(anchorDownloads === 0, 'no download was started by the page itself');
check(errors.length === 0, 'no console errors: ' + errors.join(' | '));
await page.screenshot({ path: path.join(out, 'viewer.png') });
await browser.close();
fs.rmSync(path.join(root, 'dist/_viewer-test.html'));
const bad = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - bad} of ${results.length} passed`);
process.exit(bad ? 1 : 0);
