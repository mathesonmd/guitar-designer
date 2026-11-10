// Pickup bodies and the cavities ("routes") that hold them. Lengths in mm.
// Local frame for every shape: x runs across the strings (the pickup's long side), y runs along the
// strings with +y toward the neck, origin on the pole-piece line.
import { roundRect, stadium, bbox } from '../core/poly.js';
import { union, largestOuter } from '../core/clip.js';
import { SHOP } from './shop.js';

const IN = 25.4;
const unflat = (a) => { const p = []; for (let i = 0; i < a.length; i += 2) p.push({ x: a[i], y: a[i + 1] }); return p; };
const merge = (...polys) => largestOuter(union(polys));
const flipY = (p) => p.map((q) => ({ x: q.x, y: -q.y })).reverse();

// The T-style bridge pickup route is stored in body coordinates; re-center it on its own middle.
const tBridgeAbs = unflat(SHOP.routes.tBridgePickup);
const tb = bbox(tBridgeAbs);
const tBridgeLocal = tBridgeAbs.map((p) => ({ x: p.x - tb.cx, y: p.y - tb.cy }));

export const ROUTE_DEPTH = 0.75 * IN; // 19.05

export const PICKUPS = {
  humbucker: {
    label: 'Humbucker',
    body: { length: 70.2, width: 40, overall: 84, mountSpacing: 78, height: 23 },
    bodyNote: 'Fralin: cover 2.765 x 1.56 in (70.2 x 40 mm), 3.30 in (84 mm) across the mounting legs, mounting holes 3.07 in (78 mm) apart, 0.91 in (23 mm) tall to the bottom of the legs.',
    routeNote: 'Warmoth route: 3.38 x 1.65 in (86 x 42 mm) overall. The leg pockets at each end (22.9 mm wide) and the 3.8 mm corner radius are scaled from Warmoth’s diagram.',
    depthNote: 'Warmoth: 3/4 in (19.05 mm) main route. Warmoth cuts the leg pockets deeper for the mounting screws but does not publish that depth.',
    basis: 'scaled', src: ['warmothPickupRouts', 'fralin'],
    outline: () => roundRect(70.2, 40, 3),
    route: () => merge(roundRect(71.4, 1.65 * IN, 3.8), roundRect(3.38 * IN, 22.9, 4.5)),
    pieces: () => [{ key: 'legs', label: 'Leg pockets', poly: roundRect(3.38 * IN, 22.9, 4.5), extraDepthKey: 'legExtra' }],
    depth: ROUTE_DEPTH, poles: 6, defaultPos: 'bridge',
  },
  strat: {
    label: 'Single coil (S-style)',
    body: { length: 83.7, width: 23.2, mountSpacing: 76.9, height: 15.2 },
    bodyNote: 'Fralin: 3.29 in (83.7 mm) long, 0.915 in (23.2 mm) deep including the wiring tab, mounting holes 3.03 in (76.9 mm) apart, 0.60 in tall with cover.',
    routeNote: 'Warmoth route: 3.34 x 1.02 in (85 x 26 mm) overall. The split between the rounded slot and the wiring-tab relief is scaled from Warmoth’s diagram.',
    depthNote: 'Warmoth: 3/4 in (19.05 mm); 5/8 in (15.9 mm) on vintage-style bodies.',
    basis: 'scaled', src: ['warmothPickupRouts', 'fralin'],
    outline: () => stadium(83.7, 17.6),
    route: (p) => {
      const tab = [{ x: -34, y: -9.9 }, { x: 34, y: -9.9 }, { x: 9.4, y: -9.95 - 6.01 }, { x: -9.4, y: -9.95 - 6.01 }].reverse();
      const shape = merge(stadium(3.34 * IN, 19.9), tab);
      return p && p.flip ? flipY(shape) : shape;
    },
    depth: ROUTE_DEPTH, poles: 6, defaultPos: 'middle', hasFlip: true,
  },
  slot: {
    label: 'Single coil, plain slot',
    body: { length: 83.7, width: 17.6 },
    bodyNote: 'For single coils without a wiring tab (EMG-style housings).',
    routeNote: 'Warmoth EMG-style route: 3.39 x 0.75 in (86 x 19 mm) with full round ends.',
    depthNote: 'Warmoth: 3/4 in (19.05 mm).',
    basis: 'published', src: ['warmothPickupRouts'],
    outline: () => stadium(83.7, 17.6),
    route: () => stadium(3.39 * IN, 0.75 * IN),
    depth: ROUTE_DEPTH, poles: 6, defaultPos: 'middle',
  },
  teleNeck: {
    label: 'T-style neck pickup',
    body: { length: 77.2, width: 21.3, mountSpacing: 70.1, height: 18.5 },
    bodyNote: 'Fralin: 3.04 in (77.2 mm) long, 0.84 in (21.3 mm) deep including the tab, mounting holes 2.76 in (70.1 mm) apart, 0.73 in tall.',
    routeNote: 'Warmoth route: 3.20 x 0.91 in (81 x 23 mm) overall; inner proportions scaled from Warmoth’s diagram. The Black Chapel T-style template route measures 82.8 x 23.4 mm.',
    depthNote: 'Warmoth: 3/4 in (19.05 mm).',
    basis: 'scaled', src: ['warmothPickupRouts', 'fralin', 'shop'],
    outline: () => stadium(77.2, 13.5),
    route: (p) => {
      const tab = [{ x: -35.5, y: -7.15 }, { x: 35.5, y: -7.15 }, { x: 5.6, y: -7.2 - 8.71 }, { x: -5.6, y: -7.2 - 8.71 }].reverse();
      const shape = merge(stadium(3.2 * IN, 14.4), tab);
      return p && p.flip ? flipY(shape) : shape;
    },
    depth: ROUTE_DEPTH, poles: 6, defaultPos: 'neck', hasFlip: true,
  },
  tBridge: {
    label: 'T-style bridge pickup',
    body: { length: 73.1, width: 38.4, mountSpacing: 44.2, height: 17.5 },
    bodyNote: 'Fralin: bobbin 2.877 in (73.1 mm) long, 1.51 in (38.4 mm) front to back, rear mounting holes 1.741 in (44.2 mm) apart, 0.688 in tall. Hangs from the bridge plate.',
    routeNote: 'Route outline copied from the Black Chapel T-style class template (76.8 x 47.0 mm, already slanted). No maker publishes a dimensioned route for this pickup.',
    depthNote: 'Warmoth: 3/4 in (19.05 mm). The Black Chapel template calls for 0.8 to 1 in.',
    basis: 'shop', src: ['shop', 'fralin', 'warmothPickupRouts'],
    outline: () => null,
    route: () => tBridgeLocal,
    depth: ROUTE_DEPTH, poles: 0, defaultPos: 'tBridge', fixedAngle: true,
    home: { x: tb.cx, y: tb.cy },
  },
  p90: {
    label: 'P-90 soapbar',
    body: { length: 86.2, width: 35, height: 16.6, poleSpread: 50 },
    bodyNote: 'Fralin: 3.39 x 1.38 in (86.2 x 35 mm), 0.65 in (16.6 mm) tall, outer pole pieces 50 mm apart.',
    routeNote: 'Warmoth route: 3.44 x 1.43 in (87 x 36 mm). Corner radius (about 4.3 mm) is scaled from Warmoth’s diagram.',
    depthNote: 'Warmoth: 3/4 in (19.05 mm).',
    basis: 'scaled', src: ['warmothPickupRouts', 'fralin'],
    outline: () => roundRect(86.2, 35, 4),
    route: () => roundRect(3.44 * IN, 1.43 * IN, 4.3),
    depth: ROUTE_DEPTH, poles: 6, poleSpread: 50, defaultPos: 'neck',
  },
  custom: {
    label: 'Custom rectangle',
    body: null,
    bodyNote: 'Enter the cavity size your pickup maker recommends.',
    routeNote: 'Cavity is exactly the length, width and corner radius you enter.',
    depthNote: 'Set the depth for your pickup.',
    basis: 'assumed', src: [],
    outline: () => null,
    route: (p) => roundRect(p.len || 90, p.wid || 40, p.rad ?? 4),
    depth: ROUTE_DEPTH, poles: 0, defaultPos: 'middle', isCustom: true,
  },
};

// Starting positions (pickup center, mm from the scale line toward the neck). Bridge and neck are the
// centers of the pickup routes on the Black Chapel T-style template (40.55 and 156.64 mm); middle is
// simply halfway between them. Pickup position is a tone choice: these are only where a new pickup lands.
export const PICKUP_HOME = {
  bridge: { y: 40.5, basis: 'shop' },
  middle: { y: 98.5, basis: 'assumed' },
  neck: { y: 156.6, basis: 'shop' },
  tBridge: { y: tb.cy, x: tb.cx, basis: 'shop' },
};
