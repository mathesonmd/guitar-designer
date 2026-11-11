// The body as a true CAD solid (src/export/step.js), built with the same engine the page fetches.
// The sliced solid behind the 3D picture is made a different way (stacked polygons), so the two
// agreeing on volume is a real cross-check. Run with: node --test test/step.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as rc from 'replicad';
import start from 'replicad-opencascadejs';
import { defaultDesign, normalizeDesign, edgeRounds, STARTERS, makeBridge } from '../src/model/design.js';
import { derive } from '../src/model/derive.js';
import { buildLayers } from '../src/model/solid.js';
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
