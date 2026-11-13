// The neck's shaft and heel (src/model/neck.js) and its CAD solid. Run with: node --test test/neck.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as rc from 'replicad';
import start from 'replicad-opencascadejs';
import { defaultDesign, normalizeDesign } from '../src/model/design.js';
import { derive } from '../src/model/derive.js';
import { buildNeckSolid } from '../src/export/step.js';
import { NECK_PROFILES } from '../src/data/neckprofiles.js';
import { backCurve } from '../src/model/neck.js';
import { fretDistance } from '../src/core/fret.js';

let oc;
before(async () => { oc = await start(); rc.setOC(oc); });
const pct = (a, b) => Math.abs(a / b - 1) * 100;

test('neck thickness profiles carry Warmoth\'s published figures', () => {
  const inches = (k) => [NECK_PROFILES[k].t1 / 25.4, NECK_PROFILES[k].t12 / 25.4].map((v) => +v.toFixed(3));
  assert.deepEqual(inches('standardThin'), [0.8, 0.85]);
  assert.deepEqual(inches('roundback59'), [0.86, 0.96]);
  assert.deepEqual(inches('wizard'), [0.75, 0.82]);
  assert.deepEqual(inches('fatback'), [0.965, 0.965]);
  assert.deepEqual(inches('boatneck'), [0.965, 0.965]);
});

test('neck shape: thickness less the fretboard at the 1st and 12th frets, a half ellipse across, and a heel that fills the pocket', () => {
  const d = defaultDesign(); d.neck.head.on = false; // the shaft and heel on their own
  const g = derive(d, { tol: 0.005 }), n = g.neck, nk = d.neck, T = d.body.thickness;
  assert.ok(Math.abs(n.d1 - (0.8 * 25.4 - 6.35)) < 1e-9 && Math.abs(n.d12 - (0.85 * 25.4 - 6.35)) < 1e-9, 'wood under the fretboard = thickness - fretboard');
  const y1 = g.nutY - fretDistance(nk.scale, 1), y12 = g.nutY - fretDistance(nk.scale, 12);
  assert.ok(Math.abs(n.at(g.nutY).depth - n.d1) < 1e-9 && Math.abs(n.at(y1).depth - n.d1) < 1e-9, 'held from the nut to the 1st fret');
  assert.ok(Math.abs(n.at((y1 + y12) / 2).depth - (n.d1 + n.d12) / 2) < 1e-9, 'straight between the 1st and 12th');
  assert.ok(Math.abs(n.at(y12).depth - n.d12) < 1e-9);
  // across: a half ellipse at fullness 2
  const sec = n.at(y1), area = Math.abs(sec.pts.reduce((a, p, i) => { const q = sec.pts[(i + 1) % sec.pts.length]; return a + p.x * q.z - q.x * p.z; }, 0)) / 2;
  assert.ok(Math.abs(area / ((Math.PI / 2) * sec.half * sec.depth) - 1) < 0.002, 'half-ellipse area');
  assert.ok(backCurve(20, 15, 4).every((p) => Math.abs((Math.abs(p.x) / 20) ** 4 + (Math.abs(p.z) / 15) ** 4 - 1) < 1e-9), 'fuller shoulders follow the same rule at a higher power');
  // width: nut width at the nut, the pocket's width where the neck enters the body
  assert.ok(Math.abs(n.at(g.nutY).half * 2 - nk.nutWidth) < 1e-9 && Math.abs(n.at(n.shaftEnd).half * 2 - nk.mouthWidth) < 1e-9);
  // the heel: as deep as the pocket plus what stands proud, sitting on the pocket floor, with the pocket's outline
  assert.ok(Math.abs(n.heelDepth - (nk.pocketDepth + nk.heelStandProud)) < 1e-9 && Math.abs(n.heelBottom - (T - nk.pocketDepth)) < 1e-9 && Math.abs(n.top - (T + nk.heelStandProud)) < 1e-9);
  assert.ok(Math.abs(n.at(n.shaftEnd).depth - n.heelDepth) < 1e-9 && n.at(n.shaftEnd).n > 20, 'the shaft is as deep as the heel, and all but square, where they meet');
  const hb = n.heel.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), y0: Math.min(b.y0, p.y), y1: Math.max(b.y1, p.y) }), { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 });
  assert.ok(Math.abs(hb.x1 - hb.x0 - nk.heelWidth) < 1e-6 && Math.abs(hb.y0 - g.heelY) < 1e-6 && Math.abs(hb.y1 - (g.heelY + nk.pocketLength)) < 1e-6);
  assert.ok(Math.abs(n.length - nk.nutToHeel) < 1e-9);
  // an older file, saved before the neck had a shape, opens with the starting shape
  const old = normalizeDesign({ schema: 'blackchapel.guitar/v1', outline: d.outline, neck: { scale: 647.7 } }).neck;
  assert.deepEqual(old.back, d.neck.back);
  assert.deepEqual(old.head, defaultDesign().neck.head, 'and with the starting headstock');
});

test('neck CAD solid: sound, and the same volume as its cross-sections give, for every profile and a range of shapes', () => {
  const cases = Object.keys(NECK_PROFILES).map((k) => [k, { t1: NECK_PROFILES[k].t1, t12: NECK_PROFILES[k].t12 }]).concat([['fuller shoulders', { fullness: 3 }], ['slimmer shoulders', { fullness: 1.6 }], ['short blend', { blend: 12 }], ['long blend', { blend: 80 }], ['thick fretboard', { board: 8 }]]);
  let last = 0;
  for (const [name, back] of cases) {
    const d = defaultDesign(); d.neck.head.on = false; d.neck.back = { ...d.neck.back, ...back };
    const n = derive(d, { tol: 0.005 }).neck, r = buildNeckSolid(rc, oc, n, { expectVolume: n.volume });
    assert.equal(r.valid, true, name);
    assert.ok(pct(r.volume, n.volume) < 0.3, `${name}: volume differs by ${pct(r.volume, n.volume).toFixed(3)}%`);
    last = n.volume;
  }
  const plain = defaultDesign(); plain.neck.head.on = false;
  const n = derive(plain, { tol: 0.005 }).neck;
  assert.throws(() => buildNeckSolid(rc, oc, n, { expectVolume: n.volume * 1.05 }), /did not come out right, so it was not saved/);
  assert.ok(last > 250000 && last < 450000, 'a believable amount of wood');
});

// ---- the angled headstock and the volute ----
test('headstock: a slab tilted back from the nut, its outline at true shape with both ends on the corners of the nut', () => {
  const d = defaultDesign(), nk = d.neck;
  nk.head.outline.nodes[0].x = -99; nk.head.outline.nodes[0].y = 7; // wherever the ends are stored, they are drawn on the nut's corners
  const g = derive(d, { tol: 0.005 }), n = g.neck, h = n.head;
  assert.ok(Math.abs(h.nodes[0].x + nk.nutWidth / 2) < 1e-9 && h.nodes[0].y === 0 && Math.abs(h.nodes[h.nodes.length - 1].x - nk.nutWidth / 2) < 1e-9);
  assert.ok(Math.abs(h.ang - (14 * Math.PI) / 180) < 1e-12 && h.thick === 15 && Math.abs(h.length - 180) < 0.01);
  // its face meets the neck's top along the nut line and drops as it runs out
  const a = h.place(0, 0, 0), b = h.place(0, 100, 0), under = h.place(0, 100, h.thick);
  assert.ok(Math.abs(a.y - g.nutY) < 1e-9 && Math.abs(a.z - n.top) < 1e-9);
  assert.ok(Math.abs(b.y - (g.nutY + 100 * Math.cos(h.ang))) < 1e-9 && Math.abs(b.z - (n.top - 100 * Math.sin(h.ang))) < 1e-9);
  assert.ok(Math.abs(Math.hypot(under.y - b.y, under.z - b.z) - 15) < 1e-9 && under.z < b.z, 'its back is one thickness below its face, square to it');
});

test('volute: the back swells out behind the nut, carries on past it, and is cut off level with the headstock\'s face', () => {
  const d = defaultDesign(), g = derive(d, { tol: 0.005 }), n = g.neck, h = n.head;
  const off = defaultDesign(); off.neck.head.on = false;
  const bare = derive(off, { tol: 0.005 }).neck;
  assert.ok(Math.abs(n.at(g.nutY).depth - (bare.at(g.nutY).depth + 4)) < 1e-9, 'deeper by the volute\'s height at the nut');
  assert.ok(Math.abs(n.at(g.nutY - 40).depth - bare.at(g.nutY - 40).depth) < 1e-9, 'and not at all one volute length behind it');
  const mid = n.at(g.nutY - 20).depth - bare.at(g.nutY - 20).depth;
  assert.ok(Math.abs(mid - 2) < 1e-9, 'half way there, half the height');
  const past = n.at(g.nutY + 10);
  assert.ok(Math.abs(past.depth - (n.d1 + 4)) < 1e-9 && Math.abs(past.half * 2 - d.neck.nutWidth) < 1e-9);
  const lid = -10 * Math.tan(h.ang);
  assert.ok(past.cut.every((p) => p.z <= lid + 1e-9) && past.cut.some((p) => Math.abs(p.z - lid) < 1e-9), 'nothing stands above the headstock\'s face');
  assert.ok(h.past > (n.d1 + 4 - h.thick / h.cos) / h.tan, 'it runs on until it is inside the headstock');
  const flat = defaultDesign(); flat.neck.head.voluteHeight = 0;
  assert.ok(Math.abs(derive(flat, { tol: 0.005 }).neck.at(g.nutY).depth - bare.at(g.nutY).depth) < 1e-9, 'a height of 0 leaves the volute off');
});

test('headstock CAD solid: sound, and the same volume as slices across it give, for a range of angles, volutes and outlines', () => {
  const off = defaultDesign(); off.neck.head.on = false;
  const bare = derive(off, { tol: 0.005 }).neck.volume;
  const cases = [['starting headstock', {}], ['17 degrees', { angle: 17 }], ['10 degrees, thinner', { angle: 10, thickness: 13 }], ['no volute', { voluteHeight: 0 }], ['big volute', { voluteHeight: 8, voluteLength: 60 }],
    ['lopsided outline', (d) => { const ns = d.neck.head.outline.nodes; ns[2] = { ...ns[2], x: -55, y: 120 }; ns[4] = { ...ns[4], x: 15, y: 210 }; }]];
  for (const [name, change] of cases) {
    const d = defaultDesign();
    if (typeof change === 'function') change(d); else d.neck.head = { ...d.neck.head, ...change };
    const n = derive(d, { tol: 0.005 }).neck, r = buildNeckSolid(rc, oc, n, { expectVolume: n.volume });
    assert.equal(r.valid, true, name);
    assert.ok(pct(r.volume, n.volume) < 0.5, `${name}: volume differs by ${pct(r.volume, n.volume).toFixed(3)}%`);
    // the headstock adds about its outline's area times its thickness
    const area = Math.abs(n.head.poly.reduce((a, p, i) => { const q = n.head.poly[(i + 1) % n.head.poly.length]; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;
    assert.ok(Math.abs((n.volume - bare) / (area * n.head.thick) - 1) < 0.08, `${name}: the headstock adds ${((n.volume - bare) / 1000).toFixed(1)} cm3 against ${((area * n.head.thick) / 1000).toFixed(1)} for its slab alone`);
  }
});
