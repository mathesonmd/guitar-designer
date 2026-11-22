// The neck pocket in the CAD solid. The pocket's sides are the fretboard's edges, and bodies are drawn to
// them: a corner of the body sits on the pocket's side, or the body's own edge runs along it. Those are the
// cuts the 3D engine gets wrong without saying so, so each case that went wrong while this was built is
// held here against the sliced solid. (Its own file: after dozens of builds in one process the engine
// starts failing on shapes it normally builds.) Run with: node --test test/pocket.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as rc from 'replicad';
import start from 'replicad-opencascadejs';
import { defaultDesign, seatOnPocket, STARTERS, makeBridge } from '../src/model/design.js';
import { derive } from '../src/model/derive.js';
import { buildLayers } from '../src/model/solid.js';
import { buildBodySolid, toSTL } from '../src/export/step.js';

let oc;
before(async () => { oc = await start(); rc.setOC(oc); });
const build = (d, opts = {}) => { const g = derive(d, { tol: 0.005 }), slices = buildLayers(d, g); return { g, slices, cad: buildBodySolid(rc, oc, d, g, { expectVolume: slices.volume, ...opts }) }; };
const pct = (a, b) => Math.abs(a / b - 1) * 100;
// facet edges of the STL that have no partner: 0 for a closed mesh
const gaps = (shape) => {
  const { data, triangles } = toSTL(shape), view = new DataView(data.buffer), edges = new Map();
  for (let i = 0; i < triangles; i++) {
    const o = 84 + i * 50, P = [0, 1, 2].map((k) => [0, 4, 8].map((j) => view.getFloat32(o + 12 + k * 12 + j, true)));
    for (const [p, q] of [[P[0], P[1]], [P[1], P[2]], [P[2], P[0]]]) {
      const k = p.join(',') + '>' + q.join(','), back = q.join(',') + '>' + p.join(',');
      if (edges.get(back) > 0) { if (edges.get(back) === 1) edges.delete(back); else edges.set(back, edges.get(back) - 1); } else edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  return edges.size;
};

test('the starting body: pocket cut, a closed mesh, and the straight edge at the pocket left square and said so', () => {
  const { cad, slices } = build(defaultDesign());
  assert.equal(cad.valid, true);
  assert.ok(pct(cad.volume, slices.volume) < 0.1, `volume differs by ${pct(cad.volume, slices.volume).toFixed(3)}%`);
  assert.equal(cad.squareEdges, true, 'the edge between the two corners at the pocket is not rolled, and the result says so');
  assert.equal(gaps(cad.shape), 0, 'no hole in the STL (a roundover rolled along that edge once left one behind the heel)');
  // with square edges asked for there is nothing to report
  assert.equal(build(defaultDesign(), { roundovers: false }).cad.squareEdges, undefined);
});

test('a corner of the body dragged up or down the pocket’s edge still gives a sound solid of the right size', () => {
  for (const y of [253.5, 256.3, 258.5, 262]) {
    const d = defaultDesign(), n = d.outline.nodes;
    n[n.length - 1] = { ...n[n.length - 1], y };
    d.outline = seatOnPocket(d.outline, d.neck);
    const { cad, slices } = build(d);
    assert.equal(cad.valid, true, `corner at ${y}`);
    assert.ok(pct(cad.volume, slices.volume) < 0.1, `corner at ${y}: volume differs by ${pct(cad.volume, slices.volume).toFixed(3)}%`);
  }
});

test('T-style: the body’s edge runs along the fretboard’s edge, and the pocket is still cut', () => {
  // (with the pocket's wall lying on the body's edge the engine handed back a body with no pocket at all)
  for (const r of [1, 3.175]) {
    const d = defaultDesign(); d.outline = JSON.parse(JSON.stringify(STARTERS.tstyle.outline)); d.body.roundTop = r; d.body.roundBack = r;
    const g = derive(d, { tol: 0.005 }), slices = buildLayers(d, g);
    const cad = buildBodySolid(rc, oc, d, g); // unchecked: it must be right, not rescued
    assert.ok(pct(cad.volume, slices.volume) < 0.1, `roundover ${r}: volume differs by ${pct(cad.volume, slices.volume).toFixed(3)}%`);
    const without = buildBodySolid(rc, oc, d, g, { pockets: false });
    assert.ok(without.volume - cad.volume > 60000, 'the pocket and cavities are a real amount of wood');
  }
});

test('a 2 mm binding channel on the starting shape is cut (the engine once skipped it whole, at that width only)', () => {
  const d = defaultDesign(); d.body.roundTopOn = false; d.pickups = []; d.cavities = []; d.controls = []; d.bridge = makeBridge('none');
  const g0 = derive(d, { tol: 0.005 }), before = buildBodySolid(rc, oc, d, g0);
  d.body.binding = { on: true, width: 2, depth: 7 };
  const g = derive(d, { tol: 0.005 }), slices = buildLayers(d, g), cad = buildBodySolid(rc, oc, d, g);
  assert.ok(pct(cad.volume, slices.volume) < 0.1, `volume differs by ${pct(cad.volume, slices.volume).toFixed(3)}%`);
  assert.ok(before.volume - cad.volume > 15000, 'the channel is a real amount of wood');
});
