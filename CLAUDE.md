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

    npm test                  # 85 geometry and export tests (43 of them build the CAD solid)
    npm run build
    node test/interact.mjs    # 34 click-through steps in headless Chromium
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
- The owner's picture of the contours (November 2026): the arm bevel is what a wide flat sander leaves
  when the body is rolled against it, so it is curved in one direction only and straight in the other;
  the belly cut is a wide, short cone removed like a boolean cut, with a short smooth transition.
  Do not make the arm bevel doubly curved by default.
- The bevel around the top edge (`src/model/edgebevel.js`, `g.bevelEdge`) defines its surface once, as
  sections that pair up point for point; both solids join matching points with straight lines, so they
  agree to about 0.002%. The owner's first sample had a wavy inner line: the line must be a smooth curve
  through the moved points (never the outline's own handles carried across), and widths must blend
  smoothly between points. `test/step.test.mjs` checks for kinks and for wobble.
- Never save a CAD solid unchecked. `buildBodySolid` takes `expectVolume` (the sliced solid's volume for
  the same body) and refuses, or falls back, when they disagree. OpenCascade has silently returned wrong
  solids three times so far: overlapping pocket cutters, a purfling channel on the bevel's crease, and a
  fully rolled bevel that only touched the top face. Avoid cuts where two surfaces merely touch.
- Do not cut the purfling channel in the CAD solid along the bevel's crease: OpenCascade returned flawed
  solids, wrong volumes and a crash on some outlines, and took about 20 seconds when it worked. The 3D
  view derives the body with a coarser outline (tol 0.1) than the files do: anything that measures
  against the outline polygon must allow for that, or the picture and the file will differ.
- The neck (`src/model/neck.js`) is cross-sections along its length; the CAD solid joins them with
  straight lines and must match their volume within 1.5%. Draw every cross-section with the same pieces,
  point for point, or the skin fails. After dozens of builds in one process the engine starts failing on shapes it
  normally builds (the neck tests have their own file for that reason); the dialog tells people to
  reload the page.
- Contours live in `solid.js` as depth functions (`bevelPlane`, `bevelProfile`, `bellyDish`); `step.js`
  builds its cutters from the same profile pieces, so change the math in `solid.js` first. The belly rim
  blend is the one place the two differ on purpose: true rolled radius in CAD, close approximation in the
  slices, stated on screen. The arm bevel never cuts past either end of its line, in either solid.
- `test/step.test.mjs` holds their volumes within 0.1% of each other. A new contour or cut goes into both,
  and that test is how a mistake in either one shows up. Check volume after every engine change: a faster
  way of cutting pockets once gave a body 7% too heavy with no error at all.
- No depth without a source applies here too: a hole with no recorded depth is left out of the STEP file
  and named in the save dialog, never drilled to a guess.
- The neck's headstock (owner's decision, 13 November 2026): angled with a volute first (built), its
  outline drawn in the app the way the body outline is; a flat (Fender-style) headstock is needed as well
  (built 14 November 2026).
  The drawing edits whichever outline the selection names (`sel.of === 'head'`); the headstock's points
  are stored from the nut line and shown `g.nutY` higher.
  He said the first neck models "look really good for a first try".
- He called the first headstock "unusable": a slab stuck on a shaft, "glued to the other with no shaping".
  The second still looked to him "like 3 independent shapes, each with a clunky transition": a seam at
  the nut and a step where the flat began. His picture of it (13 November 2026): the back of the neck and
  headstock is one surface; the volute is highest on the crown of the back and runs out completely flat
  into the sides of the neck (no raised seam at the neck's edge); its slope toward the heel can be
  shallower than its slope toward the headstock; its heel side is rounded like a U for the hand; many
  have a peak under the nut; a Fender neck is "more of a transition to the headstock shape".
- How the neck is built now (`neck.js`, `buildNeckSolid`): cross-sections every 1 mm where the shape
  changes, joined by straight lines, with the heel block and the flat of the headstock stitched on edge
  to edge. No cuts, no fuses. Do not go back to a smooth loft through many sections (it rippled on some
  settings and still passed the engine's validity check), to trimming a lofted surface with cuts (wrong
  one time in three), or to fusing blocks on (flawed one time in four). After any change to the neck,
  run a sweep of randomized settings, not just the starting neck.
- After the third version he said "getting closer on the volute" and sent photos of tongue and dart
  volutes: a flat with a crisp U or pointed edge standing on the back of the neck, a cove outside it.
  That is the "Tongue" volute shape (`head.tongue`). He would model this in CAD by drawing several guide
  lines and lofting between them, and asked for the side view next: built (`head.side`, the side view
  editor). Then both the tongue's outline as a drawn line (`head.tongueLine`, the tongue outline editor)
  and the flat Fender-style headstock (`head.kind === 'flat'`: level, face stepped down, a scoop from the
  nut) on 14 November 2026.
- He found the drawn side view "wavy in places and you can't fix it" and asked for Bezier curves
  (17 November 2026): both drawn lines now have handles on every point (`handleCurve`, `lineEdit.js`).
  A point without its own handles keeps the automatic smooth line.
  His first try of them: "they aren't right. They should be tangential to the line". Two causes, both
  fixed: handles were drawn without the slope of the plain line under them, and the neck was not built
  to exactly the curve shown (sections past the nut lean). Now every section's crown lies on the drawn
  curve (`head.centerOut`, tested by `onCurve` in `test/neck.test.mjs`) and a handle lies along it.
  Check any change to the side view by measuring, on the picture, the angle between a handle and the curve.
- Tuner holes (his go-ahead, 17 November 2026): from numbers, in the headstock's own vector file
  (`...-cnc-headstock.dxf`, a third file in the pack, layers `HEADSTOCK_OUTLINE`,
  `GUIDE_CENTERLINE_AND_NUT_LINE`, `THROUGH_TUNER_<size>_HOLE`). He has not yet seen that file or its
  layer names: ask before changing them, as with the body's. The hole size has no source (assumed, on
  the measure-before-you-cut list).
- Number boxes (`Len`, `Num` in `widgets.jsx`) write nothing unless typed in. Before that, a box that
  still held focus could re-apply its old text after another control changed its value (a thickness
  typed, then a profile picked): it showed up as a click-through step failing one run in three.
- The Smooth / Corner / Delete bar must never cover the point being adjusted (his complaint): it sits
  about 100 px below a point in the upper half of the drawing and above one in the lower half.
- Look at the neck before sending him any change: the "Back of headstock" view in the app, and a shaded
  rendering of the saved STL itself (he judges the STL in a shiny viewer, where seams show that the app's
  picture hides). The first headstock was sent checked by numbers only.
- Electric Herald is a collection of other people's drawings, mostly 1:1 PDFs, "left intact with respect
  to original publishers", with accuracy not guaranteed and no license granting reuse. Do not bundle its
  files or take built-in numbers from them. People can load their own downloads as reference overlays.
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
arm bevel (rolled like a flat-sander cut: straight along its line, curved across it; optionally flatter,
blended, or kept between its squares with a run-out) and belly cut (a wide, short cone sized by center,
length, reach and depth, with a short rim blend); a bevel around the top edge shaped from an inner line
(a width and a depth at each outline point, tapering to nothing where a width is 0, flat or rolled),
with a purfling channel along its inner line; live build checks; 3D view; templates with bearing or bushing
offsets, laser kerf, alignment pins, engraved legend; DXF, SVG, PDF and zip export; 2D CNC vectors for
pockets and holes, in millimeters or inches; a 3D model of the body as STEP (true solid) or STL (fine
mesh), with rolled or square edges and with or without the pockets; on/off switches for each edge
roundover; a binding channel; hole depths entered per hardware; the neck as a 3D model: shaft and heel
(thickness from Warmoth's published profiles, a flat top for the fretboard, a heel that fills the pocket)
and a headstock, its outline drawn in the app, its back one surface with the neck's, with a smooth or
peaked volute on the crown of the back, or a tongue (a flat with a crisp edge and a cove); the side view of the back and the tongue's
outline can each be drawn in place of the numbers; the headstock can be angled back or flat (level with
the neck, its face stepped down, with a scoop from the nut); both drawn lines have Bezier handles; tuner
holes (three a side or six in a line) on the drawing and in the headstock's own vector file.

**Not built:** tremolos, basses, set necks and angled pockets, fanned frets, left-handed bodies,
carved tops, dragging tuner holes on the drawing, string paths to the tuners, the nut slot, the neck's truss rod channel and
heel screw holes, a sculpted
heel on the body, STEP roundovers larger than the outline's
tightest outside curve, the purfling channel in the STEP and STL (it is in the 3D picture and the CNC
vectors only), the binding channel on the routing templates, whole-guitar balance, ordering cut templates.

**Never checked in the real world:** nothing has been cut on a laser or routed in wood; the files have
not been opened in LightBurn, Vectric or Fusion (the owner opened a STEP file in his 3D printing slicer,
where it measured exactly right: 326.00 x 472.74 x 44.45 mm, and the STL in Vectric Aspire 12.5, where it
showed the same size and clean pockets, and the millimeter CNC vector files there too: layers, dotted
layer names and true circles all came through; he also looked at the arm bevel, belly cut and rolled edge
bevel there and found them smooth; inch files have only been re-read by our own checker);
the real CDNs serve every library file, the 3D engine included, byte for byte the same as the copies the
tests use, with the headers the loader needs (checked 13 November 2026; the engine is 5.7 MB compressed),
but no browser has yet loaded the engine from them; the published artifact has not been opened signed in;
touch gestures, Safari and Firefox are untried.

**Waiting on the owner:**
- Whether the T-style and J-style outlines (traced from his class templates) ship in a public release.
- Notch or separate template as the neck pocket default.
- Where alignment pins go in his shop, and whether they go through the body.
- How ordering a cut template should work.
- Whether the demo copies of the app work for him (the artifact, and `dist/index.html` opened from disk).
- The headstock: whether the tongue matches his photos, whether the two drawn lines (side view, tongue
  outline) give him the control he wants, whether the flat headstock's scoop and step look right, whether
  "peak" means a point on the crown, as built; and his numbers for angle, thickness, transition, volute,
  tongue, and the flat headstock's step and scoop; whether the headstock vector file and its layer names
  suit him, and his tuner hole size and spacing.
- Electric Herald (electricherald.com): whether to ask its owner about linking to or working with the
  collection, and whether importing a PDF drawing as a reference is worth building.
- He would adjust the arm bevel and belly cut further but says they will work.
- Whether inch files import at the right size. (He confirmed in Aspire: the tapered edge bevel, the
  purfling lines, and that centering lines the vectors up with the model.)

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
- Cloud sessions for this repository use the `guitar-designer` environment, which allows electricherald.com,
  cdn.jsdelivr.net and cdnjs.cloudflare.com. `curl` reaches them; the WebFetch tool does not.
- Publishing (asked for 22 November 2026: "published on blackchapelstudios.com ... so I can test it in
  Chrome and make changes as I find issues"): `.github/workflows/publish.yml` publishes `dist/` with GitHub
  Pages on every change to main, after `npm test`. blackchapelstudios.com itself is not served from GitHub
  (his `BlackChapelStudios` repository is empty; `Fretboard-Designer` is one `index.html` put on the site
  by hand), and cloud sessions cannot reach that site. Publishing is a public release: the open question
  about the T-style and J-style outlines must be answered first.
- The owner's demo copy is the claude.ai artifact at https://claude.ai/artifact/5xPFL1MRmtKgMuWZZbzxC3
  (private to him). To refresh it, publish `dist/artifact.html` to that same link with the `downloads`
  capability, not as a new artifact.
