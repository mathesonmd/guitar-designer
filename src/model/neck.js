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
//   - The neck turns into the headstock as one carved shape, not two parts stuck together. Seen from the
//     side, the line of the neck's back bends smoothly into the line of the headstock's back, starting a
//     third of the transition length behind the nut and finishing one transition length past it. Over
//     that same length past the nut the cross-section widens with the headstock's outline and squares up,
//     from the neck's round back to the headstock's flat one.
//   - The volute is extra wood on that line, highest under the nut. It rises over the volute's length
//     behind the nut and falls away over the transition length past it. "Smooth" is a rounded hump;
//     "peaked" comes to a crest across the back, under the nut.
//   - Past the transition the headstock is the plain slab.
//
// Both the 3D picture and the CAD solid are built from `sections`: cross-sections at stations along the
// neck, each a closed outline in a plane across the neck (`p3` holds its points in space).
//
// Frame: the body's own. x across (0 on the centerline), y along (toward the nut), z up from the body's
// back. The glue face sits at z = body thickness + how far the heel stands proud.
import { fretDistance } from '../core/fret.js';
import { signedArea } from '../core/poly.js';
import { flattenNodes } from '../core/path.js';

const SQUARE = 24; // fullness of the cross-section where the shaft meets the heel block: all but square

// Half the cross-section's back curve, as points from the bass edge round to the treble edge.
// |x / halfWidth|^n + |z / depth|^n = 1, a "superellipse": n = 2 is a half ellipse.
// `right` is the treble half-width when the two sides differ (a headstock need not be even).
export function backCurve(halfWidth, depth, n, count = 48, right = halfWidth) {
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const a = (Math.PI * i) / count, c = Math.cos(a), s = Math.sin(a);
    pts.push({ x: -(c >= 0 ? halfWidth : right) * Math.sign(c) * Math.abs(c) ** (2 / n), z: -depth * s ** (2 / n) });
  }
  pts[0] = { x: -halfWidth, z: 0 }; pts[count] = { x: right, z: 0 };
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
  // ---- headstock, transition and volute ----
  const h = nk.head && nk.head.on ? nk.head : null;
  const ease = (u) => { const s = Math.max(0, Math.min(1, u)); return s * s * (3 - 2 * s); };
  let head = null, zBack = null;
  if (h) {
    const ang = (Math.max(1, Math.min(25, h.angle)) * Math.PI) / 180, sin = Math.sin(ang), cos = Math.cos(ang), tan = sin / cos;
    const thick = Math.max(6, Math.min(30, h.thickness)), rise = Math.max(0, Math.min(15, h.voluteHeight)), run = Math.max(5, Math.min(120, h.voluteLength));
    const peaked = h.voluteStyle === 'peak';
    // the outline at its true shape, its ends pinned to the corners of the nut
    const nodes = h.outline.nodes.map((q) => ({ ...q })), last = nodes.length - 1;
    nodes[0] = { ...nodes[0], x: -nk.nutWidth / 2, y: 0 }; nodes[last] = { ...nodes[last], x: nk.nutWidth / 2, y: 0 };
    const poly = flattenNodes(nodes, false, 0.02);
    const length = Math.max(...poly.map((p) => p.y));
    // the transition length, measured along the headstock's face from the nut
    const reach = Math.max(20, Math.min(h.transition, 80, length * 0.6));
    const behind = reach / 3;                       // the back starts to turn this far behind the nut
    const ahead = Math.max(5, reach * cos - thick * sin); // and has become the headstock's back this far past it
    // a point of the headstock: x across, v along its face from the nut, w down into it from its face
    const place = (x, v, w) => ({ x, y: g.nutY + v * cos - w * sin, z: top - v * sin - w * cos });
    // the side view of the back, as a height at each place along the neck
    const hill = (y) => {
      if (y <= g.nutY) { const u = Math.max(0, (y - (g.nutY - run)) / run); return peaked ? u * u : ease(u); }
      const u = Math.max(0, 1 - (y - g.nutY) / ahead); return peaked ? u * u : ease(u);
    };
    zBack = (y) => {
      const zn = top - shaftDepth(Math.min(y, g.nutY)), zh = top - (y - g.nutY) * tan - thick / cos;
      return zn + ease((y - (g.nutY - behind)) / (behind + ahead)) * (zh - zn) - rise * hill(y);
    };
    // the outline's reach to the bass and treble sides at a place along the face
    const widths = (v) => {
      if (v <= 1e-9) return { l: nk.nutWidth / 2, r: nk.nutWidth / 2 };
      let x0 = Infinity, x1 = -Infinity;
      for (let i = 0, m = poly.length; i < m; i++) {
        const p = poly[i], q = poly[(i + 1) % m];
        if ((p.y - v) * (q.y - v) > 0 || p.y === q.y) continue;
        const x = p.x + ((q.x - p.x) * (v - p.y)) / (q.y - p.y);
        if (x < x0) x0 = x; if (x > x1) x1 = x;
      }
      return x1 > x0 ? { l: Math.max(1, -x0), r: Math.max(1, x1) } : { l: nk.nutWidth / 2, r: nk.nutWidth / 2 };
    };
    // Cross-sections past the nut. Each lies in a plane across the neck that leans back a little more than
    // the one before, from upright at the nut to square with the headstock's face; all the leaning planes
    // pass through one line well below the neck, so no two of them cross inside the wood.
    const HINGE = 45, fan = HINGE * sin;
    const station = (v, like) => {
      const th = v >= fan ? ang : Math.atan2(v * cos, HINGE - v * sin), st = Math.sin(th), ct = Math.cos(th);
      const oy = g.nutY + v * cos, oz = top - v * sin;
      const src = like == null ? v : like; // the tail repeats the last section's shape a little farther on
      let depth;
      if (src >= reach) depth = thick;
      else {
        let lo = 0, hi = 90; // where this plane's centerline meets the back
        for (let k = 0; k < 50; k++) { const t = (lo + hi) / 2; if (oz - t * ct > zBack(oy - t * st)) lo = t; else hi = t; }
        depth = (lo + hi) / 2;
      }
      const w = widths(src), n = fullness * (SQUARE / fullness) ** ease(src / reach);
      const pts = backCurve(w.l, depth, n, 48, w.r);
      return { v, y: oy, half: (w.l + w.r) / 2, left: w.l, right: w.r, depth, n, pts, p3: pts.map((p) => [p.x, oy + p.z * st, oz + p.z * ct]) };
    };
    // evenly spaced: uneven spacing makes the smooth CAD surface wander between sections
    const count = Math.max(8, Math.round(reach / 2.5)), vs = [];
    for (let k = 0; k < count; k++) vs.push((reach * k) / count);
    vs.push(reach);
    const sections = vs.map((v) => station(v));
    // the slab: the outline from the end of the transition on
    const slab = [];
    for (let i = 0, m = poly.length; i < m; i++) {
      const p = poly[i], q = poly[(i + 1) % m], pin = p.y >= reach, qin = q.y >= reach;
      if (pin) slab.push(p);
      if (pin !== qin) slab.push({ x: p.x + ((q.x - p.x) * (reach - p.y)) / (q.y - p.y), y: reach });
    }
    head = { ang, sin, cos, tan, thick, rise, run, peaked, reach, behind, ahead, backZ: zBack, widths, at: (v) => station(v), nodes, poly, slab, length, place, sections, tail: station(reach + 5, reach), faceZ: (y) => top - (y - g.nutY) * tan };
  }
  const at = (y) => {
    const s = toHeel(y), base = head ? top - zBack(y) : shaftDepth(y), depth = base + (heelDepth - base) * s;
    // fullness climbs steeply at the end, so the neck is round for most of the blend and squares up at the heel
    const n = fullness + (SQUARE - fullness) * s ** 3;
    const half = halfAt(y);
    const pts = backCurve(half, depth, n);
    return { y, half, depth, n, pts, p3: pts.map((p) => [p.x, y, top + p.z]) };
  };
  // (the last station sits a little way inside the heel block, so the two parts of the CAD solid overlap)
  // stations: closer together through the blend, where the shape changes fastest
  const ys = [];
  if (head) {
    const from = g.nutY - Math.max(head.run, head.behind);
    for (let k = 0; k < 16; k++) ys.push(g.nutY - ((g.nutY - from) * k) / 16); // the volute and the turn, in small steps
    for (let y = from; y > shaftEnd + blend + 1e-6; y -= 20) ys.push(y);
  } else for (let y = g.nutY; y > shaftEnd + blend + 1e-6; y -= 20) ys.push(y);
  for (let i = 0; i <= 14; i++) ys.push(shaftEnd + blend - (blend * i) / 14);
  const sections = ys.map(at);
  const tail = { ...at(shaftEnd), y: shaftEnd - 5 }; tail.p3 = tail.p3.map((q) => [q[0], shaftEnd - 5, q[2]]);
  // the heel block: the pocket's own outline from its end wall up to where the shaft meets it
  const heel = g.pocketTo(shaftEnd);
  // volume: the shaft by its cross-sections, plus the heel block, plus the headstock (the transition as
  // the closed shape its cross-sections make when joined by straight lines, and the slab past it)
  const measure = () => {
    let shaft = 0;
    for (let i = 0; i < sections.length - 1; i++) {
      const a = sectionArea(sections[i].pts), c = sectionArea(sections[i + 1].pts);
      shaft += ((a + c + Math.sqrt(a * c)) / 3) * (sections[i].y - sections[i + 1].y);
    }
    let headVolume = 0;
    if (head) {
      const S = head.sections, m = S[0].p3.length, o = S[0].p3[0];
      let six = 0;
      const tri = (a, b, c) => {
        const ax = a[0] - o[0], ay = a[1] - o[1], az = a[2] - o[2], bx = b[0] - o[0], by = b[1] - o[1], bz = b[2] - o[2], cx = c[0] - o[0], cy = c[1] - o[1], cz = c[2] - o[2];
        six += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
      };
      for (let i = 0; i < S.length - 1; i++) {
        const a = S[i].p3, b = S[i + 1].p3;
        for (let j = 0; j < m; j++) { const k = (j + 1) % m; tri(a[j], b[j], b[k]); tri(a[j], b[k], a[k]); } // k wraps: the flat top closes it
      }
      const first = S[0].p3, end = S[S.length - 1].p3;
      for (let j = 1; j < m - 1; j++) { tri(first[0], first[j], first[j + 1]); tri(end[0], end[j + 1], end[j]); }
      headVolume = Math.abs(six) / 6 + Math.abs(signedArea(head.slab)) * head.thick;
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
