// SVG export at true size (1 user unit = 1 mm). Layers are groups with distinct stroke colors so laser
// software can assign engrave / cut-inside / cut-outside operations by color.
import { LAYERS } from './prepare.js';
import { arcOf } from '../core/arcfit.js';

const f = (v) => (Math.round(v * 100000) / 100000).toString();

export function pathData(verts, closed, H) {
  // y is flipped (SVG y runs down). A counter-clockwise arc in drawing coordinates still looks
  // counter-clockwise on screen, which is sweep-flag 0 in SVG.
  let d = `M${f(verts[0].x)} ${f(H - verts[0].y)}`;
  const n = verts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    if (a.bulge) {
      const c = arcOf(a, b);
      d += `A${f(c.r)} ${f(c.r)} 0 ${Math.abs(c.theta) > Math.PI ? 1 : 0} ${a.bulge > 0 ? 0 : 1} ${f(b.x)} ${f(H - b.y)}`;
    } else d += `L${f(b.x)} ${f(H - b.y)}`;
  }
  return closed ? d + 'Z' : d;
}

export function toSVG(prep, meta = {}) {
  const { width: W, height: H } = prep;
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}mm" height="${f(H)}mm" viewBox="0 0 ${f(W)} ${f(H)}">`);
  out.push(`<title>${esc(meta.title || 'Guitar templates')}</title>`);
  out.push(`<desc>${esc(meta.desc || 'Black Chapel Studios Guitar Designer. Units: millimeters, true size.')}</desc>`);
  for (const L of LAYERS) {
    const paths = prep.sheets.flatMap((s) => s.paths.filter((p) => p.layer === L.name));
    if (!paths.length) continue;
    out.push(`<g id="${L.name}" fill="none" stroke="${L.color}" stroke-width="0.1" stroke-linecap="round" stroke-linejoin="round">`);
    for (const p of paths) out.push(p.circle ? `<circle cx="${f(p.circle.x)}" cy="${f(H - p.circle.y)}" r="${f(p.circle.r)}"/>` : `<path d="${pathData(p.verts, p.closed, H)}"/>`);
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
