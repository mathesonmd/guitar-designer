// Reading reference outlines: DXF (lines, arcs, circles, polylines with bulges) and SVG (any path or
// basic shape, sampled through the browser). Returns polylines in millimeters.
import { bboxOfMany } from '../core/poly.js';

function bulgePts(a, b, bulge, tol = 0.05) {
  if (Math.abs(bulge) < 1e-9) return [b];
  const theta = 4 * Math.atan(bulge), d = Math.hypot(b.x - a.x, b.y - a.y);
  if (d < 1e-9) return [b];
  const r = d / (2 * Math.sin(Math.abs(theta) / 2));
  const h = r * Math.cos(theta / 2) * Math.sign(theta);
  const cx = (a.x + b.x) / 2 - ((b.y - a.y) / d) * h, cy = (a.y + b.y) / 2 + ((b.x - a.x) / d) * h;
  const a0 = Math.atan2(a.y - cy, a.x - cx);
  const k = Math.max(2, Math.ceil(Math.abs(theta) / (2 * Math.acos(Math.max(-1, 1 - tol / r)))));
  const out = [];
  for (let j = 1; j <= k; j++) out.push({ x: cx + r * Math.cos(a0 + (theta * j) / k), y: cy + r * Math.sin(a0 + (theta * j) / k) });
  return out;
}

export function parseDXF(text) {
  const L = text.split(/\r?\n/);
  let i = 0, unitsCode = null;
  for (let k = 0; k < Math.min(L.length, 2000); k++) if (L[k].trim() === '$INSUNITS') { unitsCode = parseInt(L[k + 2], 10); break; }
  while (i < L.length - 1 && !(L[i].trim() === '2' && L[i + 1].trim() === 'ENTITIES')) i++;
  const ents = [];
  let cur = null;
  for (i += 2; i < L.length - 1; i += 2) {
    const code = parseInt(L[i], 10), val = L[i + 1].trim();
    if (code === 0) { if (cur) ents.push(cur); if (val === 'ENDSEC') { cur = null; break; } cur = { t: val, g: [] }; } else if (cur) cur.g.push([code, val]);
  }
  if (cur) ents.push(cur);
  const get = (e, c) => { const f = e.g.find((q) => q[0] === c); return f ? parseFloat(f[1]) : 0; };
  const polys = [];
  let poly = null;
  const finish = (p) => {
    if (!p || p.v.length < 2) return;
    const pts = [{ x: p.v[0].x, y: p.v[0].y }];
    const m = p.v.length;
    for (let k = 0; k < (p.closed ? m : m - 1); k++) pts.push(...bulgePts(p.v[k], p.v[(k + 1) % m], p.v[k].b));
    if (p.closed) pts.pop();
    polys.push({ pts, closed: p.closed });
  };
  for (const e of ents) {
    if (e.t === 'LINE') polys.push({ pts: [{ x: get(e, 10), y: get(e, 20) }, { x: get(e, 11), y: get(e, 21) }], closed: false });
    else if (e.t === 'CIRCLE' || e.t === 'ARC') {
      const cx = get(e, 10), cy = get(e, 20), r = get(e, 40);
      const a0 = e.t === 'ARC' ? (get(e, 50) * Math.PI) / 180 : 0;
      let a1 = e.t === 'ARC' ? (get(e, 51) * Math.PI) / 180 : Math.PI * 2;
      if (a1 <= a0) a1 += Math.PI * 2;
      const n = Math.max(8, Math.ceil(((a1 - a0) * r) / 1.5));
      const pts = [];
      for (let k = 0; k <= n; k++) pts.push({ x: cx + r * Math.cos(a0 + ((a1 - a0) * k) / n), y: cy + r * Math.sin(a0 + ((a1 - a0) * k) / n) });
      if (e.t === 'CIRCLE') pts.pop();
      polys.push({ pts, closed: e.t === 'CIRCLE' });
    } else if (e.t === 'POLYLINE') { poly = { v: [], closed: (get(e, 70) & 1) === 1 }; }
    else if (e.t === 'VERTEX' && poly) poly.v.push({ x: get(e, 10), y: get(e, 20), b: get(e, 42) });
    else if (e.t === 'SEQEND') { finish(poly); poly = null; }
    else if (e.t === 'LWPOLYLINE') {
      const p = { v: [], closed: (get(e, 70) & 1) === 1 };
      let v = null;
      for (const [c, val] of e.g) {
        if (c === 10) { if (v) p.v.push(v); v = { x: parseFloat(val), y: 0, b: 0 }; } else if (c === 20 && v) v.y = parseFloat(val); else if (c === 42 && v) v.b = parseFloat(val);
      }
      if (v) p.v.push(v);
      finish(p);
    }
  }
  // DXF unit codes: 1 = inches, 4 = mm, 5 = cm. Unknown: guess inches when the drawing is small.
  let k = unitsCode === 1 ? 25.4 : unitsCode === 5 ? 10 : 1;
  const bb = polys.length ? bboxOfMany(polys.map((p) => p.pts)) : null;
  let guessed = false;
  if (bb && unitsCode !== 1 && unitsCode !== 4 && unitsCode !== 5 && Math.max(bb.w, bb.h) < 60) { k = 25.4; guessed = true; }
  return { polys: polys.map((p) => ({ closed: p.closed, pts: p.pts.map((q) => ({ x: q.x * k, y: q.y * k })) })), units: k === 25.4 ? 'in' : k === 10 ? 'cm' : 'mm', guessed };
}

// SVG: let the browser do the curve math. Lengths come out in CSS pixels unless the file declares
// real units, so we read width/height + viewBox to find millimeters per user unit.
export function parseSVG(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('not an SVG');
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;visibility:hidden';
  const live = document.importNode(root, true);
  holder.appendChild(live);
  document.body.appendChild(holder);
  try {
    const unit = (s) => { const m = String(s || '').trim().match(/^([\d.]+)\s*(mm|cm|in|pt|pc|px)?$/); if (!m) return null; return parseFloat(m[1]) * ({ mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 }[m[2] || 'px']); };
    const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const wmm = unit(root.getAttribute('width'));
    const k = wmm && vb.length === 4 && vb[2] > 0 ? wmm / vb[2] : 25.4 / 96;
    const polys = [];
    live.querySelectorAll('path,polygon,polyline,rect,circle,ellipse,line').forEach((el) => {
      if (typeof el.getTotalLength !== 'function') return;
      let len = 0;
      try { len = el.getTotalLength(); } catch (e) { return; }
      if (!(len > 0)) return;
      const m = el.getCTM ? el.getCTM() : null, base = live.getCTM ? live.getCTM() : null;
      const n = Math.max(8, Math.min(4000, Math.ceil((len * k) / 0.5)));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const p = el.getPointAtLength((len * i) / n);
        let x = p.x, y = p.y;
        if (m && base) { const inv = base.inverse().multiply(m); const q = new DOMPoint(x, y).matrixTransform(inv); x = q.x; y = q.y; }
        pts.push({ x: x * k, y: -y * k });
      }
      const closed = Math.hypot(pts[0].x - pts[n].x, pts[0].y - pts[n].y) < 0.05;
      if (closed) pts.pop();
      polys.push({ pts, closed });
    });
    return { polys, units: wmm ? 'declared' : 'px' };
  } finally { holder.remove(); }
}

// Center a set of polylines on the designer's centerline, with the bottom resting where the body usually sits.
export function recenter(polys, targetBox) {
  const bb = bboxOfMany(polys.map((p) => p.pts));
  const dx = -bb.cx, dy = targetBox.y0 - bb.y0;
  return polys.map((p) => ({ closed: p.closed, pts: p.pts.map((q) => ({ x: q.x + dx, y: q.y + dy })) }));
}
