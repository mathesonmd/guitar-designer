// 2D vectors for cutting pockets and holes on a CNC router: every opening at its finished edge and
// true position, with no template offsets. One DXF for work done from the top of the body, one for
// work done from the back, and one for the headstock (its outline and tuner holes) when the neck has one. Each layer is named for what it is and how deep it goes, so the depth can be
// read straight off the layer list in the CAM program.
//
// Coordinates are the design's own: x = 0 is the centerline, y = 0 is the scale line. The files are
// written in millimeters or in inches, as asked; layer names give sizes in the same unit.
// Nothing in a file reaches outside the body outline's own box unless the neck pocket has to (the
// read-me says when), so a CAM program that centers the vectors and the 3D model puts them in register.
// The back file is mirrored across the centerline, as the body looks once it is turned over like the
// page of a book.
import { fitArcs } from '../core/arcfit.js';
import { mirrorX } from '../core/poly.js';
import { unverifiedNeckKeys } from '../model/design.js';
import { toDXF } from './dxf.js';

const IN = 25.4;
const QUARTER = Math.tan(Math.PI / 8);
const COLORS = [5, 3, 6, 4, 2, 30, 94, 210]; // AutoCAD color numbers, cycled; red is kept for the outline
const POCKET_PAST_EDGE = 12; // how far the open neck pocket runs past the body edge, as on the drawing
const mmText = (v) => (Math.round(v * 100) / 100).toFixed(2);
const both = (v) => `${mmText(v)} mm (${(v / IN).toFixed(4)} in)`;
// a size as it appears in a layer name
const sized = (v, units) => (units === 'in' ? `${(v / IN).toFixed(4)}IN` : `${mmText(v)}MM`);
const word = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const NO_DEPTH_NOTE = 'the design does not record a depth: drill to suit your hardware';

// Returns { units, files: [{ side, name, layers, paths }], unverified: [neck keys], box, pocketOverrun }.
// A layer is { name, aci, what, count, depth (mm, or null), note }. Path coordinates are in `units`;
// `box` (the body outline's box) and `pocketOverrun` stay in millimeters.
export function buildCncVectors(design, g, { units = 'mm' } = {}) {
  const T = design.body.thickness;
  const k = units === 'in' ? 1 / IN : 1;
  const S = (verts) => verts.map((q) => ({ ...q, x: q.x * k, y: q.y * k }));
  // the neck pocket stops a short way past the body edge it opens through
  const pocketTop = g.mouthY !== null && g.mouthY !== undefined ? g.mouthY + POCKET_PAST_EDGE : null;
  const pocketOverrun = pocketTop !== null ? Math.max(0, pocketTop - g.bbox.y1) : 0;
  const make = (side) => {
    const flip = side === 'back';
    const layers = new Map();
    const paths = [];
    const layer = (name, what, depth, note, aci) => {
      if (!layers.has(name)) layers.set(name, { name, aci: aci || COLORS[layers.size % COLORS.length], what, count: 0, depth, note: note || '' });
      const L = layers.get(name); L.count++;
      return name;
    };
    const poly = (name, p) => paths.push({ layer: name, closed: true, verts: S(fitArcs(flip ? mirrorX(p) : p, 0.01, true)) });
    const circle = (name, h) => {
      const c = { x: (flip ? -h.x : h.x) * k, y: h.y * k, r: (h.d / 2) * k };
      paths.push({ layer: name, closed: true, circle: c, verts: [[-1, 0], [0, -1], [1, 0], [0, 1]].map(([ux, uy]) => ({ x: c.x + ux * c.r, y: c.y + uy * c.r, bulge: QUARTER })) });
    };
    const line = (name, a, b) => paths.push({ layer: name, closed: false, verts: S([a, b].map((q) => ({ x: flip ? -q.x : q.x, y: q.y, bulge: 0 }))) });

    poly(layer('BODY_OUTLINE', 'Body outline', T, 'cut right through, last', 1), g.outline);
    const guide = layer('GUIDE_CENTERLINE_AND_SCALE_LINE', 'Centerline and scale line', null, 'for lining up only: do not cut', 8);
    line(guide, { x: 0, y: g.bbox.y0 }, { x: 0, y: g.bbox.y1 });
    line(guide, { x: g.bbox.x0, y: 0 }, { x: g.bbox.x1, y: 0 });

    if (!flip && g.bevelEdge) {
      const name = `TOP_EDGE_BEVEL_INNER_LINE_UP_TO_${sized(g.bevelEdge.deepest, units)}_DEEP_AT_THE_BODY_EDGE`;
      poly(layer(name, 'Bevel around the top edge, inner line', g.bevelEdge.deepest, 'the bevel runs from this line, at the top, down to the body outline, where it is that deep at its deepest; a guide for 3D work, not a pocket'), g.bevelEdge.innerPoly);
    }
    if (!flip && g.purfling) {
      const name = `TOP_PURFLING_CHANNEL_${sized(g.purfling.width, units)}_WIDE_${sized(g.purfling.depth, units)}_DEEP`;
      for (const p of [...g.purfling.outer, ...g.purfling.inner]) poly(layer(name, 'Purfling channel, both edges', g.purfling.depth, `the channel is the ${both(g.purfling.width)} between these two lines`), p);
    }
    if (!flip && g.binding) {
      const name = `TOP_BINDING_CHANNEL_INNER_EDGE_${sized(g.binding.width, units)}_WIDE_${sized(g.binding.depth, units)}_DEEP`;
      for (const inner of g.binding.inner) poly(layer(name, 'Binding channel, inner edge', g.binding.depth, `the channel is the ${both(g.binding.width)} between this line and the body outline`), inner);
    }

    const SIDE = flip ? 'BACK' : 'TOP';
    for (const c of g.cuts) {
      const d = Math.min(c.depth, T);
      if (c.side !== side || !(d > 0)) continue;
      const through = d >= T - 1e-6;
      const name = through ? `${SIDE}_${word(c.label)}_THROUGH` : `${SIDE}_${word(c.label)}_${sized(d, units)}_DEEP`;
      const shape = c.open && pocketTop !== null && g.pocketTo ? g.pocketTo(pocketTop) : c.poly;
      poly(layer(name, c.label, d, [through ? 'goes right through' : '', c.open ? `runs ${both(POCKET_PAST_EDGE)} past the body edge so the bit can leave the pocket` : ''].filter(Boolean).join('; ')), shape);
    }
    for (const h of g.holes) {
      const dia = `${sized(h.d, units)}_HOLE`;
      if (h.side === 'through') circle(layer(`THROUGH_${word(h.label)}_${dia}`, h.label, T, `${both(h.d)} across, right through; in both files, drill from one side only`), h);
      else if (h.side === side && h.depth > 0) circle(layer(`${SIDE}_${word(h.label)}_${dia}_${sized(h.depth, units)}_DEEP`, h.label, h.depth, `${both(h.d)} across`), h);
      else if (h.side === side) circle(layer(`${SIDE}_${word(h.label)}_${dia}_DEPTH_TO_SUIT`, h.label, null, `${both(h.d)} across; ${NO_DEPTH_NOTE}`), h);
    }
    return { side, name: flip ? 'Back of the body (mirrored)' : 'Top of the body', layers: [...layers.values()], paths };
  };
  const top = make('top'), back = make('back');
  // a back file is only worth saving when something is cut from the back
  const backWork = back.layers.some((L) => L.name.startsWith('BACK_'));
  // The headstock, when the neck has one: its front face laid flat at its true shape, as a part of its
  // own (x across, y along from the nut line). It carries the tuner holes. It has its own box and does not
  // line up with the body files.
  const files = backWork ? [top, back] : [top];
  const hd = g.neck && g.neck.head;
  if (hd) {
    const layers = [], paths = [], thick = hd.thick;
    const layer = (name, what, depth, note, aci) => { let L = layers.find((q) => q.name === name); if (!L) { L = { name, aci, what, count: 0, depth, note }; layers.push(L); } L.count++; return name; };
    paths.push({ layer: layer('HEADSTOCK_OUTLINE', 'Headstock outline', thick, `cut right through, last; ${both(thick)} thick; the straight edge is the nut line`, 1), closed: true, verts: S(fitArcs(hd.poly, 0.01, true)) });
    layers.push({ name: 'GUIDE_CENTERLINE_AND_NUT_LINE', aci: 8, what: 'Centerline and nut line', count: 0, depth: null, note: 'for lining up only: do not cut' });
    const half = Math.abs(hd.poly[0].x);
    for (const [a, b] of [[{ x: 0, y: 0 }, { x: 0, y: hd.length }], [{ x: -half, y: 0 }, { x: half, y: 0 }]]) paths.push({ layer: layer('GUIDE_CENTERLINE_AND_NUT_LINE'), closed: false, verts: S([a, b].map((q) => ({ x: q.x, y: q.y, bulge: 0 }))) });
    for (const t of hd.tuners) {
      const name = layer(`THROUGH_TUNER_${sized(t.d, units)}_HOLE`, 'Tuner holes', thick, `${both(t.d)} across, right through the headstock, square to its face`, 5);
      const c = { x: t.x * k, y: t.v * k, r: (t.d / 2) * k };
      paths.push({ layer: name, closed: true, circle: c, verts: [[-1, 0], [0, -1], [1, 0], [0, 1]].map(([ux, uy]) => ({ x: c.x + ux * c.r, y: c.y + uy * c.r, bulge: QUARTER })) });
    }
    files.push({ side: 'headstock', name: 'Front of the headstock, laid flat at its true shape', layers, paths });
  }
  // The top face of the neck, when it has a truss rod channel with its sizes entered: the face the fretboard
  // is glued to, as a part of its own (x across, y along from the nut line, so the neck lies below y = 0 and
  // the headstock above, the same way round as the headstock's file).
  const tr = g.truss && g.truss.ready ? g.truss : null;
  if (tr) {
    const layers = [], paths = [], ny = g.nutY;
    const layer = (name, what, depth, note, aci) => { let L = layers.find((q) => q.name === name); if (!L) { L = { name, aci, what, count: 0, depth, note }; layers.push(L); } L.count++; return name; };
    const shift = (poly) => poly.map((q) => ({ x: q.x, y: q.y - ny, bulge: q.bulge || 0 }));
    paths.push({ layer: layer('NECK_OUTLINE', 'Edge of the neck\u2019s top face', null, 'the fretboard\u2019s edges, from the end of the heel to the nut line (the straight end at y = 0); for lining up, or for your own outline toolpath', 1), closed: true, verts: S(shift(fitArcs(g.pocketTo(ny), 0.01, true))) });
    layers.push({ name: 'GUIDE_CENTERLINE_AND_NUT_LINE', aci: 8, what: 'Centerline and nut line', count: 0, depth: null, note: 'for lining up only: do not cut' });
    const reach = tr.access && tr.adjust === 'head' ? tr.access.y1 - ny : 0, nutHalf = g.neckHalf(ny);
    for (const [a, b] of [[{ x: 0, y: g.heelY - ny }, { x: 0, y: Math.max(0, reach) }], [{ x: -nutHalf, y: 0 }, { x: nutHalf, y: 0 }]]) paths.push({ layer: layer('GUIDE_CENTERLINE_AND_NUT_LINE'), closed: false, verts: S([a, b].map((q) => ({ x: q.x, y: q.y, bulge: 0 }))) });
    paths.push({ layer: layer(`TOP_TRUSS_ROD_CHANNEL_${sized(tr.width, units)}_WIDE_${sized(tr.depth, units)}_DEEP`, 'Truss rod channel', tr.depth, `${both(tr.width)} wide, ${both(tr.length)} long, flat bottom, square ends as drawn: a round bit leaves round ends, so allow for that against your rod`, 5), closed: true, verts: S(shift(tr.channel)) });
    if (tr.access) paths.push({ layer: layer(`TOP_TRUSS_ROD_ADJUSTER_POCKET_${sized(tr.access.width, units)}_WIDE_${sized(tr.access.depth, units)}_DEEP`, 'Pocket for the truss rod\u2019s adjuster', tr.access.depth, `${both(tr.access.width)} wide, ${both(tr.access.length)} long, at the ${tr.adjust === 'heel' ? 'heel end' : 'headstock end'} of the channel${tr.adjust === 'head' ? '; it is drawn in the plane of the neck\u2019s top face, so on an angled headstock its depth is measured from that plane, not from the headstock\u2019s face' : ''}`, 3), closed: true, verts: S(shift(tr.access.poly)) });
    files.push({ side: 'neck', name: 'Top face of the neck, before the fretboard is glued on', layers, paths });
  }
  return { units, files, unverified: unverifiedNeckKeys(design), box: g.bbox, pocketOverrun };
}

export const cncDXF = (file, units = 'mm') => toDXF({ sheets: [{ paths: file.paths }] }, file.layers, units);

const NECK_WORDS = { nutToHeel: 'nut to end of heel', nutWidth: 'nut width', heelCornerR: 'heel corner radius', screwFromHeelEnd: 'neck screw position', boardPastHeel: 'fretboard overhang' };

export function cncReadme(design, vectors, fileNames) {
  const T = design.body.thickness;
  const lines = [
    `${design.name}`,
    'CNC vectors from the Black Chapel Studios Guitar Designer',
    `Made ${new Date().toISOString().slice(0, 10)}. All files are true size, in ${vectors.units === 'in' ? 'inches' : 'millimeters'}.`,
    '',
    'WHAT THESE ARE',
    'Every pocket and hole as a 2D vector at its finished edge and true position, for pocketing and',
    'drilling toolpaths. No tool or template offsets are built in: let your CAM program allow for the bit.',
    'Each layer is named for what it is and how deep it goes.',
    '',
    'BEFORE YOU CUT WOOD',
    '1. These files have been checked in software only. Nothing has been cut from them. Make a test cut in scrap.',
    vectors.unverified.length
      ? `2. These neck numbers have not been confirmed against a real neck: ${vectors.unverified.map((k) => NECK_WORDS[k] || k).join(', ')}. Measure your neck before cutting the pocket or drilling for its screws.`
      : '2. Check the neck and hardware you will use against the vectors before cutting.',
    '3. Check one known size after you import: the body outline should be the size shown in the designer.',
    '',
    'HOW THEY SIT',
    '  x = 0 is the centerline of the guitar. y = 0 is the scale line (one scale length from the nut).',
    '  The 3D model from the designer uses the same origin, so the two line up.',
    `  Body thickness: ${both(T)}.`,
    `  The body outline's box runs from x = ${both(vectors.box.x0)} to ${both(vectors.box.x1)}`,
    `  and from y = ${both(vectors.box.y0)} to ${both(vectors.box.y1)}.`,
    vectors.pocketOverrun > 0
      ? `  LINING UP WITH THE 3D MODEL: the neck pocket runs ${both(vectors.pocketOverrun)} above the body outline's box, so the vectors' box is that much taller than the model's. Line them up by the body outline, not by centering both.`
      : '  LINING UP WITH THE 3D MODEL: nothing in these files reaches outside the body outline\'s box, which is also the 3D model\'s box. Centering the vectors and the model in your CAM program puts them in register.',
    vectors.files.some((f) => f.side === 'back')
      ? '  The back file is mirrored across the centerline: it shows the back as you see it after turning the body over like the page of a book.'
      : '  Nothing in this design is cut from the back, so there is no back file.',
    ...(vectors.files.some((f) => f.side === 'neck') ? ['  The neck file is a separate part: the top face of the neck (the face the fretboard is glued to), x across and', '  y along from the nut line, with the heel toward -y. It carries the truss rod channel, cut from that face before', '  the fretboard goes on. It has its own box and does not line up with the body files. The channel\u2019s sizes are the', '  ones typed into the app: check them against the rod itself before cutting.'] : []),
    ...(vectors.files.some((f) => f.side === 'headstock') ? ['  The headstock file is a separate part: its front face laid flat at its true shape, x across and y along from', '  the nut line. It has its own box and does not line up with the body files. Tuner holes go right through,', '  square to the face.'] : []),
    '',
  ];
  vectors.files.forEach((f, i) => {
    lines.push(`${fileNames[i]}   ${f.name}`);
    for (const L of f.layers) {
      lines.push(`  ${L.name}`);
      const isPocket = L.depth !== null && !/_OUTLINE$/.test(L.name) && !/_THROUGH$|^THROUGH_/.test(L.name);
      lines.push(`      ${[`${L.what}${L.count > 1 ? ' x' + L.count : ''}`, isPocket ? `${both(L.depth)} deep` : '', L.note].filter(Boolean).join(': ').replace(/deep: /, 'deep; ')}`);
    }
    lines.push('');
  });
  lines.push('Black Chapel Studios. blackchapelstudios.com', '');
  return lines.join('\r\n');
}
