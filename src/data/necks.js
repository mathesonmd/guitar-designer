// Bolt-on neck standards. All lengths in mm.
// Each field in `basis` says where that number came from (see sources.js).
import { SHOP } from './shop.js';

const IN = 25.4;
const FENDER_BASE = {
  scale: 647.7,                // 25.5 in
  nutToHeel: SHOP.nutToHeel,   // 466.98: nut face to the end of the heel
  heelWidth: (2 + 3 / 16) * IN, // 55.5625 at the heel end
  mouthWidth: (2 + 3 / 16) * IN, // pocket width where the neck leaves the body (same = parallel pocket)
  pocketLength: 3 * IN,        // 76.2
  pocketDepth: (5 / 8) * IN,   // 15.875
  heelStandProud: (1 / 8) * IN, // heel sits this far above the body top
  nutWidth: 41.9,              // 1.650 in; for drawing strings and the fretboard
  boardPastHeel: 0,            // fretboard overhang beyond the end of the heel
  screwAcross: 1.5 * IN,       // 38.1
  screwAlong: 2 * IN,          // 50.8
  screwFromHeelEnd: SHOP.screwPattern.firstRowFromHeelEnd, // 13.49
  screwBodyHole: (3 / 16) * IN, // 4.76 clearance hole through the body
  screwNeckPilot: (1 / 8) * IN, // 3.18 pilot in the neck
};

const FENDER_BASIS = {
  scale: ['published', 'warmothNeckFit', 'Warmoth: “The standard scale length for Warmoth guitar parts is 25-1/2 in.”'],
  heelWidth: ['published', 'warmothPocket', 'Warmoth: Strat and Tele pockets are 2-3/16 in (56 mm) wide.'],
  mouthWidth: ['published', 'warmothPocket', 'Warmoth publishes one pocket width. Real necks taper slightly through the heel; measure yours if you want a tapered pocket.'],
  pocketLength: ['published', 'warmothPocket', 'Warmoth: pocket length 3 in (76 mm).'],
  pocketDepth: ['published', 'warmothPocket', 'Warmoth: pocket depth 5/8 in (16 mm). Their “720 Mod” is 0.720 in.'],
  heelStandProud: ['published', 'warmothPocket', 'Warmoth’s pocket depth drawing shows the heel standing 1/8 in (3 mm) above the body.'],
  nutToHeel: ['shop', 'shop', 'Measured on the Fender-pattern neck in the Black Chapel T-style templates: 466.98 mm (18.385 in). No maker publishes this. Measure your neck before cutting.'],
  heelCornerR: ['shop', 'shop', 'Heel corner radius on the Black Chapel T-style neck template is 6.35 mm (1/4 in). Not published by Fender or Warmoth.'],
  screwAcross: ['published', 'stewmacNeckPlate', 'StewMac neck plate: mounting hole spacing 1-1/2 in x 2 in. The Black Chapel templates match.'],
  screwAlong: ['published', 'stewmacNeckPlate', 'StewMac neck plate: mounting hole spacing 1-1/2 in x 2 in.'],
  screwFromHeelEnd: ['shop', 'shop', 'First screw row is 13.49 mm from the heel end on the Black Chapel T-style template. Check against a pre-drilled neck.'],
  screwBodyHole: ['published', 'stewmacNeckPlate', 'StewMac recommends 3/16 in holes in the body and 1/8 in holes in the neck.'],
  screwNeckPilot: ['published', 'stewmacNeckPlate', 'StewMac recommends 1/8 in holes in the neck. Warmoth pre-drills necks at 1/8 in.'],
  nutWidth: ['assumed', 'shop', 'Used for drawing only. 1.650 in matches the Black Chapel neck template; set it to your neck.'],
  boardPastHeel: ['assumed', null, 'Fretboard overhang past the heel. Measure your neck.'],
};

export const NECK_PRESETS = {
  fender21: {
    label: 'Fender-pattern, 25.5 in, 21 frets, rounded heel',
    note: 'Fits Strat-style replacement necks from Fender, Warmoth and others built to the same pocket.',
    values: { ...FENDER_BASE, frets: 21, heelCornerR: SHOP.heelCornerR },
    basis: FENDER_BASIS,
  },
  fender22: {
    label: 'Fender-pattern, 25.5 in, 22 frets with overhang',
    note: 'Same heel and pocket as a 21-fret neck; the fretboard extends past the heel to carry the 22nd fret.',
    values: { ...FENDER_BASE, frets: 22, heelCornerR: SHOP.heelCornerR, boardPastHeel: 10.8 },
    basis: {
      ...FENDER_BASIS,
      boardPastHeel: ['assumed', null, 'Assumes the board runs as far past the 22nd fret as a 21-fret board runs past the 21st (11.8 mm). Measure your neck.'],
    },
  },
  tele21: {
    label: 'Fender-pattern, 25.5 in, 21 frets, squared heel',
    note: 'Tele-style heel. Warmoth: a squared heel will not seat in a rounded pocket, so the pocket corners must be squared too.',
    values: { ...FENDER_BASE, frets: 21, heelCornerR: 0 },
    basis: {
      ...FENDER_BASIS,
      heelCornerR: ['published', 'warmothNeckFit', 'Warmoth: “A Tele neck has a squared heel, while a Strat neck’s heel is rounded.”'],
    },
  },
  custom: {
    label: 'Custom: measured from my neck',
    note: 'Enter every dimension from the neck you have in hand.',
    values: { ...FENDER_BASE, frets: 22, heelCornerR: SHOP.heelCornerR },
    basis: {},
  },
};

export const NECK_FIELDS = [
  ['scale', 'Scale length'],
  ['frets', 'Frets'],
  ['nutToHeel', 'Nut to end of heel'],
  ['heelWidth', 'Heel width at the end'],
  ['mouthWidth', 'Pocket width at the body edge'],
  ['heelCornerR', 'Heel corner radius'],
  ['pocketDepth', 'Pocket depth'],
  ['boardPastHeel', 'Fretboard overhang past heel'],
  ['nutWidth', 'Nut width'],
];

// Plain names for every neck number, for the sources table.
export const NECK_LABELS = {
  scale: 'Scale length',
  heelWidth: 'Heel width at the end',
  mouthWidth: 'Pocket width at the body edge',
  pocketLength: 'Pocket length',
  pocketDepth: 'Pocket depth',
  heelStandProud: 'Heel height above the body top',
  nutToHeel: 'Nut to end of heel',
  heelCornerR: 'Heel corner radius',
  screwAcross: 'Neck screws, spacing across',
  screwAlong: 'Neck screws, spacing along',
  screwFromHeelEnd: 'First screw row, from the heel end',
  screwBodyHole: 'Screw hole through the body',
  screwNeckPilot: 'Pilot hole in the neck',
  nutWidth: 'Nut width',
  boardPastHeel: 'Fretboard overhang past the heel',
};
