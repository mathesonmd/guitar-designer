// "Save files for CNC": the 2D vectors for pockets and holes, and the 3D model. It builds the body as a true CAD solid and saves it as a STEP file (the exact
// solid) or an STL file (a fine mesh of the same solid, for programs that do not read STEP).
import React, { useMemo, useState } from 'react';
import { derive } from '../model/derive.js';
import { buildBodySolid, buildNeckSolid, holesLeftOut, toSTEP, toSTL, STL_TOLERANCE } from '../export/step.js';
import { buildCncVectors, cncDXF, cncReadme } from '../export/cnc.js';
import { makeZip } from '../export/zip.js';
import { loadCadEngine } from './cadEngine.js';
import { saveFile, slug, inViewer } from './files.js';
import { fmtWithUnit } from '../core/units.js';
import { edgeRounds } from '../model/design.js';
import { bevelPlane, bellyDish, buildLayers } from '../model/solid.js';
import { Dialog, Check, Seg } from './widgets.jsx';

const mm = (v) => `${+v.toFixed(2)} mm`;

export default function Model3DDialog({ design, onClose, toast }) {
  const g = useMemo(() => derive(design, { tol: 0.005 }), [design]);
  const [roll, setRoll] = useState(true);
  const [kind, setKind] = useState('step'); // 'step' or 'stl'
  const [withPockets, setWithPockets] = useState(true);
  const [vecResult, setVecResult] = useState(null);
  const [fileUnits, setFileUnits] = useState(design.units === 'mm' ? 'mm' : 'in');
  const vectors = useMemo(() => buildCncVectors(design, g, { units: fileUnits }), [design, g, fileUnits]);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState(null); // { ok, message }
  const T = design.body.thickness, u = design.units;
  const both = (v) => (u === 'mm' ? mm(v) : `${mm(v)} (${fmtWithUnit(v, u)})`);
  const { top: rT, back: rB } = edgeRounds(design);
  const size = (v) => (fileUnits === 'in' ? `${(v / 25.4).toFixed(3)} in` : mm(v));
  const hasRound = rT > 0.05 || rB > 0.05;
  const pockets = g.cuts.filter((c) => Math.min(c.depth, T) > 0);
  const through = g.holes.filter((h) => h.side === 'through');
  const left = holesLeftOut(g);
  const arm = bevelPlane(design.contours.arm, g.outline, g.centroid, T - 3), belly = bellyDish(design.contours.belly, T - 3);

  const [neckBusy, setNeckBusy] = useState('');
  const [neckResult, setNeckResult] = useState(null);
  const saveNeck = async () => {
    setNeckResult(null);
    try {
      setNeckBusy('Fetching the 3D engine…');
      let cad;
      try { cad = await loadCadEngine(); } catch (e) { throw new Error('The 3D engine could not be fetched. Check your connection and try again.'); }
      setNeckBusy('Building the neck…');
      await new Promise((r) => setTimeout(r, 60));
      const built = buildNeckSolid(cad.rc, cad.oc, g.neck, { expectVolume: g.neck.volume });
      const blob = kind === 'stl'
        ? new Blob([toSTL(built.shape, { units: fileUnits }).data], { type: 'model/stl' })
        : new Blob([await toSTEP(cad.rc, built.shape, `${design.name} neck`)], { type: 'model/step' });
      try { built.shape.delete(); } catch (e) { /* already released */ }
      const res = await saveFile(`${slug(design.name)}-neck.${kind}`, blob);
      setNeckResult(res);
      toast(res.message);
    } catch (e) {
      setNeckResult({ ok: false, message: e instanceof Error && e.message ? e.message : 'The neck could not be built from this design.' });
    }
    setNeckBusy('');
  };

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
      // the sliced solid of the very same body (same choices, no purfling channel) says what volume to expect
      const same = { ...design, body: { ...design.body, roundTopOn: roll && design.body.roundTopOn !== false, roundBackOn: roll && design.body.roundBackOn !== false } };
      // (holes with no depth entered are drilled a nominal depth in the 3D picture only, so they are left out here too)
      const expectVolume = buildLayers(same, { ...g, purfling: null, cuts: withPockets ? g.cuts : [], holes: withPockets ? g.holes.filter((h) => h.side === 'through' || h.depth > 0) : [] }).volume;
      try { built = buildBodySolid(cad.rc, cad.oc, design, g, { roundovers: roll, pockets: withPockets, expectVolume }); } catch (e) {
        throw new Error(e instanceof Error && e.message ? e.message : 'The 3D model could not be built from this design.');
      }
      const blob = kind === 'stl'
        ? new Blob([toSTL(built.shape, { units: fileUnits }).data], { type: 'model/stl' })
        : new Blob([await toSTEP(cad.rc, built.shape, `${design.name} body`)], { type: 'model/step' });
      try { built.shape.delete(); } catch (e) { /* already released */ }
      const res = await saveFile(`${slug(design.name)}-body.${kind}`, blob);
      if (res.ok && built.bevelStrips) res.message += ' The rolled edge bevel was built from 8 flat strips, within a few hundredths of a millimeter of the curve, because the engine could not cut the smooth version on this body.';
      setResult(res);
      toast(res.message);
    } catch (e) {
      setResult({ ok: false, message: e.message });
    }
    setBusy('');
  };

  const saveVectors = async () => {
    const base = slug(design.name);
    const names = vectors.files.map((f) => `${base}-cnc-${f.side}.dxf`);
    const files = [{ name: 'READ-ME.txt', data: cncReadme(design, vectors, names) }, ...vectors.files.map((f, i) => ({ name: names[i], data: cncDXF(f, fileUnits) }))];
    const res = await saveFile(`${base}-cnc-vectors.zip`, new Blob([makeZip(files)], { type: 'application/zip' }));
    setVecResult(res);
    toast(res.message);
  };
  const cutLayers = vectors.files.reduce((n, f) => n + f.layers.filter((L) => !/^(BODY_OUTLINE|GUIDE_)/.test(L.name)).length, 0);

  return (
    <Dialog title="Save files for CNC" onClose={onClose}>
      <div style={{ margin: '12px 0 0' }}>
        <Seg label="Units in the files" value={fileUnits} onChange={setFileUnits} options={[{ value: 'mm', label: 'Millimeters' }, { value: 'in', label: 'Inches' }]} />
        <p className="note">The vectors (DXF) and the STL model are written in {fileUnits === 'in' ? 'inches' : 'millimeters'}, and layer names give depths the same way. Set your CAM job to the same unit. A STEP model is always in millimeters and says so inside the file, so programs read it at the right size either way.</p>
      </div>

      <h4>2D vectors for pockets and holes</h4>
      <p>Every pocket and hole as a 2D outline at its finished edge and true position, for pocketing and drilling in your CAM program. No bit or template offsets are built in. {vectors.files.length > 1 ? 'There is one DXF file for the top and one for the back; the back file is mirrored across the centerline, as the body looks once it is turned over.' : 'Nothing in this design is cut from the back, so there is one DXF file, for the top.'} Each of the {cutLayers} cutting layers is named for what it is and how deep it goes, and a read-me lists them all.</p>
      <p className="note">Holes with no depth entered are in the vectors as circles, on layers marked DEPTH_TO_SUIT. Enter their depths under Bridge and strings. {vectors.pocketOverrun > 0
        ? `The neck pocket runs ${size(vectors.pocketOverrun)} above the body outline’s box, so line the vectors up with the 3D model by the body outline, not by centering both.`
        : 'Nothing in the vectors reaches outside the body outline’s box, which is also the 3D model’s box, so centering both in your CAM program puts them in register.'}</p>
      <p className="note" style={{ color: 'var(--brass)' }}>Checked so far: millimeter vector files from here opened in Vectric Aspire 12.5 with their layers and true circles. {fileUnits === 'in' ? 'Inch files have not been opened in any program. ' : ''}Nothing has been cut from them.</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        <button className="btn primary" onClick={saveVectors}>Save CNC vectors (.zip)</button>
        {vecResult && <span role="status" style={{ color: vecResult.ok ? 'var(--bone)' : 'var(--torch)', fontSize: 12.5 }}>{vecResult.message}</span>}
      </div>

      <h4>3D model of the body</h4>
      <p>The body as a 3D model for CAD and CAM programs. It is the body only. The neck and hardware in the 3D view are shown for looks and are not in the file.</p>

      <div style={{ margin: '12px 0 4px' }}>
        <Seg label="File type" value={kind} onChange={setKind} options={[{ value: 'step', label: 'STEP' }, { value: 'stl', label: 'STL' }]} />
        <p className="note">{kind === 'step'
          ? 'STEP holds the exact solid, with true curves. Fusion and most CAD programs open it. Vectric Aspire does not.'
          : `STL holds the same solid as a mesh of small flat facets that stay within ${STL_TOLERANCE} mm of the true surface. Vectric Aspire and 3D printing programs open it. An STL file does not record its units: this one is in ${fileUnits === 'in' ? 'inches' : 'millimeters'}, so choose ${fileUnits === 'in' ? 'inches' : 'millimeters'} if the program asks.`}</p>
      </div>

      <div style={{ margin: '10px 0 4px' }}>
        <Check checked={withPockets} onChange={setWithPockets}>Put the pockets and holes in the 3D model</Check>
        <p className="note">Untick this to leave them out of the model and cut them from the 2D vectors above. The model then carries only the outline and the contours.</p>
      </div>

      <h4>In the 3D file</h4>
      <ul className="plain">
        <li>The body outline with its true curves, {both(T)} thick.</li>
        {hasRound && (roll
          ? <li>Edge roundovers rolled around the outline{rT > 0.05 ? `, top ${both(rT)}` : ''}{rB > 0.05 ? `, back ${both(rB)}` : ''}.</li>
          : <li>Square edges. The roundovers are left for you to rout by hand.</li>)}
        {g.bevelEdge && g.bevelEdge.deepest > 0 && <li>The bevel around the top edge, {g.bevelEdge.roll > 0 ? `rolled ${Math.round(g.bevelEdge.roll * 100)}%` : 'flat'}, from the inner line you shaped down to as much as {both(g.bevelEdge.deepest)} at the body edge{g.bevelEdge.handles.some((h) => h.width < 0.05) ? ', tapering to nothing where you set it to' : ''}.</li>}
        {g.binding && <li>The binding channel around the top edge, {both(g.binding.width)} wide and {both(g.binding.depth)} deep.</li>}
        {arm && <li>The arm bevel, {arm.roll >= 0.99 ? 'rolled so it leaves the top with no crease' : arm.crown > 0 ? 'as a curved cut' : 'as a flat cut'}{arm.blend > 0 ? ', with its crease rounded' : ''}{arm.bounded ? (arm.fade > 0 ? ', running out to nothing at each end of its line' : ', stopping square at each end of its line') : ', straight along its line right across the body'}.</li>}
        {belly && <li>The belly cut, as a shallow cone{belly.blend > 0 ? ' with a rounded rim' : ' with a sharp rim'}.</li>}
        {withPockets && <li>{pockets.length} {pockets.length === 1 ? 'pocket' : 'pockets'} with upright walls, flat floors and true rounded corners: {pockets.map((c) => c.label).join(', ')}.</li>}
        {withPockets && <li>{through.length} round {through.length === 1 ? 'hole' : 'holes'} that go right through the body.</li>}
      </ul>

      <h4>Not in the 3D file</h4>
      <ul className="plain">
        {!withPockets && <li>Pockets and holes. Cut them from the 2D vectors.</li>}
        {g.purfling && <li>The purfling channel. It cannot yet be cut reliably into the 3D model along the bevel’s crease. Cut it from the 2D vectors, where it has its own layer.</li>}
        {withPockets && left.map((l) => <li key={l.what}>{l.what} ({l.count}). No depth has been entered for these, so they are not drilled in the model. Enter one under Bridge and strings, or mark them from the 2D vectors.</li>)}
        <li>The neck, frets, bridge, pickups and knobs.</li>
      </ul>

      <h4>How the model sits</h4>
      <p>The back of the body lies at height 0 and the top at {both(T)}. The centerline is x = 0 and the scale line is y = 0, the same as in the vectors. After you open the file, measure the model: it should be {both(g.bbox.w)} wide, {both(g.bbox.h)} long and {both(T)} thick.</p>

      {hasRound && (
        <div style={{ margin: '14px 0 4px' }}>
          <Check checked={roll} onChange={setRoll}>Roll the edge roundovers into the model</Check>
          <p className="note">Untick this to leave the edges square and round them over by hand after the body is cut. A roundover larger than the tightest outside curve of the outline cannot be rolled into the model yet.</p>
        </div>
      )}

      <p className="note" style={{ color: 'var(--brass)' }}>{kind === 'step'
        ? 'Checked so far: a STEP file from here opened in a 3D printing program at the right size. It has not been opened in Fusion or a CAM program, and nothing has been cut from it. Make a test cut in scrap first.'
        : `Checked so far: a millimeter STL from here opened in Vectric Aspire 12.5 at the right size.${fileUnits === 'in' ? ' An inch STL has not been opened in any program.' : ''} Nothing has been cut from it. Make a test cut in scrap first.`}</p>

      {inViewer() ? (
        <p className="note"><b>Saving a 3D model does not work inside claude.ai.</b> Use the copy of the Guitar Designer on the Black Chapel site.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn primary" disabled={!!busy} onClick={save}>{busy || `Save 3D model (.${kind})`}</button>
            {result && <span role="status" style={{ color: result.ok ? 'var(--bone)' : 'var(--torch)', fontSize: 12.5, flex: '1 1 260px' }}>{result.message}</span>}
          </div>
          <p className="note">The first save fetches the 3D engine, a download of about 7 MB. After that, building the model takes a few seconds, and the page does not respond while it works. If a save fails that worked earlier in the same visit, reload the page and try again: after many models the 3D engine can run short of memory.</p>
        </>
      )}
      {g.neck && (
        <>
          <h4>3D model of the neck</h4>
          <p>The neck’s shaft and heel, as a {kind === 'stl' ? 'mesh (STL)' : 'solid (STEP)'} in the file type chosen above. It sits where it belongs in the pocket, in the same position as the body model, so the two fit together when both are opened.</p>
          <ul className="plain">
            <li>A flat top, where the fretboard is glued. The fretboard and frets are not part of it.</li>
            <li>The back: {both(g.neck.d1)} of wood at the 1st fret and {both(g.neck.d12)} at the 12th, blending over {both(g.neck.blend)} into the heel.</li>
            <li>The heel: a block {both(g.neck.heelDepth)} deep with the pocket’s own outline. It is {both(g.neck.length)} from the nut to the end of the heel.</li>
          </ul>
          <p className="note"><b>Not in the file:</b> the headstock and volute, the truss rod channel, and the heel’s screw holes. The neck ends square at the nut.</p>
          <p className="note" style={{ color: 'var(--brass)' }}>Not yet checked in the real world: a neck file from here has not been opened in any program, and nothing has been cut from it. The shape of the back is a starting curve with no published source: compare it with a neck you like before cutting.</p>
          {inViewer() ? null : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
              <button className="btn primary" disabled={!!neckBusy || !!busy} onClick={saveNeck}>{neckBusy || `Save neck model (.${kind})`}</button>
              {neckResult && <span role="status" data-k="neck-status" style={{ color: neckResult.ok ? 'var(--bone)' : 'var(--torch)', fontSize: 12.5, flex: '1 1 260px' }}>{neckResult.message}</span>}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
