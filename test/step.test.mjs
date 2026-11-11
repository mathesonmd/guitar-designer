// The body as a true CAD solid (src/export/step.js), built with the same engine the page fetches.
// The sliced solid behind the 3D picture is made a different way (stacked polygons), so the two
// agreeing on volume is a real cross-check. Run with: node --test test/step.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as rc from 'replicad';
import start from 'replicad-opencascadejs';
import { defaultDesign, normalizeDesign, edgeRounds, STARTERS, makeBridge } from '../src/model/design.js';
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
