// The body as a true CAD solid, for saving as a STEP file (exact) or an STL file (a fine mesh of it). Unlike the sliced solid behind the 3D picture
// (model/solid.js), every surface here is exact: the outline keeps its Bezier curves, the edge roundovers
// are rolled fillets, pockets have vertical walls with true arcs in the corners and flat floors, and
// round holes are true cylinders. The arm bevel is a flat plane and the belly cut is the same dish
// formula the 3D picture uses.
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
function drawOutline(rc, outline) {
  let nodes = expandOutline(outline);
  const flat = nodes.map((p) => ({ x: p.x, y: p.y }));
  if (signedArea(flat) < 0) {
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

// The wedge an arm bevel removes: a flat plane that starts at the line drawn on the top and drops
// toward the body edge, between the line's two ends.
function bevelWedge(rc, arm, c, T) {
  const reach = arm.sMax + 30; // well past the farthest body edge
  const tx = -arm.ny, ty = arm.nx; // either direction along the line; the span is found below
  const l = Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
  const dir = ((c.x2 - c.x1) * tx + (c.y2 - c.y1) * ty) >= 0 ? 1 : -1;
  const at = (s, z) => [c.x1 + arm.nx * s, c.y1 + arm.ny * s, z];
  const face = rc.makePolygon([at(0, T), at(reach, T - arm.slope * reach), at(reach, T + PAST), at(0, T + PAST)]);
  return rc.basicFaceExtrusion(face, new rc.Vector([tx * dir * l, ty * dir * l, 0]));
}

// The shape a belly cut removes: depth = drop * (1 - u^2 - v^2), u toward the inside of the body and
// v along its edge. That surface is one parabola slid along another without turning, so it is built
// exactly that way: a parabola-topped profile (across u) carried along a parabola (across v).
function bellyBowl(rc, oc, dish, c) {
  const R = 1.2; // the tool reaches past the rim of the cut, where its surface is already below the back
  const D = dish.drop;
  const dx = c.x2 - c.x1, dy = c.y2 - c.y1, a = Math.hypot(dx, dy), b = c.len / 2;
  const ux = (dx / a) * a, uy = (dy / a) * a, vx = (-dy / a) * b, vy = (dx / a) * b;
  const at = (u, v, z) => [c.x1 + ux * u + vx * v, c.y1 + uy * u + vy * v, z];
  // z = D * (1 - u^2 - v^2). Along u at v = -R, and along v at u = 0, each is exactly a quadratic Bezier.
  const rim = D * (1 - 2 * R * R), floor = -3 * D - PAST;
  const top = rc.makeBezierCurve([at(-R, -R, rim), at(0, -R, D * (1 - R * R) + D * R * R), at(R, -R, rim)]);
  const profile = rc.assembleWire([
    top, rc.makeLine(at(R, -R, rim), at(R, -R, floor)), rc.makeLine(at(R, -R, floor), at(-R, -R, floor)), rc.makeLine(at(-R, -R, floor), at(-R, -R, rim)),
  ]);
  const spine = rc.assembleWire([rc.makeBezierCurve([at(-R, -R, rim), at(-R, 0, rim + 2 * D * R * R), at(-R, R, rim)])]);
  const sweep = new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped);
  const fixed = new oc.gp_Ax2(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1), new oc.gp_Dir(1, 0, 0));
  sweep.SetMode(fixed); // keep the profile upright and unturned the whole way
  sweep.Add(profile.wrapped, false, false);
  sweep.Build(new oc.Message_ProgressRange());
  sweep.MakeSolid();
  const out = rc.cast(sweep.Shape());
  sweep.delete(); fixed.delete();
  return out;
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
export function buildBodySolid(rc, oc, design, g, { roundovers = true, pockets = true } = {}) {
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
  const arm = bevelPlane(design.contours.arm, g.outline, centroidXY);
  if (arm) {
    arm.drop = Math.min(arm.drop, T - 3); arm.slope = arm.drop / arm.sMax;
    tools.push(bevelWedge(rc, arm, design.contours.arm, T));
  }
  const dish = bellyDish(design.contours.belly, T - 3);
  if (dish) tools.push(bellyBowl(rc, oc, dish, design.contours.belly));

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
