// The neck as a solid: the shaft and the heel, without the fretboard and without a headstock.
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
// Both the 3D picture and the CAD solid are built from `sections`: cross-sections at stations along the
// neck, each a closed outline in the plane across the neck.
//
// Frame: the body's own. x across (0 on the centerline), y along (toward the nut), z up from the body's
// back. The glue face sits at z = body thickness + how far the heel stands proud.
import { fretDistance } from '../core/fret.js';
import { signedArea } from '../core/poly.js';

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
  const at = (y) => {
    const s = toHeel(y), depth = shaftDepth(y) + (heelDepth - shaftDepth(y)) * s;
    // fullness climbs steeply at the end, so the neck is round for most of the blend and squares up at the heel
    const n = fullness + (SQUARE - fullness) * s ** 3;
    const half = halfAt(y);
    return { y, half, depth, n, pts: backCurve(half, depth, n) };
  };
  // (the last station sits a little way inside the heel block, so the two parts of the CAD solid overlap)
  // stations: closer together through the blend, where the shape changes fastest
  const ys = [];
  for (let y = g.nutY; y > shaftEnd + blend + 1e-6; y -= 20) ys.push(y);
  for (let i = 0; i <= 14; i++) ys.push(shaftEnd + blend - (blend * i) / 14);
  const sections = ys.map(at);
  const tail = { ...at(shaftEnd), y: shaftEnd - 5 };
  // the heel block: the pocket's own outline from its end wall up to where the shaft meets it
  const heel = g.pocketTo(shaftEnd);
  // volume: the shaft by its cross-sections, plus the heel block
  let shaft = 0;
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sectionArea(sections[i].pts), c = sectionArea(sections[i + 1].pts);
    shaft += ((a + c + Math.sqrt(a * c)) / 3) * (sections[i].y - sections[i + 1].y);
  }
  const heelVolume = Math.abs(signedArea(heel)) * heelDepth;
  return {
    top, heelBottom: top - heelDepth, heelDepth, shaftEnd, blend, board, fullness, d1, d12, y1, y12, at, sections, tail, heel, halfAt,
    volume: shaft + heelVolume, shaftVolume: shaft, heelVolume, length: g.nutY - g.heelY,
  };
}
