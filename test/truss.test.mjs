// The truss rod channel (src/model/truss.js): nothing built in, nothing cut until its sizes are entered.
// The sizes used here are made up for the tests; none of them is a recommendation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDesign, normalizeDesign } from '../src/model/design.js';
import { derive } from '../src/model/derive.js';
import { runChecks } from '../src/model/checks.js';
import { TRUSS_START, cleanTruss, NUT_START, cleanNut, nutFromFretboardFile } from '../src/model/truss.js';
import { buildCncVectors, cncDXF, cncReadme } from '../src/export/cnc.js';
import { expandArcs } from '../src/core/arcfit.js';
import { bbox } from '../src/core/poly.js';

const withTruss = (patch) => { const d = defaultDesign(); d.neck.truss = { ...TRUSS_START, on: true, ...patch }; return d; };
const SIZES = { width: 6, depth: 9, length: 400, fromNut: 12 };
const checks = (d) => runChecks(d, derive(d, { tol: 0.01 }));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

test('no size is built in: the channel starts switched off with every number at 0, and old files open without one', () => {
  const d = defaultDesign();
  assert.deepEqual(d.neck.truss, { on: false, adjust: 'head', width: 0, depth: 0, length: 0, fromNut: 0, accessWidth: 0, accessLength: 0, accessDepth: 0 });
  assert.equal(derive(d).truss, null);
  const old = JSON.parse(JSON.stringify(d)); delete old.neck.truss;
  assert.deepEqual(normalizeDesign(old).neck.truss, d.neck.truss);
  // rubbish in a file is not carried in
  assert.deepEqual(cleanTruss({ on: 1, adjust: 'sideways', width: -3, depth: 'deep', length: NaN, fromNut: 5 }), { ...TRUSS_START, on: true, fromNut: 5 });
  assert.ok(!checks(d).some((c) => /truss/i.test(c.title)), 'nothing is said about a channel that is off');
});

test('switched on with sizes missing, nothing is drawn or saved, and the build checks ask for them', () => {
  const d = withTruss({ width: 6 }), g = derive(d, { tol: 0.01 });
  assert.deepEqual({ ready: g.truss.ready, missing: g.truss.missing }, { ready: false, missing: ['depth', 'length'] });
  assert.equal(g.truss.channel, undefined);
  const c = runChecks(d, g).filter((q) => /truss/i.test(q.title));
  assert.equal(c.length, 1);
  assert.equal(c[0].title, 'The truss rod channel needs its depth and length');
  assert.match(c[0].detail, /No size is built in/);
  assert.ok(!buildCncVectors(d, g).files.some((f) => f.side === 'neck'), 'no neck file without the sizes');
});

test('the channel sits on the centerline where the numbers put it, and the wood under it is measured', () => {
  const d = withTruss(SIZES), g = derive(d, { tol: 0.01 }), t = g.truss;
  assert.equal(t.ready, true);
  const b = bbox(t.channel);
  near(b.x0, -3, 1e-9); near(b.x1, 3, 1e-9); near(b.y1, g.nutY - 12, 1e-9, 'starts 12 from the nut'); near(b.y0, g.nutY - 412, 1e-9, 'ends 412 from the nut');
  assert.equal(t.access, null);
  // wood under it: the neck's own depth on the centerline less the channel's depth, at the thinnest place
  let least = Infinity;
  for (let y = b.y0; y <= b.y1; y += 0.5) least = Math.min(least, g.neck.at(y).depth - 9);
  near(t.under.t, least, 0.02, 'thinnest wood under the channel');
  near(t.under.t, g.neck.d1 - 9, 0.3, 'which on this neck is by the 1st fret, where the neck is thinnest');
  near(t.beside, g.neckHalf(g.nutY - 12) - 3, 1e-9);
  near(t.pastHeel, -(g.nutY - 412 - g.heelY), 1e-9);
  const c = checks(d).filter((q) => /truss/i.test(q.title));
  assert.ok(c.length === 1 && c[0].level === 'note' && /of wood is left under the truss rod channel at its thinnest/.test(c[0].title));
  assert.match(c[0].detail, /No least thickness is built in/);
});

test('a channel that is too deep, too wide, or runs out of the heel is caught', () => {
  const deep = checks(withTruss({ ...SIZES, depth: 25 })).find((q) => /cuts through the back of the neck/.test(q.title));
  assert.equal(deep.level, 'error');
  const wide = withTruss({ ...SIZES, width: 20 }); wide.neck.truss.width = 60;
  assert.ok(checks(wide).some((q) => q.level === 'error' && /wider than the neck/.test(q.title)));
  const g = derive(defaultDesign()), full = g.nutY - g.heelY;
  const long = checks(withTruss({ ...SIZES, fromNut: 0, length: full + 8 })).find((q) => /past the end of the heel/.test(q.title));
  assert.ok(long && long.level === 'warn' && /runs .* past the end of the heel/.test(long.title));
  // adjusted at the heel, running out of the end is how the rod is reached: said, not warned about
  const heel = checks(withTruss({ ...SIZES, adjust: 'heel', fromNut: 0, length: full + 8 }));
  assert.ok(heel.some((q) => q.level === 'note' && /open at the end of the heel/.test(q.title)) && !heel.some((q) => q.level === 'warn' && /truss/i.test(q.title)));
  // adjusted at the heel but closed there
  assert.ok(checks(withTruss({ ...SIZES, adjust: 'heel' })).some((q) => /nothing opens at the end of the heel/.test(q.title)));
  // a pocket wide enough to reach the neck screws
  const d = defaultDesign(), sa = d.neck.screwAcross;
  const hit = checks(withTruss({ ...SIZES, adjust: 'heel', fromNut: 0, length: full - 30, accessWidth: sa + 2, accessLength: 30, accessDepth: 9 }));
  assert.ok(hit.some((q) => q.level === 'warn' && /neck screws? comes? up under the truss rod channel/.test(q.title)), hit.map((q) => q.title).join(' | '));
});

test('the adjuster’s pocket goes at the chosen end, and needs all three of its sizes', () => {
  const head = derive(withTruss({ ...SIZES, accessWidth: 10, accessLength: 30, accessDepth: 11 })).truss, g = derive(defaultDesign());
  const hb = bbox(head.access.poly);
  near(hb.y0, g.nutY - 12, 1e-9, 'from the channel’s headstock end'); near(hb.y1, g.nutY + 30, 1e-9, '30 past the end of the fretboard, which is the nut line until a nut is loaded'); near(hb.w, 10, 1e-9);
  const heel = derive(withTruss({ ...SIZES, adjust: 'heel', accessWidth: 10, accessLength: 30, accessDepth: 11 })).truss, lb = bbox(heel.access.poly);
  near(lb.y1, g.nutY - 412, 1e-9, 'from the channel’s heel end'); near(lb.y0, g.nutY - 442, 1e-9, 'toward the end of the heel');
  const part = withTruss({ ...SIZES, accessWidth: 10 });
  assert.equal(derive(part).truss.access, null);
  assert.ok(checks(part).some((q) => /adjuster needs all three of its sizes/.test(q.title)));
});

test('the neck gets its own vector file: outline, nut line, and the channel on a layer named with its width and depth', () => {
  const d = withTruss({ ...SIZES, accessWidth: 10, accessLength: 30, accessDepth: 11 }), g = derive(d, { tol: 0.005 }), v = buildCncVectors(d, g);
  assert.deepEqual(v.files.map((f) => f.side), ['top', 'back', 'headstock', 'neck']);
  const f = v.files[3], on = (re) => f.paths.filter((p) => re.test(p.layer)), box = (p) => bbox(expandArcs(p.verts, true));
  assert.deepEqual(f.layers.map((L) => L.name), ['NECK_OUTLINE', 'GUIDE_CENTERLINE_AND_NUT_LINE', 'TOP_TRUSS_ROD_CHANNEL_6.00MM_WIDE_9.00MM_DEEP', 'TOP_TRUSS_ROD_ADJUSTER_POCKET_10.00MM_WIDE_11.00MM_DEEP']);
  const ch = box(on(/^TOP_TRUSS_ROD_CHANNEL/)[0]);
  near(ch.w, 6, 1e-9); near(ch.y1, -12, 1e-9, 'y is measured from the nut line'); near(ch.y0, -412, 1e-9); near(ch.cx, 0, 1e-9);
  const ac = box(on(/^TOP_TRUSS_ROD_ADJUSTER_POCKET/)[0]);
  near(ac.y0, -12, 1e-9); near(ac.y1, 30, 1e-9);
  const o = box(on(/^NECK_OUTLINE$/)[0]);
  near(o.y1, 0, 1e-6, 'the outline ends on the nut line'); near(o.y0, -d.neck.nutToHeel, 1e-6, 'and starts at the end of the heel');
  assert.ok(o.w < d.neck.heelWidth && o.w > d.neck.nutWidth);
  assert.equal(f.layers.find((L) => /CHANNEL/.test(L.name)).depth, 9);
  // nothing of it leaks into the body's files, and nothing changes there
  const plain = buildCncVectors(defaultDesign(), derive(defaultDesign(), { tol: 0.005 }));
  assert.deepEqual(v.files.slice(0, 3).map((q) => q.layers.map((L) => L.name)), plain.files.map((q) => q.layers.map((L) => L.name)));
  // inches: sizes and names in inches
  const inch = buildCncVectors(d, g, { units: 'in' }).files.find((q) => q.side === 'neck');
  assert.ok(inch.layers.some((L) => L.name === 'TOP_TRUSS_ROD_CHANNEL_0.2362IN_WIDE_0.3543IN_DEEP'));
  near(bbox(expandArcs(inch.paths.find((p) => /CHANNEL/.test(p.layer)).verts, true)).w, 6 / 25.4, 1e-9);
  // it writes as a DXF, and the read-me explains the file
  assert.match(cncDXF(f), /TOP_TRUSS_ROD_CHANNEL_6\.00MM_WIDE_9\.00MM_DEEP/);
  const text = cncReadme(d, v, ['a-cnc-top.dxf', 'a-cnc-back.dxf', 'a-cnc-headstock.dxf', 'a-cnc-neck.dxf']);
  assert.match(text, /The neck file is a separate part/); assert.match(text, /a-cnc-neck\.dxf/);
});

test('the nut comes only from a Fretboard Designer file: its thickness, a zero fret\u2019s gap, and where the fretboard ends', () => {
  const d = defaultDesign();
  assert.deepEqual(d.neck.nut, { thickness: 0, gap: 0, boardPast: 0, mount: 'flush', zeroFret: false });
  assert.equal(derive(d).nut, null, 'no nut is drawn until a file is loaded');
  const old = JSON.parse(JSON.stringify(d)); delete old.neck.nut;
  assert.deepEqual(normalizeDesign(old).neck.nut, NUT_START);
  // the Fretboard Designer's own field names and starting values (inches): flush end
  const fd = { nutThickness: 0.125, nutZeroGap: 0.0625, nutMount: 'flush', zeroFret: false, spaceBeforeNut: 0.3 };
  const flush = nutFromFretboardFile(fd, 25.4);
  assert.deepEqual(flush, { thickness: 3.175, gap: 0, boardPast: 3.175, mount: 'flush', zeroFret: false });
  // a zero fret puts the nut behind it; a shelf carries the board past the nut
  const zero = nutFromFretboardFile({ ...fd, zeroFret: true }, 25.4);
  near(zero.gap, 1.5875, 1e-9); near(zero.boardPast, 1.5875 + 3.175, 1e-9, 'flush: the board ends at the back of the nut');
  const shelf = nutFromFretboardFile({ ...fd, nutMount: 'shelf' }, 25.4);
  near(shelf.boardPast, 7.62, 1e-9); assert.equal(shelf.mount, 'shelf');
  // a file in millimeters is taken as it is; a file with no nut gives none; a shelf shorter than the nut cannot be
  near(nutFromFretboardFile({ nutThickness: 4 }, 1).thickness, 4, 1e-12);
  assert.deepEqual(nutFromFretboardFile({}, 25.4), NUT_START);
  near(cleanNut({ thickness: 3, gap: 1, boardPast: 2 }).boardPast, 4, 1e-12);
  // on the drawing: front face on the nut line, as wide as the fretboard's edges carried on past it
  d.neck.nut = shelf;
  const g = derive(d), n = g.nut, b = bbox(n.poly);
  near(b.y0, g.nutY, 1e-9); near(b.y1, g.nutY + 3.175, 1e-9); near(b.w, d.neck.nutWidth, 1e-9, 'nut width at its front face');
  for (const q of n.poly) near(Math.abs(q.x), g.neckHalf(q.y), 1e-9);
  assert.ok(Math.abs(n.poly[2].x) < Math.abs(n.poly[1].x), 'a hair narrower at its back, as the neck tapers');
  const bb = bbox(n.board); near(bb.y0, g.nutY, 1e-9); near(bb.y1, g.nutY + 7.62, 1e-9, 'the fretboard\u2019s end');
  d.neck.nut = zero;
  near(bbox(derive(d).nut.poly).y0, derive(d).nutY + 1.5875, 1e-9, 'behind the zero fret');
  // nothing else moves: the pocket, the frets and the files are the same with a nut as without
  const plain = derive(defaultDesign());
  assert.deepEqual(g.pocket, plain.pocket); assert.deepEqual(g.frets, plain.frets);
  assert.deepEqual(buildCncVectors(d, derive(d, { tol: 0.005 })).files.map((f) => f.layers.map((L) => L.name)), buildCncVectors(defaultDesign(), derive(defaultDesign(), { tol: 0.005 })).files.map((f) => f.layers.map((L) => L.name)));
});

test('with a nut loaded, the headstock-end pocket and the flat headstock\u2019s scoop start at the end of the fretboard', () => {
  const pocket = { ...SIZES, accessWidth: 10, accessLength: 30, accessDepth: 11 };
  const shelf = nutFromFretboardFile({ nutThickness: 0.125, nutMount: 'shelf', spaceBeforeNut: 0.3 }, 25.4);   // board ends 7.62 past the nut line
  const flush = nutFromFretboardFile({ nutThickness: 0.125, nutMount: 'flush' }, 25.4);                         // board ends 3.175 past it
  // the pocket: the same 30 left open on the headstock, measured from wherever the fretboard ends
  for (const [nut, past] of [[null, 0], [flush, 3.175], [shelf, 7.62]]) {
    const d = withTruss(pocket); if (nut) d.neck.nut = nut;
    const g = derive(d), a = g.truss.access, b = bbox(a.poly);
    near(b.y0, g.nutY - 12, 1e-9, 'it starts at the channel\u2019s end'); near(b.y1, g.nutY + past + 30, 1e-9, `it ends 30 past the fretboard (${past} past the nut line)`);
    near(a.pastNut, past, 1e-9); near(a.underBoard, 12 + past, 1e-9);
  }
  // at the heel end the nut changes nothing
  const heel = withTruss({ ...pocket, adjust: 'heel' }), hn = withTruss({ ...pocket, adjust: 'heel' }); hn.neck.nut = shelf;
  assert.deepEqual(derive(hn).truss.access.poly, derive(heel).truss.access.poly);
  // the neck's vector file carries the longer pocket, and its centerline reaches the pocket's end
  const d = withTruss(pocket); d.neck.nut = shelf;
  const f = buildCncVectors(d, derive(d, { tol: 0.005 })).files.find((q) => q.side === 'neck');
  near(bbox(expandArcs(f.paths.find((p) => /ADJUSTER_POCKET/.test(p.layer)).verts, true)).y1, 37.62, 1e-9);
  // the scoop of a flat headstock: level to the end of the fretboard, then the same arc as before, moved along
  const flat = (nut) => { const q = defaultDesign(); q.neck.head = { ...q.neck.head, kind: 'flat', drop: 5, scoop: 22 }; if (nut) q.neck.nut = nut; return derive(q); };
  const g0 = flat(null), g1 = flat(shelf), h0 = g0.neck.head, h1 = g1.neck.head, top = g0.neck.top;
  assert.equal(h0.scoopFrom, 0); near(h1.scoopFrom, 7.62, 1e-9);
  for (const v of [0, 3, 7.62]) near(h1.faceZ(g1.nutY + v), top, 1e-9, `level ${v} past the nut, under the nut and the board`);
  for (const v of [1, 8, 15, 22, 30]) near(h1.faceZ(g1.nutY + 7.62 + v), h0.faceZ(g0.nutY + v), 1e-9, 'the same scoop, starting where the fretboard ends');
  near(h1.faceZ(g1.nutY + 7.62 + 22), top - 5, 1e-9, 'at its full step down one scoop length on');
  assert.ok(h1.reach >= 7.62 + 22 + 5 - 1e-9, 'the transition is never shorter than the lead and the scoop');
  // an angled headstock has no scoop, so nothing moves there
  const ang = defaultDesign(); ang.neck.nut = shelf;
  assert.equal(derive(ang).neck.head.scoopFrom, 0);
  near(derive(ang).neck.head.faceZ(derive(ang).nutY + 10), derive(defaultDesign()).neck.head.faceZ(derive(defaultDesign()).nutY + 10), 1e-12);
});
