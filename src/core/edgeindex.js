// Fast nearest-point queries against a closed polygon's boundary (uniform grid of its edges).
export class EdgeIndex {
  constructor(poly, cell = 10) {
    this.p = poly; this.cell = cell; this.map = new Map();
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const x0 = Math.floor(Math.min(a.x, b.x) / cell), x1 = Math.floor(Math.max(a.x, b.x) / cell);
      const y0 = Math.floor(Math.min(a.y, b.y) / cell), y1 = Math.floor(Math.max(a.y, b.y) / cell);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = x + ',' + y;
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(i);
      }
    }
  }

  // Returns { d, x, y } for the closest boundary point to (px, py).
  nearest(px, py) {
    const { p, cell, map } = this;
    const n = p.length;
    const cx = Math.floor(px / cell), cy = Math.floor(py / cell);
    let best = Infinity, bx = 0, by = 0;
    for (let ring = 0; ring < 400; ring++) {
      if (best < Infinity && (ring - 1) * cell > best) break;
      for (let x = cx - ring; x <= cx + ring; x++) for (let y = cy - ring; y <= cy + ring; y++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== ring) continue;
        const arr = map.get(x + ',' + y);
        if (!arr) continue;
        for (const i of arr) {
          const a = p[i], b = p[(i + 1) % n];
          const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
          let t = l2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = a.x + dx * t, qy = a.y + dy * t, d = Math.hypot(px - qx, py - qy);
          if (d < best) { best = d; bx = qx; by = qy; }
        }
      }
    }
    return { d: best, x: bx, y: by };
  }
}
