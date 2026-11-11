// Woods, router tooling and small parts. Lengths in mm.
const IN = 25.4;

// Average dried weight from The Wood Database. Real boards vary a lot: weigh yours if it matters.
export const WOODS = {
  alder: { label: 'Red alder', density: 450, lbft3: 28.0 },
  basswood: { label: 'Basswood', density: 415, lbft3: 26.0 },
  poplar: { label: 'Yellow poplar', density: 455, lbft3: 29 },
  mahogany: { label: 'Honduran mahogany', density: 590, lbft3: 36.8 },
  walnut: { label: 'Black walnut', density: 610, lbft3: 38 },
  ash: { label: 'White ash', density: 675, lbft3: 42 },
  maple: { label: 'Hard maple', density: 705, lbft3: 44.0 },
  custom: { label: 'Custom density', density: 500, lbft3: null },
};

// Guide bushing outside diameters in the common Porter-Cable-style sets (Amana BTG-100).
export const BUSHINGS = [5 / 16, 3 / 8, 7 / 16, 1 / 2, 5 / 8, 3 / 4, 51 / 64].map((v) => ({ inches: v, mm: v * IN }));
export const BUSHING_LABELS = ['5/16', '3/8', '7/16', '1/2', '5/8', '3/4', '51/64'];

// Common router bit diameters. These are just convenient choices, not recommendations.
export const BITS = [
  { label: '1/4 in', mm: IN / 4 }, { label: '5/16 in', mm: (5 / 16) * IN }, { label: '3/8 in', mm: (3 / 8) * IN },
  { label: '1/2 in', mm: IN / 2 }, { label: '3/4 in', mm: 0.75 * IN },
  { label: '6 mm', mm: 6 }, { label: '8 mm', mm: 8 }, { label: '10 mm', mm: 10 }, { label: '12 mm', mm: 12 },
];

// Hole choices for pots, switches and jacks. Match the part you bought: nothing here is a spec.
export const CONTROL_KINDS = {
  pot: { label: 'Pot', d: (3 / 8) * IN, clearance: 24 },
  switch: { label: 'Toggle switch', d: 12, clearance: 20 },
  jack: { label: 'Output jack', d: (3 / 8) * IN, clearance: 22 },
};
export const CONTROL_NOTE = 'Hole sizes are starting values (3/8 in for pots and jacks, 12 mm for toggles). Measure the bushing on your part.';

// Binding channel: a starting size only (basis: assumed). Binding strip comes in many sizes, so the
// channel has to be set to the strip in hand: its thickness is the channel's width, its height the depth.
export const BINDING_START = { width: 1.5, depth: 6 };

// Bevel around the top edge: a starting width and depth only (basis: assumed). It is shaped by eye.
export const EDGE_BEVEL_START = { width: 15, drop: 6 };

// Belly cut: the radius of the short smooth transition at its rim. A starting size only (basis: assumed).
export const BELLY_BLEND_START = 25;

export const DEFAULT_THICKNESS = 1.75 * IN; // 44.45 — the usual solid-body blank; set it to your blank
export const WOOD_LEFT_UNDER_CONTROLS = 0.25 * IN; // Black Chapel T-style template routes controls 1.5 in deep in a 1.75 in body
