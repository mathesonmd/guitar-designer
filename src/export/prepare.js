// Shared first step for every export format: lay the template sheets out side by side and convert
// dense outlines into lines and arcs.
import { fitArcs } from '../core/arcfit.js';
import { bbox } from '../core/poly.js';

const QUARTER = Math.tan(Math.PI / 8); // bulge of a 90 degree arc

export const LAYERS = [
  { name: 'ENGRAVE', color: '#000000', aci: 7, note: 'Engrave or score: centerline, labels, scale check' },
  { name: 'CUT_INSIDE', color: '#0000ff', aci: 5, note: 'Cut first: cavity openings and holes' },
  { name: 'CUT_OUTSIDE', color: '#ff0000', aci: 1, note: 'Cut last: template outline' },
];

// Returns { width, height, sheets: [{ name, x, y, w, h, paths: [{ layer, closed, verts:[{x,y,bulge}] }] }] }
// Coordinates are millimeters, origin bottom-left, y up.
export function prepare(templates, { tol = 0.01, gap = 25, margin = 10 } = {}) {
  let cursor = margin, height = 0;
  const sheets = [];
  for (const sh of templates.sheets) {
    const cuts = sh.items.filter((i) => i.type === 'cut');
    if (!cuts.length) continue;
    const b = sh.bbox;
    const dx = cursor - b.x0, dy = margin - b.y0;
    const paths = [];
    for (const it of sh.items) {
      if (it.type === 'cut') {
        // Round holes keep their center and radius (exports write true circles); `verts` holds the same
        // circle as four quarter arcs for drawing. Everything else is fitted with lines and arcs.
        const c = it.circle ? { x: it.circle.x + dx, y: it.circle.y + dy, r: it.circle.r } : null;
        const verts = c
          ? [[-1, 0], [0, -1], [1, 0], [0, 1]].map(([ux, uy]) => ({ x: c.x + ux * c.r, y: c.y + uy * c.r, bulge: QUARTER }))
          : fitArcs(it.poly, tol, true).map((v) => ({ x: v.x + dx, y: v.y + dy, bulge: v.bulge }));
        paths.push({ layer: it.layer, closed: true, verts, hole: !!it.hole, circle: c });
      } else {
        paths.push({ layer: it.layer, closed: false, verts: it.line.map((p) => ({ x: p.x + dx, y: p.y + dy, bulge: 0 })) });
      }
    }
    sheets.push({ id: sh.id, name: sh.name, x: cursor, y: margin, w: b.w, h: b.h, paths });
    cursor += b.w + gap;
    height = Math.max(height, b.h);
  }
  return { width: cursor - gap + margin, height: height + 2 * margin, sheets };
}

export const extentOf = (paths) => bbox(paths.flatMap((p) => p.verts));
