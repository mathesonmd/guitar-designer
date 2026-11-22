// The body as a true CAD solid (src/export/step.js), built with the same engine the page fetches.
// The sliced solid behind the 3D picture is made a different way (stacked polygons), so the two
// agreeing on volume is a real cross-check. Run with: node --test test/step.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as rc from 'replicad';
import start from 'replicad-opencascadejs';
import { defaultDesign, normalizeDesign, edgeRounds, bindingChannel, STARTERS, makeBridge } from '../src/model/design.js';
import { segmentsOf } from '../src/core/path.js';
import { cubicDeriv } from '../src/core/bezier.js';
import { EdgeIndex } from '../src/core/edgeindex.js';
import { bevelShape } from '../src/model/edgebevel.js';
import { derive } from '../src/model/derive.js';
import { buildLayers, bevelPlane, bevelProfile, bellyDish, bellyParams } from '../src/model/solid.js';
import { buildBodySolid, holesLeftOut, toSTEP, toSTL } from '../src/export/step.js';

let oc;
before(async () => { oc = await start(); rc.setOC(oc); });
const build = (d, opts) => { const g = derive(d, { tol: 0.005 }); return { g, cad: buildBodySolid(rc, oc, d, g, opts), slices: buildLayers(d, g) }; };
const pct = (a, b) => Math.abs(a / b - 1) * 100;
// every number that follows a given STEP entity name, one array per entity
const entities = (text, name) => [...text.replace(/\s+/g, ' ').matchAll(new RegExp(`=\\s*${name}\\s*\\(([^;]*)\\);`, 'g'))].map((m) => m[1]);

test('default body: one sound solid whose volume matches the sliced solid within 0.1%', () => {
  const { cad, slices } = build(defaultDesign());
  assert.equal(cad.valid, true);
  assert.ok(pct(cad.volume, slices.volume) < 0.1, `volume differs by ${pct(cad.volume, slices.volume).toFixed(3)}%`);
});

test('arm bevel and belly cut remove the same wood as in the sliced solid', () => {
  const d = defaultDesign(); d.contours.arm.on = true; d.contours.belly.on = true;
  const plain = build(defaultDesign()), cut = build(d);
  assert.ok(pct(cut.cad.volume, cut.slices.volume) < 0.1, `volume differs by ${pct(cut.cad.volume, cut.slices.volume).toFixed(3)}%`);
  const removedCad = plain.cad.volume - cut.cad.volume, removedSlices = plain.slices.volume - cut.slices.volume;
  assert.ok(removedCad > 50000, 'the contours take a real amount of wood');
  assert.ok(pct(removedCad, removedSlices) < 1, `wood removed differs by ${pct(removedCad, removedSlices).toFixed(2)}%`);
});

test('every starting shape builds with the default 1/8 in roundovers', () => {
  for (const key of Object.keys(STARTERS)) {
    const d = defaultDesign(); d.outline = JSON.parse(JSON.stringify(STARTERS[key].outline));
    const { cad, slices } = build(d);
    assert.ok(pct(cad.volume, slices.volume) < 0.1, `${key}: volume differs by ${pct(cad.volume, slices.volume).toFixed(3)}%`);
  }
});

test('square edges: leaving the roundovers out matches a design that has none', () => {
  const d = defaultDesign();
  const square = build(d, { roundovers: false });
  const d0 = defaultDesign(); d0.body.roundTop = 0; d0.body.roundBack = 0;
  const none = build(d0);
  assert.ok(Math.abs(square.cad.volume - none.cad.volume) < 1, 'same solid either way');
  assert.ok(square.cad.volume > build(d).cad.volume, 'square edges keep more wood than rolled ones');
  assert.ok(pct(square.cad.volume, none.slices.volume) < 0.05);
});

test('a roundover too large for the outline is refused in plain words, and square edges still work', () => {
  const d = defaultDesign(); d.outline = JSON.parse(JSON.stringify(STARTERS.tstyle.outline));
  d.body.roundTop = 6.35;
  assert.throws(() => build(d), /top edge roundover is too large to roll around the tightest outside curve/);
  assert.equal(build(d, { roundovers: false }).cad.valid, true);
});

test('holes with no stated depth are left out and named; through holes are in', () => {
  const d = defaultDesign(); d.bridge = makeBridge('tom');
  const g = derive(d, { tol: 0.005 });
  assert.deepEqual(holesLeftOut(g), [{ what: 'Bridge post holes', count: 2 }, { what: 'Tailpiece stud holes', count: 2 }]);
  const g0 = derive(defaultDesign(), { tol: 0.005 });
  assert.deepEqual(holesLeftOut(g0).map((l) => l.what), ['Bridge screw holes', 'String ferrule holes']);
  // the sliced solid drills the posts 20 mm deep for the picture; the CAD solid must not
  const posts = 4 * Math.PI * (11.3 / 2) ** 2 * 20;
  const { cad, slices } = build(d);
  assert.ok(Math.abs((cad.volume - slices.volume) - posts) < 0.001 * cad.volume, 'the only difference is the four undrilled post holes');
});

test('the STEP text is in millimeters, with true cylinders for holes and flat floors at pocket depth', async () => {
  const d = defaultDesign();
  const { g, cad } = build(d);
  const text = await toSTEP(rc, cad.shape, 'Test body');
  assert.ok(text.startsWith('ISO-10303-21;'));
  assert.match(text, /SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/);
  assert.match(text, /Test body/);
  const radii = entities(text, 'CYLINDRICAL_SURFACE').map((a) => +a.split(',').pop());
  for (const h of g.holes.filter((x) => x.side === 'through')) {
    assert.ok(radii.some((r) => Math.abs(r - h.d / 2) < 1e-6), `a cylinder of radius ${h.d / 2} for ${h.label}`);
  }
  // pocket corners are true arcs: upright cylinders at the heel corner radius
  assert.ok(radii.some((r) => Math.abs(r - d.neck.heelCornerR) < 1e-3), 'neck pocket corners are cylinders at the heel corner radius');
  // flat floors: a plane at each pocket's depth below the top
  const T = d.body.thickness;
  const points = new Map([...text.replace(/\s+/g, ' ').matchAll(/#(\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(([^)]*)\)\s*\)/g)].map((m) => [m[1], m[2].split(',').map(Number)]));
  const placements = new Map([...text.replace(/\s+/g, ' ').matchAll(/#(\d+)\s*=\s*AXIS2_PLACEMENT_3D\s*\(\s*'[^']*'\s*,\s*#(\d+)/g)].map((m) => [m[1], points.get(m[2])]));
  const planeZ = entities(text, 'PLANE').map((a) => placements.get(a.match(/#(\d+)/)[1])).filter(Boolean).map((p) => p[2]);
  for (const c of g.cuts) {
    const z = c.side === 'back' ? c.depth : T - c.depth;
    assert.ok(planeZ.some((v) => Math.abs(v - z) < 1e-6), `a flat floor at height ${z.toFixed(3)} for ${c.label}`);
  }
});

test('the STL is a closed mesh of the same solid: every edge shared by two facets, same volume, same size', () => {
  const d = defaultDesign(); d.contours.arm.on = true; d.contours.belly.on = true;
  const { g, cad } = build(d);
  const { data, triangles } = toSTL(cad.shape);
  const view = new DataView(data.buffer);
  assert.equal(view.getUint32(80, true), triangles);
  assert.equal(data.length, 84 + triangles * 50);
  assert.ok(!String.fromCharCode(...data.slice(0, 5)).startsWith('solid'), 'a binary STL must not begin with the word "solid"');
  const edges = new Map();
  let vol = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < triangles; i++) {
    const o = 84 + i * 50, P = [0, 1, 2].map((k) => [0, 4, 8].map((j) => view.getFloat32(o + 12 + k * 12 + j, true)));
    const [a, b, c] = P;
    vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = p.join(',') + '>' + q.join(','), back = q.join(',') + '>' + p.join(',');
      if (edges.get(back) > 0) { edges.get(back) === 1 ? edges.delete(back) : edges.set(back, edges.get(back) - 1); } else edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  assert.equal(edges.size, 0, `${edges.size} facet edges have no partner: the mesh has a gap`);
  assert.ok(pct(vol, cad.volume) < 0.01, `mesh volume differs from the solid by ${pct(vol, cad.volume).toFixed(4)}%`);
  assert.ok(Math.abs(x1 - x0 - g.bbox.w) < 0.05 && Math.abs(y1 - y0 - g.bbox.h) < 0.05, `mesh is ${(x1 - x0).toFixed(3)} x ${(y1 - y0).toFixed(3)}, outline is ${g.bbox.w.toFixed(3)} x ${g.bbox.h.toFixed(3)}`);
  assert.ok(Math.abs(z0) < 1e-4 && Math.abs(z1 - d.body.thickness) < 1e-4, 'back at 0, top at the body thickness');
});

test('leaving pockets and holes out gives the outline and contours only', () => {
  const d = defaultDesign(); d.contours.arm.on = true; d.contours.belly.on = true;
  const g = derive(d, { tol: 0.005 });
  const bare = buildBodySolid(rc, oc, d, g, { pockets: false });
  const uncut = buildLayers(d, { ...g, cuts: [], holes: [] });
  assert.ok(pct(bare.volume, uncut.volume) < 0.1, `volume differs from the uncut sliced body by ${pct(bare.volume, uncut.volume).toFixed(3)}%`);
  assert.ok(bare.volume > buildBodySolid(rc, oc, d, g).volume + 100000, 'the pockets are a real amount of wood');
  assert.deepEqual(bare.leftOut, []);
});

test('hole depths entered for the hardware are drilled in both solids, and those holes are no longer left out', () => {
  const d = defaultDesign(); d.bridge = makeBridge('tom'); d.bridge.depths = { post: 22, tail: 18 };
  const { g, cad, slices } = build(d);
  assert.deepEqual(holesLeftOut(g), []);
  assert.ok(pct(cad.volume, slices.volume) < 0.1);
  const none = build(Object.assign(defaultDesign(), { bridge: makeBridge('tom') }));
  const drilled = Math.PI * (11.3 / 2) ** 2 * (2 * 22 + 2 * 18);
  assert.ok(Math.abs((none.cad.volume - cad.volume) - drilled) < 5, 'the wood removed is exactly the four holes at the depths entered');
});

test('the binding channel removes a ledge of its width and depth all around the top, the same in both solids', () => {
  const d = defaultDesign(); d.body.roundTopOn = false; d.pickups = []; d.cavities = []; d.controls = []; d.bridge = makeBridge('none');
  const before = build(d);
  d.body.binding = { on: true, width: 2, depth: 7 };
  const { g, cad, slices } = build(d);
  assert.ok(pct(cad.volume, slices.volume) < 0.1, `volume differs by ${pct(cad.volume, slices.volume).toFixed(3)}%`);
  const removed = before.cad.volume - cad.volume, removedSlices = before.slices.volume - slices.volume;
  assert.ok(removed > 5000 && pct(removed, removedSlices) < 1, `ledge volume ${removed.toFixed(0)} against ${removedSlices.toFixed(0)} in the slices`);
  assert.equal(g.binding.inner.length, 1);
});

test('roundover switches: off means a square edge; a binding channel takes the top edge; old files keep their roundovers', () => {
  const d = defaultDesign();
  assert.deepEqual(edgeRounds(d), { top: 3.175, back: 3.175 });
  d.body.roundTopOn = false;
  assert.deepEqual(edgeRounds(d), { top: 0, back: 3.175 });
  const off = build(d), d0 = defaultDesign(); d0.body.roundTop = 0;
  assert.ok(Math.abs(off.cad.volume - build(d0).cad.volume) < 1, 'switched off is the same solid as a zero radius');
  d.body.roundTopOn = true; d.body.binding.on = true;
  assert.equal(edgeRounds(d).top, 0);
  const old = normalizeDesign({ schema: 'blackchapel.guitar/v1', body: { thickness: 44.45, roundTop: 6, roundBack: 3 }, outline: d.outline });
  assert.deepEqual(edgeRounds(old), { top: 6, back: 3 });
  assert.equal(old.body.binding.on, false);
  assert.deepEqual(old.bridge.depths, {});
});

test('an inch STL is the same mesh with every coordinate divided by 25.4', () => {
  const { cad } = build(defaultDesign());
  const mm = toSTL(cad.shape).data, inch = toSTL(cad.shape, { units: 'in' }).data;
  assert.equal(mm.length, inch.length);
  const a = new DataView(mm.buffer), b = new DataView(inch.buffer);
  for (let i = 0; i < 2000; i++) {
    const o = 84 + i * 50 + 12 + (i % 9) * 4;
    assert.ok(Math.abs(b.getFloat32(o, true) * 25.4 - a.getFloat32(o, true)) < 1e-3);
  }
  assert.match(String.fromCharCode(...inch.slice(0, 70)), /units are inches/);
});

// ---- contours: the arm bevel as a rolled cut, the belly cut as a cone ----
const bare = () => { const d = defaultDesign(); d.pickups = []; d.cavities = []; d.controls = []; d.bridge = makeBridge('none'); return d; };

test('arm bevel cross-section: the pieces join with no step and no kink, and a full roll leaves no crease', () => {
  for (const [crown, blend] of [[0, 30], [2, 30], [1, 200], [0, 0], [2.5, 0]]) {
    const p = bevelProfile(105, 12, crown, blend), e = 1e-4;
    assert.ok(Math.abs(p.P(105) - 12) < 1e-9, 'full depth at the body edge');
    assert.equal(p.P(p.start - 1), 0);
    for (const g of p.segs.slice(0, -1)) {
      const u = g.b[0];
      assert.ok(Math.abs(p.P(u + e) - p.P(u - e)) < 1e-3, `no step at s = ${u.toFixed(2)} (crown ${crown}, blend ${blend})`);
      if (blend > 0) assert.ok(Math.abs((p.P(u + 2 * e) - p.P(u + e)) - (p.P(u - e) - p.P(u - 2 * e))) < 1e-6, 'no kink where the blend meets the bevel');
    }
    let last = -1; for (let u = p.start - 1; u < 105; u += 0.5) { assert.ok(p.P(u) >= last - 1e-9, 'always deepening'); last = p.P(u); }
  }
  const full = bevelProfile(105, 12, 999, 0);
  assert.ok(Math.abs(full.crown - full.crownMax) < 0.01 && (full.P(0.5) - full.P(0)) / 0.5 < 0.01, 'at a full roll the cut leaves the top almost level');
  const tight = bevelProfile(105, 12, 0, 5000);
  assert.ok(tight.blend < 5000 && tight.blend > 100, 'a blend too big for the bevel is held to what fits');
});

test('the arm bevel is straight along its line and curved across it, like a cut from a flat sander', () => {
  const d = bare(); d.contours.arm.on = true;
  assert.deepEqual([d.contours.arm.roll, d.contours.arm.bounded], [1, false], 'a new bevel is fully rolled and runs right across the body');
  const g = derive(d, { tol: 0.005 }), c = d.contours.arm, arm = bevelPlane(c, g.outline, g.centroid, 40);
  const at = (v, s) => [c.x1 + arm.tx * v + arm.nx * s, c.y1 + arm.ty * v + arm.ny * s];
  // straight along the line: the same depth anywhere along it, including past both squares
  for (const s of [5, arm.sMax / 2, arm.sMax]) for (const v of [-80, 0, 60, arm.l, arm.l + 80]) assert.ok(Math.abs(arm.depth(...at(v, s)) - arm.depth(...at(arm.l / 2, s))) < 1e-9);
  // curved across it: a circular arc, level where it leaves the top and at full depth at the body edge
  assert.ok(Math.abs(arm.depth(...at(50, arm.sMax)) - 12) < 1e-9);
  assert.ok(arm.depth(...at(50, 0.5)) < 0.01, 'no crease where it leaves the top');
  const q = arm.sMax / 4, d1 = arm.depth(...at(50, q)), d2 = arm.depth(...at(50, 2 * q)), d3 = arm.depth(...at(50, 3 * q));
  assert.ok(d2 - d1 > d1 && d3 - d2 > d2 - d1, 'it steepens steadily toward the edge');
  const n = arm.normal(...at(50, 2 * q));
  assert.ok(Math.abs(n[0] * arm.tx + n[1] * arm.ty) < 1e-6, 'the surface does not tilt along the line at all');
  // the line to draw runs from one side of the body to the other
  assert.ok(arm.t0 < -20 && arm.t1 > arm.l + 20);
});

test('arm bevel kept between its squares, with a run-out: full depth in the middle, nothing at either end', () => {
  const d = bare(); d.contours.arm = { ...d.contours.arm, on: true, bounded: true, fade: 50 };
  const g = derive(d, { tol: 0.005 });
  const flat = bevelPlane({ ...d.contours.arm, fade: 0 }, g.outline, g.centroid, 40), arm = bevelPlane(d.contours.arm, g.outline, g.centroid, 40);
  const at = (v, s) => [d.contours.arm.x1 + arm.tx * v + arm.nx * s, d.contours.arm.y1 + arm.ty * v + arm.ny * s];
  const half = arm.sMax / 2;
  assert.ok(arm.depth(...at(arm.l / 2, half)) > 1 && Math.abs(arm.depth(...at(arm.l / 2, half)) - flat.depth(...at(arm.l / 2, half))) < 1e-9, 'unchanged in the middle');
  assert.ok(arm.depth(...at(0, arm.sMax)) < 1e-9, 'nothing left at the very end, even at the body edge');
  assert.equal(arm.depth(...at(-5, half)), 0);
  assert.equal(arm.depth(...at(-5, arm.sMax + 30)), 0, 'wood past the end of the line is left alone');
  assert.ok(arm.depth(...at(25, arm.sMax)) > 0 && arm.depth(...at(25, arm.sMax)) < flat.depth(...at(25, arm.sMax)), 'shallower partway through the run-out');
  assert.equal(bevelPlane({ ...d.contours.arm, fade: 5000 }, g.outline, g.centroid, 40).fade, arm.l / 2);
  assert.equal(bevelPlane({ ...d.contours.arm, bounded: false }, g.outline, g.centroid, 40).fade, 0, 'a run-out only applies to a cut kept between its squares');
});

test('every contour setting removes the same wood in the CAD solid as in the sliced solid', () => {
  const plain = build(bare());
  const cases = [
    { arm: {} }, { arm: { roll: 0 } }, { arm: { roll: 0, blend: 60 } }, { arm: { roll: 0.5, blend: 40 } }, { arm: { bounded: true } }, { arm: { bounded: true, fade: 60, roll: 0.6, blend: 40 } },
    { belly: { blend: 0 } }, { belly: {} }, { belly: { angle: 0.4, blend: 40, len: 150, reach: 55 } },
    { arm: {}, belly: {} },
  ];
  for (const c of cases) {
    const d = bare();
    if (c.arm) d.contours.arm = { ...d.contours.arm, on: true, ...c.arm };
    if (c.belly) d.contours.belly = { ...d.contours.belly, on: true, ...c.belly };
    const r = build(d), name = JSON.stringify(c);
    assert.equal(r.cad.valid, true, name);
    assert.ok(pct(r.cad.volume, r.slices.volume) < 0.1, `${name}: body volume differs by ${pct(r.cad.volume, r.slices.volume).toFixed(3)}%`);
    const cad = plain.cad.volume - r.cad.volume, sl = plain.slices.volume - r.slices.volume;
    assert.ok(cad > 3000 && pct(cad, sl) < 2, `${name}: wood removed ${cad.toFixed(0)} against ${sl.toFixed(0)} in the slices`);
  }
});

test('each contour setting changes the cut the way its name says', () => {
  const vol = (arm, belly) => { const d = bare(); if (arm) d.contours.arm = { ...d.contours.arm, on: true, ...arm }; if (belly) d.contours.belly = { ...d.contours.belly, on: true, ...belly }; return build(d).cad.volume; };
  const flat = vol({ roll: 0 });
  assert.ok(vol({ roll: 1 }) > vol({ roll: 0.5 }) && vol({ roll: 0.5 }) > flat, 'the more the cut is rolled, the more wood it leaves');
  assert.ok(vol({ roll: 0, blend: 60 }) < flat, 'rounding the crease takes a little more wood');
  assert.ok(vol({ roll: 0, bounded: true }) > flat - 1, 'keeping the cut between its squares never takes more');
  assert.ok(vol({ roll: 0, bounded: true, fade: 60 }) > vol({ roll: 0, bounded: true }), 'running out at the ends leaves more wood');
  const sharp = vol(null, { blend: 0 });
  assert.ok(vol(null, { blend: 60 }) < sharp, 'rounding the rim takes a little more wood');
});

test('the belly cut is a cone: straight slope from its center to its rim, length parallel to the centerline, and older files convert', () => {
  const d = defaultDesign(), b = d.contours.belly;
  assert.equal(b.angle, 0);
  const cone = bellyDish({ ...b, on: true, blend: 0 });
  const xs = cone.ellipse(1, 360).map((p) => p.x), ys = cone.ellipse(1, 360).map((p) => p.y);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - b.len) < 0.01, 'its length runs along the centerline');
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 2 * b.reach) < 0.01, 'its reach runs across');
  assert.ok(Math.abs(cone.depth(b.x, b.y) - 14) < 1e-9, 'deepest at its center');
  for (const f of [0.25, 0.5, 0.75]) {
    assert.ok(Math.abs(cone.depth(b.x + b.reach * f, b.y) - 14 * (1 - f)) < 1e-9, 'a straight slope across');
    assert.ok(Math.abs(cone.depth(b.x, b.y + (b.len / 2) * f) - 14 * (1 - f)) < 1e-9, 'a straight slope along');
  }
  // an older file: deepest point and reach point 60 mm apart straight across, 160 long
  const old = { on: true, x1: -200, y1: 0, x2: -140, y2: 0, len: 160, drop: 12 };
  assert.deepEqual(bellyParams(old), { on: true, x: -200, y: 0, angle: 0, len: 160, reach: 60, drop: 12, blend: 0 });
  const n = normalizeDesign({ schema: 'blackchapel.guitar/v1', outline: d.outline, contours: { belly: old, arm: { on: true, x1: -164, y1: 30, x2: -70, y2: -150, drop: 12 } } }).contours;
  assert.deepEqual([n.belly.x, n.belly.y, n.belly.angle, n.belly.len, n.belly.reach, n.belly.drop, n.belly.x1, n.belly.blend], [-200, 0, 0, 160, 60, 12, undefined, 0]);
  assert.deepEqual([n.arm.roll, n.arm.crown, n.arm.bounded], [null, 0, true], 'an older arm bevel stays flat and between its squares');
  // the short smooth transition: the cut starts a little outside the bare cone's rim and is unchanged away from it
  assert.ok(b.blend > 0, 'a new belly cut starts with a rim blend');
  const soft = bellyDish({ ...b, on: true }), rimX = b.x + b.reach;
  assert.equal(cone.depth(rimX + 0.5, b.y), 0);
  assert.ok(soft.depth(rimX + 0.5, b.y) > 0 && soft.depth(rimX + 30, b.y) === 0);
  assert.ok(Math.abs(soft.depth(rimX - 30, b.y) - cone.depth(rimX - 30, b.y)) < 1e-9, 'unchanged away from the rim');
});

// ---- the bevel around the top edge, shaped from an inner line ----
test('edge bevel: on every starting shape the inner line is clean and the CAD solid matches the sliced solid', () => {
  for (const key of Object.keys(STARTERS)) for (const width of [15, 30]) {
    const d = bare(); d.outline = JSON.parse(JSON.stringify(STARTERS[key].outline));
    const before = build(d);
    d.body.edgeBevel = { ...d.body.edgeBevel, on: true, width, drop: 6 };
    const r = build(d), e = r.g.bevelEdge, name = `${key} at ${width} mm`;
    assert.equal(e.crosses, false, `${name}: the inner line does not cross itself`);
    const so = segmentsOf(e.outer, true), si = segmentsOf(e.inner, true);
    so.forEach((a, i) => assert.ok((a.p3.x - a.p0.x) * (si[i].p3.x - si[i].p0.x) + (a.p3.y - a.p0.y) * (si[i].p3.y - si[i].p0.y) > 0, `${name}: the inner line runs the same way as the outline at segment ${i}`));
    assert.equal(r.cad.valid, true, name);
    assert.ok(pct(r.cad.volume, r.slices.volume) < 0.01, `${name}: volume differs by ${pct(r.cad.volume, r.slices.volume).toFixed(4)}%`);
    assert.ok(before.cad.volume - r.cad.volume > 30000, `${name}: the bevel takes a real amount of wood`);
  }
});

test('edge bevel: flat from the inner line down to its depth at the body edge', () => {
  const d = bare(); d.outline = JSON.parse(JSON.stringify(STARTERS.blank.outline)); d.body.edgeBevel = { ...d.body.edgeBevel, on: true, width: 20, drop: 8 };
  const g = derive(d, { tol: 0.005 }), e = g.bevelEdge, T = d.body.thickness;
  // bottom of the body (the outline's lowest point, on the centerline): the inner line sits 20 mm in
  const low = e.handles.find((h) => Math.abs(h.outer.x) < 1e-6 && h.outer.y < 0);
  assert.ok(Math.abs(low.width - 20) < 1e-9 && Math.abs(low.inner.y - (low.outer.y + 20)) < 1e-6 && Math.abs(low.inner.x) < 1e-6);
  // halfway down the bevel the body's edge is halfway between the inner line and the outline: a straight slope
  const lowest = (z) => Math.min(...e.shapeAt(z).map((p) => p.y));
  assert.ok(Math.abs(lowest(T - 4) - (low.outer.y + 10)) < 0.05);
  assert.ok(Math.abs(lowest(T - 8) - low.outer.y) < 0.05 && Math.abs(lowest(T) - low.inner.y) < 0.05);
  // the slices carry it between T - drop and T
  const s = buildLayers(d, g), band = s.layers.filter((L) => L.tag.edge);
  assert.ok(band.length >= 12 && Math.abs(band[0].z0 - (T - 8)) < 1e-6 && Math.abs(band[band.length - 1].z1 - T) < 1e-6);
  assert.ok(band.every((L, i) => i === 0 || L.area < band[i - 1].area), 'the body narrows steadily toward the top');
});

test('edge bevel: each outline point has its own width, mirrored outlines mirror it, and tight places are held narrower', () => {
  const d = bare(); d.outline = JSON.parse(JSON.stringify(STARTERS.blank.outline)); d.body.edgeBevel = { ...d.body.edgeBevel, on: true, width: 12, drop: 6 };
  d.outline.nodes[1].bw = 40; // the upper bout point on the bass side (stored half)
  const e = derive(d, { tol: 0.005 }).bevelEdge;
  const wide = e.handles.filter((h) => Math.abs(h.asked - 40) < 1e-9);
  assert.equal(wide.length, 2, 'the mirrored half gets the same width');
  assert.ok(Math.abs(wide[0].outer.x + wide[1].outer.x) < 1e-6 && Math.abs(wide[0].inner.x + wide[1].inner.x) < 1e-6);
  assert.ok(e.handles.filter((h) => Math.abs(h.asked - 12) < 1e-9).length === e.handles.length - 2);
  // a horn tip cannot take a wide bevel: the width there is held to the room the horn has
  const h = bare(); h.body.edgeBevel = { ...h.body.edgeBevel, on: true, width: 30, drop: 6 };
  const eh = derive(h, { tol: 0.005 }).bevelEdge;
  assert.ok(eh.widths.some((w, i) => w < eh.asked[i] - 5), 'held narrower somewhere');
  assert.ok(Math.max(...eh.widths) > 29, 'and full width where there is room');
});

test('edge bevel and the other edge treatments: the binding channel gives way, the top roundover stays where there is no bevel', () => {
  const d = defaultDesign(); d.body.binding.on = true;
  assert.ok(bindingChannel(d));
  d.body.edgeBevel.on = true;
  assert.equal(bindingChannel(d), null);
  assert.deepEqual(edgeRounds(d), { top: 3.175, back: 3.175 });
  assert.equal(derive(d).binding, null);
  assert.equal(normalizeDesign({ schema: 'blackchapel.guitar/v1', outline: d.outline }).body.edgeBevel.on, false, 'older files open with the bevel off');
  // a bevel of no width anywhere leaves the body exactly as it was, roundover and all
  const plain = build(bare());
  const none = bare(); none.body.edgeBevel = { ...none.body.edgeBevel, on: true, width: 0 };
  const r = build(none);
  assert.ok(Math.abs(r.cad.volume - plain.cad.volume) < 1 && Math.abs(r.slices.volume - plain.slices.volume) < 1);
});

test('edge bevel: the inner line is the same whether the outline is worked out finely or coarsely', () => {
  // the 3D view derives the body with a coarser outline than the saved files do
  for (const key of Object.keys(STARTERS)) {
    const d = bare(); d.outline = JSON.parse(JSON.stringify(STARTERS[key].outline)); d.body.edgeBevel = { ...d.body.edgeBevel, on: true, width: 15, drop: 6 };
    const fine = derive(d, { tol: 0.005 }).bevelEdge;
    for (const tol of [0.02, 0.03, 0.1]) { // the tolerances the page uses for the drawing, the checks and the 3D view
      const coarse = derive(d, { tol }).bevelEdge;
      assert.equal(coarse.widths.length, fine.widths.length);
      const worst = Math.max(...coarse.widths.map((w, i) => Math.abs(w - fine.widths[i])));
      assert.ok(worst < 1.5, `${key} at outline tolerance ${tol}: widths differ by up to ${worst.toFixed(2)} mm`);
      assert.ok(Math.min(...coarse.widths) > 1 || Math.min(...fine.widths) <= 1, `${key}: no point pinched to nothing by a coarse outline`);
    }
  }
});

const shaped = (fn, eb = {}) => { const d = bare(); d.body.edgeBevel = { ...d.body.edgeBevel, on: true, width: 15, drop: 6, ...eb }; if (fn) fn(d); return d; };
const taperOff = (d) => { [0, 1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15].forEach((i) => { d.outline.nodes[i].bw = 0; }); d.outline.nodes[7].bw = 50; d.outline.nodes[7].bd = 10; };

test('edge bevel: the inner line is smooth, with no kink where the width changes', () => {
  const d = shaped((q) => { q.outline.nodes[6].bw = 38; q.outline.nodes[7].bw = 55; q.outline.nodes[8].bw = 38; q.outline.nodes[5].bw = 14; q.outline.nodes[9].bw = 14; }, { width: 10 });
  const e = derive(d, { tol: 0.005 }).bevelEdge, segs = segmentsOf(e.inner, true);
  let smooth = 0;
  segs.forEach((s, i) => {
    const nx = segs[(i + 1) % segs.length], a = cubicDeriv(s.p0, s.p1, s.p2, s.p3, 1), b = cubicDeriv(nx.p0, nx.p1, nx.p2, nx.p3, 0);
    const turn = (Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))))) * 180) / Math.PI;
    if (turn < 20) { smooth++; assert.ok(turn < 0.01, `the inner line turns ${turn.toFixed(3)} degrees at point ${i + 1}`); } // anything sharper is one of the outline's own corners
  });
  assert.ok(smooth > segs.length - 8, 'nearly every point is a smooth one');
  // and no stretch of it wobbles: its direction never swings back and forth from one sample to the next
  const pts = e.innerPoly, turnAt = (i) => { const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length]; return Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)); };
  let flips = 0; for (let i = 0; i < pts.length; i++) { const t0 = turnAt(i), t1 = turnAt((i + 1) % pts.length); if (Math.abs(t0) > 0.004 && Math.abs(t1) > 0.004 && t0 * t1 < 0) flips++; }
  assert.ok(flips < 16, `the inner line changes the way it bends ${flips} times; a wavy line would do so far more`);
});

test('edge bevel at one width all round: the inner line stays that far from the body edge', () => {
  const d = shaped(null, { width: 12 }); d.outline = JSON.parse(JSON.stringify(STARTERS.blank.outline));
  const g = derive(d, { tol: 0.005 }), idx = new EdgeIndex(g.outline, 12);
  const off = g.bevelEdge.innerPoly.map((p) => idx.nearest(p.x, p.y).d);
  assert.ok(Math.min(...off) > 11.3 && Math.max(...off) < 12.3, `inner line is ${Math.min(...off).toFixed(2)} to ${Math.max(...off).toFixed(2)} mm from the outline`);
});

test('edge bevel: width and depth run smoothly between points and a width of 0 tapers the bevel to nothing', () => {
  const d = shaped(taperOff), g = derive(d, { tol: 0.005 }), e = g.bevelEdge, T = d.body.thickness;
  assert.ok(e.widths.every((w) => w >= 0) && e.depths.every((v) => v >= 0), 'nothing overshoots below zero');
  assert.ok(e.widths.filter((w) => w < 1e-6).length > 30, 'no bevel along the stretch set to 0');
  assert.ok(Math.abs(Math.max(...e.widths) - 50) < 1e-6 && Math.abs(e.deepest - 10) < 1e-6, 'full size at the point given its own width and depth');
  // widths rise steadily from nothing to full and fall again: one hump, no ripples
  let rises = 0; for (let i = 0; i < e.widths.length; i++) { const a = e.widths[i], b = e.widths[(i + 1) % e.widths.length], c = e.widths[(i + 2) % e.widths.length]; if (b > a + 1e-9 && b > c + 1e-9) rises++; }
  assert.equal(rises, 1);
  // the depth is never more than three times the width, so the bevel fades out as it narrows
  assert.ok(e.depths.every((v, i) => v <= 3 * e.widths[i] + 1e-9));
  // at a point with no bevel the body is whole right up to the top
  const top = e.shapeAt(T - 0.01), idx = new EdgeIndex(g.outline, 12);
  const upperHorn = top.filter((p) => p.y > 250);
  assert.ok(upperHorn.length > 20 && upperHorn.every((p) => !(idx.nearest(p.x, p.y).d > 0.05 && pointInOutline(p, g.outline))), 'no wood is taken near the horns');
});
const pointInOutline = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };

test('edge bevel: a rolled profile leaves the top level and takes less wood; every shaping matches in both solids', () => {
  assert.ok(bevelShape(0.5, 0) === 0.5 && Math.abs(bevelShape(0.5, 1) - 0.25) < 1e-12 && bevelShape(1, 1) === 1 && bevelShape(0, 1) === 0);
  assert.ok(bevelShape(0.01, 1) < 0.001, 'fully rolled, it leaves the top almost level');
  const plain = build(bare());
  const cases = { flat: shaped(), 'rolled 100%': shaped(null, { roll: 1 }), 'rolled 50%': shaped(null, { roll: 0.5 }), tapered: shaped(taperOff), 'tapered and rolled': shaped(taperOff, { roll: 1 }), 'deeper on one side': shaped((q) => { q.outline.nodes[6].bd = 14; q.outline.nodes[8].bd = 2; }) };
  const removed = {};
  for (const [name, d] of Object.entries(cases)) {
    const r = build(d);
    assert.equal(r.cad.valid, true, name);
    assert.ok(pct(r.cad.volume, r.slices.volume) < 0.01, `${name}: volume differs by ${pct(r.cad.volume, r.slices.volume).toFixed(4)}%`);
    removed[name] = plain.cad.volume - r.cad.volume;
    assert.ok(removed[name] > 5000, `${name}: takes a real amount of wood`);
  }
  assert.ok(removed['rolled 100%'] < removed['rolled 50%'] && removed['rolled 50%'] < removed.flat, 'the more it is rolled, the more wood it leaves');
  // a full roll uses nine tenths of the curve (it leaves the top at a tenth of the flat slope), which takes 0.7 of the flat bevel's wood
  assert.ok(Math.abs(removed['rolled 100%'] / removed.flat - 0.7) < 0.02, `a full roll takes ${(removed['rolled 100%'] / removed.flat).toFixed(3)} of what the flat bevel takes`);
});

test('purfling channel: a groove of its width and depth along the inner line, in the 3D picture but not in the CAD solid', () => {
  const d = shaped(null, { purfling: true, purflingWidth: 2, purflingDepth: 3 });
  const without = build(shaped()), r = build(d), p = r.g.purfling;
  const idx = new EdgeIndex(p.outer[0], 12), gaps = p.inner[0].map((q) => idx.nearest(q.x, q.y).d);
  assert.ok(Math.min(...gaps) > 1.9 && Math.max(...gaps) < 2.1, `the channel is ${Math.min(...gaps).toFixed(2)} to ${Math.max(...gaps).toFixed(2)} mm wide`);
  const groove = without.slices.volume - r.slices.volume, length = r.g.bevelEdge.innerPoly.reduce((s, q, i, a) => s + Math.hypot(a[(i + 1) % a.length].x - q.x, a[(i + 1) % a.length].y - q.y), 0);
  // (a little under length x width x depth: the groove's inner side is shorter, and it closes up inside the horns)
  assert.ok(groove / (length * 2 * 3) > 0.88 && groove / (length * 2 * 3) < 1.01, `groove volume ${groove.toFixed(0)} against about ${(length * 6).toFixed(0)}`);
  assert.ok(Math.abs(r.cad.volume - without.cad.volume) < 1, 'the CAD solid leaves the channel out (the save dialog says so)');
  assert.equal(derive(bare()).purfling, null, 'no purfling without the bevel');
});

test('the saved model is checked against the sliced solid: a wrong solid is never returned', () => {
  // the J-style outline with a wide, fully rolled bevel: the engine cuts the smooth surface wrongly and reports no error
  const d = bare(); d.outline = JSON.parse(JSON.stringify(STARTERS.jstyle.outline)); d.body.edgeBevel = { ...d.body.edgeBevel, on: true, roll: 1, width: 30 };
  const g = derive(d, { tol: 0.005 }), expectVolume = buildLayers(d, g).volume;
  const unchecked = buildBodySolid(rc, oc, d, g);
  assert.ok(pct(unchecked.volume, expectVolume) > 1, 'without the check, the engine hands back a solid that is the wrong size');
  const checked = buildBodySolid(rc, oc, d, g, { expectVolume });
  assert.equal(checked.bevelStrips, true, 'with it, the bevel is rebuilt from flat strips');
  assert.ok(pct(checked.volume, expectVolume) < 0.05, `and matches within ${pct(checked.volume, expectVolume).toFixed(4)}%`);
  // a body the engine handles is returned as it is, with a smooth bevel
  const easy = bare(); easy.body.edgeBevel = { ...easy.body.edgeBevel, on: true, roll: 1 };
  const ge = derive(easy, { tol: 0.005 });
  assert.equal(buildBodySolid(rc, oc, easy, ge, { expectVolume: buildLayers(easy, ge).volume }).bevelStrips, undefined);
  // and when nothing makes the volumes agree, the save is refused in plain words
  assert.throws(() => buildBodySolid(rc, oc, easy, ge, { expectVolume: buildLayers(easy, ge).volume * 1.05 }), /did not come out the same size as the body in the 3D view, so it was not saved/);
});
