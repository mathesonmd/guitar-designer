// Fetches the 3D engine the first time a 3D model is saved, and keeps it for the rest of the visit.
// The engine is OpenCascade (the open-source CAD kernel) built for the browser, with the replicad
// wrapper. It is large, so it is not part of the page: nothing is fetched until someone asks for a
// 3D model. Versions come from package.json by way of build.mjs.
/* global __CAD_WRAPPER_VERSION__, __CAD_ENGINE_VERSION__ */
const NPM = 'https://cdn.jsdelivr.net/npm/';
export const CAD_FILES = {
  wrapper: `${NPM}replicad@${__CAD_WRAPPER_VERSION__}/dist/replicad.umd.cjs`,
  engine: `${NPM}replicad-opencascadejs@${__CAD_ENGINE_VERSION__}/dist/replicad_single.js`,
  wasm: `${NPM}replicad-opencascadejs@${__CAD_ENGINE_VERSION__}/dist/replicad_single.wasm`,
};

async function text(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('fetch ' + res.status);
  return res.text();
}

// Run fetched JavaScript as a script of its own. Going through a Blob means it does not matter what
// file type the CDN reports for it.
function run(code, type) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const s = document.createElement('script');
    if (type) s.type = type;
    s.onload = () => { URL.revokeObjectURL(url); s.remove(); resolve(); };
    s.onerror = () => { URL.revokeObjectURL(url); s.remove(); reject(new Error('script')); };
    s.src = url;
    document.head.appendChild(s);
  });
}

async function load() {
  const [wrapper, engine] = await Promise.all([text(CAD_FILES.wrapper), text(CAD_FILES.engine)]);
  await run(wrapper);
  const rc = window.replicad;
  if (!rc || !rc.setOC) throw new Error('wrapper');
  // the engine file is a JavaScript module whose default export starts it
  await run(engine.replace(/export\s+default\s+Module\s*;?\s*$/, 'window.__bcsCadStart = Module;'), 'module');
  const start = window.__bcsCadStart;
  if (typeof start !== 'function') throw new Error('engine');
  const oc = await start({ locateFile: () => CAD_FILES.wasm });
  rc.setOC(oc);
  return { rc, oc };
}

let pending = null;
// Resolves to { rc, oc }. A failed try is forgotten, so the next click tries again.
export function loadCadEngine() {
  if (!pending) pending = load().catch((e) => { pending = null; throw e; });
  return pending;
}
export const cadEngineReady = () => !!(typeof window !== 'undefined' && window.replicad && window.__bcsCadStart && pending);
