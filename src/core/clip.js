// Robust polygon offsetting and boolean operations (wraps the Clipper library).
// A "region" is an array of { outer: pts[], holes: pts[][] } with outer counter-clockwise.
import ClipperLib from 'clipper-lib';
import { signedArea } from './poly.js';

export const SCALE = 10000; // integer grid = 0.1 micron
const CT = ClipperLib.ClipType, PT = ClipperLib.PolyType, FT = ClipperLib.PolyFillType;

const toPath = (pts, wantCCW) => {
  const ccw = signedArea(pts) >= 0;
  const src = wantCCW === undefined || ccw === wantCCW ? pts : pts.slice().reverse();
  const out = new Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = { X: Math.round(src[i].x * SCALE), Y: Math.round(src[i].y * SCALE) };
  return out;
};
const fromPath = (path) => path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));

// Accepts a region, a list of simple polygons, or a single polygon; returns Clipper paths.
function asPaths(x) {
  const out = [];
  if (!x || !x.length) return out;
  if (x[0] && typeof x[0].x === 'number') { out.push(toPath(x, true)); return out; }
  for (const e of x) {
    if (e && e.outer) {
      if (e.outer.length >= 3) out.push(toPath(e.outer, true));
      for (const h of e.holes || []) if (h.length >= 3) out.push(toPath(h, false));
    } else if (e && e.length >= 3) out.push(toPath(e, true));
  }
  return out;
}

function treeToRegion(tree) {
  const ex = ClipperLib.JS.PolyTreeToExPolygons(tree);
  return ex.map((e) => ({ outer: fromPath(e.outer), holes: (e.holes || []).map(fromPath) }))
    .filter((e) => e.outer.length >= 3);
}

function run(type, subj, clip) {
  const c = new ClipperLib.Clipper();
  const s = asPaths(subj), k = asPaths(clip);
  if (s.length) c.AddPaths(s, PT.ptSubject, true);
  if (k.length) c.AddPaths(k, PT.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(type, tree, FT.pftNonZero, FT.pftNonZero);
  return treeToRegion(tree);
}

export const union = (a, b) => run(CT.ctUnion, a, b || []);
export const difference = (a, b) => run(CT.ctDifference, a, b);
export const intersect = (a, b) => run(CT.ctIntersection, a, b);
export const toRegion = (polys) => union(polys, []);

// Offset outward (delta > 0) or inward (delta < 0) with round joins.
// arcTol = maximum chord error of the generated round joins, in mm.
export function offset(x, delta, arcTol = 0.005) {
  const paths = asPaths(x);
  if (!paths.length) return [];
  if (Math.abs(delta) < 1e-9) return union(x, []);
  const co = new ClipperLib.ClipperOffset(2, arcTol * SCALE);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, delta * SCALE);
  return treeToRegion(tree);
}

// Morphological opening: removes everything a disk of radius r cannot fit into (what a cutter of
// that radius can reach from inside). Closing is the same idea from the outside.
export const opening = (x, r, arcTol) => (r > 0 ? offset(offset(x, -r, arcTol), r, arcTol) : union(x, []));
export const closing = (x, r, arcTol) => (r > 0 ? offset(offset(x, r, arcTol), -r, arcTol) : union(x, []));

export function regionArea(region) {
  let a = 0;
  for (const e of region) {
    a += Math.abs(signedArea(e.outer));
    for (const h of e.holes) a -= Math.abs(signedArea(h));
  }
  return a;
}

// Area-weighted centroid and area of a region.
export function regionCentroid(region) {
  let A = 0, cx = 0, cy = 0;
  const acc = (p, sign) => {
    let a = 0, x = 0, y = 0;
    for (let i = 0, n = p.length; i < n; i++) {
      const q = p[(i + 1) % n];
      const k = p[i].x * q.y - q.x * p[i].y;
      a += k; x += (p[i].x + q.x) * k; y += (p[i].y + q.y) * k;
    }
    const s = sign * Math.sign(a || 1);
    A += (s * a) / 2; cx += (s * x) / 6; cy += (s * y) / 6;
  };
  for (const e of region) {
    acc(e.outer, 1);
    for (const h of e.holes) acc(h, -1);
  }
  return A > 1e-12 ? { x: cx / A, y: cy / A, area: A } : { x: 0, y: 0, area: 0 };
}

// All boundary loops of a region as plain polygons (outer loops first within each island).
export const loops = (region) => region.flatMap((e) => [e.outer, ...e.holes]);

// The single largest outer loop (handy when an operation is expected to produce one shape).
export function largestOuter(region) {
  let best = null, ba = -1;
  for (const e of region) {
    const a = Math.abs(signedArea(e.outer));
    if (a > ba) { ba = a; best = e.outer; }
  }
  return best;
}
