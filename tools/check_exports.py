# Independent check of the files the page downloads. Nothing here shares code with the app: it has its
# own DXF and SVG readers and its own arc math, so an error in the app's exporters cannot hide itself.
#
#   node test/interact.mjs                         (saves real downloads to test-output/downloads)
#   python3 tools/check_exports.py                 (reads them back and measures them)
#
# It checks the zip, that holes are true circles at their stated diameters, that openings match the
# published cavity sizes, that the neck pocket walls are one heel width apart, that the SVG and DXF
# trace the same curves, and (when poppler's pdfinfo is installed) the PDF page count and paper size.
# For the 3D model it reads the STEP text with its own reader: units, one closed solid, the back at
# height 0 and the top at the body thickness, a true cylinder for every through hole where the design
# puts it, the neck pocket's corner cylinders, and a flat floor at each pocket's depth. When the gmsh
# Python package is installed it also opens the file with gmsh's STEP importer and measures it.
import sys, os, zipfile, json, math, re
D = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'test-output', 'downloads')
IN = 25.4
def parse_dxf(text):
    L = text.replace('\r\n', '\n').split('\n')
    pairs = [(int(L[i].strip()), L[i + 1].strip()) for i in range(0, len(L) - 1, 2) if L[i].strip() != '']
    polys, cur, v, ent, circ = [], None, None, False, None
    head = {}
    for i, (c, val) in enumerate(pairs):
        if c == 9: head[val] = pairs[i + 1][1]
        if c == 2 and val == 'ENTITIES': ent = True
        if not ent: continue
        if c == 0:
            if v is not None and cur is not None: cur['v'].append(v)
            v = None
            circ = None
            if val == 'CIRCLE': circ = {'circle': True, 'closed': True, 'layer': '', 'c': [0.0, 0.0], 'r': 0.0, 'v': []}; polys.append(circ)
            elif val == 'POLYLINE': cur = {'v': [], 'closed': False, 'layer': ''}
            elif val == 'VERTEX': v = [0.0, 0.0, 0.0]
            elif val == 'SEQEND': polys.append(cur); cur = None
        elif circ is not None:
            if c == 10: circ['c'][0] = float(val)
            elif c == 20: circ['c'][1] = float(val)
            elif c == 40: circ['r'] = float(val)
            elif c == 8: circ['layer'] = val
        elif v is not None:
            if c == 10: v[0] = float(val)
            elif c == 20: v[1] = float(val)
            elif c == 42: v[2] = float(val)
        elif cur is not None:
            if c == 70: cur['closed'] = (int(val) & 1) == 1
            elif c == 8: cur['layer'] = val
    return head, polys
def bulge_pts(a, b, bulge, n=24):
    if abs(bulge) < 1e-12: return [b[:2]]
    th = 4 * math.atan(bulge); d = math.hypot(b[0] - a[0], b[1] - a[1])
    r = d / (2 * math.sin(abs(th) / 2))
    # center: left of chord for positive bulge
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    h = math.sqrt(max(0, r * r - d * d / 4)) * (1 if abs(th) < math.pi else -1)
    ux, uy = (b[0] - a[0]) / d, (b[1] - a[1]) / d
    sgn = 1 if bulge > 0 else -1
    cx, cy = mx - uy * h * sgn, my + ux * h * sgn
    a0 = math.atan2(a[1] - cy, a[0] - cx)
    return [(cx + r * math.cos(a0 + th * j / n), cy + r * math.sin(a0 + th * j / n)) for j in range(1, n + 1)]
def expand(p):
    if p.get('circle'): return [(p['c'][0] + p['r'] * math.cos(2 * math.pi * j / 96), p['c'][1] + p['r'] * math.sin(2 * math.pi * j / 96)) for j in range(96)]
    v = p['v']; out = [tuple(v[0][:2])]; m = len(v)
    for i in range(m if p['closed'] else m - 1): out += bulge_pts(v[i], v[(i + 1) % m], v[i][2])
    if p['closed']: out.pop()
    return out
def area(pts): return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2
def bbox(pts): xs = [p[0] for p in pts]; ys = [p[1] for p in pts]; return min(xs), min(ys), max(xs), max(ys)
def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dy * dy
    t = 0 if l2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
def dist_to_poly(p, pts, closed=True):
    n = len(pts); return min(seg_dist(p, pts[i], pts[(i + 1) % n]) for i in range(n if closed else n - 1))

ok = True
def check(cond, msg):
    global ok
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond: ok = False

# ---------- zip ----------
import glob
zpath = [f for f in glob.glob(D + '/*template-pack-notch.zip')][0]
z = zipfile.ZipFile(zpath)
names = z.namelist()
print('ZIP', os.path.basename(zpath), names)
check(z.testzip() is None, 'zip passes its CRC test')
check(sorted(n.split('.')[-1] for n in names) == ['dxf', 'json', 'pdf', 'pdf', 'svg', 'txt'], 'pack holds README, DXF, SVG, two PDFs and the design file')
readme = z.read('README.txt').decode()
check('BEFORE YOU CUT WOOD' in readme and 'CUT_INSIDE' in readme and 'bearing-guided' in readme, 'read-me covers checks, layers and the routing setup')
design = json.loads(z.read([n for n in names if n.endswith('.json')][0]))
check(design['schema'] == 'blackchapel.guitar/v1', 'design file carries the schema')
dxf_text = z.read([n for n in names if n.endswith('.dxf')][0]).decode()
svg_text = z.read([n for n in names if n.endswith('.svg')][0]).decode()
check(dxf_text == open(glob.glob(D + '/*-templates.dxf')[0], newline='').read(), 'DXF in the pack equals the one downloaded alone')

# ---------- DXF ----------
head, polys = parse_dxf(dxf_text)
print('DXF', len(polys), 'polylines;', {k: sum(1 for p in polys if p['layer'] == k) for k in ('ENGRAVE', 'CUT_INSIDE', 'CUT_OUTSIDE')})
check(head.get('$ACADVER') == 'AC1009' and head.get('$INSUNITS') == '4', 'R12, millimeters')
closed = [p for p in polys if p['closed']]
check(all(p['layer'].startswith('CUT') for p in closed) and all(p['layer'] == 'ENGRAVE' for p in polys if not p['closed']), 'cuts are closed loops, engraving is open strokes')
ex = [(p, expand(p)) for p in closed]
outs = [e for p, e in ex if p['layer'] == 'CUT_OUTSIDE']
ins = [e for p, e in ex if p['layer'] == 'CUT_INSIDE']
check(len(outs) == 2, 'two template outlines (top and back)')
arcs = sum(1 for p in closed for v in p['v'] if abs(v[2]) > 1e-9); verts = sum(len(p['v']) for p in closed if not p.get('circle'))
print('  shaped cut loops use', verts, 'vertices,', arcs, 'of them arcs; the largest arc sweeps %.0f degrees' % max(abs(4 * math.degrees(math.atan(v[2]))) for p in closed for v in p['v']))
# round holes are CIRCLE entities: the diameter is whatever the file says, with no fitting in between
def is_circle(e): b = bbox(e); w, h = b[2] - b[0], b[3] - b[1]; return abs(w - h) < 0.05 and abs(area(e) - math.pi * (w / 2) ** 2) < 0.03 * math.pi * (w / 2) ** 2
circles = [round(2 * p['r'], 4) for p in closed if p.get('circle')]
check(all(p['layer'] == 'CUT_INSIDE' for p in closed if p.get('circle')) and len(circles) == sum(1 for e in ins if is_circle(e)), 'every round hole is a true CIRCLE entity on the cut-first layer (%d holes)' % len(circles))
from collections import Counter
cnt = Counter(circles); print('  holes by diameter (mm):', dict(sorted(cnt.items())))
nk = design['neck']
pins = len(design['tooling'].get('regHoles') or [])
check(cnt.get(round(nk['screwBodyHole'], 4), 0) == 4, 'four neck screw holes at 3/16 in (4.763 mm): on the back sheet only, since the top sheet has the pocket notch there')
check(cnt.get(round(design['tooling']['regPin'], 4), 0) == 2 * pins, '%d alignment pin holes at 1/4 in on each of the two sheets' % pins)
check(cnt.get(3.18, 0) == 9, 'six string holes and three bridge screw marks at 3.18 mm')
check(cnt.get(round(5 / 16 * IN, 4), 0) == 6, 'six ferrule holes at 5/16 in on the back')
check(cnt.get(9.525, 0) == 2 and cnt.get(12.0, 0) == 1, 'two pot holes at 3/8 in and one toggle hole at 12 mm')
openings = sorted([(round(bbox(e)[2] - bbox(e)[0], 2), round(bbox(e)[3] - bbox(e)[1], 2)) for e in ins if not is_circle(e)])
print('  openings (w x h mm):', openings)
check((round(3.38 * IN, 2), round(1.65 * IN, 2)) in openings, 'humbucker opening is 3.38 x 1.65 in')
check(openings.count((round(3.34 * IN, 2), round(1.02 * IN, 2))) == 2 or sum(1 for w, h in openings if abs(w - 3.34 * IN) < 0.02 and abs(h - 1.02 * IN) < 0.05) == 2, 'two single-coil openings are 3.34 x 1.02 in')
# the pocket notch in the top outline: two long straight vertical edges one heel-width apart
top = max(outs, key=lambda e: len(e))
def vertical_runs(e):
    runs = []
    n = len(e)
    for i in range(n):
        a, b = e[i], e[(i + 1) % n]
        if abs(a[0] - b[0]) < 0.006 and abs(a[1] - b[1]) > 30: runs.append(((a[0] + b[0]) / 2, abs(a[1] - b[1]), abs(a[0] - b[0])))
    return runs
found = None
for e in outs:
    r = vertical_runs(e)
    if len(r) >= 2:
        xs = sorted(x for x, _, _ in r); found = (xs[-1] - xs[0], max(l for _, _, l in r))
check(found is not None and abs(found[0] - nk['heelWidth']) < 0.006, 'pocket notch walls are %.4f mm apart (heel width %.4f), each straight to within %.4f mm' % (found[0] if found else -1, nk['heelWidth'], found[1] if found else -1))
# body size from the outline
b = bbox(outs[0]); print('  template outline size: %.2f x %.2f mm (%.3f x %.3f in)' % (b[2] - b[0], b[3] - b[1], (b[2] - b[0]) / IN, (b[3] - b[1]) / IN))
# scale bars: horizontal open strokes exactly 100 mm and 50.8 mm long
hl = [abs(p['v'][1][0] - p['v'][0][0]) for p in polys if not p['closed'] and len(p['v']) == 2 and abs(p['v'][0][1] - p['v'][1][1]) < 1e-9]
long_bars = sum(1 for l in hl if abs(l - 100) < 1e-6 or abs(l - 50) < 1e-6); inch_bars = sum(1 for l in hl if abs(l - 50.8) < 1e-6)
check(long_bars >= 2 and inch_bars == 2, 'each sheet has a metric bar (exactly 100 or 50 mm) and a 2 in bar (exactly 50.8 mm)')

# ---------- SVG vs DXF ----------
m = re.search(r'width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"', svg_text)
W, H = float(m.group(3)), float(m.group(4))
check(abs(float(m.group(1)) - W) < 1e-6 and abs(float(m.group(2)) - H) < 1e-6, 'SVG is true size: 1 unit = 1 mm (%.1f x %.1f mm)' % (W, H))
def svg_arc(p0, rx, ry, large, sweep, p1, n=24):
    # SVG implementation notes F.6.5, x-axis-rotation = 0
    x1, y1 = p0; x2, y2 = p1
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    lam = dx * dx / (rx * rx) + dy * dy / (ry * ry)
    if lam > 1: rx *= math.sqrt(lam); ry *= math.sqrt(lam)
    num = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx
    den = rx * rx * dy * dy + ry * ry * dx * dx
    co = math.sqrt(max(0, num / den)) * (-1 if large == sweep else 1)
    cxp, cyp = co * rx * dy / ry, -co * ry * dx / rx
    cx, cy = cxp + (x1 + x2) / 2, cyp + (y1 + y2) / 2
    a1 = math.atan2((y1 - cy) / ry, (x1 - cx) / rx); a2 = math.atan2((y2 - cy) / ry, (x2 - cx) / rx)
    da = a2 - a1
    if sweep and da < 0: da += 2 * math.pi
    if not sweep and da > 0: da -= 2 * math.pi
    return [(cx + rx * math.cos(a1 + da * j / n), cy + ry * math.sin(a1 + da * j / n)) for j in range(1, n + 1)]
def parse_path(d):
    toks = re.findall(r'[MLAZ]|-?[\d.]+(?:e-?\d+)?', d); i = 0; pts = []; closed = False; cur = None
    while i < len(toks):
        t = toks[i]
        if t == 'M': cur = (float(toks[i + 1]), float(toks[i + 2])); pts.append(cur); i += 3
        elif t == 'L': cur = (float(toks[i + 1]), float(toks[i + 2])); pts.append(cur); i += 3
        elif t == 'A':
            rx, ry, rot, la, sw, x, y = [float(v) for v in toks[i + 1:i + 8]]
            pts += svg_arc(cur, rx, ry, int(la), int(sw), (x, y)); cur = (x, y); i += 8
        elif t == 'Z': closed = True; i += 1
        else: raise ValueError(t)
    return pts, closed
svg_paths = []; svg_circles = []
for layer, body in re.findall(r'<g id="(\w+)"[^>]*>(.*?)</g>', svg_text, re.S):
    for tag, d, cx, cy, r in re.findall(r'<(path) d="([^"]+)"/>|<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/>', body):
        if tag == 'path': svg_paths.append((layer, *parse_path(d)))
        else: svg_paths.append((layer, [(float(cx) + float(r) * math.cos(2 * math.pi * j / 96), float(cy) + float(r) * math.sin(2 * math.pi * j / 96)) for j in range(96)], True)); svg_circles.append(2 * float(r))
check(len(svg_paths) == len(polys), 'SVG has the same number of shapes as the DXF (%d)' % len(svg_paths))
check(sorted(round(d, 4) for d in svg_circles) == sorted(circles), 'SVG circles have the same diameters as the DXF circles')
# match each closed SVG path to the DXF loop with the same box, then compare the curves point by point
worst = 0; matched = 0
dx_closed = [(p['layer'], expand(p)) for p in closed]
for layer, pts, cl in svg_paths:
    if not cl: continue
    flipped = [(x, H - y) for x, y in pts]
    bb = bbox(flipped)
    best = min(dx_closed, key=lambda q: sum(abs(u - v) for u, v in zip(bbox(q[1]), bb)) + (0 if q[0] == layer else 1e6))
    if sum(abs(u - v) for u, v in zip(bbox(best[1]), bb)) > 0.05: continue
    matched += 1
    step = max(1, len(flipped) // 400)
    worst = max(worst, max(dist_to_poly(p, best[1]) for p in flipped[::step]))
    step = max(1, len(best[1]) // 400)
    worst = max(worst, max(dist_to_poly(p, flipped) for p in best[1][::step]))
check(matched == len(closed), 'every SVG cut loop pairs with a DXF loop (%d of %d)' % (matched, len(closed)))
check(worst < 0.02, 'SVG arcs and DXF arcs trace the same curves: worst gap %.4f mm' % worst)
# ---------- PDF ----------
import subprocess, shutil
if not shutil.which('pdfinfo'): print('  skip PDF page check: pdfinfo (poppler) is not installed')
for paper, (pw, ph) in (('letter', (612.0, 792.0)), ('a4', (595.28, 841.89))) if shutil.which('pdfinfo') else ():
    f = glob.glob(D + '/*-templates-%s.pdf' % paper)[0]
    info = subprocess.run(['pdfinfo', f], capture_output=True, text=True).stdout
    pages = int(re.search(r'Pages:\s+(\d+)', info).group(1)) if info else -1
    size = re.search(r'Page size:\s+([\d.]+) x ([\d.]+) pts', info)
    check(pages >= 6 and size and abs(float(size.group(1)) - pw) < 0.5 and abs(float(size.group(2)) - ph) < 0.5, '%s PDF: %d pages of %s x %s pt' % (paper, pages, size.group(1) if size else '?', size.group(2) if size else '?'))
# ---------- STEP (3D model of the body) ----------
def parse_step(text):
    body = text[text.index('DATA;') + 5:text.rindex('ENDSEC;')]
    ents = {}
    for m in re.finditer(r'#(\d+)\s*=\s*(.*?);\s*(?=#\d+\s*=|$)', body, re.S):
        raw = ' '.join(m.group(2).split())
        k = re.match(r'([A-Z0-9_]+)\s*\((.*)\)$', raw)
        ents[int(m.group(1))] = (k.group(1), k.group(2)) if k else ('COMPLEX', raw)
    return ents
def refs(a): return [int(x) for x in re.findall(r'#(\d+)', a)]
def nums(a): return [float(x) for x in re.findall(r'[-+]?\d+\.\d*(?:[eE][-+]?\d+)?', a)]
def step_report(path, rolled):
    text = open(path).read()
    E = parse_step(text)
    kinds = {}
    for k, _ in E.values(): kinds[k] = kinds.get(k, 0) + 1
    print('STEP', os.path.basename(path), len(E), 'entities;', {k: kinds.get(k, 0) for k in ('PLANE', 'CYLINDRICAL_SURFACE', 'B_SPLINE_SURFACE_WITH_KNOTS', 'TOROIDAL_SURFACE', 'ADVANCED_FACE')})
    check(text.startswith('ISO-10303-21;') and re.search(r'SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)', text) is not None, 'a STEP file in millimeters')
    check(kinds.get('MANIFOLD_SOLID_BREP', 0) == 1 and kinds.get('CLOSED_SHELL', 0) == 1, 'one solid with one closed skin')
    pt = lambda i: nums(E[i][1])[-3:]
    def placement(i):  # AXIS2_PLACEMENT_3D -> (origin, axis direction)
        r = refs(E[i][1]); return pt(r[0]), (pt(r[1]) if len(r) > 1 else [0.0, 0.0, 1.0])
    T = design['body']['thickness']
    vz = [pt(refs(a)[0])[2] for k, a in E.values() if k == 'VERTEX_POINT']
    check(abs(min(vz)) < 1e-6 and abs(max(vz) - T) < 1e-6, 'back face at height 0, top face at %.3f mm (corners span %.4f to %.4f)' % (T, min(vz), max(vz)))
    cyl = []
    for k, a in E.values():
        if k == 'CYLINDRICAL_SURFACE':
            o, ax = placement(refs(a)[0]); cyl.append((o, ax, nums(a.split(',')[-1])[0]))
    upright = [(o, r) for o, ax, r in cyl if abs(abs(ax[2]) - 1) < 1e-9]
    def has_cyl(x, y, r): return any(abs(o[0] - x) < 1e-4 and abs(o[1] - y) < 1e-4 and abs(rr - r) < 1e-6 for o, rr in upright)
    nk = design['neck']
    heel = nk['scale'] - nk['nutToHeel']; s0 = heel + nk['screwFromHeelEnd']; sa = nk['screwAcross'] / 2
    screws = [(sx, sy) for sy in (s0, s0 + nk['screwAlong']) for sx in (-sa, sa)]
    check(all(has_cyl(x, y, nk['screwBodyHole'] / 2) for x, y in screws), 'four neck screw holes are true cylinders, %.2f mm across, where the neck numbers put them' % nk['screwBodyHole'])
    check(all(has_cyl(c['x'], c['y'], c['d'] / 2) for c in design['controls']), '%d control holes are true cylinders at their places and sizes' % len(design['controls']))
    R = nk['heelCornerR']; hw = nk['heelWidth'] / 2
    if R > 0.05: check(has_cyl(-(hw - R), heel + R, R) and has_cyl(hw - R, heel + R, R), 'neck pocket corners are true %.3f mm arcs, one heel width (%.3f mm) apart' % (R, 2 * hw))
    floors = []
    for k, a in E.values():
        if k == 'PLANE':
            o, ax = placement(refs(a)[0])
            if abs(abs(ax[2]) - 1) < 1e-9: floors.append(o[2])
    want = [('neck pocket', T - nk['pocketDepth'])] + [('pickup cavity', T - p['depth']) for p in design['pickups']] + [(c['name'], c['depth'] if c['side'] == 'back' else T - c['depth']) for c in design['cavities']]
    miss = [n for n, zf in want if not any(abs(f - zf) < 1e-6 for f in floors)]
    check(not miss, 'a flat, level floor at the stated depth of every pocket (%d pockets)%s' % (len(want), '' if not miss else ': missing ' + ', '.join(miss)))
    curved = kinds.get('B_SPLINE_SURFACE_WITH_KNOTS', 0) + kinds.get('TOROIDAL_SURFACE', 0)
    return curved
steps = sorted(glob.glob(D + '/*-body-*.step'))
if not steps: print('  skip STEP checks: no 3D model was saved')
else:
    curved = {('rolled' if 'rolled' in f else 'square'): step_report(f, 'rolled' in f) for f in steps}
    if len(curved) == 2: check(curved['rolled'] > curved['square'], 'the rolled-edge file carries the roundover surfaces the square-edged file lacks (%d against %d curved faces)' % (curved['rolled'], curved['square']))
    try:
        import gmsh
    except Exception:
        gmsh = None; print('  skip the gmsh measurement: the gmsh Python package is not installed (or cannot load)')
    if gmsh:
        # the outline's true extent, from the design's own Bezier points
        nodes = design['outline']['nodes']
        if design['outline'].get('symmetric'):
            nodes = nodes + [dict(n, x=-n['x'], ix=-n['ox'], ox=-n['ix'], iy=n['oy'], oy=n['iy']) for n in reversed(nodes[1:-1])]
            nodes[0] = dict(nodes[0], x=0, ix=-nodes[0]['ox'], iy=nodes[0]['oy'])
            m = len(design['outline']['nodes']) - 1; nodes[m] = dict(nodes[m], x=0, ox=-nodes[m]['ix'], oy=nodes[m]['iy'])
        xs, ys = [], []
        for i, a in enumerate(nodes):
            b = nodes[(i + 1) % len(nodes)]
            P = [(a['x'], a['y']), (a['x'] + a['ox'], a['y'] + a['oy']), (b['x'] + b['ix'], b['y'] + b['iy']), (b['x'], b['y'])]
            for j in range(2001):
                t = j / 2000.0; u = 1 - t
                xs.append(u ** 3 * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t ** 3 * P[3][0])
                ys.append(u ** 3 * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t ** 3 * P[3][1])
        sq = [f for f in steps if 'square' in f]
        for f in (sq or steps)[:1]:
            gmsh.initialize(); gmsh.option.setNumber('General.Terminal', 0)
            gmsh.model.occ.importShapes(f); gmsh.model.occ.synchronize()
            vols = gmsh.model.getEntities(3)
            check(len(vols) == 1, 'gmsh opens %s as one solid' % os.path.basename(f))
            bb = gmsh.model.getBoundingBox(*vols[0]); vol = gmsh.model.occ.getMass(*vols[0])
            gmsh.finalize()
            T = design['body']['thickness']
            contours = design['contours']['arm']['on'] or design['contours']['belly']['on']
            print('  gmsh: volume %.0f mm^3, box x %.3f to %.3f, y %.3f to %.3f, z %.3f to %.3f' % (vol, bb[0], bb[3], bb[1], bb[4], bb[2], bb[5]))
            if contours: print('  (with an arm bevel or belly cut, gmsh reports a loose box around their curved faces, so only the volume is checked)')
            else: check(abs(bb[0] - min(xs)) < 0.01 and abs(bb[3] - max(xs)) < 0.01 and abs(bb[1] - min(ys)) < 0.01 and abs(bb[4] - max(ys)) < 0.01 and abs(bb[2]) < 0.01 and abs(bb[5] - T) < 0.01, 'gmsh measures the model at the outline\'s true size and the body thickness')
            check(0.5 * (max(xs) - min(xs)) * (max(ys) - min(ys)) * T < vol < (max(xs) - min(xs)) * (max(ys) - min(ys)) * T, 'gmsh volume is a believable share of the blank (%.0f%%)' % (100 * vol / ((max(xs) - min(xs)) * (max(ys) - min(ys)) * T)))
print('ALL OK' if ok else 'PROBLEMS FOUND')
sys.exit(0 if ok else 1)
