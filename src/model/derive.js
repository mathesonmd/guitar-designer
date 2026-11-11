// Turns a design document into geometry: outline polygon, neck pocket, frets, strings, every cavity
// and every hole, all in body coordinates (mm).
import { outlinePolygon, expandOutline, insetNodes, inwardNormals, insertNode, segmentsOf } from '../core/path.js';
import { EdgeIndex } from '../core/edgeindex.js';
import { cubicAt } from '../core/bezier.js';
import { bbox, filletPoly, place, roundRect, signedArea, centroid, pointInPoly } from '../core/poly.js';
import { offset, largestOuter, toRegion } from '../core/clip.js';
import { fretDistance, fretAt } from '../core/fret.js';
import { BRIDGES, holeDepthGroup } from '../data/bridges.js';
import { bindingChannel, edgeBevel } from './design.js';
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

  // bevel around the top edge: the outline and its inner line, node for node, and the shape of the body
  // at any height through the bevel (k = 0 at the body edge and the bevel's full depth, 1 at the inner
  // line and the top). Straight lines join matching points of the two curves.
  const eb = edgeBevel(design);
  let bevelEdge = null;
  if (eb) {
    // The outline with extra points added along each long segment (the curve itself is unchanged), so the
    // inner line follows it closely. `from` remembers which of the outline's own points each one is.
    const own = expandOutline(design.outline);
    const ownWidth = own.map((p) => Math.max(0, p.bw !== undefined ? p.bw : eb.width));
    let outer = own.map((p, i) => ({ ...p, from: i, want: ownWidth[i] }));
    for (let i = own.length - 1; i >= 0; i--) {
      const a = own[i], b = own[(i + 1) % own.length], K = Math.max(1, Math.min(6, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 22)));
      for (let j = 1; j < K; j++) {
        // each cut takes the first 1/(K-j+1) of what is left of the segment, which starts at index i + j - 1
        const r = insertNode(outer, i + j - 1, 1 / (K - j + 1), true);
        outer = r.nodes;
        outer[r.index] = { ...outer[r.index], from: -1, want: ownWidth[i] + ((ownWidth[(i + 1) % own.length] - ownWidth[i]) * j) / K };
      }
    }
    const normals = inwardNormals(outer), edges = new EdgeIndex(outline, 12);
    // A point's width is what was asked for, but never more than the body has room for there: the inner
    // point must stay well clear of every other part of the outline, so the inner line cannot cross over
    // at a horn, a waist or a corner.
    const room = outer.map((p, i) => {
      // a circle of radius r lying inside the body and touching the outline at this point (at a corner, touching its two sides)
      // (`slack` allows for the outline here being a many-sided polygon, not the true curve)
      const n = normals[i], slack = Math.max(0.3, 4 * tol);
      const clear = (r) => edges.nearest(p.x + n.x * r, p.y + n.y * r).d >= 0.97 * n.open * r - slack && pointInPoly({ x: p.x + n.x * r, y: p.y + n.y * r }, outline);
      if (!clear(1)) return 0;
      let lo = 1, hi = 1;
      while (hi < 400 && clear(hi * 2)) hi *= 2;
      hi *= 2;
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (clear(mid)) lo = mid; else hi = mid; }
      return lo;
    });
    const asked = outer.map((p) => p.want);
    const widths = asked.map((w, i) => Math.min(w, 0.8 * room[i]));
    // If a stretch of the inner line still runs backward (a curve tighter than the bevel is wide), pull the
    // points at its ends in until it runs forward again.
    for (let pass = 0; pass < 14; pass++) {
      const trial = insetNodes(outer, widths), m = outer.length;
      let fixed = false;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m, ox = outer[j].x - outer[i].x, oy = outer[j].y - outer[i].y, ix = trial[j].x - trial[i].x, iy = trial[j].y - trial[i].y;
        if (ox * ix + oy * iy < 0.15 * (ox * ox + oy * oy)) { widths[i] *= 0.8; widths[j] *= 0.8; fixed = true; }
      }
      if (!fixed) break;
    }
    const inner = insetNodes(outer, widths);
    const so = segmentsOf(outer, true), si = segmentsOf(inner, true);
    const pairs = [];
    so.forEach((a, i) => {
      const b = si[i], len = Math.hypot(a.p3.x - a.p0.x, a.p3.y - a.p0.y), N = Math.max(6, Math.min(60, Math.ceil(len / 2.5)));
      for (let j = 0; j < N; j++) pairs.push([cubicAt(a.p0, a.p1, a.p2, a.p3, j / N), cubicAt(b.p0, b.p1, b.p2, b.p3, j / N)]);
    });
    const at = (k) => pairs.map(([o, q]) => ({ x: o.x + (q.x - o.x) * k, y: o.y + (q.y - o.y) * k }));
    const innerPoly = at(1);
    // an inner line that still crosses itself (between points, on a tight curve) cannot be cut
    const crosses = Math.abs(toRegion([innerPoly]).reduce((s, e) => s + Math.abs(signedArea(e.outer)) - e.holes.reduce((h, q) => h + Math.abs(signedArea(q)), 0), 0) - Math.abs(signedArea(innerPoly))) > 2;
    // where the outline's own points sit on the inner line, for the drag squares: [{ i, outer, inner, normal, width, asked }]
    const handles = outer.map((p, j) => ({ i: p.from, outer: { x: p.x, y: p.y }, inner: { x: inner[j].x, y: inner[j].y }, normal: normals[j], width: widths[j], asked: asked[j] })).filter((h) => h.i >= 0);
    bevelEdge = { ...eb, outer, inner, normals, widths, asked, at, innerPoly, crosses, handles };
  }

  const area = Math.abs(signedArea(outline));
  return {
    outline, bbox: ob, area, centroid: centroid(outline),
    scale, nutY, heelY, boardEndY, neckHalf, pocketHalf,
    pocket, pocketTo, mouthY, fretboard, frets, strings, stringXAt, saddleSpread,
    bridge, bridgeDef: bdef, pickups, cavities, cuts, holes, binding, bevelEdge,
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
