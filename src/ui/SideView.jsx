import React, { useRef, useState, useEffect } from 'react';
import { useSize } from './widgets.jsx';
import { fmtWithUnit } from '../core/units.js';

// The side view of the back of the neck around the nut, as a line to draw. The neck is seen from its bass
// side: the heel is to the left, the headstock to the right, the fretboard face on top. Each point says
// how far along from the nut it is and how far the back stands out there from the plain line of the back
// (model/neck.js, sideLine). Both ends sit on the plain line; a tongue's first point is its tip and is free.
export default function SideView({ design, g, setSel, edit, begin, commit }) {
  const wrap = useRef(null), svg = useRef(null);
  const size = useSize(wrap);
  const [pick, setPick] = useState(null);
  const [tall, setTall] = useState(3); // how much the height is stretched, so small changes can be seen and dragged
  const drag = useRef(null);
  const neck = g.neck, hd = neck && neck.head, side = hd && hd.side;
  const u = design.units;

  useEffect(() => {
    const key = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'Escape') setSel(null);
      if ((e.key === 'Delete' || e.key === 'Backspace') && pick != null) remove(pick);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  if (!side) return <div ref={wrap} style={{ position: 'absolute', inset: 0 }} />;
  const pts = side.points, last = pts.length - 1, free = !!hd.tongue;
  const top = neck.top, nutY = neck.nutY;
  // what is in view
  const s0 = Math.min(side.from, -45) - 14, s1 = hd.reach + 16;
  const zLow = Math.min(hd.faceZ(nutY + s1) - top - hd.thick / hd.cos, -neck.d1 - 14) - 4, zHigh = 9;
  const pad = 26, k = Math.max(1, Math.min(9, (size.w - 2 * pad) / (s1 - s0), (size.h - 2 * pad - 60) / ((zHigh - zLow) * tall))), kz = k * tall;
  const ox = (size.w - (s1 - s0) * k) / 2, oy = Math.max(70, (size.h - (zHigh - zLow) * kz) / 2);
  const X = (s) => ox + (s - s0) * k, Y = (z) => oy + (zHigh - z) * kz;
  // the back's own crown line, from the sections the model is built from
  const crown = [[s0, -neck.at(nutY + s0).depth]];
  for (const q of neck.sections.slice().reverse()) { const c = q.p3[25]; if (c[1] - nutY > s0) crown.push([c[1] - nutY, c[2] - top]); }
  for (const q of hd.sections.slice(1)) { const c = q.p3[25]; crown.push([c[1] - nutY, c[2] - top]); }
  const endS = crown[crown.length - 1][0];
  crown.push([s1, hd.faceZ(nutY + s1) - top - hd.thick / hd.cos]);
  const plain = [];
  for (let s = s0; s <= endS; s += 1) plain.push([s, hd.backZ(nutY + s) - top]);
  const path = (list) => list.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ');
  const body = `M${X(s0)} ${Y(0)} L${X(0)} ${Y(0)} L${X(s1)} ${Y(hd.faceZ(nutY + s1) - top)} ` + crown.slice().reverse().map((p) => 'L' + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ') + ' Z';
  // where each point sits on the picture: on the crown of the section at its place along the neck
  const spot = (p) => { if (p.s <= 0) return [p.s, -neck.at(nutY + p.s).depth]; const c = hd.at(p.s).p3[25]; return [c[1] - nutY, c[2] - top]; };
  const fixedOut = (i) => i === last || (i === 0 && !free);

  const store = (list) => edit((d) => ({ ...d, neck: { ...d.neck, head: { ...d.neck.head, side: { on: true, points: list.map((p) => ({ s: Math.round(p.s * 100) / 100, out: Math.round(p.out * 100) / 100, k: p.k })) } } } }));
  const world = (e) => { const r = svg.current.getBoundingClientRect(); return { s: s0 + (e.clientX - r.left - ox) / k, z: zHigh - (e.clientY - r.top - oy) / kz }; };
  const down = (i) => (e) => {
    e.stopPropagation(); e.preventDefault();
    svg.current.setPointerCapture(e.pointerId);
    setPick(i); begin();
    drag.current = { i, at: world(e), p: { ...pts[i] }, moved: false };
  };
  const move = (e) => {
    const dr = drag.current; if (!dr) return;
    const w = world(e), i = dr.i, list = pts.map((p) => ({ ...p }));
    const lo = i === 0 ? -150 : pts[i - 1].s + 2, hi = i === last ? hd.reach - 2 : Math.min(pts[i + 1].s - 2, i === 0 && free ? -2 : Infinity);
    list[i].s = Math.max(lo, Math.min(hi, dr.p.s + (w.s - dr.at.s)));
    if (!fixedOut(i)) list[i].out = Math.max(-6, Math.min(15, dr.p.out - (w.z - dr.at.z)));
    dr.moved = true;
    store(list);
  };
  const up = () => { if (drag.current) { drag.current = null; commit(); } };
  const add = (e) => {
    const w = world(e);
    if (w.s <= pts[0].s + 2 || w.s >= pts[last].s - 2 || pts.some((p) => Math.abs(p.s - w.s) < 2)) return;
    const list = [...pts.map((p) => ({ ...p })), { s: w.s, out: side.out(w.s), k: 's' }].sort((a, b) => a.s - b.s);
    begin(); store(list); commit(); setPick(list.findIndex((p) => p.s === w.s));
  };
  function remove(i) { if (i <= 0 || i >= last) return; begin(); store(pts.filter((p, j) => j !== i)); commit(); setPick(null); }
  const setKind = (i, kind) => { begin(); store(pts.map((p, j) => (j === i ? { ...p, k: kind } : { ...p }))); commit(); };

  const sel = pick != null && pick <= last ? pts[pick] : null, at = sel && spot(sel), sx = at && X(at[0]), sy = at && Y(at[1]);
  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }}>
      <svg ref={svg} data-k="sideview" width={size.w} height={size.h} style={{ display: 'block', touchAction: 'none' }} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={add} onPointerDown={() => setPick(null)}>
        <path d={body} fill="rgba(226,185,138,.13)" stroke="none" />
        <path d={`M${X(s0)} ${Y(0)} L${X(0)} ${Y(0)} L${X(s1)} ${Y(hd.faceZ(nutY + s1) - top)}`} fill="none" stroke="var(--bone-dim, #9b9388)" strokeWidth="1.2" />
        <path d={path(plain)} fill="none" stroke="var(--bone-dim, #9b9388)" strokeWidth="1" strokeDasharray="5 5" />
        <path d={path(crown)} data-k="sideline" fill="none" stroke="var(--ember, #e2642f)" strokeWidth="1.8" />
        <line x1={X(0)} y1={Y(0) - 16} x2={X(0)} y2={Y(0) + 6} stroke="var(--brass, #c8a45c)" strokeWidth="1.4" />
        <text x={X(0)} y={Y(0) - 22} textAnchor="middle" fontSize="11" fill="var(--brass, #c8a45c)">Nut</text>
        <text x={X(s0) + 4} y={Y(0) - 8} fontSize="11" fill="var(--bone-dim, #9b9388)">Toward the heel</text>
        <text x={X(s1) - 4} y={Y(hd.faceZ(nutY + s1) - top) - 8} textAnchor="end" fontSize="11" fill="var(--bone-dim, #9b9388)">Headstock</text>
        {pts.map((p, i) => { const c = spot(p); return (
          <g key={i} data-k="sidept" data-i={i} onPointerDown={down(i)} style={{ cursor: fixedOut(i) ? 'ew-resize' : 'move' }}>
            <circle cx={X(c[0])} cy={Y(c[1])} r="13" fill="transparent" />
            {p.k === 'c' && !fixedOut(i)
              ? <rect x={X(c[0]) - 5} y={Y(c[1]) - 5} width="10" height="10" fill={pick === i ? 'var(--ember, #e2642f)' : '#1c1916'} stroke="var(--ember, #e2642f)" strokeWidth="1.6" />
              : <circle cx={X(c[0])} cy={Y(c[1])} r="5.5" fill={pick === i ? 'var(--ember, #e2642f)' : '#1c1916'} stroke="var(--ember, #e2642f)" strokeWidth="1.6" />}
          </g>
        ); })}
      </svg>
      <div className="viewopts" style={{ left: 12, right: 'auto', justifyContent: 'flex-start' }}>
        <button className="btn" onClick={() => setSel(null)}>Done: back to the drawing</button>
        <div className="seg" role="group" aria-label="Height of the view">
          <button type="button" className={tall === 1 ? 'on' : ''} onClick={() => setTall(1)}>True shape</button>
          <button type="button" className={tall === 3 ? 'on' : ''} onClick={() => setTall(3)}>Height ×3</button>
        </div>
      </div>
      {sel && !drag.current && (
        /* kept well clear of the point: below one in the upper half of the view, above one in the lower half */
        <div className="float" data-k="pointbar" style={{ left: Math.max(8, Math.min(size.w - 330, sx - 150)), top: sy < size.h / 2 ? Math.min(size.h - 50, sy + 96) : Math.max(8, sy - 136) }}>
          <span className="mono" style={{ fontSize: 11, padding: '0 4px' }}>{fmtWithUnit(Math.abs(sel.s), u)} {sel.s < 0 ? 'behind' : 'past'} the nut{fixedOut(pick) ? '' : `, ${sel.out < 0 ? 'in' : 'out'} ${fmtWithUnit(Math.abs(sel.out), u)}`}</span>
          {!fixedOut(pick) && <div className="seg" role="group" aria-label="Point type">
            <button type="button" className={sel.k === 's' ? 'on' : ''} onClick={() => setKind(pick, 's')}>Smooth</button>
            <button type="button" className={sel.k === 'c' ? 'on' : ''} onClick={() => setKind(pick, 'c')}>Corner</button>
          </div>}
          {pick > 0 && pick < last && pts.length > 2 && <button type="button" className="btn small" onClick={() => remove(pick)}>Delete point</button>}
        </div>
      )}
      <div className="hintline"><span>Drag a point · double-click the line to add one · {free ? 'the first point is the tongue’s tip' : 'the end points slide along the plain line'}</span><span>Dashed: no volute</span></div>
    </div>
  );
}
