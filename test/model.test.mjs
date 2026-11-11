import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultDesign, normalizeDesign, STARTERS, makeBridge, applyNeckPreset, unverifiedNeckKeys, neckBasis } from '../src/model/design.js';
import { derive } from '../src/model/derive.js';
import { buildLayers } from '../src/model/solid.js';
import { buildBodyMesh, meshVolume } from '../src/model/mesh.js';
import { runChecks, achievable } from '../src/model/checks.js';
import { buildTemplates, toolOffset, defaultRegHoles, clearanceAt, POCKET_SHEET } from '../src/model/templates.js';
import { prepare } from '../src/export/prepare.js';
import { toDXF } from '../src/export/dxf.js';
import { toSVG } from '../src/export/svg.js';
import { toPDF } from '../src/export/pdf.js';
import { makeZip, crc32 } from '../src/export/zip.js';
import { expandArcs } from '../src/core/arcfit.js';
import { signedArea, distToPoly, bbox, pointInPoly, roundRect } from '../src/core/poly.js';
import { intersect, regionArea, difference } from '../src/core/clip.js';
import { fretDistance } from '../src/core/fret.js';
import { PICKUPS } from '../src/data/pickups.js';
import { BRIDGES } from '../src/data/bridges.js';
import { NECK_PRESETS } from '../src/data/necks.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const IN = 25.4;

test('published dimensions are carried into the data exactly', () => {
  const f = NECK_PRESETS.fender21.values;
  near(f.heelWidth, 2.1875 * IN, 1e-9); near(f.pocketLength, 3 * IN, 1e-9); near(f.pocketDepth, 0.625 * IN, 1e-9);
  near(f.scale, 647.7, 1e-9); near(f.screwAcross, 38.1, 1e-9); near(f.screwAlong, 50.8, 1e-9);
  const size = (p) => { const b = bbox(p); return [b.w, b.h]; };
  // Warmoth route envelopes (inches)
  const env = { humbucker: [3.38, 1.65], strat: [3.34, 1.02], slot: [3.39, 0.75], teleNeck: [3.2, 0.91], p90: [3.44, 1.43] };
  for (const [k, [w, h]] of Object.entries(env)) {
    const [gw, gh] = size(PICKUPS[k].route({}));
    near(gw, w * IN, 0.06, k + ' length'); near(gh, h * IN, 0.06, k + ' width');
  }
  // Hipshot 41200M
  const hs = BRIDGES.hipshot.geometry({ params: { frontAhead: 10 } }, {});
  const thru = hs.holes.filter((h) => h.kind === 'through').map((h) => h.x).sort((a, b) => a - b);
  near(thru[5] - thru[0], 2.15 * IN, 1e-6); near(thru[1] - thru[0], 0.43 * IN, 1e-6);
  const mounts = hs.holes.filter((h) => h.kind === 'mount');
  near(mounts[1].x - mounts[0].x, 0.89 * IN, 1e-6);
  near(10 - mounts[0].y, 1.125 * IN, 1e-6); near(10 - hs.holes.find((h) => h.kind === 'through').y, 0.865 * IN, 1e-6);
  const pb = bbox(hs.outlines[0]); near(pb.w, 2.875 * IN, 1e-6); near(pb.h, 1.619 * IN, 1e-6); near(pb.y1, 10, 1e-6);
  // Gotoh tune-o-matic
  const tom = BRIDGES.tom.geometry({ params: { tailDistance: 39.5 } }, { compTreble: 1, compBass: 3 });
  const posts = tom.holes.filter((h) => h.label.startsWith('Bridge post'));
  near(Math.abs(posts[0].x - posts[1].x), 74, 1e-9);
  near(posts.find((p) => p.x > 0).y - posts.find((p) => p.x < 0).y, IN / 8, 1e-9, 'bass post sits farther back');
  const tails = tom.holes.filter((h) => h.label === 'Tailpiece stud');
  near(Math.abs(tails[0].x - tails[1].x), 82, 1e-9);
});

test('neck geometry: pocket, frets and screws land where the numbers say', () => {
  const d = defaultDesign();
  const g = derive(d, { tol: 0.01 });
  near(g.heelY, 647.7 - 466.98, 1e-9, 'pocket end to scale line');
  const pb = bbox(g.pocket);
  near(pb.w, 55.5625, 0.01); near(pb.y0, 180.72, 1e-6);
  assert.equal(g.frets.length, 22);
  near(g.nutY - g.frets[11].y, 647.7 / 2, 1e-9, '12th fret is half the scale');
  near(g.frets[21].y, 647.7 - fretDistance(647.7, 22), 1e-9);
  const screws = g.holes.filter((h) => h.kind === 'neckscrew');
  assert.equal(screws.length, 4);
  near(Math.min(...screws.map((s) => s.y)) - g.heelY, 13.49, 1e-9);
  near(Math.max(...screws.map((s) => s.x)) * 2, 38.1, 1e-9);
  // strings: treble on +x, compensated behind the scale line
  assert.ok(g.strings[5].saddle.x > 0 && g.strings[0].saddle.x < 0);
  near(g.strings[5].saddle.y, -0.03 * IN, 1e-9); near(g.strings[0].saddle.y, -0.09 * IN, 1e-9);
  near(g.saddleSpread, 5 * 0.43 * IN, 1e-9);
  // pocket corners carry the heel radius
  let worst = 0;
  for (const p of g.pocket) if (p.y < g.heelY + 6.35 && Math.abs(p.x) > 55.5625 / 2 - 6.35) worst = Math.max(worst, Math.abs(Math.hypot(Math.abs(p.x) - (55.5625 / 2 - 6.35), p.y - (g.heelY + 6.35)) - 6.35));
  assert.ok(worst < 0.01, `pocket corner radius error ${worst}`);
});

test('every starter shape gives a usable body with the pocket on it', () => {
  for (const [key, s] of Object.entries(STARTERS)) {
    const d = { ...defaultDesign(), outline: JSON.parse(JSON.stringify(s.outline)) };
    const g = derive(d);
    assert.ok(g.area > 80000 && g.area < 160000, `${key} area ${g.area}`);
    assert.ok(pointInPoly({ x: 0, y: g.heelY + 5 }, g.outline), `${key}: heel end inside body`);
    assert.ok(pointInPoly({ x: 0, y: 0 }, g.outline), `${key}: bridge on body`);
    assert.ok(!pointInPoly({ x: 0, y: g.nutY }, g.outline), `${key}: nut off body`);
  }
});

test('solid: volume, weight and mesh agree', () => {
  const d = defaultDesign();
  d.body.roundTop = 0; d.body.roundBack = 0; d.pickups = []; d.controls = []; d.cavities = []; d.bridge = makeBridge('none');
  let g = derive(d, { tol: 0.05 });
  let s = buildLayers(d, g);
  const pocketOnBody = regionArea(intersect([g.outline], [g.pocket]));
  const screws = 4 * Math.PI * (d.neck.screwBodyHole / 2) ** 2;
  const expect = g.area * d.body.thickness - pocketOnBody * d.neck.pocketDepth - screws * (d.body.thickness - d.neck.pocketDepth);
  near(s.volume, expect, expect * 0.001, 'prismatic volume');
  near(s.mass, (s.volume * 450) / 1e9, 1e-9);
  assert.ok(s.mass > 1.4 && s.mass < 2.6, `body mass ${s.mass} kg`);
  // full default design with roundovers and bevels
  const full = defaultDesign();
  full.contours.arm.on = true; full.contours.belly.on = true;
  g = derive(full, { tol: 0.1 });
  s = buildLayers(full, g);
  assert.ok(s.layers.length > 20);
  const mesh = buildBodyMesh(s, g.outline);
  const mv = meshVolume(mesh);
  near(mv, s.volume, s.volume * 0.002, 'mesh volume matches slice volume');
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const l = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
    assert.ok(Math.abs(l - 1) < 1e-3, 'unit normals');
  }
  assert.ok(s.volume < g.area * full.body.thickness * 0.97);
});

test('checks flag what the bit cannot cut and pass what it can', () => {
  const d = defaultDesign();
  d.tooling.cavity = { mode: 'bearing', bit: IN / 2, bushing: 16 };
  const g = derive(d);
  const s = buildLayers(d, derive(d, { tol: 0.1 }));
  const res = runChecks(d, g, s);
  assert.ok(res.length > 5);
  // the untouched starting design has nothing to fix
  const clean = defaultDesign();
  const cleanRes = runChecks(clean, derive(clean), buildLayers(clean, derive(clean, { tol: 0.1 })));
  assert.deepEqual(cleanRes.filter((r) => r.level === 'warn').map((r) => r.title), []);
  // a 1/2 in bit (6.35 mm radius) cannot make the humbucker's 3.8 mm corners
  assert.ok(res.some((r) => r.level === 'warn' && /Humbucker: corners/.test(r.title)), 'humbucker corner warning');
  // 6.35 mm heel corners with a 6.35 mm bit radius is fine
  assert.ok(res.some((r) => r.level === 'ok' && /pocket corners clear/.test(r.title)));
  // a squared heel always warns
  const sq = { ...d, neck: { ...d.neck, heelCornerR: 0 } };
  assert.ok(runChecks(sq, derive(sq), s).some((r) => r.level === 'warn' && /squared heel/.test(r.detail)));
  // with a 1/4 in bit the humbucker passes
  const small = { ...d, tooling: { ...d.tooling, cavity: { mode: 'bearing', bit: IN / 4, bushing: 12 } } };
  assert.ok(!runChecks(small, derive(small), s).some((r) => /Humbucker: corners/.test(r.title)));
  // achievable(): a bit of radius r leaves radius-r inside corners
  const a = achievable(roundRect(60, 40, 0), { mode: 'bearing', bit: 10 }, 'inside');
  near(regionArea(a.region), 2400 - (4 - Math.PI) * 25, 0.4);
  // bushing setups produce the same cut as the drawing when corners are generous
  const b = achievable(roundRect(60, 40, 8), { mode: 'bushing', bit: 6.35, bushing: 15.875 }, 'inside');
  near(regionArea(b.region), regionArea([{ outer: roundRect(60, 40, 8), holes: [] }]), 0.5);
});

function parseDXF(text) {
  const L = text.split(/\r?\n/);
  const polys = [];
  let cur = null, v = null, circ = null, inEnt = false;
  for (let i = 0; i + 1 < L.length; i += 2) {
    const code = parseInt(L[i], 10), val = L[i + 1].trim();
    if (code === 2 && val === 'ENTITIES') inEnt = true;
    if (!inEnt) continue;
    if (code === 0) {
      if (v && cur) cur.verts.push(v);
      v = null;
      if (val === 'POLYLINE') cur = { verts: [], closed: false, layer: '' };
      else if (val === 'CIRCLE') { circ = { circle: true, closed: true, layer: '', x: 0, y: 0, r: 0 }; polys.push(circ); }
      else if (val === 'VERTEX') v = { x: 0, y: 0, bulge: 0 };
      else if (val === 'SEQEND') { polys.push(cur); cur = null; }
      if (val !== 'CIRCLE') circ = null;
    } else if (circ) { if (code === 10) circ.x = +val; else if (code === 20) circ.y = +val; else if (code === 40) circ.r = +val; else if (code === 8) circ.layer = val; }
    else if (v) { if (code === 10) v.x = +val; else if (code === 20) v.y = +val; else if (code === 42) v.bulge = +val; }
    else if (cur) { if (code === 70) cur.closed = (+val & 1) === 1; else if (code === 8) cur.layer = val; }
  }
  return polys;
}

test('templates: bearing-guided openings equal the cavities, and the DXF reads back true', () => {
  const d = defaultDesign();
  const g = derive(d, { tol: 0.005 });
  const t = buildTemplates(d, g);
  assert.equal(t.problems.length, 0, t.problems.join('; '));
  const top = t.sheets.find((s) => s.id === 'top');
  const outer = top.items.filter((i) => i.layer === 'CUT_OUTSIDE');
  assert.equal(outer.length, 1);
  const notch = regionArea(intersect([g.outline], [g.pocket]));
  near(Math.abs(signedArea(outer[0].poly)), g.area - notch, 2, 'outline minus pocket notch');
  const inside = top.items.filter((i) => i.layer === 'CUT_INSIDE' && !i.hole);
  assert.equal(inside.length, d.pickups.length);
  const hb = g.cuts.find((c) => c.kind === 'pickup' && c.label === 'Humbucker');
  const match = inside.find((i) => Math.abs(Math.abs(signedArea(i.poly)) - Math.abs(signedArea(hb.poly))) < 0.5);
  assert.ok(match, 'humbucker opening matches its route');
  // back sheet is mirrored: the control cavity is on +x in the design and -x on the sheet
  const back = t.sheets.find((s) => s.id === 'back');
  const cav = back.items.find((i) => i.layer === 'CUT_INSIDE' && !i.hole);
  assert.ok(bbox(cav.poly).cx < 0 && d.cavities[0].x > 0);
  assert.ok(top.legend.some((l) => /Neck pocket: 5\/8 in deep/.test(l)), top.legend.join(' | '));
  assert.match(top.legend.join(' '), /CHECK before cutting: nut-to-heel length, heel corner radius, neck screw position, fretboard overhang/);
  assert.equal(top.textHeight, 3.2, 'legend fits at full size on the starting design');

  // DXF round trip
  const prep = prepare(t, { tol: 0.01 });
  const dxf = toDXF(prep);
  const polys = parseDXF(dxf);
  const srcCuts = t.sheets.flatMap((s) => s.items.filter((i) => i.type === 'cut'));
  const closed = polys.filter((p) => p.closed);
  assert.equal(closed.length, srcCuts.length);
  closed.forEach((p, i) => {
    const a = p.circle ? Math.PI * p.r * p.r : Math.abs(signedArea(expandArcs(p.verts, true, 0.002))), b = Math.abs(signedArea(srcCuts[i].poly));
    assert.ok(Math.abs(a - b) <= Math.max(0.3, b * 2e-4), `loop ${i}: ${a} vs ${b}`);
    assert.equal(!!p.circle, !!srcCuts[i].hole, 'round holes, and only round holes, are written as circles');
  });
  // neck screw clearance holes come back as 3/16 in circles, exactly
  assert.equal(closed.filter((p) => p.circle && Math.abs(p.r * 2 - IN * 3 / 16) < 1e-5).length, 4);
  // long straight edges survive untouched: the pocket walls are exactly one heel width apart, top to bottom
  const topOuter = closed.find((p) => p.layer === 'CUT_OUTSIDE');
  const walls = [];
  topOuter.verts.forEach((a, i) => { const b = topOuter.verts[(i + 1) % topOuter.verts.length]; if (!a.bulge && Math.abs(a.y - b.y) > 40) walls.push([a.x, b.x]); });
  assert.equal(walls.length, 2);
  assert.ok(walls.every(([x0, x1]) => Math.abs(x0 - x1) < 1e-9), 'pocket walls are exactly vertical');
  near(Math.abs(walls[0][0] - walls[1][0]), d.neck.heelWidth, 2e-4, 'pocket width in the DXF');
  assert.match(dxf, /\$INSUNITS\r\n70\r\n4/);
  // SVG
  const svg = toSVG(prep, { title: 'x' });
  assert.match(svg, /viewBox="0 0 /); assert.match(svg, /width="[\d.]+mm"/);
  assert.equal((svg.match(/<path |<circle /g) || []).length, prep.sheets.reduce((n, s) => n + s.paths.length, 0));
  assert.equal((svg.match(/<circle /g) || []).length, srcCuts.filter((c) => c.hole).length);
  assert.ok(svg.includes('A'));
});

test('templates: guide-bushing offsets are exact and kerf grows the outside, shrinks the openings', () => {
  const d = defaultDesign();
  d.tooling.cavity = { mode: 'bushing', bit: IN / 4, bushing: (5 / 8) * IN };
  d.tooling.outline = { mode: 'bushing', bit: IN / 2, bushing: (3 / 4) * IN };
  near(toolOffset(d.tooling.cavity), (0.625 - 0.25) / 2 * IN, 1e-9);
  const g = derive(d, { tol: 0.005 });
  const t = buildTemplates(d, g);
  const top = t.sheets[0];
  const oC = toolOffset(d.tooling.cavity), oO = toolOffset(d.tooling.outline);
  const hb = g.cuts.find((c) => c.label === 'Humbucker');
  const opening = top.items.filter((i) => i.layer === 'CUT_INSIDE' && !i.hole)
    .find((i) => pointInPoly({ x: bbox(hb.poly).cx, y: bbox(hb.poly).cy }, i.poly));
  let worst = 0;
  for (const p of opening.poly) worst = Math.max(worst, Math.abs(distToPoly(p, hb.poly, true).d - oC));
  assert.ok(worst < 0.01, `cavity opening offset error ${worst}`);
  const outer = top.items.find((i) => i.layer === 'CUT_OUTSIDE').poly;
  let w2 = 0, n = 0;
  for (const p of outer) {
    if (p.y > g.heelY - 20 && Math.abs(p.x) < 45) continue; // skip the pocket notch
    const dd = distToPoly(p, g.outline, true).d; w2 = Math.max(w2, Math.abs(dd - oO)); n++;
  }
  assert.ok(n > 100 && w2 < 0.012, `outline offset error ${w2}`);
  // kerf
  const k = defaultDesign(); k.tooling.kerf = 0.2;
  const gk = derive(k, { tol: 0.005 });
  const a0 = buildTemplates(defaultDesign(), gk).sheets[0], a1 = buildTemplates(k, gk).sheets[0];
  const area = (s, layer) => s.items.filter((i) => i.layer === layer).reduce((sum, i) => sum + Math.abs(signedArea(i.poly)), 0);
  assert.ok(area(a1, 'CUT_OUTSIDE') > area(a0, 'CUT_OUTSIDE') + 50);
  assert.ok(area(a1, 'CUT_INSIDE') < area(a0, 'CUT_INSIDE') - 5);
});

test('zip and pdf writers produce valid files', () => {
  const files = [{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3, 255]) }];
  const z = makeZip(files, new Date(2026, 10, 10, 12, 0, 0));
  const dv = new DataView(z.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  const eocd = z.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  assert.equal(dv.getUint16(eocd + 10, true), 2);
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
  const d = defaultDesign();
  const prep = prepare(buildTemplates(d, derive(d, { tol: 0.01 })), { tol: 0.02 });
  const pdf = toPDF(prep, { paper: 'letter', title: 'Test' });
  const head = new TextDecoder().decode(new Uint8Array(pdf.data).slice(0, 5));
  assert.equal(head, '%PDF-');
  assert.ok(pdf.pages >= 6, `pages ${pdf.pages}`);
});

test('opened files are repaired to the current document shape', () => {
  const d = normalizeDesign({ name: 'X', units: 'mm', pickups: [{ type: 'humbucker', y: 44 }, { type: 'nope' }], bridge: { type: 'tom' } });
  assert.equal(d.pickups.length, 1); assert.equal(d.pickups[0].y, 44); assert.ok(d.pickups[0].id);
  assert.equal(d.bridge.type, 'tom'); assert.equal(d.bridge.params.tailDistance, 39.5);
  assert.equal(d.neck.scale, 647.7); assert.equal(d.units, 'mm');
  assert.ok(derive(d).cuts.length >= 2);
});

test('neck numbers stay flagged until confirmed, and a confirmation lapses when the number changes', () => {
  let d = defaultDesign();
  assert.deepEqual(unverifiedNeckKeys(d), ['nutToHeel', 'heelCornerR', 'screwFromHeelEnd', 'boardPastHeel']);
  d = { ...d, verified: { nutToHeel: d.neck.nutToHeel } };
  assert.ok(!unverifiedNeckKeys(d).includes('nutToHeel'));
  // the template stops engraving that CHECK note, and the checks stop asking
  const t = buildTemplates(d, derive(d));
  assert.ok(!/nut-to-heel/.test(t.sheets[0].legend.join(' ')) && /CHECK before cutting: heel corner radius/.test(t.sheets[0].legend.join(' ')));
  // switching to another standard that uses the same number keeps the confirmation...
  const tele = { ...d, neck: applyNeckPreset(d.neck, 'tele21') };
  assert.ok(!unverifiedNeckKeys(tele).includes('nutToHeel'));
  assert.ok(!unverifiedNeckKeys(tele).includes('heelCornerR'), 'the squared heel is published, so it is not asked for');
  // ...but editing one field must not silence the others: the neck becomes "custom" yet still knows its base
  const edited = { ...defaultDesign(), neck: { ...defaultDesign().neck, pocketDepth: 0.72 * IN, preset: 'custom' } };
  assert.deepEqual(unverifiedNeckKeys(edited), ['nutToHeel', 'heelCornerR', 'screwFromHeelEnd', 'boardPastHeel']);
  assert.equal(neckBasis(edited, 'pocketDepth'), null, 'a changed number is the user\u2019s own');
  assert.equal(neckBasis(edited, 'heelWidth')[0], 'published');
  // a number the user typed themselves is theirs and is not asked about
  const own = { ...edited, neck: { ...edited.neck, nutToHeel: 470 } };
  assert.ok(!unverifiedNeckKeys(own).includes('nutToHeel'));
  // old files that stored a bare "true" do not count as confirmed
  assert.deepEqual(normalizeDesign({ ...defaultDesign(), verified: { nutToHeel: true } }).verified, {});
});

test('a separate neck pocket template keeps the full outline on top and gives the pocket a closed opening', () => {
  const d = defaultDesign();
  d.tooling.pocketSheet = 'own';
  const g = derive(d, { tol: 0.005 });
  const t = buildTemplates(d, g);
  assert.equal(t.problems.length, 0, t.problems.join('; '));
  assert.deepEqual(t.sheets.map((s) => s.id), ['top', 'pocket', 'back']);
  const top = t.sheets[0];
  near(Math.abs(signedArea(top.items.find((i) => i.layer === 'CUT_OUTSIDE').poly)), g.area, 0.5, 'top template is the whole body outline');
  assert.ok(!top.legend.some((l) => /Neck pocket/.test(l)));
  assert.equal(top.items.filter((i) => i.hole).length >= 4 + 9 + 3, true, 'neck screw holes are now on the top sheet too');
  const pk = t.sheets[1];
  const open = pk.items.filter((i) => i.layer === 'CUT_INSIDE');
  assert.equal(open.length, 1);
  const ob = bbox(open[0].poly), outer = pk.items.find((i) => i.layer === 'CUT_OUTSIDE').poly;
  near(ob.y0, g.heelY, 1e-6, 'opening starts at the pocket end wall');
  near(ob.w, d.neck.heelWidth, 0.01, 'opening is the heel width');
  near(ob.y1, g.mouthY + POCKET_SHEET.runout, 1e-6, 'opening runs past the body edge');
  for (const p of open[0].poly) assert.ok(pointInPoly(p, outer) && distToPoly(p, outer, true).d > POCKET_SHEET.rim - 0.5, 'opening is closed, with a rim all round');
  // every point of the body outline is on or inside the pocket template, so it can be lined up by its edges
  for (let i = 0; i < g.outline.length; i += 7) assert.ok(pointInPoly(g.outline[i], outer) || distToPoly(g.outline[i], outer, true).d < 0.02);
  assert.ok(pk.legend.some((l) => /Neck pocket: 5\/8 in deep/.test(l)) && pk.legend[0].endsWith('NECK POCKET'));
  // with a bushing the opening grows by the offset on every side
  const b = defaultDesign(); b.tooling.pocketSheet = 'own'; b.tooling.cavity = { mode: 'bushing', bit: IN / 4, bushing: (5 / 8) * IN };
  const gb = derive(b, { tol: 0.005 });
  const ob2 = bbox(buildTemplates(b, gb).sheets[1].items.find((i) => i.layer === 'CUT_INSIDE').poly);
  near(ob2.w, b.neck.heelWidth + 2 * toolOffset(b.tooling.cavity), 0.01); near(ob2.y0, gb.heelY - toolOffset(b.tooling.cavity), 0.01);
});

test('alignment pin starting spots are clear of every hole and cavity, for every bridge', () => {
  for (const type of Object.keys(BRIDGES)) {
    const d = { ...defaultDesign(), bridge: makeBridge(type) };
    const g = derive(d);
    const pins = defaultRegHoles(d, g);
    assert.equal(pins.length, 2);
    for (const p of pins) {
      assert.equal(p.x, 0);
      assert.ok(clearanceAt(p, g) >= d.tooling.regPin / 2 + 2, `${type}: pin at y=${p.y} has ${clearanceAt(p, g).toFixed(2)} mm to the nearest feature`);
    }
    assert.ok(Math.abs(pins[0].y - pins[1].y) > 120, 'pins are well apart');
    const withPins = { ...d, tooling: { ...d.tooling, regHoles: pins } };
    const res = runChecks(withPins, g, null);
    assert.deepEqual(res.filter((r) => /Alignment pin/.test(r.title)).map((r) => r.title), [], type);
    // the same two holes are cut in the top and the back template
    const t = buildTemplates(withPins, derive(withPins, { tol: 0.01 }));
    const pinArea = Math.PI * (d.tooling.regPin / 2) ** 2;
    for (const id of ['top', 'back']) {
      const n = t.sheets.find((s) => s.id === id).items.filter((i) => i.hole && Math.abs(Math.abs(signedArea(i.poly)) - pinArea) < 0.05 && Math.abs(bbox(i.poly).cx) < 0.01).length;
      assert.equal(n, 2, `${type} ${id}`);
    }
  }
  // a pin dragged into a cavity or onto a hole is flagged
  const d = defaultDesign();
  const g = derive(d);
  const bad = { ...d, tooling: { ...d.tooling, regHoles: [{ x: 0, y: 40 }, { x: 0, y: g.holes.find((h) => h.kind === 'mount' && Math.abs(h.x) < 1).y }] } };
  const titles = runChecks(bad, g, null).filter((r) => r.level === 'warn' && /Alignment pin/.test(r.title)).map((r) => r.title);
  assert.equal(titles.length, 2, titles.join(' | '));
  assert.match(titles[0], /sits in the humbucker/); assert.match(titles[1], /runs into a bridge screw hole/);
});

test('engraved guide lines stop at the legend and at openings', () => {
  for (const mode of ['top', 'own']) {
    const d = defaultDesign(); d.tooling.pocketSheet = mode;
    const g = derive(d, { tol: 0.01 });
    for (const sh of buildTemplates(d, g).sheets) {
      assert.ok(sh.legendBox, `${sh.id} has a legend`);
      const B = sh.legendBox;
      const openings = sh.items.filter((i) => i.layer === 'CUT_INSIDE').map((i) => i.poly);
      // straight guide lines are two-point engravings; lettering strokes are short, so look at long ones
      const guides = sh.items.filter((i) => i.type === 'engrave' && i.line.length === 2 && Math.hypot(i.line[1].x - i.line[0].x, i.line[1].y - i.line[0].y) > 25 && Math.abs(i.line[0].x - i.line[1].x) < 1e-6);
      assert.ok(guides.length >= 1, `${sh.id} has a centerline`);
      for (const gl of guides) {
        for (let k = 0; k <= 40; k++) {
          const p = { x: gl.line[0].x, y: gl.line[0].y + ((gl.line[1].y - gl.line[0].y) * k) / 40 };
          assert.ok(!(p.x > B.x0 + 0.6 && p.x < B.x1 - 0.6 && p.y > B.y0 + 0.6 && p.y < B.y1 - 0.6), `${sh.id}: guide line runs through the legend`);
          assert.ok(!openings.some((o) => pointInPoly(p, o)), `${sh.id}: guide line crosses an opening`);
        }
      }
    }
  }
});

test('body contours remove the volume their shapes say: a flat arm bevel, bounded or not, and a cone-shaped belly cut', () => {
  const square = () => {
    const d = defaultDesign();
    d.outline = { symmetric: false, nodes: [[-200, -200], [200, -200], [200, 200], [-200, 200]].map(([x, y]) => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0, k: 'c' })) };
    d.body.roundTop = 0; d.body.roundBack = 0; d.pickups = []; d.controls = []; d.cavities = []; d.bridge = makeBridge('none');
    return d;
  };
  const vol = (d) => buildLayers(d, derive(d, { tol: 0.05 })).volume;
  const plain = vol(square());
  // arm bevel across a whole corner: a pyramid, L^2 * drop / 6
  const a = square(); a.contours.arm = { on: true, x1: -200, y1: -100, x2: -100, y2: -200, drop: 10 };
  near(plain - vol(a), (100 * 100 * 10) / 6, 60, 'corner bevel volume');
  // the same bevel stopped halfway along its line removes half as much: wood past the end is left alone
  const h = square(); h.contours.arm = { on: true, x1: -200, y1: -100, x2: -150, y2: -150, drop: 10, bounded: true };
  // and without `bounded` the cut runs on along its line, across the whole corner again
  const u = square(); u.contours.arm = { on: true, x1: -200, y1: -100, x2: -150, y2: -150, drop: 10 };
  near(plain - vol(u), (100 * 100 * 10) / 6, 60, 'unbounded bevel volume');
  near(plain - vol(h), (100 * 100 * 10) / 12, 40, 'bounded bevel volume');
  // belly cut centered on a straight edge: half a cone, pi * a * b * drop / 6
  const b = square(); b.contours.belly = { on: true, x1: -200, y1: 0, x2: -140, y2: 0, len: 160, drop: 12 };
  near(plain - vol(b), (Math.PI * 60 * 80 * 12) / 6, 150, 'belly cone volume');
  // the mesh encloses the same volume as the slices with both contours on
  const both = square(); both.contours.arm = a.contours.arm; both.contours.belly = b.contours.belly;
  const g = derive(both, { tol: 0.05 }), s = buildLayers(both, g), mesh = buildBodyMesh(s, g.outline);
  near(meshVolume(mesh), s.volume, s.volume * 0.001, 'mesh volume');
  // dish normals: straight down at the deepest point, tilted toward the body's middle... away from it at the rim
  const n0 = s.dish.normal(-200, 0); near(n0[2], -1, 1e-9);
  const n1 = s.dish.normal(-150, 0); assert.ok(n1[0] < 0 && n1[2] < 0 && Math.abs(Math.hypot(...n1) - 1) < 1e-9);
  near(s.dish.depth(-200, 0), 12, 1e-9); near(s.dish.depth(-140, 0), 0, 1e-9); near(s.dish.depth(-170, 0), 12 * 0.5, 1e-9);
  // the back template carries the edge of the cut and its depth; the top template carries the bevel line
  const t = buildTemplates(both, derive(both, { tol: 0.01 }));
  assert.match(t.sheets.find((x) => x.id === 'back').legend.join(' '), /Belly cut: a shallow cone, inside the engraved curve, 0\.472 in deep at the edge/);
  assert.match(t.sheets.find((x) => x.id === 'top').legend.join(' '), /Arm bevel: flat, from the engraved line to 0\.394 in deep at the edge/);
});

test('the legend steps its lettering down to fit a crowded sheet rather than being left off', () => {
  const d = defaultDesign();
  d.tooling.pocketSheet = 'own';
  d.contours.arm.on = true; d.contours.belly.on = true;
  d.tooling.regHoles = defaultRegHoles(d, derive(d));
  const t = buildTemplates(d, derive(d, { tol: 0.01 }));
  assert.deepEqual(t.problems, []);
  for (const sh of t.sheets) {
    assert.ok(sh.legendBox && sh.textHeight >= 2, `${sh.id}: legend placed at ${sh.textHeight} mm`);
    // every engraved stroke of the legend lies on solid sheet, clear of every opening
    const outer = sh.items.find((i) => i.layer === 'CUT_OUTSIDE').poly, open = sh.items.filter((i) => i.layer === 'CUT_INSIDE').map((i) => i.poly);
    const B = sh.legendBox;
    for (const it of sh.items) {
      if (it.type !== 'engrave') continue;
      for (const p of it.line) {
        if (p.x < B.x0 || p.x > B.x1 || p.y < B.y0 || p.y > B.y1) continue;
        assert.ok(pointInPoly(p, outer), `${sh.id}: legend stroke off the sheet`);
        assert.ok(!open.some((o) => pointInPoly(p, o)), `${sh.id}: legend stroke over an opening`);
      }
    }
  }
  assert.ok(t.sheets[0].legend.length >= 14);
});
