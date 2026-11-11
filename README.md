# Black Chapel Guitar Designer

A single-page web app for drawing a solid-body guitar, fitting an off-the-shelf bolt-on neck,
placing pickups and hardware, and exporting true-size routing templates (DXF, SVG, tiled PDF), 2D vectors
for cutting pockets and holes on a CNC router, and a 3D model of the body (STEP or STL).

## Run, build, test

    npm install
    npm run build          # writes dist/index.html and dist/artifact.html
    npm test               # 51 geometry and export tests (Node, no browser)
    npm run test:browser   # builds, then clicks through the page in headless Chromium
    python3 tools/check_exports.py   # re-reads the files the click-through saved, with its own parsers

The browser scripts need Playwright with Chromium installed; it is not listed in `package.json`.
`CLAUDE.md` holds the working rules for anyone, person or AI, who changes this project.

- `dist/index.html` is one complete file, like the Fretboard Designer's `index.html`. Point the host at
  `dist/`, or copy that file to wherever the site is served from.
- `dist/artifact.html` is the same page without document tags, for publishing as a claude.ai artifact.
- React, three.js, Clipper and jsPDF load from public CDNs at fixed versions (listed in `build.mjs`).
  Everything else, including the logo, is inside the file.
- The 3D engine (replicad and its OpenCascade build) is not part of the page. It is fetched from
  jsDelivr the first time someone saves a 3D model, at the versions pinned under `devDependencies` in
  `package.json`; `build.mjs` passes those versions to `src/ui/cadEngine.js`.

## How it is put together

| Folder | What is in it |
| --- | --- |
| `src/core` | Geometry with no guitar knowledge: Bézier outlines, polygon offsets and booleans, arc fitting, units, engraved lettering |
| `src/data` | Every built-in number, each tagged with where it came from (`sources.js` lists the sources) |
| `src/model` | The design document, derived geometry, build checks, the layered 3D solid, the template sheets |
| `src/export` | DXF, SVG, PDF and zip writers, the CNC vectors, and the CAD solid for the STEP and STL files |
| `src/ui` | The React interface |
| `test` | Unit tests, the browser click-through, and the viewer check |
| `tools` | `make_shop_data.mjs` regenerates `src/data/shop.js` from the class-template DXF geometry; `check_exports.py` independently measures saved files |

All geometry is in millimeters. x = 0 is the centerline (+x is the treble side, seen from the front
with the neck up). y = 0 is the scale line: exactly one scale length from the nut. +y points to the neck.
Inches are a display choice only.

## Where the numbers come from

Each number in `src/data` carries one of four tags, shown in the app as a small round badge:

- **published**: stated by the maker or supplier named in the source
- **scaled**: the overall size is published; inner details were measured off the maker's drawing
- **shop**: read from the Black Chapel class templates (`src/data/shop.js`)
- **assumed**: a starting value with no published source

`src/data/shop.js` is generated. To rebuild it, `tools/make_shop_data.mjs` needs the T-style and J-style
template geometry as JSON; those files are not part of this folder.

## Template conventions

- Layers and colors: `ENGRAVE` (black), `CUT_INSIDE` (blue, cut first), `CUT_OUTSIDE` (red, cut last).
- Bearing-guided bit: the template edge is the finished edge.
- Guide bushing: openings grow, and the body outline shrinks, by (bushing − bit) ÷ 2.
- Laser kerf: outside edges grow by half the kerf; openings and holes shrink by half.
- Back sheets are mirrored so they read correctly lying on the back of the body.
- Round holes are written as true circles. Long straight edges are kept exactly; curves are fitted with
  lines and arcs to within 0.01 mm.

## Files for CNC

"Save files for CNC" (3D tab, or the File menu) offers two things meant to be used together.

**2D vectors for pockets and holes** (`src/export/cnc.js`): a zip with one DXF for the top, one for the
back when anything is cut there, and a read-me.

- Every opening is at its finished edge and true position. No bit, bushing or kerf offsets.
- The back file is mirrored across the centerline, as the body looks turned over like a page.
- One layer per kind of cut, named for what it is and how deep it goes, for example
  `TOP_NECK_POCKET_15.88MM_DEEP`, `THROUGH_NECK_SCREW_4.76MM_HOLE`,
  `BACK_STRING_FERRULE_7.94MM_HOLE_DEPTH_TO_SUIT` (no depth is recorded for that hole).
- `BODY_OUTLINE` and `GUIDE_CENTERLINE_AND_SCALE_LINE` are in both files for lining up.
- Same origin as the 3D model: x = 0 is the centerline, y = 0 is the scale line.
- Written in millimeters or inches, as chosen in the dialog; layer names give sizes in the same unit.
- Nothing reaches outside the body outline's box unless the neck pocket has to (the read-me says when),
  so a CAM program that centers the vectors and the 3D model puts them in register.
- A hole takes its depth from what the builder enters under Bridge and strings; with none entered its
  layer ends `DEPTH_TO_SUIT`.
- A binding channel adds its inner edge on a layer naming its width and depth.

**The 3D model**, with or without the pockets and holes in it. Without them it carries only the outline
and the contours, for 3D machining, while the pockets are cut from the vectors.

## The 3D model (STEP and STL)

The app holds the body in two different 3D forms, on purpose:

- **The picture and the weight** (`src/model/solid.js`, `mesh.js`) use a stack of thin flat slices cut
  with the same polygon math as the templates. It is quick and never fails, but its curved surfaces are
  small steps, so it is not saved as a file.
- **The STEP file** (`src/export/step.js`) is a true solid built by OpenCascade: the outline keeps its
  Bezier curves, roundovers are rolled fillets, the arm bevel is a flat plane, the belly cut is the exact
  dish formula, pockets have upright walls, flat floors and true arcs in the corners, and through holes
  are true cylinders. Millimeters; z = 0 is the back face.

The tests hold the two to the same volume within 0.1%, which checks each against the other.

The same CAD solid can also be saved as a binary STL for programs that do not read STEP (Vectric Aspire
is one): a closed mesh whose flat facets stay within 0.02 mm of the true surface. STL records no units;
the numbers are millimeters.

Known limits of both files, all stated in the save dialog:

- A roundover larger than the tightest outside curve of the outline cannot be rolled. Measured with the
  built-in outlines: the T-style rolls up to about 4 mm, the J-style about 6 mm, the double-cut 6.35 mm
  but not 12.7 mm. The save is refused with a plain message, and the "square edges" choice still works.
- Bridge post, tailpiece stud, string ferrule and bridge screw holes are drilled only once the builder
  has entered a depth for them. No depth is ever filled in for them.
- It is the body only. There is no neck yet.
- It does not work inside a claude.ai artifact.
- Building runs on the page's main thread, so the page pauses for a few seconds.

## Not built yet

Tremolos, basses, set necks and angled pockets, fanned frets, left-handed bodies, carved tops,
3D models of the neck, roundovers larger than the outline's tightest curve in the STEP file,
whole-guitar balance (neck and hardware weight), and ordering cut templates.

## Third-party material

- The engraved lettering uses the Hershey Simplex single-stroke font. The Hershey fonts were originally
  created by Dr. A. V. Hershey while working at the U.S. National Bureau of Standards. The data layout in
  `src/data/simplex.js` comes from JSCAD (`@jscad/modeling`, MIT License, Copyright (c) 2017-2021 JSCAD
  Organization).
- Loaded from CDNs when the page runs, not stored here: React and ReactDOM 18.3.1 (MIT), three.js 0.147.0
  (MIT), clipper-lib 6.4.2 (Boost Software License 1.0), jsPDF 2.5.1 (MIT).
- Fetched from jsDelivr only when a 3D model is saved, not stored here: replicad 1.1.0 (MIT) and
  replicad-opencascadejs 1.1.0, a browser build of the Open CASCADE Technology kernel (LGPL-2.1 with the
  Open CASCADE exception).
