// Neck back profiles: how thick the neck is, fretboard included, at the 1st and 12th frets. Lengths in mm.
// The thicknesses are Warmoth's published figures. Warmoth publishes no numbers for the shape of the
// curve itself (how full the shoulders are), so that is a separate setting with no source: see
// NECK_SHAPE_START.
const IN = 25.4;
export const NECK_PROFILES = {
  standardThin: { label: 'Standard Thin', t1: 0.8 * IN, t12: 0.85 * IN, note: 'Warmoth: 0.800 in at the 1st fret, 0.850 in at the 12th. Similar to a modern American Standard Strat or Tele.' },
  roundback59: { label: '’59 Roundback', t1: 0.86 * IN, t12: 0.96 * IN, note: 'Warmoth: 0.860 in at the 1st fret, 0.960 in at the 12th. Based on early Les Paul neck dimensions.' },
  wizard: { label: 'Wizard', t1: 0.75 * IN, t12: 0.82 * IN, note: 'Warmoth: 0.750 in at the 1st fret, 0.820 in at the 12th. A thin, flat shape.' },
  fatback: { label: 'Fatback', t1: 0.965 * IN, t12: 0.965 * IN, note: 'Warmoth: 0.965 in at both frets, with no taper. Their thickest, roundest profile.' },
  boatneck: { label: 'Boatneck', t1: 0.965 * IN, t12: 0.965 * IN, note: 'Warmoth: 0.965 in at both frets. Smaller shoulders than the Fatback.' },
};
export const NECK_PROFILE_BASIS = ['published', 'warmothNeckProfiles'];

// Starting values with no published source (basis: assumed). Measure a neck you like and set these.
//   board    thickness of the fretboard at its center, which the back carve does not include
//   fullness how full the shoulders are: 2 is a half ellipse; higher is fuller, lower is slimmer
//   blend    length over which the round back turns into the square heel
export const NECK_SHAPE_START = { board: 0.25 * IN, fullness: 2, blend: 30 };

// An angled headstock: starting values with no published source (basis: assumed).
//   angle         how far the headstock tilts back from the line of the neck, in degrees
//   thickness     how thick the headstock is
//   voluteHeight  how far the volute (the swell on the back, under the nut) stands out from the neck's back
//   voluteLength  how far the volute reaches from the nut toward the heel
//   voluteAhead   how far it reaches from the nut toward the headstock (often shorter, so that side is steeper)
//   voluteStyle   'smooth' (rounded over the top), 'peak' (comes to a point under the nut) or 'tongue' (the flat of
//                 the headstock's back carried down the neck to a tip, with a crisp edge)
//   tongueTip     'round' or 'point': the shape of the tongue's tip
//   tongueCove    the width of the hollow that runs from the tongue's edge out into the neck's round back
//   side          the side view of the back when it is drawn: { on, points: [{ s, out, k }] } (see sideLine in
//                 model/neck.js); off, the volute's numbers above are used
//   transition    the length past the nut over which the neck's round back becomes the headstock's flat one
export const HEADSTOCK_START = { angle: 14, thickness: 15, voluteHeight: 4, voluteLength: 40, voluteAhead: 25, voluteStyle: 'smooth', tongueTip: 'round', tongueCove: 8, transition: 45, side: { on: false, points: [] } };

// A starting outline for the headstock: an original shape to redraw. It is drawn flat, at its true shape,
// x across and y along the headstock's face from the nut. Its two ends are pinned to the corners of the
// nut, so only the points between them are stored as drawn.
const N = (a) => a.map(([x, y, ix, iy, ox, oy, k]) => ({ x, y, ix, iy, ox, oy, k }));
export const HEADSTOCK_OUTLINE_START = N([
  [-20.95, 0, 0, 0, 0, 8, 'c'],
  [-36, 38, 4, -14, -3, 14, 's'],
  [-40, 110, 0, -25, 0, 22, 's'],
  [-24, 168, -12, -10, 10, 8, 's'],
  [0, 180, -10, 0, 10, 0, 's'],
  [24, 168, -10, 8, 12, -10, 's'],
  [40, 110, 0, 22, 0, -25, 's'],
  [36, 38, 3, 14, -4, -14, 's'],
  [20.95, 0, 0, 8, 0, 0, 'c'],
]);
