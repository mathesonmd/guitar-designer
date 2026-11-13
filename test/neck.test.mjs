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

test('neck into headstock: one continuous back that starts as the neck\'s own end and finishes as the flat of the headstock', () => {
  const d = defaultDesign(), g = derive(d, { tol: 0.005 }), n = g.neck, h = n.head, S = h.sections;
  assert.ok(h.reach === 45 && Math.abs(h.behind - 15) < 1e-9, 'the starting transition length, and the turn starting a third of it behind the nut');
  // at the nut it is the shaft's last cross-section, point for point
  const nut = n.sections[0];
  assert.ok(Math.abs(nut.y - g.nutY) < 1e-9 && S[0].p3.every((p, i) => Math.hypot(p[0] - nut.p3[i][0], p[1] - nut.p3[i][1], p[2] - nut.p3[i][2]) < 1e-6));
  // at the end of the transition it is the headstock's own section: as thick, as wide as the outline there, flat underneath
  const end = S[S.length - 1], w = h.widths(45), vw = (p) => [(p[1] - g.nutY) * h.cos - (p[2] - n.top) * h.sin, -(p[1] - g.nutY) * h.sin - (p[2] - n.top) * h.cos];
  assert.ok(end.v === 45 && end.base === h.thick && end.n > 23.9);
  assert.ok(end.p3.every((p) => Math.abs(vw(p)[0] - 45) < 1e-9), 'it lies square to the headstock\'s face');
  assert.ok(Math.abs(Math.min(...end.p3.map((p) => p[0])) + w.l) < 1e-9 && Math.abs(Math.max(...end.p3.map((p) => p[0])) - w.r) < 1e-9, 'trimmed to the outline');
  assert.ok(end.p3.filter((p) => Math.abs(p[0]) < w.l - 0.5).every((p) => Math.abs(vw(p)[1] - h.thick) < 1e-3), 'and flat across its back, one thickness below the face');
  assert.ok(Math.abs(Math.min(...h.slab.map((p) => p.y)) - 45) < 1e-9 && Math.abs(Math.max(...h.slab.map((p) => p.y)) - h.length) < 1e-9, 'the flat part takes over exactly there');
  // every section's top edge lies on the headstock's face, no point lies outside the outline, and the sections square up steadily
  for (let i = 0; i < S.length; i++) {
    const a = S[i].p3[0], b = S[i].p3[S[i].p3.length - 1];
    assert.ok(Math.abs(a[2] - h.faceZ(a[1])) < 1e-9 && Math.abs(b[2] - h.faceZ(b[1])) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-12);
    assert.ok(S[i].p3.every((p) => { const v = vw(p)[0], lim = v <= 0 ? { l: d.neck.nutWidth / 2, r: d.neck.nutWidth / 2 } : h.widths(v); return p[0] >= -lim.l - 1e-9 && p[0] <= lim.r + 1e-9; }));
    if (i) assert.ok(S[i].n > S[i - 1].n && S[i].v > S[i - 1].v);
  }
  // the headstock's edge is thin at the nut and grows to full thickness as the carve runs out
  const edge = (q) => vw(q.p3[1])[1]; // how far below the face the sawn edge ends and the carved back begins
  const e10 = edge(h.at(10)), e25 = edge(h.at(25));
  assert.ok(edge(S[0]) < 0.06 && e10 > 3 && e10 < e25 && e25 < h.thick && Math.abs(edge(end) - h.thick) < 1e-3, `edge 10 mm past the nut ${e10.toFixed(2)}, 25 mm past it ${e25.toFixed(2)}`);
  // no two neighboring sections cross inside the wood: each point moves toward the headstock from one to the next
  for (let i = 1; i < S.length; i++) assert.ok(S[i].p3.every((p, j) => p[1] > S[i - 1].p3[j][1] - 1e-9), 'section ' + i);
  // seen from the side, the back runs from the neck's line to the headstock's line with no step and no kink
  assert.ok(Math.abs(h.backZ(g.nutY - 15) - (n.top - n.d1)) < 1e-9 && Math.abs((h.backZ(g.nutY - 15) - h.backZ(g.nutY - 15.01)) / 0.01) < 1e-3, 'it leaves the neck\'s line level');
  const far = g.nutY + h.ahead;
  assert.ok(Math.abs(h.backZ(far) - (n.top - h.ahead * h.tan - h.thick / h.cos)) < 1e-9, 'and arrives on the headstock\'s back');
  for (let y = g.nutY - 20; y < far + 5; y += 0.25) {
    const k = (h.backZ(y + 0.25) - h.backZ(y)) / 0.25 - (h.backZ(y) - h.backZ(y - 0.25)) / 0.25;
    assert.ok(Math.abs(k) < 0.01, `a kink in the back at ${(y - g.nutY).toFixed(2)} mm from the nut`);
  }
});

test('volute: a mound on the crown of the back, highest under the nut, gone at the neck\'s edges, with its own length each side', () => {
  const make = (change) => { const d = defaultDesign(); d.neck.head = { ...d.neck.head, ...change }; return derive(d, { tol: 0.005 }); };
  const g = make({}), n = g.neck, h = n.head, none = make({ voluteHeight: 0 }).neck, peak = make({ voluteStyle: 'peak' }).neck;
  assert.ok(h.rise === 4 && h.run === 40 && h.fall === 25, 'starting values: 4 mm high, 40 mm toward the heel, 25 mm toward the headstock');
  // across the neck under the nut: full height on the crown, nothing at the edges, and it arrives there level
  assert.ok(Math.abs(n.at(g.nutY).depth - none.at(g.nutY).depth - 4) < 1e-9 && Math.abs(h.bump(0, 0) - 4) < 1e-12, 'its full height on the centerline under the nut');
  assert.ok(h.bump(0, 1) === 0 && h.bump(0, 0.98) < 0.01 && h.bump(0, 0.95) < 0.05, 'nothing at the edges of the neck, and it arrives there level: no raised seam');
  for (let x = 0.02; x <= 1; x += 0.02) assert.ok(h.bump(0, x) <= h.bump(0, x - 0.02) + 1e-12, 'it falls steadily from the crown to each edge');
  const edgeOf = (q) => q.p3[0], nutS = n.at(g.nutY), bareS = none.at(g.nutY);
  assert.ok(Math.hypot(...edgeOf(nutS).map((c, i) => c - edgeOf(bareS)[i])) < 1e-12 && Math.hypot(...nutS.p3[1].map((c, i) => c - bareS.p3[1][i])) < 1e-3, 'the neck\'s edge under the nut is where it is with no volute');
  // along the centerline: gone one length away on each side, and those lengths differ, so the two slopes do
  assert.ok(h.bump(1, 0) === 0 && h.bump(0, 1) === 0 && h.bump(0.999, 0) < 1e-4);
  assert.ok(Math.abs(n.at(g.nutY - 40).depth - none.at(g.nutY - 40).depth) < 1e-9 && n.at(g.nutY - 39).depth > none.at(g.nutY - 39).depth, 'it starts 40 mm behind the nut');
  assert.ok(Math.abs(n.at(g.nutY - 20).depth - none.at(g.nutY - 20).depth - 4 * 0.75 ** 2) < 1e-9, 'half way along, 9/16 of the height');
  assert.ok(Math.abs(h.at(12.5).depth - none.head.at(12.5).depth - 4 * 0.75 ** 2) < 1e-9 && h.at(25).depth === none.head.at(25).depth, 'the headstock side is the same shape squeezed into 25 mm, so it is the steeper');
  // its foot toward the heel is a rounded line: it reaches farthest down the neck on the centerline
  const reachAt = (across) => { let a = 0; while (h.bump(a + 0.001, across) > 0) a += 0.001; return a * 40; };
  assert.ok(Math.abs(reachAt(0) - 40) < 0.1 && reachAt(0.5) < reachAt(0) - 4 && reachAt(0.9) < reachAt(0.5) - 10 && reachAt(1) === 0);
  // smooth is level over the top; peaked comes to a point
  const tip = (a) => (a.head.bump(0, 0) - a.head.bump(0.01, 0)) / 0.01;
  assert.ok(Math.abs(tip(n)) < 0.1 && tip(peak) > 5, 'smooth has no point, peaked has one');
  assert.ok(Math.abs(peak.head.bump(0, 0) - 4) < 1e-12 && peak.head.bump(0, 1) === 0 && peak.head.bump(1, 0) === 0 && peak.head.bump(0.5, 0) < h.bump(0.5, 0), 'the peaked one is as high, ends in the same place, and is slimmer on the way');
  // a height of 0 leaves the neck exactly as it is without one
  const off = defaultDesign(); off.neck.head.on = false;
  const bare = derive(off, { tol: 0.005 }).neck;
  assert.ok(Math.abs(none.at(g.nutY - 40).depth - bare.at(g.nutY - 40).depth) < 1e-9 && none.head.bump(0, 0) === 0);
});

test('headstock CAD solid: sound, and the same volume as its cross-sections give, for a range of angles, volutes and outlines', () => {
  const off = defaultDesign(); off.neck.head.on = false;
  const bare = derive(off, { tol: 0.005 }).neck.volume;
  const cases = [['starting headstock', {}], ['peaked volute', { voluteStyle: 'peak' }], ['17 degrees', { angle: 17 }], ['10 degrees, thinner', { angle: 10, thickness: 13 }], ['no volute', { voluteHeight: 0 }], ['big peaked volute', { voluteHeight: 8, voluteLength: 60, voluteAhead: 45, voluteStyle: 'peak' }],
    ['25 degrees, short transition', { angle: 25, transition: 20 }], ['long transition, thick', { transition: 80, thickness: 19 }],
    ['lopsided outline', (d) => { const ns = d.neck.head.outline.nodes; ns[2] = { ...ns[2], x: -55, y: 120 }; ns[4] = { ...ns[4], x: 15, y: 210 }; }]];
  for (const [name, change] of cases) {
    const d = defaultDesign();
    if (typeof change === 'function') change(d); else d.neck.head = { ...d.neck.head, ...change };
    const n = derive(d, { tol: 0.005 }).neck, r = buildNeckSolid(rc, oc, n, { expectVolume: n.volume });
    assert.equal(r.valid, true, name);
    assert.ok(pct(r.volume, n.volume) < 0.6, `${name}: volume differs by ${pct(r.volume, n.volume).toFixed(3)}%`);
    // the headstock adds about its outline's area times its thickness
    const area = Math.abs(n.head.poly.reduce((a, p, i) => { const q = n.head.poly[(i + 1) % n.head.poly.length]; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;
    assert.ok(Math.abs((n.volume - bare) / (area * n.head.thick) - 1) < 0.08, `${name}: the headstock adds ${((n.volume - bare) / 1000).toFixed(1)} cm3 against ${((area * n.head.thick) / 1000).toFixed(1)} for its slab alone`);
  }
});

test('the saved neck is the shape the 3D view draws: one surface within 0.4 mm of the cross-sections, a flat headstock back, level tops', () => {
  for (const [name, change] of [['smooth volute', {}], ['peaked volute', { voluteStyle: 'peak' }], ['25 degrees, short transition', { angle: 25, transition: 20 }]]) {
    const d = defaultDesign(); d.neck.head = { ...d.neck.head, ...change };
    const g = derive(d, { tol: 0.005 }), n = g.neck, h = n.head, r = buildNeckSolid(rc, oc, n, { expectVolume: n.volume });
    const { vertices: V } = r.shape.mesh({ tolerance: 0.05, angularTolerance: 0.3 });
    const fine = []; for (let v = 0; v <= h.reach + 1e-9; v += 0.5) fine.push(h.at(v).p3);
    let worst = 0, count = 0, flat = 0, flats = 0, high = -1e9, proud = -1e9, nutWide = 0;
    for (let i = 0; i < V.length; i += 3) {
      const p = [V[i], V[i + 1], V[i + 2]], v = (p[1] - g.nutY) * h.cos - (p[2] - n.top) * h.sin, w = -(p[1] - g.nutY) * h.sin - (p[2] - n.top) * h.cos;
      high = Math.max(high, p[2] - n.top); proud = Math.max(proud, -w);
      if (Math.abs(p[1] - g.nutY) < 1e-4) nutWide = Math.max(nutWide, Math.abs(p[0]));
      if (v > h.reach + 3 && w > h.thick - 1) { flats++; flat = Math.max(flat, Math.abs(w - h.thick)); }
      if (p[1] < g.nutY + 1 || v > h.reach - 1 || w < 0.5) continue; // the back and sides of the transition, past the nut
      count++;
      let best = 1e9;
      for (const s of fine) for (let j = 0; j < s.length - 1; j++) {
        const a = s[j], b = s[j + 1], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / (dx * dx + dy * dy + dz * dz || 1)));
        best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy, p[2] - a[2] - t * dz));
      }
      worst = Math.max(worst, best);
    }
    assert.ok(count > 500 && worst < 0.4, `${name}: ${count} points, the farthest ${worst.toFixed(3)} mm from the intended surface`);
    assert.ok(flats > 20 && flat < 0.02, `${name}: the back of the headstock is flat and one thickness below its face within ${flat.toFixed(4)} mm`);
    // the flat top and the headstock's face meet along the nut line; the smooth skin eases that corner a little
    assert.ok(high < 0.05 && proud < 0.05, `${name}: nothing stands more than 0.05 mm above the neck's top (${high.toFixed(4)}) or the headstock's face (${proud.toFixed(4)})`);
    assert.ok(Math.abs(nutWide - d.neck.nutWidth / 2) < 0.05, `${name}: the neck is the nut's width at the nut (half width ${nutWide.toFixed(3)})`);
  }
});
