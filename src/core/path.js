// Editable outline model: a closed chain of cubic Bezier segments.
// node = { x, y, ix, iy, ox, oy, k }  -- (ix,iy) and (ox,oy) are handle offsets relative to the node;
// k is 's' (smooth: handles stay in line) or 'c' (corner: handles move independently).
import { flattenCubic, splitCubic, nearestOnCubic } from './bezier.js';
import { signedArea, dedupe } from './poly.js';

export const node = (x, y, ix = 0, iy = 0, ox = 0, oy = 0, k = 's') => ({ x, y, ix, iy, ox, oy, k });
export const cloneNodes = (nodes) => nodes.map((n) => ({ ...n }));

// Mirror a node across the centerline (x = 0); in and out handles swap because direction reverses.
const mirrorNode = (n) => ({ x: -n.x, y: n.y, ix: -n.ox, iy: n.oy, ox: -n.ix, oy: n.iy, k: n.k, ...(n.bw !== undefined ? { bw: n.bw } : {}) });

// outline = { symmetric, nodes }. When symmetric, `nodes` holds the left half only, running from the
// top centerline node to the bottom centerline node; the right half is generated.
export function expandOutline(outline) {
  const nodes = outline.nodes;
  if (!outline.symmetric || nodes.length < 2) return cloneNodes(nodes);
  const m = nodes.length - 1;
  const out = [];
  for (let i = 0; i <= m; i++) {
    const n = { ...nodes[i] };
    if (i === 0 || i === m) {
      n.x = 0;
      // the handle that points into the mirrored half is the mirror image of the one we own
      if (i === 0) { n.ix = -n.ox; n.iy = n.oy; } else { n.ox = -n.ix; n.oy = n.iy; }
    }
    out.push(n);
  }
  for (let i = m - 1; i >= 1; i--) out.push(mirrorNode(nodes[i]));
  return out;
}

export function segmentsOf(nodes, closed = true) {
  const segs = [];
  const n = nodes.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = nodes[i], b = nodes[(i + 1) % n];
    segs.push({
      i,
      p0: { x: a.x, y: a.y },
      p1: { x: a.x + a.ox, y: a.y + a.oy },
      p2: { x: b.x + b.ix, y: b.y + b.iy },
      p3: { x: b.x, y: b.y },
    });
  }
  return segs;
}

export function flattenNodes(nodes, closed = true, tol = 0.01) {
  if (!nodes.length) return [];
  const pts = [{ x: nodes[0].x, y: nodes[0].y }];
  for (const s of segmentsOf(nodes, closed)) flattenCubic(s.p0, s.p1, s.p2, s.p3, tol, pts);
  return closed ? dedupe(pts) : pts;
}

// Full outline as a counter-clockwise polygon.
export function outlinePolygon(outline, tol = 0.01) {
  const p = flattenNodes(expandOutline(outline), true, tol);
  return signedArea(p) < 0 ? p.reverse() : p;
}

// SVG path data for a node chain (y is used as-is; flip in the view transform).
export function nodesToSvgPath(nodes, closed = true) {
  if (!nodes.length) return '';
  const f = (v) => +v.toFixed(4);
  let d = `M${f(nodes[0].x)} ${f(nodes[0].y)}`;
  for (const s of segmentsOf(nodes, closed)) d += `C${f(s.p1.x)} ${f(s.p1.y)} ${f(s.p2.x)} ${f(s.p2.y)} ${f(s.p3.x)} ${f(s.p3.y)}`;
  return closed ? d + 'Z' : d;
}

// Find the closest spot on the outline to point q. Returns { seg, t, x, y, d }.
export function nearestOnNodes(nodes, q, closed = true) {
  let best = { d: Infinity };
  for (const s of segmentsOf(nodes, closed)) {
    const r = nearestOnCubic(s.p0, s.p1, s.p2, s.p3, q);
    if (r.d < best.d) best = { seg: s.i, t: r.t, x: r.x, y: r.y, d: r.d };
  }
  return best;
}

// Insert a node on segment `seg` at parameter t without changing the curve's shape.
export function insertNode(nodes, seg, t, closed = true) {
  const out = cloneNodes(nodes);
  const n = out.length;
  const a = out[seg], b = out[(seg + 1) % n];
  const [L, R] = splitCubic(
    { x: a.x, y: a.y }, { x: a.x + a.ox, y: a.y + a.oy },
    { x: b.x + b.ix, y: b.y + b.iy }, { x: b.x, y: b.y }, t);
  a.ox = L[1].x - a.x; a.oy = L[1].y - a.y;
  b.ix = R[2].x - b.x; b.iy = R[2].y - b.y;
  const m = { x: L[3].x, y: L[3].y, ix: L[2].x - L[3].x, iy: L[2].y - L[3].y, ox: R[1].x - R[0].x, oy: R[1].y - R[0].y, k: 's' };
  out.splice(seg + 1, 0, m);
  return { nodes: out, index: seg + 1 };
}

export function removeNode(nodes, index, minNodes = 3) {
  if (nodes.length <= minNodes) return nodes;
  const out = cloneNodes(nodes);
  out.splice(index, 1);
  return out;
}

// Move one handle; for smooth nodes the opposite handle is rotated to stay in line (its length is kept).
export function setHandle(n, which, dx, dy) {
  const o = { ...n };
  if (which === 'out') { o.ox = dx; o.oy = dy; } else { o.ix = dx; o.iy = dy; }
  if (o.k === 's') {
    const l = Math.hypot(dx, dy);
    if (l > 1e-9) {
      if (which === 'out') { const m = Math.hypot(n.ix, n.iy); o.ix = (-dx / l) * m; o.iy = (-dy / l) * m; }
      else { const m = Math.hypot(n.ox, n.oy); o.ox = (-dx / l) * m; o.oy = (-dy / l) * m; }
    }
  }
  return o;
}

// Switch a node between smooth and corner. Becoming smooth lines the handles up along their average direction.
export function setKind(n, k) {
  const o = { ...n, k };
  if (k === 's') {
    const li = Math.hypot(n.ix, n.iy), lo = Math.hypot(n.ox, n.oy);
    if (li > 1e-9 && lo > 1e-9) {
      let dx = n.ox / lo - n.ix / li, dy = n.oy / lo - n.iy / li;
      const l = Math.hypot(dx, dy);
      if (l > 1e-9) { dx /= l; dy /= l; o.ox = dx * lo; o.oy = dy * lo; o.ix = -dx * li; o.iy = -dy * li; }
    }
  }
  return o;
}

// Turn a full outline into a symmetric one (keeps the left half) or back into a free outline.
export function setSymmetric(outline, on) {
  if (on === !!outline.symmetric) return outline;
  if (!on) return { symmetric: false, nodes: expandOutline(outline) };
  // Keep the half with x <= 0: cut the full outline at the centerline top and bottom.
  const full = cloneNodes(outline.nodes);
  const poly = flattenNodes(full, true, 0.05);
  const ccw = signedArea(poly) >= 0;
  let nodes = ccw ? full : reverseNodes(full);
  // crossing points with x = 0 (top = largest y, bottom = smallest y)
  const hits = [];
  const EPS = 1e-7;
  const addHit = (seg, t, y) => {
    if (!hits.some((h) => Math.abs(h.y - y) < 1e-5)) hits.push({ seg, t, y });
  };
  for (const s of segmentsOf(nodes, true)) {
    for (let j = 0; j < 64; j++) {
      const t0 = j / 64, t1 = (j + 1) / 64;
      const a = bez(s, t0), b = bez(s, t1);
      if (Math.abs(a.x) < EPS) { addHit(s.i, t0, a.y); continue; }
      if (Math.abs(b.x) < EPS) { addHit(s.i, t1, b.y); continue; }
      if (a.x * b.x < 0) {
        let lo = t0, hi = t1;
        for (let k = 0; k < 50; k++) {
          const mid = (lo + hi) / 2;
          if (bez(s, mid).x * a.x > 0) lo = mid; else hi = mid;
        }
        const t = (lo + hi) / 2;
        addHit(s.i, t, bez(s, t).y);
      }
    }
  }
  if (hits.length < 2) return { symmetric: false, nodes: full };
  hits.sort((a, b) => b.y - a.y);
  const top = hits[0], bottom = hits[hits.length - 1];
  // insert the later one first so indices stay valid; a hit that lands on an existing node reuses it
  const order = [top, bottom].sort((a, b) => (b.seg - a.seg) || (b.t - a.t));
  let res = nodes, idx = {};
  for (const h of order) {
    const key = h === top ? 'top' : 'bottom';
    if (h.t < 1e-6) { idx[key] = h.seg; continue; }
    if (h.t > 1 - 1e-6) { idx[key] = (h.seg + 1) % res.length; continue; }
    const r = insertNode(res, h.seg, h.t, true);
    res = r.nodes;
    for (const other of Object.keys(idx)) if (idx[other] >= r.index) idx[other]++;
    idx[key] = r.index;
  }
  // walk counter-clockwise from top: with CCW orientation and +y up, that runs down the left side (x < 0)
  const half = [];
  const n = res.length;
  for (let i = idx.top; ; i = (i + 1) % n) {
    half.push({ ...res[i] });
    if (i === idx.bottom) break;
  }
  half[0].x = 0; half[half.length - 1].x = 0;
  if (half[0].k === 's') half[0].oy = 0;
  if (half[half.length - 1].k === 's') half[half.length - 1].iy = 0;
  return { symmetric: true, nodes: half };
}

const bez = (s, t) => {
  const u = 1 - t;
  return {
    x: u * u * u * s.p0.x + 3 * u * u * t * s.p1.x + 3 * u * t * t * s.p2.x + t * t * t * s.p3.x,
    y: u * u * u * s.p0.y + 3 * u * u * t * s.p1.y + 3 * u * t * t * s.p2.y + t * t * t * s.p3.y,
  };
};

export function reverseNodes(nodes) {
  return nodes.slice().reverse().map((n) => ({ x: n.x, y: n.y, ix: n.ox, iy: n.oy, ox: n.ix, oy: n.iy, k: n.k }));
}

export function transformNodes(nodes, sx, sy, dx, dy) {
  return nodes.map((n) => ({
    x: n.x * sx + dx, y: n.y * sy + dy, ix: n.ix * sx, iy: n.iy * sy, ox: n.ox * sx, oy: n.oy * sy, k: n.k,
  }));
}

// Build nodes from fitted cubic segments ([[p0,p1,p2,p3], ...] forming a closed loop).
export function nodesFromSegments(segs, cornerFlags = []) {
  const n = segs.length;
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const cur = segs[i], prev = segs[(i - 1 + n) % n];
    nodes.push({
      x: cur[0].x, y: cur[0].y,
      ix: prev[2].x - prev[3].x, iy: prev[2].y - prev[3].y,
      ox: cur[1].x - cur[0].x, oy: cur[1].y - cur[0].y,
      k: cornerFlags[i] ? 'c' : 's',
    });
  }
  return nodes;
}

// For a closed chain of nodes, the index in the stored outline that each node of the expanded outline
// came from (a mirrored outline stores only its left half).
export function storedIndex(outline, i) {
  if (!outline.symmetric || outline.nodes.length < 2) return i;
  const m = outline.nodes.length - 1;
  return i <= m ? i : 2 * m - i;
}

// The unit normal pointing into the shape at each node of a closed chain. At a smooth node it is square
// to the curve; at a corner it splits the angle.
export function inwardNormals(nodes) {
  const n = nodes.length, ccw = signedArea(nodes) > 0 ? 1 : -1;
  return nodes.map((p, i) => {
    const prev = nodes[(i - 1 + n) % n], next = nodes[(i + 1) % n];
    const dir = (ax, ay) => { const l = Math.hypot(ax, ay); return l > 1e-9 ? [ax / l, ay / l] : null; };
    // which way the curve arrives at the node and which way it leaves
    const din = dir(-p.ix, -p.iy) || dir(p.x - (prev.x + prev.ox), p.y - (prev.y + prev.oy)) || dir(p.x - prev.x, p.y - prev.y) || [1, 0];
    const dout = dir(p.ox, p.oy) || dir(next.x + next.ix - p.x, next.y + next.iy - p.y) || dir(next.x - p.x, next.y - p.y) || din;
    const t = dir(din[0] + dout[0], din[1] + dout[1]) || dout;
    // `open` is 1 at a smooth point and smaller the sharper a corner is: the cosine of half the turn
    return { x: -t[1] * ccw, y: t[0] * ccw, open: Math.sqrt(Math.max(0, (1 + din[0] * dout[0] + din[1] * dout[1]) / 2)) };
  });
}

// An inner line for a bevel around the edge: every node of the closed chain moved into the shape by its
// own width (widths[i]). Returns a chain with the same number of nodes in the same order, so segment i
// of the outline pairs with segment i of the inner line. Handles are scaled by how much shorter or
// longer each inner segment is than its outer one.
export function insetNodes(nodes, widths) {
  const n = nodes.length, nrm = inwardNormals(nodes);
  const moved = nodes.map((p, i) => { const w = Math.max(0, widths[i]); return { x: p.x + nrm[i].x * w, y: p.y + nrm[i].y * w }; });
  const ratio = (i, j) => { const outer = Math.hypot(nodes[j].x - nodes[i].x, nodes[j].y - nodes[i].y); return outer > 1e-9 ? Math.hypot(moved[j].x - moved[i].x, moved[j].y - moved[i].y) / outer : 1; };
  return nodes.map((p, i) => {
    const rin = ratio((i - 1 + n) % n, i), rout = ratio(i, (i + 1) % n);
    return { x: moved[i].x, y: moved[i].y, ix: p.ix * rin, iy: p.iy * rin, ox: p.ox * rout, oy: p.oy * rout, k: p.k };
  });
}
