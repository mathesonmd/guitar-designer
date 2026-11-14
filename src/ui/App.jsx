import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { LOGO } from '../assets/logo.js';
import { defaultDesign, normalizeDesign, STARTERS, newId, SCHEMA } from '../model/design.js';
import { derive } from '../model/derive.js';
import { buildLayers } from '../model/solid.js';
import { runChecks } from '../model/checks.js';
import { SHOP } from '../data/shop.js';
import { NECK_PRESETS, NECK_LABELS } from '../data/necks.js';
import { PICKUPS } from '../data/pickups.js';
import { BRIDGES } from '../data/bridges.js';
import { WOODS } from '../data/parts.js';
import { SOURCES, BASIS_LABEL } from '../data/sources.js';
import { expandOutline, nodesToSvgPath } from '../core/path.js';
import { fitClosed } from '../core/fit.js';
import { signedArea, bbox } from '../core/poly.js';
import { fmtWithUnit } from '../core/units.js';
import Canvas2D from './Canvas2D.jsx';
import Panels from './Panels.jsx';
import Rail from './Rail.jsx';
import View3D from './View3D.jsx';
import SideView from './SideView.jsx';
import TongueView from './TongueView.jsx';
import Model3DDialog from './Model3DDialog.jsx';
import TemplatesView from './TemplatesView.jsx';
import { Seg, Dialog, Menu, memory } from './widgets.jsx';
import { saveFile, readText, readDataURL, slug } from './files.js';
import { parseDXF, parseSVG, recenter } from './ghostImport.js';

const TABS = [{ value: 'design', label: 'Design' }, { value: 'view3d', label: '3D' }, { value: 'templates', label: 'Templates' }];
const unflat = (a) => { const p = []; for (let i = 0; i < a.length; i += 2) p.push({ x: a[i], y: a[i + 1] }); return p; };
const BUILTIN_GHOSTS = { tStyle: { name: 'T-style (shop template)' }, jStyle: { name: 'J-style (shop template)' } };
const readTab = () => { const h = (typeof location !== 'undefined' ? location.hash : '').replace('#', ''); return TABS.some((t) => t.value === h) ? h : 'design'; };

export default function App() {
  const [design, setDesign] = useState(() => {
    const saved = memory.get('bcs.gd.design', null);
    return saved && saved.schema === SCHEMA ? normalizeDesign(saved) : defaultDesign();
  });
  const ref = useRef(design); ref.current = design;
  const hist = useRef({ past: [], future: [] });
  const [, bump] = useState(0);
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState(readTab);
  const [show, setShow] = useState({ ghost: true, neck: true, hardware: true, cavities: true, marks: true, grid: true });
  const [dialog, setDialog] = useState(null);
  const [toastMsg, setToast] = useState('');
  const [viewCmd, setViewCmd] = useState(null);
  const openRef = useRef(null);

  const toast = useCallback((m) => { setToast(m); clearTimeout(toast.t); toast.t = setTimeout(() => setToast(''), 5200); }, []);

  /* ---- history ---- */
  const begin = useCallback(() => { const h = hist.current; h.past.push(ref.current); if (h.past.length > 120) h.past.shift(); h.future = []; h.open = ref.current; }, []);
  const commit = useCallback(() => { const h = hist.current; if (h.open && h.open === ref.current) h.past.pop(); h.open = null; bump((n) => n + 1); }, []);
  // The newest design is kept in `ref` the moment it is made, so several edits in one event build on
  // each other and commit() can tell whether anything actually changed.
  const apply = useCallback((n) => { ref.current = n; setDesign(n); }, []);
  const edit = useCallback((fn) => apply(fn(ref.current)), [apply]);
  const change = useCallback((fn) => { begin(); apply(fn(ref.current)); hist.current.open = null; bump((n) => n + 1); }, [begin, apply]);
  // undo and redo step through the design; the unit choice is a display setting and stays as it is
  const undo = useCallback(() => { const h = hist.current; if (!h.past.length) return; h.future.push(ref.current); apply({ ...h.past.pop(), units: ref.current.units }); setSel(null); }, [apply]);
  const redo = useCallback(() => { const h = hist.current; if (!h.future.length) return; h.past.push(ref.current); apply({ ...h.future.pop(), units: ref.current.units }); setSel(null); }, [apply]);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.target.tagName === 'INPUT') return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  useEffect(() => { const t = setTimeout(() => memory.set('bcs.gd.design', design), 600); return () => clearTimeout(t); }, [design]);
  useEffect(() => {
    const onHash = () => setTab(readTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (t) => { setTab(t); try { history.replaceState(null, '', '#' + t); } catch (e) { /* hash not available */ } };

  /* ---- geometry: fast part on every change, slow part once things settle ---- */
  const g = useMemo(() => derive(design, { tol: 0.02 }), [design]);
  const [slow, setSlow] = useState({ solid: null, g3: null, findings: [], of: null });
  useEffect(() => {
    const t = setTimeout(() => {
      const g3 = derive(design, { tol: 0.1 });
      let solid = null, findings = [];
      try { solid = buildLayers(design, g3); } catch (e) { solid = null; }
      try { findings = runChecks(design, derive(design, { tol: 0.03 }), solid); } catch (e) { findings = [{ level: 'warn', title: 'Checks could not run on this shape', detail: 'The outline may cross itself. Undo the last change or straighten the outline.' }]; }
      setSlow({ solid, g3, findings, of: design });
    }, 220);
    return () => clearTimeout(t);
  }, [design]);

  const ghosts = useMemo(() => design.ghosts.map((gh) => {
    if (gh.builtin) return { ...gh, polys: [unflat(SHOP.ghosts[gh.builtin])] };
    if (gh.image) return gh;
    return { ...gh, polys: gh.polys.map((p) => unflat(p.pts)), closedFlags: gh.polys.map((p) => p.closed) };
  }), [design.ghosts]);

  /* ---- actions ---- */
  const addGhost = async (arg) => {
    try {
      if (typeof arg === 'string') {
        const key = arg.split(':')[1];
        if (design.ghosts.some((x) => x.builtin === key)) { toast('That reference is already on the drawing.'); return; }
        change((d) => ({ ...d, ghosts: [...d.ghosts, { id: newId('gh'), name: BUILTIN_GHOSTS[key].name, builtin: key, opacity: 0.6, visible: true }] }));
        return;
      }
      const name = arg.name.replace(/\.[^.]+$/, '');
      if (/\.(svg)$/i.test(arg.name) || /\.(dxf)$/i.test(arg.name)) {
        const text = await readText(arg);
        const res = /\.dxf$/i.test(arg.name) ? parseDXF(text) : parseSVG(text);
        if (!res.polys.length) { toast('No outlines found in that file.'); return; }
        const polys = recenter(res.polys, g.bbox).map((p) => ({ closed: p.closed, pts: p.pts.flatMap((q) => [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100]) }));
        change((d) => ({ ...d, ghosts: [...d.ghosts, { id: newId('gh'), name, polys, opacity: 0.6, visible: true }] }));
        const b = bbox(res.polys.flatMap((p) => p.pts));
        toast(`Added ${name}: ${fmtWithUnit(b.w, design.units)} × ${fmtWithUnit(b.h, design.units)}.${res.guessed ? ' The file did not say its units; inches were assumed.' : res.units === 'px' ? ' The file has no real-world units, so 96 pixels per inch was assumed.' : ''}`);
        return;
      }
      const url = await readDataURL(arg);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      change((d) => ({ ...d, ghosts: [...d.ghosts, { id: newId('gh'), name, image: url, aspect: img.naturalHeight / img.naturalWidth, w: g.bbox.w, x: 0, y: g.bbox.cy, rot: 0, opacity: 0.5, visible: true }] }));
      toast('Photo added. Set its real width under Reference outlines, then line it up.');
    } catch (e) { toast('That file could not be read as an outline or image.'); }
  };

  const traceGhost = (gh) => {
    const src = ghosts.find((x) => x.id === gh.id);
    if (!src || !src.polys) return;
    const closed = src.polys.filter((p, i) => (src.closedFlags ? src.closedFlags[i] : true) && p.length > 8);
    if (!closed.length) { toast('That reference has no closed outline to use.'); return; }
    const big = closed.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
    const nodes = fitClosed(signedArea(big) < 0 ? big.slice().reverse() : big, 0.35);
    if (nodes.length < 3) { toast('That outline could not be converted.'); return; }
    change((d) => ({ ...d, outline: { symmetric: false, nodes } }));
    setSel({ kind: 'outline' });
    toast(`Outline replaced with ${nodes.length} editable points. Undo brings the old one back.`);
  };

  const importFretboard = async (file) => {
    try {
      const j = JSON.parse(await readText(file));
      if (!j || typeof j.schema !== 'string' || !j.schema.startsWith('blackchapel.fretboard') || !j.params) { toast('That is not a Fretboard Designer build file.'); return; }
      const k = j.units === 'mm' ? 1 : j.units === 'cm' ? 10 : 25.4, p = j.params;
      const multi = p.scaleMode !== 'single' && Math.abs(p.scaleBass - p.scaleTreble) > 1e-6;
      change((d) => ({
        ...d,
        neck: { ...d.neck, preset: 'custom', scale: p.scaleTreble * k, frets: Math.round(p.numFrets), nutWidth: (p.nutSpread + p.overhangBass + p.overhangTreble) * k, nutToHeel: d.neck.nutToHeel + (p.scaleTreble * k - d.neck.scale) },
        strings: { ...d.strings, nutSpread: p.nutSpread * k },
        compensation: { treble: p.compTreble * k, bass: p.compBass * k },
      }));
      toast(multi ? 'Loaded the treble-side scale. Fanned-fret necks are not supported here yet.' : 'Scale, frets, nut and compensation loaded. The heel was kept the same distance from the bridge: check “Nut to end of heel” against your neck.');
    } catch (e) { toast('That file could not be read.'); }
  };

  const openDesign = async (file) => {
    try {
      const j = JSON.parse(await readText(file));
      if (!j || j.schema !== SCHEMA) { toast('That is not a Guitar Designer file.'); return; }
      change(() => normalizeDesign(j));
      setSel(null); setViewCmd({ type: 'fit', n: Date.now() });
      toast(`Opened ${j.name || 'design'}.`);
    } catch (e) { toast('That file could not be read.'); }
  };

  const onGo = (f) => {
    if (tab !== 'design') go('design');
    const ref2 = f.ref;
    if (ref2 && design.pickups.some((p) => p.id === ref2)) setSel({ kind: 'pickup', id: ref2 });
    else if (ref2 && design.controls.some((p) => p.id === ref2)) setSel({ kind: 'control', id: ref2 });
    else if (ref2 && design.cavities.some((p) => p.id === ref2)) setSel({ kind: 'cavity', id: ref2 });
    if (f.at) setViewCmd({ type: 'focus', at: f.at, n: Date.now() });
  };

  const stale = slow.of !== design;
  const h = hist.current;

  const nh = g.neck && g.neck.head;
  const lineView = !sel || !nh ? null : sel.kind === 'side' && nh.side ? 'side' : sel.kind === 'tongue' && nh.tongue && nh.tongue.line ? 'tongue' : null;
  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <a className="logolink" href="https://blackchapelstudios.com" target="_blank" rel="noopener"><img className="logo" src={LOGO} alt="Black Chapel Studios" /></a>
          <span className="rule" />
          <span className="tool">Guitar Designer</span>
        </div>
        <Seg label="View" value={tab} onChange={go} options={TABS} />
        <div className="spacer" />
        <div className="grp">
          <input className="name" aria-label="Design name" value={design.name} onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))} onFocus={begin} onBlur={commit} />
          <button className="btn icon" onClick={undo} disabled={!h.past.length} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
          <button className="btn icon" onClick={redo} disabled={!h.future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">↷</button>
          <Seg label="Units" value={design.units} onChange={(v) => edit((d) => ({ ...d, units: v }))} options={[{ value: 'in', label: 'in' }, { value: 'mm', label: 'mm' }]} />
          <Menu label="File">
            <button role="menuitem" onClick={() => setDialog('starter')}>New from a starting shape…</button>
            <button role="menuitem" onClick={() => openRef.current.click()}>Open a design…<small>A .guitar.json file saved from here</small></button>
            <button role="menuitem" onClick={async () => toast((await saveFile(`${slug(design.name)}.guitar.json`, JSON.stringify(design, null, 1))).message)}>Save this design<small>Keeps everything, to open again later</small></button>
            <button role="menuitem" onClick={() => setDialog('model3d')}>Save files for CNC…<small>2D vectors for pockets, and a 3D model of the body</small></button>
            <div className="sep" />
            <button role="menuitem" onClick={() => setDialog('sources')}>Where the numbers come from</button>
          </Menu>
          <button className="btn primary cta" onClick={() => go('templates')}>Templates</button>
          <input ref={openRef} type="file" accept=".json,application/json" hidden onChange={(e) => { if (e.target.files[0]) openDesign(e.target.files[0]); e.target.value = ''; }} />
        </div>
      </header>

      <div className="main">
        <Panels design={design} g={g} sel={sel} setSel={setSel} change={change} solid={stale ? null : slow.solid}
          onStarter={() => setDialog('starter')} onAddGhost={addGhost} onTraceGhost={traceGhost} onImportFretboard={importFretboard} />
        <main className="stage">
          {/* (lineView: which drawn guide line of the neck is being reshaped in place of the drawing, if any) */}
          {tab === 'design' && lineView === 'side' && <SideView design={design} g={g} setSel={setSel} edit={edit} begin={begin} commit={commit} />}
          {tab === 'design' && lineView === 'tongue' && <TongueView design={design} g={g} setSel={setSel} edit={edit} begin={begin} commit={commit} />}
          {tab === 'design' && !lineView && <Canvas2D design={design} g={g} sel={sel} setSel={setSel} edit={edit} begin={begin} commit={commit} show={show} findings={stale ? [] : slow.findings} viewCmd={viewCmd} ghosts={ghosts} />}
          {tab === 'view3d' && slow.solid && <View3D design={slow.of || design} g={slow.g3} solid={slow.solid} onSaveModel={() => setDialog('model3d')} />}
          {tab === 'templates' && <TemplatesView design={design} toast={toast} />}
          {toastMsg && <div className="toast" role="status" aria-live="polite">{toastMsg}</div>}
        </main>
        <Rail design={design} g={g} solid={stale ? null : slow.solid} findings={slow.findings} checking={stale} onGo={onGo} show={show} setShow={setShow}
          onVerify={(key) => change((d) => ({ ...d, verified: { ...(d.verified || {}), [key]: d.neck[key] } }))} />
      </div>

      {dialog === 'starter' && (
        <Dialog title="Start from a shape" onClose={() => setDialog(null)}>
          <p style={{ color: 'var(--bone-dim)', margin: '10px 0 0' }}>This replaces the body outline only. Neck, bridge, pickups and controls stay where they are. Undo brings the old outline back.</p>
          <div className="starters">
            {Object.entries(STARTERS).map(([key, s]) => {
              const nodes = expandOutline(s.outline);
              const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
              const x0 = Math.min(...xs) - 12, x1 = Math.max(...xs) + 12, y0 = Math.min(...ys) - 12, y1 = Math.max(...ys) + 12;
              return (
                <button key={key} className="starter" onClick={() => { change((d) => ({ ...d, outline: JSON.parse(JSON.stringify(s.outline)) })); setDialog(null); setSel({ kind: 'outline' }); setViewCmd({ type: 'fit', n: Date.now() }); }}>
                  <svg viewBox={`${x0} ${-y1} ${x1 - x0} ${y1 - y0}`} aria-hidden="true"><g transform="scale(1,-1)"><path d={nodesToSvgPath(nodes, true)} fill="var(--anvil)" stroke="var(--bone)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></g></svg>
                  <b>{s.label}</b><span>{s.note}</span>
                </button>
              );
            })}
          </div>
        </Dialog>
      )}
      {dialog === 'model3d' && <Model3DDialog design={design} onClose={() => setDialog(null)} toast={toast} />}
      {dialog === 'sources' && <SourcesDialog design={design} onClose={() => setDialog(null)} />}
    </div>
  );
}

function SourcesDialog({ design, onClose }) {
  const u = design.units;
  const key = (k) => <span style={{ color: { published: 'var(--ok)', scaled: 'var(--ghost)', shop: 'var(--brass)', assumed: 'var(--torch)' }[k], fontWeight: 700, whiteSpace: 'nowrap' }}>{BASIS_LABEL[k]}</span>;
  const src = (keys) => (Array.isArray(keys) ? keys : keys ? [keys] : []).map((k) => SOURCES[k]).filter(Boolean).map((s, i) => (
    <div key={i}>{s.url ? <a href={s.url} target="_blank" rel="noopener">{s.title}</a> : s.title}</div>
  ));
  const neck = NECK_PRESETS.fender21;
  return (
    <Dialog title="Where the numbers come from" onClose={onClose} wide>
      <p style={{ color: 'var(--bone-dim)' }}>Every built-in dimension is tagged with how far to trust it. Hover the small round badges beside any field to see the same notes in place.</p>
      <p>{key('published')} stated by the maker or supplier · {key('scaled')} overall size is published, inner details measured off their drawing · {key('shop')} read from the Black Chapel class templates · {key('assumed')} a starting point with no published source.</p>
      <h4>Neck and pocket (Fender-pattern)</h4>
      <div className="tablewrap"><table><thead><tr><th>Dimension</th><th>Value</th><th>Basis</th><th>Note and source</th></tr></thead><tbody>
        {Object.entries(neck.basis).map(([k, b]) => (
          <tr key={k}><td>{NECK_LABELS[k] || k}</td><td className="v">{typeof neck.values[k] === 'number' ? fmtWithUnit(neck.values[k], u) : ''}</td><td>{key(b[0])}</td><td>{b[2]}{src(b[1])}</td></tr>
        ))}
      </tbody></table></div>
      <h4>Pickup cavities</h4>
      <div className="tablewrap"><table><thead><tr><th>Pickup</th><th>Basis</th><th>Pickup size</th><th>Cavity</th></tr></thead><tbody>
        {Object.entries(PICKUPS).filter(([k]) => k !== 'custom').map(([k, p]) => (
          <tr key={k}><td>{p.label}</td><td>{key(p.basis)}</td><td>{p.bodyNote}</td><td>{p.routeNote} {p.depthNote}{src(p.src)}</td></tr>
        ))}
      </tbody></table></div>
      <h4>Bridges</h4>
      <div className="tablewrap"><table><thead><tr><th>Bridge</th><th>Basis</th><th>Dimensions</th><th>Placement</th></tr></thead><tbody>
        {Object.entries(BRIDGES).filter(([k]) => k !== 'none').map(([k, b]) => (
          <tr key={k}><td>{b.label}</td><td>{key(b.basis)}</td><td>{b.note} {b.holeNote}{src(b.src)}</td><td>{b.placementNote}</td></tr>
        ))}
      </tbody></table></div>
      <h4>Wood weights</h4>
      <p>{Object.values(WOODS).filter((w) => w.lbft3).map((w) => `${w.label} ${w.lbft3} lb/ft³ (${w.density} kg/m³)`).join(' · ')}. {src('woodDb')}</p>
      <h4>What has and has not been tested</h4>
      <p><b>Tested in software:</b> offsets for bushings and kerf, arc fitting, the DXF and SVG files read back and measured, cavity sizes against the published figures, volume and weight math.</p>
      <p><b>Not tested:</b> nothing here has been cut on a laser or routed in wood yet. Bridge placement defaults are reasoned from drawings. Make a test cut in scrap and check the engraved scale bar before trusting a template.</p>
    </Dialog>
  );
}
