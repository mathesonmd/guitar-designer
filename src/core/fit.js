// Fit cubic Bezier curves to a dense polyline (Schneider, "An Algorithm for Automatically Fitting
// Digitized Curves", Graphics Gems I). Used to turn imported or traced outlines into editable nodes.
import { add, sub, mul, dot, norm, dist } from './vec.js';
import { cubicAt } from './bezier.js';
import { nodesFromSegments } from './path.js';
import { dedupe } from './poly.js';

const B0 = (u) => (1 - u) ** 3, B1 = (u) => 3 * u * (1 - u) ** 2, B2 = (u) => 3 * u * u * (1 - u), B3 = (u) => u ** 3;

function chordParams(pts) {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + dist(pts[i], pts[i - 1]));
  const L = u[u.length - 1] || 1;
  return u.map((v) => v / L);
}

function generateBezier(pts, u, t1, t2) {
  const first = pts[0], last = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const a0 = mul(t1, B1(u[i])), a1 = mul(t2, B2(u[i]));
    c00 += dot(a0, a0); c01 += dot(a0, a1); c11 += dot(a1, a1);
    const tmp = sub(pts[i], add(mul(first, B0(u[i]) + B1(u[i])), mul(last, B2(u[i]) + B3(u[i]))));
    x0 += dot(a0, tmp); x1 += dot(a1, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = 0, ar = 0;
  if (Math.abs(det) > 1e-12) { al = (x0 * c11 - x1 * c01) / det; ar = (c00 * x1 - c01 * x0) / det; }
  const segLen = dist(first, last), eps = 1e-6 * segLen;
  if (al < eps || ar < eps || !isFinite(al) || !isFinite(ar)) al = ar = segLen / 3;
  return [first, add(first, mul(t1, al)), add(last, mul(t2, ar)), last];
}

function maxError(pts, bez, u) {
  let md = 0, split = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = cubicAt(bez[0], bez[1], bez[2], bez[3], u[i]);
    const d = (p.x - pts[i].x) ** 2 + (p.y - pts[i].y) ** 2;
    if (d >= md) { md = d; split = i; }
  }
  return [Math.sqrt(md), split];
}

function reparam(pts, u, bez) {
  const d1 = [mul(sub(bez[1], bez[0]), 3), mul(sub(bez[2], bez[1]), 3), mul(sub(bez[3], bez[2]), 3)];
  const d2 = [mul(sub(d1[1], d1[0]), 2), mul(sub(d1[2], d1[1]), 2)];
  const q1 = (t) => { const s = 1 - t; return add(add(mul(d1[0], s * s), mul(d1[1], 2 * s * t)), mul(d1[2], t * t)); };
  const q2 = (t) => add(mul(d2[0], 1 - t), mul(d2[1], t));
  return u.map((t, i) => {
    const q = cubicAt(bez[0], bez[1], bez[2], bez[3], t), a = q1(t), b = q2(t);
    const num = (q.x - pts[i].x) * a.x + (q.y - pts[i].y) * a.y;
    const den = a.x * a.x + a.y * a.y + (q.x - pts[i].x) * b.x + (q.y - pts[i].y) * b.y;
    return Math.abs(den) < 1e-12 ? t : Math.min(1, Math.max(0, t - num / den));
  });
}

function fitCubic(pts, t1, t2, err, out, depth = 0) {
  if (pts.length === 2) {
    const d = dist(pts[0], pts[1]) / 3;
    out.push([pts[0], add(pts[0], mul(t1, d)), add(pts[1], mul(t2, d)), pts[1]]);
    return;
  }
  let u = chordParams(pts);
  let bez = generateBezier(pts, u, t1, t2);
  let [e, split] = maxError(pts, bez, u);
  if (e < err) { out.push(bez); return; }
  if (e < err * 6) {
    for (let i = 0; i < 6; i++) {
      u = reparam(pts, u, bez);
      bez = generateBezier(pts, u, t1, t2);
      [e, split] = maxError(pts, bez, u);
      if (e < err) { out.push(bez); return; }
    }
  }
  if (depth > 24) { out.push(bez); return; }
  split = Math.max(1, Math.min(pts.length - 2, split));
  const tc = norm(sub(pts[split - 1], pts[split + 1]));
  fitCubic(pts.slice(0, split + 1), t1, tc, err, out, depth + 1);
  fitCubic(pts.slice(split), mul(tc, -1), t2, err, out, depth + 1);
}

// Fit an open run of points. Returns [[p0,p1,p2,p3], ...].
export function fitOpen(pts, err, tStart, tEnd) {
  pts = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-7);
  if (pts.length < 2) return [];
  const t1 = tStart || norm(sub(pts[1], pts[0]));
  const t2 = tEnd || norm(sub(pts[pts.length - 2], pts[pts.length - 1]));
  const out = [];
  fitCubic(pts, t1, t2, err, out);
  return out;
}

// Indices of sharp corners in a closed polyline: the heading changes by more than `minAngle`
// within a short window (window is an arc length in mm).
export function findCorners(pts, window = 1.5, minAngle = 0.6) {
  const n = pts.length, corners = [];
  const along = (i, dir) => {
    let acc = 0, j = i;
    for (let s = 0; s < n; s++) {
      const k = (j + dir + n) % n;
      acc += dist(pts[j], pts[k]);
      j = k;
      if (acc >= window) break;
    }
    return j;
  };
  const ang = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = pts[along(i, -1)], b = pts[i], c = pts[along(i, 1)];
    const v1 = norm(sub(b, a)), v2 = norm(sub(c, b));
    ang[i] = Math.acos(Math.max(-1, Math.min(1, dot(v1, v2))));
  }
  for (let i = 0; i < n; i++) {
    if (ang[i] < minAngle) continue;
    // local maximum within the window
    let isMax = true;
    for (let s = 1; s < n; s++) {
      const j = (i + s) % n, k = (i - s + n) % n;
      if (dist(pts[i], pts[j]) > window && dist(pts[i], pts[k]) > window) break;
      if (ang[j] > ang[i] || (ang[k] >= ang[i] && k !== i && ang[k] > ang[i])) { isMax = false; break; }
    }
    if (isMax && (!corners.length || dist(pts[corners[corners.length - 1]], pts[i]) > window)) corners.push(i);
  }
  return corners;
}

// Fit a closed polyline. Returns editable nodes (see path.js).
export function fitClosed(points, err = 0.05) {
  const pts = dedupe(points);
  const n = pts.length;
  if (n < 4) return [];
  const corners = findCorners(pts);
  const segs = [], cornerAtSegStart = [];
  if (corners.length === 0) {
    // smooth all the way round: start at the top-most point and keep the tangent continuous across the seam
    let s = 0;
    for (let i = 1; i < n; i++) if (pts[i].y > pts[s].y) s = i;
    const run = [];
    for (let i = 0; i <= n; i++) run.push(pts[(s + i) % n]);
    const t = norm(sub(pts[(s + 1) % n], pts[(s - 1 + n) % n]));
    const part = fitOpen(run, err, t, mul(t, -1));
    for (const b of part) { segs.push(b); cornerAtSegStart.push(false); }
  } else {
    for (let c = 0; c < corners.length; c++) {
      const a = corners[c], b = corners[(c + 1) % corners.length];
      const run = [];
      for (let i = a; ; i = (i + 1) % n) { run.push(pts[i]); if (i === b && run.length > 1) break; }
      const part = fitOpen(run, err);
      part.forEach((bz, k) => { segs.push(bz); cornerAtSegStart.push(k === 0); });
    }
  }
  return nodesFromSegments(segs, cornerAtSegStart);
}
