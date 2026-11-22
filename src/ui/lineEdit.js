// Shared by the two drawn-line editors (the side view of the back, the tongue's outline): what happens
// to a point's handles when one is dragged, when the point is made smooth, and when they are handed back
// to the app. A handle is an [along, value] offset from its point; `hi` reaches back toward the heel
// (its along part is never positive), `ho` forward (never negative).
const r2 = (v) => Math.round(v * 100) / 100;
const fit = (which, v) => [which === 'ho' ? Math.max(0, v[0]) : Math.min(0, v[0]), v[1]];

// The points with point i's handle `which` moved to `vec`. `used` holds the handles as the line uses
// them now (the automatic ones included). On a smooth point the opposite handle turns to stay in line
// with the dragged one and keeps its own length; on a corner it is left alone.
export function dragHandle(pts, used, i, which, vec) {
  const other = which === 'ho' ? 'hi' : 'ho', v = fit(which, vec), list = pts.map((p) => ({ ...p }));
  list[i][which] = v.map(r2);
  const was = used[i][other];
  if (was && pts[i].k !== 'c') {
    const len = Math.hypot(was[0], was[1]), l = Math.hypot(v[0], v[1]);
    list[i][other] = l > 1e-6 ? fit(other, [(-v[0] / l) * len, (-v[1] / l) * len]).map(r2) : was.map(r2);
  } else if (was) list[i][other] = was.map(r2); // a corner keeps its other handle exactly where it was
  return list;
}

// The points with point i made smooth (its two handles brought into line, the forward one leading) or a corner.
export function setPointKind(pts, used, i, kind) {
  const list = pts.map((p) => ({ ...p }));
  list[i].k = kind;
  if (kind === 's' && (pts[i].hi || pts[i].ho) && used[i].hi && used[i].ho) {
    const o = used[i].ho, n = used[i].hi, l = Math.hypot(o[0], o[1]), len = Math.hypot(n[0], n[1]);
    if (l > 1e-6) { list[i].ho = o.map(r2); list[i].hi = fit('hi', [(-o[0] / l) * len, (-o[1] / l) * len]).map(r2); }
  }
  return list;
}

// The points with point i's own handles dropped, so the app sets them again.
export const autoHandles = (pts, i) => pts.map((p, j) => (j === i ? { ...p, hi: null, ho: null } : { ...p }));

// A point as it is stored in the design: its handles only if it has its own.
export const stored = (p, key) => ({ s: r2(p.s), [key]: r2(p[key]), k: p.k, ...(p.hi ? { hi: p.hi.map(r2) } : {}), ...(p.ho ? { ho: p.ho.map(r2) } : {}) });
