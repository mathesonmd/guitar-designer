// The truss rod channel: a straight slot with a flat bottom down the middle of the neck's top face, cut
// before the fretboard is glued on, for a two-way rod. With it, an optional wider pocket at the end where
// the rod is adjusted (the headstock end or the heel end).
//
// No size is built in (the owner's Fretboard Designer has no truss rod, and rods differ by maker): every
// number starts at 0, which means "not entered", and nothing is drawn or saved for the channel until its
// width, depth and length are in. The same rule as hole depths for bridge hardware.
//   on            whether the neck has a channel
//   adjust        'head' or 'heel': the end the rod is adjusted from
//   width, depth  the channel, across and down from the neck's top face (the face the fretboard is glued to)
//   length        the channel's length
//   fromNut       from the nut line to the channel's end nearest the headstock (0 = it starts at the nut line)
//   accessWidth, accessLength, accessDepth   the pocket for the adjuster. All 0 = no pocket.
//                 At the heel it carries on `accessLength` from the channel's end toward the end of the heel.
//                 At the headstock it runs from the channel's end to `accessLength` past the end of the
//                 fretboard: that is the nut line until a nut has been read from a Fretboard Designer file,
//                 and with one, the fretboard's end past the nut (the back of the nut, or the end of its
//                 shelf). So `accessLength` is the length of pocket left open on the headstock.
export const TRUSS_START = { on: false, adjust: 'head', width: 0, depth: 0, length: 0, fromNut: 0, accessWidth: 0, accessLength: 0, accessDepth: 0 };
export const TRUSS_LABELS = { width: 'channel width', depth: 'channel depth', length: 'channel length' };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
export function cleanTruss(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    on: !!r.on, adjust: r.adjust === 'heel' ? 'heel' : 'head',
    width: num(r.width), depth: num(r.depth), length: num(r.length), fromNut: num(r.fromNut),
    accessWidth: num(r.accessWidth), accessLength: num(r.accessLength), accessDepth: num(r.accessDepth),
  };
}

const rect = (half, ya, yb) => [{ x: -half, y: Math.min(ya, yb) }, { x: half, y: Math.min(ya, yb) }, { x: half, y: Math.max(ya, yb) }, { x: -half, y: Math.max(ya, yb) }];

// Returns null when the channel is switched off. Otherwise, in the design's own coordinates (y = 0 at the
// scale line, the nut at g.nutY):
//   { ready, missing, adjust, width, depth, length, yHead, yHeel, channel, access, under, beside, screws, ... }
// `ready` is false, and there are no shapes, until width, depth and length have been entered.
export function buildTruss(design, g) {
  const t = cleanTruss(design.neck.truss);
  if (!t.on) return null;
  const missing = ['width', 'depth', 'length'].filter((k) => !(t[k] > 0));
  if (missing.length) return { ready: false, missing, adjust: t.adjust };
  const yHead = g.nutY - t.fromNut, yHeel = yHead - t.length;
  const channel = rect(t.width / 2, yHeel, yHead);
  // the adjuster's pocket: all three of its sizes, or none
  const accessSizes = ['accessWidth', 'accessLength', 'accessDepth'].filter((k) => t[k] > 0);
  let access = null;
  if (accessSizes.length === 3) {
    const nut = cleanNut(design.neck.nut), boardEnd = g.nutY + (nut.thickness > 0 ? nut.boardPast : 0);
    const a = t.adjust === 'heel' ? yHeel : yHead, b = t.adjust === 'heel' ? yHeel - t.accessLength : boardEnd + t.accessLength;
    access = { poly: rect(t.accessWidth / 2, a, b), width: t.accessWidth, length: t.accessLength, depth: t.accessDepth, y0: Math.min(a, b), y1: Math.max(a, b), ...(t.adjust === 'heel' ? {} : { boardEnd, pastNut: boardEnd - g.nutY, underBoard: boardEnd - yHead }) };
  }
  // wood left under the channel: the neck's depth on the centerline (the fretboard is not part of it), less
  // the channel's depth, at its thinnest place between the nut and the end of the heel
  let under = null;
  const neck = g.neck;
  if (neck) {
    const from = Math.max(yHeel, g.heelY), to = Math.min(yHead, g.nutY), steps = Math.max(1, Math.ceil((to - from) / 2));
    for (let i = 0; i <= steps && to > from; i++) {
      const y = from + ((to - from) * i) / steps, left = neck.at(y).depth - t.depth;
      if (!under || left < under.t) under = { t: left, y, fromNut: g.nutY - y };
    }
  }
  // wood left beside it, at the narrowest place the channel reaches (the neck is narrowest toward the nut)
  const beside = g.neckHalf(Math.min(yHead, g.nutY)) - t.width / 2;
  // neck screws come up into the heel from the back: one is in the way only if it lies under the channel or pocket
  const screws = (g.holes || []).filter((h) => h.kind === 'neckscrew').filter((h) => {
    const hit = (half, y0, y1) => Math.abs(h.x) - h.d / 2 < half && h.y + h.d / 2 > y0 && h.y - h.d / 2 < y1;
    return hit(t.width / 2, yHeel, yHead) || (access && hit(access.width / 2, access.y0, access.y1));
  }).length;
  return {
    ready: true, missing: [], adjust: t.adjust, width: t.width, depth: t.depth, length: t.length, fromNut: t.fromNut,
    yHead, yHeel, channel, access, accessPartly: accessSizes.length > 0 && accessSizes.length < 3,
    under, beside, screws,
    pastHeel: g.heelY - yHeel,                                   // > 0: the channel runs out of the end of the heel
    accessShort: access && t.adjust === 'heel' ? access.y0 - g.heelY : 0, // > 0: the pocket stops short of the end of the heel
  };
}

// The nut, as the owner's Fretboard Designer makes it: cut in the fretboard, its front face on the nut
// line (or `gap` behind a zero fret), `thickness` measured along the neck toward the headstock. `boardPast`
// is how far the fretboard itself runs past the nut line: to the back of the nut ('flush'), or further
// ('shelf'). Nothing is built in: the numbers come only from a Fretboard Designer build file, and until one
// is loaded (thickness 0) no nut is drawn.
export const NUT_START = { thickness: 0, gap: 0, boardPast: 0, mount: 'flush', zeroFret: false };
export function cleanNut(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const thickness = num(r.thickness), gap = num(r.gap);
  return { thickness, gap, boardPast: Math.max(num(r.boardPast), thickness > 0 ? gap + thickness : 0), mount: r.mount === 'shelf' ? 'shelf' : 'flush', zeroFret: !!r.zeroFret };
}
// What a Fretboard Designer build file says about the nut, in millimeters (k = millimeters per file unit).
export function nutFromFretboardFile(params, k) {
  const p = params || {}, thickness = num(p.nutThickness) * k;
  if (!(thickness > 0)) return { ...NUT_START };
  const zeroFret = !!p.zeroFret, gap = zeroFret ? num(p.nutZeroGap) * k : 0, shelf = p.nutMount === 'shelf';
  return cleanNut({ thickness, gap, zeroFret, mount: shelf ? 'shelf' : 'flush', boardPast: shelf ? num(p.spaceBeforeNut) * k : gap + thickness });
}
// The nut on the drawing: null until a file has been loaded. The nut and the end of the fretboard follow the
// fretboard's edges carried on past the nut line, as the Fretboard Designer draws them.
export function buildNut(design, g) {
  const n = cleanNut(design.neck.nut);
  if (!(n.thickness > 0)) return null;
  const front = g.nutY + n.gap, back = front + n.thickness, end = g.nutY + n.boardPast;
  const at = (y) => g.neckHalf(y);
  return {
    ...n, front, back, boardEnd: end,
    poly: [{ x: -at(front), y: front }, { x: at(front), y: front }, { x: at(back), y: back }, { x: -at(back), y: back }],
    // the fretboard past the nut line, to its end
    board: [{ x: -at(g.nutY), y: g.nutY }, { x: at(g.nutY), y: g.nutY }, { x: at(end), y: end }, { x: -at(end), y: end }],
  };
}
