// 2D vectors for cutting pockets and holes on a CNC router: every opening at its finished edge and
// true position, with no template offsets. One DXF for work done from the top of the body and one for
// work done from the back. Each layer is named for what it is and how deep it goes, so the depth can be
// read straight off the layer list in the CAM program.
//
// Coordinates are the design's own: x = 0 is the centerline, y = 0 is the scale line, millimeters.
// The back file is mirrored across the centerline, as the body looks once it is turned over like the
// page of a book.
import { fitArcs } from '../core/arcfit.js';
import { mirrorX } from '../core/poly.js';
import { unverifiedNeckKeys } from '../model/design.js';
import { toDXF } from './dxf.js';

const IN = 25.4;
const QUARTER = Math.tan(Math.PI / 8);
const COLORS = [5, 3, 6, 4, 2, 30, 94, 210]; // AutoCAD color numbers, cycled; red is kept for the outline
const mmText = (v) => (Math.round(v * 100) / 100).toFixed(2);
const both = (v) => `${mmText(v)} mm (${(v / IN).toFixed(4)} in)`;
const word = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const NO_DEPTH_NOTE = 'the design does not record a depth: drill to suit your hardware';

// Returns { files: [{ side, name, layers, paths }], unverified: [neck keys] }.
// A layer is { name, aci, what, count, depth (mm, or null), note }.
export function buildCncVectors(design, g) {
  const T = design.body.thickness;
  const make = (side) => {
    const flip = side === 'back';
    const layers = new Map();
    const paths = [];
    const layer = (name, what, depth, note, aci) => {
      if (!layers.has(name)) layers.set(name, { name, aci: aci || COLORS[layers.size % COLORS.length], what, count: 0, depth, note: note || '' });
      const L = layers.get(name); L.count++;
      return name;
    };
    const poly = (name, p) => paths.push({ layer: name, closed: true, verts: fitArcs(flip ? mirrorX(p) : p, 0.01, true) });
    const circle = (name, h) => {
      const c = { x: flip ? -h.x : h.x, y: h.y, r: h.d / 2 };
      paths.push({ layer: name, closed: true, circle: c, verts: [[-1, 0], [0, -1], [1, 0], [0, 1]].map(([ux, uy]) => ({ x: c.x + ux * c.r, y: c.y + uy * c.r, bulge: QUARTER })) });
    };
    const line = (name, a, b) => paths.push({ layer: name, closed: false, verts: [a, b].map((q) => ({ x: flip ? -q.x : q.x, y: q.y, bulge: 0 })) });

    poly(layer('BODY_OUTLINE', 'Body outline', T, 'cut right through, last', 1), g.outline);
    const guide = layer('GUIDE_CENTERLINE_AND_SCALE_LINE', 'Centerline and scale line', null, 'for lining up only: do not cut', 8);
    line(guide, { x: 0, y: g.bbox.y0 - 10 }, { x: 0, y: g.bbox.y1 + 10 });
    line(guide, { x: g.bbox.x0 - 10, y: 0 }, { x: g.bbox.x1 + 10, y: 0 });

    const SIDE = flip ? 'BACK' : 'TOP';
    for (const c of g.cuts) {
      const d = Math.min(c.depth, T);
      if (c.side !== side || !(d > 0)) continue;
      const through = d >= T - 1e-6;
      const name = through ? `${SIDE}_${word(c.label)}_THROUGH` : `${SIDE}_${word(c.label)}_${mmText(d)}MM_DEEP`;
      poly(layer(name, c.label, d, [through ? 'goes right through' : '', c.open ? 'runs past the body edge so the bit can leave the pocket' : ''].filter(Boolean).join('; ')), c.poly);
    }
    for (const h of g.holes) {
      const dia = `${mmText(h.d)}MM_HOLE`;
      if (h.side === 'through') circle(layer(`THROUGH_${word(h.label)}_${dia}`, h.label, T, `${both(h.d)} across, right through; in both files, drill from one side only`), h);
      else if (h.side === side) circle(layer(`${SIDE}_${word(h.label)}_${dia}_DEPTH_TO_SUIT`, h.label, null, `${both(h.d)} across; ${NO_DEPTH_NOTE}`), h);
    }
    return { side, name: flip ? 'Back of the body (mirrored)' : 'Top of the body', layers: [...layers.values()], paths };
  };
  const top = make('top'), back = make('back');
  // a back file is only worth saving when something is cut from the back
  const backWork = back.layers.some((L) => L.name.startsWith('BACK_'));
  return { files: backWork ? [top, back] : [top], unverified: unverifiedNeckKeys(design) };
}

export const cncDXF = (file) => toDXF({ sheets: [{ paths: file.paths }] }, file.layers);

const NECK_WORDS = { nutToHeel: 'nut to end of heel', heelCornerR: 'heel corner radius', screwFromHeelEnd: 'neck screw position', boardPastHeel: 'fretboard overhang' };

export function cncReadme(design, vectors, fileNames) {
  const T = design.body.thickness;
  const lines = [
    `${design.name}`,
    'CNC vectors from the Black Chapel Studios Guitar Designer',
    `Made ${new Date().toISOString().slice(0, 10)}. All files are true size, in millimeters.`,
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
    vectors.files.length > 1
      ? '  The back file is mirrored across the centerline: it shows the back as you see it after turning the body over like the page of a book.'
      : '  Nothing in this design is cut from the back, so there is no back file.',
    '',
  ];
  vectors.files.forEach((f, i) => {
    lines.push(`${fileNames[i]}   ${f.name}`);
    for (const L of f.layers) {
      lines.push(`  ${L.name}`);
      lines.push(`      ${L.what}${L.count > 1 ? ' x' + L.count : ''}${L.depth !== null && !/HOLE/.test(L.name) && L.name !== 'BODY_OUTLINE' && !/THROUGH$/.test(L.name) ? ': ' + both(L.depth) + ' deep' : ''}${L.note ? (L.depth !== null && !/HOLE/.test(L.name) && L.name !== 'BODY_OUTLINE' && !/THROUGH$/.test(L.name) ? '; ' : ': ') + L.note : ''}`);
    }
    lines.push('');
  });
  lines.push('Black Chapel Studios. blackchapelstudios.com', '');
  return lines.join('\r\n');
}
