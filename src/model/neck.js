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
//   - The back of the neck and the back of the headstock are one continuous surface, with no joins.
//     Seen from the side, the line of the neck's back bends smoothly into the line of the headstock's
//     back, starting a third of the transition length behind the nut and finishing one transition length
//     past it. Over that length past the nut the cross-section widens and flattens, from the neck's
//     round back to the headstock's flat one.
//   - The headstock's edges are square to its face, as if sawn to the outline before the back was
//     carved: at the nut the edge is thin, and it reaches full thickness as the carve runs out.
//   - The volute is a mound on the crown of the back, highest on the centerline under the nut. It dies
//     away to nothing at the neck's edges and along a rounded line toward the heel and toward the
//     headstock, each side with its own length. "Smooth" is rounded over the top; "peaked" comes to a point.
//
// Both the 3D picture and the CAD solid are built from `sections`: cross-sections at stations along the
// neck, each a closed outline in a plane across the neck (`p3` holds its points in space).
//
// Frame: the body's own. x across (0 on the centerline), y along (toward the nut), z up from the body's
// back. The glue face sits at z = body thickness + how far the heel stands proud.
import { fretDistance } from '../core/fret.js';
import { signedArea } from '../core/poly.js';
import { flattenNodes } from '../core/path.js';

// The CAD surface joins each cross-section to the next with straight lines, so where the shape is changing
// the sections sit this close together. At 1 mm the straight lines stay within about 0.01 mm of the true
// curve. (A single smooth surface through the sections was tried: on some settings the engine made it ripple.)
const STRIP = 1;
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

// A cross-section ready to build from: its two top corners, and between them the back as 49 points
// spaced evenly along it (24 steps from each side to the crown), with the direction the curve is heading
// at each. Even spacing matters when the section is nearly square: points spread by angle bunch in the
// corners and leave the flat between them to sag in the CAD surface.
//   shift(p)    moves each point of a fine tracing before the 49 are picked (the volute)
//   to3(p)      places a point in space
//   limit(q, s) for a point in space on side s (-1 bass, +1 treble): how far out the section may reach
//               there (the headstock's outline); left out, the section is not trimmed
// Each side begins with a straight edge from the top corner down to where the back starts: the
// headstock's sawn edge where the section is trimmed, and a bare EDGE of the curve itself where it is not,
// so that every section is made of the same pieces.
const EDGE = 0.05;
function sampled(left, depth, n, right, shift, to3, limit) {
  const FINE = 300, c = 2 ** (-1 / n); // the curve is traced by x across its crown and by z down its sides
  const half = (w, sign) => {
    const run = [];
    for (let i = 0; i <= FINE; i++) { const x = (c * i) / FINE; run.push({ x: sign * w * x, z: -depth * (1 - x ** n) ** (1 / n) }); }
    for (let i = 1; i <= FINE; i++) { const z = c * (1 - i / FINE); run.push({ x: sign * w * (1 - z ** n) ** (1 / n), z: -depth * z }); }
    if (shift) for (const p of run) shift(p);
    // crown to edge; now cut it short where the edge begins
    let q = run.map(to3), end = run.length - 1, corner = run[end];
    const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const cutAt = (i, t) => { // keep up to a point part way along the step from i to i + 1
      const p = { x: run[i].x + (run[i + 1].x - run[i].x) * t, z: run[i].z + (run[i + 1].z - run[i].z) * t };
      run.length = i + 1; run.push(p); q = run.map(to3);
    };
    if (limit) {
      const over = (i) => sign * q[i][0] - limit(q[i], sign);
      for (let i = 0; i < end; i++) if (over(i + 1) > 0) { const a = over(i), b = over(i + 1); cutAt(i, a >= 0 ? 0 : -a / (b - a)); break; }
      end = run.length - 1;
      if (run.length <= FINE * 2) corner = { x: sign * limit(to3({ x: run[end].x, z: 0 }), sign), z: 0 };
    }
    let back = 0;
    for (let i = end; i > 0; i--) { const d = dist(q[i], q[i - 1]); if (back + d >= EDGE) { if (run.length > i + 1 || !limit || run.length > FINE * 2) cutAt(i - 1, 1 - (EDGE - back) / d); break; } back += d; }
    const len = [0];
    for (let i = 1; i < q.length; i++) len.push(len[i - 1] + dist(q[i], q[i - 1]));
    const out = [];
    for (let k = 0, i = 0; k <= 24; k++) {
      const want = (len[len.length - 1] * k) / 24;
      while (i < q.length - 2 && len[i + 1] < want) i++;
      const t = Math.max(0, Math.min(1, (want - len[i]) / (len[i + 1] - len[i] || 1))), a = q[i], b = q[i + 1], l = dist(a, b) || 1;
      out.push({ p: { x: run[i].x + (run[i + 1].x - run[i].x) * t, z: run[i].z + (run[i + 1].z - run[i].z) * t }, p3: a.map((v, j) => v + (b[j] - v) * t), dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l] });
    }
    return { out, corner }; // crown to edge, each with the direction of travel toward the edge
  };
  const L = half(left, -1), R = half(right, 1);
  // bass side, round to the crown, round to the treble side; directions all run bass to treble
  const mid = L.out[0].dir.map((v, j) => R.out[0].dir[j] - v), ml = Math.hypot(...mid) || 1;
  const all = [...L.out.slice(1).reverse().map((q) => ({ ...q, dir: q.dir.map((v) => -v) })), { ...R.out[0], dir: mid.map((v) => v / ml) }, ...R.out.slice(1)];
  const pts = [L.corner, ...all.map((q) => q.p), R.corner];
  return { pts, p3: [to3(L.corner), ...all.map((q) => q.p3), to3(R.corner)], dirs: all.map((q) => q.dir) };
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
    // the volute's length on the headstock side of the nut (it has to be gone by the end of the transition)
    const fallAsked = Math.max(5, Math.min(120, h.voluteAhead));
    const peaked = h.voluteStyle === 'peak';
    // the outline at its true shape, its ends pinned to the corners of the nut
    const nodes = h.outline.nodes.map((q) => ({ ...q })), last = nodes.length - 1;
    nodes[0] = { ...nodes[0], x: -nk.nutWidth / 2, y: 0 }; nodes[last] = { ...nodes[last], x: nk.nutWidth / 2, y: 0 };
    const poly = flattenNodes(nodes, false, 0.02);
    const length = Math.max(...poly.map((p) => p.y));
    // the transition length, measured along the headstock's face from the nut
    const reach = Math.max(20, Math.min(h.transition, 80, length * 0.6));
    const fall = Math.min(fallAsked, reach - 2);
    const behind = reach / 3;                       // the back starts to turn this far behind the nut
    const ahead = Math.max(5, reach * cos - thick * sin); // and has become the headstock's back this far past it
    // a point of the headstock: x across, v along its face from the nut, w down into it from its face
    const place = (x, v, w) => ({ x, y: g.nutY + v * cos - w * sin, z: top - v * sin - w * cos });
    // the side view of the back without the volute, as a height at each place along the neck
    zBack = (y) => {
      const zn = top - shaftDepth(Math.min(y, g.nutY)), zh = top - (y - g.nutY) * tan - thick / cos;
      return zn + ease((y - (g.nutY - behind)) / (behind + ahead)) * (zh - zn);
    };
    // The volute: a mound on the crown of the back, highest on the centerline under the nut. `along` is
    // the distance from the nut as a fraction of the volute's length on that side (the two sides have
    // their own lengths); `across` is the distance from the centerline as a fraction of the nut's half
    // width. It dies away to nothing, and level, all round its rim: at the neck's edges, and along a
    // rounded line toward the heel and toward the headstock.
    const bump = (along, across) => {
      const r = Math.hypot(along, across);
      if (!(rise > 0) || r >= 1) return 0;
      return rise * (peaked ? (1 - r) ** 1.5 : (1 - r * r) ** 2);
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
      return x1 > x0 ? { l: Math.max(0, -x0), r: Math.max(0, x1) } : { l: 0, r: 0 };
    };
    // Cross-sections past the nut. Each lies in a plane across the neck that leans back a little more than
    // the one before, from upright at the nut to square with the headstock's face; all the leaning planes
    // pass through one line well below the neck, so no two of them cross inside the wood.
    const HINGE = 45, fan = HINGE * sin, nutHalf = nk.nutWidth / 2;
    // Each section is drawn wider than the headstock (by up to SPARE at the end of the transition) and
    // then trimmed to the outline, the way a headstock is sawn to its outline and its back carved after:
    // the edge of the headstock is thin at the nut and reaches full thickness as the carve runs out.
    const SPARE = Math.min(14, 0.3 * reach);
    const limit = (q, sign) => {
      const at = (q[1] - g.nutY) * cos - (q[2] - top) * sin, lim = at <= 0 ? { l: nutHalf, r: nutHalf } : widths(Math.min(at, reach));
      return sign < 0 ? lim.l : lim.r;
    };
    const station = (v) => {
      const th = v >= fan ? ang : Math.atan2(v * cos, HINGE - v * sin), st = Math.sin(th), ct = Math.cos(th);
      const oy = g.nutY + v * cos, oz = top - v * sin;
      let base;
      if (v >= reach) base = thick;
      else {
        let lo = 0, hi = 90; // where this plane's centerline meets the back
        for (let k = 0; k < 50; k++) { const t = (lo + hi) / 2; if (oz - t * ct > zBack(oy - t * st)) lo = t; else hi = t; }
        base = (lo + hi) / 2;
      }
      const w = widths(Math.min(v, reach)), spare = SPARE * Math.min(1, v / reach), n = fullness * (SQUARE / fullness) ** ease(v / reach);
      const to3 = (p) => [p.x, oy + p.z * st, oz + p.z * ct];
      let { pts, p3, dirs } = sampled(w.l + spare, base, n, w.r + spare, (p) => { p.z -= bump(v / fall, Math.abs(p.x) / nutHalf); }, to3, v > 0 ? limit : null);
      if (v >= reach && !(bump(v / fall, 0) > 0)) {
        // the end of the transition is the flat part's own section, exactly: square corners and a straight back,
        // so the flat part can be stitched on edge to edge
        pts = [{ x: -w.l, z: 0 }];
        for (let i = 0; i <= 48; i++) pts.push({ x: -w.l + ((w.l + w.r) * i) / 48, z: -thick });
        pts.push({ x: w.r, z: 0 });
        p3 = pts.map(to3); dirs = pts.slice(1, -1).map(() => [1, 0, 0]);
      }
      return { v, y: oy, left: w.l, right: w.r, spare, base, depth: base + bump(v / fall, 0), n, pts, dirs, p3 };
    };
    // a section every STRIP through the transition
    const count = Math.max(8, Math.round(reach / STRIP)), vs = [];
    for (let k = 0; k <= count; k++) vs.push((reach * k) / count);
    const sections = vs.map((v) => station(v));
    // the flat part: the outline from the end of the transition on
    const slab = [];
    for (let i = 0, m = poly.length; i < m; i++) {
      const p = poly[i], q = poly[(i + 1) % m], pin = p.y >= reach, qin = q.y >= reach;
      if (pin) slab.push(p);
      if (pin !== qin) slab.push({ x: p.x + ((q.x - p.x) * (reach - p.y)) / (q.y - p.y), y: reach });
    }
    head = { ang, sin, cos, tan, thick, rise, run, fall, peaked, reach, behind, ahead, backZ: zBack, bump, widths, at: (v) => station(v), nodes, poly, slab, length, place, sections, faceZ: (y) => top - (y - g.nutY) * tan };
  }
  const at = (y) => {
    const s = toHeel(y), base = head ? top - zBack(y) : shaftDepth(y), depth = base + (heelDepth - base) * s;
    // fullness climbs steeply at the end, so the neck is round for most of the blend and squares up at the heel
    const n = fullness + (SQUARE - fullness) * s ** 3;
    const half = halfAt(y);
    const to3 = (p) => [p.x, y, top + p.z];
    if (y <= shaftEnd + 1e-9) {
      // where the shaft meets the heel block it is the block's own section, exactly: square corners and a
      // straight bottom, so the block can be stitched on edge to edge
      const pts = [{ x: -half, z: 0 }];
      for (let i = 0; i <= 48; i++) pts.push({ x: -half + (2 * half * i) / 48, z: -heelDepth });
      pts.push({ x: half, z: 0 });
      return { y, half, base: heelDepth, depth: heelDepth, n, pts, p3: pts.map(to3), dirs: pts.slice(1, -1).map(() => [1, 0, 0]) };
    }
    const { pts, p3, dirs } = sampled(half, depth, n, half, head ? (p) => { p.z -= head.bump((g.nutY - y) / head.run, Math.abs(p.x) / half); } : null, to3);
    return { y, half, base: depth, depth: depth + (head ? head.bump((g.nutY - y) / head.run, 0) : 0), n, pts, p3, dirs };
  };
  // stations: closer together through the blend, where the shape changes fastest
  // Stations: one every STRIP where the shape is changing (the volute, the turn into the headstock, the
  // blend into the heel), and every 10 mm along the plain shaft, with one at each of the 1st and 12th
  // frets where its taper changes.
  const ys = [], blendTop = shaftEnd + blend;
  let from = g.nutY;
  if (head) {
    from = g.nutY - Math.max(head.run, head.behind);
    const k = Math.round((g.nutY - from) / STRIP);
    for (let i = 0; i < k; i++) ys.push(g.nutY - ((g.nutY - from) * i) / k);
  }
  const plain = [y1, y12].filter((y) => y < from - 1 && y > blendTop + 1);
  for (let y = from; y > blendTop + 1e-6; y -= 10) plain.push(y);
  ys.push(...plain.sort((a, b) => b - a).filter((y, i, a) => !i || a[i - 1] - y > 0.5));
  const kb = Math.max(8, Math.round(blend / STRIP));
  for (let i = 0; i <= kb; i++) ys.push(blendTop - (blend * i) / kb);
  const sections = ys.map(at);
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
    top, heelBottom: top - heelDepth, heelDepth, shaftEnd, blend, board, fullness, d1, d12, y1, y12, at, sections, heel, halfAt, head,
    length: g.nutY - g.heelY, nutY: g.nutY,
    // worked out only when asked for: it takes a moment, and the drawing does not need it
    get volume() { if (!measured) measured = measure(); return measured.volume; },
    get parts() { if (!measured) measured = measure(); return measured; },
  };
}
