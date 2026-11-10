// Builds src/data/shop.js from the Black Chapel Studios class-template DXF geometry, parsed to JSON
// (tmod.json for the T-style master, jmain.json for the J-style body). Those files are not in the repository.
// Usage: node tools/make_shop_data.mjs <folder holding tmod.json and jmain.json>
// Coordinates are moved into the designer's frame: x = 0 on the centerline (+x = treble side),
// y = 0 on the scale line (theoretical saddle line), +y toward the neck. Units: mm.
import fs from 'node:fs';
import { fitClosed } from '../src/core/fit.js';
import { flattenNodes } from '../src/core/path.js';
import { signedArea, dedupe, distToPoly, bbox } from '../src/core/poly.js';

import path from 'node:path';
if (!process.argv[2]) { console.error('Usage: node tools/make_shop_data.mjs <folder holding tmod.json and jmain.json>'); process.exit(1); }
const REF = path.resolve(process.argv[2]) + path.sep;
const load = (f) => JSON.parse(fs.readFileSync(REF + f, 'utf8'));

function bulgePts(a, b, bulge, tol = 0.01) {
  if (Math.abs(bulge) < 1e-9) return [b];
  const theta = 4 * Math.atan(bulge), d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 1e-9) return [b];
  const r = d / (2 * Math.sin(Math.abs(theta) / 2));
  const h = r * Math.cos(theta / 2) * Math.sign(theta);
  const cx = (a.x + b.x) / 2 - ((b.y - a.y) / d) * h, cy = (a.y + b.y) / 2 + ((b.x - a.x) / d) * h;
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const step = 2 * Math.acos(Math.max(-1, 1 - tol / r));
  const k = Math.max(2, Math.ceil(Math.abs(theta) / step));
  const out = [];
  for (let j = 1; j <= k; j++) out.push({ x: cx + r * Math.cos(a0 + (theta * j) / k), y: cy + r * Math.sin(a0 + (theta * j) / k) });
  return out;
}
function polyOf(e) {
  const v = e.v, P = [];
  for (let i = 0; i < v.length; i += 3) P.push({ x: v[i], y: v[i + 1], b: v[i + 2] });
  const out = [{ x: P[0].x, y: P[0].y }];
  const m = P.length;
  for (let i = 0; i < (e.c ? m : m - 1); i++) out.push(...bulgePts(P[i], P[(i + 1) % m], P[i].b));
  return e.c ? dedupe(out) : out;
}
// Douglas-Peucker simplification of a closed polygon
function simplify(pts, tol) {
  const n = pts.length;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) { const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y); if (d > fd) { fd = d; far = i; } }
  const dp = (arr) => {
    if (arr.length < 3) return arr;
    const a = arr[0], b = arr[arr.length - 1];
    let md = -1, mi = 0;
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    for (let i = 1; i < arr.length - 1; i++) { const d = Math.abs((arr[i].x - a.x) * dy - (arr[i].y - a.y) * dx) / l; if (d > md) { md = d; mi = i; } }
    if (md <= tol) return [a, b];
    return [...dp(arr.slice(0, mi + 1)).slice(0, -1), ...dp(arr.slice(mi))];
  };
  const A = dp(pts.slice(0, far + 1)), B = dp([...pts.slice(far), pts[0]]);
  return [...A.slice(0, -1), ...B.slice(0, -1)];
}
const r2 = (v) => Math.round(v * 100) / 100;
const flat = (pts) => pts.flatMap((p) => [r2(p.x), r2(p.y)]);
const ccw = (p) => (signedArea(p) < 0 ? p.slice().reverse() : p);

/* ---------------- T-style ---------------- */
const T = load('tmod.json');
const POCKET_END_T = 117.09, HEEL_TO_SCALE = 180.72;       // pocket end wall; nut-to-heel 466.98 on a 647.70 scale
const SCALE_Y_T = POCKET_END_T - HEEL_TO_SCALE;
const shiftT = (p) => p.map((q) => ({ x: q.x, y: q.y - SCALE_Y_T }));
const prof = T.ents.filter((e) => e.l === 'PROFILE').map(polyOf);
// chain the two open profile runs into one loop
const [A, B] = prof;
const ends = (p) => [p[0], p[p.length - 1]];
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
let loop;
{
  const [a0, a1] = ends(A), [b0, b1] = ends(B);
  const opts = [
    [d(a1, b0) + d(b1, a0), () => [...A, ...B]],
    [d(a1, b1) + d(b0, a0), () => [...A, ...B.slice().reverse()]],
  ].sort((x, y) => x[0] - y[0]);
  loop = dedupe(opts[0][1](), 1e-4);
  console.log('T profile: end gaps', [d(a1, b0), d(b1, a0), d(a1, b1), d(b0, a0)].map((v) => v.toFixed(2)).join(' '));
}
const tBody = ccw(shiftT(loop));
const tBridgeRoute = ccw(shiftT(polyOf(T.ents[67])));
const tNeckRoute = ccw(shiftT(polyOf(T.ents[0])));
const bb = bbox(tBody);
console.log('T body bbox', bb.x0.toFixed(1), bb.x1.toFixed(1), bb.y0.toFixed(1), bb.y1.toFixed(1), 'pts', tBody.length, 'area', signedArea(tBody).toFixed(0));

/* ---------------- J-style ---------------- */
const J = load('jmain.json');
const POCKET_END_J = 95.27 - 13.49;                         // first screw row sits 13.49 mm from the heel end (T template)
const SCALE_Y_J = POCKET_END_J - HEEL_TO_SCALE;
const shiftJ = (p) => p.map((q) => ({ x: q.x, y: q.y - SCALE_Y_J }));
const jBody = ccw(shiftJ(polyOf(J.ents.find((e) => e.l === 'BODY_OUTLINE'))));
const jb = bbox(jBody);
console.log('J body bbox', jb.x0.toFixed(1), jb.x1.toFixed(1), jb.y0.toFixed(1), jb.y1.toFixed(1), 'pts', jBody.length);

/* ---------------- fit editable starter outlines ---------------- */
const starters = {};
for (const [key, body] of [['t', tBody], ['j', jBody]]) {
  const nodes = fitClosed(body, 0.35);
  const back = flattenNodes(nodes, true, 0.01);
  let worst = 0;
  for (let i = 0; i < body.length; i += 3) worst = Math.max(worst, distToPoly(body[i], back, true).d);
  console.log(key, 'starter nodes', nodes.length, 'corners', nodes.filter((n) => n.k === 'c').length, 'max deviation', worst.toFixed(3));
  starters[key] = nodes.map((n) => [r2(n.x), r2(n.y), r2(n.ix), r2(n.iy), r2(n.ox), r2(n.oy), n.k]);
}

const out = `// GENERATED by tools/make_shop_data.mjs from Black Chapel Studios class templates. Do not edit by hand.
// Frame: x = 0 centerline (+x treble side), y = 0 scale line, +y toward the neck. Millimeters.
export const SHOP = {
  // numbers read from the T-style template set
  pocketEndToScale: ${HEEL_TO_SCALE},          // pocket end wall to the 25.5 in scale line
  nutToHeel: 466.98,                 // nut face to heel end on the neck template (25.5 in scale, 21 frets)
  pocketWidth: 55.40, pocketLength: 73.82, pocketCornerR: 5.3, heelCornerR: 6.35,
  screwPattern: { across: 38.1, along: 50.8, firstRowFromHeelEnd: 13.49, bodyHole: 4.06 },
  tBridge: {
    stringThroughY: ${r2(-73.86 - SCALE_Y_T)}, stringSpacing: 10.87, stringHole: 3.3,
    mountY: ${r2(-78.91 - SCALE_Y_T)}, mountX: [-32.98, 0, 32.98], mountHole: 3.3,
  },
  ghosts: {
    tStyle: [${flat(simplify(tBody, 0.04)).join(',')}],
    jStyle: [${flat(simplify(jBody, 0.04)).join(',')}],
  },
  routes: {
    tBridgePickup: [${flat(simplify(tBridgeRoute, 0.03)).join(',')}],
    tNeckPickup: [${flat(simplify(tNeckRoute, 0.03)).join(',')}],
  },
  starters: ${JSON.stringify(starters)},
};
`;
fs.writeFileSync(new URL('../src/data/shop.js', import.meta.url), out);
console.log('wrote src/data/shop.js', out.length, 'bytes; ghost pts T', simplify(tBody, 0.04).length, 'J', simplify(jBody, 0.04).length,
  'routes', simplify(tBridgeRoute, 0.03).length, simplify(tNeckRoute, 0.03).length);
