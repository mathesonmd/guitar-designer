// Builds the designer into single HTML files:
//   dist/index.html     complete page for hosting (Cloudflare, like the Fretboard Designer)
//   dist/artifact.html  page content only, for publishing as a claude.ai artifact
// Libraries load from CDNs; the app's own code, styles and logo are inlined.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const shim = (f) => path.join(root, 'src/shims', f);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const result = await build({
  entryPoints: [path.join(root, 'src/main.jsx')],
  bundle: true, format: 'iife', write: false, minify: true, target: ['es2019'],
  jsx: 'transform', loader: { '.js': 'jsx' },
  alias: { react: shim('react.cjs'), 'react-dom/client': shim('react-dom-client.cjs'), three: shim('three.cjs'), 'clipper-lib': shim('clipper.cjs'), jspdf: shim('jspdf.cjs') },
  // the 3D engine is fetched on demand at the versions pinned in package.json (see src/ui/cadEngine.js)
  define: { __CAD_WRAPPER_VERSION__: JSON.stringify(pkg.devDependencies.replicad), __CAD_ENGINE_VERSION__: JSON.stringify(pkg.devDependencies['replicad-opencascadejs']) },
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const icon = fs.readFileSync(path.join(root, 'src/assets/logo.js'), 'utf8').match(/ICON = "([^"]+)"/)[1];

export const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js',
  'https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
];
const TITLE = 'Black Chapel Guitar Designer';
const DESC = 'Draw your own solid-body guitar, fit an off-the-shelf neck, place pickups and hardware, and export true-size routing templates. From Black Chapel Studios.';

const content = `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
${css}
</style>
<div id="root"><div class="loadfail"><p>Loading the Guitar Designer…</p></div></div>
${CDN.map((u) => `<script src="${u}"></script>`).join('\n')}
<script>
(function () {
  var need = { React: 'React', ReactDOM: 'ReactDOM', THREE: 'three.js', ClipperLib: 'Clipper', jspdf: 'jsPDF' }, missing = [];
  for (var k in need) if (!window[k]) missing.push(need[k]);
  if (missing.length) {
    document.getElementById('root').innerHTML = '<div class="loadfail"><h2>The designer could not load</h2><p>These libraries did not arrive: ' + missing.join(', ') + '. Check your connection and reload the page.</p></div>';
    return;
  }
${js}
})();
</script>
`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/artifact.html'), content);
fs.writeFileSync(path.join(root, 'dist/index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${DESC}">
<meta name="author" content="Black Chapel Studios">
<link rel="icon" type="image/png" href="${icon}">
</head>
<body>
${content}</body>
</html>
`);
console.log('built', (content.length / 1024).toFixed(0) + ' KB', 'app js', (js.length / 1024).toFixed(0) + ' KB');
