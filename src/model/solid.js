// The body as a stack of thin horizontal slices. Each slice is an exact 2D region (outline minus
// whatever is cut away at that height), so pockets, edge roundovers and bevels all come out of the
// same polygon math that makes the templates. Used for the 3D view and for volume, weight and balance.
// z = 0 is the back face, z = thickness is the top face.
import { offset, difference, toRegion, regionCentroid } from '../core/clip.js';
import { WOODS } from '../data/parts.js';

const ROUND_STEPS = 8;
const BEVEL_STEP = 1.0;
const DISH_STEP = 0.75;

// An arm bevel is a flat cut that starts at a line drawn on the top and deepens toward the body edge.
// It spans the stretch between the line's two ends: wood beyond either end is left alone.
// Returns null when the bevel is off or misses the body.
export function bevelPlane(c, outline, centroid) {
  if (!c || !c.on || !(c.drop > 0)) return null;
  const dx = c.x2 - c.x1, dy = c.y2 - c.y1, l = Math.hypot(dx, dy);
  if (l < 1e-6) return null;
  const tx = dx / l, ty = dy / l;
  let nx = ty, ny = -tx;
  // cut the side away from the middle of the body
  if ((centroid.x - c.x1) * nx + (centroid.y - c.y1) * ny > 0) { nx = -nx; ny = -ny; }
  const s = (x, y) => (x - c.x1) * nx + (y - c.y1) * ny;  // distance past the line
  const t = (x, y) => (x - c.x1) * tx + (y - c.y1) * ty;  // distance along it
  const inSpan = (x, y) => { const v = t(x, y); return v >= -1e-6 && v <= l + 1e-6; };
  // the deepest point is the farthest body edge between the two ends (sampled along each outline segment)
  let sMax = 0;
  for (let i = 0, n = outline.length; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    for (let k = 0; k < 4; k++) { const x = a.x + ((b.x - a.x) * k) / 4, y = a.y + ((b.y - a.y) * k) / 4; if (inSpan(x, y)) sMax = Math.max(sMax, s(x, y)); }
  }
  if (sMax < 0.5) return null;
  // everything more than `limit` past the line, between the two ends: what one slice loses
  const zone = (limit) => {
    const B = 4000, ox = c.x1 + nx * limit, oy = c.y1 + ny * limit;
    return [
      { x: ox, y: oy }, { x: ox + tx * l, y: oy + ty * l },
      { x: ox + tx * l + nx * B, y: oy + ty * l + ny * B }, { x: ox + nx * B, y: oy + ny * B },
    ];
  };
  return { nx, ny, sMax, drop: c.drop, s, inSpan, zone, slope: c.drop / sMax };
}

// A belly cut is a shallow dish in the back of the body: deepest at a point on the body edge and
// fading to nothing along an ellipse. Depth at a point = drop * (1 - u^2 - v^2), where u runs from the
// deepest point toward the inside of the body (1 at the reach handle) and v runs along the body edge
// (1 at half the cut's length). Returns null when the cut is off.
export function bellyDish(c, maxDrop = Infinity) {
  if (!c || !c.on || !(c.drop > 0)) return null;
  const dx = c.x2 - c.x1, dy = c.y2 - c.y1, a = Math.hypot(dx, dy), b = (c.len || 0) / 2;
  if (a < 2 || b < 2) return null;
  const drop = Math.min(c.drop, maxDrop);
  const ux = dx / a, uy = dy / a, vx = -uy, vy = ux;
  const uv = (x, y) => [((x - c.x1) * ux + (y - c.y1) * uy) / a, ((x - c.x1) * vx + (y - c.y1) * vy) / b];
  const rho = (x, y) => { const [u, v] = uv(x, y); return Math.hypot(u, v); };
  return {
    drop, a, b, rho,
    depth: (x, y) => { const r = rho(x, y); return drop * Math.max(0, 1 - r * r); },
    // the edge of the cut at a given fraction of its full size (1 = where it meets the back face)
    ellipse: (k = 1, n = 120) => Array.from({ length: n }, (_, i) => {
      const t = (i / n) * 2 * Math.PI, eu = a * k * Math.cos(t), ev = b * k * Math.sin(t);
      return { x: c.x1 + ux * eu + vx * ev, y: c.y1 + uy * eu + vy * ev };
    }),
    // surface normal pointing out of the wood (down, into the cut)
    normal: (x, y) => {
      const [u, v] = uv(x, y);
      const gu = (-2 * drop * u) / a, gv = (-2 * drop * v) / b;
      const nx = gu * ux + gv * vx, ny = gu * uy + gv * vy, l = Math.hypot(nx, ny, 1);
      return [nx / l, ny / l, -1 / l];
    },
  };
}

export function buildLayers(design, g) {
  const T = design.body.thickness;
  const rT = Math.max(0, Math.min(design.body.roundTop || 0, T / 2 - 0.5));
  const rB = Math.max(0, Math.min(design.body.roundBack || 0, T / 2 - 0.5));
  const base = toRegion([g.outline]);
  const arm = bevelPlane(design.contours.arm, g.outline, g.centroid);
  const dish = bellyDish(design.contours.belly, T - 3);
  if (arm) arm.drop = Math.min(arm.drop, T - 3), (arm.slope = arm.drop / arm.sMax);

  // everything removed from the blank, as { poly, z0, z1 }
  const removed = [];
  for (const c of g.cuts) {
    const d = Math.min(c.depth, T);
    removed.push(c.side === 'back' ? { poly: c.poly, z0: 0, z1: d } : { poly: c.poly, z0: T - d, z1: T });
  }
  for (const h of g.holes) {
    const poly = circle(h.x, h.y, h.d / 2);
    if (h.side === 'through') removed.push({ poly, z0: 0, z1: T });
    else if (h.kind === 'stud') removed.push({ poly, z0: T - Math.min(20, T - 2), z1: T }); // nominal depth, 3D picture only
    else if (h.kind === 'ferrule') removed.push({ poly, z0: 0, z1: Math.min(8, T - 2) }); // nominal depth, 3D picture only
  }

  // heights where the cross-section changes
  const zs = new Set([0, T]);
  const add = (z) => { if (z > 1e-6 && z < T - 1e-6) zs.add(Math.round(z * 1e4) / 1e4); };
  for (const r of removed) { add(r.z0); add(r.z1); }
  const topBand = [], backBand = [];
  if (rT > 0.05) for (let i = 0; i <= ROUND_STEPS; i++) { const th = (i / ROUND_STEPS) * (Math.PI / 2); const z = T - rT + rT * Math.sin(th); topBand.push({ z, th }); add(z); }
  if (rB > 0.05) for (let i = 0; i <= ROUND_STEPS; i++) { const th = (i / ROUND_STEPS) * (Math.PI / 2); const z = rB - rB * Math.sin(th); backBand.push({ z, th }); add(z); }
  if (arm) for (let z = T - arm.drop; z < T; z += BEVEL_STEP) add(z);
  if (dish) for (let z = dish.drop; z > 0; z -= DISH_STEP) add(z);
  const levels = [...zs].sort((a, b) => a - b);

  const insetCache = new Map();
  const insetRegion = (d) => {
    const k = Math.round(d * 1000);
    if (!insetCache.has(k)) insetCache.set(k, d < 1e-4 ? base : offset(base, -d, 0.02));
    return insetCache.get(k);
  };

  const layers = [];
  let V = 0, mx = 0, my = 0, mz = 0;
  for (let i = 0; i < levels.length - 1; i++) {
    const z0 = levels[i], z1 = levels[i + 1], zm = (z0 + z1) / 2;
    if (z1 - z0 < 1e-5) continue;
    const tag = {};
    let inset = 0;
    if (rT > 0.05 && zm > T - rT) {
      const th0 = Math.asin(Math.min(1, Math.max(0, (z0 - (T - rT)) / rT))), th1 = Math.asin(Math.min(1, Math.max(0, (z1 - (T - rT)) / rT)));
      inset = rT * (1 - Math.cos((th0 + th1) / 2));
      tag.round = { th0, th1, dir: 1, inset };
    } else if (rB > 0.05 && zm < rB) {
      const th0 = Math.asin(Math.min(1, Math.max(0, (rB - z0) / rB))), th1 = Math.asin(Math.min(1, Math.max(0, (rB - z1) / rB)));
      inset = rB * (1 - Math.cos((th0 + th1) / 2));
      tag.round = { th0, th1, dir: -1, inset };
    }
    let region = insetRegion(inset);
    if (arm && zm > T - arm.drop) {
      const lim = (T - zm) / arm.slope;
      region = difference(region, [arm.zone(lim)]);
      tag.arm = { lim };
    }
    if (dish && zm < dish.drop) {
      const k = Math.sqrt(1 - zm / dish.drop); // the dish narrows as it rises into the body
      region = difference(region, [dish.ellipse(k)]);
      tag.dish = { k };
    }
    const active = removed.filter((r) => zm > r.z0 && zm < r.z1).map((r) => r.poly);
    if (active.length && region.length) region = difference(region, active);
    const c = regionCentroid(region);
    const dv = c.area * (z1 - z0);
    V += dv; mx += c.x * dv; my += c.y * dv; mz += zm * dv;
    layers.push({ z0, z1, region, tag, area: c.area });
  }

  const wood = WOODS[design.body.wood] || WOODS.alder;
  const density = design.body.wood === 'custom' ? design.body.customDensity : wood.density;
  const mass = V * density * 1e-9; // mm^3 * kg/m^3 -> kg
  return {
    T, rT, rB, arm, dish, layers,
    volume: V, mass, density,
    center: V > 0 ? { x: mx / V, y: my / V, z: mz / V } : { x: 0, y: 0, z: T / 2 },
  };
}

function circle(cx, cy, r) {
  const n = Math.max(12, Math.ceil(r * 3));
  const p = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
  return p;
}
