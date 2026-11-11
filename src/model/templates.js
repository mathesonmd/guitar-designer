// Builds the routing template sheets from a design: one for the top, one for the back, one for the
// neck pocket when it is kept separate, and one for cover recesses when they are used. Sheets are in
// body coordinates (mm); back sheets are mirrored so they read correctly lying on the back of the guitar.
//
// Template offsets:
//   bearing-guided bit: the template edge IS the finished edge.
//   guide bushing:      the cut lands (bushing - bit) / 2 away from the template edge, so a cavity
//                       opening is made that much larger and a body outline that much smaller.
import { offset, difference, union, closing, largestOuter } from '../core/clip.js';
import { bbox, bboxOfMany, pointInPoly, circlePoly, distToPoly, signedArea } from '../core/poly.js';
import { textStrokes, textWidth } from '../core/text.js';
import { fmtLen, fractionLabel, MM_PER_IN } from '../core/units.js';
import { bevelPlane, bellyDish } from './solid.js';
import { unverifiedNeckKeys } from './design.js';

export const toolOffset = (t) => (t.mode === 'bushing' ? (t.bushing - t.bit) / 2 : 0);

// The separate neck pocket template is sized like the Black Chapel J-style neck pocket template:
// the opening runs 74 mm past the body edge so the bit can leave the pocket, with a 17 mm rim beyond
// it and about 45 mm of template either side to carry the router.
export const POCKET_SHEET = { runout: 74, rim: 17, side: 45 };

const lenLabel = (mm, units) => {
  if (units === 'mm') return `${fmtLen(mm, 'mm', 1)} mm`;
  const f = fractionLabel(mm / MM_PER_IN);
  return f ? `${f} in` : `${fmtLen(mm, 'in')} in`;
};
const toolLabel = (t, units) => (t.mode === 'bushing'
  ? `${lenLabel(t.bushing, units)} bushing + ${lenLabel(t.bit, units)} bit`
  : `${lenLabel(t.bit, units)} bearing-guided bit`);

export function buildTemplates(design, g) {
  const tool = design.tooling;
  const u = design.units;
  const k = (tool.kerf || 0) / 2;
  const oOut = toolOffset(tool.outline), oCav = toolOffset(tool.cavity);
  const problems = [];
  if (tool.outline.mode === 'bushing' && oOut <= 0) problems.push('Body outline: the guide bushing must be larger than the bit.');
  if (tool.cavity.mode === 'bushing' && oCav <= 0) problems.push('Cavities: the guide bushing must be larger than the bit.');

  // the outside edge of the top and back sheets
  const edgeRegion = oOut > 0 ? offset(g.outline, -oOut, 0.004) : [{ outer: g.outline, holes: [] }];
  const edge = largestOuter(edgeRegion);
  if (!edge) problems.push('The body outline is too small for this bushing setup.');
  else if (edgeRegion.length > 1) problems.push('Body outline: part of the body is too narrow for this bushing and bit, so the template would lose it. Use a smaller bushing, or a bearing-guided bit.');

  const mirror = (p) => p.map((q) => ({ x: -q.x, y: q.y })).reverse();
  const mirrorLine = (p) => p.map((q) => ({ x: -q.x, y: q.y }));
  const unverified = unverifiedNeckKeys(design);
  const regHoles = tool.regHoles || [];

  // opts: { id, name, tag, side, cuts, holes, lines, marks, notes, outer, toolLines }
  function makeSheet(o) {
    const { id, name, side, cuts, holes } = o;
    const outer0 = o.outer || edge;
    const flip = side === 'back';
    const M = flip ? mirror : (p) => p;
    const ML = flip ? mirrorLine : (p) => p;
    const items = [];
    if (!outer0) return { id, name, side, items, bbox: bbox(g.outline), legend: [], features: [], legendBox: null, textHeight: 0, unverified };

    // openings, grown for the bushing, merged where they touch
    const openPolys = cuts.map((c) => (oCav > 0 ? largestOuter(offset(c.poly, oCav, 0.004)) : c.poly)).filter(Boolean);
    const openRegion = openPolys.length ? union(openPolys) : [];
    // sheet = edge minus openings; an opening that runs off the edge (the neck pocket) becomes a notch
    let sheet = openRegion.length ? difference([outer0], openRegion) : [{ outer: outer0, holes: [] }];
    sheet = sheet.filter((e) => Math.abs(signedArea(e.outer)) > 400); // drop slivers
    for (const e of sheet) {
      const outer = k > 0 ? largestOuter(offset(e.outer, k, 0.004)) : e.outer;
      if (outer) items.push({ type: 'cut', layer: 'CUT_OUTSIDE', poly: M(outer) });
      for (const h of e.holes) {
        const hole = k > 0 ? largestOuter(offset(h, -k, 0.004)) : h;
        if (hole) items.push({ type: 'cut', layer: 'CUT_INSIDE', poly: M(hole) });
      }
    }
    const solidAt = (p) => sheet.some((e) => pointInPoly(p, e.outer) && !e.holes.some((h) => pointInPoly(p, h)));
    const drilled = [];
    for (const h of holes) {
      if (!solidAt(h)) continue; // falls inside an opening or off the sheet
      drilled.push(h);
      items.push(holeItem(h.x, h.y, Math.max(0.3, h.d / 2 - k), flip));
    }
    const pins = regHoles.filter(solidAt).map((r) => ({ x: r.x, y: r.y, d: tool.regPin, label: 'Alignment pin', pin: true }));
    for (const r of pins) items.push(holeItem(r.x, r.y, Math.max(0.3, r.d / 2 - k), flip));
    const allHoles = [...drilled, ...pins];

    // numbered labels beside each feature, and the legend lines that explain them
    const legend = [];
    const keepClear = []; // boxes the legend must not cover
    const numbered = [...cuts.map((c) => ({ label: c.label, depth: c.depth, box: bbox(c.poly) })),
      ...groupHoles(allHoles).map((h) => ({ label: h.label, d: h.d, box: h.box, count: h.count, hole: true }))];
    numbered.forEach((f, i) => {
      const n = String(i + 1);
      // put the number just outside the feature, on whichever side has solid sheet
      const cands = [
        { x: f.box.x0 - 7, y: f.box.cy - 2 }, { x: f.box.x1 + 3, y: f.box.cy - 2 },
        { x: f.box.cx - 2, y: f.box.y0 - 8 }, { x: f.box.cx - 2, y: f.box.y1 + 3 },
      ];
      const at = cands.find((p) => solidAt({ x: p.x + 2, y: p.y + 2 }) && clearOf(p, openPolys, allHoles, 2.5));
      if (at) {
        textFlip(n, at.x, at.y, 4.5, flip).forEach((s) => items.push({ type: 'engrave', layer: 'ENGRAVE', line: s }));
        keepClear.push({ x0: at.x - 2, y0: at.y - 2, x1: at.x + textWidth(n, 4.5) + 2, y1: at.y + 6.5 });
      }
      legend.push(f.hole
        ? `${n}  ${f.label}${f.count > 1 ? ' x' + f.count : ''}: ${lenLabel(f.d, u)} hole`
        : `${n}  ${f.label}: ${lenLabel(f.depth, u)} deep`);
    });

    // The legend block. Lettering starts at 3.2 mm and steps down until the block fits on the sheet.
    const title = (design.name || 'Untitled').toUpperCase();
    const head = [`${title.length > 30 ? title.slice(0, 28) + '...' : title}  ${o.tag}`,
      ...(o.toolLines || [`Outline: ${toolLabel(tool.outline, u)}`, `Cavities: ${toolLabel(tool.cavity, u)}`])];
    const checkText = unverified.length ? `CHECK before cutting: ${unverified.map((key) => CHECK_TEXT[key] || key).join(', ')}` : null;
    const sb = bbox(outer0);
    let lines = [], th = 0, lh = 0, blockW = 0, blockH = 0, spot = null;
    for (const size of [3.2, 2.8, 2.4, 2.0]) {
      th = size; lh = size * 1.62;
      const short = [...head, ...legend, 'Black Chapel Studios'];
      const wide = Math.max(64, ...short.map((str) => textWidth(str, th)));
      // sentences are wrapped to the width of the widest label line
      lines = [...head, ...legend, ...(o.notes || []).flatMap((str) => wrapText(str, wide, th)), ...(checkText ? wrapText(checkText, wide, th) : []), 'Black Chapel Studios'];
      blockW = wide + 4; blockH = lines.length * lh + 14;
      spot = findSpot(blockW, blockH, sb, solidAt, openPolys, allHoles, keepClear);
      if (spot) break;
    }
    const block = spot ? { x0: spot.x - 2.5, y0: spot.y - 2.5, x1: spot.x + blockW + 2.5, y1: spot.y + blockH + 2.5 } : null;

    // engraved guide lines: centerline, scale line and any extras. They stop at openings, holes, number labels and the legend.
    const onSheet = (p) => sheet.some((e) => pointInPoly(p, e.outer) && !e.holes.some((h) => pointInPoly(p, h)) && distToPoly(p, e.outer, true).d > 1.5 && e.holes.every((h) => distToPoly(p, h, true).d > 1.5))
      && !(block && p.x > block.x0 && p.x < block.x1 && p.y > block.y0 && p.y < block.y1)
      && !allHoles.some((h) => Math.hypot(h.x - p.x, h.y - p.y) < h.d / 2 + 1)
      && !keepClear.some((b) => p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1);
    const eng = (line) => items.push({ type: 'engrave', layer: 'ENGRAVE', line: ML(line) });
    const clipLine = (a, b) => runsInside(sampleLine(a, b, 0.5), onSheet).forEach((r) => eng([r[0], r[r.length - 1]]));
    clipLine({ x: 0, y: sb.y0 - 5 }, { x: 0, y: sb.y1 + 5 });
    clipLine({ x: -22, y: 0 }, { x: 22, y: 0 });
    for (const l of o.lines || []) clipLine(l[0], l[1]);
    for (const m of o.marks || []) runsInside(m, onSheet).forEach(eng);

    if (spot) {
      const x0 = flip ? -spot.x - blockW : spot.x; // left edge of the block on the sheet
      const put = (line) => items.push({ type: 'engrave', layer: 'ENGRAVE', line });
      lines.forEach((str, i) => textStrokes(str, x0, spot.y + blockH - (i + 1) * lh, th).forEach(put));
      // Scale check: two bars, each labeled with the length it must measure on the cut template.
      const long = blockW >= 104 ? 100 : 50;
      const ry = spot.y + 6;
      put([{ x: x0, y: ry }, { x: x0 + long, y: ry }]);
      for (let t = 0; t <= long; t += 10) put([{ x: x0 + t, y: ry }, { x: x0 + t, y: ry + (t % 50 === 0 ? 3.5 : 2) }]);
      put([{ x: x0, y: ry - 3 }, { x: x0 + 2 * MM_PER_IN, y: ry - 3 }]);
      for (const t of [0, MM_PER_IN, 2 * MM_PER_IN]) put([{ x: x0 + t, y: ry - 3 }, { x: x0 + t, y: ry - 5 }]);
      textStrokes('2 in', x0 + 2 * MM_PER_IN + 2.5, ry - 5, 2).forEach(put);
      if (long === 100) textStrokes('100 mm', x0 + 100, ry - 5, 2, 0, 'right').forEach(put);
      else textStrokes('50 mm', x0 + 52.5, ry + 0.6, 2).forEach(put);
    } else problems.push(`${name}: no clear area large enough for the engraved legend, so it was left off.`);

    const polys = items.filter((i) => i.type === 'cut').map((i) => i.poly);
    const legendBox = block ? (flip ? { x0: -block.x1, y0: block.y0, x1: -block.x0, y1: block.y1 } : block) : null;
    return { id, name, side, items, bbox: bboxOfMany(polys), legend: lines, features: [...legend, ...(o.notes || [])], legendBox, textHeight: spot ? th : 0, unverified };
  }

  // mirrored sheets are mirrored about x = 0, and lettering must still read left to right
  function textFlip(str, x, y, h, flip) {
    if (!flip) return textStrokes(str, x, y, h);
    return textStrokes(str, -x - textWidth(str, h), y, h);
  }
  // body contours are shaped by hand: the templates carry the guide lines and the depth to work to
  const ca = design.contours.arm, cb = design.contours.belly;
  const arm = bevelPlane(ca, g.outline, g.centroid);
  const dish = bellyDish(cb, design.body.thickness - 3);
  const armLine = arm ? [[{ x: ca.x1, y: ca.y1 }, { x: ca.x2, y: ca.y2 }]] : [];
  const arm0 = arm ? bevelPlane(ca, g.outline, g.centroid, design.body.thickness - 3) : null;
  const armNote = arm0 ? [`Arm bevel: ${arm0.crown > 0 ? 'curved' : 'flat'}, from the engraved line to ${lenLabel(arm0.drop, u)} deep at the edge${arm0.blend > 0 ? `, crease rounded to a ${lenLabel(arm0.blend, u)} radius` : ''}${arm0.fade > 0 ? `, running out over ${lenLabel(arm0.fade, u)} at each end` : ''}`] : [];
  const dishMark = dish ? [[...dish.ellipse(1, 180), dish.ellipse(1, 180)[0]]] : [];
  const dishNote = dish ? [`Belly cut: dished, inside the engraved curve, ${lenLabel(dish.drop, u)} deep at the edge${dish.blend > 0 ? `, rim rounded to a ${lenLabel(dish.blend, u)} radius` : ''}`] : [];

  const ownPocket = tool.pocketSheet === 'own';
  const topCuts = g.cuts.filter((c) => c.side === 'top' && c.kind !== 'pickupPart' && !(ownPocket && c.kind === 'pocket'));
  const backCuts = g.cuts.filter((c) => c.side === 'back' && c.kind !== 'cover');
  const coverCuts = g.cuts.filter((c) => c.kind === 'cover');
  const topHoles = g.holes.filter((h) => h.side === 'top' || h.side === 'through');
  const backHoles = g.holes.filter((h) => h.side === 'back' || (h.side === 'through' && h.kind !== 'through'));
  const cavityOnly = [`Cavities: ${toolLabel(tool.cavity, u)}`];

  const sheets = [makeSheet({ id: 'top', name: 'Top template', tag: 'TOP', side: 'top', cuts: topCuts, holes: topHoles, lines: armLine, notes: armNote })];

  if (ownPocket) {
    // A separate sheet: the body shape plus a tab that reaches past the neck end, with the pocket as a
    // closed opening that runs off the body so the bit can leave through the mouth.
    const P = POCKET_SHEET;
    const pocket = g.cuts.find((c) => c.kind === 'pocket');
    const mouth = g.mouthY !== null && g.mouthY !== undefined ? g.mouthY : g.heelY + design.neck.pocketLength;
    const top = mouth + P.runout;
    const half = Math.max(g.pocketHalf(g.heelY), g.pocketHalf(top)) + oCav + P.side;
    const tab = [{ x: -half, y: mouth - 15 }, { x: half, y: mouth - 15 }, { x: half, y: top + oCav + P.rim }, { x: -half, y: top + oCav + P.rim }];
    const outer = largestOuter(closing(union([g.outline, tab]), 8, 0.01));
    // the body edge, engraved where the tab covers it, to line the template up without pins
    const under = [];
    let run = [];
    for (const p of [...g.outline, g.outline[0]]) {
      if (Math.abs(p.x) < half && p.y > mouth - 15 && p.y < top + P.rim) run.push(p); else { if (run.length > 1) under.push(run); run = []; }
    }
    if (run.length > 1) under.push(run);
    if (pocket && outer) {
      sheets.push(makeSheet({
        id: 'pocket', name: 'Neck pocket template', tag: 'NECK POCKET', side: 'top', outer, toolLines: cavityOnly,
        cuts: [{ ...pocket, poly: g.pocketTo(top) }], holes: [], marks: under,
      }));
    }
  }
  if (backCuts.length || backHoles.length || dish) sheets.push(makeSheet({ id: 'back', name: 'Back template', tag: 'BACK (MIRRORED)', side: 'back', cuts: backCuts, holes: backHoles, marks: dishMark, notes: dishNote }));
  if (coverCuts.length) sheets.push(makeSheet({ id: 'cover', name: 'Cover recess template', tag: 'COVER RECESS, BACK (MIRRORED)', side: 'back', cuts: coverCuts, holes: [], toolLines: cavityOnly }));

  return { sheets, problems, offsets: { outline: oOut, cavity: oCav, kerf: tool.kerf || 0 }, unverified, pocketSheet: ownPocket ? 'own' : 'top' };
}

// A round hole. It keeps its center and radius so the exports can write a true circle, not a fitted one.
const holeItem = (x, y, r, flip) => {
  const cx = flip ? -x : x;
  return { type: 'cut', layer: 'CUT_INSIDE', poly: circlePoly(cx, y, r, 0.003), hole: true, circle: { x: cx, y, r } };
};

const CHECK_TEXT = { nutToHeel: 'nut-to-heel length', heelCornerR: 'heel corner radius', screwFromHeelEnd: 'neck screw position', boardPastHeel: 'fretboard overhang' };

// Wood between a point and the nearest hole edge, cavity edge or body edge (0 when it sits in or on one).
export function clearanceAt(p, g) {
  if (!pointInPoly(p, g.outline)) return 0;
  let d = distToPoly(p, g.outline, true).d;
  for (const c of g.cuts) {
    if (c.kind === 'pickupPart') continue;
    if (pointInPoly(p, c.poly)) return 0;
    d = Math.min(d, distToPoly(p, c.poly, true).d);
  }
  for (const h of g.holes) d = Math.min(d, Math.max(0, Math.hypot(h.x - p.x, h.y - p.y) - h.d / 2));
  return d;
}

// Starting spots for two alignment pins on the centerline. One sits 7 mm below the end of the neck
// pocket, as on the Black Chapel T-style template; the other goes under the bridge plate when there is
// one. Both move to the clearest nearby spot if something is in the way. They are only starting spots.
export function defaultRegHoles(design, g) {
  const r = design.tooling.regPin / 2;
  const clearest = (y0, y1, prefer) => {
    if (prefer !== undefined && clearanceAt({ x: 0, y: prefer }, g) >= r + 3) return { x: 0, y: Math.round(prefer * 100) / 100 };
    let best = { y: prefer !== undefined ? prefer : y1, c: -1 };
    for (let y = y0; y <= y1 + 1e-9; y += 0.5) { const c = clearanceAt({ x: 0, y }, g); if (c > best.c + 1e-9) best = { y, c }; }
    return { x: 0, y: Math.round(best.y * 2) / 2 };
  };
  const plate = g.bridge.outlines.map((o) => bbox(o)).find((b) => b.x0 < 0 && b.x1 > 0 && b.h > 2 * r + 12);
  const bridgePin = plate ? clearest(plate.y0 + r + 3, plate.y1 - r - 3) : clearest(-12, 6);
  const neckPin = clearest(g.heelY - 30, g.heelY - 6, g.heelY - 7);
  return [bridgePin, neckPin];
}

// Holes of the same kind and size get one legend line.
function groupHoles(holes) {
  const map = new Map();
  for (const h of holes) {
    const key = h.label + '|' + h.d.toFixed(2);
    if (!map.has(key)) map.set(key, { label: h.label, d: h.d, pts: [] });
    map.get(key).pts.push(h);
  }
  return [...map.values()].map((e) => ({ label: e.label, d: e.d, count: e.pts.length, box: bbox(e.pts.map((p) => ({ x: p.x, y: p.y }))) }))
    .map((e) => ({ ...e, box: { ...e.box, x0: e.box.x0 - e.d / 2, x1: e.box.x1 + e.d / 2, y0: e.box.y0 - e.d / 2, y1: e.box.y1 + e.d / 2 } }));
}

function clearOf(p, polys, holes, margin) {
  const box = { x0: p.x - margin, y0: p.y - margin, x1: p.x + 4 + margin, y1: p.y + 5 + margin };
  for (const q of polys) { const b = bbox(q); if (b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0 && nearPoly(box, q)) return false; }
  for (const h of holes) if (h.x + h.d / 2 > box.x0 && h.x - h.d / 2 < box.x1 && h.y + h.d / 2 > box.y0 && h.y - h.d / 2 < box.y1) return false;
  return true;
}
function nearPoly(box, q) {
  const corners = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }, { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }];
  return corners.some((c) => pointInPoly(c, q)) || q.some((v) => v.x > box.x0 && v.x < box.x1 && v.y > box.y0 && v.y < box.y1);
}

// Find a clear rectangle on the sheet for the legend: scan a coarse grid and take the best spot.
function findSpot(w, h, sb, solidAt, polys, holes, keepClear) {
  let best = null;
  for (let y = sb.y0 + 6; y + h < sb.y1 - 6; y += 6) {
    for (let x = sb.x0 + 6; x + w < sb.x1 - 6; x += 6) {
      const pts = [];
      for (let i = 0; i <= 6; i++) for (let j = 0; j <= 4; j++) pts.push({ x: x + (w * i) / 6, y: y + (h * j) / 4 });
      if (!pts.every(solidAt)) continue;
      const box = { x0: x - 3, y0: y - 3, x1: x + w + 3, y1: y + h + 3 };
      let ok = true;
      for (const q of polys) { const b = bbox(q); if (b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0 && nearPoly(box, q)) { ok = false; break; } }
      if (!ok) continue;
      for (const hh of holes) if (hh.x + hh.d / 2 > box.x0 && hh.x - hh.d / 2 < box.x1 && hh.y + hh.d / 2 > box.y0 && hh.y - hh.d / 2 < box.y1) { ok = false; break; }
      if (!ok) continue;
      if (keepClear.some((b) => b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0)) continue;
      // prefer spots low on the body that do not sit across the engraved centerline
      const crossesCenter = x < 3 && x + w > -3;
      const score = -y - (crossesCenter ? 500 : 0);
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  return best;
}

const sampleLine = (a, b, step) => {
  const L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(2, Math.ceil(L / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
};

// Break a sentence into lines no wider than maxW at lettering height h.
function wrapText(str, maxW, h) {
  const out = [];
  let cur = '';
  for (const word of String(str).split(' ')) {
    const next = cur ? cur + ' ' + word : word;
    if (cur && textWidth(next, h) > maxW) { out.push(cur); cur = word; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

// Consecutive runs of points that pass a test (each run has at least two points).
function runsInside(pts, test) {
  const out = [];
  let cur = [];
  for (const p of pts) {
    if (test(p)) cur.push(p);
    else { if (cur.length > 1) out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}
