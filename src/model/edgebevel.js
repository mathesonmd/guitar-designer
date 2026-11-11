// The bevel around the top edge. It runs from an inner line drawn on the top down to the body edge.
//
// The inner line is the outline moved in, point by point: every point of the outline has a width (how
// far in the inner line sits there) and a depth (how far down the bevel has dropped when it reaches the
// body edge there). Either can be its own value or the bevel's general one, and a width of 0 makes the
// bevel taper to nothing at that point. Between points both run smoothly from one value to the next.
//
// The surface is defined once, here, and both solids are built from this definition:
//   - "Sections" are closed curves that pair up point for point. Section 0 is the inner line, at the top.
//     The last section lies a little outside the body, so the cut always passes cleanly through the
//     body edge. The body edge itself is a fraction of the way along, different at every point.
//   - Straight lines join each point of one section to the matching point of the next.
//   - A flat bevel needs only the two end sections. A rolled bevel has ROLL_STRIPS strips between them,
//     their heights taken from a curve that leaves the top level and steepens toward the edge; the strips
//     stay within a few hundredths of a millimeter of that curve.
import { expandOutline, insetNodes, inwardNormals, insertNode, segmentsOf } from '../core/path.js';
import { cubicAt } from '../core/bezier.js';
import { EdgeIndex } from '../core/edgeindex.js';
import { pointInPoly, signedArea } from '../core/poly.js';
import { toRegion } from '../core/clip.js';
import { edgeBevel } from './design.js';

export const ROLL_STRIPS = 8;
const PAST_EDGE = 4;    // how far outside the body the last section lies
const STEEPEST = 3;     // the depth at a point is held to this many times its width there

// Depth of the bevel, as a fraction of its depth at the body edge, at fraction u of the way from the
// inner line (0) to the body edge (1), carrying on in a straight line past the edge.
// roll 0 = a straight slope; roll 1 = a curve that leaves the top level and is twice as steep at the edge.
export function bevelShape(u, roll) {
  if (u <= 0) return 0;
  if (u <= 1) return (1 - roll) * u + roll * u * u;
  return 1 + (1 + roll) * (u - 1);
}

// Returns null when the bevel is off. `outline` is the body outline as a polygon (for measuring room);
// `tol` is how closely that polygon follows the true curve.
export function buildEdgeBevel(design, outline, tol = 0.02) {
  const eb = edgeBevel(design);
  if (!eb) return null;
  const T = design.body.thickness;
  // The outline with extra points added along each long segment (the curve itself is unchanged), so the
  // inner line follows it closely. `from` remembers which of the outline's own points each one is.
  const own = expandOutline(design.outline);
  const ownWidth = own.map((p) => Math.max(0, p.bw !== undefined ? p.bw : eb.width));
  const ownDepth = own.map((p) => Math.max(0, Math.min(p.bd !== undefined ? p.bd : eb.drop, T - 3)));
  // Between the outline's own points the width and depth run in a smooth curve that never overshoots:
  // level at a high or low point, so a width of 0 is touched gently and nothing goes below it.
  const m0 = own.length;
  const gap = own.map((p, i) => { const q = own[(i + 1) % m0]; return Math.max(1e-6, Math.hypot(q.x - p.x, q.y - p.y)); });
  const blend = (v) => {
    const d = v.map((_, i) => (v[(i + 1) % m0] - v[i]) / gap[i]); // rise per millimeter over each segment
    const slope = v.map((_, i) => { const a = d[(i - 1 + m0) % m0], b = d[i]; return a * b <= 0 ? 0 : (2 * a * b) / (a + b); });
    return (i, f) => {
      const j = (i + 1) % m0, h = gap[i], f2 = f * f, f3 = f2 * f;
      return (2 * f3 - 3 * f2 + 1) * v[i] + (f3 - 2 * f2 + f) * h * slope[i] + (-2 * f3 + 3 * f2) * v[j] + (f3 - f2) * h * slope[j];
    };
  };
  const widthAt = blend(ownWidth), depthAt = blend(ownDepth);
  let outer = own.map((p, i) => ({ ...p, from: i, want: ownWidth[i], deep: ownDepth[i] }));
  for (let i = own.length - 1; i >= 0; i--) {
    const K = Math.max(1, Math.min(9, Math.ceil(gap[i] / 14)));
    for (let j = 1; j < K; j++) {
      // each cut takes the first 1/(K-j+1) of what is left of the segment, which starts at index i + j - 1
      const r = insertNode(outer, i + j - 1, 1 / (K - j + 1), true);
      outer = r.nodes;
      outer[r.index] = { ...outer[r.index], from: -1, want: Math.max(0, widthAt(i, j / K)), deep: Math.max(0, depthAt(i, j / K)) };
    }
  }
  const n = outer.length, normals = inwardNormals(outer), edges = new EdgeIndex(outline, 12);
  // A point's width is what was asked for, but never more than the body has room for there: the inner
  // point must stay well clear of every other part of the outline, so the inner line cannot cross over
  // at a horn, a waist or a corner.
  const room = outer.map((p, i) => {
    // a circle of radius r lying inside the body and touching the outline at this point (at a corner, touching its two sides)
    // (`slack` allows for the outline here being a many-sided polygon, not the true curve)
    const nm = normals[i], slack = Math.max(0.3, 4 * tol);
    const clear = (r) => edges.nearest(p.x + nm.x * r, p.y + nm.y * r).d >= 0.97 * nm.open * r - slack && pointInPoly({ x: p.x + nm.x * r, y: p.y + nm.y * r }, outline);
    if (!clear(1)) return 0;
    let lo = 1, hi = 1;
    while (hi < 400 && clear(hi * 2)) hi *= 2;
    hi *= 2;
    for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (clear(mid)) lo = mid; else hi = mid; }
    return lo;
  });
  const asked = outer.map((p) => p.want);
  const widths = asked.map((w, i) => Math.min(w, 0.8 * room[i]));
  // If a stretch of the inner line still runs backward (a curve tighter than the bevel is wide), pull the
  // points at its ends in until it runs forward again.
  for (let pass = 0; pass < 14; pass++) {
    const trial = insetNodes(outer, widths);
    let fixed = false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ox = outer[j].x - outer[i].x, oy = outer[j].y - outer[i].y, ix = trial[j].x - trial[i].x, iy = trial[j].y - trial[i].y;
      if (ox * ix + oy * iy < 0.15 * (ox * ox + oy * oy)) { widths[i] *= 0.8; widths[j] *= 0.8; fixed = true; }
    }
    if (!fixed) break;
  }
  // a bevel may not be steeper than STEEPEST to 1, so where it narrows to nothing its depth goes to nothing too
  const askedDepth = outer.map((p) => p.deep);
  const depths = askedDepth.map((d, i) => Math.min(d, STEEPEST * widths[i]));
  const roll = eb.roll;

  const inner = insetNodes(outer, widths);
  const beyond = insetNodes(outer, outer.map(() => -PAST_EDGE)); // the last section, outside the body
  // sections: fraction lam of the way from the inner line (0) to the last section (1)
  const strips = roll > 1e-6 ? ROLL_STRIPS : 1;
  const lams = Array.from({ length: strips + 1 }, (_, k) => k / strips);
  // height of the surface above the back, at outline point i, a fraction lam of the way out
  const heightAt = (i, lam) => {
    const w = widths[i];
    if (!(w > 1e-6) || !(depths[i] > 1e-9)) return T; // no bevel here: the surface stays at the top
    return T - depths[i] * bevelShape((lam * (w + PAST_EDGE)) / w, roll);
  };
  const height = lams.map((lam) => outer.map((_, i) => heightAt(i, lam))); // height[k][i]
  // each section as a chain of nodes (x, y and handles), and its height at each node
  const mix = (k) => inner.map((p, i) => {
    const q = beyond[i], f = lams[k];
    return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, ix: p.ix + (q.ix - p.ix) * f, iy: p.iy + (q.iy - p.iy) * f, ox: p.ox + (q.ox - p.ox) * f, oy: p.oy + (q.oy - p.oy) * f, k: p.k };
  });
  const sections = lams.map((_, k) => ({ nodes: k === 0 ? inner : k === strips ? beyond : mix(k), z: height[k] }));

  // Sample points along every segment, the same for every section: [{ a: inner xy, b: last-section xy, z: [height at each section] }]
  const si = segmentsOf(inner, true), sb = segmentsOf(beyond, true), so = segmentsOf(outer, true);
  const samples = [];
  so.forEach((seg, i) => {
    const j = (i + 1) % n, N = Math.max(6, Math.min(60, Math.ceil(Math.hypot(seg.p3.x - seg.p0.x, seg.p3.y - seg.p0.y) / 2.5)));
    for (let m = 0; m < N; m++) {
      const t = m / N;
      samples.push({ a: cubicAt(si[i].p0, si[i].p1, si[i].p2, si[i].p3, t), b: cubicAt(sb[i].p0, sb[i].p1, sb[i].p2, sb[i].p3, t), z: height.map((h) => h[i] + (h[j] - h[i]) * t) });
    }
  });
  // The outline of the bevelled body at height z: for each sample, where the surface is at that height.
  // Where the bevel never gets that low the point lands outside the body, which leaves the body whole there.
  const shapeAt = (z) => samples.map((s) => {
    let lam = 1;
    if (z >= s.z[0]) lam = 0;
    else for (let k = 0; k < strips; k++) {
      if (z >= s.z[k + 1]) { lam = lams[k] + ((s.z[k] - z) / (s.z[k] - s.z[k + 1])) * (lams[k + 1] - lams[k]); break; }
    }
    return { x: s.a.x + (s.b.x - s.a.x) * lam, y: s.a.y + (s.b.y - s.a.y) * lam };
  });
  const innerPoly = samples.map((s) => ({ x: s.a.x, y: s.a.y }));
  // an inner line that still crosses itself (between points, on a tight curve) cannot be cut
  const crosses = Math.abs(toRegion([innerPoly]).reduce((sum, e) => sum + Math.abs(signedArea(e.outer)) - e.holes.reduce((h, q) => h + Math.abs(signedArea(q)), 0), 0) - Math.abs(signedArea(innerPoly))) > 2;
  // where the outline's own points sit on the inner line, for the drag diamonds
  const handles = outer.map((p, j) => ({ i: p.from, outer: { x: p.x, y: p.y }, inner: { x: inner[j].x, y: inner[j].y }, normal: normals[j], width: widths[j], asked: asked[j], depth: depths[j], askedDepth: askedDepth[j] })).filter((h) => h.i >= 0);
  const deepest = Math.max(0, ...depths);
  return {
    width: eb.width, drop: eb.drop, roll, strips, outer, inner, sections, widths, depths, asked, askedDepth,
    shapeAt, innerPoly, crosses, handles, deepest,
    lowest: Math.min(T, ...height[strips]), // the lowest the surface gets, out at the last section
  };
}
