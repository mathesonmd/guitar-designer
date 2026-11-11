// Bridges. Local frame: x = 0 on the centerline (+x treble side), y = 0 on the scale line
// (the theoretical saddle line, exactly one scale length from the nut), +y toward the neck. Lengths in mm.
import { roundRect, translate, circlePoly } from '../core/poly.js';
import { SHOP } from './shop.js';

const IN = 25.4;
const row = (n, spacing) => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * spacing);

export const BRIDGES = {
  hipshot: {
    label: 'Hardtail, string-through (Hipshot .430 in)',
    basis: 'published', src: ['hipshot', 'warmothBridgeRouts'],
    stringSpacing: 0.43 * IN, // 10.922
    note: 'Hipshot drawing 41200M: plate 2.875 x 1.619 in, three mounting screws 0.890 in apart and 1.125 in behind the front edge, six string holes 0.430 in apart and 0.865 in behind the front edge.',
    placementNote: 'Hipshot’s drawing shows the saddle faces between 0.229 and 0.529 in behind the plate’s front edge. The default puts the scale line a quarter of the way into that travel, leaving the rest for intonation. This placement is reasoned from the drawing, not a Hipshot instruction: check it against your bridge before drilling.',
    params: { frontAhead: 0.304 * IN }, // plate front edge this far toward the neck from the scale line
    paramLabels: { frontAhead: 'Plate front edge ahead of the scale line' },
    paramBasis: { frontAhead: 'assumed' },
    geometry(b) {
      const F = b.params.frontAhead;
      const plate = translate(roundRect(2.875 * IN, 1.619 * IN, 2.5), 0, F - (1.619 * IN) / 2);
      return {
        outlines: [plate],
        saddleBand: { y0: F - 0.529 * IN, y1: F - 0.229 * IN, halfWidth: (2.875 * IN) / 2 },
        holes: [
          ...row(3, 0.89 * IN).map((x) => ({ x, y: F - 1.125 * IN, d: 3.18, kind: 'mount', label: 'Bridge screw', side: 'top' })),
          ...row(6, 0.43 * IN).map((x) => ({ x, y: F - 0.865 * IN, d: 3.18, kind: 'through', label: 'String hole', side: 'through' })),
          ...row(6, 0.43 * IN).map((x) => ({ x, y: F - 0.865 * IN, d: (5 / 16) * IN, kind: 'ferrule', label: 'String ferrule', side: 'back' })),
        ],
        routes: [],
      };
    },
    holeNote: 'String holes 1/8 in (3.18 mm) through the body; back side drilled 5/16 in for ferrules (Warmoth). Mounting screw marks are shown at 1/8 in: drill pilots to suit your screws.',
  },
  tom: {
    label: 'Tune-o-matic and stop tailpiece (Gotoh)',
    basis: 'published', src: ['gotohTom', 'warmothBridgeRouts'],
    stringSpacing: 10.4,
    note: 'Gotoh: bridge studs 74 mm apart, tailpiece studs 82 mm apart, saddles 10.4 mm apart (52 mm string spread), bridge anchors 11.3 mm diameter. The bass-side post sits 1/8 in (3.18 mm) farther back than the treble post.',
    placementNote: 'The bridge center sits behind the scale line by the average of your treble and bass compensation, with Gotoh’s 1/8 in slant. Gotoh notes a neck pocket angle of 1-1/2 to 3 degrees is needed with this bridge; this designer does not cut an angled pocket yet. Tailpiece distance follows Warmoth’s route (about 39.5 mm); Gotoh’s own sheet shows about 50 mm. Either works: it sets the string break angle.',
    params: { tailDistance: 39.5 },
    paramLabels: { tailDistance: 'Tailpiece studs behind the bridge' },
    paramBasis: { tailDistance: 'published' },
    geometry(b, ctx) {
      const yc = -(ctx.compTreble + ctx.compBass) / 2;
      const slant = (1 / 8) * IN / 2;
      const yT = yc + slant, yB = yc - slant;
      const bar = [{ x: -44, y: yB - 7 }, { x: 44, y: yT - 7 }, { x: 44, y: yT + 7 }, { x: -44, y: yB + 7 }];
      const tail = translate(roundRect(100, 16, 8), 0, yc - b.params.tailDistance);
      return {
        outlines: [bar, tail],
        holes: [
          { x: 37, y: yT, d: 11.3, kind: 'stud', label: 'Bridge post (treble)', side: 'top' },
          { x: -37, y: yB, d: 11.3, kind: 'stud', label: 'Bridge post (bass)', side: 'top' },
          { x: 41, y: yc - b.params.tailDistance, d: 11.3, kind: 'stud', label: 'Tailpiece stud', side: 'top', unsized: true },
          { x: -41, y: yc - b.params.tailDistance, d: 11.3, kind: 'stud', label: 'Tailpiece stud', side: 'top', unsized: true },
        ],
        routes: [],
      };
    },
    holeNote: 'Bridge anchors are 11.3 mm (Gotoh). Tailpiece stud holes are drawn the same size as a marker only: drill to fit the bushings you have.',
  },
  tStyle: {
    label: 'T-style bridge, string-through',
    basis: 'shop', src: ['shop', 'warmothBridgeRouts'],
    stringSpacing: SHOP.tBridge.stringSpacing,
    note: 'Hole pattern from the Black Chapel T-style class template (“Modern bridge”): six string holes 10.87 mm apart, three mounting screws at the centerline and 33 mm either side. Warmoth’s vintage T-style pattern uses nearly the same string spacing (0.429 in).',
    placementNote: 'String holes sit 10.2 mm behind the scale line, as on the Black Chapel template. Confirm against the bridge you are using.',
    params: {},
    geometry() {
      const t = SHOP.tBridge;
      return {
        outlines: [],
        holes: [
          ...row(6, t.stringSpacing).map((x) => ({ x, y: t.stringThroughY, d: t.stringHole, kind: 'through', label: 'String hole', side: 'through' })),
          ...row(6, t.stringSpacing).map((x) => ({ x, y: t.stringThroughY, d: (5 / 16) * IN, kind: 'ferrule', label: 'String ferrule', side: 'back' })),
          ...t.mountX.map((x) => ({ x, y: t.mountY, d: t.mountHole, kind: 'mount', label: 'Bridge screw', side: 'top' })),
        ],
        routes: [],
      };
    },
    holeNote: 'Holes are drawn 3.3 mm as on the Black Chapel template; back side 5/16 in for ferrules (Warmoth).',
  },
  none: {
    label: 'No bridge yet',
    basis: 'assumed', src: [],
    stringSpacing: 10.5,
    note: 'Strings are drawn at 10.5 mm spacing until you pick a bridge.',
    placementNote: '',
    params: {},
    geometry: () => ({ outlines: [], holes: [], routes: [] }),
    holeNote: '',
  },
};

// Holes whose depth depends on the hardware in hand. The design holds one depth per group, entered by
// the builder; until then the hole is a position and a diameter only.
export const HOLE_DEPTH_GROUPS = {
  mount: 'Bridge screw holes',
  ferrule: 'String ferrule holes',
  post: 'Bridge post holes',
  tail: 'Tailpiece stud holes',
};
export function holeDepthGroup(h) {
  if (h.kind === 'mount') return 'mount';
  if (h.kind === 'ferrule') return 'ferrule';
  if (h.kind === 'stud') return /tailpiece/i.test(h.label || '') ? 'tail' : 'post';
  return null;
}

export const holePoly = (h, tol = 0.01) => circlePoly(h.x, h.y, h.d / 2, tol);
