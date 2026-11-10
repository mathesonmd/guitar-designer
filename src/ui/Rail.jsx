import React from 'react';
import { Acc, Check } from './widgets.jsx';
import { fmtWithUnit, fmtLen, unitLabel } from '../core/units.js';

const ORDER = { warn: 0, note: 1, ok: 2 };

export default function Rail({ design, g, solid, findings, onGo, onVerify, show, setShow, checking }) {
  const u = design.units;
  const list = findings.slice().sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const count = (l) => findings.filter((f) => f.level === l).length;
  const last = g.frets[g.frets.length - 1];
  const edge = last ? last.half - Math.max(Math.abs(g.stringXAt(0, last.y)), Math.abs(g.stringXAt(g.strings.length - 1, last.y))) : null;
  const fret = (j) => (j ? `fret ${j.fret.toFixed(1)}` : 'not on body');
  return (
    <aside className="rail" aria-label="Checks and measurements">
      <Acc id="checks" title="Build checks" hint={checking ? 'checking…' : ''} defaultOpen>
        <div className="tally" aria-live="polite">
          <span className="w"><b>{count('warn')}</b> to fix</span><span className="n"><b>{count('note')}</b> to confirm</span><span className="o"><b>{count('ok')}</b> good</span>
        </div>
        <div style={{ marginTop: 8 }}>
          {list.map((f, i) => (
            <div className={'find ' + f.level} key={i}>
              <span className="dot" aria-hidden="true" />
              <div className="tx">
                <button type="button" className="go" onClick={() => onGo(f)} aria-label={`${f.title}. Show on the drawing.`}>
                  <div className="ti">{f.title}</div>
                </button>
                <div className="de">{f.detail}</div>
                {f.verify && <div style={{ marginTop: 6 }}><Check checked={false} onChange={() => onVerify(f.verify)}>I measured it and it matches</Check></div>}
              </div>
            </div>
          ))}
        </div>
      </Acc>

      <Acc id="measure" title="Measurements" hint="" defaultOpen>
        <dl className="kv">
          <dt>Body length</dt><dd>{fmtWithUnit(g.bbox.h, u)}</dd>
          <dt>Body width</dt><dd>{fmtWithUnit(g.bbox.w, u)}</dd>
          <dt>Pocket end to scale line</dt><dd>{fmtWithUnit(g.heelY, u)}</dd>
          <dt>Body meets neck, treble</dt><dd>{fret(g.join.treble)}</dd>
          <dt>Body meets neck, bass</dt><dd>{fret(g.join.bass)}</dd>
          <dt>Strings at the saddles</dt><dd>{fmtWithUnit(g.saddleSpread, u)}</dd>
          {edge !== null && <><dt>String to board edge, last fret</dt><dd>{fmtWithUnit(edge, u)}</dd></>}
          {solid && <>
            <dt>Body weight (estimate)</dt><dd>{(solid.mass * 2.20462).toFixed(2)} lb</dd>
            <dt>Body balance point</dt><dd>{fmtLen(solid.center.y, u)} {unitLabel(u)} above scale line</dd>
          </>}
        </dl>
        <p className="note">Weight is the body alone: slice volume times the wood’s average density. Neck and hardware are not included yet.</p>
      </Acc>

      <Acc id="show" title="Show" hint="">
        {[['ghost', 'Reference outlines'], ['neck', 'Neck, frets and strings'], ['hardware', 'Bridge and pickup bodies'], ['cavities', 'Cavities'], ['marks', 'Problem markers'], ['grid', 'Grid']].map(([k, label]) => (
          <div className="row" key={k}><Check checked={show[k]} onChange={(v) => setShow({ ...show, [k]: v })}>{label}</Check></div>
        ))}
        <p className="note">Dashed shapes are cut from the back. The red line is the scale line: one scale length from the nut.</p>
      </Acc>
    </aside>
  );
}
