// Single-stroke vector lettering for template labels. Strokes are real geometry, so a laser or CNC
// engraves them directly and no font has to be installed in the CAM program.
import font from '../data/simplex.js';

const CAP = 21; // cap height of the font in its own units

export function textWidth(str, height) {
  let w = 0;
  for (const ch of String(str)) w += (font[ch.charCodeAt(0)] || font[63])[0];
  return (w * height) / CAP;
}

// Returns an array of polylines (arrays of {x, y}). (x, y) is the baseline start; angle in radians.
// align: 'left' | 'center' | 'right'.
export function textStrokes(str, x, y, height, angle = 0, align = 'left') {
  const k = height / CAP;
  const w = textWidth(str, height);
  let pen = align === 'center' ? -w / 2 : align === 'right' ? -w : 0;
  const c = Math.cos(angle), s = Math.sin(angle);
  const out = [];
  for (const ch of String(str)) {
    const g = font[ch.charCodeAt(0)] || font[63];
    let cur = [];
    for (let i = 1; i < g.length; i += 2) {
      if (g[i] === undefined) { if (cur.length > 1) out.push(cur); cur = []; i--; continue; }
      const lx = pen + g[i] * k, ly = g[i + 1] * k;
      cur.push({ x: x + lx * c - ly * s, y: y + lx * s + ly * c });
    }
    if (cur.length > 1) out.push(cur);
    pen += g[0] * k;
  }
  return out;
}
