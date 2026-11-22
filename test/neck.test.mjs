// The neck's shaft and heel (src/model/neck.js) and its CAD solid. Run with: node --test test/neck.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as rc from 'replicad';
import start from 'replicad-opencascadejs';
import { defaultDesign, normalizeDesign, makeSideLine, makeTongueLine } from '../src/model/design.js';
import { derive } from '../src/model/derive.js';
import { buildNeckSolid } from '../src/export/step.js';
import { NECK_PROFILES } from '../src/data/neckprofiles.js';
import { backCurve, sideLine, tongueOutline } from '../src/model/neck.js';
import { fretDistance } from '../src/core/fret.js';
import { dragHandle, setPointKind, autoHandles, stored } from '../src/ui/lineEdit.js';

// The side view of the back is one curve: the plain line of the back, less how far the volute or the
// tongue's flat stands out at each place along the neck. The crown of every cross-section must lie on it,
// on the neck and past the nut (where the sections lean), so the line drawn in the side view is the line built.
const onCurve = (g, name) => {
  const n = g.neck, h = n.head;
  for (const q of [...n.sections.filter((c) => c.y > g.nutY - 80), ...h.sections]) {
    const c = q.p3[25], want = h.backZ(c[1]) - h.centerOut(c[1] - g.nutY);
    assert.ok(Math.abs(c[0]) < 1e-9 && Math.abs(c[2] - want) < 1e-6, `${name}: the crown ${(c[1] - g.nutY).toFixed(1)} mm from the nut is ${(c[2] - want).toFixed(4)} mm off the side-view curve`);
  }
};

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
  assert.ok(Math.abs(n.at(g.nutY).half * 2 - nk.nutWidth) < 1e-9 && Math.abs(n.at(n.shaftEnd).half * 2 - (nk.nutWidth + ((nk.heelWidth - nk.nutWidth) * (g.nutY - n.shaftEnd)) / nk.nutToHeel)) < 1e-9);
  // the heel: as deep as the pocket plus what stands proud, sitting on the pocket floor, with the pocket's outline
  assert.ok(Math.abs(n.heelDepth - (nk.pocketDepth + nk.heelStandProud)) < 1e-9 && Math.abs(n.heelBottom - (T - nk.pocketDepth)) < 1e-9 && Math.abs(n.top - (T + nk.heelStandProud)) < 1e-9);
  assert.ok(Math.abs(n.at(n.shaftEnd).depth - n.heelDepth) < 1e-9 && n.at(n.shaftEnd).n > 20, 'the shaft is as deep as the heel, and all but square, where they meet');
  const hb = n.heel.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), y0: Math.min(b.y0, p.y), y1: Math.max(b.y1, p.y) }), { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 });
  assert.ok(Math.abs(hb.y0 - g.heelY) < 1e-6 && Math.abs(hb.y1 - (g.heelY + nk.pocketLength)) < 1e-6);
  // the heel is the pocket's own outline: its sides on the neck's taper, nowhere wider than the neck
  const taperHalf = (y) => (nk.nutWidth + ((nk.heelWidth - nk.nutWidth) * (g.nutY - y)) / nk.nutToHeel) / 2;
  assert.ok(n.heel.every((p) => Math.abs(p.x) <= taperHalf(p.y) + 1e-6) && n.heel.filter((p) => p.y > g.heelY + nk.heelCornerR + 0.01).every((p) => Math.abs(Math.abs(p.x) - taperHalf(p.y)) < 1e-6));
  assert.ok(hb.x1 - hb.x0 < nk.heelWidth && hb.x1 - hb.x0 > 2 * taperHalf(n.shaftEnd));
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
  assert.ok(Math.abs(h.swell(12.5, 0) - 4 * 0.75 ** 2) < 1e-9 && h.swell(25, 0) === 0 && h.swell(24.9, 0) > 0, 'the headstock side is the same shape squeezed into 25 mm, so it is the steeper');
  onCurve(g, 'mound volute');
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
    ['25 degrees, short transition', { angle: 25, transition: 20 }], ['long transition, thick', { transition: 80, thickness: 19 }], ['a transition that ends exactly on an outline point', { transition: 38 }],
    ['flat headstock', { kind: 'flat' }], ['flat, no volute, deep long scoop, thin', { kind: 'flat', voluteHeight: 0, drop: 9, scoop: 45, thickness: 13 }], ['flat with a tongue', { kind: 'flat', voluteStyle: 'tongue', voluteHeight: 1, voluteLength: 24 }],
    ['tongue outline drawn: a pointed dart', (d) => { d.neck.head = { ...d.neck.head, voluteStyle: 'tongue', voluteHeight: 2, tongueCove: 6, tongueLine: { on: true, points: [{ s: -36, w: 0, k: 'c' }, { s: -18, w: 7 }, { s: -4, w: 15 }, { s: 6, w: 17 }] } }; }],
    ['tongue outline drawn: narrow and round, held narrow past the nut', (d) => { d.neck.head = { ...d.neck.head, voluteStyle: 'tongue', voluteHeight: 1.5, tongueLine: { on: true, points: [{ s: -22, w: 0 }, { s: -12, w: 12 }, { s: 0, w: 13 }, { s: 12, w: 13 }] } }; }],
    ['side view drawn, with a corner and a hollow', (d) => { d.neck.head.side = { on: true, points: [{ s: -55, out: 0 }, { s: -30, out: -1 }, { s: -4, out: 6, k: 'c' }, { s: 14, out: 1.5 }, { s: 30, out: 0 }] }; }],
    ['tongue with its side view drawn', (d) => { d.neck.head = { ...d.neck.head, voluteStyle: 'tongue', side: { on: true, points: [{ s: -34, out: 1 }, { s: -10, out: 3.5 }, { s: 20, out: 1 }, { s: 40, out: 0 }] } }; }],
    ['round tongue', { voluteStyle: 'tongue', voluteHeight: 2, voluteLength: 28 }], ['pointed tongue, narrow cove', { voluteStyle: 'tongue', tongueTip: 'point', voluteHeight: 3, voluteLength: 35, tongueCove: 4 }], ['level tongue, wide cove', { voluteStyle: 'tongue', voluteHeight: 0, voluteLength: 20, tongueCove: 14 }],
    ['lopsided outline', (d) => { const ns = d.neck.head.outline.nodes; ns[2] = { ...ns[2], x: -55, y: 120 }; ns[4] = { ...ns[4], x: 15, y: 210 }; }]];
  for (const [name, change] of cases) {
    const d = defaultDesign();
    if (typeof change === 'function') change(d); else d.neck.head = { ...d.neck.head, ...change };
    const n = derive(d, { tol: 0.005 }).neck, r = buildNeckSolid(rc, oc, n, { expectVolume: n.volume });
    assert.equal(r.valid, true, name);
    assert.ok(pct(r.volume, n.volume) < 0.6, `${name}: volume differs by ${pct(r.volume, n.volume).toFixed(3)}%`);
    // the headstock adds about its outline's area times its thickness
    const area = Math.abs(n.head.poly.reduce((a, p, i) => { const q = n.head.poly[(i + 1) % n.head.poly.length]; return a + p.x * q.y - q.x * p.y; }, 0)) / 2;
    assert.ok(Math.abs((n.volume - bare) / (area * n.head.thick) - 1) < 0.12, `${name}: the headstock adds ${((n.volume - bare) / 1000).toFixed(1)} cm3 against ${((area * n.head.thick) / 1000).toFixed(1)} for its slab alone`);
  }
});

test('the saved neck is the shape the 3D view draws: one surface within 0.4 mm of the cross-sections, a flat headstock back, level tops', () => {
  for (const [name, change] of [['smooth volute', {}], ['peaked volute', { voluteStyle: 'peak' }], ['25 degrees, short transition', { angle: 25, transition: 20 }], ['tongue', { voluteStyle: 'tongue', voluteHeight: 2, voluteLength: 28 }], ['flat headstock', { kind: 'flat' }]]) {
    const d = defaultDesign(); d.neck.head = { ...d.neck.head, ...change };
    const g = derive(d, { tol: 0.005 }), n = g.neck, h = n.head, r = buildNeckSolid(rc, oc, n, { expectVolume: n.volume });
    const { vertices: V } = r.shape.mesh({ tolerance: 0.05, angularTolerance: 0.3 });
    // (a tongue's edge moves sideways quickly as it spreads, so it is compared against sections five times closer together)
    const gap = h.tongue ? 0.1 : 0.5, fine = []; for (let v = 0; v <= h.reach + 1e-9; v += gap) fine.push(h.at(v).p3);
    let worst = 0, count = 0, flat = 0, flats = 0, high = -1e9, proud = -1e9, nutWide = 0;
    for (let i = 0; i < V.length; i += 3) {
      const p = [V[i], V[i + 1], V[i + 2]], v = (p[1] - g.nutY) * h.cos - (p[2] - n.top) * h.sin, w = (h.faceZ(p[1]) - p[2]) * h.cos; // w: how far below the headstock's face
      high = Math.max(high, p[2] - n.top); if (p[1] > g.nutY) proud = Math.max(proud, -w);
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

test('tongue: the headstock\'s flat carried down the neck to a tip, level across, with a crisp edge and a cove into the neck\'s round back', () => {
  const make = (change) => { const d = defaultDesign(); d.neck.head = { ...d.neck.head, voluteStyle: 'tongue', voluteHeight: 2, voluteLength: 28, ...change }; return derive(d, { tol: 0.005 }); };
  const g = make({}), n = g.neck, h = n.head, t = h.tongue, nutHalf = defaultDesign().neck.nutWidth / 2;
  assert.ok(t && t.tip === -28 && t.cove === 8 && !t.pointed, 'tip 28 mm behind the nut, the starting cove, a round tip');
  // its outline: nothing before the tip, four fifths of the nut's width at the nut, the headstock's full width soon after
  assert.ok(t.halfOf(-28, 1) === 0 && t.halfOf(-40, 1) === 0 && Math.abs(t.halfOf(0, 1) - 0.8 * nutHalf) < 1e-9 && Math.abs(t.halfOf(0, -1) - 0.8 * nutHalf) < 1e-9);
  for (let s = -27; s <= 0; s += 1) assert.ok(t.halfOf(s, 1) > t.halfOf(s - 1, 1), 'it widens steadily from the tip to the nut');
  assert.ok(Math.abs(t.spread - 12) < 1e-9 && t.halfOf(12, 1) > h.widths(12).r && t.halfOf(12, -1) > h.widths(12).l, 'past the nut it covers the headstock\'s full width within one and a half cove widths');
  assert.ok(t.halfOf(-27, 1) > make({ tongueTip: 'point' }).neck.head.tongue.halfOf(-27, 1) * 1.5, 'a pointed tip is the narrower near its end');
  // a section through it behind the nut: level from edge to edge, standing 2 mm out from the crown
  const none = make({ voluteStyle: 'smooth', voluteHeight: 0 }).neck;
  const sec = n.at(g.nutY - 10), bare = none.at(g.nutY - 10), f = t.halfOf(-10, 1), flat = sec.pts.filter((p) => Math.abs(p.x) <= f + 1e-6 && p.z < -1);
  assert.ok(Math.abs(sec.depth - bare.depth - 2) < 1e-9, 'it stands out from the crown by the height set');
  assert.ok(flat.length === 13 && flat.every((p) => Math.abs(p.z + sec.depth) < 1e-9) && Math.abs(Math.max(...flat.map((p) => p.x)) - f) < 1e-6, 'and is level right across, out to its edge');
  // the edge is a crease: the curve arrives along the flat and leaves straight up the cove's wall
  const k = sec.pts.findIndex((p) => Math.abs(p.x - f) < 1e-6) - 1, din = sec.din[k], dout = sec.dout[k];
  assert.ok(Math.abs(din[0] - 1) < 1e-6 && Math.abs(dout[2]) > 0.9 && Math.abs(dout[0]) < 0.45, `a crisp edge (leaving direction ${dout.map((c) => c.toFixed(2))})`);
  // the cove: at one cove width outside the edge the surface is the neck's own round back again, and arrives there level
  const roundAt = (x) => -bare.depth * Math.sqrt(Math.max(0, 1 - (x / bare.half) ** 2)); // the starting neck's back is a half ellipse
  const room = t.coveAt(-10, 1, sec.half);
  assert.ok(room < 8 && room > 3 && Math.abs(room - (sec.half - f - 0.5)) < 1e-9 && t.coveAt(-27.9, 1, sec.half) === 8, 'the cove narrows where the tongue\'s edge nears the edge of the neck, so it runs out before that edge');
  const outer = sec.pts.filter((p) => p.x > f + room + 0.01 && p.z < -0.2);
  assert.ok(outer.length > 0 && outer.every((p) => Math.abs(p.z - roundAt(p.x)) < 0.02), 'beyond the cove it is the neck\'s round back');
  const inCove = sec.pts.filter((p) => p.x > f + 0.3 && p.x < f + room - 0.3);
  assert.ok(inCove.length > 3 && inCove.every((p) => p.z > -sec.depth && p.z < roundAt(p.x) + 1e-6), 'inside the cove it lies between the two');
  // before the tip the neck is untouched; past the end of the transition the headstock is its plain flat
  assert.ok(Math.abs(n.at(g.nutY - 28 - 8 - 2).depth - none.at(g.nutY - 38).depth) < 1e-9);
  const end = h.sections[h.sections.length - 1];
  assert.ok(end.base === h.thick && Math.abs(end.depth - h.thick) < 1e-9 && Math.abs(t.proud(h.reach)) < 1e-12 && t.proud(-5) === 2);
  // with the height at 0 the tongue is level with the crown
  const level = make({ voluteHeight: 0 }).neck;
  assert.ok(Math.abs(level.at(g.nutY - 10).depth - bare.depth) < 1e-9 && level.head.tongue);
  // an older file's volute settings still open as they were
  assert.equal(normalizeDesign({ schema: 'blackchapel.guitar/v1', outline: defaultDesign().outline, neck: { scale: 647.7, head: { on: true, angle: 14, thickness: 15, voluteHeight: 4, voluteLength: 40, voluteStyle: 'peak', transition: 45 } } }).neck.head.tongueCove, 8);
});

test('side view drawn: a smooth line through the points, level where it leaves and rejoins the plain back, sharp only at a corner', () => {
  const line = sideLine([{ s: 10, out: 2 }, { s: -40, out: 3 }, { s: -15, out: 5, k: 'c' }, { s: 30, out: 9 }, { s: -28, out: 1 }]);
  assert.deepEqual(line.points.map((p) => [p.s, p.out, p.k]), [[-40, 0, 's'], [-28, 1, 's'], [-15, 5, 'c'], [10, 2, 's'], [30, 0, 's']], 'points in order, both ends on the plain line');
  for (const p of line.points) assert.ok(Math.abs(line.out(p.s) - p.out) < 1e-12, 'it passes through every point');
  assert.ok(line.out(-41) === 0 && line.out(31) === 0 && line.from === -40 && line.to === 30 && line.crest === -15);
  const slope = (s) => (line.out(s + 1e-4) - line.out(s - 1e-4)) / 2e-4;
  assert.ok(Math.abs(slope(-39.999)) < 1e-3 && Math.abs(slope(29.999)) < 1e-3, 'level at both ends');
  assert.ok(slope(-15.01) > 0.2 && slope(-14.99) < -0.05, 'a corner turns sharply');
  assert.ok(Math.abs(slope(-28.01) - slope(-27.99)) < 1e-2 && Math.abs(slope(9.99) - slope(10.01)) < 1e-2, 'a smooth point does not');
  for (let s = -40; s < 30; s += 0.25) { let i = 0; while (line.points[i + 1].s < s) i++; const a = line.points[i].out, b = line.points[i + 1].out; assert.ok(line.out(s) >= Math.min(a, b) - 1e-9 && line.out(s) <= Math.max(a, b) + 1e-9, 'never past either neighbor at ' + s); }
  // limits: kept inside the allowed length and heights; a doubled point is dropped; fewer than two points is no line
  const lim = sideLine([{ s: -400, out: 0 }, { s: 0, out: 40 }, { s: 0.5, out: 3 }, { s: 200, out: 0 }], { max: 43 });
  assert.deepEqual(lim.points.map((p) => [p.s, p.out]), [[-150, 0], [0, 15], [43, 0]]);
  assert.equal(sideLine([{ s: 0, out: 1 }]), null);
  // a tongue's first point is its tip and keeps its height; before it the height is held
  const free = sideLine([{ s: -30, out: 2 }, { s: 0, out: 3 }, { s: 40, out: 0 }], { freeStart: true });
  assert.ok(free.points[0].out === 2 && free.out(-60) === 2 && free.out(-30) === 2 && free.out(40) === 0);
});

test('side view drawn: it takes the place of the volute\'s numbers, starts close to them, and reshapes the neck', () => {
  const d = defaultDesign(), plain = derive(d, { tol: 0.005 }), ph = plain.neck.head;
  const start = makeSideLine(ph);
  assert.deepEqual(start.map((p) => [p.s, p.out]), [[-40, 0], [-20, 2.25], [0, 4], [12.5, 2.25], [25, 0]], 'five points to start from, taken from the volute as it is');
  d.neck.head.side = { on: true, points: start };
  const g = derive(d, { tol: 0.005 }), n = g.neck, h = n.head;
  assert.ok(h.side && h.side.points.length === 5 && h.backFrom === 40);
  // close to the mound the numbers gave: the same height under the nut, within 0.3 mm everywhere along the centerline
  assert.ok(Math.abs(n.at(g.nutY).depth - plain.neck.at(g.nutY).depth) < 1e-9);
  for (let s = -45; s <= 0; s += 1) assert.ok(Math.abs(n.at(g.nutY + s).depth - plain.neck.at(g.nutY + s).depth) < 0.3, 'at ' + s);
  for (let v = 1; v <= 30; v += 1) assert.ok(Math.abs(h.at(v).depth - ph.at(v).depth) < 0.3, 'past the nut at ' + v);
  // away from the centerline it still dies away to nothing at the neck's edge, and its foot is still a rounded line
  assert.ok(h.swell(0, 1) === 0 && h.swell(0, 0.97) < 0.02 && Math.abs(h.swell(0, 0) - 4) < 1e-9);
  assert.ok(h.swell(-39, 0) > 0 && h.swell(-39, 0.4) === 0 && h.swell(-20, 0.4) > 0, 'the foot reaches farthest down the neck on the centerline');
  // a line that is lopsided about its highest point still gives a surface with no step where its two sides meet
  const lop = defaultDesign(); lop.neck.head.side = { on: true, points: [{ s: -70, out: 0 }, { s: -30, out: 2 }, { s: -3, out: 5 }, { s: 9, out: 2.5 }, { s: 22, out: 0 }] };
  const lh = derive(lop, { tol: 0.005 }).neck.head;
  for (const across of [0.1, 0.3, 0.6, 0.9]) assert.ok(Math.abs(lh.swell(-3.001, across) - lh.swell(-2.999, across)) < 0.01, `no step across the highest point, ${across} of the way to the edge`);
  for (let sv = -70; sv <= 22; sv += 1) assert.ok(Math.abs(lh.swell(sv, 0) - lh.side.out(sv)) < 1e-9, 'on the centerline it is the drawn line');
  onCurve(derive(lop, { tol: 0.005 }), 'lopsided drawn line'); onCurve(g, 'drawn from the numbers');
  const steep = defaultDesign(); steep.neck.head = { ...steep.neck.head, angle: 20, side: { on: true, points: [{ s: -50, out: 0 }, { s: -10, out: 6, ho: [12, 3] }, { s: 8, out: 5, k: 'c' }, { s: 30, out: 0 }] } };
  onCurve(derive(steep, { tol: 0.005 }), 'a steep headstock with hand-set handles');
  const lvl = defaultDesign(); lvl.neck.head = { ...lvl.neck.head, kind: 'flat', side: { on: true, points: [{ s: -40, out: 0 }, { s: 0, out: 3 }, { s: 20, out: 0 }] } };
  onCurve(derive(lvl, { tol: 0.005 }), 'a flat headstock');
  assert.ok(lh.swell(-3, 1) === 0 && lh.swell(-60, 0.7) === 0 && lh.swell(15, 0.9) === 0);
  d.neck.head.side = { on: true, points: [{ s: -60, out: 0 }, { s: -25, out: 5 }, { s: 0, out: 4 }, { s: 12.5, out: 2.25 }, { s: 25, out: 0 }] };
  const g2 = derive(d, { tol: 0.005 }), n2 = g2.neck;
  assert.ok(Math.abs(n2.at(g.nutY - 25).depth - (n2.head.backZ ? n2.top - n2.head.backZ(g.nutY - 25) : 0) - 5) < 1e-9, 'the back stands 5 mm out where the point says');
  assert.ok(n2.head.backFrom === 60 && n2.sections.some((q) => Math.abs(q.y - (g.nutY - 59)) < 0.6), 'sections are placed all along the drawn line');
  assert.ok(Math.abs(n2.at(g.nutY - 61).depth - plain.neck.at(g.nutY - 61).depth + ph.swell(-61, 0)) < 1e-9 && n2.head.sections[n2.head.sections.length - 1].depth === n2.head.thick);
  // switched off, the numbers are back in charge and the points are kept for later
  d.neck.head.side.on = false;
  const off = derive(d, { tol: 0.005 }).neck;
  assert.ok(!off.head.side && Math.abs(off.at(g.nutY - 20).depth - plain.neck.at(g.nutY - 20).depth) < 1e-12 && d.neck.head.side.points.length === 5);
  // a tongue: the drawn line is the height of its flat, and its first point is the tip
  const t = defaultDesign(); t.neck.head = { ...t.neck.head, voluteStyle: 'tongue', voluteHeight: 2, voluteLength: 28 };
  const ts = makeSideLine(derive(t, { tol: 0.005 }).neck.head);
  const tEnd = derive(t, { tol: 0.005 }).neck.head.lineEnd; // where the last leaning section's centerline meets the back: a drawn line ends by there
  assert.ok(Math.abs(tEnd - (45 * Math.cos(14 * Math.PI / 180) - 15 * Math.sin(14 * Math.PI / 180) - 1)) < 1e-9);
  assert.ok(ts.length === 4 && ts[0].s === -28 && ts[1].s === 0 && Math.abs(ts[3].s - tEnd) < 0.006 && Math.abs(ts[2].s - tEnd / 2) < 0.006 && ts[0].out === 2 && ts[3].out === 0);
  t.neck.head.side = { on: true, points: [{ s: -35, out: 1 }, { s: 0, out: 3 }, { s: 43, out: 0 }] };
  const tn = derive(t, { tol: 0.005 }).neck;
  onCurve(derive(t, { tol: 0.005 }), 'a tongue with its side view drawn');
  assert.ok(tn.head.swell(-60, 0) === 0 && Math.abs(tn.at(tn.nutY - 60).depth - derive(defaultDesign(), { tol: 0.005 }).neck.at(tn.nutY - 60).depth + 0) < 1e-9, 'behind the tongue\'s tip and its cove the neck is untouched');
  assert.ok(tn.head.tongue.tip === -35 && Math.abs(tn.head.tongue.proud(-35) - 1) < 1e-12 && Math.abs(tn.head.tongue.proud(0) - 3) < 1e-12 && tn.head.tongue.proud(43) === 0);
  // an older file has no drawn side view
  assert.deepEqual(normalizeDesign({ schema: 'blackchapel.guitar/v1', outline: d.outline, neck: { scale: 647.7, head: { on: true, angle: 14 } } }).neck.head.side, { on: false, points: [] });
});

test('tongue outline drawn: half the width at each place, from a round or pointed tip, through the points', () => {
  const line = tongueOutline([{ s: 0, w: 16 }, { s: -30, w: 5 }, { s: -14, w: 12 }, { s: 10, w: 20, k: 'c' }, { s: 25, w: 22 }]);
  assert.deepEqual(line.points.map((p) => [p.s, p.w, p.k]), [[-30, 0, 's'], [-14, 12, 's'], [0, 16, 's'], [10, 20, 'c'], [25, 22, 's']], 'points in order; the tip has no width');
  for (const p of line.points) assert.ok(Math.abs(line.half(p.s) - p.w) < 1e-9, 'it passes through every point');
  assert.ok(line.half(-31) === 0 && line.half(40) === 22 && line.from === -30 && line.to === 25 && line.round === true);
  // a round tip leaves square to the centerline: the width grows like the square root of the distance from the tip
  assert.ok(line.half(-29.99) > 0.3 && Math.abs(line.half(-29.96) / line.half(-29.99) - 2) < 0.05, 'a round tip');
  const sharp = tongueOutline([{ s: -30, w: 0, k: 'c' }, { s: -14, w: 12 }, { s: 0, w: 16 }]);
  assert.ok(sharp.round === false && sharp.half(-29.99) < 0.02 && Math.abs(sharp.half(-29.96) / sharp.half(-29.99) - 4) < 0.2, 'a pointed tip widens in proportion to the distance');
  // smooth through a smooth point, sharp at a corner, never past either neighbor
  const slope = (f, s) => (f.half(s + 1e-4) - f.half(s - 1e-4)) / 2e-4;
  assert.ok(Math.abs(slope(line, -14.01) - slope(line, -13.99)) < 0.02 && Math.abs(slope(line, -0.01) - slope(line, 0.01)) < 0.02 && Math.abs(slope(line, 9.99) - slope(line, 10.01)) > 0.1);
  for (let s = -14; s < 25; s += 0.25) { let i = 1; while (line.points[i + 1].s < s) i++; assert.ok(line.half(s) >= line.points[i].w - 1e-9 && line.half(s) <= line.points[i + 1].w + 1e-9, 'never past either neighbor at ' + s); }
  for (let s = -30; s < -14; s += 0.25) assert.ok(line.half(s + 0.25) > line.half(s) - 1e-9, 'the round tip widens steadily');
  assert.equal(tongueOutline([{ s: -10, w: 0 }]), null);
  // in the neck: the drawn outline sets the tip and the width, and past its last point the tongue spreads to full width
  const d = defaultDesign(); d.neck.head = { ...d.neck.head, voluteStyle: 'tongue', voluteHeight: 2, voluteLength: 28 };
  const start = makeTongueLine(derive(d, { tol: 0.005 }).neck.head);
  assert.deepEqual(start.map((p) => [p.s, p.k]), [[-28, 's'], [-14, 's'], [0, 's']]); assert.ok(start[0].w === 0 && Math.abs(start[2].w - 0.8 * d.neck.nutWidth / 2) < 0.01);
  d.neck.head.tongueLine = { on: true, points: [{ s: -22, w: 0 }, { s: -12, w: 12 }, { s: 0, w: 13 }, { s: 12, w: 13 }] };
  const g = derive(d, { tol: 0.005 }), t = g.neck.head.tongue;
  assert.ok(t.line && t.tip === -22 && t.halfOf(-23, 1) === 0 && Math.abs(t.halfOf(-12, 1) - 12) < 1e-9 && Math.abs(t.halfOf(6, -1) - 13) < 1e-9 && Math.abs(t.halfOf(12, 1) - 13) < 1e-9);
  assert.ok(t.halfOf(12 + t.spread, 1) > g.neck.head.widths(12 + t.spread).r && t.halfOf(18, 1) > 13 && t.halfOf(18, 1) < t.halfOf(12 + t.spread, 1), 'past its last point it spreads to the headstock\'s full width');
  const sec = g.neck.at(g.nutY - 12);
  assert.ok(sec.pts.filter((p) => Math.abs(p.x) <= 12 + 1e-6 && p.z < -1).length === 13 && Math.abs(Math.max(...sec.pts.filter((p) => Math.abs(p.z + sec.depth) < 1e-9).map((p) => p.x)) - 12) < 1e-6, 'the flat of the section is as wide as the outline says');
  d.neck.head.tongueLine.on = false;
  assert.ok(!derive(d, { tol: 0.005 }).neck.head.tongue.line && derive(d, { tol: 0.005 }).neck.head.tongue.tip === -28, 'switched off, the numbers are back in charge');
  assert.deepEqual(normalizeDesign({ schema: 'blackchapel.guitar/v1', outline: d.outline, neck: { scale: 647.7, head: { on: true, angle: 14 } } }).neck.head.tongueLine, { on: false, points: [] });
});

test('flat headstock: level with the neck, its face stepped down, a scoop from the nut, and the back curving down to meet it', () => {
  const d = defaultDesign(); d.neck.head = { ...d.neck.head, kind: 'flat', voluteHeight: 0 };
  const g = derive(d, { tol: 0.005 }), n = g.neck, h = n.head, S = h.sections;
  assert.ok(h.level && h.ang === 0 && h.sin === 0 && h.cos === 1 && h.drop === 5 && h.scoop === 22 && h.reach === 45, 'starting values: face 5 mm down, scoop 22 mm');
  // the face: at the neck's top at the nut, 5 mm down from the end of the scoop on, and level from there
  assert.ok(Math.abs(h.faceZ(g.nutY) - n.top) < 1e-12 && Math.abs(h.faceZ(g.nutY + 22) - (n.top - 5)) < 1e-12 && h.faceZ(g.nutY + 100) === n.top - 5 && h.faceZ(g.nutY - 10) === n.top);
  // the scoop is an arc of one circle, level where it meets the face
  const R = (22 * 22 + 5 * 5) / (2 * 5), cz = n.top - 5 + R;
  for (let v = 0; v <= 22; v += 1) assert.ok(Math.abs(Math.hypot(v - 22, h.faceZ(g.nutY + v) - cz) - R) < 1e-9, 'on the circle at ' + v);
  assert.ok(Math.abs((h.faceZ(g.nutY + 22) - h.faceZ(g.nutY + 21.99)) / 0.01) < 1e-3 && (h.faceZ(g.nutY + 0.01) - h.faceZ(g.nutY)) / 0.01 < -0.4, 'level at the bottom, steep at the nut');
  // every section stands upright, with its top edge on the face; the last is the flat's own section
  for (const q of S) { assert.ok(q.p3.every((p) => Math.abs(p[1] - (g.nutY + q.v)) < 1e-9), 'upright'); assert.ok(Math.abs(q.p3[0][2] - h.faceZ(g.nutY + q.v)) < 1e-9 && Math.abs(q.p3[q.p3.length - 1][2] - h.faceZ(g.nutY + q.v)) < 1e-9); }
  const end = S[S.length - 1];
  assert.ok(end.v === 45 && end.base === h.thick && end.p3.filter((p) => Math.abs(p[0]) < end.left - 0.5).every((p) => Math.abs(p[2] - (n.top - 5 - h.thick)) < 1e-9), 'the back of the headstock is its thickness below its face');
  // seen from the side, the back runs from the neck's line down to the headstock's back, which is deeper, with no kink
  assert.ok(Math.abs(h.backZ(g.nutY - 15) - (n.top - n.d1)) < 1e-9 && Math.abs(h.backZ(g.nutY + h.ahead) - (n.top - 5 - h.thick)) < 1e-9 && n.d1 < 5 + h.thick);
  for (let y = g.nutY - 20; y < g.nutY + 50; y += 0.25) assert.ok(Math.abs((h.backZ(y + 0.25) - h.backZ(y)) / 0.25 - (h.backZ(y) - h.backZ(y - 0.25)) / 0.25) < 0.01);
  // the transition is never shorter than the scoop
  d.neck.head = { ...d.neck.head, scoop: 50, transition: 30 };
  assert.equal(derive(d, { tol: 0.005 }).neck.head.reach, 55);
  // an angled headstock has no drop and no scoop, and an older file opens as angled
  const a = derive(defaultDesign(), { tol: 0.005 }).neck.head;
  assert.ok(!a.level && a.drop === 0 && a.scoop === 0);
  assert.equal(normalizeDesign({ schema: 'blackchapel.guitar/v1', outline: d.outline, neck: { scale: 647.7, head: { on: true, angle: 14 } } }).neck.head.kind, 'angled');
});

test('drawn lines have handles: a point\'s own handles set the direction and reach of the curve there', () => {
  const base = [{ s: -40, out: 0 }, { s: -20, out: 2.25 }, { s: 0, out: 4 }, { s: 12.5, out: 2.25 }, { s: 25, out: 0 }];
  const plain = sideLine(base);
  // with no handles of its own a point gets handles a third of the way to each neighbor, along the smooth line
  assert.ok(plain.used[0].hi === null && plain.used[4].ho === null && Math.abs(plain.used[2].ho[0] - 12.5 / 3) < 1e-12 && Math.abs(plain.used[2].hi[0] + 20 / 3) < 1e-12 && plain.used[2].ho[1] === 0 && plain.points[2].ho === null);
  // a point's own handles: the curve leaves the point along them
  const own = sideLine(base.map((p, i) => (i === 2 ? { ...p, hi: [-6, -1.5], ho: [8, 2] } : p)));
  for (const p of own.points) assert.ok(Math.abs(own.out(p.s) - p.out) < 1e-9, 'still through every point');
  const slope = (f, s) => (f.out(s + 1e-5) - f.out(s - 1e-5)) / 2e-5;
  assert.ok(Math.abs(slope(own, 0.001) - 2 / 8) < 0.01 && Math.abs(slope(own, -0.001) - 1.5 / 6) < 0.01, 'the slope at the point is the handle\'s');
  assert.ok(own.out(4) > plain.out(4) + 0.3, 'and the curve bulges the way the handle was pulled');
  assert.ok(Math.abs(own.out(-30) - plain.out(-30)) < 1e-9 && Math.abs(own.out(20) - plain.out(20)) < 1e-9, 'the pieces that do not touch that point are unchanged');
  // a handle reaches no farther along than the next point, and two that would pass each other are shortened to meet; the line never doubles back
  const far = sideLine(base.map((p, i) => (i === 2 ? { ...p, ho: [40, 3] } : i === 3 ? { ...p, hi: [-30, 1] } : p)));
  assert.ok(far.used[2].ho[0] <= 12.5 + 1e-9 && far.used[3].hi[0] >= -12.5 - 1e-9 && far.used[2].ho[0] - far.used[3].hi[0] <= 12.5 + 1e-9);
  for (let s = 0; s < 12.5; s += 0.1) assert.ok(Number.isFinite(far.out(s)));
  assert.ok(Math.abs(far.out(0) - 4) < 1e-9 && Math.abs(far.out(12.5) - 2.25) < 1e-9);
  // a handle that is not two numbers is ignored
  assert.deepEqual(sideLine(base.map((p, i) => (i === 2 ? { ...p, ho: ['x', 1], hi: [1] } : p))).used, plain.used);
  // dragging a handle on a smooth point turns the opposite one to stay in line and keeps its length; on a corner it does not
  const dragged = dragHandle(plain.points, plain.used, 2, 'ho', [6, 3]);
  assert.deepEqual(dragged[2].ho, [6, 3]);
  assert.ok(Math.abs(dragged[2].hi[0] * 3 - dragged[2].hi[1] * 6) < 0.05 && dragged[2].hi[0] < 0 && dragged[2].hi[1] < 0 && Math.abs(Math.hypot(...dragged[2].hi) - 20 / 3) < 0.02, 'in line with it, pointing the other way, as long as before');
  const corner = dragHandle(plain.points.map((p, i) => (i === 2 ? { ...p, k: 'c' } : p)), plain.used, 2, 'ho', [6, 3]);
  assert.ok(corner[2].ho[1] === 3 && Math.abs(corner[2].hi[1]) < 1e-9 && Math.abs(corner[2].hi[0] + 6.67) < 0.01);
  assert.deepEqual(dragHandle(plain.points, plain.used, 2, 'ho', [-5, 2])[2].ho, [0, 2], 'a forward handle cannot be dragged behind its point');
  // made smooth again, the two handles are brought back into line; automatic handles drops them
  const back = setPointKind(corner, sideLine(corner).used, 2, 's');
  assert.ok(back[2].k === 's' && Math.abs(back[2].hi[0] * back[2].ho[1] - back[2].hi[1] * back[2].ho[0]) < 0.05);
  assert.ok(autoHandles(dragged, 2)[2].hi === null && autoHandles(dragged, 2)[2].ho === null && autoHandles(dragged, 2)[1] !== undefined);
  // stored with the design: handles only where a point has its own
  assert.deepEqual(stored(plain.points[1], 'out'), { s: -20, out: 2.25, k: 's' });
  assert.deepEqual(stored(dragged[2], 'out'), { s: 0, out: 4, k: 's', hi: dragged[2].hi, ho: [6, 3] });
  // the tongue's outline: the round tip's handle points straight across the neck; pulled along the neck it makes the tip pointed
  const t = tongueOutline([{ s: -30, w: 0 }, { s: -14, w: 12 }, { s: 0, w: 16 }]);
  assert.ok(t.used[0].ho[0] === 0 && Math.abs(t.used[0].ho[1] - 0.55 * 12) < 1e-9 && t.round);
  const tp = tongueOutline([{ s: -30, w: 0, ho: [6, 2] }, { s: -14, w: 12 }, { s: 0, w: 16 }]);
  assert.ok(tp.round === false && tp.half(-29.9) < 0.1 && Math.abs(tp.half(-14) - 12) < 1e-9);
  // and it reshapes the neck
  const d = defaultDesign(); d.neck.head.side = { on: true, points: own.points.map((p) => stored(p, 'out')) };
  const h = derive(d, { tol: 0.005 }).neck.head;
  assert.ok(Math.abs(h.swell(4, 0) - own.out(4)) < 1e-9 && h.side.points[2].ho[0] === 8);
});

test('tuner holes: rows on straight lines, placed on either kind of headstock, with the wood left outside each', () => {
  const d = defaultDesign();
  assert.deepEqual(derive(d, { tol: 0.005 }).neck.head.tuners, [], 'none until a layout is chosen');
  d.neck.head.tuners = { ...d.neck.head.tuners, layout: '3+3' };
  const g = derive(d, { tol: 0.005 }), h = g.neck.head, t = h.tuners;
  assert.deepEqual(t.map((q) => [q.side, q.n, q.x, q.v, q.d]), [['bass', 1, -24, 38, 10], ['bass', 2, -27, 78, 10], ['bass', 3, -30, 118, 10], ['treble', 1, 24, 38, 10], ['treble', 2, 27, 78, 10], ['treble', 3, 30, 118, 10]]);
  for (const q of t) assert.ok(Math.abs(q.gap - (h.widths(q.v)[q.side === 'bass' ? 'l' : 'r'] - Math.abs(q.x) - 5)) < 1e-9 && q.gap > 0, 'the wood between the hole and the edge beside it');
  // where a hole is in space: on the tilted face of an angled headstock, on the level face of a flat one
  const a = h.spot(24, 78, 0), mid = h.spot(24, 78, h.thick / 2);
  assert.ok(Math.abs(a.z - h.faceZ(a.y)) < 1e-9 && Math.abs(a.y - (g.nutY + 78 * h.cos)) < 1e-9 && Math.abs(Math.hypot(mid.y - a.y, mid.z - a.z) - h.thick / 2) < 1e-9);
  d.neck.head.kind = 'flat';
  const f = derive(d, { tol: 0.005 }).neck.head, b = f.spot(24, 78, 0);
  assert.ok(f.tuners.length === 6 && Math.abs(b.y - (g.nutY + 78)) < 1e-9 && Math.abs(b.z - (g.neck.top - 5)) < 1e-9 && f.spot(24, 78, 7.5).z === b.z - 7.5);
  // numbers out of range or missing fall back sensibly; an older file has no tuner holes
  d.neck.head.tuners = { layout: '6', side: 'treble', hole: 'x', first: 32, pitch: 25, inFirst: 8, inLast: 26 };
  const six = derive(d, { tol: 0.005 }).neck.head.tuners;
  assert.ok(six.length === 6 && six[0].d === 10 && six.every((q) => q.side === 'treble'));
  assert.equal(normalizeDesign({ schema: 'blackchapel.guitar/v1', outline: d.outline, neck: { scale: 647.7, head: { on: true, angle: 14 } } }).neck.head.tuners.layout, 'none');
});
