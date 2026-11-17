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

// A cross-section ready to build from: its two top corners, and between them the back as 49 points, with
// the direction the curve arrives at and leaves each one (`din`, `dout`: they differ only at a crease).
// From the crown outward each side is: a flat of FLAT_STEPS steps, then OUTER_STEPS steps evenly spaced
// along the rest of the curve to where the edge begins. The flat is the tongue where there is one, and a
// bare EDGE wide where there is not, so that every section is made of the same pieces and a tongue's
// edge is always the same point of every section (which is what keeps that edge a crisp line).
// Even spacing matters when the section is nearly square: points spread by angle bunch in the corners
// and leave the flat between them to sag in the CAD surface.
//   shift(p, s) moves each point of a fine tracing before the points are picked (the volute, the tongue)
//   to3(p)      places a point in space
//   limit(q, s) for a point in space on side s (-1 bass, +1 treble): how far out the section may reach
//               there (the headstock's outline); left out, the section is not trimmed
//   flat        { l, r, near }: half-widths of the flat, and extra places (distances from the centerline)
//               to trace finely, where the shape turns sharply
// Each side ends with a straight edge from where the back stops up to the top corner: the headstock's
// sawn edge where the section is trimmed, and a bare EDGE of the curve itself where it is not.
const EDGE = 0.05, FLAT_STEPS = 6, OUTER_STEPS = 18;
function sampled(left, depth, n, right, shift, to3, limit, flat) {
  const FINE = 150, c = 2 ** (-1 / n); // the curve is traced by x across its crown and by z down its sides
  const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const half = (w, sign, wide, near) => {
    const base = (x) => ({ x: sign * x, z: -depth * (1 - Math.min(1, x / w) ** n) ** (1 / n) });
    const moved = (p) => { if (shift) shift(p, sign); return p; };
    const crown = moved(base(0));
    // the flat: from the crown out to its edge, kept a little inside the section's own edge
    let f = Math.max(EDGE, Math.min(wide || 0, w - 4 * EDGE));
    if (limit) f = Math.max(EDGE, Math.min(f, limit(to3({ x: sign * f, z: crown.z }), sign) - 2 * EDGE));
    // (a tongue is level right across, so its edge is as deep as its crown)
    const lip = wide > 0 ? { x: sign * f, z: crown.z } : moved(base(f));
    // the rest: traced finely from the flat's edge to the section's edge
    const xs = [];
    for (let i = 0; i <= FINE; i++) { const x = (c * w * i) / FINE; if (x > f + 1e-9) xs.push(x); }
    for (const x of near || []) if (x > f + 1e-9 && x < c * w) xs.push(x);
    xs.sort((a, b) => a - b);
    const run = [lip, ...xs.map((x) => moved(base(x)))];
    for (let i = 1; i <= FINE; i++) { const z = c * (1 - i / FINE), x = w * (1 - z ** n) ** (1 / n); if (x > f + 1e-9) run.push(moved({ x: sign * x, z: -depth * z })); }
    let q = run.map(to3), end = run.length - 1, corner = { x: sign * w, z: 0 }, trimmed = false;
    const cutAt = (i, t) => { // keep up to a point part way along the step from i to i + 1
      const p = { x: run[i].x + (run[i + 1].x - run[i].x) * t, z: run[i].z + (run[i + 1].z - run[i].z) * t };
      run.length = i + 1; run.push(p); q = run.map(to3);
    };
    if (limit) {
      const over = (i) => sign * q[i][0] - limit(q[i], sign);
      for (let i = 0; i < end; i++) if (over(i + 1) > 0) { const a = over(i), b = over(i + 1); cutAt(i, a >= 0 ? 0 : -a / (b - a)); trimmed = true; break; }
      end = run.length - 1;
      if (trimmed) corner = { x: sign * limit(to3({ x: run[end].x, z: 0 }), sign), z: 0 };
    }
    if (!trimmed) { // leave a bare EDGE of the curve as the straight edge
      let back = 0;
      for (let i = end; i > 0; i--) { const d = dist(q[i], q[i - 1]); if (back + d >= EDGE) { cutAt(i - 1, 1 - (EDGE - back) / d); break; } back += d; }
    }
    const len = [0];
    for (let i = 1; i < q.length; i++) len.push(len[i - 1] + dist(q[i], q[i - 1]));
    const outer = [];
    for (let k = 0, i = 0; k <= OUTER_STEPS; k++) {
      const want = (len[len.length - 1] * k) / OUTER_STEPS;
      while (i < q.length - 2 && len[i + 1] < want) i++;
      const t = Math.max(0, Math.min(1, (want - len[i]) / (len[i + 1] - len[i] || 1))), a = q[i], b = q[i + 1], l = dist(a, b) || 1, dir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l, (b[2] - a[2]) / l];
      outer.push({ p: { x: run[i].x + (run[i + 1].x - run[i].x) * t, z: run[i].z + (run[i + 1].z - run[i].z) * t }, p3: a.map((v, j) => v + (b[j] - v) * t), a: dir, b: dir });
    }
    // the flat itself: straight from the crown to its edge
    const c3 = to3(crown), l3 = to3(lip), fl = dist(c3, l3) || 1, fdir = l3.map((v, j) => (v - c3[j]) / fl), out = [];
    for (let k = 0; k < FLAT_STEPS; k++) { const t = k / FLAT_STEPS; out.push({ p: { x: crown.x + (lip.x - crown.x) * t, z: crown.z + (lip.z - crown.z) * t }, p3: c3.map((v, j) => v + (l3[j] - v) * t), a: fdir, b: fdir }); }
    outer[0].a = fdir; // at the flat's edge the curve arrives along the flat and leaves along the rest
    return { out: [...out, ...outer], corner }; // crown to edge; a = direction arriving (from the crown side), b = leaving
  };
  const L = half(left, -1, flat && flat.l, flat && flat.near), R = half(right, 1, flat && flat.r, flat && flat.near);
  // bass side, round to the crown, round to the treble side; directions all run bass to treble
  const neg = (d) => d.map((v) => -v);
  const all = [...L.out.slice(1).reverse().map((q) => ({ p: q.p, p3: q.p3, din: neg(q.b), dout: neg(q.a) })), { p: R.out[0].p, p3: R.out[0].p3, din: neg(L.out[0].b), dout: R.out[0].b }, ...R.out.slice(1).map((q) => ({ p: q.p, p3: q.p3, din: q.a, dout: q.b }))];
  const pts = [L.corner, ...all.map((q) => q.p), R.corner];
  return { pts, p3: [to3(L.corner), ...all.map((q) => q.p3), to3(R.corner)], din: all.map((q) => q.din), dout: all.map((q) => q.dout) };
}

// A drawn line: a curve through points, each with a handle on either side that sets the direction and
// reach of the curve there, as in a drawing program (cubic Bezier curves). `pts` are in order along the
// neck, each { s, v, hi, ho }: its place along from the nut, its value there, and its handles as
// [along, value] offsets from the point (`hi` reaching back toward the heel, `ho` forward). The line has
// to give one value at each place along the neck, so a handle can reach no farther along than the next
// point, and where two handles facing each other would pass, both are shortened until they meet.
// Returns value(s) for any place between the first and last point, and the handles as they are used.
function handleCurve(pts) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], h = b.s - a.s;
    let o = [Math.max(0, Math.min(h, a.ho[0])), a.ho[1]], n = [Math.max(-h, Math.min(0, b.hi[0])), b.hi[1]];
    if (a.ho[0] > h) o[1] *= h / a.ho[0];
    if (b.hi[0] < -h) n[1] *= -h / b.hi[0];
    const over = (o[0] - n[0]) / h;
    if (over > 1) { o = [o[0] / over, o[1] / over]; n = [n[0] / over, n[1] / over]; }
    const S = [a.s, a.s + o[0], b.s + n[0], b.s], V = [a.v, a.v + o[1], b.v + n[1], b.v];
    const at = (c, t) => { const u = 1 - t; return u * u * u * c[0] + 3 * u * u * t * c[1] + 3 * u * t * t * c[2] + t * t * t * c[3]; };
    segs.push({ S, V, at, o, n });
  }
  const value = (sv) => {
    let i = 0; while (i < segs.length - 1 && sv > pts[i + 1].s) i++;
    const g = segs[i];
    let lo = 0, hi = 1; // the place along rises steadily from one end of the piece to the other, so halving finds it
    for (let k = 0; k < 44; k++) { const t = (lo + hi) / 2; if (g.at(g.S, t) < sv) lo = t; else hi = t; }
    return g.at(g.V, (lo + hi) / 2);
  };
  return { value, used: pts.map((p, i) => ({ hi: i ? segs[i - 1].n : null, ho: i < segs.length ? segs[i].o : null })) };
}
// a handle as stored with a point, if it has one: two finite numbers
const ownHandle = (h) => (Array.isArray(h) && h.length === 2 && Number.isFinite(+h[0]) && Number.isFinite(+h[1]) ? [+h[0], Math.max(-60, Math.min(60, +h[1]))] : null);

// The side view of the back, as drawn: a line through points, each `s` millimeters along from the nut
// (negative toward the heel) and standing `out` millimeters from the plain line of the back there (the
// line the back takes with no volute). A point may carry its own handles (`hi`, `ho`: see handleCurve);
// a point without them gets handles that make the line smooth, level where it leaves and rejoins the
// plain line, never overshooting between two points, and turning sharply only at a corner (k: 'c').
// Returns out(s): nothing outside the points.
// `freeStart` leaves the first point where it was drawn (a tongue's tip stands proud); otherwise both
// ends sit on the plain line.
export function sideLine(points, { freeStart = false, min = -150, max = 78 } = {}) {
  const pts = (points || []).map((p) => ({ s: Math.max(min, Math.min(max, +p.s || 0)), out: Math.max(-6, Math.min(15, +p.out || 0)), k: p.k === 'c' ? 'c' : 's', hi: ownHandle(p.hi), ho: ownHandle(p.ho) })).sort((a, b) => a.s - b.s);
  for (let i = pts.length - 1; i > 0; i--) if (pts[i].s - pts[i - 1].s < 1) pts.splice(i, 1); // two points on one spot
  if (pts.length < 2) return null;
  const last = pts.length - 1;
  pts[last].out = 0; if (!freeStart) pts[0].out = 0;
  // the slope arriving at and leaving each point, for a point with no handles of its own
  const sec = []; for (let i = 0; i < last; i++) sec.push((pts[i + 1].out - pts[i].out) / (pts[i + 1].s - pts[i].s));
  const run = pts.map((p, i) => {
    let din = 0, dout = 0;
    if (i > 0 && i < last) {
      if (p.k === 'c') { din = sec[i - 1]; dout = sec[i]; } else {
        const a = sec[i - 1], b = sec[i], ha = p.s - pts[i - 1].s, hb = pts[i + 1].s - p.s;
        din = dout = a * b <= 0 ? 0 : (3 * (ha + hb)) / ((2 * hb + ha) / a + (hb + 2 * ha) / b); // level over a crest, never past either neighbor
      }
    }
    const back = i ? (p.s - pts[i - 1].s) / 3 : 0, fwd = i < last ? (pts[i + 1].s - p.s) / 3 : 0;
    return { s: p.s, v: p.out, hi: p.hi || [-back, -din * back], ho: p.ho || [fwd, dout * fwd] };
  });
  const curve = handleCurve(run);
  const out = (sv) => (sv <= pts[0].s ? (freeStart ? pts[0].out : 0) : sv >= pts[last].s ? 0 : curve.value(sv));
  let crest = 0; for (let i = 1; i <= last; i++) if (Math.abs(pts[i].out) > Math.abs(pts[crest].out)) crest = i;
  return { points: pts, used: curve.used, out, from: pts[0].s, to: pts[last].s, crest: pts[crest].s };
}

// The tongue's outline, as drawn: half its width at each place along from the nut, through points
// { s, w, k } that may carry their own handles (`hi`, `ho`: see handleCurve). The first point is the tip
// (no width there). Without handles of its own, a tip left smooth is round (its handle points straight
// across the neck, so the outline leaves it square to the centerline, like the end of a U) and a tip made
// a corner (k: 'c') is pointed; between the other points the line is smooth, never overshoots, and turns
// sharply only at a corner.
export function tongueOutline(points, { min = -150, max = 78 } = {}) {
  const pts = (points || []).map((p) => ({ s: Math.max(min, Math.min(max, +p.s || 0)), w: Math.max(0.5, Math.min(60, +p.w || 0)), k: p.k === 'c' ? 'c' : 's', hi: ownHandle(p.hi), ho: ownHandle(p.ho) })).sort((a, b) => a.s - b.s);
  for (let i = pts.length - 1; i > 0; i--) if (pts[i].s - pts[i - 1].s < 1) pts.splice(i, 1);
  if (pts.length < 2) return null;
  const last = pts.length - 1, round = pts[0].k !== 'c';
  pts[0].w = 0;
  const sec = []; for (let i = 0; i < last; i++) sec.push((pts[i + 1].w - pts[i].w) / (pts[i + 1].s - pts[i].s));
  const run = pts.map((p, i) => {
    const back = i ? (p.s - pts[i - 1].s) / 3 : 0, fwd = i < last ? (pts[i + 1].s - p.s) / 3 : 0;
    if (i === 0) return { s: p.s, v: 0, hi: [0, 0], ho: p.ho || (round ? [0, 0.55 * pts[1].w] : [fwd, sec[0] * fwd]) };
    let din = 0, dout = 0; // (it arrives at its last point running straight along the neck)
    if (i < last) {
      if (p.k === 'c') { din = sec[i - 1]; dout = sec[i]; } else {
        const a = sec[i - 1], b = sec[i], ha = p.s - pts[i - 1].s, hb = pts[i + 1].s - p.s;
        din = dout = a * b <= 0 ? 0 : (3 * (ha + hb)) / ((2 * hb + ha) / a + (hb + 2 * ha) / b);
      }
    }
    return { s: p.s, v: p.w, hi: p.hi || [-back, -din * back], ho: p.ho || [fwd, dout * fwd] };
  });
  const curve = handleCurve(run);
  const half = (sv) => (sv <= pts[0].s ? 0 : sv >= pts[last].s ? pts[last].w : Math.max(0, curve.value(sv)));
  return { points: pts, used: curve.used, half, from: pts[0].s, to: pts[last].s, round: pts[0].ho ? Math.abs(pts[0].ho[0]) < 0.3 * Math.abs(pts[0].ho[1]) : round };
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
    // Two kinds of headstock. Angled: tilted back from the nut. Flat: level with the neck, its face stepped
    // down below the neck's top, reached from the nut by a scoop (a hollow that is an arc of a circle seen
    // from the side and straight across, as a sanding drum leaves it), level where it meets the face.
    const level = h.kind === 'flat';
    const ang = level ? 0 : (Math.max(1, Math.min(25, h.angle)) * Math.PI) / 180, sin = Math.sin(ang), cos = Math.cos(ang), tan = sin / cos;
    const drop = level ? Math.max(0, Math.min(15, h.drop)) : 0, scoop = level ? Math.max(5, Math.min(60, h.scoop)) : 0;
    const scoopRadius = drop > 0 ? (scoop * scoop + drop * drop) / (2 * drop) : 0;
    // how far the face is below the neck's top at a place past the nut
    const ramp = (v) => (!(drop > 0) || v <= 0 ? 0 : v >= scoop ? drop : drop - (scoopRadius - Math.sqrt(scoopRadius * scoopRadius - (scoop - v) * (scoop - v))));
    const thick = Math.max(6, Math.min(30, h.thickness)), rise = Math.max(0, Math.min(15, h.voluteHeight)), run = Math.max(5, Math.min(120, h.voluteLength));
    // the volute's length on the headstock side of the nut (it has to be gone by the end of the transition)
    const fallAsked = Math.max(5, Math.min(120, h.voluteAhead));
    const peaked = h.voluteStyle === 'peak', flatStyle = h.voluteStyle === 'tongue';
    // the outline at its true shape, its ends pinned to the corners of the nut
    const nodes = h.outline.nodes.map((q) => ({ ...q })), last = nodes.length - 1;
    nodes[0] = { ...nodes[0], x: -nk.nutWidth / 2, y: 0 }; nodes[last] = { ...nodes[last], x: nk.nutWidth / 2, y: 0 };
    const poly = flattenNodes(nodes, false, 0.02);
    const length = Math.max(...poly.map((p) => p.y));
    // the transition length, measured along the headstock's face from the nut
    // (on a flat headstock it is never shorter than the scoop: the face must be level before the flat begins)
    const reach = Math.max(level ? scoop + 5 : 0, Math.max(20, Math.min(h.transition, 80, length * 0.6)));
    const fall = Math.min(fallAsked, reach - 2);
    const behind = reach / 3;                       // the back starts to turn this far behind the nut
    const ahead = Math.max(5, reach * cos - thick * sin); // and has become the headstock's back this far past it
    // a point of the headstock: x across, v along its face from the nut, w down into it from its face
    const place = (x, v, w) => ({ x, y: g.nutY + v * cos - w * sin, z: top - v * sin - w * cos });
    // the side view of the back without the volute, as a height at each place along the neck
    zBack = (y) => {
      const zn = top - shaftDepth(Math.min(y, g.nutY)), zh = top - (y - g.nutY) * tan - thick / cos - drop;
      return zn + ease((y - (g.nutY - behind)) / (behind + ahead)) * (zh - zn);
    };
    // The volute: a mound on the crown of the back, highest on the centerline under the nut. `along` is
    // the distance from the nut as a fraction of the volute's length on that side (the two sides have
    // their own lengths); `across` is the distance from the centerline as a fraction of the nut's half
    // width. It dies away to nothing, and level, all round its rim: at the neck's edges, and along a
    // rounded line toward the heel and toward the headstock.
    const bump = (along, across) => {
      const r = Math.hypot(along, across);
      if (!(rise > 0) || r >= 1 || flatStyle) return 0;
      return rise * (peaked ? (1 - r) ** 1.5 : (1 - r * r) ** 2);
    };
    // With the side view drawn, the drawn line takes the place of the volute's height, lengths and shape.
    // It gives how far the back stands out along the centerline; away from the centerline that falls off
    // the same way the mound does, so its foot is still a rounded line and it still arrives level at the
    // neck's edges. (For a tongue the drawn line is the height of the tongue's flat instead.)
    const side = h.side && h.side.on ? sideLine(h.side.points, { freeStart: flatStyle, max: reach - 2 }) : null;
    const swell = (sv, across) => {
      if (flatStyle) return 0; // a tongue is not a mound: its height is handled with its flat
      if (!side) return bump(sv < 0 ? -sv / run : sv / fall, across);
      // The drawn line can have a different shape on each side of its highest point. Away from the
      // centerline the two are blended by direction (all heel-side shape looking toward the heel, all
      // headstock-side shape looking toward the headstock, half and half straight across), so the
      // surface has no crease where the two sides meet.
      const toHeel = side.crest - side.from, toHead = side.to - side.crest;
      const a = sv < side.crest ? (sv - side.crest) / toHeel : (sv - side.crest) / toHead, r = Math.hypot(a, across);
      if (r >= 1) return 0;
      if (r < 1e-9) return side.out(side.crest);
      const w = (1 + a / r) / 2;
      return (1 - w) * side.out(side.crest - r * toHeel) + w * side.out(side.crest + r * toHead);
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
    // the one before, from upright at the nut to square with the headstock's face.
    // The lean grows smoothly from nothing at the nut to the full angle over `fan`, so the sections turn
    // without a jerk at either end (a jerk shows as a faint line across a flat surface). `fan` is long
    // enough that no two sections cross anywhere within 30 mm below the face.
    const fan = ang > 0 ? Math.min(reach, (1.5 * ang) / 0.03) : 1, nutHalf = nk.nutWidth / 2;
    // Each section is drawn wider than the headstock (by up to SPARE at the end of the transition; the
    // extra grows as the square of the distance from the nut, which makes the sawn edge's height grow
    // steadily from nothing instead of jumping up in the first millimeter) and
    // then trimmed to the outline, the way a headstock is sawn to its outline and its back carved after:
    // the edge of the headstock is thin at the nut and reaches full thickness as the carve runs out.
    const SPARE = Math.min(14, 0.3 * reach);
    const limit = (q, sign) => {
      const at = (q[1] - g.nutY) * cos - (q[2] - top) * sin, lim = at <= 0 ? { l: nutHalf, r: nutHalf } : widths(Math.min(at, reach));
      return sign < 0 ? lim.l : lim.r;
    };
    // The tongue: the flat of the headstock's back carried down the back of the neck to a rounded or
    // pointed tip, with a crisp edge. It is drawn in plan (x across, s along from the nut): from its tip
    // behind the nut it widens to most of the neck's width at the nut, then quickly on out to the
    // headstock's full width, so that the whole back of the headstock is one flat. Behind the nut it stands `rise` out from the crown of the neck's
    // back; past the nut that fades away as the back becomes the headstock's own. Outside its edge the
    // surface falls back to the neck's round back through a cove: a quarter circle in section, upright at
    // the tongue's edge and running out level into the neck.
    let tongue = null;
    const line = flatStyle && h.tongueLine && h.tongueLine.on ? tongueOutline(h.tongueLine.points, { max: reach - 2 }) : null;
    if (flatStyle) {
      const cove = Math.max(2, Math.min(25, h.tongueCove)), pw = line ? (line.round ? 2 : 1.3) : h.tongueTip === 'point' ? 1.3 : 2;
      const tip = line ? line.from : side ? Math.min(-2, side.from) : -run, atNut = line ? line.half(0) : 0.8 * nutHalf;
      const spread = Math.min(reach, 1.5 * cove); // past the nut (or past the end of a drawn outline) it reaches the headstock's full width within this length
      const halfOf = (sv, sign) => {
        if (sv <= tip) return 0;
        const full = (from, at) => { const w = widths(Math.min(sv, reach)); return at + ((sign < 0 ? w.l : w.r) + SPARE - at) * ease((sv - from) / spread); };
        if (line) return sv <= line.to ? line.half(sv) : full(line.to, line.half(line.to));
        if (sv <= 0) { const t = (sv - tip) / -tip; return atNut * (1 - (1 - t) ** pw) ** (1 / pw); }
        return full(0, atNut);
      };
      const edge = [];
      for (const sign of [-1, 1]) {
        const side = [];
        for (let k = 0; k <= 120; k++) { const sv = tip - (tip * k * k) / 14400; side.push([sign * halfOf(sv, sign), sv]); }
        for (let k = 1; k <= 40; k++) { const sv = (reach * k) / 40; side.push([sign * halfOf(sv, sign), sv]); }
        side.push([side[side.length - 1][0], reach + 50]);
        edge.push(side);
      }
      const away = (x, sv) => {
        let best = Infinity;
        for (const side of edge) for (let i = 0; i < side.length - 1; i++) {
          const a = side[i], b = side[i + 1];
          if ((a[1] > sv + cove && b[1] > sv + cove) || (a[1] < sv - cove && b[1] < sv - cove)) continue; // too far along to matter
          const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (sv - a[1]) * dy) / (dx * dx + dy * dy || 1)));
          const d = Math.hypot(x - a[0] - t * dx, sv - a[1] - t * dy);
          if (d < best) best = d;
        }
        return best;
      };
      const inside = (x, sv) => sv > tip && x > -halfOf(sv, -1) && x < halfOf(sv, 1);
      const proud = (sv) => (side ? side.out(sv) : rise * (sv <= 0 ? 1 : 1 - ease(sv / reach)));
      const wall = (u) => (u >= 1 ? 0 : 1 - Math.sqrt(1 - (1 - u) * (1 - u)));
      // The cove is as wide as set where there is room, and narrower where the tongue's edge is close to
      // the edge of the neck or headstock (`room` is the half-width there), so that it always runs out
      // before that edge and never leaves a step on it.
      const coveAt = (sv, sign, room) => Math.max(0.3, Math.min(cove, room - halfOf(sv, sign) - 0.5));
      // depth of the back at a place: `round` is the neck's round back there, `crown` its depth on the centerline
      const depthAt = (x, sv, round, crown, room) => (inside(x, sv) ? crown + proud(sv) : round + (crown + proud(sv) - round) * wall(away(x, sv) / coveAt(sv, x < 0 ? -1 : 1, room)));
      const flatAt = (sv) => {
        const l = halfOf(sv, -1), r = halfOf(sv, 1), near = [];
        for (let k = 1; k <= 30; k++) { const d = (cove * k * k) / 900; near.push(l + d, r + d); }
        return { l, r, near };
      };
      tongue = { line, tip, cove, spread, atNut, pointed: pw < 2, halfOf, inside, away, proud, coveAt, depthAt, flatAt, from: tip - cove - 1 };
    }
    const station = (v) => {
      const th = ang * ease(v / fan), st = Math.sin(th), ct = Math.cos(th);
      const oy = g.nutY + v * cos, oz = top - v * sin - ramp(v);
      let base;
      if (v >= reach) base = thick;
      else {
        let lo = 0, hi = 90; // where this plane's centerline meets the back
        for (let k = 0; k < 50; k++) { const t = (lo + hi) / 2; if (oz - t * ct > zBack(oy - t * st)) lo = t; else hi = t; }
        base = (lo + hi) / 2;
      }
      const w = widths(Math.min(v, reach)), spare = SPARE * Math.min(1, v / reach) ** 2, n = fullness * (SQUARE / fullness) ** ease(v / reach);
      const to3 = (p) => [p.x, oy + p.z * st, oz + p.z * ct];
      const shift = tongue ? (p) => { p.z = -tongue.depthAt(p.x, v, -p.z, base, p.x < 0 ? w.l : w.r); } : (p) => { p.z -= swell(v, Math.abs(p.x) / nutHalf); };
      let { pts, p3, din, dout } = sampled(w.l + spare, base, n, w.r + spare, shift, to3, v > 0 ? limit : null, tongue ? tongue.flatAt(v) : null);
      if (v >= reach) {
        // the end of the transition is the flat part's own section, exactly: square corners and a straight back,
        // so the flat part can be stitched on edge to edge
        pts = [{ x: -w.l, z: 0 }];
        for (let i = 0; i <= 48; i++) pts.push({ x: -w.l + ((w.l + w.r) * i) / 48, z: -thick });
        pts.push({ x: w.r, z: 0 });
        p3 = pts.map(to3); din = dout = pts.slice(1, -1).map(() => [1, 0, 0]);
      }
      return { v, y: oy, left: w.l, right: w.r, spare, base, depth: tongue ? tongue.depthAt(0, v, base, base, w.r) : base + swell(v, 0), n, pts, din, dout, p3 };
    };
    // a section every STRIP through the transition
    const count = Math.max(8, Math.round(reach / STRIP)), vs = [];
    for (let k = 0; k <= count; k++) vs.push((reach * k) / count);
    // (worked out only when something asks for them: the drawing of the outline does not need them)
    let made = null;
    const sectionsOf = () => made || (made = vs.map((v) => station(v)));
    // the flat part: the outline from the end of the transition on
    const slab = [];
    for (let i = 0, m = poly.length; i < m; i++) {
      const p = poly[i], q = poly[(i + 1) % m], pin = p.y >= reach, qin = q.y >= reach;
      if (pin) slab.push(p);
      if (pin !== qin) slab.push({ x: p.x + ((q.x - p.x) * (reach - p.y)) / (q.y - p.y), y: reach });
    }
    // (an outline point lying exactly on that line would otherwise appear twice)
    for (let i = slab.length - 1; i >= 0; i--) { const a = slab[i], b = slab[(i + 1) % slab.length]; if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) slab.splice(i, 1); }
    // Tuner holes: straight through the headstock, square to its face. Each row lies on a straight line
    // from its first hole to its last. `gap` is the wood left between a hole and the headstock's edge
    // beside it (negative when the hole breaks out of the outline).
    const tuners = [], tn = h.tuners || {};
    if (tn.layout === '3+3' || tn.layout === '6' || tn.layout === 6) {
      const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
      const d = num(tn.hole, 3, 16, 10), first = num(tn.first, 10, 300, 38), pitch = num(tn.pitch, 12, 80, 40), a = num(tn.inFirst, 0, 90, 24), b = num(tn.inLast, 0, 90, 30);
      const rows = tn.layout === '3+3' ? [[-1, 3], [1, 3]] : [[tn.side === 'treble' ? 1 : -1, 6]];
      for (const [sign, count] of rows) for (let k = 0; k < count; k++) {
        const v = first + k * pitch, x = sign * (a + ((b - a) * k) / (count - 1)), w = v <= length ? widths(v) : { l: 0, r: 0 };
        tuners.push({ x, v, d, side: sign < 0 ? 'bass' : 'treble', n: k + 1, gap: (sign < 0 ? w.l : w.r) - Math.abs(x) - d / 2 });
      }
    }
    // a point of the headstock past the transition: x across, v along its face from the nut, w down into it from its face
    const spot = (x, v, w) => (level ? { x, y: g.nutY + v, z: top - ramp(v) - w } : place(x, v, w));
    head = { tuners, spot, side, swell, backFrom: Math.max(tongue ? -tongue.from : side ? -side.from : run, behind), tongue, ang, sin, cos, tan, thick, rise, run, fall, peaked, reach, behind, ahead, backZ: zBack, bump, widths, at: (v) => station(v), nodes, poly, slab, length, place, get sections() { return sectionsOf(); }, faceZ: (y) => top - (y - g.nutY) * tan - ramp(y - g.nutY), level, drop, scoop, line };
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
      const flatDir = pts.slice(1, -1).map(() => [1, 0, 0]);
      return { y, half, base: heelDepth, depth: heelDepth, n, pts, p3: pts.map(to3), din: flatDir, dout: flatDir };
    }
    const sv = y - g.nutY, tg = head && head.tongue && sv > head.tongue.from ? head.tongue : null;
    const shift = tg ? (p) => { p.z = -tg.depthAt(p.x, sv, -p.z, depth, half); } : head ? (p) => { p.z -= head.swell(sv, Math.abs(p.x) / half); } : null;
    const { pts, p3, din, dout } = sampled(half, depth, n, half, shift, to3, null, tg ? tg.flatAt(sv) : null);
    return { y, half, base: depth, depth: tg ? tg.depthAt(0, sv, depth, depth, half) : depth + (head ? head.swell(sv, 0) : 0), n, pts, p3, din, dout };
  };
  // Stations: one every STRIP where the shape is changing (the volute, the turn into the headstock, the
  // blend into the heel), and every 10 mm along the plain shaft, with one at each of the 1st and 12th
  // frets where its taper changes.
  const ys = [], blendTop = shaftEnd + blend;
  let from = g.nutY;
  if (head) {
    from = g.nutY - head.backFrom;
    const k = Math.round((g.nutY - from) / STRIP);
    for (let i = 0; i < k; i++) ys.push(g.nutY - ((g.nutY - from) * i) / k);
  }
  const plain = [y1, y12].filter((y) => y < from - 1 && y > blendTop + 1);
  for (let y = from; y > blendTop + 1e-6; y -= 10) plain.push(y);
  ys.push(...plain.sort((a, b) => b - a).filter((y, i, a) => !i || a[i - 1] - y > 0.5));
  const kb = Math.max(8, Math.round(blend / STRIP));
  for (let i = 0; i <= kb; i++) ys.push(blendTop - (blend * i) / kb);
  let shaftMade = null;
  const sectionsOf = () => shaftMade || (shaftMade = ys.map(at)); // worked out only when asked for
  // the heel block: the pocket's own outline from its end wall up to where the shaft meets it
  const heel = g.pocketTo(shaftEnd);
  // volume: the shaft by its cross-sections, plus the heel block, plus the headstock (the transition as
  // the closed shape its cross-sections make when joined by straight lines, and the slab past it)
  const measure = () => {
    let shaft = 0;
    const sections = sectionsOf();
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
    top, heelBottom: top - heelDepth, heelDepth, shaftEnd, blend, board, fullness, d1, d12, y1, y12, at, get sections() { return sectionsOf(); }, heel, halfAt, head,
    length: g.nutY - g.heelY, nutY: g.nutY,
    // worked out only when asked for: it takes a moment, and the drawing does not need it
    get volume() { if (!measured) measured = measure(); return measured.volume; },
    get parts() { if (!measured) measured = measure(); return measured; },
  };
}
