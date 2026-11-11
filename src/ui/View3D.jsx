import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { buildBodyMesh } from '../model/mesh.js';
import { useSize, Seg, Check } from './widgets.jsx';

const WOOD_COLOR = { alder: 0xb68a5c, basswood: 0xd6bf97, poplar: 0xc4b98a, mahogany: 0x7c4a33, walnut: 0x5d4333, ash: 0xd8bd8c, maple: 0xe2c898, custom: 0xb68a5c };

export default function View3D({ design, g, solid, onSaveModel }) {
  const wrap = useRef(null), canvas = useRef(null);
  const size = useSize(wrap);
  const three = useRef(null);
  const [parts, setParts] = useState(true);
  const [failed, setFailed] = useState(false);

  // one-time scene setup
  useEffect(() => {
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: canvas.current, antialias: true, alpha: true }); } catch (e) { setFailed(true); return undefined; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 10, 8000);
    // The key light comes in at a slant so shallow contours (arm bevel, belly cut) shade differently from the flats.
    scene.add(new THREE.HemisphereLight(0xfff4e6, 0x2a2622, 0.42));
    const key = new THREE.DirectionalLight(0xffeedd, 0.8); key.position.set(520, 460, 720); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffeedd, 0.22); fill.position.set(-500, 200, 400); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xe2b98a, 0.5); rim.position.set(-420, 380, -600); scene.add(rim);
    const body = new THREE.Group(), extras = new THREE.Group();
    scene.add(body, extras);
    const st = { renderer, scene, camera, body, extras, target: new THREE.Vector3(0, 60, 20), r: 1150, az: -0.5, pol: 1.22, raf: 0 };
    st.render = () => {
      if (st.raf) return;
      st.raf = requestAnimationFrame(() => {
        st.raf = 0;
        const sp = Math.sin(st.pol), cp = Math.cos(st.pol);
        camera.position.set(st.target.x + st.r * sp * Math.sin(st.az), st.target.y - st.r * cp, st.target.z + st.r * sp * Math.cos(st.az));
        camera.up.set(0, 1, 0);
        camera.lookAt(st.target);
        renderer.render(scene, camera);
      });
    };
    three.current = st;

    // orbit controls: drag to turn, shift-drag or right-drag to slide, wheel or pinch to zoom
    const el = canvas.current;
    const ptrs = new Map();
    let last = null, pinch = 0;
    const down = (e) => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 }; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } };
    const move = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) st.r = Math.max(200, Math.min(4000, (st.r * pinch) / d)); pinch = d; st.render(); return; }
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last.x = e.clientX; last.y = e.clientY;
      if (last.pan) { const k = st.r / 900; st.target.x -= dx * k * Math.cos(st.az); st.target.y += dy * k; }
      else { st.az -= dx * 0.008; st.pol = Math.max(0.12, Math.min(Math.PI - 0.12, st.pol - dy * 0.008)); }
      st.render();
    };
    const up = (e) => { ptrs.delete(e.pointerId); pinch = 0; };
    const wheel = (e) => { e.preventDefault(); st.r = Math.max(200, Math.min(4000, st.r * Math.exp(e.deltaY * 0.0012))); st.render(); };
    const ctx = (e) => e.preventDefault();
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false }); el.addEventListener('contextmenu', ctx);
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel); el.removeEventListener('contextmenu', ctx);
      cancelAnimationFrame(st.raf); clear(body); clear(extras); renderer.dispose(); three.current = null;
    };
  }, []);

  useEffect(() => {
    const st = three.current;
    if (!st || !size.w || !size.h) return;
    st.renderer.setSize(size.w, size.h, false);
    st.camera.aspect = size.w / size.h;
    st.camera.updateProjectionMatrix();
    st.render();
  }, [size.w, size.h]);

  // rebuild the body whenever the design changes
  useEffect(() => {
    const st = three.current;
    if (!st || !solid) return;
    clear(st.body);
    const m = buildBodyMesh(solid, g.outline);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    const mat = new THREE.MeshStandardMaterial({ color: WOOD_COLOR[design.body.wood] || WOOD_COLOR.alder, roughness: 0.56, metalness: 0.02 }); // the mesh is closed and wound outward, so back faces are never needed
    st.body.add(new THREE.Mesh(geo, mat));
    st.target.set(0, (g.bbox.y0 + g.bbox.y1) / 2 + (parts ? 90 : 0), solid.T / 2);
    st.render();
  }, [solid, g, design.body.wood, parts]);

  // neck and hardware, for looks only
  useEffect(() => {
    const st = three.current;
    if (!st || !solid) return;
    clear(st.extras);
    if (!parts) { st.render(); return; }
    const T = solid.T, nk = design.neck;
    const zHeelTop = T + nk.heelStandProud, zBoardTop = zHeelTop + (g.neck ? g.neck.board : 5);
    const mat = (color, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const maple = mat(0xdcc394, 0.55), board = mat(0x3a281d, 0.7), metal = mat(0x8f949a, 0.42, 0.35), black = mat(0x151515, 0.5), bone = mat(0xede6d8, 0.5);
    const ex = (poly, z0, z1, material) => {
      const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.z = z0;
      st.extras.add(mesh);
    };
    // the neck's own shape (model/neck.js): the heel block in the pocket and the shaft through its
    // cross-sections; then a plain paddle headstock, which is only a stand-in
    const h = g.neckHalf;
    const neck = g.neck, zTop = neck ? neck.top : zHeelTop;
    if (neck) {
      ex(neck.heel, neck.heelBottom, neck.top, maple);
      const secs = neck.sections, pos = [], P = (s, p) => [p.x, s.y, neck.top + p.z];
      for (let i = 0; i < secs.length - 1; i++) {
        const a = secs[i], b = secs[i + 1], m = a.pts.length;
        for (let j = 0; j < m - 1; j++) pos.push(...P(a, a.pts[j]), ...P(b, b.pts[j]), ...P(b, b.pts[j + 1]), ...P(a, a.pts[j]), ...P(b, b.pts[j + 1]), ...P(a, a.pts[j + 1]));
        // the flat top between the two sections
        pos.push(...P(a, a.pts[0]), ...P(a, a.pts[m - 1]), ...P(b, b.pts[m - 1]), ...P(a, a.pts[0]), ...P(b, b.pts[m - 1]), ...P(b, b.pts[0]));
      }
      const first = secs[0]; // the end at the nut
      for (let j = 1; j < first.pts.length - 1; j++) pos.push(...P(first, first.pts[0]), ...P(first, first.pts[j + 1]), ...P(first, first.pts[j]));
      const shaft = new THREE.BufferGeometry(); shaft.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); shaft.computeVertexNormals();
      const shaftMat = maple.clone(); shaftMat.side = THREE.DoubleSide;
      st.extras.add(new THREE.Mesh(shaft, shaftMat));
    }
    const hw = h(g.nutY);
    ex([{ x: -hw, y: g.nutY }, { x: hw, y: g.nutY }, { x: hw + 16, y: g.nutY + 40 }, { x: hw + 14, y: g.nutY + 165 }, { x: -hw + 4, y: g.nutY + 178 }, { x: -hw - 6, y: g.nutY + 40 }], zHeelTop - 13, zHeelTop, maple);
    ex(g.fretboard, zHeelTop, zBoardTop, board);
    for (const f of g.frets) { const m = new THREE.Mesh(new THREE.BoxGeometry(f.half * 2, 2.2, 1.1), metal); m.position.set(0, f.y, zBoardTop + 0.5); st.extras.add(m); }
    const nut = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 3.2, 3), bone); nut.position.set(0, g.nutY + 1.6, zBoardTop + 1.2); st.extras.add(nut);
    // bridge, pickups, knobs
    g.bridge.outlines.forEach((o) => ex(o, T, T + (design.bridge.type === 'tom' ? 9 : 3), metal));
    for (const p of g.pickups) if (p.body) ex(p.body, T - 2, T + 3.5, black);
    for (const hole of g.holes) {
      if (hole.kind === 'control') { const k = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 10.5, 11, 28), metal); k.rotation.x = Math.PI / 2; k.position.set(hole.x, hole.y, T + 6.5); st.extras.add(k); }
      if (hole.kind === 'stud') { const k = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 12, 16), metal); k.rotation.x = Math.PI / 2; k.position.set(hole.x, hole.y, T + 5); st.extras.add(k); }
    }
    // strings
    const sp = [];
    const zSaddle = T + (design.bridge.type === 'tom' ? 11 : 8);
    for (const s of g.strings) sp.push(s.nut.x, s.nut.y, zBoardTop + 2.6, s.saddle.x, s.saddle.y, zSaddle);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    st.extras.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0xd9dde2 })));
    st.render();
  }, [solid, g, parts, design.neck, design.bridge.type]);

  const look = (az, pol) => { const st = three.current; if (st) { st.az = az; st.pol = pol; st.render(); } };

  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={canvas} aria-label="3D view of the body. Drag to turn it, scroll to zoom." />
      {failed && <div className="toast">3D needs WebGL, which this browser or device has turned off. The drawing and templates still work.</div>}
      <div className="viewopts">
        <Seg label="View" value="" onChange={(v) => look(...{ front: [0, Math.PI / 2 - 0.001], back: [Math.PI, Math.PI / 2 - 0.001], angle: [-0.5, 1.22], edge: [Math.PI / 2, Math.PI / 2 - 0.001] }[v])}
          options={[{ value: 'angle', label: 'Angle' }, { value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }, { value: 'edge', label: 'Edge' }]} />
        <div className="float" style={{ position: 'static' }}><Check checked={parts} onChange={setParts}>Neck and hardware</Check></div>
        {onSaveModel && <button className="btn" onClick={onSaveModel}>Save files for CNC…</button>}
      </div>
      <div className="hintline"><span>Drag to turn · Shift-drag to slide · scroll to zoom</span><span>The headstock, fretboard and hardware are shown for looks</span></div>
    </div>
  );
}

function clear(group) {
  for (const c of [...group.children]) {
    group.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
}
