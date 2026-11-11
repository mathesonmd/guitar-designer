// Turns a design document into geometry: outline polygon, neck pocket, frets, strings, every cavity
// and every hole, all in body coordinates (mm).
import { outlinePolygon } from '../core/path.js';
import { bbox, filletPoly, place, roundRect, signedArea, centroid } from '../core/poly.js';
import { offset, largestOuter } from '../core/clip.js';
import { fretDistance, fretAt } from '../core/fret.js';
import { BRIDGES, holeDepthGroup } from '../data/bridges.js';
import { bindingChannel, purflingChannel } from './design.js';
import { buildEdgeBevel } from './edgebevel.js';
import { PICKUPS } from '../data/pickups.js';
import { CONTROL_KINDS } from '../data/parts.js';

export function derive(design, { tol = 0.02 } = {}) {
  const outline = outlinePolygon(design.outline, tol);
  const ob = bbox(outline);
  const nk = design.neck;
  const scale = nk.scale;
  const nutY = scale;
  const heelY = scale - nk.nutToHeel; // pocket end wall
  const boardEndY = heelY - nk.boardPastHeel;

  // neck width: straight taper from the nut to the heel end
  const neckHalf = (y) => (nk.nutWidth + (nk.heelWidth - nk.nutWidth) * ((nutY - y) / (nutY - heelY))) / 2;
  // pocket width: heel width at the end wall, mouth width one pocket-length up
  const pocketHalf = (y) => (nk.heelWidth + (nk.mouthWidth - nk.heelWidth) * ((y - heelY) / nk.pocketLength)) / 2;

  // The pocket outline from its end wall up to any height (it has to run past the body edge to be open).
  const pocketTo = (topY) => filletPoly([
    { x: -pocketHalf(heelY), y: heelY }, { x: pocketHalf(heelY), y: heelY },
    { x: pocketHalf(topY), y: topY }, { x: -pocketHalf(topY), y: topY },
  ], [nk.heelCornerR, nk.heelCornerR, 0, 0], tol / 2);
  const pocketTop = Math.max(ob.y1, heelY + nk.pocketLength) + 12;
  const pocket = pocketTo(pocketTop);
  // where the body edge crosses the centerline above the heel: the mouth of the pocket
  const mouthY = edgeYAbove(outline, 0, heelY);

  const fretboard = [
    { x: -neckHalf(boardEndY), y: boardEndY }, { x: neckHalf(boardEndY), y: boardEndY },
    { x: neckHalf(nutY), y: nutY }, { x: -neckHalf(nutY), y: nutY },
  ];
  const frets = [];
  for (let n = 1; n <= nk.frets; n++) {
    const y = nutY - fretDistance(scale, n);
    frets.push({ n, y, half: neckHalf(y) });
  }

  // strings: index 0 = bass side (-x), last = treble side (+x)
  const bdef = BRIDGES[design.bridge.type] || BRIDGES.none;
  const count = design.strings.count;
  const comp = design.compensation;
  const saddleSpread = bdef.stringSpacing * (count - 1);
  const strings = [];
  for (let i = 0; i < count; i++) {
    const u = count > 1 ? i / (count - 1) : 0.5;
    const c = comp.bass + (comp.treble - comp.bass) * u;
    strings.push({
      nut: { x: (u - 0.5) * design.strings.nutSpread, y: nutY },
      saddle: { x: (u - 0.5) * saddleSpread, y: -c },
    });
  }
  const stringXAt = (i, y) => {
    const s = strings[i];
    return s.nut.x + ((s.saddle.x - s.nut.x) * (s.nut.y - y)) / (s.nut.y - s.saddle.y);
  };

  const bridge = bdef.geometry(design.bridge, { compTreble: comp.treble, compBass: comp.bass });

  const cuts = [];
  const holes = [];
  cuts.push({ id: 'pocket', kind: 'pocket', label: 'Neck pocket', side: 'top', poly: pocket, depth: nk.pocketDepth, open: true });
  const sa = nk.screwAcross / 2, s0 = heelY + nk.screwFromHeelEnd;
  [[-sa, s0], [sa, s0], [-sa, s0 + nk.screwAlong], [sa, s0 + nk.screwAlong]].forEach(([x, y], i) => holes.push({
    id: 'neckscrew' + i, kind: 'neckscrew', label: 'Neck screw', side: 'through', x, y, d: nk.screwBodyHole,
  }));

  // bridge holes carry the builder's own depth for their group, or null while none has been entered
  const depths = design.bridge.depths || {};
  bridge.holes.forEach((h, i) => {
    const group = holeDepthGroup(h);
    const d = group && depths[group] > 0 ? Math.min(depths[group], design.body.thickness) : null;
    holes.push({ ...h, id: 'bridge' + i, depthGroup: group, depth: d });
  });
  for (const r of bridge.routes) cuts.push(r);

  const pickups = design.pickups.map((p) => {
    const def = PICKUPS[p.type];
    const route = place(def.route(p), p.x, p.y, p.angle);
    const body = def.outline(p);
    const pieces = (def.pieces ? def.pieces(p) : []).map((q) => ({ ...q, poly: place(q.poly, p.x, p.y, p.angle) }));
    cuts.push({ id: p.id, kind: 'pickup', label: def.label, side: 'top', poly: route, depth: p.depth, ref: p.id });
    for (const q of pieces) {
      const extra = p[q.extraDepthKey] || 0;
      if (extra > 0) cuts.push({ id: p.id + ':' + q.key, kind: 'pickupPart', label: `${def.label}: ${q.label.toLowerCase()}`, side: 'top', poly: q.poly, depth: p.depth + extra, ref: p.id });
    }
    return {
      id: p.id, type: p.type, def, route, pieces,
      body: body ? place(body, p.x, p.y, p.angle) : null,
      stringSpread: Math.abs(stringXAt(count - 1, p.y) - stringXAt(0, p.y)),
    };
  });

  for (const c of design.controls) {
    holes.push({ id: c.id, kind: 'control', label: CONTROL_KINDS[c.kind].label, side: 'through', x: c.x, y: c.y, d: c.d, ref: c.id });
  }
  const cavities = design.cavities.map((c) => {
    const poly = place(roundRect(c.w, c.h, c.r, tol / 2), c.x, c.y, c.angle);
    cuts.push({ id: c.id, kind: 'cavity', label: c.name, side: c.side, poly, depth: c.depth, ref: c.id });
    let cover = null;
    if (c.cover && c.ledge > 0) {
      cover = largestOuter(offset(poly, c.ledge, tol / 2));
      if (cover) cuts.push({ id: c.id + ':cover', kind: 'cover', label: `${c.name} cover recess`, side: c.side, poly: cover, depth: c.coverDepth, ref: c.id });
    }
    return { id: c.id, poly, cover };
  });

  // Where the body edge meets the neck on each side, expressed as a fret number.
  const joinFret = (sign) => {
    const x = sign * (nk.heelWidth / 2 + 1.5);
    let best = null;
    for (let i = 0, n = outline.length; i < n; i++) {
      const a = outline[i], b = outline[(i + 1) % n];
      if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) continue;
      const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
      if (y > heelY && (best === null || y > best)) best = y;
    }
    return best === null ? null : { y: best, fret: fretAt(scale, nutY - best) };
  };

  // binding channel: its inner edge is the outline moved in by the channel's width
  const bind = bindingChannel(design);
  const binding = bind ? { ...bind, inner: offset([outline], -bind.width, tol / 2).map((e) => e.outer) } : null;

  // bevel around the top edge, and the purfling channel that can follow its inner line
  const bevelEdge = buildEdgeBevel(design, outline, tol);
  const purf = bevelEdge ? purflingChannel(design) : null;
  // the channel lies between the bevel's inner line and that line moved in by the channel's width
  const purfling = purf ? { ...purf, outer: [bevelEdge.innerPoly], inner: offset([bevelEdge.innerPoly], -purf.width, tol / 2).map((e) => e.outer) } : null;

  const area = Math.abs(signedArea(outline));
  return {
    outline, bbox: ob, area, centroid: centroid(outline),
    scale, nutY, heelY, boardEndY, neckHalf, pocketHalf,
    pocket, pocketTo, mouthY, fretboard, frets, strings, stringXAt, saddleSpread,
    bridge, bridgeDef: bdef, pickups, cavities, cuts, holes, binding, bevelEdge, purfling,
    join: { treble: joinFret(1), bass: joinFret(-1) },
    heelToScale: heelY,
  };
}

// y where the outline crosses the vertical line x, above yMin (the highest crossing), or null.
export function edgeYAbove(outline, x, yMin) {
  let best = null;
  for (let i = 0, n = outline.length; i < n; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) continue;
    const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    if (y > yMin && (best === null || y > best)) best = y;
  }
  return best;
}
