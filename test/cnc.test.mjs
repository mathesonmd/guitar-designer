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
  assert.ok(Math.abs(pb.y1 - (g.mouthY + 12)) < 1e-6, 'the pocket runs 12 mm past the body edge it opens through, so the bit can leave');
  // no offsets: the pocket is exactly the derived pocket, cut off at that height
  assert.ok(Math.abs(Math.abs(signedArea(expandArcs(pocket[0].verts, true))) - Math.abs(signedArea(g.pocketTo(g.mouthY + 12)))) < 0.05);
  assert.ok(Math.abs(pb.w - d.neck.heelWidth - (d.neck.mouthWidth - d.neck.heelWidth) * ((pb.y1 - g.heelY) / d.neck.pocketLength)) < 0.01, 'pocket width is the neck\'s, with nothing added');
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

test('nothing reaches outside the body outline\'s box, so centering the vectors and the model lines them up', () => {
  const { g, v } = make();
  assert.equal(v.pocketOverrun, 0);
  for (const f of v.files) {
    const all = bbox(f.paths.flatMap((p) => expandArcs(p.verts, p.closed)));
    const o = box(on(f, /^BODY_OUTLINE$/)[0]);
    assert.ok(Math.abs(all.x0 - o.x0) < 0.02 && Math.abs(all.x1 - o.x1) < 0.02 && Math.abs(all.y0 - o.y0) < 0.02 && Math.abs(all.y1 - o.y1) < 0.02, `${f.side}: the file's box is the outline's box`);
    assert.ok(Math.abs(o.w - g.bbox.w) < 0.02 && Math.abs(o.h - g.bbox.h) < 0.02);
  }
});

test('inch files: every coordinate and size divided by 25.4, layer names and DXF header in inches', () => {
  const d = defaultDesign(); const g = derive(d, { tol: 0.005 });
  const mm = buildCncVectors(d, g), inch = buildCncVectors(d, g, { units: 'in' });
  // the inch outline is expanded more finely: the helper's chord tolerance is in the file's own unit
  const a = box(on(mm.files[0], /^BODY_OUTLINE$/)[0]), b = bbox(expandArcs(on(inch.files[0], /^BODY_OUTLINE$/)[0].verts, true, 0.0001));
  assert.ok(Math.abs(b.w * 25.4 - a.w) < 0.01 && Math.abs(b.x0 * 25.4 - a.x0) < 0.01 && Math.abs(b.y1 * 25.4 - a.y1) < 0.01); // boxes are sampled from arcs
  const cm = on(mm.files[0], /^THROUGH_NECK_SCREW/)[0].circle, ci = on(inch.files[0], /^THROUGH_NECK_SCREW/)[0].circle;
  assert.ok(Math.abs(ci.r * 25.4 - cm.r) < 1e-9 && Math.abs(ci.x * 25.4 - cm.x) < 1e-9);
  assert.ok(inch.files[0].layers.some((L) => L.name === 'TOP_NECK_POCKET_0.6250IN_DEEP'));
  assert.ok(inch.files[0].layers.some((L) => L.name === 'THROUGH_NECK_SCREW_0.1875IN_HOLE'));
  assert.match(cncDXF(inch.files[0], 'in'), /\$INSUNITS\r\n70\r\n1\r\n/);
  assert.match(cncDXF(inch.files[0], 'in'), /\$MEASUREMENT\r\n70\r\n0\r\n/);
  assert.match(cncReadme(d, inch, ['t.dxf', 'b.dxf']), /true size, in inches/);
});

test('a hole depth entered for the hardware names the layer; without one the layer says depth to suit', () => {
  const d = defaultDesign();
  assert.ok(make(d).v.files[0].layers.some((L) => L.name === 'TOP_BRIDGE_SCREW_3.18MM_HOLE_DEPTH_TO_SUIT'));
  d.bridge.depths = { mount: 12, ferrule: 9.5 };
  const { v } = make(d);
  assert.ok(v.files[0].layers.some((L) => L.name === 'TOP_BRIDGE_SCREW_3.18MM_HOLE_12.00MM_DEEP' && L.depth === 12));
  assert.ok(v.files[1].layers.some((L) => L.name === 'BACK_STRING_FERRULE_7.94MM_HOLE_9.50MM_DEEP'));
  assert.ok(!v.files.some((f) => f.layers.some((L) => /DEPTH_TO_SUIT/.test(L.name))));
});

test('the binding channel\'s inner edge is the outline moved in by the channel width, on a layer with both sizes', () => {
  const d = defaultDesign(); d.body.binding = { on: true, width: 2, depth: 7 };
  const { g, v } = make(d);
  const inner = on(v.files[0], /^TOP_BINDING_CHANNEL_INNER_EDGE_2\.00MM_WIDE_7\.00MM_DEEP$/);
  assert.equal(inner.length, 1);
  const b = box(inner[0]);
  assert.ok(Math.abs(b.x0 - (g.bbox.x0 + 2)) < 0.02 && Math.abs(b.x1 - (g.bbox.x1 - 2)) < 0.02 && Math.abs(b.y0 - (g.bbox.y0 + 2)) < 0.02);
  assert.equal(on(v.files[1], /BINDING/).length, 0, 'the channel is cut from the top only');
});
