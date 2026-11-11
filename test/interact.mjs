// Drives the built page the way a person would, in headless Chromium, and checks what the design
// document, the screen and the downloaded files end up as. Usage: node test/interact.mjs [outdir]
import fs from 'node:fs';
import path from 'node:path';
import { open, out, fetched } from './browser.mjs';

fs.mkdirSync(out, { recursive: true });
const dl = path.join(out, 'downloads');
fs.rmSync(dl, { recursive: true, force: true });
fs.mkdirSync(dl, { recursive: true });

const results = [];
let page, browser, errors;
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg || 'value'}: expected ${b} ± ${tol}, got ${a}`);
async function step(name, fn) {
  const before = errors.length;
  try {
    const note = await fn();
    const fresh = errors.slice(before);
    if (fresh.length) throw new Error('console: ' + fresh.join(' | '));
    results.push({ name, ok: true, note: note || '' });
  } catch (e) {
    results.push({ name, ok: false, note: String(e && e.message ? e.message : e).split('\n')[0] });
    try { await page.screenshot({ path: path.join(out, 'fail-' + results.length + '.png') }); } catch (x) { /* ignore */ }
  }
}
const settle = (ms = 900) => page.waitForTimeout(ms);
const state = async () => { await settle(800); return page.evaluate(() => JSON.parse(localStorage.getItem('bcs.gd.design'))); };
const view = () => page.evaluate(() => {
  const svg = document.querySelector('.stage svg.draw');
  const m = svg.querySelector('g').getAttribute('transform').match(/translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)/);
  const r = svg.getBoundingClientRect();
  return { tx: +m[1], ty: +m[2], s: +m[3], left: r.left, top: r.top, w: r.width, h: r.height };
});
const toScreen = async (x, y) => { const v = await view(); return { x: v.left + v.tx + x * v.s, y: v.top + v.ty - y * v.s, s: v.s }; };
const dragWorld = async (from, to, opts = {}) => {
  const a = await toScreen(from.x, from.y), b = await toScreen(to.x, to.y);
  await page.mouse.move(a.x, a.y);
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6);
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
};
const openSec = async (id) => {
  const btn = page.locator(`section[data-sec="${id}"] > h3 button`);
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
};
const tab = (label) => page.click(`.top .seg[aria-label="View"] button:has-text("${label}")`);
const toastText = async () => { try { return await page.locator('.toast').first().innerText({ timeout: 2500 }); } catch (e) { return ''; } };
// waits for a message matching the pattern; returns the last message seen either way
const waitToast = async (re) => {
  let last = '';
  for (let i = 0; i < 30; i++) {
    last = await page.evaluate(() => { const t = document.querySelector('.toast'); return t ? t.innerText : ''; });
    if (re.test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`message not shown: wanted ${re}, last saw "${last}"`);
};
const setField = async (selector, text) => { const f = page.locator(selector); await f.click(); await f.fill(text); await f.press('Enter'); };
const saveDownload = async (trigger, timeout = 20000) => {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout }), trigger()]);
  const p = path.join(dl, d.suggestedFilename());
  await d.saveAs(p);
  return p;
};
const findings = () => page.evaluate(() => [...document.querySelectorAll('.rail .find')].map((f) => ({ level: f.className.replace('find ', ''), title: f.querySelector('.ti').innerText })));

({ page, browser, errors } = await open());
page.on('console', (m) => { if (m.type() === 'warning' && /React|Warning/.test(m.text())) errors.push('warning: ' + m.text()); });

/* ------------------------------------------------------------------ outline editing */
await step('page loads with the default design and no problems to fix', async () => {
  const d = await state();
  assert(d && d.schema === 'blackchapel.guitar/v1', 'design saved to browser storage');
  const f = await findings();
  assert(f.length > 8, 'checks listed');
  assert(f.filter((x) => x.level === 'warn').length === 0, 'no warnings on the starting design: ' + f.filter((x) => x.level === 'warn').map((x) => x.title).join('; '));
  return `${f.length} checks, 0 to fix`;
});

await step('clicking the outline shows its points; dragging a point reshapes it; undo and redo work', async () => {
  const d0 = await state();
  const n7 = d0.outline.nodes[7];
  const p = await toScreen(n7.x, n7.y);
  await page.mouse.click(p.x, p.y);
  const count = await page.locator('.stage [data-k="node"]').count();
  assert(count === d0.outline.nodes.length, `expected ${d0.outline.nodes.length} points on screen, saw ${count}`);
  await dragWorld(n7, { x: n7.x + 12, y: n7.y - 20 });
  const d1 = await state();
  near(d1.outline.nodes[7].x, n7.x + 12, 0.8, 'dragged x'); near(d1.outline.nodes[7].y, n7.y - 20, 0.8, 'dragged y');
  await page.click('button[aria-label="Undo"]');
  const d2 = await state();
  near(d2.outline.nodes[7].y, n7.y, 1e-6, 'undo restores');
  await page.click('button[aria-label="Redo"]');
  const d3 = await state();
  near(d3.outline.nodes[7].y, n7.y - 20, 0.8, 'redo reapplies');
  await page.click('button[aria-label="Undo"]');
  return `point moved ${(d1.outline.nodes[7].y - n7.y).toFixed(1)} mm and back`;
});

await step('double-click adds a point without changing the shape; Delete removes it; Smooth and Corner switch', async () => {
  const d0 = await state();
  const area0 = await page.evaluate(() => document.querySelector('section[data-sec="shape"] .hint').innerText);
  const a = d0.outline.nodes[7], b = d0.outline.nodes[8];
  // a point part-way along the curve between nodes 7 and 8
  const bez = (t) => { const p0 = a, p1 = { x: a.x + a.ox, y: a.y + a.oy }, p2 = { x: b.x + b.ix, y: b.y + b.iy }, p3 = b, u = 1 - t; return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y }; };
  const m = bez(0.5), s = await toScreen(m.x, m.y);
  await page.mouse.click(s.x, s.y); // make sure the outline is selected
  await page.mouse.dblclick(s.x, s.y);
  const d1 = await state();
  assert(d1.outline.nodes.length === d0.outline.nodes.length + 1, 'one point added');
  near(d1.outline.nodes[8].x, m.x, 1.2, 'new point x'); near(d1.outline.nodes[8].y, m.y, 1.2, 'new point y');
  const area1 = await page.evaluate(() => document.querySelector('section[data-sec="shape"] .hint').innerText);
  assert(area0 === area1, 'body size unchanged by adding a point');
  assert(await page.locator('.float .seg button.on').innerText() === 'Smooth', 'new point is smooth');
  await page.click('.float .seg button:has-text("Corner")');
  assert((await state()).outline.nodes[8].k === 'c', 'made a corner');
  await page.click('.float .seg button:has-text("Smooth")');
  assert((await state()).outline.nodes[8].k === 's', 'made smooth again');
  await page.locator('.stage svg.draw').focus();
  await page.keyboard.press('Delete');
  const d2 = await state();
  assert(d2.outline.nodes.length === d0.outline.nodes.length, 'point removed with Delete');
  for (let i = 0; i < 4; i++) await page.click('button[aria-label="Undo"]');
  const d3 = await state();
  assert(JSON.stringify(d3.outline) === JSON.stringify(d0.outline), 'four undos return to the starting outline');
});

await step('dragging a curve handle bends the outline and keeps a smooth point smooth', async () => {
  const d0 = await state();
  const n = d0.outline.nodes[7];
  const p = await toScreen(n.x, n.y);
  await page.mouse.click(p.x, p.y); // select outline
  await page.mouse.click(p.x, p.y); // select the point
  assert(await page.locator('.stage [data-k="hout"]').count() === 1, 'handle shown');
  await dragWorld({ x: n.x + n.ox, y: n.y + n.oy }, { x: n.x + n.ox + 10, y: n.y + n.oy + 15 });
  const m = (await state()).outline.nodes[7];
  near(m.ox, n.ox + 10, 1, 'handle x'); near(m.oy, n.oy + 15, 1, 'handle y');
  const cross = m.ox * m.iy - m.oy * m.ix, dot = m.ox * m.ix + m.oy * m.iy;
  assert(Math.abs(cross) < 1e-6 * Math.hypot(m.ox, m.oy) * Math.hypot(m.ix, m.iy) + 1e-6 && dot < 0, 'opposite handle stays in line');
  await page.click('button[aria-label="Undo"]');
});

await step('arrow keys nudge the selected point by 0.5 mm, 5 mm with Shift', async () => {
  const d0 = await state();
  const n = d0.outline.nodes[4];
  const p = await toScreen(n.x, n.y);
  await page.mouse.click(p.x, p.y); await page.mouse.click(p.x, p.y);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowUp');
  const m = (await state()).outline.nodes[4];
  near(m.x, n.x - 0.5, 1e-6, 'nudge x'); near(m.y, n.y + 5, 1e-6, 'nudge y');
  await page.click('button[aria-label="Undo"]'); await page.click('button[aria-label="Undo"]');
  near((await state()).outline.nodes[4].x, n.x, 1e-6, 'undone');
});

await step('"Mirror left and right" keeps the bass half and mirrors it; turning it off gives back a full outline', async () => {
  const d0 = await state();
  await page.check('#sym');
  const d1 = await state();
  assert(d1.outline.symmetric === true, 'symmetric on');
  assert(d1.outline.nodes[0].x === 0 && d1.outline.nodes[d1.outline.nodes.length - 1].x === 0, 'ends on the centerline');
  assert(d1.outline.nodes.slice(1, -1).every((n) => n.x < 0), 'stored half is the bass side');
  const size = await page.evaluate(() => document.querySelector('section[data-sec="shape"] .hint').innerText);
  await page.uncheck('#sym');
  const d2 = await state();
  assert(d2.outline.symmetric === false && d2.outline.nodes.length === 2 * d1.outline.nodes.length - 2, 'full outline restored with mirrored points');
  await page.click('button[aria-label="Undo"]'); await page.click('button[aria-label="Undo"]');
  assert(JSON.stringify((await state()).outline) === JSON.stringify(d0.outline), 'undo returns the original');
  return 'mirrored body ' + size.replace(/\s+[−+-]$/, '');
});

/* ------------------------------------------------------------------ starting shapes and references */
await step('each starting shape loads, keeps the pocket on the body and can be undone', async () => {
  const d0 = await state();
  const seen = [];
  for (const label of ['T-style', 'Offset (J-style)', 'Symmetric blank', 'Double-cut']) {
    await page.click('section[data-sec="shape"] button:has-text("Choose…")');
    await page.waitForSelector('.dialog');
    assert(await page.locator('.dialog .starter').count() === 4, 'four starting shapes offered');
    await page.click(`.dialog .starter:has(b:text-is("${label}"))`);
    await page.waitForSelector('.dialog', { state: 'detached' });
    const d = await state();
    const f = await findings();
    assert(!f.some((x) => /neck pocket is not on the body|neck screw lands off|bridge lands off/i.test(x.title)), `${label}: ` + f.filter((x) => x.level === 'warn').map((x) => x.title).join('; '));
    seen.push(`${label} ${d.outline.nodes.length} pts, ${f.filter((x) => x.level === 'warn').length} to fix`);
  }
  for (let i = 0; i < 4; i++) await page.click('button[aria-label="Undo"]');
  assert(JSON.stringify((await state()).outline) === JSON.stringify(d0.outline), 'back to the first outline');
  return seen.join(' · ');
});

await step('Escape closes a dialog', async () => {
  await page.click('section[data-sec="shape"] button:has-text("Choose…")');
  await page.waitForSelector('.dialog');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.dialog', { state: 'detached' });
});

await step('a built-in reference outline can be shown, faded, traced into an editable outline and removed', async () => {
  const d0 = await state();
  await page.click('section[data-sec="shape"] button:has-text("+ T-style")');
  await page.waitForSelector('section[data-sec="shape"] .card');
  assert(await page.locator('.stage path[stroke-dasharray="5 4"]').count() === 1, 'ghost drawn');
  await page.click('section[data-sec="shape"] button:has-text("+ T-style")');
  await waitToast(/already on the drawing/);
  await page.click('section[data-sec="shape"] .card button:has-text("Use as my outline")');
  const d1 = await state();
  assert(d1.outline.nodes.length >= 20 && d1.outline.nodes.length <= 45, `traced into ${d1.outline.nodes.length} points`);
  await waitToast(/editable points/);
  await page.click('button[aria-label="Undo"]');
  assert(JSON.stringify((await state()).outline) === JSON.stringify(d0.outline), 'undo restores my outline');
  await page.click('section[data-sec="shape"] .card button[aria-label^="Remove"]');
  assert((await state()).ghosts.length === 0, 'reference removed');
  return `traced to ${d1.outline.nodes.length} points`;
});

await step('an SVG and a DXF file can be added as true-size references', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100"><rect x="10" y="10" width="180" height="80" rx="20"/></svg>';
  await page.setInputFiles('section[data-sec="shape"] input[type=file]', { name: 'my-shape.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await waitToast(/Added my-shape: 7\.087 in × 3\.150 in/);
  const dxf = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1', '10', '0', '20', '0', '10', '300', '20', '0', '10', '300', '20', '400', '10', '0', '20', '400',
    '0', 'CIRCLE', '8', '0', '10', '150', '20', '200', '40', '25', '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
  await page.setInputFiles('section[data-sec="shape"] input[type=file]', { name: 'plate.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
  await waitToast(/Added plate: 11\.811 in × 15\.748 in/);
  const d = await state();
  assert(d.ghosts.length === 2 && d.ghosts[1].polys.length === 2, 'both shapes of the DXF kept');
  assert(await page.locator('.stage path[stroke-dasharray="5 4"]').count() === 3, 'three reference paths drawn');
  await page.setInputFiles('section[data-sec="shape"] input[type=file]', { name: 'notes.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('this is not an svg') });
  await waitToast(/could not be read|No outlines/);
  for (let i = 0; i < 2; i++) await page.locator('section[data-sec="shape"] .card button[aria-label^="Remove"]').first().click();
  assert((await state()).ghosts.length === 0, 'references removed');
});

await step('a photo can be added as a reference and sized to real dimensions', async () => {
  // a 4 x 2 pixel PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAEklEQVR4nGP8z8Dwn4EBCTAyAAAUAwEBgB0pYQAAAABJRU5ErkJggg==', 'base64');
  await page.setInputFiles('section[data-sec="shape"] input[type=file]', { name: 'sketch.png', mimeType: 'image/png', buffer: png });
  await waitToast(/Photo added/);
  let d = await state();
  assert(d.ghosts.length === 1 && d.ghosts[0].image.startsWith('data:image/png') && Math.abs(d.ghosts[0].aspect - 0.5) < 1e-9, 'photo stored with its proportions');
  assert(await page.locator('.stage image').count() === 1, 'photo drawn');
  const id = d.ghosts[0].id;
  await setField(`#gw-${id}`, '10');
  d = await state();
  near(d.ghosts[0].w, 254, 1e-6, 'width set to 10 in');
  const box = await page.locator('.stage image').evaluate((el) => ({ w: +el.getAttribute('width'), h: +el.getAttribute('height') }));
  near(box.w, 254, 1e-6, 'drawn width'); near(box.h, 127, 1e-6, 'drawn height keeps the proportions');
  await page.locator('section[data-sec="shape"] .card button[aria-label^="Remove"]').click();
  assert((await state()).ghosts.length === 0, 'photo removed');
});

/* ------------------------------------------------------------------ units and fields */
await step('units switch converts every field; fractions and unit suffixes are accepted', async () => {
  assert(await page.inputValue('#nk-scale') === '25.500', 'scale shows 25.500 in');
  await page.click('.top .seg[aria-label="Units"] button:has-text("mm")');
  assert(await page.inputValue('#nk-scale') === '647.70', 'scale shows 647.70 mm, got ' + await page.inputValue('#nk-scale'));
  await page.click('.top .seg[aria-label="Units"] button:has-text("in")');
  await setField('#nk-heelWidth', '2-1/4');
  let d = await state();
  near(d.neck.heelWidth, 57.15, 1e-6, '2-1/4 in'); assert(d.neck.preset === 'custom', 'changing a standard number marks the neck custom');
  await setField('#nk-heelWidth', '56mm');
  d = await state(); near(d.neck.heelWidth, 56, 1e-6, '56mm typed in inch mode');
  await setField('#nk-heelWidth', 'abc');
  d = await state(); near(d.neck.heelWidth, 56, 1e-6, 'nonsense is ignored');
  await setField('#nk-heelWidth', '2-3/16');
  d = await state(); near(d.neck.heelWidth, 55.5625, 1e-6, 'back to 2-3/16');
  const f = await findings();
  assert(f.some((x) => /Measure before you cut: nut to end of heel/.test(x.title)), 'unconfirmed numbers are still listed after an edit');
  await page.selectOption('#neck-preset', 'fender22');
});

await step('choosing a squared-heel neck warns that the pocket corners will not match', async () => {
  await page.selectOption('#neck-preset', 'tele21');
  await settle(700);
  const f = await findings();
  assert(f.some((x) => x.level === 'warn' && /corners will be rounder than the heel/.test(x.title)), 'warning shown: ' + f.map((x) => x.title).join('; '));
  assert(!f.some((x) => /heel corner radius/.test(x.title)), 'published squared heel is not on the measure list');
  await page.selectOption('#neck-preset', 'fender22');
  await settle(700);
  assert(!(await findings()).some((x) => x.level === 'warn'), 'clean again');
});

await step('confirming a measurement removes it from the list and from the template CHECK notes', async () => {
  const before = (await findings()).filter((x) => /Measure before you cut/.test(x.title)).length;
  assert(before === 4, 'four numbers to confirm, saw ' + before);
  await page.locator('.rail .find:has-text("nut to end of heel") input[type=checkbox]').click();
  await settle(700);
  const d = await state();
  near(d.verified.nutToHeel, 466.98, 1e-6, 'stored the confirmed value');
  assert((await findings()).filter((x) => /Measure before you cut/.test(x.title)).length === 3, 'three left');
  await setField('#nk-nutToHeel', '18.4');
  await setField('#nk-nutToHeel', '18.385');
  await page.click('button[aria-label="Undo"]'); await page.click('button[aria-label="Undo"]'); await page.click('button[aria-label="Undo"]');
  await settle(700);
  assert((await findings()).filter((x) => /Measure before you cut/.test(x.title)).length === 4, 'undo brings the item back');
  assert((await state()).neck.preset === 'fender22', 'neck is the standard again');
});

/* ------------------------------------------------------------------ parts */
await step('pickups can be added, dragged along the strings, slanted and removed', async () => {
  await openSec('pickups');
  const d0 = await state();
  await page.click('section[data-sec="pickups"] button:has-text("+ P-90")');
  let d = await state();
  assert(d.pickups.length === 4 && d.pickups[3].type === 'p90', 'P-90 added');
  const id = d.pickups[3].id, y0 = d.pickups[3].y;
  const f = await findings();
  assert(f.some((x) => /Strings span .* over the p-90 soapbar/.test(x.title)), 'string spread over the pole pieces is reported');
  await dragWorld({ x: 0, y: y0 + 2 }, { x: 25, y: y0 - 28 });
  d = await state();
  let p = d.pickups.find((q) => q.id === id);
  near(p.y, y0 - 30, 1, 'moved along the strings'); near(p.x, 0, 1e-9, 'stays on the centerline without Alt');
  await page.locator(`#pu-y-${id}`).click(); await page.locator(`#pu-y-${id}`).fill('5'); await page.keyboard.press('Enter');
  d = await state(); p = d.pickups.find((q) => q.id === id);
  near(p.y, 127, 1e-6, 'typed position');
  await page.locator('section[data-sec="pickups"] .card.sel .row:has-text("Slant") input').click();
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  d = await state(); p = d.pickups.find((q) => q.id === id);
  near(p.angle * 180 / Math.PI, 2, 1e-6, 'slant from the arrow keys');
  await page.click('section[data-sec="pickups"] .card.sel button[aria-label^="Remove"]');
  d = await state();
  assert(d.pickups.length === 3, 'removed');
  assert(JSON.stringify(d.pickups) === JSON.stringify(d0.pickups), 'the other pickups were not touched');
});

await step('moving a control off its cavity is flagged, and the flag clears when it goes back', async () => {
  const d0 = await state();
  const c = d0.controls[2];
  await dragWorld(c, { x: c.x - 70, y: c.y });
  await settle(700);
  let f = await findings();
  assert(f.some((x) => x.level === 'warn' && /Pot has no cavity behind it/.test(x.title)), 'warning: ' + f.filter((x) => x.level === 'warn').map((x) => x.title).join('; '));
  assert(await page.locator('.stage circle[r="9"]').count() >= 1, 'problem marker on the drawing');
  await page.click('button[aria-label="Undo"]');
  await settle(700);
  f = await findings();
  assert(!f.some((x) => x.level === 'warn'), 'clear after undo');
});

await step('bridge choices change the hole pattern and the notes', async () => {
  await openSec('bridge');
  await page.selectOption('#bridge-type', 'tom');
  await settle(700);
  let d = await state();
  assert(d.bridge.type === 'tom' && d.bridge.params.tailDistance === 39.5, 'tune-o-matic chosen');
  let f = await findings();
  assert(f.some((x) => /needs a neck angle/.test(x.title)), 'neck angle note');
  await page.selectOption('#bridge-type', 'tStyle');
  await settle(500);
  await page.selectOption('#bridge-type', 'none');
  await settle(500);
  await page.selectOption('#bridge-type', 'hipshot');
  await settle(700);
  f = await findings();
  assert(f.some((x) => /Saddle travel covers your compensation/.test(x.title)), 'saddle travel check');
  await setField('#br-frontAhead', '0.1');
  await settle(700);
  f = await findings();
  assert(f.some((x) => x.level === 'warn' && /Saddles cannot reach/.test(x.title)), 'moving the bridge too far back is caught');
  await setField('#br-frontAhead', '0.304');
  await settle(700);
  assert(!(await findings()).some((x) => x.level === 'warn'), 'clean');
});

/* ------------------------------------------------------------------ routing setup */
await step('guide-bushing mode shows the offset; a bushing smaller than the bit is refused', async () => {
  await openSec('routing');
  await page.click('section[data-sec="routing"] .seg[aria-label="Cavities and neck pocket"] button:has-text("Guide bushing")');
  let note = await page.locator('section[data-sec="routing"]').innerText();
  assert(/Template edge sits 0\.188 in outside each cavity/.test(note), 'offset note: (5/8 - 1/4)/2 = 0.1875');
  await setField('#bush-cavity', '3/16');
  await settle(700);
  note = await page.locator('section[data-sec="routing"]').innerText();
  assert(/bushing must be larger than the bit/i.test(note), 'panel says so');
  assert((await findings()).some((x) => x.level === 'warn' && /guide bushing must be larger/.test(x.title)), 'check says so');
  await setField('#bush-cavity', '5/8');
  await page.click('section[data-sec="routing"] .seg[aria-label="Cavities and neck pocket"] button:has-text("Bearing-guided bit")');
  await settle(600);
});

await step('alignment pins appear on the drawing, can be dragged, and are flagged when they land on a part', async () => {
  await page.locator('section[data-sec="routing"] label.check:has-text("Alignment pin holes") input').check();
  let d = await state();
  assert(d.tooling.regHoles.length === 2, 'two pins');
  assert(await page.locator('.stage [data-k="reg"]').count() === 2, 'two crosshairs');
  assert(!(await findings()).some((x) => /Alignment pin/.test(x.title)), 'starting spots are clear');
  const r = d.tooling.regHoles[0];
  await dragWorld(r, { x: 0, y: 40 });
  await settle(700);
  assert((await findings()).some((x) => x.level === 'warn' && /Alignment pin hole 1 sits in the humbucker/.test(x.title)), 'pin in a cavity is flagged');
  await page.click('button[aria-label="Undo"]');
  await settle(600);
  return 'pins at y = ' + d.tooling.regHoles.map((p) => p.y).join(' and ') + ' mm';
});

/* ------------------------------------------------------------------ body and 3D */
await step('body thickness, bevels and wood change the weight; the 3D view draws', async () => {
  await openSec('body');
  const w0 = await page.locator('section[data-sec="body"] .note:has-text("Estimated body weight")').innerText();
  await page.locator('section[data-sec="body"] label.check:has-text("Arm bevel") input').check();
  await page.locator('section[data-sec="body"] label.check:has-text("Belly cut") input').check();
  await settle(900);
  const w1 = await page.locator('section[data-sec="body"] .note:has-text("Estimated body weight")').innerText();
  assert(w0 !== w1, 'weight changed with bevels');
  assert(await page.locator('.stage [data-k="bevel"]').count() === 5, 'two squares for the arm bevel and three for the belly cut');
  await page.selectOption('#b-wood', 'mahogany');
  await settle(900);
  const w2 = await page.locator('section[data-sec="body"] .note:has-text("Estimated body weight")').innerText();
  const lb = (s) => parseFloat(s.match(/([\d.]+) lb/)[1]);
  near(lb(w2) / lb(w1), 590 / 450, 0.01, 'weight scales with density');
  await tab('3D'); await settle(1500);
  const px = await page.evaluate(() => { const c = document.querySelector('.stage canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); return !!g && c.width > 100; });
  assert(px, '3D canvas has a WebGL context');
  await page.click('.viewopts button:has-text("Back")'); await settle(500);
  await page.screenshot({ path: path.join(out, '3d-back.png') });
  await page.click('.viewopts button:has-text("Edge")'); await settle(500);
  await page.screenshot({ path: path.join(out, '3d-edge.png') });
  await page.click('.viewopts button:has-text("Angle")'); await settle(500);
  await page.screenshot({ path: path.join(out, '3d-angle.png') });
  await page.locator('.viewopts label.check input').uncheck(); await settle(500);
  await page.screenshot({ path: path.join(out, '3d-body-only.png') });
  await page.locator('.viewopts label.check input').check();
  await tab('Design'); await settle(500);
  await page.screenshot({ path: path.join(out, 'design-bevels-pins.png') });
  return `${w0.match(/[\d.]+ lb/)[0]} → ${w1.match(/[\d.]+ lb/)[0]} with bevels → ${w2.match(/[\d.]+ lb/)[0]} in mahogany`;
});

/* ------------------------------------------------------------------ templates and files */
let files = {};
await step('template files download: pack, SVG, PDF (Letter and A4) and DXF', async () => {
  await tab('Templates'); await settle(1500);
  await page.screenshot({ path: path.join(out, 'templates-notch.png') });
  files.zip = await saveDownload(() => page.click('.tbar button:has-text("Save template pack")'));
  fs.renameSync(files.zip, files.zip.replace('.zip', '-notch.zip')); files.zip = files.zip.replace('.zip', '-notch.zip');
  await settle(600);
  files.svg = await saveDownload(() => page.click('.tbar button:text-is("SVG")'));
  await settle(600);
  files.pdf = await saveDownload(() => page.click('.tbar button:text-is("PDF, Letter")'));
  await settle(600);
  files.pdfA4 = await saveDownload(() => page.click('.tbar button:text-is("PDF, A4")'));
  await settle(600);
  files.dxf = await saveDownload(() => page.click('.tbar button:text-is("DXF")'));
  for (const [k, p] of Object.entries(files)) assert(fs.statSync(p).size > 2000, `${k} is ${fs.statSync(p).size} bytes`);
  return Object.entries(files).map(([k, p]) => `${path.basename(p)} ${(fs.statSync(p).size / 1024).toFixed(0)} KB`).join(' · ');
});

await step('a 3D model of the body saves as STEP (rolled or square edges) and as STL; the 3D engine is fetched only then', async () => {
  await tab('3D'); await settle(1200);
  await page.click('.viewopts button:has-text("Save files for CNC")');
  const dlg = page.locator('.dialog[aria-label="Save files for CNC"]');
  await dlg.waitFor({ timeout: 3000 });
  // the click-through's later checks read millimeter files
  await dlg.locator('.seg[aria-label="Units in the files"] button:has-text("Millimeters")').click();
  const said = await dlg.innerText();
  assert(/arm bevel, as a flat cut/i.test(said) && /belly cut, as a smooth bowl/i.test(said), 'the dialog lists the arm bevel and belly cut');
  assert(/Not in the 3D file/i.test(said) && /No depth has been entered/i.test(said), 'the dialog names the holes that are left out');
  assert(/has not been opened in Fusion or a CAM program/.test(said) && /Vectric Aspire does not/.test(said), 'the dialog says what the STEP file has and has not been checked in, and that Aspire does not open it');
  assert(fetched.length === 0, 'no 3D engine file was fetched before Save was clicked');
  await page.screenshot({ path: path.join(out, 'model3d-dialog.png') });
  const t0 = Date.now();
  files.step = await saveDownload(() => dlg.locator('button:has-text("Save 3D model (.step)")').click(), 120000);
  const first = Date.now() - t0;
  assert(fetched.length === 3, `three engine files fetched, got ${fetched.length}`);
  const head = fs.readFileSync(files.step, 'utf8').slice(0, 200);
  assert(head.startsWith('ISO-10303-21;'), 'file starts as a STEP file: ' + head.slice(0, 30));
  await dlg.locator('[role="status"]:has-text("body.step")').waitFor({ timeout: 5000 });
  // square edges: a second save, with no second fetch of the engine
  await dlg.locator('label.check:has-text("Roll the edge roundovers") input').uncheck();
  assert(/Square edges/.test(await dlg.innerText()), 'the list now says the edges are square');
  const rolled = files.step.replace('.step', '-rolled.step'); fs.renameSync(files.step, rolled); files.step = rolled;
  const t1 = Date.now();
  files.stepSquare = await saveDownload(() => dlg.locator('button:has-text("Save 3D model (.step)")').click(), 120000);
  const second = Date.now() - t1;
  const square = files.stepSquare.replace('.step', '-square.step'); fs.renameSync(files.stepSquare, square); files.stepSquare = square;
  assert(fetched.length === 3, 'the engine was not fetched again');
  assert(fs.statSync(files.stepSquare).size < fs.statSync(files.step).size, 'the square-edged file is the smaller one');
  // contours only: no pockets or holes in the model
  await dlg.locator('label.check:has-text("Put the pockets and holes in the 3D model") input').uncheck();
  assert(/Pockets and holes\. Cut them from the 2D vectors/.test(await dlg.innerText()), 'the list says pockets and holes are left out');
  files.stepPlain = await saveDownload(() => dlg.locator('button:has-text("Save 3D model (.step)")').click(), 120000);
  const plain = files.stepPlain.replace('.step', '-nopockets.step'); fs.renameSync(files.stepPlain, plain); files.stepPlain = plain;
  assert(!/CYLINDRICAL_SURFACE/.test(fs.readFileSync(plain, 'utf8')), 'the contours-only model has no hole or corner cylinders');
  await dlg.locator('label.check:has-text("Put the pockets and holes in the 3D model") input').check();
  // the 2D vectors for pockets and holes
  files.cnc = await saveDownload(() => dlg.locator('button:has-text("Save CNC vectors (.zip)")').click());
  assert(fs.statSync(files.cnc).size > 5000, 'vector pack has content');
  assert(fetched.length === 3, 'saving vectors needs no engine');
  // the same pack in inches
  await dlg.locator('.seg[aria-label="Units in the files"] button:has-text("Inches")').click();
  assert(/written in inches/.test(await dlg.innerText()), 'the dialog says the files are in inches');
  files.cncInch = await saveDownload(() => dlg.locator('button:has-text("Save CNC vectors (.zip)")').click());
  const inchPack = files.cncInch.replace('.zip', '-inch.zip'); fs.renameSync(files.cncInch, inchPack); files.cncInch = inchPack;
  await dlg.locator('.seg[aria-label="Units in the files"] button:has-text("Millimeters")').click();
  // STL, for programs that do not read STEP (rolled edges again)
  await dlg.locator('label.check:has-text("Roll the edge roundovers") input').check();
  await dlg.locator('.seg[aria-label="File type"] button:has-text("STL")').click();
  const stlSaid = await dlg.innerText();
  assert(/within 0\.02 mm of the true surface/.test(stlSaid) && /choose millimeters/.test(stlSaid), 'the STL choice states its facet tolerance and its units');
  assert(/millimeter STL from here opened in Vectric Aspire 12\.5/.test(stlSaid) && /Nothing has been cut/.test(stlSaid), 'the STL choice says what has and has not been checked');
  files.stl = await saveDownload(() => dlg.locator('button:has-text("Save 3D model (.stl)")').click(), 120000);
  const stl = fs.readFileSync(files.stl);
  assert(stl.length === 84 + stl.readUInt32LE(80) * 50 && stl.readUInt32LE(80) > 10000, `binary STL with ${stl.readUInt32LE(80)} facets`);
  assert(fetched.length === 3, 'the engine was not fetched again for the STL');
  await page.keyboard.press('Escape'); await settle(300);
  assert(await dlg.count() === 0, 'Escape closes the dialog');
  return `STL ${(stl.length / 1e6).toFixed(1)} MB, ${stl.readUInt32LE(80)} facets · rolled ${(fs.statSync(files.step).size / 1024).toFixed(0)} KB in ${(first / 1000).toFixed(1)} s (with the engine fetch) · square ${(fs.statSync(files.stepSquare).size / 1024).toFixed(0)} KB in ${(second / 1000).toFixed(1)} s`;
});

await step('roundover switches, a binding channel and hole depths for the hardware change the body and what the CNC dialog says', async () => {
  await tab('Design'); await settle(400);
  await openSec('body');
  const weight = async () => { await settle(900); return page.locator('section[data-sec="body"] .note:has-text("Estimated body weight")').innerText(); };
  const w0 = await weight();
  await page.locator('section[data-sec="body"] label.check:has-text("Round over the back edge") input').uncheck();
  assert(await page.locator('#b-rb').count() === 0, 'the back radius field goes away when the roundover is off');
  const w1 = await weight();
  assert(w0 !== w1, 'weight changed when the back roundover was switched off');
  await page.locator('section[data-sec="body"] label.check:has-text("Round over the back edge") input').check();
  await page.locator('section[data-sec="body"] label.check:has-text("Binding channel around the top edge") input').check();
  await setField('#bind-w', '2 mm'); await setField('#bind-d', '7 mm');
  assert(await page.locator('.stage [data-k="binding"]').count() === 1, 'the channel\'s inner edge is drawn');
  assert(/Left out while the binding channel is on/.test(await page.locator('section[data-sec="body"]').innerText()), 'the panel says the top roundover is left out');
  const s1 = await state();
  assert(s1.body.binding.on && Math.abs(s1.body.binding.width - 2) < 1e-6 && Math.abs(s1.body.binding.depth - 7) < 1e-6, 'binding stored');
  await openSec('bridge');
  const depthField = page.locator('section[data-sec="bridge"] input[id^="hd-"]').first();
  const group = (await depthField.getAttribute('id')).slice(3);
  await setField('#hd-' + group, '12 mm');
  const s2 = await state();
  assert(Math.abs(s2.bridge.depths[group] - 12) < 1e-6, 'hole depth stored');
  await tab('3D'); await settle(1200);
  await page.click('.viewopts button:has-text("Save files for CNC")');
  const dlg = page.locator('.dialog[aria-label="Save files for CNC"]');
  const said = await dlg.innerText();
  assert(/binding channel around the top edge, 2 mm/i.test(said), 'the dialog lists the binding channel: ' + said.slice(0, 80));
  await page.keyboard.press('Escape');
  // back to how it was, so later steps see the same body
  await tab('Design'); await openSec('bridge'); await setField('#hd-' + group, '0');
  await openSec('body');
  await page.locator('section[data-sec="body"] label.check:has-text("Binding channel around the top edge") input').uncheck();
  const s3 = await state();
  assert(!s3.body.binding.on && !(group in s3.bridge.depths), 'binding off and depth cleared');
  return `${w0.match(/[\d.]+ lb/)[0]} → ${w1.match(/[\d.]+ lb/)[0]} with the back edge square; binding 2 × 7 mm; ${group} holes 12 mm deep`;
});

await step('the belly cut is sized like a bowl with three squares, and the arm bevel takes a curve, a crease blend and a run-out', async () => {
  await tab('Design'); await settle(400); await openSec('body');
  const b0 = (await state()).contours.belly;
  assert(b0.on && b0.angle === 0, 'belly cut is on and parallel to the centerline');
  const handle = async (i) => { const bb = await page.locator(`.stage [data-k="bevel"][data-id="belly"][data-i="${i}"]`).boundingBox(); return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }; };
  const drag = async (i, dx, dy) => { const p = await handle(i); await page.mouse.move(p.x, p.y); await page.mouse.down(); for (let k = 1; k <= 6; k++) await page.mouse.move(p.x + (dx * k) / 6, p.y + (dy * k) / 6); await page.mouse.up(); };
  const v = await view();
  // the end square, pulled straight up the screen (toward the neck): longer, still parallel to the centerline
  await drag('l', 0, -20 * v.s);
  const b1 = (await state()).contours.belly;
  near(b1.len, b0.len + 40, 1.5, 'length grew by twice the drag'); assert(b1.angle === 0 && Math.abs(b1.reach - b0.reach) < 1e-9, 'it stayed parallel and its reach did not change');
  // the side square, pulled toward the centerline: wider, same length
  const toward = b1.x < 0 ? 1 : -1;
  await drag('w', toward * 15 * v.s, 0);
  const b2 = (await state()).contours.belly;
  near(b2.reach, b1.reach + 15, 1, 'reach grew by the drag'); assert(Math.abs(b2.len - b1.len) < 1e-9 && b2.angle === 0, 'length and angle did not change');
  // the middle square moves the whole bowl
  await drag('c', 0, 10 * v.s);
  const b3 = (await state()).contours.belly;
  near(b3.y, b2.y - 10, 1, 'center moved down'); assert(Math.abs(b3.len - b2.len) < 1e-9 && Math.abs(b3.reach - b2.reach) < 1e-9, 'size kept');
  // pulling the end square sideways turns the bowl
  await drag('l', 30 * v.s, 0);
  const b4 = (await state()).contours.belly;
  assert(Math.abs(b4.angle) > 0.1, 'the bowl turned: ' + b4.angle);
  await page.keyboard.press('Control+z'); await settle(300);
  await setField('#belly-blend', '40 mm');
  await setField('#arm-crown', '2 mm'); await setField('#arm-blend', '30 mm'); await setField('#arm-fade', '50 mm');
  const s = await state();
  assert(Math.abs(s.contours.belly.blend - 40) < 1e-6 && s.contours.arm.crown > 0 && Math.abs(s.contours.arm.blend - 30) < 1e-6 && Math.abs(s.contours.arm.fade - 50) < 1e-6, 'smooth settings stored');
  assert(/rolls the true radius/.test(await page.locator('section[data-sec="body"]').innerText()), 'the panel says the 3D view shows the rim blend approximately');
  await tab('3D'); await settle(1500);
  await page.screenshot({ path: path.join(out, '3d-smooth-contours.png') });
  await page.click('.viewopts button:has-text("Save files for CNC")');
  const dlg = page.locator('.dialog[aria-label="Save files for CNC"]');
  const said = await dlg.innerText();
  assert(/arm bevel, as a curved cut, with its crease rounded, running out to nothing at each end/i.test(said) && /smooth bowl with a rounded rim/i.test(said), 'the dialog describes the smooth contours');
  files.stepSmooth = await saveDownload(() => dlg.locator('button:has-text("Save 3D model (.step)")').click(), 120000);
  const smooth = files.stepSmooth.replace('.step', '-smooth.step'); fs.renameSync(files.stepSmooth, smooth); files.stepSmooth = smooth;
  assert(fs.readFileSync(smooth, 'utf8').startsWith('ISO-10303-21;'), 'a STEP file with the smooth contours saved');
  await page.keyboard.press('Escape');
  // back to plain contours for the steps that follow
  await tab('Design'); await openSec('body');
  await setField('#belly-blend', '0'); await setField('#arm-crown', '0'); await setField('#arm-blend', '0'); await setField('#arm-fade', '0');
  return `length ${b0.len.toFixed(0)} → ${b1.len.toFixed(0)} mm, reach ${b1.reach.toFixed(0)} → ${b2.reach.toFixed(0)} mm, turned ${(b4.angle * 180 / Math.PI).toFixed(0)}° then undone; smooth STEP ${(fs.statSync(smooth).size / 1024).toFixed(0)} KB`;
});

await step('the template preview zooms with the wheel, pans with a drag and refits on double-click', async () => {
  await tab('Templates'); await settle(800);
  const vb = () => page.locator('.sheetwrap svg').evaluate((el) => el.getAttribute('viewBox').split(' ').map(Number));
  const v0 = await vb();
  const r = await page.locator('.sheetwrap svg').boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.wheel(0, -500); await settle(300);
  const v1 = await vb();
  assert(v1[2] < v0[2] * 0.6, `zoomed in: view width ${v0[2].toFixed(0)} -> ${v1[2].toFixed(0)} mm`);
  await page.mouse.down(); await page.mouse.move(r.x + r.width / 2 + 80, r.y + r.height / 2 + 40, { steps: 4 }); await page.mouse.up(); await settle(200);
  const v2 = await vb();
  assert(v2[0] < v1[0] - 5 && v2[1] < v1[1] - 2, 'panned');
  await page.mouse.dblclick(r.x + r.width / 2, r.y + r.height / 2); await settle(300);
  const v3 = await vb();
  assert(Math.abs(v3[2] - v0[2]) < 1e-6 && Math.abs(v3[0] - v0[0]) < 1e-6, 'double-click shows everything again');
});

await step('a separate neck pocket template adds a third sheet', async () => {
  await tab('Design');
  await openSec('routing');
  await page.click('section[data-sec="routing"] .seg[aria-label="Neck pocket template"] button:has-text("Its own template")');
  await tab('Templates'); await settle(1500);
  const names = await page.locator('.sheetwrap svg text').allTextContents();
  assert(names.join('|') === 'Top template|Neck pocket template|Back template', 'sheets: ' + names.join('|'));
  await page.screenshot({ path: path.join(out, 'templates-own-pocket.png') });
  files.zipOwn = await saveDownload(() => page.click('.tbar button:has-text("Save template pack")'));
  fs.renameSync(files.zipOwn, files.zipOwn.replace('.zip', '-own-pocket.zip')); files.zipOwn = files.zipOwn.replace('.zip', '-own-pocket.zip');
  await tab('Design');
  await page.click('section[data-sec="routing"] .seg[aria-label="Neck pocket template"] button:has-text("Notch in the top template")');
});

await step('a design saves to a file and opens again exactly; a wrong file is refused', async () => {
  await page.locator('.top input.name').fill('Test Guitar One');
  await page.locator('.top input.name').blur();
  const before = await state();
  await page.click('.menuwrap > button');
  files.design = await saveDownload(() => page.click('.menu button:has-text("Save this design")'));
  assert(path.basename(files.design) === 'test-guitar-one.guitar.json', 'file name from the design name: ' + path.basename(files.design));
  // change things, then open the saved file
  await page.selectOption('#neck-preset', 'tele21');
  await page.setInputFiles('.top input[type=file]', files.design);
  await waitToast(/Opened Test Guitar One/);
  const after = await state();
  assert(JSON.stringify(after) === JSON.stringify(before), 'opened design equals the saved one');
  await page.setInputFiles('.top input[type=file]', { name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"something/else"}') });
  await waitToast(/not a Guitar Designer file/);
  assert(JSON.stringify(await state()) === JSON.stringify(before), 'design untouched by the refused file');
});

await step('a Fretboard Designer build file sets scale, frets, nut and compensation', async () => {
  const fb = { schema: 'blackchapel.fretboard/v1', units: 'in', params: { scaleTreble: 24.75, scaleBass: 24.75, scaleMode: 'single', numFrets: 24, nutSpread: 1.4, overhangBass: 0.14, overhangTreble: 0.14, compTreble: 0.04, compBass: 0.1 } };
  const before = await state();
  await page.setInputFiles('section[data-sec="neck"] input[type=file]', { name: 'board.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fb)) });
  await waitToast(/Scale, frets, nut and compensation loaded/);
  const d = await state();
  near(d.neck.scale, 24.75 * 25.4, 1e-6, 'scale'); assert(d.neck.frets === 24, 'frets');
  near(d.strings.nutSpread, 1.4 * 25.4, 1e-6, 'nut spread'); near(d.neck.nutWidth, 1.68 * 25.4, 1e-6, 'nut width');
  near(d.compensation.treble, 0.04 * 25.4, 1e-6, 'treble comp'); near(d.compensation.bass, 0.1 * 25.4, 1e-6, 'bass comp');
  near(d.neck.scale - d.neck.nutToHeel, before.neck.scale - before.neck.nutToHeel, 1e-6, 'heel stays the same distance from the bridge');
  assert(d.neck.preset === 'custom', 'neck marked custom');
  await page.click('button[aria-label="Undo"]');
  assert(JSON.stringify((await state()).neck) === JSON.stringify(before.neck), 'undo restores the neck');
});

await step('the sources dialog lists every built-in number with its basis', async () => {
  await page.click('.menuwrap > button');
  await page.click('.menu button:has-text("Where the numbers come from")');
  await page.waitForSelector('.dialog');
  const text = await page.locator('.dialog').innerText();
  for (const s of ['Warmoth', 'Fralin', 'Hipshot', 'StewMac', 'Gotoh', 'Wood Database', 'Not tested']) assert(text.includes(s), 'mentions ' + s);
  await page.screenshot({ path: path.join(out, 'sources.png') });
  await page.click('.dialog button:has-text("Close")');
});

await step('work survives a reload', async () => {
  const before = await state();
  await page.reload();
  await page.waitForSelector('.app');
  await settle(900);
  assert(await page.inputValue('.top input.name') === 'Test Guitar One', 'name restored');
  assert(JSON.stringify(await state()) === JSON.stringify(before), 'design restored from browser storage');
});

await browser.close();

/* ------------------------------------------------------------------ small screens */
for (const [w, h, label] of [[400, 860, 'phone'], [820, 1180, 'tablet']]) {
  ({ page, browser, errors } = await open({ width: w, height: h }));
  await step(`${label} width (${w}px): no sideways scrolling, every view reachable`, async () => {
    for (const t of ['Design', '3D', 'Templates']) {
      await tab(t); await settle(900);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth }));
      assert(m.sw <= m.iw && m.bw <= m.iw, `${t}: page is ${Math.max(m.sw, m.bw)}px wide in a ${m.iw}px window`);
      const st = await page.evaluate(() => { const r = document.querySelector('.stage').getBoundingClientRect(); return { w: r.width, h: r.height }; });
      assert(st.w >= w - 2 - 40 && st.h >= 240, `${t}: drawing area is ${st.w.toFixed(0)} × ${st.h.toFixed(0)}`);
      await page.screenshot({ path: path.join(out, `${label}-${t.toLowerCase()}.png`), fullPage: false });
    }
    await tab('Design');
    const reach = await page.evaluate(() => { const p = document.querySelector('.panel'), r = document.querySelector('.rail'); return { p: !!p && p.getBoundingClientRect().height > 60, r: !!r && r.getBoundingClientRect().height > 60 }; });
    assert(reach.p && reach.r, 'controls and checks are on the page');
  });
  await browser.close();
}

const pass = results.filter((r) => r.ok).length;
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? '\n      ' + r.note : ''}`);
console.log(`\n${pass} of ${results.length} passed`);
fs.writeFileSync(path.join(out, 'interact-results.json'), JSON.stringify({ results, files }, null, 1));
process.exit(pass === results.length ? 0 : 1);
