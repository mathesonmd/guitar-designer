import test from 'node:test';
import assert from 'node:assert/strict';
import { cubicAt, flattenCubic } from '../src/core/bezier.js';
import { signedArea, roundRect, stadium, circlePoly, distToPoly, centroid, minDistPolys, filletPoly, bbox } from '../src/core/poly.js';
import { offset, opening, closing, regionArea, union, difference, largestOuter } from '../src/core/clip.js';
import { fitArcs, expandArcs } from '../src/core/arcfit.js';
import { fitClosed } from '../src/core/fit.js';
import { flattenNodes, expandOutline, outlinePolygon, insertNode, setSymmetric, node } from '../src/core/path.js';
import { parseLen, fmtLen, fractionLabel } from '../src/core/units.js';
import { textStrokes, textWidth } from '../src/core/text.js';
import { fretDistance, fretAt } from '../src/core/fret.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

// largest distance from points of polyline A to polyline B
const maxDev = (A, B) => A.reduce((m, p) => Math.max(m, distToPoly(p, B, true).d), 0);

test('flattening a cubic stays within tolerance', () => {
  const k = 0.5522847498 * 50;
  const p = [{ x: 50, y: 0 }, { x: 50, y: k }, { x: k, y: 50 }, { x: 0, y: 50 }];
  for (const tol of [0.1, 0.01, 0.002]) {
    const pts = [p[0]];
    flattenCubic(p[0], p[1], p[2], p[3], tol, pts);
    let worst = 0;
    for (let i = 0; i <= 2000; i++) {
      const q = cubicAt(p[0], p[1], p[2], p[3], i / 2000);
      worst = Math.max(worst, distToPoly(q, pts, false).d);
    }
    assert.ok(worst <= tol * 1.001, `tol ${tol}: worst ${worst}`);
  }
});

test('offsetting matches closed-form areas', () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const out = offset(sq, 5);
  near(regionArea(out), 100 * 60 + 2 * 5 * (100 + 60) + Math.PI * 25, 0.15, 'outward square');
  const circ = circlePoly(0, 0, 50, 0.001);
  near(regionArea(offset(circ, -10)), Math.PI * 40 * 40, 0.5, 'inward circle');
  near(regionArea(offset(circ, 6.35)), Math.PI * 56.35 ** 2, 0.6, 'outward circle');
});

test('every point of an offset curve sits at the offset distance', () => {
  const body = roundRect(320, 400, 60, 0.002);
  for (const d of [3.175, 7.9375, -4.7625]) {
    const off = largestOuter(offset(body, d, 0.002));
    let worst = 0;
    for (const p of off) worst = Math.max(worst, Math.abs(distToPoly(p, body, true).d - Math.abs(d)));
    assert.ok(worst < 0.006, `offset ${d}: worst error ${worst} mm`);
  }
});

test('opening rounds outside corners only; closing rounds inside corners only', () => {
  const sq = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }];
  const r = 6;
  near(regionArea(opening(sq, r)), 6400 - (4 - Math.PI) * r * r, 0.2, 'opening');
  near(regionArea(closing(sq, r)), 6400, 0.01, 'closing of a convex shape changes nothing');
  // an L shape has one inside corner: closing fills it by (1 - pi/4) r^2
  const L = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 80 }, { x: 0, y: 80 }];
  near(regionArea(closing(L, r)) - regionArea(union([L])), (1 - Math.PI / 4) * r * r, 0.1, 'closing L');
});

test('boolean difference and union areas', () => {
  const a = roundRect(100, 50, 0), b = circlePoly(0, 0, 10, 0.001);
  near(regionArea(difference([a], [b])), 5000 - Math.PI * 100, 0.1);
  const d = difference([a], [b]);
  assert.equal(d.length, 1);
  assert.equal(d[0].holes.length, 1);
});

test('arc fitting is compact and within tolerance', () => {
  const shapes = {
    stadium: stadium(85, 20, 0.001),
    roundRect: roundRect(72, 42, 3.8, 0.001),
    offsetBody: largestOuter(offset(roundRect(320, 400, 60, 0.002), 7.9375, 0.002)),
  };
  for (const [name, pts] of Object.entries(shapes)) {
    const tol = 0.01;
    const verts = fitArcs(pts, tol, true);
    assert.ok(verts.length <= 12, `${name}: ${verts.length} segments`);
    const dense = expandArcs(verts, true, 0.001);
    const dev = Math.max(maxDev(dense, pts), maxDev(pts, dense));
    assert.ok(dev <= tol * 1.2, `${name}: deviation ${dev}`);
    near(Math.abs(signedArea(dense)), Math.abs(signedArea(pts)), tol * 1500, name + ' area');
  }
});

test('arc fitting a free-form curve stays within tolerance', () => {
  const pts = [];
  for (let i = 0; i < 1500; i++) {
    const a = (i / 1500) * Math.PI * 2;
    const r = 150 + 25 * Math.cos(2 * a) + 12 * Math.sin(3 * a);
    pts.push({ x: r * Math.cos(a), y: 1.2 * r * Math.sin(a) });
  }
  const verts = fitArcs(pts, 0.02, true);
  assert.ok(verts.length < 200, `segments ${verts.length}`);
  const dense = expandArcs(verts, true, 0.002);
  assert.ok(maxDev(dense, pts) <= 0.03 && maxDev(pts, dense) <= 0.03);
});

test('curve fitting turns a dense outline into a few editable nodes', () => {
  const pts = [];
  for (let i = 0; i < 800; i++) {
    const a = (i / 800) * Math.PI * 2;
    pts.push({ x: 160 * Math.cos(a), y: 210 * Math.sin(a) });
  }
  const nodes = fitClosed(pts, 0.05);
  assert.ok(nodes.length >= 4 && nodes.length <= 16, `nodes ${nodes.length}`);
  const fitted = flattenNodes(nodes, true, 0.005);
  assert.ok(maxDev(pts, fitted) < 0.12, `dev ${maxDev(pts, fitted)}`);
  // a shape with real corners keeps them as corner nodes
  const rr = filletPoly([{ x: -60, y: -40 }, { x: 60, y: -40 }, { x: 60, y: 40 }, { x: -60, y: 40 }], 0);
  const dense = [];
  for (let i = 0; i < 4; i++) {
    const a = rr[i], b = rr[(i + 1) % 4];
    for (let j = 0; j < 100; j++) dense.push({ x: a.x + ((b.x - a.x) * j) / 100, y: a.y + ((b.y - a.y) * j) / 100 });
  }
  const sq = fitClosed(dense, 0.05);
  assert.equal(sq.filter((n) => n.k === 'c').length, 4);
  near(Math.abs(signedArea(flattenNodes(sq, true, 0.01))), 120 * 80, 1);
});

test('symmetric outlines mirror exactly and inserting a node keeps the shape', () => {
  const half = [
    node(0, 200, 0, 0, -60, 0), node(-160, 60, 0, 70, 0, -70), node(-110, -60, 20, 40, -20, -40),
    node(-170, -160, 0, 50, 0, -40), node(0, -210, -70, 0, 0, 0),
  ];
  const outline = { symmetric: true, nodes: half };
  const poly = outlinePolygon(outline, 0.01);
  assert.ok(signedArea(poly) > 0);
  near(centroid(poly).x, 0, 1e-6, 'centroid on centerline');
  const b = bbox(poly);
  near(b.x0, -b.x1, 1e-6);
  const full = expandOutline(outline);
  assert.equal(full.length, 8);
  const ins = insertNode(full, 2, 0.4);
  near(signedArea(flattenNodes(ins.nodes, true, 0.002)), signedArea(flattenNodes(full, true, 0.002)), 0.5);
  // free -> symmetric -> free keeps the left half
  const free = setSymmetric(outline, false);
  const again = setSymmetric(free, true);
  assert.equal(again.symmetric, true);
  near(Math.abs(signedArea(outlinePolygon(again, 0.01))), Math.abs(signedArea(poly)), 2);
});

test('minimum distance between shapes', () => {
  const a = roundRect(40, 20, 0), b = roundRect(40, 20, 0).map((p) => ({ x: p.x + 50, y: p.y + 3 }));
  near(minDistPolys(a, b).d, 10, 1e-9);
});

test('length parsing and formatting', () => {
  near(parseLen('2-3/16', 'in'), 55.5625, 1e-9);
  near(parseLen('2 3/16"', 'mm'), 55.5625, 1e-9);
  near(parseLen('5/8', 'in'), 15.875, 1e-9);
  near(parseLen('25.5', 'in'), 647.7, 1e-9);
  near(parseLen('56', 'mm'), 56, 1e-9);
  near(parseLen('56mm', 'in'), 56, 1e-9);
  near(parseLen('-0.25', 'in'), -6.35, 1e-9);
  assert.ok(Number.isNaN(parseLen('abc', 'in')));
  assert.equal(fmtLen(55.5625, 'in'), '2.188');
  assert.equal(fmtLen(55.5625, 'mm'), '55.56');
  assert.equal(fractionLabel(2.1875), '2-3/16');
  assert.equal(fractionLabel(0.625), '5/8');
  assert.equal(fractionLabel(3), '3');
  assert.equal(fractionLabel(2.2), null);
});

test('stroke lettering produces geometry of the requested size', () => {
  const s = textStrokes('BLACK CHAPEL TEMPLATE', 10, 20, 6);
  assert.ok(s.length > 20);
  const ys = s.flat().map((p) => p.y);
  near(Math.max(...ys) - 20, 6, 0.8);
  assert.ok(textWidth('ABC', 6) > 10);
  const c = textStrokes('A', 0, 0, 6, 0, 'center').flat();
  near((Math.min(...c.map((p) => p.x)) + Math.max(...c.map((p) => p.x))) / 2, 0, 0.6);
});

test('fret positions', () => {
  near(fretDistance(647.7, 12), 323.85, 1e-9);
  near(fretDistance(25.5, 1), 1.4312, 1e-4);
  near(fretAt(647.7, fretDistance(647.7, 17)), 17, 1e-9);
});
