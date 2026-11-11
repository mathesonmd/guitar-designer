# Black Chapel Guitar Designer: working rules

A one-page web app for Black Chapel Studios. People draw a solid-body guitar, fit an off-the-shelf
bolt-on neck, place pickups and hardware, and save true-size routing templates (DXF, SVG, tiled PDF).
It is a sibling of the Fretboard Designer and keeps the same branding. `README.md` covers the layout
of the code and the template conventions; read it before changing either.

## The owner's standing rules

The owner builds guitars and teaches guitar building; he is not a software engineer. People cut wood
from what this app produces, so these rules carry more weight than speed.

1. **No number without a source.** Every built-in dimension lives in `src/data` with a basis tag
   (`published`, `scaled`, `shop`, `assumed`) and a key into `src/data/sources.js`. Never invent a
   dimension or a shop convention. If no source exists, tag it `assumed`, let the badge show in the
   app, and if it affects fit add it to the "measure before you cut" list.
2. **Nothing half-finished presented as done.** If a feature is an approximation, the screen says so
   in plain words. If it cannot be done properly yet, leave it out and list it under "Not built".
3. **Report every change in three groups:** tested (what was actually run), reasoned but not tested,
   and assumed. Do not blur them.
4. **American English** everywhere: center, gray, mold, color, millimeters.
5. **Plain labels.** No shop shorthand ("op", "bore") and no programmer names on screen. A label says
   what the thing is or what it does.
6. **Explain in plain language.** When he has to do something himself, give the exact steps.

## Before saying a change is done

    npm test                  # 51 geometry and export tests (13 of them build the CAD solid)
    npm run build
    node test/interact.mjs    # 31 click-through steps in headless Chromium
    node test/viewer.mjs      # 22 checks of the claude.ai artifact build

All must pass. Add a test for every new behavior and for every bug fixed. The two browser scripts need
Playwright with Chromium, which is not in `package.json`: Anthropic's cloud sessions have it installed;
on another machine install it first.

When an export changes, also run `python3 tools/check_exports.py` after the click-through. It re-reads
the files the page really saved with its own DXF, SVG and STEP readers, sharing no code with the app. That
is how the pocket width, hole diameters, curve agreement and the STEP file's holes and pocket floors were
confirmed. If the `gmsh` Python package is installed it also opens the STEP file with a second program.

## Geometry

- Everything is millimeters inside the app. Inches are a display choice, and a choice of unit for the CNC
  files (DXF vectors and STL), which are scaled as they are written. STEP is always millimeters.
- x = 0 is the centerline, +x is the treble side (seen from the front, neck up).
- y = 0 is the scale line, exactly one scale length from the nut. +y points to the neck.
- z = 0 is the back face.
- A mirrored outline stores only the bass half.

## 3D: two solids, kept in agreement

- `src/model/solid.js` is a stack of flat slices. It drives the 3D picture and the weight, and never fails.
- `src/export/step.js` is the true CAD solid for the STEP file, built by OpenCascade through replicad.
  The STL is a mesh of that same solid (facets within 0.02 mm), not of the slices.
- The owner cuts guitars from Vectric Aspire, which opens STL but not STEP. He prefers STEP where a
  program takes it. Keep both.
- He always cuts pockets from 2D vectors, never from the 3D model. `src/export/cnc.js` writes those
  vectors (finished edge, true position, back file mirrored across the centerline, one layer per kind of
  cut named with its depth). The 3D model can leave pockets and holes out so it carries only contours.
  Ask him before changing the layer naming or the mirroring.
- He designs from scratch in metric, but most classic designs are imperial: every file and screen must
  work in both.
- Hole depths for bridge hardware are never built in (his decision): they vary too widely. The builder
  enters them (`design.bridge.depths`, by group); until then the hole is a circle with no depth.
- Vectors and model must share one bounding box, because Aspire users center each import. Keep guide
  lines and anything else inside the body outline's box.
- `test/step.test.mjs` holds their volumes within 0.1% of each other. A new contour or cut goes into both,
  and that test is how a mistake in either one shows up. Check volume after every engine change: a faster
  way of cutting pockets once gave a body 7% too heavy with no error at all.
- No depth without a source applies here too: a hole with no recorded depth is left out of the STEP file
  and named in the save dialog, never drilled to a guess.
- The direction (owner's decision, November 2026): this becomes a guitar-specific CAD/CAM tool. 2D stays
  the master for pockets so they cut crisply; 3D tools are for body contours, neck heels and volutes.
  Body first, then the neck.

## Template conventions (ask the owner before changing these)

- Layers: `ENGRAVE` black, `CUT_INSIDE` blue (cut first), `CUT_OUTSIDE` red (cut last).
- Bearing-guided bit: template edge is the finished edge. Guide bushing: (bushing − bit) ÷ 2.
- Back sheets are mirrored. Round holes are true circles. Straight edges 6 mm or longer are kept exactly.
- The neck pocket is either a notch in the top template (his T-style master) or its own template
  (his J-style set). Notch is the default until he decides otherwise.
- Unconfirmed neck numbers are engraved as CHECK notes until confirmed on a real neck.

## State of the work (November 2026)

**Built:** outline editor with four starting shapes and reference overlays; Fender-pattern neck presets
and custom necks; six pickup cavities plus a custom rectangle; three bridges; controls and back cavity;
arm bevel (flat) and belly cut (dished); live build checks; 3D view; templates with bearing or bushing
offsets, laser kerf, alignment pins, engraved legend; DXF, SVG, PDF and zip export; 2D CNC vectors for
pockets and holes, in millimeters or inches; a 3D model of the body as STEP (true solid) or STL (fine
mesh), with rolled or square edges and with or without the pockets; on/off switches for each edge
roundover; a binding channel; hole depths entered per hardware.

**Not built:** tremolos, basses, set necks and angled pockets, fanned frets, left-handed bodies,
carved tops, a 3D neck (profile, heel, volute, headstock), STEP roundovers larger than the outline's
tightest outside curve, smooth run-outs for the arm bevel and belly cut (asked for; shape not yet agreed),
the binding channel on the routing templates, whole-guitar balance, ordering cut templates.

**Never checked in the real world:** nothing has been cut on a laser or routed in wood; the files have
not been opened in LightBurn, Vectric or Fusion (the owner opened a STEP file in his 3D printing slicer,
where it measured exactly right: 326.00 x 472.74 x 44.45 mm, and the STL in Vectric Aspire 12.5, where it
showed the same size and clean pockets, and the millimeter CNC vector files there too: layers, dotted
layer names and true circles all came through; inch files have only been re-read by our own checker);
the 3D engine has never been fetched from the real CDN, only from a local copy in the tests; the published artifact has not been opened signed in;
touch gestures, Safari and Firefox are untried.

**Waiting on the owner:**
- Whether the T-style and J-style outlines (traced from his class templates) ship in a public release.
- Notch or separate template as the neck pocket default.
- Where alignment pins go in his shop, and whether they go through the body.
- How ordering a cut template should work.
- What "smooth transitions" on the arm bevel and belly cut should look like (a rounded crease where the
  cut meets the face, a curved bevel, ends that fade out, or all three).
- Whether centering now lines the vectors up exactly with the model in Aspire, and whether inch files
  import at the right size.

## Things that are easy to get wrong

- `src/data/shop.js` is generated from the owner's class-template files, which are not in this
  repository. Do not edit it by hand.
- The page loads React, three.js, Clipper and jsPDF from CDNs at the exact versions pinned in
  `package.json`. Change both together, and keep `build.mjs` in step.
- Inside a claude.ai artifact a page cannot start a download. Saves go through the viewer's downloads
  capability (`src/ui/files.js`), which refuses `.dxf`; that is why the DXF travels inside the zip.
- The 3D engine (replicad and replicad-opencascadejs) is pinned under `devDependencies`. It is fetched only
  when a 3D model is saved; `build.mjs` reads the versions from `package.json`, and `test/browser.mjs`
  serves the same files from `node_modules`. Change the two packages together: they are a matched pair.
- Rebuild before committing so `dist/` matches `src/`.
