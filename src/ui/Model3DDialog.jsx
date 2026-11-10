// "Save a 3D model": builds the body as a true CAD solid and saves it as a STEP file (the exact
// solid) or an STL file (a fine mesh of the same solid, for programs that do not read STEP).
import React, { useMemo, useState } from 'react';
import { derive } from '../model/derive.js';
import { buildBodySolid, holesLeftOut, toSTEP, toSTL, STL_TOLERANCE } from '../export/step.js';
import { loadCadEngine } from './cadEngine.js';
import { saveFile, slug, inViewer } from './files.js';
import { fmtWithUnit } from '../core/units.js';
import { Dialog, Check, Seg } from './widgets.jsx';

const mm = (v) => `${+v.toFixed(2)} mm`;

export default function Model3DDialog({ design, onClose, toast }) {
  const g = useMemo(() => derive(design, { tol: 0.005 }), [design]);
  const [roll, setRoll] = useState(true);
  const [kind, setKind] = useState('step'); // 'step' or 'stl'
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null); // { ok, message }
  const T = design.body.thickness, u = design.units;
  const both = (v) => (u === 'mm' ? mm(v) : `${mm(v)} (${fmtWithUnit(v, u)})`);
  const rT = Math.max(0, Math.min(design.body.roundTop || 0, T / 2 - 0.5)), rB = Math.max(0, Math.min(design.body.roundBack || 0, T / 2 - 0.5));
  const hasRound = rT > 0.05 || rB > 0.05;
  const pockets = g.cuts.filter((c) => Math.min(c.depth, T) > 0);
  const through = g.holes.filter((h) => h.side === 'through');
  const left = holesLeftOut(g);
  const arm = design.contours.arm.on, belly = design.contours.belly.on;

  const save = async () => {
    setResult(null);
    const paint = () => new Promise((r) => setTimeout(r, 60));
    try {
      setBusy('Fetching the 3D engine…');
      let cad;
      try { cad = await loadCadEngine(); } catch (e) { throw new Error('The 3D engine could not be fetched. Check your connection and try again.'); }
      setBusy('Building the model…');
      await paint();
      let built;
      try { built = buildBodySolid(cad.rc, cad.oc, design, g, { roundovers: roll }); } catch (e) {
        throw new Error(e instanceof Error && e.message ? e.message : 'The 3D model could not be built from this design.');
      }
      const blob = kind === 'stl'
        ? new Blob([toSTL(built.shape).data], { type: 'model/stl' })
        : new Blob([await toSTEP(cad.rc, built.shape, `${design.name} body`)], { type: 'model/step' });
      try { built.shape.delete(); } catch (e) { /* already released */ }
      const res = await saveFile(`${slug(design.name)}-body.${kind}`, blob);
      setResult(res);
      toast(res.message);
    } catch (e) {
      setResult({ ok: false, message: e.message });
    }
    setBusy('');
  };

  return (
    <Dialog title="Save a 3D model of the body" onClose={onClose}>
      <p>This saves the body as a 3D model for CAD and CAM programs. It is the body only. The neck and hardware in the 3D view are shown for looks and are not in the file.</p>

      <div style={{ margin: '12px 0 4px' }}>
        <Seg label="File type" value={kind} onChange={setKind} options={[{ value: 'step', label: 'STEP' }, { value: 'stl', label: 'STL' }]} />
        <p className="note">{kind === 'step'
          ? 'STEP holds the exact solid, with true curves. Fusion and most CAD programs open it. Vectric Aspire does not.'
          : `STL holds the same solid as a mesh of small flat facets that stay within ${STL_TOLERANCE} mm of the true surface. Vectric Aspire and 3D printing programs open it. An STL file does not record its units: this one is in millimeters, so choose millimeters if the program asks.`}</p>
      </div>

      <h4>In the file</h4>
      <ul className="plain">
        <li>The body outline with its true curves, {both(T)} thick.</li>
        {hasRound && (roll
          ? <li>Edge roundovers rolled around the outline{rT > 0.05 ? `, top ${both(rT)}` : ''}{rB > 0.05 ? `, back ${both(rB)}` : ''}.</li>
          : <li>Square edges. The roundovers are left for you to rout by hand.</li>)}
        {arm && <li>The arm bevel, as a flat cut.</li>}
        {belly && <li>The belly cut, as a smooth dish.</li>}
        <li>{pockets.length} {pockets.length === 1 ? 'pocket' : 'pockets'} with upright walls, flat floors and true rounded corners: {pockets.map((c) => c.label).join(', ')}.</li>
        <li>{through.length} round {through.length === 1 ? 'hole' : 'holes'} that go right through the body.</li>
      </ul>

      <h4>Not in the file</h4>
      <ul className="plain">
        {left.map((l) => <li key={l.what}>{l.what} ({l.count}). The design does not say how deep these go, so they are not drilled in the model. Mark them from the 2D templates.</li>)}
        <li>The neck, frets, bridge, pickups and knobs.</li>
      </ul>

      <h4>How the model sits</h4>
      <p>Everything is in millimeters. The back of the body lies at height 0 and the top at {mm(T)}. The centerline is x = 0 and the scale line is y = 0, the same as on the templates. After you open the file, measure the model: it should be {mm(g.bbox.w)} wide, {mm(g.bbox.h)} long and {mm(T)} thick.</p>

      {hasRound && (
        <div style={{ margin: '14px 0 4px' }}>
          <Check checked={roll} onChange={setRoll}>Roll the edge roundovers into the model</Check>
          <p className="note">Untick this to leave the edges square and round them over by hand after the body is cut. A roundover larger than the tightest outside curve of the outline cannot be rolled into the model yet.</p>
        </div>
      )}

      <p className="note" style={{ color: 'var(--brass)' }}>{kind === 'step'
        ? 'Checked so far: a STEP file from here opened in a 3D printing program at the right size. It has not been opened in Fusion or a CAM program, and nothing has been cut from it. Make a test cut in scrap first.'
        : 'Not yet checked in the real world: an STL file from here has not been opened in Vectric Aspire or any other program, and nothing has been cut from it. Make a test cut in scrap first.'}</p>

      {inViewer() ? (
        <p className="note"><b>Saving a 3D model does not work inside claude.ai.</b> Use the copy of the Guitar Designer on the Black Chapel site.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn primary" disabled={!!busy} onClick={save}>{busy || `Save 3D model (.${kind})`}</button>
            {result && <span role="status" style={{ color: result.ok ? 'var(--bone)' : 'var(--torch)', fontSize: 12.5, flex: '1 1 260px' }}>{result.message}</span>}
          </div>
          <p className="note">The first save fetches the 3D engine, a download of about 7 MB. After that, building the model takes a few seconds, and the page does not respond while it works.</p>
        </>
      )}
    </Dialog>
  );
}
