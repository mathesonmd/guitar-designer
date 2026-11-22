// Buildability checks. Everything here is geometry: what the chosen router bit can and cannot cut,
// how much wood is left between features, and whether parts land on the body.
// Each finding: { level: 'warn' | 'note' | 'ok', title, detail, at?: {x, y}, ref? }
import { offset, opening, closing, difference, regionArea, loops, largestOuter } from '../core/clip.js';
import { pointInPoly, minDistPolys, distToPoly, bbox } from '../core/poly.js';
import { unverifiedNeckKeys, neckBasis } from './design.js';
import { fmtWithUnit } from '../core/units.js';

// The outline a router actually produces for a given template setup.
// kind 'outside' = routing around a body; 'inside' = routing a cavity.
export function achievable(poly, tool, kind) {
  const rb = tool.bit / 2;
  if (tool.mode === 'bushing') {
    const o = (tool.bushing - tool.bit) / 2;
    if (o <= 0) return { region: [], offset: o, invalid: true };
    const rB = tool.bushing / 2;
    if (kind === 'outside') {
      const tmpl = offset(poly, -o, 0.01);
      return { region: offset(offset(tmpl, rB, 0.01), -rb, 0.01), template: tmpl, offset: o };
    }
    const tmpl = offset(poly, o, 0.01);
    return { region: offset(offset(tmpl, -rB, 0.01), rb, 0.01), template: tmpl, offset: o };
  }
  // bearing-guided bit: the template is the shape itself
  return { region: kind === 'outside' ? closing(poly, rb, 0.01) : opening(poly, rb, 0.01), template: [{ outer: poly, holes: [] }], offset: 0 };
}

// Largest gap between the wanted shape and what gets cut, and where it is.
function deviation(want, got) {
  const a = difference([want], got), b = difference(got, [want]);
  let worst = { d: 0, at: null, area: regionArea(a) + regionArea(b) };
  const gotLoops = loops(got);
  for (const piece of loops(a)) for (const p of piece) {
    let d = Infinity;
    for (const l of gotLoops) d = Math.min(d, distToPoly(p, l, true).d);
    if (d < Infinity && d > worst.d) worst = { ...worst, d, at: p };
  }
  for (const piece of loops(b)) for (const p of piece) {
    const d = distToPoly(p, want, true).d;
    if (d > worst.d) worst = { ...worst, d, at: p };
  }
  return worst;
}

export function runChecks(design, g, solid) {
  const out = [];
  const u = design.units;
  const L = (mm) => fmtWithUnit(mm, u);
  const tool = design.tooling;
  const T = design.body.thickness;
  const minWall = tool.minWall;

  /* ---- tooling sanity ---- */
  for (const [key, label] of [['outline', 'Body outline'], ['cavity', 'Cavity']]) {
    const t = tool[key];
    if (t.mode === 'bushing' && t.bushing <= t.bit) {
      out.push({ level: 'warn', title: `${label} routing: the guide bushing must be larger than the bit`, detail: `Bushing ${L(t.bushing)}, bit ${L(t.bit)}. Pick a larger bushing or a smaller bit.` });
    }
  }

  /* ---- body outline vs the outline bit ---- */
  const ao = achievable(g.outline, tool.outline, 'outside');
  if (!ao.invalid) {
    const dev = deviation(g.outline, ao.region);
    if (dev.d > 0.15) {
      out.push({
        level: 'warn', at: dev.at,
        title: `Outline has a curve tighter than your setup can cut`,
        detail: tool.outline.mode === 'bushing'
          ? `With a ${L(tool.outline.bushing)} bushing and ${L(tool.outline.bit)} bit, the routed body would differ from the drawing by up to ${L(dev.d)} here. Open up the curve or change the bushing and bit.`
          : `A ${L(tool.outline.bit)} bit cannot reach into this inside curve; it would leave up to ${L(dev.d)} of wood. Open up the curve, use a smaller bit, or plan to finish it by hand.`,
      });
    } else out.push({ level: 'ok', title: 'Outline can be routed as drawn', detail: `Checked against a ${L(tool.outline.bit)} bit${tool.outline.mode === 'bushing' ? ` with a ${L(tool.outline.bushing)} bushing` : ''}.` });
  }

  /* ---- each cavity vs the cavity bit ---- */
  const nk = design.neck;
  for (const c of g.cuts) {
    const ac = achievable(c.poly, tool.cavity, 'inside');
    if (ac.invalid) continue;
    if (!ac.region.length) {
      out.push({ level: 'warn', ref: c.ref || c.id, title: `${c.label}: the bit does not fit in this cavity`, detail: `A ${L(tool.cavity.bit)} bit is wider than the cavity.` });
      continue;
    }
    const dev = deviation(c.poly, ac.region);
    if (c.kind === 'pocket') {
      const rGot = tool.cavity.bit / 2;
      if (rGot > nk.heelCornerR + 0.05) {
        out.push({
          level: 'warn', ref: 'pocket', at: dev.at,
          title: 'Neck pocket corners will be rounder than the heel',
          detail: nk.heelCornerR < 0.1
            ? `This neck has a squared heel. A ${L(tool.cavity.bit)} bit leaves ${L(rGot)} radius corners, so the neck will not seat until you square the corners by hand.`
            : `A ${L(tool.cavity.bit)} bit leaves ${L(rGot)} radius corners; the heel corners are ${L(nk.heelCornerR)}. The neck will stop ${L(dev.d)} short of seating. Use a bit no larger than ${L(nk.heelCornerR * 2)} or ease the corners by hand.`,
        });
      } else out.push({ level: 'ok', ref: 'pocket', title: 'Neck pocket corners clear the heel', detail: `Bit radius ${L(rGot)}, heel corner radius ${L(nk.heelCornerR)}.` });
    } else if (dev.d > 0.2) {
      out.push({
        level: 'warn', ref: c.ref || c.id, at: dev.at,
        title: `${c.label}: corners will come out rounder than drawn`,
        detail: `A ${L(tool.cavity.bit)} bit leaves up to ${L(dev.d)} in the corners. The part may not drop in. Use a smaller bit for this cavity or square the corners by hand.`,
      });
    }
  }

  /* ---- wood left around and under cavities ---- */
  const topCuts = g.cuts.filter((c) => c.side === 'top'), backCuts = g.cuts.filter((c) => c.side === 'back');
  for (const c of g.cuts) {
    if (c.kind === 'pocket' || c.kind === 'pickupPart' || c.kind === 'cover') continue;
    const inside = c.poly.every((p) => pointInPoly(p, g.outline));
    if (!inside) {
      out.push({ level: 'warn', ref: c.ref || c.id, title: `${c.label} runs off the body`, detail: 'Move it inward or reshape the outline.' });
      continue;
    }
    const e = minDistPolys(c.poly, g.outline);
    if (e.d < minWall) out.push({ level: 'warn', ref: c.ref || c.id, at: e.a, title: `${c.label} is ${L(e.d)} from the body edge`, detail: `Your minimum wall is set to ${L(minWall)}.` });
    const floor = T - c.depth;
    if (floor < minWall) out.push({ level: 'warn', ref: c.ref || c.id, title: `${c.label}: only ${L(Math.max(0, floor))} of wood left under it`, detail: `Body is ${L(T)} thick and the cavity is ${L(c.depth)} deep.` });
  }
  const pairs = (list) => {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if ((a.ref || a.id) === (b.ref || b.id)) continue;
      if (a.kind === 'cover' || b.kind === 'cover' || a.kind === 'pickupPart' || b.kind === 'pickupPart') continue;
      const m = minDistPolys(a.poly, b.poly);
      const overlap = a.poly.some((p) => pointInPoly(p, b.poly)) || b.poly.some((p) => pointInPoly(p, a.poly));
      if (!overlap && m.d < minWall) out.push({ level: 'warn', ref: a.ref || a.id, at: m.a, title: `${a.label} and ${b.label.toLowerCase()} are ${L(m.d)} apart`, detail: `Your minimum wall is set to ${L(minWall)}.` });
    }
  };
  pairs(topCuts); pairs(backCuts);
  for (const a of topCuts) for (const b of backCuts) {
    if (a.kind === 'pocket' || b.kind === 'cover') continue;
    const overlap = a.poly.some((p) => pointInPoly(p, b.poly)) || b.poly.some((p) => pointInPoly(p, a.poly));
    if (!overlap) continue;
    const left = T - a.depth - b.depth;
    if (left <= 0) out.push({ level: 'note', ref: a.ref || a.id, title: `${a.label} opens into the ${b.label.toLowerCase()}`, detail: 'The two cavities meet. Fine if you want a wiring path there; otherwise make one shallower.' });
    else if (left < minWall) out.push({ level: 'warn', ref: a.ref || a.id, title: `Only ${L(left)} between ${a.label.toLowerCase()} and ${b.label.toLowerCase()}`, detail: `They overlap from opposite faces. Your minimum wall is ${L(minWall)}.` });
  }

  /* ---- controls need a cavity behind them ---- */
  for (const h of g.holes.filter((x) => x.kind === 'control')) {
    const cav = backCuts.find((c) => c.kind === 'cavity' && pointInPoly(h, c.poly));
    if (!cav) out.push({ level: 'warn', ref: h.ref, at: { x: h.x, y: h.y }, title: `${h.label} has no cavity behind it`, detail: 'Move it over a control cavity, or add a cavity on the back.' });
    else {
      const top = T - cav.depth;
      const wall = distToPoly(h, cav.poly, true).d - h.d / 2;
      if (wall < 2) out.push({ level: 'warn', ref: h.ref, at: { x: h.x, y: h.y }, title: `${h.label} sits on the cavity wall`, detail: `Its hole is ${L(Math.max(0, wall))} from the edge of the cavity.` });
      else out.push({ level: 'ok', ref: h.ref, title: `${h.label}: ${L(top)} of wood for the bushing to pass through`, detail: 'Check that this is less than the threaded length of your part.' });
    }
  }

  /* ---- neck ---- */
  const mouthOk = pointInPoly({ x: 0, y: g.heelY + 2 }, g.outline) && !pointInPoly({ x: 0, y: g.bbox.y1 + 5 }, g.outline);
  const topAtCenter = g.mouthY;
  if (!mouthOk || topAtCenter === null) {
    out.push({ level: 'warn', ref: 'pocket', at: { x: 0, y: g.heelY }, title: 'The neck pocket is not on the body', detail: 'The end of the heel must sit inside the outline with the body edge crossing the neck. Drag the outline or change the neck.' });
  } else {
    const len = topAtCenter - g.heelY;
    out.push({
      level: len < 50 ? 'warn' : 'ok', ref: 'pocket',
      title: `Neck sits ${L(len)} into the body`,
      detail: len < 50 ? 'That is a short pocket. Warmoth’s standard is 3 in (76 mm).' : 'Measured along the centerline. Warmoth’s standard pocket is 3 in (76 mm) long.',
    });
  }
  for (const h of g.holes.filter((x) => x.kind === 'neckscrew')) {
    if (!pointInPoly(h, g.outline)) { out.push({ level: 'warn', ref: 'pocket', at: { x: h.x, y: h.y }, title: 'A neck screw lands off the body', detail: 'Extend the body under the heel or shorten the screw pattern.' }); break; }
  }
  if (nk.pocketDepth > T - minWall) out.push({ level: 'warn', ref: 'pocket', title: 'Neck pocket is nearly as deep as the body', detail: `Pocket ${L(nk.pocketDepth)}, body ${L(T)}.` });

  /* ---- bridge ---- */
  const bh = g.bridge.holes.filter((h) => !pointInPoly(h, g.outline));
  if (bh.length) out.push({ level: 'warn', ref: 'bridge', at: { x: bh[0].x, y: bh[0].y }, title: 'Part of the bridge lands off the body', detail: 'Extend the lower bout or check the scale and neck settings.' });
  const band = g.bridge.saddleBand;
  if (band) {
    const c = design.compensation;
    const need0 = -Math.max(c.bass, c.treble), need1 = -Math.min(c.bass, c.treble);
    if (need0 < band.y0 - 1e-6 || need1 > band.y1 + 1e-6) {
      out.push({ level: 'warn', ref: 'bridge', title: 'Saddles cannot reach the intonation points', detail: `The saddles travel from ${L(-band.y1)} to ${L(-band.y0)} behind the scale line; your compensation needs ${L(-need1)} to ${L(-need0)}. Move the bridge.` });
    } else {
      out.push({ level: 'ok', ref: 'bridge', title: 'Saddle travel covers your compensation', detail: `Room to spare: ${L(band.y1 - need1)} forward, ${L(need0 - band.y0)} back.` });
    }
  }
  if (design.bridge.type === 'tom') out.push({ level: 'note', ref: 'bridge', title: 'This bridge needs a neck angle', detail: 'Gotoh calls for a 1-1/2 to 3 degree neck pocket angle with a Tune-o-matic. Work out the angle in the Black Chapel Neck Angle Calculator and cut the pocket floor to it. The pocket outline on the template does not change.' });
  if (g.bridgeDef.basis !== 'published' || Object.values(g.bridgeDef.paramBasis || {}).includes('assumed')) {
    out.push({ level: 'note', ref: 'bridge', title: 'Confirm the bridge position against the real part', detail: g.bridgeDef.placementNote });
  }
  for (const p of g.pickups) {
    for (const o of g.bridge.outlines) {
      const overlap = p.route.some((q) => pointInPoly(q, o)) || o.some((q) => pointInPoly(q, p.route));
      if (overlap) { out.push({ level: 'warn', ref: p.id, title: `${p.def.label} runs under the bridge`, detail: 'Move the pickup toward the neck.' }); break; }
    }
    if (p.route.some((q) => pointInPoly(q, g.pocket))) out.push({ level: 'warn', ref: p.id, title: `${p.def.label} cuts into the neck pocket`, detail: 'Move the pickup toward the bridge.' });
    else if (design.neck.boardPastHeel > 0 && bbox(p.route).y1 > g.boardEndY) out.push({ level: 'note', ref: p.id, title: `${p.def.label} sits under the fretboard overhang`, detail: 'The end of the fretboard covers part of this cavity. Check the pickup clears it.' });
    if (p.def.poleSpread) out.push({ level: 'note', ref: p.id, title: `Strings span ${L(p.stringSpread)} over the ${p.def.label.toLowerCase()}`, detail: `Its outer pole pieces are ${L(p.def.poleSpread)} apart (Fralin).` });
  }

  /* ---- alignment pins and the neck pocket template ---- */
  const pins = tool.regHoles || [];
  const rp = tool.regPin / 2;
  pins.forEach((r, i) => {
    const name = `Alignment pin hole ${i + 1}`;
    const cut = g.cuts.find((c) => c.kind !== 'pickupPart' && c.kind !== 'cover' && pointInPoly(r, c.poly));
    const near = g.cuts.find((c) => c.kind !== 'pickupPart' && c.kind !== 'cover' && distToPoly(r, c.poly, true).d < rp + 2);
    const hole = g.holes.find((h) => Math.hypot(h.x - r.x, h.y - r.y) < h.d / 2 + rp + 2);
    if (!pointInPoly(r, g.outline)) out.push({ level: 'warn', at: r, title: `${name} is off the body`, detail: 'Drag it onto the body.' });
    else if (cut) out.push({ level: 'warn', at: r, title: `${name} sits in the ${cut.label.toLowerCase()}`, detail: 'A template has an opening there, so it cannot carry the pin hole. Drag the pin to solid wood.' });
    else if (hole) out.push({ level: 'warn', at: r, title: `${name} runs into a ${hole.label.toLowerCase()} hole`, detail: `The two holes would be less than ${L(2)} apart. Drag the pin clear.` });
    else if (near) out.push({ level: 'warn', at: r, title: `${name} is too close to the ${near.label.toLowerCase()}`, detail: `Less than ${L(2)} of wood would be left between them. Drag the pin clear.` });
    else if (distToPoly(r, g.outline, true).d < rp + 3) out.push({ level: 'warn', at: r, title: `${name} is too close to the body edge`, detail: 'Drag it inward.' });
  });
  if (pins.length === 1) out.push({ level: 'note', title: 'One alignment pin cannot stop a template turning', detail: 'Use two pins, spaced well apart.' });
  if (tool.pocketSheet === 'own' && pins.length < 2) {
    out.push({ level: 'note', ref: 'pocket', title: 'The neck pocket template has no alignment pins', detail: 'It can be lined up by the engraved centerline and the engraved body edge. For a positive fit, turn on alignment pin holes under Routing setup.' });
  }

  /* ---- tuner holes ---- */
  const tuners = g.neck && g.neck.head ? g.neck.head.tuners : [];
  if (tuners.length) {
    const out2 = tuners.filter((t) => t.gap < 0), tight = tuners.reduce((m, t) => Math.min(m, t.gap), Infinity);
    if (out2.length) out.push({ level: 'error', ref: 'neck', title: `${out2.length === 1 ? 'A tuner hole breaks' : `${out2.length} tuner holes break`} out of the headstock’s outline`, detail: 'Move the holes toward the centerline or along the headstock, or redraw the outline around them.' });
    else out.push({ level: 'ok', ref: 'neck', title: 'Every tuner hole is inside the headstock', detail: `The hole nearest the edge has ${L(tight)} of wood outside it. Check that against the body of your tuner and its washer.` });
    const hdk = g.neck.head, early = tuners.filter((t) => t.v - t.d / 2 < hdk.reach);
    if (early.length) out.push({ level: 'note', ref: 'neck', title: `${early.length === 1 ? 'A tuner hole sits' : `${early.length} tuner holes sit`} where the back is still carved`, detail: `The back of the headstock is not flat until ${L(hdk.reach)} past the nut (the transition length), so a tuner there has no flat to sit on. Move the first hole farther from the nut, or shorten the transition.` });
    out.push({ level: 'note', ref: 'neck', verify: 'tunerHole', title: `Measure before you cut: tuner hole (${L(tuners[0].d)} across)`, detail: 'A starting value with no source. Tuner makers publish the hole their tuners need: set it to that.' });
  }

  /* ---- numbers that still need a tape measure ---- */
  for (const key of unverifiedNeckKeys(design)) {
    out.push({ level: 'note', ref: 'neck', verify: key, title: `Measure before you cut: ${labelFor(key)} (${L(nk[key])})`, detail: neckBasis(design, key)[2] });
  }
  return out;
}

const LABELS = { nutToHeel: 'nut to end of heel', heelCornerR: 'heel corner radius', screwFromHeelEnd: 'first neck screw row from the heel end', boardPastHeel: 'fretboard overhang past the heel' };
const labelFor = (k) => LABELS[k] || k;
