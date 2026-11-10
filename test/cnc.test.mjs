// The 2D CNC vectors (src/export/cnc.js): finished edges at true position, layers named by depth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDesign, makeBridge } from '../src/model/design.js';
import { derive } from '../src/model/derive.js';
import { buildCncVectors, cncDXF, cncReadme } from '../src/export/cnc.js';
import { expandArcs } from '../src/core/arcfit.js';
import { bbox, signedArea } from '../src/core/poly.js';

const make = (d = defaultDesign()) => { const g = derive(d, { tol: 0.005 }); return { d, g, v: buildCncVectors(d, g) }; };
const on = (file, re) => file.paths.filter((p) => re.test(p.layer));
const box = (p) => bbox(expandArcs(p.verts, true));

test('a top file and a mirrored back file, each with the outline and its own work', () => {
  const { g, v } = make();
  assert.deepEqual(v.files.map((f) => f.side), ['top', 'back']);
  const [top, back] = v.files;
  for (const f of v.files) {
    const o = box(on(f, /^BODY_OUTLINE$/)[0]);
    assert.ok(Math.abs(o.w - g.bbox.w) < 0.02 && Math.abs(o.h - g.bbox.h) < 0.02, 'outline at true size');
    assert.ok(f.paths.every((p) => f.layers.some((L) => L.name === p.layer)), 'every path sits on a listed layer');
  }
  assert.equal(on(top, /^BACK_/).length, 0);
  assert.equal(on(back, /^TOP_/).length, 0);
  // the outline is not symmetric, so mirroring shows: the back file's left edge is the top file's right edge
  const ot = box(on(top, /^BODY_OUTLINE$/)[0]), ob = box(on(back, /^BODY_OUTLINE$/)[0]);
  assert.ok(Math.abs(ob.x0 + ot.x1) < 0.02 && Math.abs(ob.x1 + ot.x0) < 0.02);
});

test('pockets are at the finished edge and true position, on layers that carry their depth', () => {
  const { d, g, v } = make();
  const top = v.files[0];
  const pocket = on(top, /^TOP_NECK_POCKET_/);
  assert.equal(pocket.length, 1);
  assert.equal(pocket[0].layer, `TOP_NECK_POCKET_${d.neck.pocketDepth.toFixed(2)}MM_DEEP`);
  const pb = box(pocket[0]);
  assert.ok(Math.abs(pb.y0 - g.heelY) < 1e-6, 'pocket end wall on the heel line');
  assert.ok(pb.y1 > g.bbox.y1, 'the pocket runs past the body edge so the bit can leave');
  // no offsets: the pocket is exactly the derived pocket
  assert.ok(Math.abs(Math.abs(signedArea(expandArcs(pocket[0].verts, true))) - Math.abs(signedArea(g.pocket))) < 0.05);
  const singles = top.layers.find((L) => /^TOP_SINGLE_COIL/.test(L.name));
  assert.equal(singles.count, 2);
  assert.equal(singles.depth, d.pickups[1].depth);
});

test('the back file mirrors positions across the centerline', () => {
  const { d, v } = make();
  const cav = d.cavities[0];
  const b = box(on(v.files[1], /^BACK_CONTROL_CAVITY_/)[0]);
  assert.ok(Math.abs((b.x0 + b.x1) / 2 + cav.x) < 0.01 && Math.abs((b.y0 + b.y1) / 2 - cav.y) < 0.01);
  const ctl = d.controls[0];
  const holes = on(v.files[1], /^THROUGH_/).filter((p) => p.circle);
  assert.ok(holes.some((p) => Math.abs(p.circle.x + ctl.x) < 1e-9 && Math.abs(p.circle.y - ctl.y) < 1e-9 && Math.abs(p.circle.r - ctl.d / 2) < 1e-9));
});

test('holes are true circles; ones with no recorded depth say so in the layer name', () => {
  const d = defaultDesign(); d.bridge = makeBridge('tom');
  const { v } = make(d);
  const top = v.files[0];
  const posts = on(top, /BRIDGE_POST|TAILPIECE_STUD/);
  assert.equal(posts.length, 4);
  assert.ok(posts.every((p) => p.circle && /_DEPTH_TO_SUIT$/.test(p.layer) && Math.abs(p.circle.r - 11.3 / 2) < 1e-9));
  const screws = on(top, /^THROUGH_NECK_SCREW_/);
  assert.equal(screws.length, 4);
  assert.ok(screws.every((p) => p.circle));
});

test('a design with nothing cut from the back saves only a top file', () => {
  const d = defaultDesign(); d.bridge = makeBridge('tom'); d.cavities = [];
  assert.deepEqual(make(d).v.files.map((f) => f.side), ['top']);
});

test('the DXF lists every layer and writes circles as circles; the read-me names each layer and its depth', () => {
  const { d, v } = make();
  const dxf = cncDXF(v.files[0]);
  assert.match(dxf, /\$INSUNITS\r\n70\r\n4\r\n/);
  for (const L of v.files[0].layers) assert.ok(dxf.includes(`LAYER\r\n2\r\n${L.name}\r\n`), `layer table has ${L.name}`);
  assert.equal((dxf.match(/\r\nCIRCLE\r\n/g) || []).length, v.files[0].paths.filter((p) => p.circle).length);
  const text = cncReadme(d, v, ['a-top.dxf', 'a-back.dxf']);
  assert.match(text, /TOP_NECK_POCKET_15\.88MM_DEEP\r\n\s+Neck pocket: 15\.88 mm \(0\.6250 in\) deep/);
  assert.match(text, /does not record a depth/);
  assert.match(text, /have not been confirmed against a real neck/);
});
