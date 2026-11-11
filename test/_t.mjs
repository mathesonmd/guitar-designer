import * as rc from 'replicad';
import start from 'replicad-opencascadejs';
const oc = await start(); rc.setOC(oc);
const T = 44.45, PAST = 5;
const valid = (s) => { const c = new oc.BRepCheck_Analyzer(s.wrapped, true, false); const v = c.IsValid(); c.delete(); return v; };
const sweep = (profile, spine) => { const b = new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped); const ax = new oc.gp_Ax2(new oc.gp_Pnt(0,0,0), new oc.gp_Dir(0,0,1), new oc.gp_Dir(1,0,0)); b.SetMode(ax); b.Add(profile.wrapped, false, false); b.Build(new oc.Message_ProgressRange()); b.MakeSolid(); return rc.cast(b.Shape()); };
const cut = (body, tools) => { const a = new oc.NCollection_List_TopoDS_Shape(), l = new oc.NCollection_List_TopoDS_Shape(); a.Append(body.wrapped); tools.forEach((t) => l.Append(t.wrapped)); const op = new oc.BRepAlgoAPI_Cut(); op.SetArguments(a); op.SetTools(l); op.Build(new oc.Message_ProgressRange()); return rc.cast(op.Shape()); };
let body = rc.drawRoundedRectangle(330, 470, 60).sketchOnPlane('XY', 0).extrude(T);
body = body.fillet((e) => (Math.abs(e.startPoint.z - e.endPoint.z) < 1e-4 ? 3.175 : null));
const V0 = rc.measureVolume(body);
// ---- arm: line along y at x = -60, cutting toward -x. s = -(x + 60). profile in (x,z) plane at y = y0; spine along y
const sMax = 105, drop = 12, r = 8, F = 60, l = 200, y0 = -150;
const slope = drop / sMax, phi = Math.atan(slope), h = r * Math.tan(phi / 2);
const P = (s, z, y = y0 - F * 0.3) => [-60 - s, y, z];
// fillet: tangent on top at s = -h, on slope at s = h cos(phi); mid point of arc
const ec = -h, zc = T - r; const mid = [ec + r * Math.sin(phi / 2), zc + r * Math.cos(phi / 2)];
const reach = sMax + 30, H = T + 40;
const edges = [
  rc.makeThreePointArc(P(-h, T), P(mid[0], mid[1]), P(h * Math.cos(phi), T - slope * h * Math.cos(phi))),
  rc.makeLine(P(h * Math.cos(phi), T - slope * h * Math.cos(phi)), P(reach, T - slope * reach)),
  rc.makeLine(P(reach, T - slope * reach), P(reach, H)), rc.makeLine(P(reach, H), P(-h, H)), rc.makeLine(P(-h, H), P(-h, T)),
];
const profile = rc.assembleWire(edges);
// spine: starts 0.3F before the first end (risen), parabola down over F, flat, parabola up
const rise = (d) => drop * (d / F) ** 2; // d = distance from the inner edge of the fade zone toward the end
const Q = (y, dz) => [-60, y, dz]; // spine through profile reference s=0
const ext = 1.3; // run 30% past the end
const ya = y0, yb = y0 + l;
// quadratic bezier for z = k d^2 from d=0..D: points (0,0),(D/2,0),(D,kD^2)
const D = F * ext, zD = rise(D);
const spine = rc.assembleWire([
  rc.makeBezierCurve([Q(ya + F - D, zD), Q(ya + F - D / 2, 0), Q(ya + F, 0)]),
  rc.makeLine(Q(ya + F, 0), Q(yb - F, 0)),
  rc.makeBezierCurve([Q(yb - F, 0), Q(yb - F + D / 2, 0), Q(yb - F + D, zD)]),
]);
// profile must start where spine starts: move profile to spine start (y = ya+F-D, lifted zD)
let t = Date.now();
try {
  const prof2 = profile.translate([0, (ya + F - D) - (y0 - F * 0.3), zD]);
  const tool = sweep(prof2, spine);
  console.log('arm tool valid', valid(tool), 'vol', rc.measureVolume(tool).toFixed(0), Date.now() - t, 'ms');
  const b2 = cut(body, [tool]);
  console.log('arm cut valid', valid(b2), 'removed', (V0 - rc.measureVolume(b2)).toFixed(0), Date.now() - t, 'ms');
} catch (e) { console.log('ARM FAIL', e.message || e); }
// ---- bowl with blended rim: center (-165, 60) on the edge, a = 70 (across x), b = 95 (along y), drop 14, rim radius 10
t = Date.now();
try {
  const a = 70, b = 95, Dp = 14, R = 1.25, cx = -165, cy = 60, rr = 10;
  const at = (u, v, z) => [cx + a * u, cy + b * v, z];
  const rim = Dp * (1 - 2 * R * R), floor = -3 * Dp - PAST;
  const top = rc.makeBezierCurve([at(-R, -R, rim), at(0, -R, Dp * (1 - R * R) + Dp * R * R), at(R, -R, rim)]);
  const prof = rc.assembleWire([top, rc.makeLine(at(R, -R, rim), at(R, -R, floor)), rc.makeLine(at(R, -R, floor), at(-R, -R, floor)), rc.makeLine(at(-R, -R, floor), at(-R, -R, rim))]);
  const sp = rc.assembleWire([rc.makeBezierCurve([at(-R, -R, rim), at(-R, 0, rim + 2 * Dp * R * R), at(-R, R, rim)])]);
  let bowl = sweep(prof, sp);
  // keep only what is above the back face, then add a slab below it and blend the inside corner
  const slab = rc.drawRoundedRectangle(2 * a * R + 60, 2 * b * R + 60).translate(cx, cy).sketchOnPlane('XY', -PAST).extrude(PAST);
  const upper = bowl.intersect(rc.drawRoundedRectangle(2 * a * R + 60, 2 * b * R + 60).translate(cx, cy).sketchOnPlane('XY', 0).extrude(Dp + 5));
  let tool = upper.fuse(slab);
  console.log('bowl+slab valid', valid(tool), Date.now() - t, 'ms');
  const n0 = rc.measureVolume(tool);
  let count = 0;
  tool = tool.fillet((e) => { const z0 = e.startPoint.z, z1 = e.endPoint.z; const m = e.pointAt(0.5); const rho = Math.hypot((m.x - cx) / a, (m.y - cy) / b); const hit = Math.abs(z0) < 1e-6 && Math.abs(z1) < 1e-6 && Math.abs(m.z) < 1e-6 && Math.abs(rho - 1) < 1e-3; if (hit) count++; return hit ? rr : null; });
  console.log('rim edges', count, 'filleted valid', valid(tool), 'added', (rc.measureVolume(tool) - n0).toFixed(0), Date.now() - t, 'ms');
  const b3 = cut(body, [tool]);
  console.log('bowl cut valid', valid(b3), 'removed', (V0 - rc.measureVolume(b3)).toFixed(0), Date.now() - t, 'ms');
} catch (e) { console.log('BOWL FAIL', e.message || e); }
