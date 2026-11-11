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
