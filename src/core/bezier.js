// Cubic Bezier utilities.
import { lerp } from './vec.js';

export function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

export function cubicDeriv(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = 3 * u * u, b = 6 * u * t, c = 3 * t * t;
  return {
    x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
    y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y),
  };
}

// de Casteljau split at t -> [left(4 pts), right(4 pts)]
export function splitCubic(p0, p1, p2, p3, t) {
  const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
  const d = lerp(a, b, t), e = lerp(b, c, t);
  const f = lerp(d, e, t);
  return [[p0, a, d, f], [f, e, c, p3]];
}

// Adaptive flattening. Appends points AFTER p0 (p0 itself is not pushed) up to and including p3.
// tol is the maximum chord deviation in mm.
export function flattenCubic(p0, p1, p2, p3, tol, out, depth = 0) {
  // flatness: max distance of control points from the chord
  const dx = p3.x - p0.x, dy = p3.y - p0.y;
  const d1 = Math.abs((p1.x - p3.x) * dy - (p1.y - p3.y) * dx);
  const d2 = Math.abs((p2.x - p3.x) * dy - (p2.y - p3.y) * dx);
  const l2 = dx * dx + dy * dy;
  let flat;
  if (l2 < 1e-12) {
    flat = Math.hypot(p1.x - p0.x, p1.y - p0.y) < tol && Math.hypot(p2.x - p0.x, p2.y - p0.y) < tol;
  } else {
    // the curve deviates from its chord by at most 3/4 of the larger control-point distance
    const dm = Math.max(d1, d2);
    flat = dm * dm <= (16 / 9) * tol * tol * l2;
  }
  if (flat || depth > 18) {
    out.push({ x: p3.x, y: p3.y });
    return;
  }
  const [L, R] = splitCubic(p0, p1, p2, p3, 0.5);
  flattenCubic(L[0], L[1], L[2], L[3], tol, out, depth + 1);
  flattenCubic(R[0], R[1], R[2], R[3], tol, out, depth + 1);
}

// Closest point on a cubic by sampling then golden refinement. Returns {t, x, y, d}.
export function nearestOnCubic(p0, p1, p2, p3, q, samples = 24) {
  let bt = 0, bd = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = cubicAt(p0, p1, p2, p3, t);
    const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
    if (d < bd) { bd = d; bt = t; }
  }
  let lo = Math.max(0, bt - 1 / samples), hi = Math.min(1, bt + 1 / samples);
  for (let k = 0; k < 28; k++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    const a = cubicAt(p0, p1, p2, p3, m1), b = cubicAt(p0, p1, p2, p3, m2);
    const da = (a.x - q.x) ** 2 + (a.y - q.y) ** 2, db = (b.x - q.x) ** 2 + (b.y - q.y) ** 2;
    if (da < db) hi = m2; else lo = m1;
  }
  const t = (lo + hi) / 2;
  const p = cubicAt(p0, p1, p2, p3, t);
  return { t, x: p.x, y: p.y, d: Math.hypot(p.x - q.x, p.y - q.y) };
}
