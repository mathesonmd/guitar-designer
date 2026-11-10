// Tiled true-size PDF for printing on a home printer: each template sheet is split across Letter or A4
// pages with overlap and alignment marks. Print at 100% ("actual size"), then check the 50 mm bar.
import { jsPDF } from 'jspdf';
import { expandArcs } from '../core/arcfit.js';
import { bbox } from '../core/poly.js';

const PAGES = { letter: [215.9, 279.4], a4: [210, 297] };

export function toPDF(prep, { paper = 'letter', title = 'Guitar templates', margin = 10, overlap = 10 } = {}) {
  const [PW, PH] = PAGES[paper] || PAGES.letter;
  const tw = PW - 2 * margin, th = PH - 2 * margin - 8; // 8 mm footer strip
  const doc = new jsPDF({ unit: 'mm', format: paper, orientation: 'portrait', compress: true });
  let first = true, pageCount = 0;
  const summary = [];

  for (const sh of prep.sheets) {
    const polys = sh.paths.map((p) => ({ layer: p.layer, closed: p.closed, pts: expandArcs(p.verts, p.closed, 0.03) }))
      .map((p) => ({ ...p, box: bbox(p.pts) }));
    const stepX = tw - overlap, stepY = th - overlap;
    const cols = Math.max(1, Math.ceil((sh.w - overlap) / stepX)), rows = Math.max(1, Math.ceil((sh.h - overlap) / stepY));
    summary.push({ name: sh.name, cols, rows });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!first) doc.addPage(paper, 'portrait');
      first = false; pageCount++;
      // tile window in sheet coordinates (y up); row 0 is the top of the sheet
      const x0 = sh.x + c * stepX, yTop = sh.y + sh.h - r * stepY, y0 = yTop - th;
      const X = (x) => margin + (x - x0), Y = (y) => margin + (yTop - y);

      doc.saveGraphicsState();
      doc.rect(margin, margin, tw, th, null); doc.clip(); doc.discardPath();
      for (const p of polys) {
        if (p.box.x1 < x0 || p.box.x0 > x0 + tw || p.box.y1 < y0 || p.box.y0 > yTop) continue;
        if (p.layer === 'ENGRAVE') { doc.setDrawColor(110, 110, 110); doc.setLineWidth(0.12); }
        else { doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.25); }
        const pts = p.pts;
        const deltas = [];
        for (let i = 1; i < pts.length; i++) deltas.push([pts[i].x - pts[i - 1].x, -(pts[i].y - pts[i - 1].y)]);
        doc.lines(deltas, X(pts[0].x), Y(pts[0].y), [1, 1], 'S', p.closed);
      }
      doc.restoreGraphicsState();

      // tile frame, overlap guides and alignment crosses
      doc.setDrawColor(170, 170, 170); doc.setLineWidth(0.1);
      doc.rect(margin, margin, tw, th, 'S');
      doc.setLineDashPattern([1.5, 1.5], 0);
      if (c < cols - 1) doc.line(margin + stepX, margin, margin + stepX, margin + th);
      if (r < rows - 1) doc.line(margin, margin + stepY, margin + tw, margin + stepY);
      if (c > 0) doc.line(margin + overlap, margin, margin + overlap, margin + th);
      if (r > 0) doc.line(margin, margin + overlap, margin + tw, margin + overlap);
      doc.setLineDashPattern([], 0);
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.15);
      for (const cx of [c > 0 ? margin + overlap / 2 : null, c < cols - 1 ? margin + stepX + overlap / 2 : null]) {
        if (cx === null) continue;
        for (const cy of [margin + th * 0.25, margin + th * 0.75]) { doc.line(cx - 3, cy, cx + 3, cy); doc.line(cx, cy - 3, cx, cy + 3); doc.circle(cx, cy, 1.5, 'S'); }
      }
      for (const cy of [r > 0 ? margin + overlap / 2 : null, r < rows - 1 ? margin + stepY + overlap / 2 : null]) {
        if (cy === null) continue;
        for (const cx of [margin + tw * 0.25, margin + tw * 0.75]) { doc.line(cx - 3, cy, cx + 3, cy); doc.line(cx, cy - 3, cx, cy + 3); doc.circle(cx, cy, 1.5, 'S'); }
      }

      // footer: what this page is, and a bar to verify the print scale
      const fy = PH - margin - 2;
      doc.setFontSize(8); doc.setTextColor(0, 0, 0);
      doc.text(`${title}  |  ${sh.name}  |  row ${r + 1} of ${rows}, column ${c + 1} of ${cols}  |  print at 100%, no scaling`, margin, fy);
      doc.setLineWidth(0.3);
      const bx = PW - margin - 50;
      doc.line(bx, fy - 4, bx + 50, fy - 4); doc.line(bx, fy - 5.5, bx, fy - 2.5); doc.line(bx + 50, fy - 5.5, bx + 50, fy - 2.5);
      doc.text('this bar is 50 mm', bx, fy);
    }
  }
  return { data: doc.output('arraybuffer'), pages: pageCount, summary };
}
