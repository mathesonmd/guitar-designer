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
  const d = defaultDesign(), g = derive(d, { tol: 0.005 }), n = g.neck, nk = d.neck, T = d.body.thickness;
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
  assert.deepEqual(normalizeDesign({ schema: 'blackchapel.guitar/v1', outline: d.outline, neck: { scale: 647.7 } }).neck.back, d.neck.back);
});

test('neck CAD solid: sound, and the same volume as its cross-sections give, for every profile and a range of shapes', () => {
  const cases = Object.keys(NECK_PROFILES).map((k) => [k, { t1: NECK_PROFILES[k].t1, t12: NECK_PROFILES[k].t12 }]).concat([['fuller shoulders', { fullness: 3 }], ['slimmer shoulders', { fullness: 1.6 }], ['short blend', { blend: 12 }], ['long blend', { blend: 80 }], ['thick fretboard', { board: 8 }]]);
  let last = 0;
  for (const [name, back] of cases) {
    const d = defaultDesign(); d.neck.back = { ...d.neck.back, ...back };
    const n = derive(d, { tol: 0.005 }).neck, r = buildNeckSolid(rc, oc, n, { expectVolume: n.volume });
    assert.equal(r.valid, true, name);
    assert.ok(pct(r.volume, n.volume) < 0.3, `${name}: volume differs by ${pct(r.volume, n.volume).toFixed(3)}%`);
    last = n.volume;
  }
  const n = derive(defaultDesign(), { tol: 0.005 }).neck;
  assert.throws(() => buildNeckSolid(rc, oc, n, { expectVolume: n.volume * 1.05 }), /did not come out right, so it was not saved/);
  assert.ok(last > 250000 && last < 450000, 'a believable amount of wood');
});
