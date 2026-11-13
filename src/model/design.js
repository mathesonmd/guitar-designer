// The design document: everything a guitar design is made of, in millimeters.
// Frame: x = 0 on the centerline (+x = treble side, as seen from the front with the neck up),
// y = 0 on the scale line (exactly one scale length from the nut), +y toward the neck.
import { NECK_PRESETS } from '../data/necks.js';
import { BINDING_START, BELLY_BLEND_START, EDGE_BEVEL_START, PURFLING_START } from '../data/parts.js';
import { NECK_PROFILES, NECK_SHAPE_START, HEADSTOCK_START, HEADSTOCK_OUTLINE_START } from '../data/neckprofiles.js';
import { bellyParams } from './solid.js';
import { BRIDGES } from '../data/bridges.js';
import { PICKUPS, PICKUP_HOME } from '../data/pickups.js';
import { SHOP } from '../data/shop.js';
import { DEFAULT_THICKNESS, WOOD_LEFT_UNDER_CONTROLS, CONTROL_KINDS } from '../data/parts.js';

export const SCHEMA = 'blackchapel.guitar/v1';
const IN = 25.4;
let uid = 1;
export const newId = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

const N = (a) => a.map(([x, y, ix, iy, ox, oy, k]) => ({ x, y, ix, iy, ox, oy, k }));

// Starting shapes. The first two are fitted to the Black Chapel class templates (within 0.35 mm);
// the others are original outlines meant to be reshaped.
export const STARTERS = {
  doublecut: {
    label: 'Double-cut',
    note: 'An original offset double-cutaway to reshape.',
    outline: {
      symmetric: false,
      nodes: N([
        [-28, 256, 0, 0, -4, -9, 'c'],
        [-47, 243, 9, 5, -15, -8, 's'],
        [-84, 316, 9, -18, -5, 10, 's'],
        [-106, 318, 6, 10.4, -10, -17, 's'],
        [-150, 208, 0, 52, 0, -40, 's'],
        [-121, 98, 0, 40, 0, -40, 's'],
        [-163, -36, 0, 48, 0, -52, 's'],
        [5, -148, -85, 0, 85, 0, 's'],
        [163, -42, 0, -52, 0, 46, 's'],
        [124, 84, 0, -40, 0, 34, 's'],
        [140, 172, 0, -30, 0, 30, 's'],
        [101, 281, 8, -16, -5, 10, 's'],
        [79, 282, 5, 10, -8, -16, 's'],
        [47, 230, 13, -2, -9, 3, 's'],
        [28, 252, 4, -9, 0, 0, 'c'],
      ]),
    },
  },
  tstyle: { label: 'T-style', note: 'Fitted to the Black Chapel T-style class template.', outline: { symmetric: false, nodes: N(SHOP.starters.t) } },
  jstyle: { label: 'Offset (J-style)', note: 'Fitted to the Black Chapel J-style class template.', outline: { symmetric: false, nodes: N(SHOP.starters.j) } },
  blank: {
    label: 'Symmetric blank',
    note: 'A plain mirrored shape. Edit one side and the other follows.',
    outline: {
      symmetric: true,
      nodes: N([
        [0, 258, 0, 0, -46, 0, 's'],
        [-142, 188, 0, 44, 0, -40, 's'],
        [-118, 84, 0, 34, 0, -38, 's'],
        [-164, -36, 0, 46, 0, -54, 's'],
        [0, -148, -88, 0, 0, 0, 's'],
      ]),
    },
  },
};

export function makePickup(type, where) {
  const def = PICKUPS[type];
  const home = PICKUP_HOME[where || def.defaultPos] || PICKUP_HOME.middle;
  return {
    id: newId('pu'), type, x: home.x || 0, y: home.y, angle: 0, flip: false,
    depth: def.depth, legExtra: 0, len: 90, wid: 40, rad: 4,
  };
}

export function makeControl(kind, x, y) {
  return { id: newId('ct'), kind, x, y, d: CONTROL_KINDS[kind].d };
}

export function makeCavity(x, y, thickness) {
  return {
    id: newId('cv'), name: 'Control cavity', side: 'back', x, y, w: 62, h: 118, r: 14, angle: 0,
    depth: Math.max(5, thickness - WOOD_LEFT_UNDER_CONTROLS), cover: false, ledge: 6, coverDepth: 3,
  };
}

// `base` remembers which standard the numbers started from, so a field that still holds the
// standard's value keeps its source note and its "measure before you cut" check after other fields change.
export function applyNeckPreset(neck, key) {
  const p = NECK_PRESETS[key];
  return key === 'custom' ? { ...neck, preset: key } : { ...neck, ...p.values, preset: key, base: key };
}

// Where a neck number came from: the standard's source entry while the field still holds the
// standard's value, otherwise null (the number is the user's own).
export function neckBasis(design, key) {
  const nk = design.neck;
  const std = NECK_PRESETS[nk.preset !== 'custom' ? nk.preset : nk.base];
  if (!std || !std.basis || !std.basis[key]) return null;
  const v = std.values[key];
  return typeof v === 'number' && Math.abs(v - nk[key]) < 1e-6 ? std.basis[key] : null;
}

// A number counts as confirmed only while it still has the value that was confirmed.
export function isVerified(design, key) {
  const v = (design.verified || {})[key];
  return typeof v === 'number' && Math.abs(v - design.neck[key]) < 1e-6;
}

// Neck numbers that come from shop templates or assumptions and have not been confirmed on the real neck.
export function unverifiedNeckKeys(design) {
  return ['nutToHeel', 'heelCornerR', 'screwFromHeelEnd', 'boardPastHeel'].filter((key) => {
    const b = neckBasis(design, key);
    return b && (b[0] === 'shop' || b[0] === 'assumed') && !isVerified(design, key);
  });
}

// `depths` holds the builder's own drilling depths, by hole group (see HOLE_DEPTH_GROUPS). Empty = not set.
// The shape of the neck's back: a thickness profile (published) and three shape settings (starting values).
export function makeNeckBack(profile) {
  const p = NECK_PROFILES[profile] || NECK_PROFILES.standardThin;
  return { profile: NECK_PROFILES[profile] ? profile : 'standardThin', t1: p.t1, t12: p.t12, ...NECK_SHAPE_START };
}

// The headstock: angled, with a volute, and an outline to redraw. `open` marks an outline whose two ends
// are fixed (here, to the corners of the nut) with the points between them free.
export function makeHeadstock() {
  return { on: true, ...HEADSTOCK_START, outline: { open: true, nodes: HEADSTOCK_OUTLINE_START.map((n) => ({ ...n })) } };
}

export function makeBridge(type) {
  return { type, params: { ...(BRIDGES[type].params || {}) }, depths: {} };
}

// The edge roundovers as they will really be cut: switched off, or too big for the body, comes out as 0.
// A binding channel takes the top edge, so the top roundover is left out while one is on.
export function edgeRounds(design) {
  const b = design.body, T = b.thickness, lim = (r) => Math.max(0, Math.min(r || 0, T / 2 - 0.5));
  return {
    top: b.roundTopOn === false || (b.binding && b.binding.on && !edgeBevel(design)) ? 0 : lim(b.roundTop),
    back: b.roundBackOn === false ? 0 : lim(b.roundBack),
  };
}

// The bevel around the top edge, or null when it is off. `width` and `drop` are its general width and its
// general depth at the body edge; an outline point can carry its own (`bw`, `bd`). `roll` is 0 for a flat
// bevel, up to 1 for one that leaves the top level and steepens toward the edge.
export function edgeBevel(design) {
  const c = design.body.edgeBevel, T = design.body.thickness;
  if (!c || !c.on) return null;
  return { width: Math.max(0, c.width || 0), drop: Math.max(0, Math.min(c.drop || 0, T - 3)), roll: Math.max(0, Math.min(1, c.roll || 0)) };
}

// The purfling channel that follows the edge bevel's inner line, or null when it is off (or there is no bevel).
export function purflingChannel(design) {
  const c = design.body.edgeBevel, T = design.body.thickness;
  if (!edgeBevel(design) || !c.purfling || !(c.purflingWidth > 0.05) || !(c.purflingDepth > 0.05)) return null;
  return { width: c.purflingWidth, depth: Math.min(c.purflingDepth, T - 3) };
}

// The binding channel, or null when it is off: a ledge `width` in from the body edge, `depth` down from the top.
export function bindingChannel(design) {
  const c = design.body.binding, T = design.body.thickness;
  if (!c || !c.on || !(c.width > 0.05) || !(c.depth > 0.05) || edgeBevel(design)) return null; // an edge bevel takes the top edge
  return { width: c.width, depth: Math.min(c.depth, T - 3) };
}

export function defaultDesign() {
  const thickness = DEFAULT_THICKNESS;
  return {
    schema: SCHEMA,
    name: 'Untitled guitar',
    units: 'in',
    outline: JSON.parse(JSON.stringify(STARTERS.doublecut.outline)),
    body: { thickness, roundTop: IN / 8, roundTopOn: true, roundBack: IN / 8, roundBackOn: true, binding: { on: false, ...BINDING_START }, edgeBevel: { on: false, ...EDGE_BEVEL_START, roll: 0, purfling: false, purflingWidth: PURFLING_START.width, purflingDepth: PURFLING_START.depth }, wood: 'alder', customDensity: 500 },
    neck: { ...applyNeckPreset({}, 'fender22'), back: makeNeckBack('standardThin'), head: makeHeadstock() },
    strings: { count: 6, nutSpread: 1.375 * IN },
    compensation: { treble: 0.03 * IN, bass: 0.09 * IN },
    bridge: makeBridge('hipshot'),
    pickups: [makePickup('humbucker', 'bridge'), makePickup('strat', 'middle'), makePickup('strat', 'neck')],
    controls: [makeControl('switch', 108, 3), makeControl('pot', 97, -32), makeControl('pot', 86, -66)],
    cavities: [{ ...makeCavity(98, -28, thickness), angle: -0.3 }],
    contours: {
      // arm bevel: the line through (x1, y1) and (x2, y2) on the top, running right across the body. It
      // starts fully rolled (roll 1), the shape a flat sander leaves: straight along the line, curved across it.
      arm: { on: false, x1: -164, y1: 30, x2: -70, y2: -150, drop: 12, roll: 1, blend: 0, bounded: false, fade: 0 },
      // belly cut: a wide, short cone centered on (x, y) at the body edge. angle 0 puts its length parallel
      // to the centerline. blend is the short smooth transition at its rim (a starting size: assumed).
      belly: { on: false, x: -123, y: 100, angle: 0, len: 190, reach: 71, drop: 14, blend: BELLY_BLEND_START },
    },
    tooling: {
      outline: { mode: 'bearing', bit: IN / 2, bushing: (5 / 8) * IN },
      cavity: { mode: 'bearing', bit: IN / 4, bushing: (5 / 8) * IN },
      kerf: 0, regPin: IN / 4, minWall: 5,
      pocketSheet: 'top', // 'top' = a notch in the top template; 'own' = a separate neck pocket template
      regHoles: [],
    },
    ghosts: [],
    verified: {}, // neck numbers the user has confirmed on the real neck: { key: the value that was confirmed }
  };
}

// Bring an opened file up to the current shape of the document, filling anything missing.
export function normalizeDesign(raw) {
  const d = defaultDesign();
  if (!raw || typeof raw !== 'object') return d;
  const out = { ...d, ...raw, schema: SCHEMA };
  out.body = { ...d.body, ...(raw.body || {}) };
  out.body.binding = { ...d.body.binding, ...((raw.body || {}).binding || {}) };
  out.body.edgeBevel = { ...d.body.edgeBevel, ...((raw.body || {}).edgeBevel || {}) };
  out.neck = { ...d.neck, ...(raw.neck || {}) };
  out.neck.back = { ...d.neck.back, ...((raw.neck || {}).back || {}) };
  const rawHead = (raw.neck || {}).head;
  out.neck.head = { ...d.neck.head, ...(rawHead || {}) };
  if (!rawHead || !rawHead.outline || !Array.isArray(rawHead.outline.nodes) || rawHead.outline.nodes.length < 3) out.neck.head.outline = d.neck.head.outline;
  else out.neck.head.outline = { open: true, nodes: rawHead.outline.nodes };
  out.strings = { ...d.strings, ...(raw.strings || {}) };
  out.compensation = { ...d.compensation, ...(raw.compensation || {}) };
  out.bridge = raw.bridge && BRIDGES[raw.bridge.type]
    ? {
      type: raw.bridge.type, params: { ...(BRIDGES[raw.bridge.type].params || {}), ...(raw.bridge.params || {}) },
      depths: Object.fromEntries(Object.entries(raw.bridge.depths || {}).filter(([, v]) => typeof v === 'number' && v > 0)),
    }
    : d.bridge;
  out.pickups = (raw.pickups || d.pickups).filter((p) => PICKUPS[p.type]).map((p) => ({ ...makePickup(p.type), ...p }));
  out.controls = (raw.controls || d.controls).filter((c) => CONTROL_KINDS[c.kind]);
  out.cavities = (raw.cavities || d.cavities).map((c) => ({ ...makeCavity(0, 0, out.body.thickness), ...c }));
  // a belly cut saved as two points (older files) is turned into center, angle, length and reach
  const rawBelly = (raw.contours || {}).belly || {};
  out.contours = { arm: { ...d.contours.arm, ...((raw.contours || {}).arm || {}) }, belly: { ...d.contours.belly, ...(rawBelly.x1 !== undefined && rawBelly.x === undefined ? bellyParams({ ...d.contours.belly, x: undefined, ...rawBelly }) : rawBelly) } };
  for (const k of ['x1', 'y1', 'x2', 'y2']) delete out.contours.belly[k];
  // a file from before the arm bevel was rolled keeps the cut it was drawn with: flat (or its own curve in
  // millimeters) and kept between its two squares; and its belly cut keeps the rim it had
  const rawArm = (raw.contours || {}).arm;
  if (rawArm && rawArm.roll === undefined) { out.contours.arm.roll = null; out.contours.arm.crown = rawArm.crown || 0; out.contours.arm.bounded = rawArm.bounded !== undefined ? !!rawArm.bounded : true; }
  if (rawBelly.x !== undefined || rawBelly.x1 !== undefined) out.contours.belly.blend = rawBelly.blend || 0;
  out.tooling = {
    ...d.tooling, ...(raw.tooling || {}),
    outline: { ...d.tooling.outline, ...((raw.tooling || {}).outline || {}) },
    cavity: { ...d.tooling.cavity, ...((raw.tooling || {}).cavity || {}) },
  };
  out.tooling.pocketSheet = out.tooling.pocketSheet === 'own' ? 'own' : 'top';
  out.tooling.regHoles = Array.isArray(out.tooling.regHoles) ? out.tooling.regHoles.filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.y)) : [];
  if (!NECK_PRESETS[out.neck.preset]) out.neck.preset = 'custom';
  const rawBase = raw.neck && raw.neck.base;
  out.neck.base = rawBase && rawBase !== 'custom' && NECK_PRESETS[rawBase] ? rawBase : out.neck.preset !== 'custom' ? out.neck.preset : 'fender21';
  out.verified = raw.verified && typeof raw.verified === 'object' ? Object.fromEntries(Object.entries(raw.verified).filter(([, v]) => typeof v === 'number')) : {};
  if (!raw.outline || !Array.isArray(raw.outline.nodes) || raw.outline.nodes.length < 2) out.outline = d.outline;
  out.ghosts = Array.isArray(raw.ghosts) ? raw.ghosts : [];
  out.units = raw.units === 'mm' ? 'mm' : 'in';
  return out;
}
