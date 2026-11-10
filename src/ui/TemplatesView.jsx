import React, { useMemo, useRef, useState, useEffect } from 'react';
import { derive } from '../model/derive.js';
import { buildTemplates } from '../model/templates.js';
import { prepare, LAYERS } from '../export/prepare.js';
import { toSVG, pathData } from '../export/svg.js';
import { toDXF } from '../export/dxf.js';
import { toPDF } from '../export/pdf.js';
import { makeZip } from '../export/zip.js';
import { saveFile, slug, inViewer } from './files.js';
import { fmtWithUnit } from '../core/units.js';
import { useSize } from './widgets.jsx';

const HINT = 30; // room under the preview for the hint line
const COLORS = { ENGRAVE: 'var(--bone-dim)', CUT_INSIDE: 'var(--ghost)', CUT_OUTSIDE: 'var(--torch)' };

export function buildPack(design) {
  const g = derive(design, { tol: 0.005 });
  const templates = buildTemplates(design, g);
  const prep = prepare(templates, { tol: 0.01 });
  return { g, templates, prep };
}

export function readme(design, templates, prep) {
  const u = design.units, o = templates.offsets;
  const L = (mm) => fmtWithUnit(mm, u);
  const lines = [
    `${design.name}`,
    `Routing templates from the Black Chapel Studios Guitar Designer`,
    `Made ${new Date().toISOString().slice(0, 10)}. All files are true size, in millimeters.`,
    '',
    'BEFORE YOU CUT WOOD',
    '1. Cut or print the templates, then measure the two engraved scale bars. Each is labeled with the length it must measure.',
    templates.unverified.length
      ? `2. These neck numbers have not been confirmed against a real neck and are engraved as CHECK notes: ${templates.unverified.map((k) => ({ nutToHeel: 'nut to end of heel', heelCornerR: 'heel corner radius', screwFromHeelEnd: 'neck screw position', boardPastHeel: 'fretboard overhang' }[k] || k)).join(', ')}. Measure them before cutting.`
      : '2. Check the neck and hardware you will use against the template before cutting.',
    '3. Make a test cut in scrap. These templates have been checked in software, not on a router.',
    templates.pocketSheet === 'own'
      ? '4. The neck pocket has its own template. Its opening runs past the body edge so the bit can leave the pocket. Line it up by the alignment pins if you use them, or by the engraved centerline and the engraved body edge.'
      : '4. The neck pocket is a notch in the edge of the top template. Rout it to pocket depth only. When you trim the body outline, stop at each side of the notch: following it would cut the pocket right through the body.',
    '',
    'FILES',
    '  *.dxf   for CAM and laser software (R12; arcs are arcs and round holes are circles)',
    '  *.svg   for laser software and vector editors',
    '  *.pdf   tiled pages to print at 100% and tape together',
    '  *.guitar.json   the design itself: open it in the Guitar Designer to keep working',
    '',
    'LAYERS (same names and colors in the DXF and SVG)',
    ...LAYERS.map((l) => `  ${l.name.padEnd(12)} ${l.color}  ${l.note}`),
    '',
    'ROUTING SETUP THESE TEMPLATES WERE MADE FOR',
    `  Body outline: ${design.tooling.outline.mode === 'bushing' ? `guide bushing ${L(design.tooling.outline.bushing)} with a ${L(design.tooling.outline.bit)} bit. Template edge is ${L(o.outline)} inside the finished outline.` : `bearing-guided ${L(design.tooling.outline.bit)} bit. Template edge is the finished edge.`}`,
    `  Cavities:     ${design.tooling.cavity.mode === 'bushing' ? `guide bushing ${L(design.tooling.cavity.bushing)} with a ${L(design.tooling.cavity.bit)} bit. Openings are ${L(o.cavity)} larger all round than the finished cavity.` : `bearing-guided ${L(design.tooling.cavity.bit)} bit. Openings are the finished cavity.`}`,
    `  Laser kerf allowance: ${o.kerf > 0 ? L(o.kerf) : 'none'}`,
    '',
    'SHEETS',
  ];
  for (const sh of templates.sheets) {
    const p = prep.sheets.find((s) => s.id === sh.id);
    lines.push(`  ${sh.name}${p ? `  (${L(p.w)} x ${L(p.h)})` : ''}${sh.side === 'back' ? '  mirrored, to lie on the back of the body' : ''}`);
    for (const l of sh.features) lines.push(`      ${l}`);
  }
  if (templates.problems.length) { lines.push('', 'PROBLEMS'); templates.problems.forEach((p) => lines.push('  ' + p)); }
  lines.push('', 'Black Chapel Studios. blackchapelstudios.com', '');
  return lines.join('\r\n');
}

export default function TemplatesView({ design, toast }) {
  const { templates, prep } = useMemo(() => buildPack(design), [design]);
  const wrap = useRef(null), svgRef = useRef(null);
  const size = useSize(wrap);
  const [busy, setBusy] = useState('');
  const [vb, setVb] = useState(null);
  const full = { x: 0, y: 0, w: prep.width, h: prep.height };
  const box = vb || full;
  useEffect(() => { setVb(null); }, [prep.width, prep.height]);
  const drag = useRef(null);
  const base = slug(design.name);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const wheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setVb((cur) => {
        const b = cur || { x: 0, y: 0, w: prep.width, h: prep.height };
        const scale = Math.min(r.width / b.w, r.height / b.h);
        const ox = (r.width - b.w * scale) / 2, oy = (r.height - b.h * scale) / 2;
        const px = b.x + (e.clientX - r.left - ox) / scale, py = b.y + (e.clientY - r.top - oy) / scale;
        const k = Math.exp(e.deltaY * 0.0015), w = Math.max(20, Math.min(prep.width * 1.5, b.w * k)), f = w / b.w;
        return { x: px - (px - b.x) * f, y: py - (py - b.y) * f, w, h: b.h * f };
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [prep.width, prep.height]);

  const run = async (label, fn) => {
    setBusy(label);
    await new Promise((r) => setTimeout(r, 30));
    try { const res = await fn(); toast(res.message); } catch (e) { toast('Could not build that file: ' + (e && e.message ? e.message : 'unknown error')); }
    setBusy('');
  };
  const meta = { title: `${design.name}: routing templates`, desc: 'Black Chapel Studios Guitar Designer. Units: millimeters, true size.' };
  const pack = () => run('pack', () => {
    const files = [
      { name: 'README.txt', data: readme(design, templates, prep) },
      { name: `${base}-templates.dxf`, data: toDXF(prep) },
      { name: `${base}-templates.svg`, data: toSVG(prep, meta) },
      { name: `${base}-templates-letter.pdf`, data: toPDF(prep, { paper: 'letter', title: design.name }).data },
      { name: `${base}-templates-a4.pdf`, data: toPDF(prep, { paper: 'a4', title: design.name }).data },
      { name: `${base}.guitar.json`, data: JSON.stringify(design, null, 1) },
    ];
    return saveFile(`${base}-template-pack.zip`, new Blob([makeZip(files)], { type: 'application/zip' }));
  });

  const scaleNow = size.w ? Math.min(size.w / box.w, Math.max(1, size.h - HINT) / box.h) : 1;
  return (
    <div className="tview">
      <div className="sheetwrap" ref={wrap}>
        <svg ref={svgRef} className="draw" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Template sheets preview"
          style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: `calc(100% - ${HINT}px)`, cursor: 'grab' }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, b: box }; }}
          onPointerMove={(e) => { const d = drag.current; if (!d) return; setVb({ ...d.b, x: d.b.x - (e.clientX - d.x) / scaleNow, y: d.b.y - (e.clientY - d.y) / scaleNow }); }}
          onPointerUp={() => { drag.current = null; }} onDoubleClick={() => setVb(null)}>
          {prep.sheets.map((s) => (
            <g key={s.id}>
              {LAYERS.map((L) => s.paths.filter((p) => p.layer === L.name).map((p, i) => (
                <path key={L.name + i} d={pathData(p.verts, p.closed, prep.height)} fill={L.name === 'CUT_OUTSIDE' ? 'rgba(237,230,216,.045)' : L.name === 'CUT_INSIDE' ? 'var(--forge)' : 'none'}
                  stroke={COLORS[L.name]} strokeWidth={L.name === 'ENGRAVE' ? 0.9 : 1.4} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              )))}
              <text x={s.x + s.w / 2} y={prep.height - 2.5} textAnchor="middle" fontSize="5.5" fill="var(--bone-dim)" fontFamily="var(--font)">{s.name}</text>
            </g>
          ))}
        </svg>
        <div className="hintline"><span>Drag to pan · scroll to zoom · double-click to fit</span><span>Shown at the size they will cut. Back sheets are mirrored.</span></div>
      </div>
      <div className="tbar">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn primary" disabled={!!busy} onClick={pack}>{busy === 'pack' ? 'Building…' : 'Save template pack (.zip)'}</button>
          <button className="btn" disabled={!!busy} onClick={() => run('svg', () => saveFile(`${base}-templates.svg`, toSVG(prep, meta)))}>SVG</button>
          <button className="btn" disabled={!!busy} onClick={() => run('pdf', () => saveFile(`${base}-templates-letter.pdf`, new Blob([toPDF(prep, { paper: 'letter', title: design.name }).data], { type: 'application/pdf' })))}>PDF, Letter</button>
          <button className="btn" disabled={!!busy} onClick={() => run('pdfa4', () => saveFile(`${base}-templates-a4.pdf`, new Blob([toPDF(prep, { paper: 'a4', title: design.name }).data], { type: 'application/pdf' })))}>PDF, A4</button>
          {!inViewer() && <button className="btn" disabled={!!busy} onClick={() => run('dxf', () => saveFile(`${base}-templates.dxf`, toDXF(prep)))}>DXF</button>}
        </div>
        <div className="legendkey">
          <span><i style={{ background: 'var(--torch)' }} />Cut last: template outline</span>
          <span><i style={{ background: 'var(--ghost)' }} />Cut first: openings and holes</span>
          <span><i style={{ background: 'var(--bone-dim)' }} />Engrave: centerline, labels, scale bar</span>
        </div>
        <div style={{ flexBasis: '100%', color: 'var(--bone-dim)', fontSize: 11.5, lineHeight: 1.55 }}>
          {prep.sheets.map((s) => `${s.name}: ${fmtWithUnit(s.w, design.units)} × ${fmtWithUnit(s.h, design.units)}`).join('   ·   ')}
          {inViewer() && <span> · The pack holds the DXF, SVG, both PDFs, a read-me and the design file.</span>}
          {templates.problems.map((p, i) => <div key={i} style={{ color: 'var(--torch)' }}>{p}</div>)}
          {templates.unverified.length > 0 && <div style={{ color: 'var(--brass)' }}>{templates.unverified.length} neck {templates.unverified.length === 1 ? 'dimension is' : 'dimensions are'} still unconfirmed and will be engraved as CHECK notes. Confirm them under Build checks.</div>}
        </div>
      </div>
    </div>
  );
}
