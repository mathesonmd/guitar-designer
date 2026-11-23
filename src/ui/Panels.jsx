import React, { useRef } from 'react';
import { Len, Num, Seg, Check, Row, Acc, Basis } from './widgets.jsx';
import { NECK_PRESETS, NECK_FIELDS } from '../data/necks.js';
import { BRIDGES, HOLE_DEPTH_GROUPS } from '../data/bridges.js';
import { PICKUPS } from '../data/pickups.js';
import { WOODS, BITS, BUSHINGS, BUSHING_LABELS, CONTROL_KINDS, CONTROL_NOTE } from '../data/parts.js';
import { TUNER_START, TUNER_LAYOUTS } from '../data/neckprofiles.js';
import { TRUSS_START, NUT_START } from '../model/truss.js';
import { applyNeckPreset, makeBridge, makePickup, makeControl, makeCavity, neckBasis, makeNeckBack, makeHeadstock, makeSideLine, makeTongueLine, seatOnPocket } from '../model/design.js';
import { NECK_PROFILES, NECK_PROFILE_BASIS } from '../data/neckprofiles.js';
import { setSymmetric, storedIndex } from '../core/path.js';
import { fmtWithUnit, fmtLen, unitLabel } from '../core/units.js';
import { toolOffset, defaultRegHoles } from '../model/templates.js';
import { bevelPlane, bellyDish } from '../model/solid.js';

const DEG = 180 / Math.PI;

export default function Panels({ design, g, sel, setSel, change, onStarter, onAddGhost, onTraceGhost, onImportFretboard, solid }) {
  const u = design.units;
  const fileRef = useRef(null), fbRef = useRef(null);
  // change(fn) records one undo step
  const set = (key, patch) => change((d) => ({ ...d, [key]: { ...d[key], ...patch } }));
  const setItem = (key, id, patch) => change((d) => ({ ...d, [key]: d[key].map((q) => (q.id === id ? { ...q, ...patch } : q)) }));
  const delItem = (key, id) => { change((d) => ({ ...d, [key]: d[key].filter((q) => q.id !== id) })); setSel(null); };
  const nk = design.neck, preset = NECK_PRESETS[nk.preset] || NECK_PRESETS.custom;
  const verified = design.verified || {};
  // (a change to the neck can move the pocket's edges: the body's corners at the pocket go with them)
  const setNeck = (k, v) => change((d) => { const neck = { ...d.neck, [k]: v }; return { ...d, neck, outline: seatOnPocket(d.outline, neck) }; });
  const bdef = BRIDGES[design.bridge.type];
  const tool = design.tooling;
  const setTool = (which, patch) => change((d) => ({ ...d, tooling: { ...d.tooling, [which]: { ...d.tooling[which], ...patch } } }));

  const basisFor = (key) => {
    const b = neckBasis(design, key);
    return b ? <Basis kind={b[0]} text={b[2]} src={b[1]} /> : null;
  };

  // plain function (not a component) so the fields keep focus while typing
  const toolRows = (which, label) => {
    const t = tool[which];
    const off = toolOffset(t);
    return (
      <>
        <Row label={label} wide>
          <Seg wide label={label} value={t.mode} onChange={(v) => setTool(which, { mode: v })} options={[{ value: 'bearing', label: 'Bearing-guided bit' }, { value: 'bushing', label: 'Guide bushing' }]} />
        </Row>
        <Row label="Bit diameter" htmlFor={`bit-${which}`}>
          <select aria-label="Common bit sizes" value="" onChange={(e) => e.target.value && setTool(which, { bit: +e.target.value })} style={{ width: 28, padding: '6px 2px' }}>
            <option value="">…</option>{BITS.map((b) => <option key={b.label} value={b.mm}>{b.label}</option>)}
          </select>
          <Len id={`bit-${which}`} units={u} value={t.bit} min={1} max={40} onChange={(v) => setTool(which, { bit: v })} />
        </Row>
        {t.mode === 'bushing' && (
          <>
            <Row label="Bushing outside diameter" htmlFor={`bush-${which}`} basis={<Basis kind="published" text="Sizes in the common Porter-Cable-style sets: 5/16, 3/8, 7/16, 1/2, 5/8, 3/4 and 51/64 in. Measure yours; they vary slightly." src="amana" />}>
              <select aria-label="Common bushing sizes" value="" onChange={(e) => e.target.value && setTool(which, { bushing: +e.target.value })} style={{ width: 28, padding: '6px 2px' }}>
                <option value="">…</option>{BUSHINGS.map((b, i) => <option key={i} value={b.mm}>{BUSHING_LABELS[i]} in</option>)}
              </select>
              <Len id={`bush-${which}`} units={u} value={t.bushing} min={2} max={60} onChange={(v) => setTool(which, { bushing: v })} />
            </Row>
            <p className="note">{off > 0
              ? <>Template edge sits <b>{fmtWithUnit(off, u)}</b> {which === 'outline' ? 'inside the body outline' : 'outside each cavity'}: (bushing − bit) ÷ 2.</>
              : <b style={{ color: 'var(--torch)' }}>The bushing must be larger than the bit.</b>}</p>
          </>
        )}
        {t.mode === 'bearing' && <p className="note">Template edge is the finished edge. Inside corners can be no tighter than the bit’s radius ({fmtWithUnit(t.bit / 2, u)}).</p>}
      </>
    );
  };

  return (
    <aside className="panel" aria-label="Design controls">
      <Acc id="shape" title="Body shape" hint={`${fmtLen(g.bbox.h, u)} × ${fmtLen(g.bbox.w, u)} ${unitLabel(u)}`} defaultOpen>
        <Row label="Start from a shape"><button className="btn small" onClick={onStarter}>Choose…</button></Row>
        <Row label="">
          <Check id="sym" checked={design.outline.symmetric} onChange={(v) => change((d) => ({ ...d, outline: setSymmetric(d.outline, v) }))}>Mirror left and right</Check>
        </Row>
        <p className="note">Click the outline to show its points. Drag a point or its handles; double-click the line to add a point. Everything else stays put while you reshape.</p>
        <h4 style={{ margin: '14px 0 2px', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--bone-dim)' }}>Reference outlines</h4>
        {design.ghosts.map((gh) => (
          <div className="card" key={gh.id}>
            <div className="head">
              <Check checked={gh.visible !== false} onChange={(v) => setItem('ghosts', gh.id, { visible: v })}><span className="t">{gh.name}</span></Check>
              <span style={{ flex: 1 }} />
              <input type="range" min="0.1" max="1" step="0.05" aria-label={`${gh.name} opacity`} value={gh.opacity ?? 0.6} onChange={(e) => setItem('ghosts', gh.id, { opacity: +e.target.value })} style={{ width: 64 }} />
              <button className="x" aria-label={`Remove ${gh.name}`} onClick={() => delItem('ghosts', gh.id)}>×</button>
            </div>
            {gh.image && (
              <div className="body">
                <Row label="Image width" htmlFor={`gw-${gh.id}`}><Len id={`gw-${gh.id}`} units={u} value={gh.w} min={10} max={3000} onChange={(v) => setItem('ghosts', gh.id, { w: v })} /></Row>
                <Row label="Across"><Len units={u} value={gh.x || 0} onChange={(v) => setItem('ghosts', gh.id, { x: v })} /></Row>
                <Row label="Along"><Len units={u} value={gh.y || 0} onChange={(v) => setItem('ghosts', gh.id, { y: v })} /></Row>
                <Row label="Rotation"><Num value={gh.rot || 0} step={0.5} digits={1} suffix="°" min={-180} max={180} onChange={(v) => setItem('ghosts', gh.id, { rot: v })} /></Row>
                <p className="note">Set the width to the real size of what the photo shows, then line it up with the centerline.</p>
              </div>
            )}
            {!gh.image && <div className="body"><button className="btn small" style={{ marginTop: 8 }} onClick={() => onTraceGhost(gh)}>Use as my outline</button></div>}
          </div>
        ))}
        <div className="addrow">
          <button className="btn small" onClick={() => onAddGhost('builtin:tStyle')}>+ T-style</button>
          <button className="btn small" onClick={() => onAddGhost('builtin:jStyle')}>+ J-style</button>
          <button className="btn small" onClick={() => fileRef.current.click()}>+ Your file…</button>
          <input ref={fileRef} type="file" accept=".svg,.dxf,.png,.jpg,.jpeg,.webp,image/*" hidden onChange={(e) => { if (e.target.files[0]) onAddGhost(e.target.files[0]); e.target.value = ''; }} />
        </div>
        <p className="note">Your file can be an SVG or DXF outline at true size, or a photo you scale to fit.</p>
      </Acc>

      <Acc id="neck" title="Neck" hint={`${fmtLen(nk.scale, u)} ${unitLabel(u)} scale`} defaultOpen>
        <Row label="Neck standard" wide htmlFor="neck-preset">
          <select id="neck-preset" value={nk.preset} onChange={(e) => change((d) => { const neck = applyNeckPreset(d.neck, e.target.value); return { ...d, neck, outline: seatOnPocket(d.outline, neck) }; })}>
            {Object.entries(NECK_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
        </Row>
        <p className="note">{preset.note}</p>
        {NECK_FIELDS.map(([key, label]) => (
          <Row key={key} label={label} htmlFor={`nk-${key}`} basis={basisFor(key)}>
            {key === 'frets'
              ? <Num id="nk-frets" value={nk.frets} min={12} max={27} onChange={(v) => setNeck('frets', Math.round(v))} />
              : <Len id={`nk-${key}`} units={u} value={nk[key]} min={0} max={1200} onChange={(v) => change((d) => ({ ...d, neck: { ...d.neck, [key]: v, preset: preset.values[key] !== undefined && Math.abs(preset.values[key] - v) > 1e-6 ? 'custom' : d.neck.preset } }))} />}
          </Row>
        ))}
        <p className="note">Pocket end to scale line: <b className="mono">{fmtWithUnit(g.heelY, u)}</b>. The pocket is a direct cutout of the neck: its sides are the fretboard’s edges. It is <b className="mono">{fmtWithUnit(nk.heelWidth, u)}</b> wide at the end of the heel and <b className="mono">{fmtWithUnit(g.pocketMouthWidth, u)}</b> wide {fmtWithUnit(nk.pocketLength, u)} up from there, following the taper from the nut’s width to the heel’s. The body’s corners at the pocket snap to its edges.</p>
        {(() => {
          const b = nk.back, made = g.neck;
          const setBack = (patch) => change((d) => ({ ...d, neck: { ...d.neck, back: { ...d.neck.back, ...patch } } }));
          const prof = NECK_PROFILES[b.profile];
          const own = !prof || Math.abs(prof.t1 - b.t1) > 1e-6 || Math.abs(prof.t12 - b.t12) > 1e-6;
          const thick = <Basis kind={own ? 'assumed' : NECK_PROFILE_BASIS[0]} text={own ? 'Your own thickness. Measure a neck you like.' : prof.note} src={own ? undefined : NECK_PROFILE_BASIS[1]} />;
          const guess = (text) => <Basis kind="assumed" text={text} />;
          return (
            <>
              <h4 className="sub">Shape of the neck’s back</h4>
              <Row label="Thickness profile" wide htmlFor="nb-profile">
                <select id="nb-profile" value={own ? 'own' : b.profile} onChange={(e) => { if (e.target.value !== 'own') { const p = makeNeckBack(e.target.value); setBack({ profile: p.profile, t1: p.t1, t12: p.t12 }); } }}>
                  {Object.entries(NECK_PROFILES).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                  {own && <option value="own">Your own thickness</option>}
                </select>
              </Row>
              <Row label="Thickness at the 1st fret" htmlFor="nb-t1" basis={thick}><Len id="nb-t1" units={u} value={b.t1} min={12} max={35} onChange={(v) => setBack({ t1: v })} /></Row>
              <Row label="Thickness at the 12th fret" htmlFor="nb-t12" basis={thick}><Len id="nb-t12" units={u} value={b.t12} min={12} max={35} onChange={(v) => setBack({ t12: v })} /></Row>
              <Row label="Fretboard thickness" htmlFor="nb-board" basis={guess('A starting value with no source. Measure your fretboard at its center. The thicknesses above include the fretboard, so the wood under it is that much thinner.')}><Len id="nb-board" units={u} value={b.board} min={0} max={12} onChange={(v) => setBack({ board: v })} /></Row>
              <Row label="Fullness of the shoulders" htmlFor="nb-full" basis={guess('A starting value with no source. No maker publishes numbers for the curve of a neck’s back. 2 is a half ellipse; higher fills out the shoulders, lower slims them.')}><Num id="nb-full" value={b.fullness} min={1.2} max={6} step={0.1} digits={1} onChange={(v) => setBack({ fullness: v })} /></Row>
              <Row label="Blend into the heel" htmlFor="nb-blend" basis={guess('A starting value with no source: the length over which the round back turns into the square heel.')}><Len id="nb-blend" units={u} value={b.blend} min={5} max={150} onChange={(v) => setBack({ blend: v })} /></Row>
              {made && <p className="note">Wood under the fretboard: <b className="mono">{fmtWithUnit(made.d1, u)}</b> deep at the 1st fret, <b className="mono">{fmtWithUnit(made.d12, u)}</b> at the 12th, and <b className="mono">{fmtWithUnit(made.heelDepth, u)}</b> at the heel (the pocket’s depth plus what stands above the body).</p>}
              <p className="note">The neck has a flat top where the fretboard is glued. Thickness is held from the nut to the 1st fret, runs straight to the 12th, and is held from there until the back blends into the heel. The neck widens in a straight line from the nut to the pocket’s width where it enters the body.</p>
              {(() => {
                const hd = nk.head, shape = g.neck && g.neck.head;
                const tu = { ...TUNER_START, ...(hd.tuners || {}) }, hasTuners = tu.layout === '3+3' || String(tu.layout) === '6';
                const setTuners = (patch) => setHead({ tuners: { ...tu, ...patch } });
                const drawn = !!(hd.side && hd.side.on), outlined = !!(hd.voluteStyle === 'tongue' && hd.tongueLine && hd.tongueLine.on);
                const setHead = (patch) => change((d) => ({ ...d, neck: { ...d.neck, head: { ...d.neck.head, ...patch } } }));
                const mine = (text) => <Basis kind="assumed" text={`A starting value with no source. ${text}`} />;
                return (
                  <>
                    <h4 className="sub">Headstock</h4>
                    <Row label=""><Check checked={!!hd.on} onChange={(v) => setHead({ on: v })}>Headstock</Check></Row>
                    {hd.on && <Row label="Kind"><Seg value={hd.kind === 'flat' ? 'flat' : 'angled'} onChange={(v) => setHead({ kind: v })} options={[{ value: 'angled', label: 'Angled back' }, { value: 'flat', label: 'Flat' }]} /></Row>}
                    {hd.on && hd.kind !== 'flat' && <Row label="Angle back from the neck" htmlFor="hs-angle" basis={mine('Set it to the angle you build to.')}><Num id="hs-angle" value={hd.angle} min={1} max={25} step={0.5} digits={1} suffix="°" onChange={(v) => setHead({ angle: v })} /></Row>}
                    {hd.on && <Row label="Headstock thickness" htmlFor="hs-thick" basis={mine('Measure a headstock you like, or the tuners you will fit.')}><Len id="hs-thick" units={u} value={hd.thickness} min={6} max={30} onChange={(v) => setHead({ thickness: v })} /></Row>}
                    {hd.on && hd.kind === 'flat' && <Row label="Face below the neck’s top" htmlFor="hs-drop" basis={mine('How far the headstock’s face is below the face the fretboard is glued to. Measure a neck you like.')}><Len id="hs-drop" units={u} value={hd.drop} min={0} max={15} onChange={(v) => setHead({ drop: v })} /></Row>}
                    {hd.on && hd.kind === 'flat' && <Row label="Scoop length" htmlFor="hs-scoop" basis={mine('The length over which the face curves down to that level. It starts at the nut line, or at the fretboard’s end past the nut once a Fretboard Designer file has brought its nut.')}><Len id="hs-scoop" units={u} value={hd.scoop} min={5} max={60} onChange={(v) => setHead({ scoop: v })} /></Row>}
                    {hd.on && <Row label="Transition length" htmlFor="hs-tr" basis={mine('The length past the nut over which the neck’s round back becomes the headstock’s flat back.')}><Len id="hs-tr" units={u} value={hd.transition} min={20} max={80} onChange={(v) => setHead({ transition: v })} /></Row>}
                    {hd.on && <Row label="Volute shape"><Seg value={['peak', 'tongue'].includes(hd.voluteStyle) ? hd.voluteStyle : 'smooth'} onChange={(v) => setHead({ voluteStyle: v })} options={[{ value: 'smooth', label: 'Smooth' }, { value: 'peak', label: 'Peaked' }, { value: 'tongue', label: 'Tongue' }]} /></Row>}
                    {hd.on && !drawn && hd.voluteStyle !== 'tongue' && <Row label="Volute height" htmlFor="hs-vh" basis={mine('How far the volute stands out from the back, on the centerline under the nut. 0 leaves it off.')}><Len id="hs-vh" units={u} value={hd.voluteHeight} min={0} max={15} onChange={(v) => setHead({ voluteHeight: v })} /></Row>}
                    {hd.on && !drawn && hd.voluteStyle !== 'tongue' && hd.voluteHeight > 0 && <Row label="Volute length toward the heel" htmlFor="hs-vl" basis={mine('How far the volute reaches from the nut down the neck. Longer is a shallower slope for the hand.')}><Len id="hs-vl" units={u} value={hd.voluteLength} min={5} max={120} onChange={(v) => setHead({ voluteLength: v })} /></Row>}
                    {hd.on && !drawn && hd.voluteStyle !== 'tongue' && hd.voluteHeight > 0 && <Row label="Volute length toward the headstock" htmlFor="hs-va" basis={mine('How far the volute reaches from the nut onto the headstock. Shorter is a steeper slope on that side.')}><Len id="hs-va" units={u} value={hd.voluteAhead} min={5} max={120} onChange={(v) => setHead({ voluteAhead: v })} /></Row>}
                    {hd.on && !drawn && hd.voluteStyle === 'tongue' && <Row label="Tongue stands out by" htmlFor="hs-vh" basis={mine('How far the flat of the tongue stands out from the crown of the neck’s back, behind the nut. 0 makes it level with the crown.')}><Len id="hs-vh" units={u} value={hd.voluteHeight} min={0} max={15} onChange={(v) => setHead({ voluteHeight: v })} /></Row>}
                    {hd.on && !drawn && !outlined && hd.voluteStyle === 'tongue' && <Row label="Tongue tip behind the nut" htmlFor="hs-vl" basis={mine('How far down the back of the neck the tip of the tongue reaches, measured from the nut.')}><Len id="hs-vl" units={u} value={hd.voluteLength} min={5} max={120} onChange={(v) => setHead({ voluteLength: v })} /></Row>}
                    {hd.on && !outlined && hd.voluteStyle === 'tongue' && <Row label="Tongue tip"><Seg value={hd.tongueTip === 'point' ? 'point' : 'round'} onChange={(v) => setHead({ tongueTip: v })} options={[{ value: 'round', label: 'Round' }, { value: 'point', label: 'Pointed' }]} /></Row>}
                    {hd.on && hd.voluteStyle === 'tongue' && <Row label="Cove width" htmlFor="hs-cv" basis={mine('The width of the hollow that runs from the tongue’s edge out into the neck’s round back.')}><Len id="hs-cv" units={u} value={hd.tongueCove} min={2} max={25} onChange={(v) => setHead({ tongueCove: v })} /></Row>}
                    {hd.on && <div className="addrow"><button className="btn small" onClick={() => { setSel({ kind: 'outline', of: 'head' }); }}>Reshape the headstock outline</button><button className="btn small" onClick={() => setHead({ outline: makeHeadstock().outline })}>Starting outline</button></div>}
                    {hd.on && <p className="note">{hd.kind === 'flat' ? 'The headstock is a flat slab level with the neck, its face stepped down below the neck’s top. From ' + (shape && shape.scoopFrom > 0 ? 'the end of the fretboard (past the nut line, as your Fretboard Designer file gives it)' : 'the nut') + ' the face curves down to that level through a scoop: an arc of a circle seen from the side, straight across, as a sanding drum leaves it. The back of the neck curves down to meet the headstock’s back. The transition is never shorter than the scoop.' : 'The headstock is a flat slab tilted back from the nut.'} Its outline is on the drawing above the nut, laid flat at its true shape: click it and drag its points like the body outline. Its two ends stay on the corners of the nut. The starting outline is only a shape to redraw.{shape ? <> It is <b className="mono">{fmtWithUnit(shape.length, u)}</b> long.</> : null}</p>}
                    {hd.on && <p className="note">The back of the neck and the back of the headstock are one continuous surface. Seen from the side, the line of the neck’s back bends into the line of the headstock’s back, starting a third of the transition length behind the nut. Past the nut the round back widens and flattens, and by the end of the transition length it is the flat back of the headstock. The headstock’s edges are square to its face: thin at the nut, full thickness where the carve runs out.</p>}
                    {hd.on && shape && !drawn && <div className="addrow"><button className="btn small" onClick={() => { setHead({ side: { on: true, points: makeSideLine(shape) } }); setSel({ kind: 'side' }); }}>Draw the side view of the back</button></div>}
                    {hd.on && shape && drawn && <div className="addrow"><button className="btn small" onClick={() => setSel({ kind: 'side' })}>Reshape the side view</button><button className="btn small" onClick={() => { setHead({ side: { ...hd.side, on: false } }); setSel(null); }}>Back to the numbers</button></div>}
                    {hd.on && shape && shape.tongue && !outlined && <div className="addrow"><button className="btn small" onClick={() => { setHead({ tongueLine: { on: true, points: makeTongueLine(shape) } }); setSel({ kind: 'tongue' }); }}>Draw the tongue’s outline</button></div>}
                    {hd.on && shape && shape.tongue && outlined && <div className="addrow"><button className="btn small" onClick={() => setSel({ kind: 'tongue' })}>Reshape the tongue’s outline</button><button className="btn small" onClick={() => { setHead({ tongueLine: { ...hd.tongueLine, on: false } }); setSel(null); }}>Outline back to the numbers</button></div>}
                    {hd.on && outlined && <p className="note">The tongue’s outline is drawn. Its first point is the tip: left smooth it is round, made a corner it is pointed. The other points give half the tongue’s width at each place; the two edges mirror each other. Past the last point the tongue spreads to the headstock’s full width within one and a half cove widths. The tip’s position and shape above are not used while it is drawn.</p>}
                    {hd.on && drawn && <p className="note">The side view of the back is drawn. The line you drew gives how far the back stands out from its plain line along the centerline, from where it leaves that line behind the nut to where it rejoins it on the headstock. {hd.voluteStyle === 'tongue' ? 'For a tongue it is the height of the tongue’s flat, and its first point is the tongue’s tip.' : 'Away from the centerline it falls off to nothing at the edges of the neck, as the volute does. Make its highest point a corner for a peak; Smooth and Peaked no longer differ.'} The volute’s height and lengths above are not used while it is drawn. The line starts close to the shape the numbers gave, not exactly on it.</p>}
                    {hd.on && !drawn && hd.voluteStyle !== 'tongue' && <p className="note">The volute is a mound on the crown of the back, highest on the centerline under the nut. It dies away to nothing at the edges of the neck and along a rounded line toward the heel and toward the headstock, and each of those two sides has its own length. Smooth is rounded over the top. Peaked comes to a point. The volute cannot reach past the end of the transition: a longer one is shortened to fit.</p>}
                    {hd.on && hd.voluteStyle === 'tongue' && <p className="note">The tongue is the flat back of the headstock carried down the back of the neck to a tip, with a crisp edge. {outlined ? 'Its outline is the one you drew; past its last point' : 'At the nut it is four fifths of the nut’s width; past the nut'} it spreads to the headstock’s full width within one and a half cove widths, so the whole back of the headstock is one flat. Outside its edge the surface drops back to the neck’s round back through a cove: upright at the tongue’s edge, running out level into the neck. </p>}
                    {hd.on && <h4 className="sub">Tuner holes</h4>}
                    {hd.on && <Row label="Layout"><Seg value={tu.layout === '3+3' ? '3+3' : String(tu.layout) === '6' ? '6' : 'none'} onChange={(v) => setTuners(v === 'none' ? { layout: 'none' } : { layout: v, ...TUNER_LAYOUTS[v] })} options={[{ value: 'none', label: 'None' }, { value: '3+3', label: '3 a side' }, { value: '6', label: '6 in a line' }]} /></Row>}
                    {hd.on && String(tu.layout) === '6' && <Row label="On the"><Seg value={tu.side === 'treble' ? 'treble' : 'bass'} onChange={(v) => setTuners({ side: v })} options={[{ value: 'bass', label: 'Bass side' }, { value: 'treble', label: 'Treble side' }]} /></Row>}
                    {hd.on && hasTuners && <Row label="Hole across" htmlFor="tu-hole" basis={mine('Tuner makers publish the hole their tuners need. Set it to that.')}><Len id="tu-hole" units={u} value={tu.hole} min={3} max={16} onChange={(v) => setTuners({ hole: v })} /></Row>}
                    {hd.on && hasTuners && <Row label="First hole from the nut" htmlFor="tu-first" basis={mine('Measured along the headstock.')}><Len id="tu-first" units={u} value={tu.first} min={10} max={300} onChange={(v) => setTuners({ first: v })} /></Row>}
                    {hd.on && hasTuners && <Row label="From one hole to the next" htmlFor="tu-pitch" basis={mine('Measured along the headstock. Check it against the bodies of your tuners.')}><Len id="tu-pitch" units={u} value={tu.pitch} min={12} max={80} onChange={(v) => setTuners({ pitch: v })} /></Row>}
                    {hd.on && hasTuners && <Row label="First hole from the centerline" htmlFor="tu-in1" basis={mine('Set it to suit your outline and string path.')}><Len id="tu-in1" units={u} value={tu.inFirst} min={0} max={90} onChange={(v) => setTuners({ inFirst: v })} /></Row>}
                    {hd.on && hasTuners && <Row label="Last hole from the centerline" htmlFor="tu-in2" basis={mine('Set it to suit your outline and string path.')}><Len id="tu-in2" units={u} value={tu.inLast} min={0} max={90} onChange={(v) => setTuners({ inLast: v })} /></Row>}
                    {hd.on && hasTuners && shape && <p className="note">{shape.tuners.length} holes, each row on a straight line from its first hole to its last, right through the headstock and square to its face. {shape.tuners.some((t) => t.gap < 0) ? <b>A hole breaks out of the outline.</b> : <>The hole nearest the edge has <b className="mono">{fmtWithUnit(Math.min(...shape.tuners.map((t) => t.gap)), u)}</b> of wood outside it.</>} They are on the drawing, in the 3D view (as dark plugs), and in the headstock’s own vector file under Save files for CNC. They are not in the 3D model of the neck, and they cannot be dragged on the drawing yet: use these numbers.</p>}
                    {(() => {
                      const tr = { ...TRUSS_START, ...(nk.truss || {}) }, built = g.truss;
                      const setTruss = (patch) => change((d) => ({ ...d, neck: { ...d.neck, truss: { ...TRUSS_START, ...(d.neck.truss || {}), ...patch } } }));
                      const own = (text) => <Basis kind="assumed" text={`Nothing is built in: 0 means not entered. ${text}`} />;
                      const box = (id, label, key, max, text) => <Row label={label} htmlFor={id} basis={own(text)}><Len id={id} units={u} value={tr[key]} min={0} max={max} onChange={(v) => setTruss({ [key]: v })} /></Row>;
                      return (
                        <>
                          <h4 className="sub">Truss rod channel</h4>
                          <Row label=""><Check checked={!!tr.on} onChange={(v) => setTruss({ on: v })}>Truss rod channel</Check></Row>
                          {tr.on && <Row label="The rod adjusts at the"><Seg value={tr.adjust === 'heel' ? 'heel' : 'head'} onChange={(v) => setTruss({ adjust: v })} options={[{ value: 'head', label: 'Headstock end' }, { value: 'heel', label: 'Heel end' }]} /></Row>}
                          {tr.on && box('tr-width', 'Channel width', 'width', 20, 'Measure your rod across, and add what its maker says for a sliding fit.')}
                          {tr.on && box('tr-depth', 'Channel depth', 'depth', 30, 'Measured down from the face the fretboard is glued to. Your rod’s maker gives it.')}
                          {tr.on && box('tr-length', 'Channel length', 'length', 700, 'Your rod’s length, with what its maker says to add.')}
                          {tr.on && box('tr-from', 'From the nut to the channel', 'fromNut', 300, 'How far from the nut line the channel starts. 0 starts it at the nut line.')}
                          {tr.on && <h4 className="sub">Pocket for the adjuster</h4>}
                          {tr.on && box('tr-aw', 'Pocket width', 'accessWidth', 30, 'A wider pocket for the adjusting nut, if your rod needs one. Leave all three at 0 for none.')}
                          {tr.on && box('tr-al', tr.adjust === 'heel' ? 'Pocket length' : 'Pocket length past the fretboard', 'accessLength', 120, tr.adjust === 'heel' ? 'It carries on from the channel toward the end of the heel.' : 'How much of the pocket is left open on the headstock, measured from the end of the fretboard: the nut line, or the fretboard’s end past the nut once a Fretboard Designer file has brought its nut.')}
                          {tr.on && box('tr-ad', 'Pocket depth', 'accessDepth', 30, 'Measured down from the face the fretboard is glued to.')}
                          {tr.on && built && !built.ready && <p className="note">Enter the channel’s {built.missing.join(', ')} to draw it. No size is built in, because rods differ by maker: measure your rod.</p>}
                          {tr.on && built && built.ready && <p className="note">A straight channel with a flat bottom for a two-way rod, on the centerline, from <b className="mono">{fmtWithUnit(built.fromNut, u)}</b> to <b className="mono">{fmtWithUnit(built.fromNut + built.length, u)}</b> from the nut. {built.under ? <>At its thinnest, <b className="mono">{fmtWithUnit(built.under.t, u)}</b> of wood is left under it, <b className="mono">{fmtWithUnit(built.under.fromNut, u)}</b> from the nut. </> : null}It is drawn with square ends: a round bit leaves round ends. It is on the drawing and in the neck’s own vector file (Save files for CNC). It is not in the 3D picture or the 3D model.</p>}
                          {tr.on && tr.adjust === 'head' && built && built.ready && built.access && <p className="note">The pocket runs from the channel’s end to <b className="mono">{fmtWithUnit(built.access.length, u)}</b> past the end of the fretboard, which is {built.access.pastNut > 0 ? <><b className="mono">{fmtWithUnit(built.access.pastNut, u)}</b> past the nut line (from your Fretboard Designer file)</> : 'the nut line (no nut has been loaded)'}. The adjuster’s pocket is drawn in the plane of the neck’s top face. On an angled headstock its depth is measured from that plane, not from the headstock’s face, and the wood left under it there is not checked.</p>}
                        </>
                      );
                    })()}
                    <p className="note"><b>Not built yet:</b> dragging tuner holes on the drawing, string paths to the tuners, a truss rod channel with a curved bottom for a one-way rod, and the heel’s screw holes. The nut’s slot is cut in the fretboard, by the Fretboard Designer.{hd.on ? '' : ' With the headstock off, the neck ends square at the nut.'}</p>
                  </>
                );
              })()}
            </>
          );
        })()}
        <div className="addrow">
          <button className="btn small" onClick={() => fbRef.current.click()}>Load a Fretboard Designer file…</button>
          <input ref={fbRef} type="file" accept=".json,application/json" hidden onChange={(e) => { if (e.target.files[0]) onImportFretboard(e.target.files[0]); e.target.value = ''; }} />
        </div>
        {g.nut
          ? <p className="note" data-k="nut-note">Nut, from your Fretboard Designer file: <b className="mono">{fmtWithUnit(g.nut.thickness, u)}</b> thick, its front face {g.nut.zeroFret ? <><b className="mono">{fmtWithUnit(g.nut.gap, u)}</b> behind the zero fret</> : 'on the nut line'}. The fretboard runs <b className="mono">{fmtWithUnit(g.nut.boardPast, u)}</b> past the nut line{g.nut.mount === 'shelf' ? ', leaving a shelf behind the nut' : ', ending at the back of the nut'}. Both are on the drawing. The nut’s slot is cut in the fretboard, by the Fretboard Designer: nothing is cut for it in the neck, and it is not in the 3D picture or any file here. <button className="btn small" onClick={() => change((d) => ({ ...d, neck: { ...d.neck, nut: { ...NUT_START } } }))}>Remove the nut</button></p>
          : <p className="note" data-k="nut-note">A Fretboard Designer file also brings its nut: its thickness and where the fretboard ends are then drawn here. No nut size is built in, so none is drawn until a file is loaded.</p>}
      </Acc>

      <Acc id="bridge" title="Bridge and strings" hint={bdef.label.split(',')[0].split('(')[0].trim()}>
        <Row label="Bridge" wide htmlFor="bridge-type">
          <select id="bridge-type" value={design.bridge.type} onChange={(e) => change((d) => ({ ...d, bridge: makeBridge(e.target.value) }))}>
            {Object.entries(BRIDGES).map(([k, b]) => <option key={k} value={k}>{b.label}</option>)}
          </select>
        </Row>
        <p className="note">{bdef.note} <Basis kind={bdef.basis} text={bdef.holeNote || bdef.note} src={bdef.src} /></p>
        {Object.keys(bdef.params || {}).map((k) => (
          <Row key={k} label={bdef.paramLabels[k]} htmlFor={`br-${k}`} basis={<Basis kind={bdef.paramBasis[k]} text={bdef.placementNote} src={bdef.src} />}>
            <Len id={`br-${k}`} units={u} value={design.bridge.params[k]} min={-50} max={120} onChange={(v) => change((d) => ({ ...d, bridge: { ...d.bridge, params: { ...d.bridge.params, [k]: v } } }))} />
          </Row>
        ))}
        {bdef.placementNote && <p className="note">{bdef.placementNote}</p>}
        {(() => {
          const groups = [...new Set(g.holes.map((h) => h.depthGroup).filter(Boolean))];
          if (!groups.length) return null;
          const depths = design.bridge.depths || {};
          const setDepth = (k, v) => change((d) => {
            const next = { ...(d.bridge.depths || {}) };
            if (v > 0) next[k] = v; else delete next[k];
            return { ...d, bridge: { ...d.bridge, depths: next } };
          });
          return (
            <>
              {groups.map((k) => (
                <Row key={k} label={`${HOLE_DEPTH_GROUPS[k]}: depth`} htmlFor={`hd-${k}`}>
                  <Len id={`hd-${k}`} units={u} value={depths[k] || 0} min={0} max={design.body.thickness} onChange={(v) => setDepth(k, v)} />
                </Row>
              ))}
              <p className="note">Hole depths depend on the hardware you bought, so none is filled in. Measure your part and enter the depth. While a depth is 0 the hole is marked but not drilled in the 3D model, and its CNC layer says “depth to suit”.</p>
            </>
          );
        })()}
        <Row label="Treble compensation" htmlFor="comp-t" basis={<Basis kind="assumed" text="How far behind the scale line the high-E saddle ends up. 0.030 in is the Fretboard Designer’s starting value; real intonation depends on strings and action." src="fretboardDesigner" />}>
          <Len id="comp-t" units={u} value={design.compensation.treble} min={0} max={15} onChange={(v) => set('compensation', { treble: v })} />
        </Row>
        <Row label="Bass compensation" htmlFor="comp-b" basis={<Basis kind="assumed" text="How far behind the scale line the low-E saddle ends up. 0.090 in is the Fretboard Designer’s starting value." src="fretboardDesigner" />}>
          <Len id="comp-b" units={u} value={design.compensation.bass} min={0} max={15} onChange={(v) => set('compensation', { bass: v })} />
        </Row>
        <Row label="Outer strings at the nut" htmlFor="nutspread" basis={<Basis kind="assumed" text="Distance between the two outer strings at the nut. 1.375 in is the Fretboard Designer’s default for a 1.650 in nut." src="fretboardDesigner" />}>
          <Len id="nutspread" units={u} value={design.strings.nutSpread} min={20} max={70} onChange={(v) => set('strings', { nutSpread: v })} />
        </Row>
        <p className="note">Outer strings at the saddles: <b className="mono">{fmtWithUnit(g.saddleSpread, u)}</b></p>
      </Acc>

      <Acc id="pickups" title="Pickups" hint={`${design.pickups.length}`}>
        {design.pickups.map((p) => {
          const def = PICKUPS[p.type], on = sel && sel.id === p.id;
          return (
            <div className={'card' + (on ? ' sel' : '')} key={p.id}>
              <div className="head" onClick={() => setSel(on ? null : { kind: 'pickup', id: p.id })}>
                <span className="t">{def.label}</span><span className="s">{fmtLen(p.y, u)}</span>
                <button className="x" aria-label={`Remove ${def.label}`} onClick={(e) => { e.stopPropagation(); delItem('pickups', p.id); }}>×</button>
              </div>
              {on && (
                <div className="body">
                  <Row label="Type" wide><select value={p.type} aria-label="Pickup type" onChange={(e) => setItem('pickups', p.id, { type: e.target.value, depth: PICKUPS[e.target.value].depth })}>{Object.entries(PICKUPS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}</select></Row>
                  <Row label="Center, from scale line" htmlFor={`pu-y-${p.id}`}><Len id={`pu-y-${p.id}`} units={u} value={p.y} min={-50} max={400} onChange={(v) => setItem('pickups', p.id, { y: v })} /></Row>
                  <Row label="Off centerline" htmlFor={`pu-x-${p.id}`}><Len id={`pu-x-${p.id}`} units={u} value={p.x} min={-150} max={150} onChange={(v) => setItem('pickups', p.id, { x: v })} /></Row>
                  {!def.fixedAngle && <Row label="Slant"><Num value={p.angle * DEG} step={1} digits={1} suffix="°" min={-45} max={45} onChange={(v) => setItem('pickups', p.id, { angle: v / DEG })} /></Row>}
                  {def.hasFlip && <Row label=""><Check checked={p.flip} onChange={(v) => setItem('pickups', p.id, { flip: v })}>Wiring tab toward the neck</Check></Row>}
                  {def.isCustom && <>
                    <Row label="Cavity length"><Len units={u} value={p.len} min={5} max={200} onChange={(v) => setItem('pickups', p.id, { len: v })} /></Row>
                    <Row label="Cavity width"><Len units={u} value={p.wid} min={5} max={120} onChange={(v) => setItem('pickups', p.id, { wid: v })} /></Row>
                    <Row label="Corner radius"><Len units={u} value={p.rad} min={0} max={60} onChange={(v) => setItem('pickups', p.id, { rad: v })} /></Row>
                  </>}
                  <Row label="Cavity depth" htmlFor={`pu-d-${p.id}`} basis={<Basis kind={def.isCustom ? 'assumed' : 'published'} text={def.depthNote} src="warmothPickupRouts" />}><Len id={`pu-d-${p.id}`} units={u} value={p.depth} min={1} max={60} onChange={(v) => setItem('pickups', p.id, { depth: v })} /></Row>
                  {def.pieces && <Row label="Leg pockets, extra depth" basis={<Basis kind="assumed" text="Warmoth cuts the leg pockets deeper than the main cavity for the height screws and springs, but does not publish a depth. Measure your pickup: Fralin humbuckers are 23 mm from cover top to the bottom of the legs." src={['warmothPickupRouts', 'fralin']} />}><Len units={u} value={p.legExtra} min={0} max={30} onChange={(v) => setItem('pickups', p.id, { legExtra: v })} /></Row>}
                  <p className="note">{def.routeNote} <Basis kind={def.basis} text={def.bodyNote} src={def.src} /></p>
                </div>
              )}
            </div>
          );
        })}
        <div className="addrow">
          {['humbucker', 'strat', 'teleNeck', 'tBridge', 'p90', 'slot', 'custom'].map((t) => (
            <button key={t} className="btn small" onClick={() => { const p = makePickup(t); change((d) => ({ ...d, pickups: [...d.pickups, p] })); setSel({ kind: 'pickup', id: p.id }); }}>+ {PICKUPS[t].label.replace(' pickup', '')}</button>
          ))}
        </div>
      </Acc>

      <Acc id="controls" title="Controls and cavities" hint={`${design.controls.length} + ${design.cavities.length}`}>
        {design.controls.map((c) => {
          const on = sel && sel.id === c.id;
          return (
            <div className={'card' + (on ? ' sel' : '')} key={c.id}>
              <div className="head" onClick={() => setSel(on ? null : { kind: 'control', id: c.id })}>
                <span className="t">{CONTROL_KINDS[c.kind].label}</span><span className="s">{fmtLen(c.d, u)} hole</span>
                <button className="x" aria-label="Remove control" onClick={(e) => { e.stopPropagation(); delItem('controls', c.id); }}>×</button>
              </div>
              {on && <div className="body">
                <Row label="Hole diameter" basis={<Basis kind="assumed" text={CONTROL_NOTE} />}><Len units={u} value={c.d} min={2} max={30} onChange={(v) => setItem('controls', c.id, { d: v })} /></Row>
                <Row label="Across"><Len units={u} value={c.x} onChange={(v) => setItem('controls', c.id, { x: v })} /></Row>
                <Row label="Along"><Len units={u} value={c.y} onChange={(v) => setItem('controls', c.id, { y: v })} /></Row>
              </div>}
            </div>
          );
        })}
        {design.cavities.map((c) => {
          const on = sel && sel.id === c.id;
          return (
            <div className={'card' + (on ? ' sel' : '')} key={c.id}>
              <div className="head" onClick={() => setSel(on ? null : { kind: 'cavity', id: c.id })}>
                <span className="t">{c.name} (back)</span><span className="s">{fmtLen(c.depth, u)} deep</span>
                <button className="x" aria-label="Remove cavity" onClick={(e) => { e.stopPropagation(); delItem('cavities', c.id); }}>×</button>
              </div>
              {on && <div className="body">
                <Row label="Length"><Len units={u} value={c.h} min={10} max={300} onChange={(v) => setItem('cavities', c.id, { h: v })} /></Row>
                <Row label="Width"><Len units={u} value={c.w} min={10} max={300} onChange={(v) => setItem('cavities', c.id, { w: v })} /></Row>
                <Row label="Corner radius"><Len units={u} value={c.r} min={0} max={150} onChange={(v) => setItem('cavities', c.id, { r: v })} /></Row>
                <Row label="Turn"><Num value={c.angle * DEG} step={1} digits={1} suffix="°" min={-180} max={180} onChange={(v) => setItem('cavities', c.id, { angle: v / DEG })} /></Row>
                <Row label="Depth from the back" basis={<Basis kind="shop" text="Starts at body thickness minus 1/4 in: the Black Chapel T-style template routes controls 1.5 in deep in a 1.75 in body." src="shop" />}><Len units={u} value={c.depth} min={1} max={design.body.thickness} onChange={(v) => setItem('cavities', c.id, { depth: v })} /></Row>
                <Row label=""><Check checked={c.cover} onChange={(v) => setItem('cavities', c.id, { cover: v })}>Recess for a cover plate</Check></Row>
                {c.cover && <>
                  <Row label="Ledge width" basis={<Basis kind="assumed" text="How far the recess extends past the cavity for the cover to sit on. A starting value: size it to your cover and screws." />}><Len units={u} value={c.ledge} min={1} max={30} onChange={(v) => setItem('cavities', c.id, { ledge: v })} /></Row>
                  <Row label="Recess depth" basis={<Basis kind="assumed" text="Match the thickness of your cover material." />}><Len units={u} value={c.coverDepth} min={0.5} max={12} onChange={(v) => setItem('cavities', c.id, { coverDepth: v })} /></Row>
                </>}
              </div>}
            </div>
          );
        })}
        <div className="addrow">
          {Object.entries(CONTROL_KINDS).map(([k, c]) => <button key={k} className="btn small" onClick={() => { const it = makeControl(k, 100, -40 - design.controls.length * 12); change((d) => ({ ...d, controls: [...d.controls, it] })); setSel({ kind: 'control', id: it.id }); }}>+ {c.label}</button>)}
          <button className="btn small" onClick={() => { const it = makeCavity(95, -30, design.body.thickness); change((d) => ({ ...d, cavities: [...d.cavities, it] })); setSel({ kind: 'cavity', id: it.id }); }}>+ Back cavity</button>
        </div>
        <p className="note">{CONTROL_NOTE}</p>
      </Acc>

      <Acc id="body" title="Body" hint={`${fmtLen(design.body.thickness, u)} ${unitLabel(u)} thick`}>
        <Row label="Thickness" htmlFor="b-thick" basis={<Basis kind="assumed" text="1-3/4 in is the usual solid-body blank. Set this to your blank." />}><Len id="b-thick" units={u} value={design.body.thickness} min={15} max={80} onChange={(v) => set('body', { thickness: v })} /></Row>
        {(() => {
          const bd = design.body.binding, topOn = design.body.roundTopOn !== false, backOn = design.body.roundBackOn !== false;
          const setB = (patch) => set('body', { binding: { ...bd, ...patch } });
          const size = <Basis kind="assumed" text="A starting size only. Binding strip comes in many sizes: measure the strip you have. Its thickness is the channel’s width and its height is the channel’s depth." />;
          return (
            <>
              <Row label=""><Check checked={topOn} onChange={(v) => set('body', { roundTopOn: v })}>Round over the top edge</Check></Row>
              {topOn && <Row label="Top roundover radius" htmlFor="b-rt"><Len id="b-rt" units={u} value={design.body.roundTop} min={0} max={25} onChange={(v) => set('body', { roundTop: v })} /></Row>}
              {topOn && bd.on && <p className="note">Left out while the binding channel is on: the channel takes the top edge.</p>}
              <Row label=""><Check checked={backOn} onChange={(v) => set('body', { roundBackOn: v })}>Round over the back edge</Check></Row>
              {backOn && <Row label="Back roundover radius" htmlFor="b-rb"><Len id="b-rb" units={u} value={design.body.roundBack} min={0} max={25} onChange={(v) => set('body', { roundBack: v })} /></Row>}
              {(() => {
                const eb = design.body.edgeBevel, made = g.bevelEdge;
                const setE = (patch) => set('body', { edgeBevel: { ...eb, ...patch } });
                const start = <Basis kind="assumed" text="A starting size only. This bevel is shaped by eye: set these to what you want to carve." />;
                const strip = <Basis kind="assumed" text="A starting size only. Purfling strip comes in many sizes: measure the strip you have." />;
                const narrow = made ? made.handles.filter((h) => h.width < h.asked - 0.05).length : 0;
                const shallow = made ? made.handles.filter((h) => h.depth < h.askedDepth - 0.05).length : 0;
                // the outline point whose diamond is picked on the drawing
                const j = sel && sel.kind === 'edgebevel' && eb.on ? storedIndex(design.outline, sel.i) : -1;
                const node = j >= 0 ? design.outline.nodes[j] : null;
                const setNode = (patch) => change((d) => ({ ...d, outline: { ...d.outline, nodes: d.outline.nodes.map((q, k) => (k === j ? { ...q, ...patch } : q)) } }));
                const clear = (q) => { const { bw, bd: depthHere, ...rest } = q; return rest; };
                return (
                  <>
                    <Row label=""><Check checked={eb.on} onChange={(v) => setE({ on: v })}>Bevel around the top edge</Check></Row>
                    {eb.on && <Row label="Width" htmlFor="eb-width" basis={start}><Len id="eb-width" units={u} value={eb.width} min={0} max={150} onChange={(v) => setE({ width: v })} /></Row>}
                    {eb.on && <Row label="Depth at the body edge" htmlFor="eb-drop" basis={start}><Len id="eb-drop" units={u} value={eb.drop} min={0} max={design.body.thickness - 3} onChange={(v) => setE({ drop: v })} /></Row>}
                    {eb.on && <Row label="How far the bevel is rolled" htmlFor="eb-roll"><Num id="eb-roll" value={Math.round((eb.roll || 0) * 100)} min={0} max={100} step={5} suffix="%" onChange={(v) => setE({ roll: v / 100 })} /></Row>}
                    {eb.on && <p className="note">A bevel from an inner line on the top down to the body edge. The width and depth above apply all the way around until you change a point: every point of the outline has a brass diamond on the inner line. Drag a diamond to set how wide the bevel is there, or click it to give that point its own width and depth below. Add a point to the outline to get another diamond.</p>}
                    {eb.on && <p className="note"><b>To make the bevel taper to nothing</b>, drag a diamond onto the outline or set that point’s width to 0. The bevel then narrows to a point there, from full size at the points either side. <b>Rolled 0%</b> the bevel is flat. <b>100%</b> it is a smooth curve that leaves the top almost level (at a tenth of the flat bevel’s slope, so there is the faintest crease) and steepens toward the edge.</p>}
                    {node && (
                      <div className="card sel" data-k="eb-point">
                        <Row label="This point: width" htmlFor="eb-pt-w"><Len id="eb-pt-w" units={u} value={node.bw !== undefined ? node.bw : eb.width} min={0} max={150} onChange={(v) => setNode({ bw: v })} /></Row>
                        <Row label="This point: depth at the edge" htmlFor="eb-pt-d"><Len id="eb-pt-d" units={u} value={node.bd !== undefined ? node.bd : eb.drop} min={0} max={design.body.thickness - 3} onChange={(v) => setNode({ bd: v })} /></Row>
                        <Row label=""><button className="btn small" onClick={() => change((d) => ({ ...d, outline: { ...d.outline, nodes: d.outline.nodes.map((q, k) => (k === j ? clear(q) : q)) } }))}>Use the general sizes at this point</button></Row>
                      </div>
                    )}
                    {eb.on && <Row label=""><button className="btn small" onClick={() => change((d) => ({ ...d, outline: { ...d.outline, nodes: d.outline.nodes.map(clear) } }))}>Set every point to the general sizes</button></Row>}
                    {eb.on && narrow > 0 && <p className="note">At {narrow} {narrow === 1 ? 'point' : 'points'} the bevel is held narrower than asked, because the body has no room for more there (a horn tip, a corner or a tight curve).</p>}
                    {eb.on && shallow > 0 && <p className="note">At {shallow} {shallow === 1 ? 'point' : 'points'} the depth is held to three times the width there, so the bevel is never steeper than that.</p>}
                    {eb.on && made && made.crosses && <p className="note" style={{ color: 'var(--torch)' }}>The inner line crosses itself. Make the bevel narrower where the outline turns tightly; it cannot be cut as drawn.</p>}
                    {eb.on && <Row label=""><Check checked={!!eb.purfling} onChange={(v) => setE({ purfling: v })}>Purfling channel along the inner line</Check></Row>}
                    {eb.on && eb.purfling && <Row label="Purfling width" htmlFor="pf-w" basis={strip}><Len id="pf-w" units={u} value={eb.purflingWidth} min={0.3} max={10} onChange={(v) => setE({ purflingWidth: v })} /></Row>}
                    {eb.on && eb.purfling && <Row label="Purfling depth" htmlFor="pf-d" basis={strip}><Len id="pf-d" units={u} value={eb.purflingDepth} min={0.3} max={design.body.thickness - 3} onChange={(v) => setE({ purflingDepth: v })} /></Row>}
                    {eb.on && eb.purfling && <p className="note">A narrow groove in the top, between the bevel’s inner line and the dashed line just inside it. It follows the inner line all the way around, including along the body edge where the bevel has tapered to nothing. It is in the 3D view and the CNC vectors, to cut as a 2D channel. It is not in the saved 3D model.</p>}
                    {eb.on && <p className="note">Where the bevel is cut, it takes the top edge; where it has tapered to nothing, the top roundover is still there. The binding channel is left out while this bevel is on. The bevel is in the 3D view, the 3D model and the CNC vectors. It is not on the routing templates.</p>}
                  </>
                );
              })()}
              <Row label=""><Check checked={bd.on} onChange={(v) => setB({ on: v })}>Binding channel around the top edge</Check></Row>
              {bd.on && <Row label="Channel width" htmlFor="bind-w" basis={size}><Len id="bind-w" units={u} value={bd.width} min={0.5} max={10} onChange={(v) => setB({ width: v })} /></Row>}
              {bd.on && <Row label="Channel depth" htmlFor="bind-d" basis={size}><Len id="bind-d" units={u} value={bd.depth} min={0.5} max={design.body.thickness - 3} onChange={(v) => setB({ depth: v })} /></Row>}
              {bd.on && <p className="note">A square ledge all the way around the top, set in from the body outline by its width. It is in the 3D view, the 3D model and the CNC vectors. It is not on the routing templates.</p>}
            </>
          );
        })()}
        <Row label="Wood" htmlFor="b-wood" basis={<Basis kind="published" text="Average dried weight from The Wood Database. Individual boards vary a lot; weigh yours if the number matters." src="woodDb" />}>
          <select id="b-wood" value={design.body.wood} onChange={(e) => set('body', { wood: e.target.value })}>{Object.entries(WOODS).map(([k, w]) => <option key={k} value={k}>{w.label}{w.lbft3 ? ` · ${w.lbft3} lb/ft³` : ''}</option>)}</select>
        </Row>
        {design.body.wood === 'custom' && <Row label="Density"><Num value={design.body.customDensity} min={100} max={1300} step={10} suffix="kg/m³" onChange={(v) => set('body', { customDensity: v })} /></Row>}
        {(() => {
          const setC = (key, patch) => change((d) => ({ ...d, contours: { ...d.contours, [key]: { ...d.contours[key], ...patch } } }));
          const a = design.contours.arm, b = design.contours.belly;
          const start = <Basis kind="assumed" text="A starting size. Body contours are shaped by eye and by feel: set this to what you want to carve." />;
          return (
            <>
              <Row label=""><Check checked={a.on} onChange={(v) => setC('arm', { on: v })}>Arm bevel on the top</Check></Row>
              {a.on && <Row label="Depth at the body edge" htmlFor="arm-drop" basis={start}><Len id="arm-drop" units={u} value={a.drop} min={1} max={design.body.thickness - 3} onChange={(v) => setC('arm', { drop: v })} /></Row>}
              {a.on && (() => {
                const made = bevelPlane(a, g.outline, g.centroid, design.body.thickness - 3);
                const rollNow = made ? Math.round(made.roll * 100) : 0;
                return (
                  <>
                    <Row label="How far the cut is rolled" htmlFor="arm-roll"><Num id="arm-roll" value={rollNow} min={0} max={100} step={5} suffix="%" onChange={(v) => setC('arm', { roll: v / 100 })} /></Row>
                    {rollNow < 100 && <Row label="Blend where it meets the top" htmlFor="arm-blend"><Len id="arm-blend" units={u} value={a.blend || 0} min={0} max={2000} onChange={(v) => setC('arm', { blend: v })} /></Row>}
                    <Row label=""><Check checked={!!a.bounded} onChange={(v) => setC('arm', { bounded: v })}>Keep the cut between the two squares</Check></Row>
                    {a.bounded && <Row label="Run-out at each end" htmlFor="arm-fade"><Len id="arm-fade" units={u} value={a.fade || 0} min={0} max={500} onChange={(v) => setC('arm', { fade: v })} /></Row>}
                    <p className="note">The shape a wide flat sander leaves when the body is held against it and rolled: straight along the dashed line, curved across it. The line runs through the two blue squares{a.bounded ? ', and the cut stops at them' : ' and on across the body'}. Drag the squares to place it.</p>
                    <p className="note"><b>Rolled 100%</b> the cut leaves the top with no crease. <b>0%</b> is a flat cut with a crease{rollNow < 100 ? <>, which <b>Blend</b> rounds to a radius{made && (a.blend || 0) > made.blend + 1e-6 ? <> (held to {fmtWithUnit(made.blend, u)} here, the most that fits)</> : null}</> : null}.{a.bounded ? <> <b>Run-out</b> is the length at each end over which the cut rises and fades to nothing; at 0 it stops square{made && (a.fade || 0) > made.fade + 1e-6 ? <> (held to {fmtWithUnit(made.fade, u)}, half the line)</> : null}.</> : null}</p>
                  </>
                );
              })()}
              <Row label=""><Check checked={b.on} onChange={(v) => setC('belly', { on: v })}>Belly cut on the back</Check></Row>
              {b.on && <Row label="Depth at its center" htmlFor="belly-drop" basis={start}><Len id="belly-drop" units={u} value={b.drop} min={1} max={design.body.thickness - 3} onChange={(v) => setC('belly', { drop: v })} /></Row>}
              {b.on && <Row label="Length" htmlFor="belly-len" basis={start}><Len id="belly-len" units={u} value={b.len} min={20} max={500} onChange={(v) => setC('belly', { len: v })} /></Row>}
              {b.on && <Row label="Reach into the body" htmlFor="belly-reach" basis={start}><Len id="belly-reach" units={u} value={b.reach} min={5} max={300} onChange={(v) => setC('belly', { reach: v })} /></Row>}
              {b.on && <Row label="Turned from the centerline" htmlFor="belly-angle"><Num id="belly-angle" value={Math.round(((b.angle || 0) * 180) / Math.PI * 10) / 10} min={-90} max={90} step={1} digits={1} suffix="°" onChange={(v) => setC('belly', { angle: (v * Math.PI) / 180 })} /></Row>}
              {b.on && <Row label="Blend at the rim" htmlFor="belly-blend" basis={<Basis kind="assumed" text="A starting size for the short smooth transition where the cut meets the back. Set it to what you want to carve." />}><Len id="belly-blend" units={u} value={b.blend || 0} min={0} max={2000} onChange={(v) => setC('belly', { blend: v })} /></Row>}
              {b.on && (() => {
                const made = bellyDish(b, design.body.thickness - 3);
                return <p className="note">A wide, short cone taken out of the back: deepest at the middle blue square and rising in a straight slope to its rim. Put the middle square on the body edge. Drag the square at the end of the cut to lengthen it, or to turn it; its length starts parallel to the centerline. Drag the square at its side to widen it. <b>Blend</b> is the radius of the short smooth transition where the cone meets the back{made && (b.blend || 0) > made.blend + 1e-6 ? <>; it is held to {fmtWithUnit(made.blend, u)} here, the most this cut takes</> : null}.{made && made.blend > 0 ? ' The 3D view shows the blended rim closely but not exactly; the saved 3D model rolls the true radius.' : ''}</p>;
              })()}
              {(a.on || b.on) && <p className="note">Contours are carved by hand. The templates carry the guide lines and the depths to work to.</p>}
            </>
          );
        })()}
        {solid && <p className="note">Estimated body weight: <b className="mono">{(solid.mass * 2.20462).toFixed(2)} lb ({solid.mass.toFixed(2)} kg)</b> with every cavity cut.</p>}
      </Acc>

      <Acc id="routing" title="Routing setup" hint={tool.cavity.mode === 'bushing' || tool.outline.mode === 'bushing' ? 'bushing' : 'bearing bit'}>
        {toolRows('outline', 'Body outline')}
        <div style={{ height: 8 }} />
        {toolRows('cavity', 'Cavities and neck pocket')}
        <div style={{ height: 8 }} />
        <Row label="Neck pocket template" wide>
          <Seg wide label="Neck pocket template" value={tool.pocketSheet === 'own' ? 'own' : 'top'} onChange={(v) => change((d) => ({ ...d, tooling: { ...d.tooling, pocketSheet: v } }))}
            options={[{ value: 'top', label: 'Notch in the top template' }, { value: 'own', label: 'Its own template' }]} />
        </Row>
        <p className="note">{tool.pocketSheet === 'own'
          ? 'The pocket gets a separate template with a closed opening that runs past the body edge, so the router stays supported as the bit leaves the pocket. The top template keeps the full body outline. Sized like the Black Chapel J-style neck pocket template.'
          : 'The pocket is a notch in the edge of the top template, as on the Black Chapel T-style master. When you trim the body outline, stop at each side of the notch: following it would cut the pocket right through the body.'}</p>
        <div style={{ height: 8 }} />
        <Row label="Laser kerf" htmlFor="kerf" basis={<Basis kind="assumed" text="The width of material your laser burns away. Leave at 0 to cut on the line, or enter your measured kerf and the template grows by half of it on the outside and shrinks by half on openings and holes." />}><Len id="kerf" units={u} value={tool.kerf} min={0} max={2} onChange={(v) => change((d) => ({ ...d, tooling: { ...d.tooling, kerf: v } }))} /></Row>
        <Row label="Minimum wall to flag" htmlFor="minwall" basis={<Basis kind="assumed" text="Checks warn when less wood than this is left beside or under a cavity. It is your call, not a standard." />}><Len id="minwall" units={u} value={tool.minWall} min={0} max={40} onChange={(v) => change((d) => ({ ...d, tooling: { ...d.tooling, minWall: v } }))} /></Row>
        <Row label=""><Check checked={(tool.regHoles || []).length > 0} onChange={(v) => change((d) => ({ ...d, tooling: { ...d.tooling, regHoles: v ? defaultRegHoles(d, g) : [] } }))}>Alignment pin holes</Check></Row>
        {(tool.regHoles || []).length > 0 && <>
          <Row label="Pin diameter" basis={<Basis kind="shop" text="The Black Chapel templates use 1/4 in pins on the centerline, placed where hardware or a pickguard hides the holes." src="shop" />}><Len units={u} value={tool.regPin} min={1} max={15} onChange={(v) => change((d) => ({ ...d, tooling: { ...d.tooling, regPin: v } }))} /></Row>
          <p className="note">Drag the two blue crosshairs to spots that hardware, a pickguard or the fretboard will cover. The same holes are cut in every template, so each one needs solid template around it.</p>
        </>}
      </Acc>
    </aside>
  );
}
