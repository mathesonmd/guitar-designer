// The body as a stack of thin horizontal slices. Each slice is an exact 2D region (outline minus
// whatever is cut away at that height), so pockets, edge roundovers and bevels all come out of the
// same polygon math that makes the templates. Used for the 3D view and for volume, weight and balance.
// z = 0 is the back face, z = thickness is the top face.
import { offset, difference, intersect, toRegion, regionCentroid } from '../core/clip.js';
import { WOODS } from '../data/parts.js';
import { edgeRounds } from './design.js';

const ROUND_STEPS = 8;
const BEVEL_STEP = 1.0;
const DISH_STEP = 0.75;
const EDGE_STEPS = 16;

// ---------------------------------------------------------------------------------------------
// Arm bevel. A cut that starts at a line drawn on the top and deepens toward the body edge. It is the
// shape a wide flat sander leaves when the body is held against it and rolled: straight along the line,
// curved across it. The line runs on past its two squares, right across the body, unless `bounded`.
//   drop     how deep it is at the body edge
//   roll     0 = a flat cut with a crease where it meets the top. 1 = rolled all the way, so the cut
//            leaves the top with no crease. (Older files give `crown` in millimeters instead.)
//   blend    radius that rounds whatever crease is left where the cut meets the top
//   bounded  true = the cut is kept between the two squares, and wood past either one is left alone
//   fade     only when bounded: over this length at each end the cut rises and runs out to nothing
// Everything is described by one depth function, depth(x, y) = P(s) - rise(t): P is the cross-section
// (s = distance past the line), rise is how far the cut has lifted at distance t along the line. The
// CAD solid is built from the same cross-section and the same rise curve, so the two agree.
// Returns null when the bevel is off or misses the body.
export function bevelPlane(c, outline, centroid, maxDrop = Infinity) {
  if (!c || !c.on || !(c.drop > 0)) return null;
  const dx = c.x2 - c.x1, dy = c.y2 - c.y1, l = Math.hypot(dx, dy);
  if (l < 1e-6) return null;
  const tx = dx / l, ty = dy / l;
  let nx = ty, ny = -tx;
  // cut the side away from the middle of the body
  if ((centroid.x - c.x1) * nx + (centroid.y - c.y1) * ny > 0) { nx = -nx; ny = -ny; }
  const s = (x, y) => (x - c.x1) * nx + (y - c.y1) * ny;  // distance past the line
  const t = (x, y) => (x - c.x1) * tx + (y - c.y1) * ty;  // distance along it
  const bounded = !!c.bounded;
  const inSpan = (x, y) => { if (!bounded) return true; const v = t(x, y); return v >= -1e-6 && v <= l + 1e-6; };
  // how far the body reaches along the line, so an unbounded cut can be drawn right across it
  let t0 = 0, t1 = l;
  if (!bounded) { t0 = Infinity; t1 = -Infinity; for (const q of outline) { const v = t(q.x, q.y); if (v < t0) t0 = v; if (v > t1) t1 = v; } t0 -= 10; t1 += 10; }
  // the deepest point is the farthest body edge between the two ends (sampled along each outline segment)
  let sMax = 0;
  for (let i = 0, n = outline.length; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    for (let k = 0; k < 4; k++) { const x = a.x + ((b.x - a.x) * k) / 4, y = a.y + ((b.y - a.y) * k) / 4; if (inSpan(x, y)) sMax = Math.max(sMax, s(x, y)); }
  }
  if (sMax < 0.5) return null;
  const drop = Math.min(c.drop, maxDrop);
  const crownMax = bevelCrownMax(sMax, drop);
  const prof = bevelProfile(sMax, drop, c.roll !== undefined && c.roll !== null ? Math.max(0, Math.min(1, c.roll)) * crownMax : (c.crown || 0), c.blend || 0);
  const fade = bounded ? Math.max(0, Math.min(c.fade || 0, l / 2)) : 0;
  // how far the cut has lifted, t along the line: nothing in the middle, a parabola up through `drop` at each end
  const rise = (v) => {
    if (!(fade > 0)) return 0;
    const d = v < fade ? fade - v : v > l - fade ? v - (l - fade) : 0;
    return drop * (d / fade) * (d / fade);
  };
  const depth = (x, y) => {
    if (!inSpan(x, y)) return 0; // with or without a run-out, wood past either end of the line is left alone
    return fade > 0 ? Math.max(0, prof.P(s(x, y)) - rise(t(x, y))) : prof.P(s(x, y));
  };
  const B = 4000;
  const at = (v, u) => ({ x: c.x1 + tx * v + nx * u, y: c.y1 + ty * v + ny * u });
  // what one slice loses: everything where the cut is deeper than dz
  const region = (dz) => {
    if (!(fade > 0)) { const lim = prof.Pinv(dz); return lim === null ? [] : [[at(t0, lim), at(t1, lim), at(t1, B), at(t0, B)]]; }
    const N = 120, v0 = 0, v1 = l, runs = [];
    let cur = null;
    for (let i = 0; i <= N; i++) {
      const v = v0 + ((v1 - v0) * i) / N, lim = prof.Pinv(dz + rise(v));
      if (lim === null) { if (cur) { runs.push(cur); cur = null; } continue; }
      if (!cur) cur = [];
      cur.push(at(v, lim));
    }
    if (cur) runs.push(cur);
    return runs.filter((r) => r.length > 1).map((r) => {
      const a = r[0], z = r[r.length - 1];
      return [...r, { x: z.x + nx * B, y: z.y + ny * B }, { x: a.x + nx * B, y: a.y + ny * B }];
    });
  };
  // surface normal pointing out of the wood (up, out of the cut)
  const normal = (x, y) => {
    const h = 0.02, gx = (depth(x + h, y) - depth(x - h, y)) / (2 * h), gy = (depth(x, y + h) - depth(x, y - h)) / (2 * h), k = Math.hypot(gx, gy, 1);
    return [gx / k, gy / k, 1 / k];
  };
  // the stretch of the line to draw: between the squares when bounded, right across the body when not
  const ends = [at(t0, 0), at(t1, 0)];
  return { nx, ny, tx, ty, l, sMax, drop, fade, bounded, t0, t1, ends, s, t, inSpan, depth, region, normal, rise, prof, crown: prof.crown, roll: crownMax > 0 ? Math.min(1, prof.crown / crownMax) : 0, blend: prof.blend, slope: drop / sMax };
}

// The most an arm bevel can bulge up from flat: an arc that leaves the top with no crease.
export function bevelCrownMax(sMax, drop) {
  const L = Math.hypot(sMax, drop), Rt = (L * L) / (2 * drop);
  return Rt - Math.sqrt(Math.max(0, Rt * Rt - (L * L) / 4));
}

// Cross-section of an arm bevel: depth below the top as a function of s, the distance past the line.
// It is made of at most three pieces, each a straight line or a circular arc, so the CAD solid can draw
// exactly the same curve: [blend arc] + [the bevel: a line, or an arc when crowned] + [a straight run-on
// past the body edge]. `segs` lists them as { a, m, b } points in (s, depth); m is set for arcs.
export function bevelProfile(sMax, drop, crownIn, blendIn) {
  const L = Math.hypot(sMax, drop), slope = drop / sMax;
  // the most crown there can be: an arc that leaves the top with no crease
  const Rt = (L * L) / (2 * drop), crownMax = Rt - Math.sqrt(Math.max(0, Rt * Rt - (L * L) / 4));
  const crown = Math.max(0, Math.min(crownIn, crownMax * 0.999));
  let arc = null;
  if (crown > 1e-6) {
    const R = ((L * L) / 4 + crown * crown) / (2 * crown), k = R - crown;
    arc = { R, Cs: sMax / 2 - (drop / L) * k, Cd: drop / 2 + (sMax / L) * k };
  }
  const main = (u) => (arc ? arc.Cd - Math.sqrt(Math.max(0, arc.R * arc.R - (u - arc.Cs) * (u - arc.Cs))) : slope * u);
  const mainSlope = (u) => (arc ? (u - arc.Cs) / Math.sqrt(Math.max(1e-12, arc.R * arc.R - (u - arc.Cs) * (u - arc.Cs))) : slope);
  const endSlope = mainSlope(sMax);
  // blend: a circle of radius r under the top (center at depth r), touching the top and the bevel
  let blend = Math.max(0, blendIn), sf = 0, st = 0, dt = 0;
  for (let i = 0; i < 40 && blend > 1e-6; i++) {
    if (arc) {
      const q = (arc.R - blend) * (arc.R - blend) - (blend - arc.Cd) * (blend - arc.Cd);
      if (q > 0 && arc.R > blend) {
        sf = arc.Cs + Math.sqrt(q); // the arc's center lies behind the line, so the blend sits on its near side
        const f = arc.R / (arc.R - blend);
        st = arc.Cs + (sf - arc.Cs) * f; dt = arc.Cd + (blend - arc.Cd) * f;
        if (st <= 0.9 * sMax) break;
      }
    } else {
      const phi = Math.atan(slope), h = blend * Math.tan(phi / 2);
      sf = -h; st = h * Math.cos(phi); dt = slope * st;
      if (st <= 0.9 * sMax) break;
    }
    blend *= 0.8; // too big to fit on this bevel: shrink it until it does
    sf = 0; st = 0; dt = 0;
  }
  if (blend <= 1e-6) { blend = 0; sf = 0; st = 0; dt = 0; }
  const reach = sMax + 40;
  const P = (u) => {
    if (u <= sf) return 0;
    if (blend > 0 && u < st) return blend - Math.sqrt(Math.max(0, blend * blend - (u - sf) * (u - sf)));
    if (u <= sMax) return main(u);
    return drop + endSlope * (u - sMax);
  };
  // the s where the cut reaches depth d, or null when it never gets that deep before the far end
  const Pinv = (d) => {
    if (d <= 0) return sf;
    if (d >= P(reach)) return null;
    let lo = sf, hi = reach;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (P(mid) < d) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  const segs = [];
  if (blend > 0) { const um = (sf + st) / 2; segs.push({ a: [sf, 0], m: [um, P(um)], b: [st, dt] }); }
  const u0 = blend > 0 ? st : 0;
  if (arc) { const um = (u0 + sMax) / 2; segs.push({ a: [u0, main(u0)], m: [um, main(um)], b: [sMax, drop] }); }
  else segs.push({ a: [u0, main(u0)], b: [sMax, drop] });
  segs.push({ a: [sMax, drop], b: [reach, P(reach)] });
  return { P, Pinv, segs, start: sf, reach, crown, crownMax, blend };
}

// A belly cut in today's terms. Older files stored it as two points (the deepest point and how far in
// the cut reaches) plus a length; this turns either form into: center, angle, length, reach.
export function bellyParams(c) {
  if (c && c.x1 !== undefined && c.x === undefined) {
    const dx = c.x2 - c.x1, dy = c.y2 - c.y1;
    let ang = Math.atan2(dy, dx);
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang <= -Math.PI / 2) ang += Math.PI;
    return { on: c.on, x: c.x1, y: c.y1, angle: ang, len: c.len || 0, reach: Math.hypot(dx, dy), drop: c.drop, blend: c.blend || 0 };
  }
  return c;
}

// A belly cut is a wide, short cone taken out of the back of the body: deepest at its center, on the
// body edge, and rising in a straight slope to its rim.
//   len    its full length; with angle 0 this runs parallel to the centerline
//   reach  how far it reaches from its center in toward the body
//   drop   how deep it is at its center
//   blend  radius of the short smooth transition where the cone meets the back
// Depth = drop * (1 - rho), rho = sqrt(u^2 + v^2): u runs across (1 at the reach), v along (1 at half
// the length). The rim blend is worked out here from the cone's slope at each point of the rim, which is
// close but not exact for a cone that is longer than it is wide; the CAD solid rolls a true radius.
// Returns null when the cut is off.
export function bellyDish(cIn, maxDrop = Infinity) {
  const c = bellyParams(cIn);
  if (!c || !c.on || !(c.drop > 0)) return null;
  const a = c.reach || 0, b = (c.len || 0) / 2;
  if (a < 2 || b < 2) return null;
  const drop = Math.min(c.drop, maxDrop);
  const ang = c.angle || 0;
  const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux; // u across, v along (parallel to the centerline at angle 0)
  const uv = (x, y) => [((x - c.x) * ux + (y - c.y) * uy) / a, ((x - c.x) * vx + (y - c.y) * vy) / b];
  const rho = (x, y) => { const [u, v] = uv(x, y); return Math.hypot(u, v); };
  // steepness of the bowl where it meets the back, in the direction (cu, cv) from the center
  const rimSlope = (cu, cv) => drop * Math.hypot(cu / a, cv / b);
  // the blend may not be so big that it swallows the bowl at its steepest place
  let blend = Math.max(0, c.blend || 0);
  if (blend > 0) {
    const G = drop / Math.min(a, b), phi = Math.atan(G), most = (0.5 * drop / G) / (Math.tan(phi / 2) * Math.cos(phi));
    blend = Math.min(blend, most);
    if (blend < 1e-6) blend = 0;
  }
  // depth at "e", the bowl's own depth divided by its rim steepness G (close to the distance in from the rim)
  const blended = (e, G) => {
    const phi = Math.atan(G), ec = -blend * Math.tan(phi / 2), et = blend * Math.tan(phi / 2) * Math.cos(phi);
    if (e <= ec) return 0;
    if (e >= et) return G * e;
    return blend - Math.sqrt(Math.max(0, blend * blend - (e - ec) * (e - ec)));
  };
  const depth = (x, y) => {
    const [u, v] = uv(x, y), r = Math.hypot(u, v), d0 = drop * (1 - r);
    if (!(blend > 0)) return Math.max(0, d0);
    if (r < 1e-9) return drop;
    const G = rimSlope(u / r, v / r);
    return blended(d0 / G, G);
  };
  const point = (cu, cv, k) => ({ x: c.x + ux * a * k * cu + vx * b * k * cv, y: c.y + uy * a * k * cu + vy * b * k * cv });
  return {
    drop, a, b, rho, depth, blend, x: c.x, y: c.y, angle: ang, ux, uy, vx, vy,
    // the edge of the cut at a given fraction of its full size (1 = where the bare cone meets the back face)
    ellipse: (k = 1, n = 120) => Array.from({ length: n }, (_, i) => { const th = (i / n) * 2 * Math.PI; return point(Math.cos(th), Math.sin(th), k); }),
    // the edge of the cut at height z above the back face (it narrows as it rises into the body)
    outlineAt: (z, n = 144) => Array.from({ length: n }, (_, i) => {
      const th = (i / n) * 2 * Math.PI, cu = Math.cos(th), cv = Math.sin(th);
      if (!(blend > 0)) return point(cu, cv, Math.max(0, 1 - z / drop));
      const G = rimSlope(cu, cv), phi = Math.atan(G), ec = -blend * Math.tan(phi / 2), et = blend * Math.tan(phi / 2) * Math.cos(phi);
      const e = z >= G * et ? z / G : ec + Math.sqrt(Math.max(0, blend * blend - (blend - z) * (blend - z)));
      return point(cu, cv, Math.max(0, 1 - (G * e) / drop));
    }),
    // surface normal pointing out of the wood (down, into the cut)
    normal: (x, y) => {
      const h = 0.02, gx = (depth(x + h, y) - depth(x - h, y)) / (2 * h), gy = (depth(x, y + h) - depth(x, y - h)) / (2 * h), k = Math.hypot(gx, gy, 1);
      return [gx / k, gy / k, -1 / k];
    },
  };
}

export function buildLayers(design, g) {
  const T = design.body.thickness;
  const { top: rT, back: rB } = edgeRounds(design);
  const bind = g.binding || null;
  const edge = g.bevelEdge || null;
  const base = toRegion([g.outline]);
  const arm = bevelPlane(design.contours.arm, g.outline, g.centroid, T - 3);
  const dish = bellyDish(design.contours.belly, T - 3);

  // everything removed from the blank, as { poly, z0, z1 }
  const removed = [];
  for (const c of g.cuts) {
    const d = Math.min(c.depth, T);
    removed.push(c.side === 'back' ? { poly: c.poly, z0: 0, z1: d } : { poly: c.poly, z0: T - d, z1: T });
  }
  for (const h of g.holes) {
    const poly = circle(h.x, h.y, h.d / 2);
    if (h.side === 'through') removed.push({ poly, z0: 0, z1: T });
    else if (h.depth > 0) removed.push(h.side === 'back' ? { poly, z0: 0, z1: Math.min(h.depth, T) } : { poly, z0: T - Math.min(h.depth, T), z1: T });
    else if (h.kind === 'stud') removed.push({ poly, z0: T - Math.min(20, T - 2), z1: T }); // nominal depth, 3D picture only
    else if (h.kind === 'ferrule') removed.push({ poly, z0: 0, z1: Math.min(8, T - 2) }); // nominal depth, 3D picture only
  }

  // heights where the cross-section changes
  const zs = new Set([0, T]);
  const add = (z) => { if (z > 1e-6 && z < T - 1e-6) zs.add(Math.round(z * 1e4) / 1e4); };
  for (const r of removed) { add(r.z0); add(r.z1); }
  if (bind) add(T - bind.depth);
  if (edge && edge.deepest > 0) for (let i = 0; i <= EDGE_STEPS; i++) add(T - edge.deepest + (edge.deepest * i) / EDGE_STEPS);
  const purf = g.purfling || null;
  const purfRing = purf ? difference(toRegion(purf.outer), toRegion(purf.inner)) : null;
  if (purf) add(T - purf.depth);
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
    // the binding channel is a square ledge: above its floor the body is narrower by the channel's width
    if (bind && zm > T - bind.depth) inset = Math.max(inset, bind.width);
    let region = insetRegion(inset);
    // bevel around the top edge: at this height the body is the shape partway from the outline to the inner line
    // (where the bevel is shallower than this height the shape lies outside the body, and the body is left whole)
    if (edge && edge.deepest > 0 && zm > T - edge.deepest) {
      const pts = edge.shapeAt(zm), lower = edge.shapeAt(z0), upper = edge.shapeAt(z1);
      region = intersect(region, toRegion([pts]));
      // for shading: how far the bevel's edge moves in across this slice, and which way, at each point
      tag.edge = { pts, dz: z1 - z0, run: pts.map((_, i) => Math.hypot(lower[i].x - upper[i].x, lower[i].y - upper[i].y)), out: pts.map((_, i) => ({ x: lower[i].x - upper[i].x, y: lower[i].y - upper[i].y })) };
    }
    // purfling channel: a narrow groove just inside the bevel's inner line
    if (purfRing && zm > T - purf.depth) region = difference(region, purfRing);
    if (arm && zm > T - arm.drop) {
      const cutAway = arm.region(T - zm);
      if (cutAway.length) region = difference(region, cutAway);
      tag.arm = { dz: T - zm };
    }
    if (dish && zm < dish.drop) {
      region = difference(region, [dish.outlineAt(zm)]); // the cone narrows as it rises into the body
      tag.dish = { z: zm };
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
