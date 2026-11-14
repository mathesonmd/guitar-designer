import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { fmtLen, parseLen, unitLabel, fractionLabel, MM_PER_IN } from '../core/units.js';
import { SOURCES, BASIS_LABEL } from '../data/sources.js';

// Length field. Stores millimeters; shows and accepts the chosen unit, including fractions (2-3/16).
export function Len({ value, onChange, units, min = -1e6, max = 1e6, id, disabled, title }) {
  const [text, setTextState] = useState(null); // null = not editing
  const live = useRef(null);                   // the same text, readable at once (Enter commits, then blur fires)
  const setText = (t) => { live.current = t; setTextState(t); };
  const typed = useRef(false);                 // a box that was only clicked into, not typed in, changes nothing when left
  const [bad, setBad] = useState(false);
  const shown = text !== null ? text : fmtLen(value, units);
  const commit = () => {
    const t = live.current;
    if (t === null) return;
    setText(null);
    if (!typed.current) return;
    typed.current = false;
    const v = parseLen(t, units);
    if (Number.isNaN(v)) { setBad(true); setTimeout(() => setBad(false), 700); return; }
    const c = Math.max(min, Math.min(max, v));
    // Typing back the number already shown is not a change (the stored value can be finer than the display).
    if (fmtLen(c, units) !== fmtLen(value, units)) onChange(c);
  };
  const nudge = (dir, big) => {
    const step = units === 'mm' ? (big ? 1 : 0.1) : (big ? MM_PER_IN / 16 : MM_PER_IN / 64);
    onChange(Math.max(min, Math.min(max, value + dir * step)));
  };
  const frac = units === 'in' ? fractionLabel(value / MM_PER_IN) : null;
  return (
    <span className="len" title={title || (frac && frac.includes('/') ? `${frac} in` : undefined)}>
      <input id={id} type="text" inputMode="decimal" className={bad ? 'bad' : ''} disabled={disabled} value={shown}
        onFocus={(e) => { typed.current = false; setText(fmtLen(value, units)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => { typed.current = true; setText(e.target.value); }} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); e.target.blur(); }
          else if (e.key === 'Escape') { setText(null); e.target.blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setText(null); nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey); }
        }} />
      <span className="unit">{unitLabel(units)}</span>
    </span>
  );
}

// Plain number field (angles, counts).
export function Num({ value, onChange, min = -1e9, max = 1e9, step = 1, id, suffix, digits = 0 }) {
  const [text, setTextState] = useState(null);
  const live = useRef(null);
  const setText = (t) => { live.current = t; setTextState(t); };
  const typed = useRef(false);                 // a box that was only clicked into, not typed in, changes nothing when left
  const commit = () => {
    const t = live.current;
    if (t === null) return;
    setText(null);
    if (!typed.current) return;
    typed.current = false;
    const v = parseFloat(t);
    if (!Number.isFinite(v)) return;
    const c = Math.max(min, Math.min(max, v));
    if (c.toFixed(digits) !== value.toFixed(digits)) onChange(c);
  };
  return (
    <span className="len num">
      <input id={id} type="text" inputMode="decimal" value={text !== null ? text : value.toFixed(digits)}
        onFocus={(e) => { typed.current = false; setText(value.toFixed(digits)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => { typed.current = true; setText(e.target.value); }} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); e.target.blur(); }
          else if (e.key === 'Escape') { setText(null); e.target.blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setText(null); onChange(Math.max(min, Math.min(max, value + (e.key === 'ArrowUp' ? step : -step)))); }
        }} />
      <span className="unit">{suffix || ''}</span>
    </span>
  );
}

export function Seg({ value, onChange, options, wide, label }) {
  return (
    <div className={'seg' + (wide ? ' wide' : '')} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children, id }) {
  return <label className="check"><input id={id} type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />{children}</label>;
}

export function Row({ label, htmlFor, children, wide, basis }) {
  return (
    <div className={'row' + (wide ? ' wide' : '')}>
      <label htmlFor={htmlFor}>{label}{basis}</label>
      <div className="ctl">{children}</div>
    </div>
  );
}

const memory = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};
export { memory };

// Collapsible panel section; remembers whether it was open.
export function Acc({ id, title, hint, defaultOpen = false, children, open: forced, onToggle }) {
  const [openState, setOpen] = useState(() => memory.get('bcs.gd.acc.' + id, defaultOpen));
  const open = forced !== undefined ? forced : openState;
  const toggle = () => { const n = !open; setOpen(n); memory.set('bcs.gd.acc.' + id, n); if (onToggle) onToggle(n); };
  return (
    <section className="sec" data-sec={id}>
      <h3><button type="button" aria-expanded={open} onClick={toggle}><span>{title}</span><span className="hint">{hint} {open ? '−' : '+'}</span></button></h3>
      {open && <div className="rows">{children}</div>}
    </section>
  );
}

// Small round badge that says where a number came from; opens a note with the source.
export function Basis({ kind, text, src }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const show = () => {
    const r = ref.current.getBoundingClientRect();
    const w = 300, x = Math.max(12, Math.min(window.innerWidth - w - 12, r.left - 20));
    const below = r.bottom + 220 < window.innerHeight;
    setPos(below ? { left: x, top: r.bottom + 8 } : { left: x, bottom: window.innerHeight - r.top + 8 });
  };
  const sources = (Array.isArray(src) ? src : src ? [src] : []).map((k) => SOURCES[k]).filter(Boolean);
  const letter = { published: 'P', scaled: 'D', shop: 'S', assumed: '!' }[kind] || 'i';
  return (
    <i ref={ref} className={'basis ' + (kind || '')} tabIndex={0} role="button" aria-label={`${BASIS_LABEL[kind] || 'About this value'}. ${text || ''}`}
      onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)}>
      {letter}
      {pos && (
        <span className="pop" style={pos} role="tooltip">
          <span className={'k basis-' + kind} style={{ color: kind === 'published' ? 'var(--ok)' : kind === 'assumed' ? 'var(--torch)' : kind === 'shop' ? 'var(--brass)' : 'var(--ghost)' }}>{BASIS_LABEL[kind] || 'About this value'}</span>
          {text}
          {sources.map((s) => <span className="src" key={s.title}>Source: {s.title}</span>)}
        </span>
      )}
    </i>
  );
}

export function Dialog({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    if (ref.current) ref.current.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} style={wide ? { maxWidth: 980 } : null}>
        <header><h2>{title}</h2><button className="btn small" onClick={onClose}>Close</button></header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

export function Menu({ label, children, primary }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener('pointerdown', off);
    return () => window.removeEventListener('pointerdown', off);
  }, [open]);
  return (
    <div className="menuwrap" ref={ref}>
      <button type="button" className={'btn' + (primary ? ' primary' : '')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{label} ▾</button>
      {open && <div className="menu" role="menu" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

export function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const el = ref.current;
    const upd = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
