// Loads the built page in headless Chromium with the CDN libraries served from node_modules, so the
// exact files the CDNs publish are exercised. Screenshots and downloads go to test-output/ unless a
// folder is given. Usage: node test/browser.mjs [outdir]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const out = process.argv[2] || path.join(root, 'test-output');
const LOCAL = {
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js': 'node_modules/react/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js': 'node_modules/three/build/three.min.js',
  'https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js': 'node_modules/clipper-lib/clipper.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js': 'node_modules/jspdf/dist/jspdf.umd.min.js',
};
export async function open({ width = 1440, height = 900, file = 'dist/index.html', init = null } = {}) {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (LOCAL[u]) return route.fulfill({ path: path.join(root, LOCAL[u]), contentType: 'application/javascript' });
    if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
    if (u.includes('fonts.googleapis.com')) return route.fulfill({ body: '', contentType: 'text/css' });
    return route.abort();
  });
  if (init) await page.addInitScript(init);
  await page.goto('file://' + path.join(root, file));
  await page.waitForSelector('.app', { timeout: 15000 });
  await page.waitForTimeout(700);
  return { browser, page, errors };
}
if (import.meta.url === 'file://' + process.argv[1]) {
  fs.mkdirSync(out, { recursive: true });
  const { browser, page, errors } = await open();
  await page.screenshot({ path: path.join(out, 'design.png') });
  await page.click('.top .seg button:has-text("3D")'); await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, 'view3d.png') });
  await page.click('.top .seg button:has-text("Templates")'); await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(out, 'templates.png') });
  console.log('errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
}
