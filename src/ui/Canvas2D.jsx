import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { seatedCorner } from '../model/design.js';
import { expandOutline, nodesToSvgPath, nearestOnNodes, insertNode, removeNode, setHandle, setKind, storedIndex } from '../core/path.js';
import { fmtLen, unitLabel } from '../core/units.js';
import { useSize } from './widgets.jsx';
import { bellyDish, bevelPlane } from '../model/solid.js';

const polyD = (p) => (p && p.length ? 'M' + p.map((q) => `${+q.x.toFixed(3)} ${+q.y.toFixed(3)}`).join('L') + 'Z' : '');
const lineD = (p) => (p && p.length ? 'M' + p.map((q) => `${+q.x.toFixed(3)} ${+q.y.toFixed(3)}`).join('L') : '');

export default function Canvas2D({ design, g, sel, setSel, edit, begin, commit, show, findings, viewCmd, ghosts }) {
  const wrap = useRef(null), svg = useRef(null);
  const size = useSize(wrap);
  const [view, setView] = useState({ s: 1.6, tx: 400, ty: 300 });
  const [cursor, setCursor] = useState(null);
  const drag = useRef(null);
  const pointers = useRef(new Map());
  const units = design.units;
  // Which outline is being edited: the body's, or the headstock's. The headstock's is drawn flat, at its
  // true shape, starting at the nut line, so on the drawing its points sit `lift` above where they are stored.
  const headOn = !!(design.neck.head && design.neck.head.on);
  const of = sel && sel.of === 'head' && headOn ? 'head' : 'body';
  const lift = of === 'head' ? g.nutY : 0;
  const cur = of === 'head' ? design.neck.head.outline : design.outline;
  const sym = of === 'body' && cur.symmetric;
  const open = of === 'head';       // an open outline's two end points are fixed
  const closed = !sym && !open;
  const up = (n) => (lift ? { ...n, y: n.y + lift } : n), down = (n) => (lift ? { ...n, y: n.y - lift } : n);
  const nodes = useMemo(() => cur.nodes.map(up), [cur.nodes, lift]);
  const stored = (ds) => (of === 'head' ? ds.neck.head.outline.nodes : ds.outline.nodes);
  const store = (ds, ns) => (of === 'head'
    ? { ...ds, neck: { ...ds.neck, head: { ...ds.neck.head, outline: { ...ds.neck.head.outline, nodes: ns } } } }
    : { ...ds, outline: { ...ds.outline, nodes: ns } });
  const fixed = (i, count) => open && (i === 0 || i === count - 1);
  const pick = (extra) => (of === 'head' ? { ...extra, of: 'head' } : extra);

  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    const b = g.bbox;
    const y0 = b.y0 - 18, y1 = Math.max(b.y1, g.heelY + 110) + 18, x0 = b.x0 - 18, x1 = b.x1 + 18;
    const s = Math.min(size.w / (x1 - x0), size.h / (y1 - y0));
    setView({ s, tx: size.w / 2 - ((x0 + x1) / 2) * s, ty: size.h / 2 + ((y0 + y1) / 2) * s });
  }, [size.w, size.h, g.bbox, g.heelY]);

  // When the headstock's outline is picked for reshaping, bring the headstock into view.
  useEffect(() => {
    if (of !== 'head' || !size.w || !size.h || !g.neck || !g.neck.head) return;
    const hw = Math.max(40, ...g.neck.head.poly.map((p) => Math.abs(p.x))) + 30, y0 = g.nutY - 50, y1 = g.nutY + g.neck.head.length + 30;
    const s = Math.min(size.w / (2 * hw), size.h / (y1 - y0));
    setView({ s, tx: size.w / 2, ty: size.h / 2 + ((y0 + y1) / 2) * s });
  }, [of]); // eslint-disable-line

  const fitted = useRef(false);
  useEffect(() => { if (!fitted.current && size.w > 0) { fitted.current = true; fit(); } }, [size.w, fit]);
  useEffect(() => {
    if (!viewCmd) return;
    if (viewCmd.type === 'fit') fit();
    if (viewCmd.type === 'focus' && viewCmd.at) setView((v) => { const s = Math.max(v.s, 2.4); return { s, tx: size.w / 2 - viewCmd.at.x * s, ty: size.h / 2 + viewCmd.at.y * s }; });
  }, [viewCmd]); // eslint-disable-line

  const toWorld = (e) => {
    const r = svg.current.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.tx) / view.s, y: -(e.clientY - r.top - view.ty) / view.s };
  };
  const S = (p) => ({ x: p.x * view.s + view.tx, y: -p.y * view.s + view.ty });

  const zoomAt = (cx, cy, k) => setView((v) => {
    const s = Math.max(0.25, Math.min(40, v.s * k));
    const f = s / v.s;
    return { s, tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f };
  });

  useEffect(() => {
    const el = svg.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------------- pointer handling ---------------- */
  const onDown = (e) => {
    if (e.button === 2) return;
    svg.current.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) { // start pinch
      const [a, b] = [...pointers.current.values()];
      drag.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view };
      return;
    }
    const t = e.target.closest('[data-k]');
    const w = toWorld(e);
    if (!t || e.button === 1) { drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, view, moved: false }; return; }
    const k = t.dataset.k, id = t.dataset.id, i = t.dataset.i !== undefined ? +t.dataset.i : undefined;
    if (k === 'outline') { setSel(t.dataset.of === 'head' ? { kind: 'outline', of: 'head' } : { kind: 'outline' }); drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, view, moved: false, keepSel: true }; return; }
    begin();
    if (k === 'node') { setSel(pick({ kind: 'node', i })); drag.current = { kind: 'node', i, w0: w, n0: { ...nodes[i] } }; }
    else if (k === 'hin' || k === 'hout') { setSel(pick({ kind: 'node', i })); drag.current = { kind: k, i, n0: { ...nodes[i] } }; }
    else if (k === 'pickup') { const p = design.pickups.find((q) => q.id === id); setSel({ kind: 'pickup', id }); drag.current = { kind: 'pickup', id, w0: w, p0: { ...p } }; }
    else if (k === 'control') { const c = design.controls.find((q) => q.id === id); setSel({ kind: 'control', id }); drag.current = { kind: 'control', id, w0: w, p0: { ...c } }; }
    else if (k === 'cavity') { const c = design.cavities.find((q) => q.id === id); setSel({ kind: 'cavity', id }); drag.current = { kind: 'cavity', id, w0: w, p0: { ...c } }; }
    else if (k === 'bevel') { setSel({ kind: 'bevel', id }); drag.current = { kind: 'bevel', id, i: id === 'belly' ? t.dataset.i : i }; }
    else if (k === 'reg') { drag.current = { kind: 'reg', i }; }
    else if (k === 'edgebevel') { const h = g.bevelEdge && g.bevelEdge.handles.find((q) => q.i === i); setSel({ kind: 'edgebevel', i }); if (h) drag.current = { kind: 'edgebevel', i, at: h.outer, n: h.normal }; }
  };

  const onMove = (e) => {
    const w = toWorld(e);
    setCursor(w);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const k = Math.hypot(a.x - b.x, a.y - b.y) / (d.d0 || 1);
      const r = svg.current.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top, c0x = d.cx - r.left, c0y = d.cy - r.top;
      const s = Math.max(0.25, Math.min(40, d.view.s * k)), f = s / d.view.s;
      setView({ s, tx: cx - (c0x - d.view.tx) * f, ty: cy - (c0y - d.view.ty) * f });
      return;
    }
    if (d.kind === 'pan') {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setView({ ...d.view, tx: d.view.tx + dx, ty: d.view.ty + dy });
      return;
    }
    const T = { transient: true };
    if (d.kind === 'node') {
      let dx = w.x - d.w0.x, dy = w.y - d.w0.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      edit((ds) => {
        const ns = stored(ds).slice();
        if (fixed(d.i, ns.length)) return ds; // the headstock's two ends stay on the corners of the nut
        const n = { ...d.n0, x: d.n0.x + dx, y: d.n0.y + dy };
        if (sym) { if (d.i === 0 || d.i === ns.length - 1) n.x = 0; else n.x = Math.min(n.x, -0.5); }
        if (open) n.y = Math.max(n.y, lift + 1);
        // a corner of the body dragged near the neck pocket snaps onto the pocket's edge, which is the fretboard's edge
        const seat = !open && !sym ? seatedCorner(n, ds.neck, ns.filter((q, j) => j !== d.i)) : null; // (and level with the corner across the pocket when it nearly is)
        ns[d.i] = down(seat || n);
        return store(ds, ns);
      }, T);
    } else if (d.kind === 'hin' || d.kind === 'hout') {
      edit((ds) => {
        const ns = stored(ds).slice();
        let base = e.altKey ? { ...d.n0, k: 'c' } : d.n0;
        let hx = w.x - base.x, hy = w.y - base.y;
        const center = sym && (d.i === 0 || d.i === ns.length - 1);
        if (center && base.k === 's') hy = 0;
        ns[d.i] = down(setHandle(base, d.kind === 'hout' ? 'out' : 'in', hx, hy));
        return store(ds, ns);
      }, T);
    } else if (d.kind === 'pickup') {
      const free = e.altKey || Math.abs(d.p0.x) > 0.01;
      edit((ds) => ({ ...ds, pickups: ds.pickups.map((p) => (p.id === d.id ? { ...p, y: d.p0.y + (w.y - d.w0.y), x: free ? d.p0.x + (w.x - d.w0.x) : d.p0.x } : p)) }), T);
    } else if (d.kind === 'control') {
      edit((ds) => ({ ...ds, controls: ds.controls.map((c) => (c.id === d.id ? { ...c, x: d.p0.x + (w.x - d.w0.x), y: d.p0.y + (w.y - d.w0.y) } : c)) }), T);
    } else if (d.kind === 'cavity') {
      edit((ds) => ({ ...ds, cavities: ds.cavities.map((c) => (c.id === d.id ? { ...c, x: d.p0.x + (w.x - d.w0.x), y: d.p0.y + (w.y - d.w0.y) } : c)) }), T);
    } else if (d.kind === 'edgebevel') {
      // a square on the edge bevel's inner line: how far in from its outline point it sits is that point's width
      const width = Math.max(0, (w.x - d.at.x) * d.n.x + (w.y - d.at.y) * d.n.y);
      edit((ds) => {
        const ns = ds.outline.nodes.slice(), j = storedIndex(ds.outline, d.i);
        ns[j] = { ...ns[j], bw: Math.round(width * 100) / 100 };
        return { ...ds, outline: { ...ds.outline, nodes: ns } };
      }, T);
    } else if (d.kind === 'bevel' && d.id === 'belly') {
      // the bowl: its middle moves it, the end square sets its length and turns it, the side square sets its reach
      edit((ds) => {
        const b = ds.contours.belly, vx = w.x - b.x, vy = w.y - b.y;
        let next = b;
        if (d.i === 'c') next = { ...b, x: w.x, y: w.y };
        else if (d.i === 'l') {
          let ang = Math.atan2(-vx, vy);
          if (Math.abs(ang) < 0.035) ang = 0; // within 2 degrees, settle parallel to the centerline
          next = { ...b, len: Math.max(20, 2 * Math.hypot(vx, vy)), angle: ang };
        } else if (d.i === 'w') next = { ...b, reach: Math.max(5, Math.abs(vx * Math.cos(b.angle || 0) + vy * Math.sin(b.angle || 0))) };
        return { ...ds, contours: { ...ds.contours, belly: next } };
      }, T);
    } else if (d.kind === 'bevel') {
      edit((ds) => ({ ...ds, contours: { ...ds.contours, [d.id]: { ...ds.contours[d.id], ['x' + d.i]: w.x, ['y' + d.i]: w.y } } }), T);
    } else if (d.kind === 'reg') {
      edit((ds) => ({ ...ds, tooling: { ...ds.tooling, regHoles: ds.tooling.regHoles.map((r, j) => (j === d.i ? { x: w.x, y: w.y } : r)) } }), T);
    }
  };

  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'pan') { if (!d.moved && !d.keepSel) setSel(null); return; }
    if (d.kind !== 'pinch') commit();
  };

  const onDouble = (e) => {
    // the pointer is captured by the drawing while a button is down, so look up what is under it
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const t = el && el.closest ? el.closest('[data-k]') : null;
    if (!t) { fit(); return; }
    if (t.dataset.k !== 'outline') return;
    const w = toWorld(e);
    if ((t.dataset.of === 'head') !== (of === 'head')) { setSel(t.dataset.of === 'head' ? { kind: 'outline', of: 'head' } : { kind: 'outline' }); return; }
    const hit = nearestOnNodes(nodes, w, closed);
    if (hit.seg === undefined) return;
    const r = insertNode(nodes, hit.seg, hit.t, closed);
    begin();
    edit((ds) => store(ds, r.nodes.map(down)));
    commit();
    setSel(pick({ kind: 'node', i: r.index }));
  };

  const onKey = (e) => {
    if (!sel) return;
    const step = e.shiftKey ? 5 : 0.5;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    const del = e.key === 'Delete' || e.key === 'Backspace';
    if (!dir && !del) return;
    e.preventDefault();
    // work out the change from the design as drawn, then apply it as one undo step
    let next = null, nextSel;
    if (sel.kind === 'node') {
      const isCenter = sym && (sel.i === 0 || sel.i === nodes.length - 1);
      const isFixed = fixed(sel.i, nodes.length);
      if (del) {
        if (isCenter || isFixed || nodes.length <= 3) return;
        next = store(design, removeNode(cur.nodes, sel.i));
        nextSel = pick({ kind: 'outline' });
      } else {
        if (isFixed) return;
        next = store(design, cur.nodes.map((n, i) => (i === sel.i ? { ...n, x: isCenter ? 0 : (sym ? Math.min(n.x + dir[0] * step, -0.5) : n.x + dir[0] * step), y: n.y + dir[1] * step } : n)));
      }
    } else {
      const key = { pickup: 'pickups', control: 'controls', cavity: 'cavities' }[sel.kind];
      if (!key) return;
      if (del) { next = { ...design, [key]: design[key].filter((q) => q.id !== sel.id) }; nextSel = null; }
      else next = { ...design, [key]: design[key].map((q) => (q.id === sel.id ? { ...q, x: q.x + dir[0] * step, y: q.y + dir[1] * step } : q)) };
    }
    begin();
    edit(() => next);
    commit();
    if (nextSel !== undefined) setSel(nextSel);
  };

  /* ---------------- drawing ---------------- */
  const full = useMemo(() => expandOutline(design.outline), [design.outline]);
  const outlineD = useMemo(() => nodesToSvgPath(full, true), [full]);
  const world = `translate(${view.tx} ${view.ty}) scale(${view.s} ${-view.s})`;
  const nodeSel = sel && sel.kind === 'node' ? sel.i : -1;
  const editing = sel && (sel.kind === 'outline' || sel.kind === 'node');

  // grid lines for the visible area
  const grid = useMemo(() => {
    if (!show.grid || !size.w) return null;
    const minor = units === 'mm' ? 10 : 25.4 / 2, major = units === 'mm' ? 50 : 25.4 * 2;
    const x0 = -view.tx / view.s, x1 = (size.w - view.tx) / view.s, y1 = view.ty / view.s, y0 = -(size.h - view.ty) / view.s;
    const step = view.s * minor < 7 ? major : minor;
    let dm = '', dM = '';
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const seg = `M${x} ${y0}V${y1}`; if (Math.abs(x / major - Math.round(x / major)) < 1e-6) dM += seg; else dm += seg; }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const seg = `M${x0} ${y}H${x1}`; if (Math.abs(y / major - Math.round(y / major)) < 1e-6) dM += seg; else dm += seg; }
    return { dm, dM };
  }, [show.grid, view, size.w, size.h, units]);

  // the arm bevel's line: right across the body, or between its squares when the cut is kept there
  // the headstock's outline, flat and at its true shape, standing on the nut line
  const headD = useMemo(() => (g.neck && g.neck.head ? nodesToSvgPath(g.neck.head.nodes.map((n) => ({ ...n, y: n.y + g.nutY })), false) + 'Z' : ''), [g.neck, g.nutY]);
  const armLine = useMemo(() => { const m = bevelPlane(design.contours.arm, g.outline, g.centroid); return m ? m.ends : null; }, [design.contours.arm, g.outline, g.centroid]);
  // where the belly cut's three squares sit: its middle, the end of its length, and its reach toward the body
  const bellyHandles = useMemo(() => {
    const b = design.contours.belly;
    if (!b.on) return null;
    const ang = b.angle || 0, ux = Math.cos(ang), uy = Math.sin(ang);
    const toward = ((g.centroid.x - b.x) * ux + (g.centroid.y - b.y) * uy) >= 0 ? 1 : -1;
    return { c: { x: b.x, y: b.y }, l: { x: b.x - uy * (b.len / 2), y: b.y + ux * (b.len / 2) }, w: { x: b.x + ux * b.reach * toward, y: b.y + uy * b.reach * toward } };
  }, [design.contours.belly, g.centroid]);
  const bellyEdge = useMemo(() => { const d = bellyDish(design.contours.belly); return d ? d.ellipse(1, 144) : null; }, [design.contours.belly]);
  const selNode = nodeSel >= 0 ? nodes[nodeSel] : null;
  const selNodeScreen = selNode ? S(selNode) : null;
  const isCenterNode = (i) => (sym || open) && (i === 0 || i === nodes.length - 1);
  const NS = { vectorEffect: 'non-scaling-stroke' };

  const hint = editing
    ? (of === 'head' ? 'Headstock, drawn flat at its true shape · drag points and handles · double-click its outline to add a point · its two ends stay on the nut'
      : 'Drag points and handles · double-click the outline to add a point · Delete removes the selected point')
    : sel && sel.kind === 'pickup' ? 'Drag along the strings · hold Alt to move sideways · arrow keys nudge'
      : 'Click the outline to edit its shape · drag parts to move them · drag empty space to pan · scroll to zoom';

  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }}>
      <svg ref={svg} className="draw" tabIndex={0} role="application" aria-label="Guitar drawing. Click the outline to edit it; drag parts to move them."
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble} onKeyDown={onKey}
        onPointerLeave={() => setCursor(null)} style={{ cursor: drag.current && drag.current.kind === 'pan' ? 'grabbing' : 'default' }}>
        <g transform={world} fill="none" strokeLinejoin="round" strokeLinecap="round">
          {grid && <><path d={grid.dm} stroke="var(--anvil)" strokeWidth="1" {...NS} opacity=".55" /><path d={grid.dM} stroke="var(--anvil2)" strokeWidth="1" {...NS} opacity=".8" /></>}

          {show.ghost && ghosts.map((gh) => gh.visible !== false && (
            gh.image
              ? <g key={gh.id} transform={`translate(${gh.x || 0} ${gh.y || 0}) rotate(${gh.rot || 0}) scale(1 -1)`} opacity={gh.opacity ?? 0.5} style={{ pointerEvents: 'none' }}>
                  <image href={gh.image} x={-gh.w / 2} y={-(gh.w * gh.aspect) / 2} width={gh.w} height={gh.w * gh.aspect} preserveAspectRatio="none" />
                </g>
              : <g key={gh.id} opacity={gh.opacity ?? 0.6} style={{ pointerEvents: 'none' }}>
                  {gh.polys.map((p, i) => <path key={i} d={gh.closedFlags && gh.closedFlags[i] === false ? lineD(p) : polyD(p)} stroke="var(--ghost)" strokeWidth="1.2" strokeDasharray="5 4" {...NS} />)}
                </g>
          ))}

          <path d={outlineD} fill="var(--anvil)" fillOpacity=".72" stroke="none" />

          {show.cavities && g.cuts.filter((c) => c.side === 'back').map((c) => (
            <path key={c.id} d={polyD(c.poly)} data-k={c.kind === 'cavity' ? 'cavity' : undefined} data-id={c.ref}
              stroke={sel && sel.id === c.ref ? 'var(--torch)' : 'var(--brass-dim)'} strokeWidth={sel && sel.id === c.ref ? 2 : 1.3} strokeDasharray="6 4" fill="rgba(200,147,90,.07)" {...NS}
              style={{ cursor: c.kind === 'cavity' ? 'move' : 'default' }} />
          ))}

          <path d={outlineD} stroke={editing && of === 'body' ? 'var(--torch)' : 'var(--bone)'} strokeWidth={editing && of === 'body' ? 1.8 : 1.6} {...NS} style={{ pointerEvents: 'none' }} />
          {headD && <path d={headD} fill="var(--anvil)" fillOpacity=".5" stroke={editing && of === 'head' ? 'var(--torch)' : 'var(--bone)'} strokeWidth={editing && of === 'head' ? 1.8 : 1.4} {...NS} style={{ pointerEvents: 'none' }} />}
          {g.neck && g.neck.head && g.neck.head.tuners.map((t, i) => <circle key={'tuner' + i} data-k="tuner" cx={t.x} cy={t.v + g.nutY} r={t.d / 2} fill="var(--ink, #151210)" stroke={t.gap < 0 ? 'var(--ember, #e2642f)' : 'var(--bone)'} strokeWidth="1" {...NS} style={{ pointerEvents: 'none' }} />)}
          {headD && <path d={headD} stroke="transparent" strokeWidth="14" fill="none" {...NS} data-k="outline" data-of="head" style={{ cursor: 'pointer' }} />}
          <path d={outlineD} stroke="transparent" strokeWidth="14" {...NS} data-k="outline" style={{ cursor: 'pointer' }} />

          {armLine && <path d={`M${armLine[0].x} ${armLine[0].y}L${armLine[1].x} ${armLine[1].y}`} data-k="armline" stroke="var(--ghost)" strokeWidth="1.4" strokeDasharray="9 4" {...NS} clipPath="url(#bodyclip)" style={{ pointerEvents: 'none' }} />}
          {bellyEdge && <path d={polyD(bellyEdge)} stroke="var(--ghost)" strokeWidth="1.4" strokeDasharray="2 5" {...NS} clipPath="url(#bodyclip)" />}
          {bellyEdge && bellyHandles && <path d={`M${bellyHandles.l.x} ${bellyHandles.l.y}L${bellyHandles.c.x} ${bellyHandles.c.y}L${bellyHandles.w.x} ${bellyHandles.w.y}`} stroke="var(--ghost)" strokeWidth="1" opacity=".6" {...NS} />}

          {g.purfling && g.purfling.inner.map((p, i) => <path key={'purf' + i} d={polyD(p)} data-k="purfling" stroke="var(--brass)" strokeWidth="1" strokeDasharray="3 3" fill="none" {...NS} style={{ pointerEvents: 'none' }} />)}
          {g.bevelEdge && <path d={polyD(g.bevelEdge.innerPoly)} data-k="edgeline" stroke="var(--brass)" strokeWidth="1.3" fill="none" {...NS} style={{ pointerEvents: 'none' }} />}
          {g.binding && g.binding.inner.map((p, i) => <path key={'bind' + i} d={polyD(p)} data-k="binding" stroke="var(--brass)" strokeWidth="1" strokeDasharray="5 3" fill="none" {...NS} />)}
          {show.cavities && <path d={polyD(g.pocket)} stroke="var(--bone-dim)" strokeWidth="1.2" fill="rgba(20,18,16,.55)" {...NS} clipPath="url(#bodyclip)" />}
          {show.cavities && g.cuts.filter((c) => c.side === 'top' && c.kind !== 'pocket').map((c) => (
            <path key={c.id} d={polyD(c.poly)} data-k={c.kind === 'pickup' ? 'pickup' : undefined} data-id={c.ref}
              stroke={sel && sel.id === c.ref ? 'var(--torch)' : 'var(--brass)'} strokeWidth={sel && sel.id === c.ref ? 2 : 1.4}
              strokeDasharray={c.kind === 'pickupPart' ? '3 3' : undefined} fill={c.kind === 'pickupPart' ? 'none' : 'rgba(20,18,16,.6)'} {...NS} style={{ cursor: c.kind === 'pickup' ? 'move' : 'default' }} />
          ))}

          {show.hardware && g.pickups.map((p) => p.body && <path key={p.id} d={polyD(p.body)} stroke="var(--steel)" strokeWidth="1" opacity=".7" {...NS} style={{ pointerEvents: 'none' }} />)}
          {show.hardware && g.bridge.outlines.map((o, i) => <path key={i} d={polyD(o)} stroke="var(--steel)" strokeWidth="1.2" fill="rgba(154,160,166,.10)" {...NS} style={{ pointerEvents: 'none' }} />)}
          {show.hardware && g.bridge.saddleBand && (
            <rect x={-g.bridge.saddleBand.halfWidth + 3} y={g.bridge.saddleBand.y0} width={g.bridge.saddleBand.halfWidth * 2 - 6} height={g.bridge.saddleBand.y1 - g.bridge.saddleBand.y0}
              fill="rgba(216,57,43,.16)" stroke="none" style={{ pointerEvents: 'none' }} />
          )}

          {g.holes.map((h) => (
            <circle key={h.id} cx={h.x} cy={h.y} r={h.d / 2} data-k={h.kind === 'control' ? 'control' : undefined} data-id={h.ref}
              stroke={sel && sel.id === h.ref && h.ref ? 'var(--torch)' : h.kind === 'ferrule' ? 'var(--brass-dim)' : 'var(--steel)'}
              strokeWidth={sel && sel.id === h.ref && h.ref ? 2 : 1.2} strokeDasharray={h.side === 'back' ? '3 3' : undefined}
              fill={h.kind === 'control' ? 'rgba(20,18,16,.7)' : 'none'} {...NS} style={{ cursor: h.kind === 'control' ? 'move' : 'default' }} />
          ))}
          {(design.tooling.regHoles || []).map((r, i) => (
            <g key={i} data-k="reg" data-i={i} style={{ cursor: 'move' }}>
              <circle cx={r.x} cy={r.y} r={design.tooling.regPin / 2} stroke="var(--ghost)" strokeWidth="1.4" fill="rgba(111,183,255,.15)" {...NS} />
              <path d={`M${r.x - 5} ${r.y}H${r.x + 5}M${r.x} ${r.y - 5}V${r.y + 5}`} stroke="var(--ghost)" strokeWidth="1" {...NS} />
            </g>
          ))}

          {show.neck && (
            <g style={{ pointerEvents: 'none' }}>
              <path d={polyD(g.fretboard)} stroke="var(--bone-dim)" strokeWidth="1" fill="rgba(237,230,216,.05)" {...NS} />
              <path d={g.frets.map((f) => `M${-f.half} ${f.y}H${f.half}`).join('')} stroke="var(--bone-dim)" strokeWidth="1" {...NS} opacity=".8" />
              <path d={`M${-g.neckHalf(g.nutY)} ${g.nutY}H${g.neckHalf(g.nutY)}`} stroke="var(--bone)" strokeWidth="2.5" {...NS} />
              <path d={g.strings.map((s) => `M${s.nut.x} ${s.nut.y}L${s.saddle.x} ${s.saddle.y}`).join('')} stroke="var(--steel)" strokeWidth=".8" {...NS} opacity=".75" />
            </g>
          )}

          <g style={{ pointerEvents: 'none' }}>
            <path d={`M0 ${g.bbox.y0 - 30}V${g.nutY + 20}`} stroke="var(--bone-dim)" strokeWidth="1" strokeDasharray="10 4 2 4" {...NS} opacity=".6" />
            <path d={`M${-g.saddleSpread / 2 - 22} 0H${g.saddleSpread / 2 + 22}`} stroke="var(--scale)" strokeWidth="1.3" {...NS} />
          </g>

        </g>

        <defs><clipPath id="bodyclip"><path d={outlineD} /></clipPath></defs>

        {/* screen-space overlay: labels, markers and editing handles keep a constant size */}
        <g style={{ pointerEvents: 'none' }} fontFamily="var(--mono)" fontSize="10.5">
          <text x={S({ x: g.saddleSpread / 2 + 24, y: 0 }).x + 4} y={S({ x: 0, y: 0 }).y + 3.5} fill="var(--scale)">scale line</text>
          {show.marks && findings.filter((f) => f.level === 'warn' && f.at).map((f, i) => {
            const p = S(f.at);
            return <g key={i}><circle cx={p.x} cy={p.y} r="9" fill="none" stroke="var(--torch)" strokeWidth="1.6" /><circle cx={p.x} cy={p.y} r="2.2" fill="var(--torch)" /></g>;
          })}
        </g>

        {g.bevelEdge && g.bevelEdge.handles.map((h) => {
          const p = S(h.inner), picked = sel && sel.kind === 'edgebevel' && sel.i === h.i;
          return <g key={'eb' + h.i} data-k="edgebevel" data-i={h.i} data-picked={picked ? '1' : undefined} style={{ cursor: 'move' }}>
            <circle cx={p.x} cy={p.y} r="11" fill="transparent" /><rect x={p.x - (picked ? 5.5 : 4)} y={p.y - (picked ? 5.5 : 4)} width={picked ? 11 : 8} height={picked ? 11 : 8} transform={`rotate(45 ${p.x} ${p.y})`} fill={picked ? 'var(--brass)' : 'var(--forge)'} stroke="var(--brass)" strokeWidth="1.6" />
          </g>;
        })}

        {['arm', 'belly'].map((key) => {
          const c = design.contours[key];
          if (!c.on || (key === 'belly' && !bellyHandles)) return null;
          const spots = key === 'arm' ? { 1: { x: c.x1, y: c.y1 }, 2: { x: c.x2, y: c.y2 } } : bellyHandles;
          const first = S(spots[key === 'arm' ? 1 : 'c']);
          return Object.keys(spots).map((i) => {
            const p = S(spots[i]);
            return <g key={key + i} data-k="bevel" data-id={key} data-i={i} style={{ cursor: 'move' }}>
              <circle cx={p.x} cy={p.y} r="12" fill="transparent" /><rect x={p.x - 5} y={p.y - 5} width="10" height="10" rx="2" fill="var(--forge)" stroke="var(--ghost)" strokeWidth="1.6" />
            </g>;
          }).concat(<text key={key + 't'} x={first.x + 10} y={first.y + (key === 'arm' ? -8 : 20)} fill="var(--ghost)" fontSize="10.5" fontFamily="var(--mono)" style={{ pointerEvents: 'none' }}>{key === 'arm' ? 'arm bevel starts (top)' : 'belly cut, center (back)'}</text>);
        })}

        {editing && nodes.map((n, i) => {
          const p = S(n), a = S({ x: n.x + n.ix, y: n.y + n.iy }), b = S({ x: n.x + n.ox, y: n.y + n.oy });
          const on = i === nodeSel;
          const showIn = on && !(sym && i === 0) && (Math.abs(n.ix) + Math.abs(n.iy) > 1e-6);
          const showOut = on && !(sym && i === nodes.length - 1) && (Math.abs(n.ox) + Math.abs(n.oy) > 1e-6);
          return (
            <g key={i}>
              {showIn && <><line x1={p.x} y1={p.y} x2={a.x} y2={a.y} stroke="var(--torch)" strokeWidth="1" /><g data-k="hin" data-i={i} style={{ cursor: 'crosshair' }}><circle cx={a.x} cy={a.y} r="11" fill="transparent" /><circle cx={a.x} cy={a.y} r="4" fill="var(--forge)" stroke="var(--torch)" strokeWidth="1.5" /></g></>}
              {showOut && <><line x1={p.x} y1={p.y} x2={b.x} y2={b.y} stroke="var(--torch)" strokeWidth="1" /><g data-k="hout" data-i={i} style={{ cursor: 'crosshair' }}><circle cx={b.x} cy={b.y} r="11" fill="transparent" /><circle cx={b.x} cy={b.y} r="4" fill="var(--forge)" stroke="var(--torch)" strokeWidth="1.5" /></g></>}
              <g data-k="node" data-i={i} style={{ cursor: 'move' }}>
                <circle cx={p.x} cy={p.y} r="12" fill="transparent" />
                {n.k === 'c'
                  ? <rect x={p.x - 5} y={p.y - 5} width="10" height="10" fill={on ? 'var(--torch)' : 'var(--forge)'} stroke="var(--torch)" strokeWidth="1.6" />
                  : <circle cx={p.x} cy={p.y} r="5.2" fill={on ? 'var(--torch)' : 'var(--forge)'} stroke="var(--torch)" strokeWidth="1.6" />}
              </g>
            </g>
          );
        })}
      </svg>

      {selNode && selNodeScreen && !drag.current && (
        /* kept well clear of the point and its handles: below a point in the upper half of the drawing, above one in the lower half */
        <div className="float" data-k="pointbar" style={{ left: Math.max(8, Math.min(size.w - 250, selNodeScreen.x - 120)), top: selNodeScreen.y < size.h / 2 ? Math.min(size.h - 50, selNodeScreen.y + 96) : Math.max(8, selNodeScreen.y - 136) }}>
          <div className="seg" role="group" aria-label="Point type">
            <button type="button" className={selNode.k === 's' ? 'on' : ''} onClick={() => { begin(); edit((ds) => store(ds, stored(ds).map((n, i) => (i === nodeSel ? setKind(n, 's') : n)))); commit(); }}>Smooth</button>
            <button type="button" className={selNode.k === 'c' ? 'on' : ''} onClick={() => { begin(); edit((ds) => store(ds, stored(ds).map((n, i) => (i === nodeSel ? setKind(n, 'c') : n)))); commit(); }}>Corner</button>
          </div>
          {!isCenterNode(nodeSel) && nodes.length > 3 && <button type="button" className="btn small" onClick={() => { begin(); edit((ds) => store(ds, removeNode(stored(ds), nodeSel))); setSel(pick({ kind: 'outline' })); commit(); }}>Delete point</button>}
        </div>
      )}

      <div className="zoomctl">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.3)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.3)}>−</button>
        <button type="button" className="z" aria-label="Fit the drawing to the window" onClick={fit}>fit</button>
      </div>
      <div className="hintline">
        <span>{hint}</span>
        <span>{cursor ? `${fmtLen(cursor.x, units)}, ${fmtLen(cursor.y, units)} ${unitLabel(units)} from centerline, scale line` : ''}</span>
      </div>
    </div>
  );
}
