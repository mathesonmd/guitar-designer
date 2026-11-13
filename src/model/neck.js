// The neck as a solid: the shaft, the heel and (when it is on) an angled headstock with a volute. No fretboard.
//
// What it is, plainly:
//   - Its top is flat. That face is where the fretboard is glued on. The fretboard, its radius and the
//     frets are not part of this shape (the Fretboard Designer makes those).
//   - Seen from above it tapers in a straight line from the nut width to the pocket's width where the neck
//     enters the body, so it fills the pocket; from there the heel is the pocket's own outline.
//   - Its back is a curve across the neck. Thickness figures for necks include the fretboard, so the
//     wood here is that much thinner: depth of the back = thickness - fretboard thickness.
//   - Thickness is held at the 1st-fret figure from the nut to the 1st fret, runs straight to the
//     12th-fret figure, and is held from there on.
//   - Toward the body the round back turns, over the blend length, into a square block: the heel, as
//     deep as the pocket plus the amount the heel stands above the body. The heel block itself has the
//     pocket's own outline, corner radii included, so it fills the pocket.
//
//   - The headstock is a flat slab, tilted back from the nut by its angle. Its outline is drawn flat, at
//     its true shape, and its two ends are pinned to the corners of the nut. Its face meets the neck's
//     top along the nut line.
//   - The volute: behind the nut the neck's back swells out by the volute's height over the volute's
//     length, and carries on past the nut at that depth until it has sunk into the back of the headstock.
//     Past the nut, everything above the headstock's face is cut away.
//
// Both the 3D picture and the CAD solid are built from `sections`: cross-sections at stations along the
// neck, each a closed outline in the plane across the neck.
//
// Frame: the body's own. x across (0 on the centerline), y along (toward the nut), z up from the body's
// back. The glue face sits at z = body thickness + how far the heel stands proud.
import { fretDistance } from '../core/fret.js';
import { signedArea } from '../core/poly.js';
import { flattenNodes } from '../core/path.js';
import { union, regionArea } from '../core/clip.js';

const SQUARE = 24; // fullness of the cross-section where the shaft meets the heel block: all but square

// Half the cross-section's back curve, as points from the bass edge round to the treble edge.
// |x / halfWidth|^n + |z / depth|^n = 1, a "superellipse": n = 2 is a half ellipse.
export function backCurve(halfWidth, depth, n, count = 48) {
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const a = (Math.PI * i) / count, c = Math.cos(a), s = Math.sin(a);
    pts.push({ x: -halfWidth * Math.sign(c) * Math.abs(c) ** (2 / n), z: -depth * s ** (2 / n) });
  }
  pts[0] = { x: -halfWidth, z: 0 }; pts[count] = { x: halfWidth, z: 0 };
  return pts;
}

// Area of that cross-section (the back curve closed by the flat top).
const sectionArea = (pts) => Math.abs(signedArea(pts.map((p) => ({ x: p.x, y: p.z }))));

// Returns null when the design has no neck shape. Otherwise:
//   { top, heelBottom, heelDepth, shaftEnd, sections: [{ y, half, depth, n, pts }], heel: polygon, volume, ... }
export function buildNeck(design, g) {
  const nk = design.neck, b = nk.back;
  if (!b) return null;
  const T = design.body.thickness;
  const top = T + nk.heelStandProud, heelDepth = nk.pocketDepth + nk.heelStandProud;
  const board = Math.max(0, b.board), fullness = Math.max(1.2, Math.min(6, b.fullness));
  const d1 = Math.max(3, b.t1 - board), d12 = Math.max(3, b.t12 - board);
  const y1 = g.nutY - fretDistance(nk.scale, 1), y12 = g.nutY - fretDistance(nk.scale, 12);
  const shaftEnd = g.heelY + nk.pocketLength; // where the neck leaves the pocket: the heel block starts here
  const blend = Math.max(5, Math.min(b.blend, g.nutY - shaftEnd - 10));
  const shaftDepth = (y) => (y >= y1 ? d1 : y <= y12 ? d12 : d1 + ((d12 - d1) * (y1 - y)) / (y1 - y12));
  // 0 on the shaft, rising smoothly to 1 where the neck meets the heel block
  // width: straight from the nut width to the pocket's width at the point where the neck enters the body
  const mouthHalf = g.pocketHalf(shaftEnd);
  const halfAt = (y) => (y <= shaftEnd ? mouthHalf : nk.nutWidth / 2 + ((mouthHalf - nk.nutWidth / 2) * (g.nutY - y)) / (g.nutY - shaftEnd));
  const toHeel = (y) => { const s = Math.max(0, Math.min(1, (shaftEnd + blend - y) / blend)); return s * s * (3 - 2 * s); };
  // ---- headstock and volute ----
  const h = nk.head && nk.head.on ? nk.head : null;
  let head = null;
  if (h) {
    const ang = (Math.max(1, Math.min(25, h.angle)) * Math.PI) / 180, sin = Math.sin(ang), cos = Math.cos(ang), tan = sin / cos;
    const thick = Math.max(6, Math.min(30, h.thickness)), rise = Math.max(0, Math.min(15, h.voluteHeight)), run = Math.max(5, Math.min(120, h.voluteLength));
    // the outline at its true shape, its ends pinned to the corners of the nut
    const nodes = h.outline.nodes.map((q) => ({ ...q })), last = nodes.length - 1;
    nodes[0] = { ...nodes[0], x: -nk.nutWidth / 2, y: 0 }; nodes[last] = { ...nodes[last], x: nk.nutWidth / 2, y: 0 };
    const poly = flattenNodes(nodes, false, 0.02);
    const length = Math.max(...poly.map((p) => p.y));
    // how far past the nut the neck's back carries on before it is wholly inside the headstock
    const past = Math.max(8, Math.min(70, (d1 + rise - thick / cos) / tan + 8));
    // a point of the headstock: x across, v along its face from the nut, w down into it from its face
    const place = (x, v, w) => ({ x, y: g.nutY + v * cos - w * sin, z: top - v * sin - w * cos });
    head = { ang, sin, cos, tan, thick, rise, run, nodes, poly, length, past, place, faceZ: (y) => top - (y - g.nutY) * tan };
  }
  const swell = (y) => { if (!head) return 0; const s = Math.max(0, Math.min(1, (y - (g.nutY - head.run)) / head.run)); return head.rise * s * s * (3 - 2 * s); };
  const at = (y) => {
    if (head && y > g.nutY) {
      // past the nut: the back at the volute's depth, the width of the nut; `cut` is the same outline with
      // everything above the headstock's face taken off
      const depth = d1 + head.rise, pts = backCurve(nk.nutWidth / 2, depth, fullness), lid = head.faceZ(y) - top;
      return { y, half: nk.nutWidth / 2, depth, n: fullness, pts, cut: pts.map((p) => ({ x: p.x, z: Math.min(p.z, lid) })) };
    }
    const s = toHeel(y), base = shaftDepth(y) + swell(y), depth = base + (heelDepth - base) * s;
    // fullness climbs steeply at the end, so the neck is round for most of the blend and squares up at the heel
    const n = fullness + (SQUARE - fullness) * s ** 3;
    const half = halfAt(y);
    const pts = backCurve(half, depth, n);
    return { y, half, depth, n, pts, cut: pts };
  };
  // (the last station sits a little way inside the heel block, so the two parts of the CAD solid overlap)
  // stations: closer together through the blend, where the shape changes fastest
  const ys = [];
  if (head) {
    for (let k = 6; k >= 1; k--) ys.push(g.nutY + (head.past * k) / 6);          // past the nut, under the headstock
    for (let y = g.nutY; y > g.nutY - head.run - 1e-6; y -= head.run / 8) ys.push(y); // the volute, in small steps
    for (let y = g.nutY - head.run - 20; y > shaftEnd + blend + 1e-6; y -= 20) ys.push(y);
  } else for (let y = g.nutY; y > shaftEnd + blend + 1e-6; y -= 20) ys.push(y);
  for (let i = 0; i <= 14; i++) ys.push(shaftEnd + blend - (blend * i) / 14);
  const sections = ys.map(at);
  const tail = { ...at(shaftEnd), y: shaftEnd - 5 };
  // the heel block: the pocket's own outline from its end wall up to where the shaft meets it
  const heel = g.pocketTo(shaftEnd);
  // volume: the shaft by its cross-sections, plus the heel block, plus the headstock. Where the headstock
  // and the neck's back overlap, each slice across the neck is the two outlines merged, so nothing counts twice.
  const areaOf = (pts) => sectionArea(pts);
  const measure = () => {
    let shaft = 0;
    const from = head ? g.nutY - head.thick * head.sin - 1 : g.nutY; // sections above this are measured with the headstock
    const run = sections.filter((q) => q.y <= from + 1e-9);
    if (head) run.unshift(at(from));
    for (let i = 0; i < run.length - 1; i++) {
      const a = areaOf(run[i].cut), c = areaOf(run[i + 1].cut);
      shaft += ((a + c + Math.sqrt(a * c)) / 3) * (run[i].y - run[i + 1].y);
    }
    let headVolume = 0;
    if (head) {
      const yEnd = g.nutY + head.length * head.cos + 1, step = 1;
      // the headstock's slice at height y: for each depth w into it, the outline's width at that place along the face
      const slab = (y) => {
        const L = [], R = [];
        for (let k = 0; k <= 12; k++) {
          const w = (head.thick * k) / 12, v = (y - g.nutY + w * head.sin) / head.cos;
          if (v < 0 || v > head.length) continue;
          let x0 = Infinity, x1 = -Infinity;
          for (let i = 0, m = head.poly.length; i < m; i++) {
            const p = head.poly[i], q = head.poly[(i + 1) % m];
            if ((p.y - v) * (q.y - v) > 0 || p.y === q.y) continue;
            const x = p.x + ((q.x - p.x) * (v - p.y)) / (q.y - p.y);
            if (x < x0) x0 = x; if (x > x1) x1 = x;
          }
          if (!(x1 > x0)) continue;
          const z = -v * head.sin - w * head.cos; // relative to the neck's top, like the sections
          L.push({ x: x0, y: z }); R.push({ x: x1, y: z });
        }
        return L.length > 1 ? [...L, ...R.reverse()] : null;
      };
      const slice = (y) => {
        const polys = [], sl = slab(y);
        if (sl) polys.push(sl);
        if (y <= g.nutY + head.past) polys.push(at(y).cut.map((p) => ({ x: p.x, y: p.z })));
        return polys.length ? regionArea(union(polys, [])) : 0;
      };
      let prev = slice(from);
      for (let y = from + step; y <= yEnd + 1e-9; y += step) { const cur = slice(y); headVolume += ((prev + cur) / 2) * step; prev = cur; }
    }
    const heelVolume = Math.abs(signedArea(heel)) * heelDepth;
    return { volume: shaft + heelVolume + headVolume, shaftVolume: shaft, heelVolume, headVolume };
  };
  let measured = null;
  return {
    top, heelBottom: top - heelDepth, heelDepth, shaftEnd, blend, board, fullness, d1, d12, y1, y12, at, sections, tail, heel, halfAt, head,
    length: g.nutY - g.heelY, nutY: g.nutY,
    // worked out only when asked for: it takes a moment, and the drawing does not need it
    get volume() { if (!measured) measured = measure(); return measured.volume; },
    get parts() { if (!measured) measured = measure(); return measured; },
  };
}
