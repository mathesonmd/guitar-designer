// Polygon / polyline helpers. A polygon is an array of {x, y}; closed polygons do not repeat the first point.
import { distPointSeg } from './vec.js';

export function signedArea(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[(i + 1) % n];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a / 2;
}

export function centroid(p) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[(i + 1) % n];
    const k = p[i].x * q.y - q.x * p[i].y;
    a += k; cx += (p[i].x + q.x) * k; cy += (p[i].y + q.y) * k;
  }
  if (Math.abs(a) < 1e-12) return { x: p[0] ? p[0].x : 0, y: p[0] ? p[0].y : 0 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function bbox(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) {
    if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function bboxOfMany(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const q of p) {
    if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
    if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function perimeter(p, closed = true) {
  let l = 0;
  const n = p.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const q = p[(i + 1) % n];
    l += Math.hypot(q.x - p[i].x, q.y - p[i].y);
  }
  return l;
}

export function pointInPoly(pt, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Minimum distance from a point to a polygon boundary (closed) or polyline (open).
export function distToPoly(pt, p, closed = true) {
  let best = { d: Infinity, x: 0, y: 0, i: -1 };
  const n = p.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const r = distPointSeg(pt, p[i], p[(i + 1) % n]);
    if (r.d < best.d) best = { d: r.d, x: r.x, y: r.y, i };
  }
  return best;
}

// Signed distance: negative inside, positive outside.
export function signedDist(pt, p) {
  const d = distToPoly(pt, p, true).d;
  return pointInPoly(pt, p) ? -d : d;
}

// Minimum distance between two closed polygon boundaries, with the closest pair of points.
// Exact for non-intersecting polygons (the minimum is always attained at a vertex of one of them).
export function minDistPolys(a, b) {
  let best = { d: Infinity, a: null, b: null };
  for (const v of a) {
    const r = distToPoly(v, b, true);
    if (r.d < best.d) best = { d: r.d, a: { x: v.x, y: v.y }, b: { x: r.x, y: r.y } };
  }
  for (const v of b) {
    const r = distToPoly(v, a, true);
    if (r.d < best.d) best = { d: r.d, a: { x: r.x, y: r.y }, b: { x: v.x, y: v.y } };
  }
  return best;
}

export const translate = (p, dx, dy) => p.map((q) => ({ x: q.x + dx, y: q.y + dy }));
export const mirrorX = (p) => p.map((q) => ({ x: -q.x, y: q.y })).reverse();
export function rotate(p, ang, cx = 0, cy = 0) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return p.map((q) => ({ x: cx + (q.x - cx) * c - (q.y - cy) * s, y: cy + (q.x - cx) * s + (q.y - cy) * c }));
}
// rotate about the origin, then translate
export function place(p, x, y, ang = 0) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return p.map((q) => ({ x: x + q.x * c - q.y * s, y: y + q.x * s + q.y * c }));
}

export function ensureCCW(p) {
  return signedArea(p) < 0 ? p.slice().reverse() : p;
}

// Remove consecutive duplicates (and a closing duplicate).
export function dedupe(p, eps = 1e-7) {
  const out = [];
  for (const q of p) {
    const l = out[out.length - 1];
    if (!l || Math.abs(l.x - q.x) > eps || Math.abs(l.y - q.y) > eps) out.push(q);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps) out.pop();
  }
  return out;
}

// Resample a closed polygon to points roughly `step` apart (keeps original vertices).
export function densify(p, step, closed = true) {
  const out = [];
  const n = p.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = p[i], b = p[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const k = Math.max(1, Math.ceil(l / step));
    for (let j = 0; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  if (!closed) out.push({ ...p[n - 1] });
  return out;
}

/* ---------- primitive shapes (all returned counter-clockwise, centered on the origin) ---------- */

export function arcPts(cx, cy, r, a0, a1, tol = 0.01) {
  // points along an arc from a0 to a1 (radians, either direction), including both ends
  const sweep = a1 - a0;
  const step = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI / 4;
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / Math.max(step, 1e-3)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return out;
}

export function circlePoly(cx, cy, r, tol = 0.01) {
  const p = arcPts(cx, cy, r, 0, Math.PI * 2, tol);
  p.pop();
  return p;
}

// Rounded rectangle w (x) by h (y) with corner radius r.
export function roundRect(w, h, r, tol = 0.01) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const x = w / 2, y = h / 2;
  if (r < 1e-9) return [{ x: -x, y: -y }, { x, y: -y }, { x, y }, { x: -x, y }];
  const H = Math.PI / 2;
  return dedupe([
    ...arcPts(x - r, -y + r, r, -H, 0, tol),
    ...arcPts(x - r, y - r, r, 0, H, tol),
    ...arcPts(-x + r, y - r, r, H, 2 * H, tol),
    ...arcPts(-x + r, -y + r, r, 2 * H, 3 * H, tol),
  ]);
}

// Stadium (slot): overall length L along x, width W along y, full round ends.
export const stadium = (L, W, tol = 0.01) => roundRect(L, W, W / 2, tol);

// Round the convex/concave corners of a simple polygon with radius r (used for cavity shapes drawn from straight edges).
export function filletPoly(p, radius, tol = 0.01) {
  const n = p.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Array.isArray(radius) ? radius[i] || 0 : radius; // one radius for all corners, or one per corner
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    const cosA = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2 || 1);
    const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
    if (ang > Math.PI - 1e-3 || r <= 0) { out.push({ ...b }); continue; }
    let t = r / Math.tan(ang / 2);
    const tmax = Math.min(l1, l2) / 2;
    let rr = r;
    if (t > tmax) { t = tmax; rr = t * Math.tan(ang / 2); }
    const p1 = { x: b.x + (v1.x / l1) * t, y: b.y + (v1.y / l1) * t };
    const p2 = { x: b.x + (v2.x / l2) * t, y: b.y + (v2.y / l2) * t };
    // center lies along the bisector
    const bis = { x: v1.x / l1 + v2.x / l2, y: v1.y / l1 + v2.y / l2 };
    const bl = Math.hypot(bis.x, bis.y) || 1;
    const cdist = rr / Math.sin(ang / 2);
    const cx = b.x + (bis.x / bl) * cdist, cy = b.y + (bis.y / bl) * cdist;
    let a0 = Math.atan2(p1.y - cy, p1.x - cx), a1 = Math.atan2(p2.y - cy, p2.x - cx);
    let d = a1 - a0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    out.push(...arcPts(cx, cy, rr, a0, a0 + d, tol));
  }
  return dedupe(out);
}
