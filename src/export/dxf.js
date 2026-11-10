// DXF export (R12 / AC1009, millimeters), the same flavor the Fretboard Designer writes: POLYLINEs with
// arc bulges, one layer per operation. Round holes are CIRCLE entities so CAM programs see them as holes.
import { LAYERS } from './prepare.js';
import { extentOf } from './prepare.js';

const n = (v) => (Math.round(v * 1e5) / 1e5).toString();

export function toDXF(prep) {
  const out = [];
  const g = (code, value) => { out.push(String(code)); out.push(String(value)); };
  const all = prep.sheets.flatMap((s) => s.paths);
  const ext = all.length ? extentOf(all) : { x0: 0, y0: 0, x1: 0, y1: 0 };

  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 4);     // millimeters
  g(9, '$MEASUREMENT'); g(70, 1);  // metric
  g(9, '$EXTMIN'); g(10, n(ext.x0)); g(20, n(ext.y0)); g(30, 0);
  g(9, '$EXTMAX'); g(10, n(ext.x1)); g(20, n(ext.y1)); g(30, 0);
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, LAYERS.length);
  for (const L of LAYERS) { g(0, 'LAYER'); g(2, L.name); g(70, 0); g(62, L.aci); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const p of all) {
    if (p.circle) { g(0, 'CIRCLE'); g(8, p.layer); g(10, n(p.circle.x)); g(20, n(p.circle.y)); g(30, 0); g(40, n(p.circle.r)); continue; }
    g(0, 'POLYLINE'); g(8, p.layer); g(66, 1); g(70, p.closed ? 1 : 0);
    for (const v of p.verts) {
      g(0, 'VERTEX'); g(8, p.layer); g(10, n(v.x)); g(20, n(v.y)); g(30, 0);
      if (v.bulge) g(42, (Math.round(v.bulge * 1e8) / 1e8).toString());
    }
    g(0, 'SEQEND');
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
