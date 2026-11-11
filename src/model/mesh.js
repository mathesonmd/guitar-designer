// Triangle mesh of the layered body solid (see solid.js), with shading normals that follow the true
// roundover and bevel surfaces so the thin slices read as smooth curves.
import { ShapeUtils, Vector2 } from 'three';
import { difference } from '../core/clip.js';
import { signedArea } from '../core/poly.js';
import { EdgeIndex } from '../core/edgeindex.js';

const ccw = (p) => (signedArea(p) < 0 ? p.slice().reverse() : p);
const cw = (p) => (signedArea(p) > 0 ? p.slice().reverse() : p);

export function buildBodyMesh(solid, outline) {
  const pos = [], nor = [];
  const idx = new EdgeIndex(outline, 12);
  const { layers, arm, dish, T } = solid;
  const push = (x, y, z, nx, ny, nz) => { pos.push(x, y, z); nor.push(nx, ny, nz); };

  const ON = 6e-3; // how close a slice edge must sit to a contour's own depth to count as part of it

  for (let k = 0; k < layers.length; k++) {
    const L = layers[k];
    const { z0, z1, tag } = L;

    // ---- walls ----
    for (const e of L.region) {
      for (const loop of [ccw(e.outer), ...e.holes.map(cw)]) {
        const n = loop.length;
        // segment normals (pointing away from the material), then blended per vertex unless the corner is sharp
        const sn = new Array(n);
        for (let i = 0; i < n; i++) {
          const a = loop[i], b = loop[(i + 1) % n];
          const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
          sn[i] = { x: dy / l, y: -dx / l };
        }
        for (let i = 0; i < n; i++) {
          const a = loop[i], b = loop[(i + 1) % n];
          const pv = sn[(i - 1 + n) % n], cu = sn[i], nx = sn[(i + 1) % n];
          const na = blend(cu, pv), nb = blend(cu, nx);
          let A0, A1, B0, B1; // normals at a/b, bottom/top
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          let done = false;
          if (tag.arm && Math.abs(arm.depth(a.x, a.y) - tag.arm.dz) < ON && Math.abs(arm.depth(b.x, b.y) - tag.arm.dz) < ON && Math.abs(arm.depth(mid.x, mid.y) - tag.arm.dz) < 0.05) {
            A0 = A1 = arm.normal(a.x, a.y); B0 = B1 = arm.normal(b.x, b.y); done = true;
          } else if (tag.dish && Math.abs(dish.depth(a.x, a.y) - tag.dish.z) < ON && Math.abs(dish.depth(b.x, b.y) - tag.dish.z) < ON) {
            A0 = A1 = dish.normal(a.x, a.y); B0 = B1 = dish.normal(b.x, b.y); done = true;
          } else if (tag.edge && edgeNormal(a, tag.edge) && edgeNormal(b, tag.edge)) {
            A0 = A1 = edgeNormal(a, tag.edge); B0 = B1 = edgeNormal(b, tag.edge); done = true;
          } else if (tag.round && Math.abs(idx.nearest(mid.x, mid.y).d - tag.round.inset) < 0.06) {
            const r = tag.round;
            const c0 = Math.cos(r.th0), s0 = Math.sin(r.th0) * r.dir, c1 = Math.cos(r.th1), s1 = Math.sin(r.th1) * r.dir;
            A0 = [na.x * c0, na.y * c0, s0]; B0 = [nb.x * c0, nb.y * c0, s0];
            A1 = [na.x * c1, na.y * c1, s1]; B1 = [nb.x * c1, nb.y * c1, s1];
            done = true;
          }
          if (!done) { A0 = A1 = [na.x, na.y, 0]; B0 = B1 = [nb.x, nb.y, 0]; }
          push(a.x, a.y, z0, ...A0); push(b.x, b.y, z0, ...B0); push(b.x, b.y, z1, ...B1);
          push(a.x, a.y, z0, ...A0); push(b.x, b.y, z1, ...B1); push(a.x, a.y, z1, ...A1);
        }
      }
    }

    // ---- caps: the part of this slice not covered by its neighbor ----
    const above = layers[k + 1], below = layers[k - 1];
    const topCap = above ? (above.region.length ? difference(L.region, above.region) : L.region) : L.region;
    const botCap = below ? (below.region.length ? difference(L.region, below.region) : L.region) : L.region;
    emitCap(topCap, z1, 1, above ? above.tag : {});
    emitCap(botCap, z0, -1, below ? below.tag : {});
  }

  function emitCap(region, z, dir, ntag) {
    for (const e of region) {
      const outer = ccw(e.outer), holes = e.holes.map(cw);
      if (outer.length < 3 || Math.abs(signedArea(outer)) < 1e-4) continue;
      let tris;
      // three's triangulator wants its own Vector2 points
      const v2 = (pts) => pts.map((q) => new Vector2(q.x, q.y));
      try { tris = ShapeUtils.triangulateShape(v2(outer), holes.map(v2)); } catch (err) { continue; }
      const all = outer.concat(...holes);
      for (const t of tris) {
        let [a, b, c] = [all[t[0]], all[t[1]], all[t[2]]];
        const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
        if (Math.abs(area) < 1e-9) continue;
        if ((area > 0) !== (dir > 0)) [b, c] = [c, b];
        for (const p of [a, b, c]) {
          const nn = capNormal(p, dir, ntag);
          push(p.x, p.y, z, nn[0], nn[1], nn[2]);
        }
      }
    }
  }

  // Shading normal for a point on a horizontal step. Steps that belong to a roundover or bevel take
  // that surface's normal; true flats (top, back, cavity floors) face straight up or down.
  // Shading normal on the bevel around the top edge: across one slice the bevel's edge moves in by `run`
  // while it rises by `dz`, so the surface there leans by that much. Null when the point is not on the bevel.
  function edgeNormal(p, e, reach = 0.05) {
    if (!e.index) e.index = new EdgeIndex(e.pts, 12);
    const q = e.index.nearest(p.x, p.y);
    if (q.i < 0) return null;
    const run = e.run[q.i], o = e.out[q.i];
    if (!(run > 1e-4) || q.d > reach + (reach > 0.05 ? run : 0)) return null;
    const l = Math.hypot(e.dz, run);
    return [(o.x / run) * (e.dz / l), (o.y / run) * (e.dz / l), run / l];
  }

  function capNormal(p, dir, ntag) {
    if (dir > 0 && ntag.edge && !(ntag.arm && arm.depth(p.x, p.y) > ntag.arm.dz - ON)) { const n = edgeNormal(p, ntag.edge, 0.3); if (n) return n; }
    if (dir > 0 && ntag.arm && arm.depth(p.x, p.y) > ntag.arm.dz - ON) return arm.normal(p.x, p.y);
    if (dir < 0 && ntag.dish && dish.depth(p.x, p.y) > ntag.dish.z - ON) return dish.normal(p.x, p.y);
    if (ntag.round && ntag.round.dir === dir) {
      const q = idx.nearest(p.x, p.y);
      if (q.d < ntag.round.inset + 0.08 && q.d > 1e-6) {
        const th = dir > 0 ? ntag.round.th0 : ntag.round.th1;
        const c = Math.cos(th), s = Math.sin(th) * dir;
        return [((q.x - p.x) / q.d) * c, ((q.y - p.y) / q.d) * c, s];
      }
      if (q.d <= 1e-6) return [0, 0, dir];
    }
    return [0, 0, dir];
  }

  return { positions: new Float32Array(pos), normals: new Float32Array(nor), T };
}

function unit(x, y, z) { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }
// Smooth the shading across neighboring wall segments, but keep a segment's own normal at sharp corners.
function blend(own, other) {
  if (own.x * other.x + own.y * other.y < 0.75) return own;
  const x = own.x + other.x, y = own.y + other.y, l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

// Volume enclosed by the mesh (divergence theorem). Used to check the mesh against the slice volume.
export function meshVolume(mesh) {
  const p = mesh.positions;
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    v += (p[i] * (p[i + 4] * p[i + 8] - p[i + 5] * p[i + 7])
      - p[i + 1] * (p[i + 3] * p[i + 8] - p[i + 5] * p[i + 6])
      + p[i + 2] * (p[i + 3] * p[i + 7] - p[i + 4] * p[i + 6])) / 6;
  }
  return v;
}
