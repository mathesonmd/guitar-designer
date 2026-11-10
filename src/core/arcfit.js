// Replace a dense polyline with a short chain of straight lines and circular arcs that stays within
// `tol` of it. CAD/CAM programs and lasers cut arcs more smoothly than thousands of tiny segments.
// Output vertices carry a DXF-style bulge: bulge = tan(sweep / 4), positive = counter-clockwise.
import { distPointSeg } from './vec.js';

function circle3(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-10) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

const TAU = Math.PI * 2;
const wrap = (a) => ((a % TAU) + TAU) % TAU;

// Try to cover pts[s..e] (indices into the unrolled array) with one line or arc. Returns bulge or null.
function tryFit(P, s, e, tol) {
  const A = P[s], B = P[e];
  if (e - s === 1) return 0;
  // straight line?
  let lineOk = true;
  for (let i = s + 1; i < e; i++) if (distPointSeg(P[i], A, B).d > tol) { lineOk = false; break; }
  if (lineOk) return 0;
  const M = P[(s + e) >> 1];
  const c = circle3(A, M, B);
  if (!c || c.r > 1e5) return null;
  const a0 = Math.atan2(A.y - c.y, A.x - c.x);
  const d1 = wrap(Math.atan2(B.y - c.y, B.x - c.x) - a0), dm = wrap(Math.atan2(M.y - c.y, M.x - c.x) - a0);
  const ccw = dm < d1;
  const sweep = ccw ? d1 : d1 - TAU;
  if (Math.abs(sweep) > 2.6) return null; // keep arcs under ~150 degrees
  let prev = 0;
  for (let i = s + 1; i < e; i++) {
    const p = P[i];
    if (Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - c.r) > tol) return null;
    // points must advance steadily around the arc
    let d = wrap(Math.atan2(p.y - c.y, p.x - c.x) - a0);
    if (!ccw) d = TAU - d;
    if (d > TAU - 1e-9) d = 0;
    if (d < prev - 1e-7 || d > Math.abs(sweep) + 1e-7) return null;
    prev = d;
  }
  // the chord between neighboring input points must also stay close to the arc
  for (let i = s; i < e; i++) {
    const mx = (P[i].x + P[i + 1].x) / 2, my = (P[i].y + P[i + 1].y) / 2;
    if (Math.abs(Math.hypot(mx - c.x, my - c.y) - c.r) > tol) return null;
  }
  return Math.tan(sweep / 4);
}

// `straight`: an input edge at least this long is a real straight line (a pocket wall, a flat side).
// Both its ends are kept as vertices, so the line stays exactly where it was and no arc runs past it.
export function fitArcs(pts, tol = 0.01, closed = true, straight = 6) {
  const n = pts.length;
  if (n < 3) return pts.map((p) => ({ x: p.x, y: p.y, bulge: 0 }));
  // start at the sharpest corner so a smooth arc is not split at an arbitrary seam
  let start = 0;
  if (closed) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      const v1x = b.x - a.x, v1y = b.y - a.y, v2x = c.x - b.x, v2y = c.y - b.y;
      const l = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
      const turn = 1 - (v1x * v2x + v1y * v2y) / l;
      if (turn > best) { best = turn; start = i; }
    }
  }
  const P = [];
  const total = closed ? n + 1 : n;
  for (let i = 0; i < total; i++) P.push(pts[(start + i) % n]);
  const out = [];
  let s = 0;
  const end = P.length - 1;
  const keep = new Uint8Array(P.length);
  for (let i = 0; i < end; i++) if (Math.hypot(P[i + 1].x - P[i].x, P[i + 1].y - P[i].y) >= straight) { keep[i] = 1; keep[i + 1] = 1; }
  while (s < end) {
    // this piece may reach no further than the next vertex that has to be kept
    let last = s + 1;
    while (last < end && !keep[last]) last++;
    // grow, then binary-search the furthest point one line/arc can reach
    let good = s + 1, goodBulge = 0, step = 2, bad = -1;
    while (s + step <= last) {
      const b = tryFit(P, s, s + step, tol);
      if (b === null) { bad = s + step; break; }
      good = s + step; goodBulge = b; step *= 2;
    }
    if (bad < 0 && good < last) {
      const b = tryFit(P, s, last, tol);
      if (b !== null) { good = last; goodBulge = b; } else bad = last;
    }
    if (bad > 0) {
      let lo = good, hi = bad;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        const b = tryFit(P, s, mid, tol);
        if (b !== null) { lo = mid; goodBulge = b; } else hi = mid;
      }
      good = lo;
      if (good === s + 1) goodBulge = 0;
    }
    out.push({ x: P[s].x, y: P[s].y, bulge: goodBulge });
    s = good;
  }
  if (!closed) out.push({ x: P[end].x, y: P[end].y, bulge: 0 });
  return out;
}

// Geometry of the arc that starts at vertex a and ends at b.
export function arcOf(a, b) {
  const theta = 4 * Math.atan(a.bulge);
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  const r = d / (2 * Math.sin(Math.abs(theta) / 2));
  const h = r * Math.cos(theta / 2) * Math.sign(theta);
  const cx = (a.x + b.x) / 2 - (dy / d) * h, cy = (a.y + b.y) / 2 + (dx / d) * h;
  return { cx, cy, r, theta, a0: Math.atan2(a.y - cy, a.x - cx) };
}

// Expand lines+arcs back into a dense polyline (for display, PDF output and for checking the fit).
export function expandArcs(verts, closed = true, tol = 0.005) {
  const out = [];
  const n = verts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    out.push({ x: a.x, y: a.y });
    if (a.bulge) {
      const c = arcOf(a, b);
      const step = 2 * Math.acos(Math.max(-1, 1 - tol / c.r));
      const k = Math.max(2, Math.ceil(Math.abs(c.theta) / step));
      for (let j = 1; j < k; j++) {
        const ang = c.a0 + (c.theta * j) / k;
        out.push({ x: c.cx + c.r * Math.cos(ang), y: c.cy + c.r * Math.sin(ang) });
      }
    }
  }
  if (!closed) out.push({ x: verts[n - 1].x, y: verts[n - 1].y });
  return out;
}
