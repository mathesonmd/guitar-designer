// The body as a true CAD solid, for saving as a STEP file (exact) or an STL file (a fine mesh of it). Unlike the sliced solid behind the 3D picture
// (model/solid.js), every surface here is exact: the outline keeps its Bezier curves, the edge roundovers
// are rolled fillets, pockets have vertical walls with true arcs in the corners and flat floors, and
// round holes are true cylinders. The arm bevel's cross-section and run-out are the same curves the
// sliced solid uses, drawn exactly; the belly cut is the same cone, with a true rolled rim blend.
//
// `rc` is the replicad module (an OpenCascade wrapper) with its engine already set. It is passed in so
// the same code runs in the browser, where the engine is fetched on demand, and in the Node tests.
import { expandOutline, segmentsOf } from '../core/path.js';
import { fitArcs } from '../core/arcfit.js';
import { signedArea, centroid } from '../core/poly.js';
import { bevelPlane, bellyDish } from '../model/solid.js';
import { edgeRounds } from '../model/design.js';
import { HOLE_DEPTH_GROUPS } from '../data/bridges.js';

const PAST = 5; // how far a cutting shape runs past the face it enters, so no two faces coincide
const EPS = 1e-6;

// Round holes that are left out of the solid because nothing in the design says how deep they go.
// They are still on the 2D templates.
const NO_DEPTH = {
  stud: 'Bridge and tailpiece post holes',
  ferrule: 'String ferrule holes in the back',
  mount: 'Bridge screw pilot holes',
};

// A closed drawing from DXF-style vertices ({ x, y, bulge }).
function drawVerts(rc, verts) {
  const n = verts.length;
  const pen = rc.draw([verts[0].x, verts[0].y]);
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    if (Math.abs(a.bulge) > 1e-9) pen.bulgeArcTo([b.x, b.y], a.bulge);
    else pen.lineTo([b.x, b.y]);
  }
  return pen.close();
}

// The body outline with its own Bezier segments (a segment with no handles is a straight line).
function drawOutline(rc, outline) { return drawNodes(rc, expandOutline(outline)); }

// A closed drawing from a chain of Bezier nodes. `flip` says whether to run it backward; left out, the
// chain is turned counter-clockwise. (Two chains that must pair up point for point are flipped together.)
function drawNodes(rc, chain, flip) {
  let nodes = chain;
  const back = flip !== undefined ? flip : signedArea(nodes.map((p) => ({ x: p.x, y: p.y }))) < 0;
  if (back) {
    nodes = nodes.slice().reverse().map((p) => ({ ...p, ix: p.ox, iy: p.oy, ox: p.ix, oy: p.iy }));
  }
  const segs = segmentsOf(nodes, true).filter((s) => Math.hypot(s.p3.x - s.p0.x, s.p3.y - s.p0.y) > EPS
    || Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y) > EPS || Math.hypot(s.p2.x - s.p3.x, s.p2.y - s.p3.y) > EPS);
  const pen = rc.draw([segs[0].p0.x, segs[0].p0.y]);
  for (const s of segs) {
    const straight = Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y) < EPS && Math.hypot(s.p2.x - s.p3.x, s.p2.y - s.p3.y) < EPS;
    if (straight) pen.lineTo([s.p3.x, s.p3.y]);
    else pen.cubicBezierCurveTo([s.p3.x, s.p3.y], [s.p1.x, s.p1.y], [s.p2.x, s.p2.y]);
  }
  return pen.close();
}

// A drawing pushed straight up from height z0 to height z1.
const prism = (drawing, z0, z1) => drawing.sketchOnPlane('XY', z0).extrude(z1 - z0);

// Carry a closed profile along a spine without turning it (the profile stays upright the whole way).
function slide(rc, oc, profile, spine) {
  const sweep = new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped);
  const fixed = new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1), new oc.gp_Dir(1, 0, 0));
  sweep.SetMode(fixed);
  sweep.Add(profile.wrapped, false, false);
  sweep.Build(new oc.Message_ProgressRange());
  sweep.MakeSolid();
  const out = rc.cast(sweep.Shape());
  sweep.delete(); fixed.delete();
  return out;
}

// What an arm bevel removes. Its cross-section is the bevel's own profile (model/solid.js): straight
// lines and circular arcs, drawn here as exactly those. With no run-out it is pushed straight along the
// line from end to end. With a run-out it is carried along a path that is level in the middle and rises
// in a parabola at each end, which is the same "rise" the sliced solid uses.
function bevelTool(rc, oc, arm, c, T) {
  const H = T + arm.drop * 2 + 4 * PAST; // top of the cutter, well clear of the body even where it has risen
  const dir = ((c.x2 - c.x1) * arm.tx + (c.y2 - c.y1) * arm.ty) >= 0 ? 1 : -1;
  const tx = arm.tx * dir, ty = arm.ty * dir;
  // a point at s past the line and `depth` below the top, v along the line, lifted by dz
  const at = (sv, depth, v = 0, dz = 0) => [c.x1 + arm.nx * sv + tx * v, c.y1 + arm.ny * sv + ty * v, T - depth + dz];
  const profileAt = (v, dz) => {
    const P = (q) => at(q[0], q[1], v, dz), segs = arm.prof.segs;
    const edges = segs.map((g) => (g.m ? rc.makeThreePointArc(P(g.a), P(g.m), P(g.b)) : rc.makeLine(P(g.a), P(g.b))));
    const first = segs[0].a, last = segs[segs.length - 1].b, top = -(H - T);
    edges.push(rc.makeLine(P(last), P([last[0], top])), rc.makeLine(P([last[0], top]), P([first[0], top])), rc.makeLine(P([first[0], top]), P(first)));
    return rc.assembleWire(edges);
  };
  // pushed straight along the line: between its two squares when bounded, right across the body when not
  const v0 = arm.t0 * dir, v1 = arm.t1 * dir;
  if (!(arm.fade > 0)) return rc.basicFaceExtrusion(rc.makeFace(profileAt(v0, 0)), new rc.Vector([tx * (v1 - v0), ty * (v1 - v0), 0]));
  // z = drop * (d / fade)^2 from d = 0 to D is exactly a quadratic Bezier with points (0, 0), (D/2, 0), (D, z(D))
  const F = arm.fade, D = F * 1.2, zD = arm.drop * (D / F) * (D / F);
  const Q = (v, dz) => at(0, 0, v, dz);
  const pieces = [rc.makeBezierCurve([Q(F - D, zD), Q(F - D / 2, 0), Q(F, 0)])];
  if (arm.l - 2 * F > 1e-6) pieces.push(rc.makeLine(Q(F, 0), Q(arm.l - F, 0)));
  pieces.push(rc.makeBezierCurve([Q(arm.l - F, 0), Q(arm.l - F + D / 2, 0), Q(arm.l - F + D, zD)]));
  // the path runs a little past each end so the cutter is whole there; trim it back to the line's two ends
  const lo = arm.prof.start - 20, hi = arm.prof.reach + 20;
  const span = rc.basicFaceExtrusion(rc.makePolygon([at(lo, arm.drop + 3 * PAST), at(hi, arm.drop + 3 * PAST), at(hi, arm.drop + 3 * PAST, arm.l), at(lo, arm.drop + 3 * PAST, arm.l)]), new rc.Vector([0, 0, 2 * (H - T) + 2 * arm.drop + 8 * PAST]));
  return slide(rc, oc, profileAt(F - D, zD), rc.assembleWire(pieces)).intersect(span);
}

// The shape a belly cut removes: a cone, depth = drop * (1 - rho). It is drawn as straight lines from the
// cone's point (at the cut's center, `drop` above the back face) to an ellipse lying below the back
// face, which is exactly what a cone is.
// A rim blend is a true rolled radius: the cone is joined to a slab lying just under the back face, and
// the inside corner between them is filleted, so the cutter rounds the rim as it comes through.
function bellyCone(rc, oc, dish) {
  const D = dish.drop, below = 2 * PAST, k = 1 + below / D; // the cone keeps widening below the back face
  const turn = (Math.atan2(dish.uy, dish.ux) * 180) / Math.PI;
  const base = rc.drawEllipse(dish.a * k, dish.b * k).rotate(turn).translate(dish.x, dish.y).sketchOnPlane('XY', -below);
  const cone = base.loftWith([], { ruled: true, endPoint: [dish.x, dish.y, D] });
  if (!(dish.blend > 0)) return cone;
  const pad = dish.blend + 20, w = 2 * k * Math.max(dish.a, dish.b) + 2 * pad;
  const box = (z0, z1) => rc.drawRoundedRectangle(w, w).translate(dish.x, dish.y).sketchOnPlane('XY', z0).extrude(z1 - z0);
  const joined = cone.intersect(box(0, D + PAST)).fuse(box(-PAST, 0));
  const onRim = (e) => {
    const m = e.pointAt(0.5);
    return Math.abs(e.startPoint.z) < 1e-6 && Math.abs(e.endPoint.z) < 1e-6 && Math.abs(m.z) < 1e-6 && Math.abs(dish.rho(m.x, m.y) - 1) < 1e-3;
  };
  try {
    const out = joined.fillet((e) => (onRim(e) ? dish.blend : null));
    if (!(rc.measureVolume(out) > rc.measureVolume(joined))) throw new Error('no blend');
    return out;
  } catch (err) {
    throw new Error('The blend around the rim of the belly cut could not be rolled at this size. Make the blend smaller, then try again.');
  }
}

// Take several cutting shapes out of the body in one operation. The cutters may overlap each other
// (a cover recess over its cavity, neck screws inside the pocket).
function cutAll(rc, oc, body, tools) {
  const args = new oc.NCollection_List_TopoDS_Shape(), list = new oc.NCollection_List_TopoDS_Shape();
  args.Append(body.wrapped);
  for (const t of tools) list.Append(t.wrapped);
  const op = new oc.BRepAlgoAPI_Cut();
  op.SetArguments(args); op.SetTools(list);
  op.Build(new oc.Message_ProgressRange());
  if (!op.IsDone() || op.HasErrors()) { op.delete(); throw new Error('The pockets and holes could not be cut out of the 3D model.'); }
  const out = rc.cast(op.Shape());
  op.delete(); args.delete(); list.delete();
  return out;
}

// The body as a CAD solid. `expectVolume` is the volume the sliced solid gives for the same body: the
// engine can return a wrong solid with no error at all, and comparing volumes is how that is caught.
//   - If a rolled edge bevel is the cause, the bevel is rebuilt from flat strips (`bevelStrips` in the
//     result says so; the strips stay within a few hundredths of a millimeter of the curve).
//   - If the volumes still disagree, nothing is returned: an Error with a plain message is thrown.
export function buildBodySolid(rc, oc, design, g, opts = {}) {
  const { expectVolume } = opts;
  const agrees = (r) => !(expectVolume > 0) || Math.abs(r.volume / expectVolume - 1) < 0.003;
  let first = null, why = null;
  try { first = buildOnce(rc, oc, design, g, opts); } catch (err) { why = err; }
  if (first && agrees(first)) return first;
  if (g.bevelEdge && g.bevelEdge.rolled) {
    let second = null;
    try { second = buildOnce(rc, oc, design, g, { ...opts, smoothBevel: false }); } catch (err) { if (!why) why = err; }
    if (second && agrees(second)) return { ...second, bevelStrips: true };
  }
  if (why && !first) throw why;
  throw new Error('The 3D model did not come out the same size as the body in the 3D view, so it was not saved. Something in this design is more than the 3D engine can cut cleanly: try a smaller roundover, a narrower or less rolled edge bevel, or a smaller blend.');
}

// Round holes that will not be in the solid, as [{ what, count }]. Known before anything is built.
export function holesLeftOut(g) {
  const skipped = new Map();
  for (const h of g.holes) {
    if (h.side === 'through' || h.depth > 0) continue;
    const what = HOLE_DEPTH_GROUPS[h.depthGroup] || NO_DEPTH[h.kind] || h.label || 'Other holes';
    skipped.set(what, (skipped.get(what) || 0) + 1);
  }
  return [...skipped].map(([what, count]) => ({ what, count }));
}

// Returns { shape, volume, valid, leftOut: [{ what, count }], roundTop, roundBack }.
// `roundovers: false` leaves the body edges square (for rounding over by hand after the body is cut).
// `pockets: false` leaves every pocket and hole out (for cutting them from the 2D CNC vectors instead).
// Throws an Error with a plain-language message when a part of the body cannot be built.
function buildOnce(rc, oc, design, g, { roundovers = true, pockets = true, smoothBevel = true } = {}) {
  const T = design.body.thickness;
  const rounds = edgeRounds(design);
  const rT = roundovers ? rounds.top : 0, rB = roundovers ? rounds.back : 0;

  let body = prism(drawOutline(rc, design.outline), 0, T);
  // Roll one loop of the slab's edges at a time: all the level edges at height z.
  const roll = (r, z) => {
    if (r <= 0.05) return;
    const radius = (e) => {
      const z0 = e.startPoint.z, z1 = e.endPoint.z;
      return Math.abs(z0 - z) < 1e-4 && Math.abs(z1 - z) < 1e-4 ? r : null;
    };
    try {
      const next = body.fillet(radius);
      if (!(rc.measureVolume(next) > 0)) throw new Error('empty');
      body = next;
    } catch (err) {
      throw new Error(`The ${z > 0 ? 'top' : 'back'} edge roundover is too large to roll around the tightest outside curve of this outline. Leave the edge roundovers out of the model, or make that roundover smaller.`);
    }
  };
  roll(rT, T);
  roll(rB, 0);

  // Everything that is cut away, taken out in one pass (much quicker than one cut at a time).
  const tools = [];
  const centroidXY = g.centroid || centroid(g.outline);
  const arm = bevelPlane(design.contours.arm, g.outline, centroidXY, T - 3);
  if (arm) tools.push(bevelTool(rc, oc, arm, design.contours.arm, T));
  const dish = bellyDish(design.contours.belly, T - 3);
  if (dish) tools.push(bellyCone(rc, oc, dish));

  // bevel around the top edge: everything above its surface. The surface is the bevel's own sections
  // (model/edgebevel.js) joined by straight lines; below the last section, which lies outside the body, it
  // drops straight down, and above the inner line it rises straight up.
  if (g.bevelEdge && g.bevelEdge.deepest > 0) {
    const e = g.bevelEdge, b = g.bbox, m = 20, zLow = e.lowest - 2;
    if (e.crosses) throw new Error('The inner line of the bevel around the top edge crosses itself. Make the bevel narrower where the outline turns tightly, then try again.');
    // a closed curve through the section's nodes, each at its own height (heights run evenly between nodes)
    const wire = (nodes, zOf) => {
      const edges = [], count = nodes.length;
      for (let i = 0; i < count; i++) {
        const p = nodes[i], q = nodes[(i + 1) % count], z0 = zOf(i), z1 = zOf((i + 1) % count);
        if (Math.hypot(q.x - p.x, q.y - p.y) < EPS && Math.hypot(p.ox, p.oy) < EPS && Math.hypot(q.ix, q.iy) < EPS) continue;
        edges.push(rc.makeBezierCurve([[p.x, p.y, z0], [p.x + p.ox, p.y + p.oy, z0 + (z1 - z0) / 3], [q.x + q.ix, q.y + q.iy, z0 + (2 * (z1 - z0)) / 3], [q.x, q.y, z1]]));
      }
      return rc.assembleWire(edges);
    };
    const last = e.sections[e.sections.length - 1], first = e.sections[0];
    const foot = wire(last.nodes, () => zLow), rim = wire(last.nodes, (i) => last.z[i]), line = wire(first.nodes, (i) => first.z[i]), head = wire(first.nodes, () => T + 2 * PAST);
    let keep;
    try {
      if (!e.rolled) keep = rc.loft([foot, rim, line, head], { ruled: true });
      else if (!smoothBevel) {
        // the fallback: straight lines from each section to the next, which the engine always manages
        const all = [foot, rim];
        for (let k = e.sections.length - 2; k >= 1; k--) all.push(wire(e.sections[k].nodes, (i) => e.sections[k].z[i]));
        keep = rc.loft([...all, line, head], { ruled: true });
      }
      else {
        // a rolled bevel is one smooth surface through all its sections; the walls below and above it are
        // straight, and the whole skin is closed with a flat face at the bottom and at the top
        const through = [rim];
        for (let k = e.sections.length - 2; k >= 1; k--) through.push(wire(e.sections[k].nodes, (i) => e.sections[k].z[i]));
        through.push(line);
        keep = rc.makeSolid([rc.makeFace(foot), rc.loft([foot, rim], { ruled: true }, true), rc.loft(through, { ruled: false }, true), rc.loft([line, head], { ruled: true }, true), rc.makeFace(head)]);
        // a skin sewn from separate faces can come out facing inward: turn it the right way out
        oc.BRepLib.OrientClosedSolid(keep.wrapped);
        if (!(rc.measureVolume(keep) > 0)) throw new Error('inside out');
      }
    } catch (err) {
      throw new Error('The bevel around the top edge could not be built. Make it narrower where the outline turns tightly, then try again.');
    }
    tools.push(prism(rc.drawRoundedRectangle(b.w + 2 * m, b.h + 2 * m).translate(b.x0 + b.w / 2, b.y0 + b.h / 2), zLow + 1, T + PAST).cut(keep));
  }
  // binding channel: everything outside its inner edge, from the channel floor up
  if (g.binding && g.binding.inner.length) {
    const b = g.bbox, m = 20, zf = T - g.binding.depth;
    let ring = prism(rc.drawRoundedRectangle(b.w + 2 * m, b.h + 2 * m).translate(b.x0 + b.w / 2, b.y0 + b.h / 2), zf, T + PAST);
    for (const inner of g.binding.inner) ring = ring.cut(prism(drawVerts(rc, fitArcs(inner, 0.01, true)), zf - PAST, T + 2 * PAST));
    tools.push(ring);
  }

  for (const c of pockets ? g.cuts : []) {
    const d = Math.min(c.depth, T);
    if (!(d > 0)) continue;
    const through = d >= T - EPS;
    const shape = drawVerts(rc, fitArcs(c.poly, 0.01, true));
    tools.push(through ? prism(shape, -PAST, T + PAST)
      : c.side === 'back' ? prism(shape, -PAST, d) : prism(shape, T - d, T + PAST));
  }

  for (const h of pockets ? g.holes : []) {
    if (h.side === 'through') tools.push(rc.makeCylinder(h.d / 2, T + 2 * PAST, [h.x, h.y, -PAST], [0, 0, 1]));
    else if (h.depth > 0) {
      const d = Math.min(h.depth, T);
      tools.push(h.side === 'back' ? rc.makeCylinder(h.d / 2, d + PAST, [h.x, h.y, -PAST], [0, 0, 1]) : rc.makeCylinder(h.d / 2, d + PAST, [h.x, h.y, T - d], [0, 0, 1]));
    }
  }
  // (The purfling channel is not cut here: along the bevel's crease the engine does not cut it reliably. It is
  // in the 3D picture and the CNC vectors, and the save dialog says it is not in the 3D file.)
  if (tools.length) body = cutAll(rc, oc, body, tools);
  // the engine's own check that the result is a sound, closed solid
  const checker = new oc.BRepCheck_Analyzer(body.wrapped, true, false);
  const valid = checker.IsValid();
  checker.delete();
  if (!valid) throw new Error('The 3D model came out with a flaw the engine could not repair, so it was not saved. Try leaving the edge roundovers out of the model.');
  return { shape: body, volume: rc.measureVolume(body), valid, leftOut: pockets ? holesLeftOut(g) : [], roundTop: rT, roundBack: rB };
}

// The STEP file as text. Units are millimeters; z = 0 is the back face.
export async function toSTEP(rc, shape, name) {
  const blob = rc.exportSTEP([{ shape, name: name || 'Guitar body' }], { unit: 'MM', modelUnit: 'MM' });
  return blob.text();
}

// How closely the STL's flat facets follow the true surface: no farther than this, in millimeters.
export const STL_TOLERANCE = 0.02;
const STL_ANGLE = 0.2; // most a curved surface may turn between neighboring facets, in radians

// The solid as a binary STL file: { data: Uint8Array, triangles }. STL has no units of its own; the
// numbers are millimeters unless `units` is 'in', when every coordinate is divided by 25.4. Facets with
// no area are dropped, so every edge of the mesh is shared by exactly two facets.
export function toSTL(shape, { units = 'mm' } = {}) {
  const k = units === 'in' ? 1 / 25.4 : 1;
  const { vertices: v, triangles: t } = shape.mesh({ tolerance: STL_TOLERANCE, angularTolerance: STL_ANGLE });
  const keep = [];
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz);
    if (l > 1e-12) keep.push([a, b, c, nx / l, ny / l, nz / l]);
  }
  const data = new Uint8Array(84 + keep.length * 50), view = new DataView(data.buffer);
  const title = `Black Chapel Guitar Designer: guitar body, units are ${units === 'in' ? 'inches' : 'millimeters'}`;
  for (let i = 0; i < title.length; i++) data[i] = title.charCodeAt(i);
  view.setUint32(80, keep.length, true);
  let o = 84;
  for (const [a, b, c, nx, ny, nz] of keep) {
    view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
    for (const [at, p] of [[12, a], [24, b], [36, c]]) {
      view.setFloat32(o + at, v[p] * k, true); view.setFloat32(o + at + 4, v[p + 1] * k, true); view.setFloat32(o + at + 8, v[p + 2] * k, true);
    }
    o += 50;
  }
  return { data, triangles: keep.length };
}

// Stitch faces and skins that meet edge to edge into one closed solid. Edges that should meet are
// matched within a thousandth of a millimeter; if any edge is left with nothing to meet, it is not a
// closed solid and nothing is returned.
function stitch(rc, oc, parts) {
  const sew = new oc.BRepBuilderAPI_Sewing(1e-3, true, true, true, false);
  for (const p of parts) sew.Add(p.wrapped);
  sew.Perform(new oc.Message_ProgressRange());
  const open = sew.NbFreeEdges();
  if (open > 0) { sew.delete(); throw new Error('open'); }
  const shell = rc.cast(rc.downcast(sew.SewedShape()));
  sew.delete();
  const fix = new oc.ShapeFix_Solid(), solid = rc.cast(fix.SolidFromShell(shell.wrapped));
  fix.delete();
  return solid;
}

// The neck's shaft and heel as a CAD solid (model/neck.js says exactly what shape that is). The shaft is
// one smooth surface through its cross-sections; the heel is a block with the pocket's own outline. The
// shaft runs a little way into the block so the two join as one piece.
// `expectVolume` works as it does for the body: a solid that is the wrong size is never returned.
export function buildNeckSolid(rc, oc, neck, { expectVolume } = {}) {
  // Each cross-section's back is drawn as the same number of short curves, piece for piece, so the
  // sections pair up along the neck. A piece runs between two of the section's points, leaving and
  // arriving along the directions of the curve there.
  const STEP = 3; // every third point of the back starts a new piece
  // The points across a section's flat top: its two corners and evenly spaced points between, one for each piece of the back.
  const topOf = (sec) => {
    const P = sec.p3, A = P[0], B = P[P.length - 1], out = [A];
    for (let i = STEP; i < 48; i += STEP) out.push(A.map((c, k) => c + ((B[k] - c) * i) / 48));
    out.push(B);
    return out;
  };
  const wireOf = (sec) => {
    // p3 is: top corner, the back's 49 points, the other top corner. din and dout give the back's direction arriving at and leaving each of the 49.
    const P = sec.p3, B = P.slice(1, -1), last = B.length - 1, edges = [rc.makeLine(P[0], B[0])];
    for (let i = 0; i < last; i += STEP) {
      const j = Math.min(last, i + STEP), a = B[i], b = B[j], ta = sec.dout[i], tb = sec.din[j], h = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 3;
      edges.push(rc.makeBezierCurve([a, a.map((c, k) => c + ta[k] * h), b.map((c, k) => c - tb[k] * h), b]));
    }
    edges.push(rc.makeLine(B[last], P[P.length - 1]));
    const t = topOf(sec);
    for (let k = t.length - 1; k > 0; k--) edges.push(rc.makeLine(t[k], t[k - 1]));
    return rc.assembleWire(edges);
  };
  // A block pushed up from a flat outline, with one end left open: the faces of the block except the
  // flat end that lies along y = seamY. That end's edges are broken into the same pieces as the section
  // of the neck it meets, so the two can be stitched edge to edge with no step and no cutting.
  const openBlock = (poly, seamY, z0, height) => {
    const verts = fitArcs(poly, 0.01, true), out = [], onSeam = (q) => Math.abs(q.y - seamY) < 1e-6;
    let split = 0;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      out.push(a);
      if (onSeam(a) && onSeam(b) && Math.abs(a.bulge || 0) < 1e-9) { split++; for (let k = STEP; k < 48; k += STEP) out.push({ x: a.x + ((b.x - a.x) * k) / 48, y: seamY, bulge: 0 }); }
    }
    const block = drawVerts(rc, out).sketchOnPlane('XY', z0).extrude(height), faces = block.faces.filter((f) => !(Math.abs(f.center.y - seamY) < 1e-6));
    if (split !== 1 || faces.length !== block.faces.length - 48 / STEP) throw new Error('seam');
    return faces;
  };
  let solid, stage = 'heel';
  try {
    // One skin through every cross-section, each joined to the next by straight lines, with its flat top
    // and its edges drawn in from the start, so nothing is trimmed afterward. With a headstock it runs
    // from the end of the transition, round the nut, to the heel. The sections are a millimeter apart
    // wherever the shape is changing, which keeps the skin within about 0.01 mm of the true curve.
    // (Tried first and given up: one smooth surface through all the sections, which the engine made
    // ripple on some settings while still calling it sound; trimming a large carved surface with cuts,
    // wrong about one time in three; joining the blocks on with cuts, flawed about one time in four.)
    const hd = neck.head;
    const run = (hd ? [...hd.sections.slice().reverse(), ...neck.sections.slice(1)] : neck.sections).map(wireOf);
    // the heel block, open where the shaft meets it
    const parts = [...openBlock(neck.heel, neck.shaftEnd, neck.heelBottom, neck.top - neck.heelBottom)];
    stage = 'surface';
    parts.push(rc.loft(run, { ruled: true }, true));
    if (hd) {
      // the flat of the headstock, drawn on its face from the end of the transition to the tip, open where
      // the transition meets it; then tilted back about the nut line and moved to the nut
      stage = 'flat';
      const deg = (hd.ang * 180) / Math.PI;
      for (const f of openBlock(hd.slab, hd.reach, -hd.thick, hd.thick)) parts.push(f.rotate(-deg, [0, 0, 0], [1, 0, 0]).translate([0, neck.nutY, neck.top]));
    } else parts.push(rc.makeFace(run[0])); // no headstock: the neck ends square at the nut
    stage = 'stitch';
    solid = stitch(rc, oc, parts);
    oc.BRepLib.OrientClosedSolid(solid.wrapped);
    if (!(rc.measureVolume(solid) > 0)) throw new Error('inside out');
  } catch (err) {
    throw new Error('The neck could not be built from these settings. Try a blend length, a fullness, a volute or a transition length nearer the starting values, or a simpler headstock outline.');
  }
  const checker = new oc.BRepCheck_Analyzer(solid.wrapped, true, false);
  const valid = checker.IsValid();
  checker.delete();
  const volume = rc.measureVolume(solid);
  if (!valid || (expectVolume > 0 && Math.abs(volume / expectVolume - 1) > 0.015)) {
    throw new Error('The 3D model of the neck did not come out right, so it was not saved. Try a blend length, a fullness, a volute or a transition length nearer the starting values, or a simpler headstock outline.');
  }
  return { shape: solid, volume, valid };
}
