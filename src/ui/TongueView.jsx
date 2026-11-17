import React, { useRef, useState, useEffect } from 'react';
import { useSize } from './widgets.jsx';
import { fmtWithUnit } from '../core/units.js';
import { dragHandle, setPointKind, autoHandles, stored } from './lineEdit.js';

// The tongue's outline, as a line to draw. The back of the neck is seen square on: the heel is to the
// left, the headstock to the right, the centerline runs across the middle. The points are on the upper
// edge; the lower edge mirrors them. Each point says how far along from the nut it is and half the
// tongue's width there (model/neck.js, tongueOutline). The first point is the tip.
export default function TongueView({ design, g, setSel, edit, begin, commit }) {
  const wrap = useRef(null), svg = useRef(null);
  const size = useSize(wrap);
  const [pick, setPick] = useState(null);
  const drag = useRef(null);
  const neck = g.neck, hd = neck && neck.head, tg = hd && hd.tongue, line = tg && tg.line;
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

  if (!line) return <div ref={wrap} style={{ position: 'absolute', inset: 0 }} />;
  const pts = line.points, last = pts.length - 1, nutY = neck.nutY;
  const s0 = Math.min(line.from, -40) - 16, s1 = hd.reach + 14;
  const edgeAt = (s, sign) => (s <= 0 ? neck.halfAt(nutY + s) : (sign < 0 ? hd.widths(s).l : hd.widths(s).r));
  let wide = 24; for (let s = s0; s <= s1; s += 2) wide = Math.max(wide, edgeAt(s, 1), edgeAt(s, -1));
  const pad = 26, k = Math.max(1, Math.min(10, (size.w - 2 * pad) / (s1 - s0), (size.h - 2 * pad - 70) / (2 * wide + 8)));
  const ox = (size.w - (s1 - s0) * k) / 2, cy = Math.max(90 + wide * k, size.h / 2);
  const X = (s) => ox + (s - s0) * k, Y = (x) => cy - x * k;
  const trace = (fn) => { const out = []; for (let s = s0; s <= s1 + 1e-9; s += 0.5) out.push((out.length ? 'L' : 'M') + X(s).toFixed(1) + ' ' + Y(fn(s)).toFixed(1)); return out.join(' '); };
  const edgePts = (sign) => { const out = []; for (let i = 0; i <= 240; i++) { const t = i / 240, s = line.from + (s1 - line.from) * t * t; out.push(X(s).toFixed(1) + ' ' + Y(sign * Math.min(tg.halfOf(s, sign), edgeAt(s, sign))).toFixed(1)); } return out; };
  const tonguePath = 'M' + [...edgePts(1), ...edgePts(-1).reverse()].join(' L') + ' Z'; // up one edge from the tip, back down the other

  const store = (list) => edit((d) => ({ ...d, neck: { ...d.neck, head: { ...d.neck.head, tongueLine: { on: true, points: list.map((p) => stored(p, 'w')) } } } }));
  const world = (e) => { const r = svg.current.getBoundingClientRect(); return { s: s0 + (e.clientX - r.left - ox) / k, w: (cy - (e.clientY - r.top)) / k }; };
  const down = (i) => (e) => {
    e.stopPropagation(); e.preventDefault();
    svg.current.setPointerCapture(e.pointerId);
    setPick(i); begin();
    drag.current = { i, at: world(e), p: { ...pts[i] } };
  };
  const downHandle = (i, which) => (e) => {
    e.stopPropagation(); e.preventDefault();
    svg.current.setPointerCapture(e.pointerId);
    begin();
    drag.current = { i, which, at: world(e), h: line.used[i][which].slice() };
  };
  const move = (e) => {
    const dr = drag.current; if (!dr) return;
    const w = world(e), i = dr.i;
    if (dr.which) { store(dragHandle(pts, line.used, i, dr.which, [dr.h[0] + (w.s - dr.at.s), dr.h[1] + (w.w - dr.at.w)])); return; }
    const list = pts.map((p) => ({ ...p }));
    const lo = i === 0 ? -150 : pts[i - 1].s + 2, hi = i === last ? (i === 0 ? -2 : hd.reach - 2) : pts[i + 1].s - 2;
    list[i].s = Math.max(lo, Math.min(i === 0 ? Math.min(hi, -2) : hi, dr.p.s + (w.s - dr.at.s)));
    if (i > 0) list[i].w = Math.max(1, Math.min(60, dr.p.w + (w.w - dr.at.w)));
    store(list);
  };
  const up = () => { if (drag.current) { drag.current = null; commit(); } };
  const add = (e) => {
    const w = world(e);
    if (w.s <= pts[0].s + 2 || w.s >= hd.reach - 2 || pts.some((p) => Math.abs(p.s - w.s) < 2)) return;
    const half = w.s < pts[last].s ? line.half(w.s) : Math.max(1, Math.min(60, Math.abs(w.w)));
    const list = [...pts.map((p) => ({ ...p })), { s: w.s, w: half, k: 's' }].sort((a, b) => a.s - b.s);
    begin(); store(list); commit(); setPick(list.findIndex((p) => p.s === w.s));
  };
  function remove(i) { if (i <= 0 || pts.length <= 2) return; begin(); store(pts.filter((p, j) => j !== i)); commit(); setPick(null); }
  // (choosing a round or pointed tip hands the tip's handle back to the app, which sets it to suit)
  const setKind = (i, kind) => { begin(); store(i === 0 ? autoHandles(pts, 0).map((p, j) => (j ? p : { ...p, k: kind })) : setPointKind(pts, line.used, i, kind)); commit(); };
  const auto = (i) => { begin(); store(autoHandles(pts, i)); commit(); };

  const sel = pick != null && pick <= last ? pts[pick] : null, sx = sel && X(sel.s), sy = sel && Y(sel.w);
  const dim = 'var(--bone-dim, #9b9388)', hot = 'var(--ember, #e2642f)';
  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }}>
      <svg ref={svg} data-k="tongueview" width={size.w} height={size.h} style={{ display: 'block', touchAction: 'none' }} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={add} onPointerDown={() => setPick(null)}>
        <path d={trace((s) => edgeAt(s, 1))} fill="none" stroke={dim} strokeWidth="1.2" />
        <path d={trace((s) => -edgeAt(s, -1))} fill="none" stroke={dim} strokeWidth="1.2" />
        <line x1={X(s0)} y1={cy} x2={X(s1)} y2={cy} stroke={dim} strokeWidth="1" strokeDasharray="10 4 2 4" />
        <path d={tonguePath} data-k="tongueline" fill="rgba(226,185,138,.13)" stroke={hot} strokeWidth="1.8" />
        <line x1={X(0)} y1={Y(edgeAt(0, 1)) - 14} x2={X(0)} y2={Y(-edgeAt(0, -1)) + 14} stroke="var(--brass, #c8a45c)" strokeWidth="1.4" />
        <text x={X(0)} y={Y(edgeAt(0, 1)) - 20} textAnchor="middle" fontSize="11" fill="var(--brass, #c8a45c)">Nut</text>
        <text x={X(s0) + 4} y={Y(edgeAt(s0, 1)) - 8} fontSize="11" fill={dim}>Toward the heel</text>
        <text x={X(s1) - 4} y={Y(edgeAt(s1, 1)) - 8} textAnchor="end" fontSize="11" fill={dim}>Headstock</text>
        {pick != null && pick <= last && ['hi', 'ho'].filter((w) => (w === 'hi' ? pick > 0 : pick < last) && line.used[pick][w]).map((w) => { const p = pts[pick], h = line.used[pick][w]; return (
          <g key={w} data-k="tonguehandle" data-w={w} onPointerDown={downHandle(pick, w)} style={{ cursor: 'move' }}>
            <line x1={X(p.s)} y1={Y(p.w)} x2={X(p.s + h[0])} y2={Y(p.w + h[1])} stroke="var(--brass, #c8a45c)" strokeWidth="1.2" />
            <circle cx={X(p.s + h[0])} cy={Y(p.w + h[1])} r="12" fill="transparent" />
            <circle cx={X(p.s + h[0])} cy={Y(p.w + h[1])} r="4" fill="var(--brass, #c8a45c)" />
          </g>
        ); })}
        {pts.map((p, i) => (
          <g key={i} data-k="tonguept" data-i={i} onPointerDown={down(i)} style={{ cursor: i === 0 ? 'ew-resize' : 'move' }}>
            <circle cx={X(p.s)} cy={Y(p.w)} r="13" fill="transparent" />
            {p.k === 'c'
              ? <rect x={X(p.s) - 5} y={Y(p.w) - 5} width="10" height="10" fill={pick === i ? hot : '#1c1916'} stroke={hot} strokeWidth="1.6" />
              : <circle cx={X(p.s)} cy={Y(p.w)} r="5.5" fill={pick === i ? hot : '#1c1916'} stroke={hot} strokeWidth="1.6" />}
          </g>
        ))}
      </svg>
      <div className="viewopts" style={{ left: 12, right: 'auto', justifyContent: 'flex-start' }}><button className="btn" onClick={() => setSel(null)}>Done: back to the drawing</button></div>
      {sel && !drag.current && (
        /* kept well clear of the point: below one in the upper half of the view, above one in the lower half */
        <div className="float" data-k="pointbar" style={{ left: Math.max(8, Math.min(size.w - 500, sx - 210)), top: sy < size.h / 2 ? Math.min(size.h - 50, sy + 96) : Math.max(8, sy - 136) }}>
          <span className="mono" style={{ fontSize: 11, padding: '0 4px', whiteSpace: 'nowrap' }}>{fmtWithUnit(Math.abs(sel.s), u)} {sel.s < 0 ? 'behind' : 'past'} the nut{pick === 0 ? '' : `, ${fmtWithUnit(2 * sel.w, u)} wide`}</span>
          <div className="seg" role="group" aria-label="Point type">
            <button type="button" className={sel.k === 's' ? 'on' : ''} onClick={() => setKind(pick, 's')}>{pick === 0 ? 'Round tip' : 'Smooth'}</button>
            <button type="button" className={sel.k === 'c' ? 'on' : ''} onClick={() => setKind(pick, 'c')}>{pick === 0 ? 'Pointed tip' : 'Corner'}</button>
          </div>
          {(sel.hi || sel.ho) && <button type="button" className="btn small" onClick={() => auto(pick)}>Automatic handles</button>}
          {pick > 0 && pts.length > 2 && <button type="button" className="btn small" onClick={() => remove(pick)}>Delete point</button>}
        </div>
      )}
      <div className="hintline"><span>Drag a point, or the handles of the selected point · double-click to add one</span><span>Seen from the back</span></div>
    </div>
  );
}
