# Black Chapel Guitar Designer

A single-page web app for drawing a solid-body guitar, fitting an off-the-shelf bolt-on neck,
placing pickups and hardware, and exporting true-size routing templates (DXF, SVG, tiled PDF), 2D vectors
for cutting pockets and holes on a CNC router, and a 3D model of the body (STEP or STL).

## Run, build, test

    npm install
    npm run build          # writes dist/index.html and dist/artifact.html
    npm test               # 99 geometry and export tests (Node, no browser)
    npm run test:browser   # builds, then clicks through the page in headless Chromium
    python3 tools/check_exports.py   # re-reads the files the click-through saved, with its own parsers

The browser scripts need Playwright with Chromium installed; it is not listed in `package.json`.
`CLAUDE.md` holds the working rules for anyone, person or AI, who changes this project.

- `.github/workflows/publish.yml` publishes `dist/` with GitHub Pages whenever the main branch changes,
  after running `npm test`. It needs Pages switched on once in the repository's settings (Source: GitHub
  Actions). It does nothing on other branches.
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

Body contours, the same in both solids:

- **Arm bevel.** The shape a wide flat sander leaves when the body is held against it and rolled:
  straight along the line drawn on the top, curved across it. The cross-section is a circular arc that,
  fully rolled, leaves the top with no crease (rolled less, it is flatter, with a crease that can be
  blended to a radius). The line runs right across the body. As an option the cut can be kept between
  its two squares, with a run-out that lifts it in a parabola at each end. The CAD solid draws the same
  cross-section with true lines and arcs.
- **Bevel around the top edge** (`src/model/edgebevel.js`). A bevel from an inner line on the top down to
  the body edge. Every outline point has a width and a depth at the edge, its own (`bw`, `bd` on the
  node) or the bevel's general ones; a width of 0 tapers the bevel to nothing there. Between points both
  run in a smooth curve that never overshoots, and the inner line is a smooth curve through the moved
  points. The surface is defined by "sections" that pair up point for point. A flat bevel has two,
  joined by straight lines. A rolled bevel follows a curve; the CAD solid runs one smooth surface through
  nine sections of it and the sliced solid reads the same curve finely. A full roll leaves the top at a
  tenth of the flat bevel's slope, not dead level, because the CAD engine cannot cut along a line where
  two surfaces only touch. A width is held to the room the body has, and
  a depth to three times the width.
- **Purfling channel.** A groove along the edge bevel's inner line. It is in the 3D picture and the CNC
  vectors only: cut along the bevel's crease, the CAD engine fails on some outlines, so it is left out of
  the STEP and STL and the save dialog says so.
- **Belly cut.** A wide, short cone, depth = drop x (1 - rho), set by a center, a length (parallel to the
  centerline unless turned), a reach and a depth, with a short blend at its rim. The rim blend is a true
  rolled radius in the CAD solid; the sliced solid works it out approximately, and the screen says so.

The same CAD solid can also be saved as a binary STL for programs that do not read STEP (Vectric Aspire
is one): a closed mesh whose flat facets stay within 0.02 mm of the true surface. STL records no units;
the numbers are millimeters.

**The saved model is checked.** OpenCascade can return a wrong solid with no error. Before a file is
saved, its volume is compared with the sliced solid of the same body. If a rolled edge bevel is the
cause, the bevel is rebuilt from flat strips and the dialog says so; if the volumes still differ by more
than 0.3%, the save is refused.

Known limits of both files, all stated in the save dialog:

- A straight edge of the outline that ends in a sharp corner at both ends is left square, not rounded
  over: on the starting shape that is the body's edge across the neck pocket (only its back edge, behind
  the heel, is left in the wood; the pocket takes the top). The engine cannot be trusted there. Depending
  on fractions of a millimeter in where the corners sat it returned a flawed face, or a face it called
  valid that could not be meshed and left a hole in the STL. The result carries `squareEdges` and the
  save dialog says to round that edge over by hand. The 3D picture and the weight still show it rolled
  (about 0.1 cm3 of wood).
- A roundover larger than the tightest outside curve of the outline cannot be rolled. Measured with the
  built-in outlines: the T-style rolls up to about 4 mm, the J-style about 6 mm, the double-cut 6.35 mm
  but not 12.7 mm. The save is refused with a plain message, and the "square edges" choice still works.
- Bridge post, tailpiece stud, string ferrule and bridge screw holes are drilled only once the builder
  has entered a depth for them. No depth is ever filled in for them.
- It is the body only. There is no neck yet.
- It does not work inside a claude.ai artifact.
- Building runs on the page's main thread, so the page pauses for a few seconds.

## The neck pocket

The pocket is a direct cutout of the neck that sits in it (the owner's rule, 22 November 2026): its sides
are the fretboard's edges, a straight taper from the heel's width at the end of the heel toward the nut's
width at the nut (`neckHalfAt` in `src/model/design.js`, `pocketHalf` in `derive.js`). There is no
separate pocket width any more: the old `mouthWidth` number is gone, and nut width joined the
measure-before-you-cut list because it now sets how wide the pocket is at the body edge.

- Corners of the body beside the pocket snap onto its edges (`seatedCorner`, `seatOnPocket`): within
  3 mm (`POCKET_SNAP`) a corner point is moved onto the fretboard's edge at its own height, and two
  corners within 0.5 mm of level (`POCKET_LEVEL`) are made level. It happens while a corner is dragged,
  when a neck number changes, when a starting shape is chosen and when a file is opened. Smooth points
  and mirrored outlines are never moved. A corner 3 to 8 mm off is named in the build checks.
- The starting shape is the owner's own double-cut (16 points, sent 22 November 2026). As he drew it the
  two corners at the neck were at -28 and 26.93 mm and 0.03 mm apart in height; seated, they are at
  +/-26.68 mm and level.
- In the CAD solid the pocket's cutter does not follow the pocket where there is no wood beside it
  (`clearOfEdge` in `src/export/step.js`): from the point where the body's edge comes within 0.1 mm of
  the pocket's side, the cutter steps 1 mm outward. On the T-style the body's treble edge runs along the
  fretboard's edge for about 15 mm; with the cutter's wall lying on that edge the engine handed back a
  body with no pocket at all and no error. Wood thinner than 0.1 mm beside the neck is not left in the
  3D file. The 2D vectors and templates keep the pocket exactly as drawn.
- The binding channel's cutter goes in as two pieces that overlap by 1 mm: as one closed ring the engine
  skipped the whole cut on the starting shape at a width of exactly 2 mm (1.9 and 2.01 mm were fine).
- `test/pocket.test.mjs` holds each of those cases against the sliced solid, in its own process.

## The neck

`src/model/neck.js` shapes the neck's shaft and heel; `buildNeckSolid` in `src/export/step.js` makes the
CAD solid; the 3D view draws the same cross-sections.

- A flat top, where the fretboard is glued. The fretboard and frets are not part of it.
- Thickness at the 1st and 12th frets comes from a profile (`src/data/neckprofiles.js`, Warmoth's
  published figures) or is typed in. The wood is thinner than that by the fretboard's thickness.
- Across, the back is a superellipse: fullness 2 is a half ellipse. No maker publishes numbers for this
  curve, so fullness, fretboard thickness and the blend length are starting values tagged "assumed".
- The round back blends into a square heel as deep as the pocket plus what stands above the body, with
  the pocket's own outline. The model sits in the pocket, in the body's own coordinates.
- The headstock is a flat slab tilted back from the nut, to an outline drawn in the app. The outline is
  drawn flat, at its true shape, above the nut on the drawing, and edits like the body outline; its two
  ends are pinned to the corners of the nut (`outline.open`).
- The back of the neck and the back of the headstock are one continuous surface. Seen from the side,
  the back's line bends from the neck's line into the headstock's, starting a third of the transition
  length behind the nut. Past the nut the cross-sections lean back a little more each time (all their
  planes pass through one line 45 mm below the nut, so none cross inside the wood), widen and square up;
  at the end of the transition length the section is the flat headstock's own, exactly.
- Each section past the nut is drawn wider than the headstock and trimmed to the outline, the way a
  headstock is sawn to its outline and carved after: its edges are square to its face, thin at the nut
  and full thickness where the carve runs out.
- The volute is a mound on the crown of the back, highest on the centerline under the nut. It dies away
  to nothing, and level, at the neck's edges and along a rounded line toward the heel and toward the
  headstock; each of those sides has its own length, so the two slopes can differ. Smooth is rounded over
  the top; peaked comes to a point. It cannot reach past the end of the transition.
- A tongue (the third volute shape) is the flat of the headstock's back carried down the back of the
  neck to a round or pointed tip, with a crisp edge, as on a dart or a tongue volute. Behind the nut it
  stands a set height out from the crown; at the nut it is four fifths of the nut's width; past the nut
  it spreads to the headstock's full width within one and a half cove widths. Outside its edge the surface
  returns to the neck's round back through a cove (a quarter circle in section, upright at the tongue's
  edge), which narrows where the tongue's edge is near the neck's edge so it never leaves a step there.
  Every section carries the tongue's edge at the same point of its outline, which is what keeps that edge
  a crisp line. Its outline comes from numbers; it cannot be drawn yet.
- Past the nut the sections lean back smoothly, from upright at the nut to square with the headstock's
  face, over a length long enough that no two cross within 30 mm of the face. (A lean that started or
  stopped abruptly left a faint line across the flat of a tongue.)
- The side view of the back can be drawn (`head.side`, `sideLine` in `neck.js`, `src/ui/SideView.jsx`).
  Each point is a distance along from the nut and how far the back stands out there from its plain line
  (the line it takes with no volute). The line through them is smooth, level where it leaves and rejoins
  the plain line, never overshoots between two points, and turns sharply only at a point marked as a
  corner. While it is drawn it replaces the volute's height, lengths and shape. Away from the centerline
  the height falls off as the mound does; where the line is lopsided about its highest point the two
  sides are blended by direction, so there is no crease between them. For a tongue the line is the height
  of the tongue's flat and its first point is the tip. Points are stored relative to the plain line, so
  changing the headstock angle or thickness keeps the drawn shape.
- The sawn edge of the headstock grows in height steadily from nothing at the nut. (When the sections'
  extra width grew in proportion to the distance from the nut, that edge jumped to about 3 mm tall within
  the first millimeter and left a line across the back.)
- The neck's cross-sections are worked out only when something asks for them (the 3D view, the save
  dialog, the side view): deriving a design for the drawing takes about 4 ms without them and 70 with.
- The tongue's outline can be drawn (`head.tongueLine`, `tongueOutline` in `neck.js`,
  `src/ui/TongueView.jsx`): points give half the tongue's width at each place along from the nut; the
  first is the tip. A tip left smooth is round (the width grows as the square root of the distance from
  it, so the outline leaves the tip square to the centerline); a tip made a corner is pointed. The two
  edges mirror each other. Past the last point the tongue spreads to the headstock's full width within
  one and a half cove widths. While drawn it replaces the tip's position and shape.
- A flat headstock (`head.kind === 'flat'`) is level with the neck with its face stepped down below
  the neck's top by `drop`. From the nut the face curves down to that level through a scoop: an arc of
  one circle seen from the side (radius = (scoop² + drop²) ÷ (2 × drop)), straight across, level where it
  meets the face. Its sections stand upright (no lean), each with its top edge on the face; its back
  curves down from the neck's line to the headstock's back, which is deeper. The transition is never
  shorter than the scoop plus 5 mm. Everything else (volute, tongue, drawn lines, the stitched solid) is
  the same code as the angled headstock with an angle of 0.
- Both drawn lines are Bezier curves (`handleCurve` in `neck.js`, `src/ui/lineEdit.js`). Each point has a
  handle on either side, stored as an [along, value] offset; a point with no handles of its own gets
  automatic ones (a third of the way to each neighbor, along the smooth never-overshooting line the
  editors had before, so older designs draw exactly as they did). Because the line must give one value at
  each place along the neck, a handle reaches no farther along than the next point, and two that would
  pass each other are shortened until they meet. Dragging a handle on a smooth point turns the opposite
  one to stay in line; on a corner it does not. "Automatic handles" drops a point's own handles.
- The side view of the back is one curve: the plain line of the back, less how far the volute or the
  tongue's flat stands out at each place along the neck (`head.centerOut`). The crown of every
  cross-section lies on it. Past the nut the sections lean, so each one's centerline meets the curve a
  little way from where the section meets the face; the section finds that place and takes its height
  there. (Before 17 November 2026 the height was looked up by the section's own place along the face,
  so the built back sat up to a few millimeters along from the line drawn.) A drawn line, the volute and
  a tongue's rise all end by `head.lineEnd`, where the last leaning section's centerline meets the back.
- In the side view editor a handle is drawn along the back's line as it really runs on the picture: its
  stored rise is combined with the slope of the plain line at its point. (Drawn without that slope,
  handles past the nut sat at an angle to the curve they were shaping: the owner's complaint.)
- Tuner holes (`head.tuners`): none, three a side, or six in a line on either side. Each row lies on a
  straight line from its first hole to its last, set by five numbers. They are on the drawing, in the 3D
  view as dark plugs, in the build checks (inside the outline, clear of the carved transition, hole size
  to measure), and in the headstock's own vector file. They are not cut into the 3D model of the neck.
- The vector pack has a third file when the neck has a headstock: `...-cnc-headstock.dxf`, the headstock's
  front face laid flat at its true shape (x across, y along from the nut line), on layers
  `HEADSTOCK_OUTLINE`, `GUIDE_CENTERLINE_AND_NUT_LINE` and `THROUGH_TUNER_<size>_HOLE`. It is a separate
  part with its own box and does not line up with the body files.
- The CAD solid is built with no cutting or joining operations. The skin joins each cross-section to the
  next with straight lines; sections are 1 mm apart wherever the shape is changing (within about 0.01 mm
  of the true curve) and 10 mm apart on the plain shaft. The heel block and the flat of the headstock are
  each drawn with one end open and stitched to the skin edge to edge, so there is no step at either.
  A neck STEP file is about 17 MB for that reason.
- Tried and given up, in this order: a headstock slab fused to the shaft (the owner: "unusable"); two
  smooth surfaces sewn at the nut with the slab fused on (he saw a seam at the nut and a step at the
  slab); one smooth surface trimmed by cuts (the engine returned a wrong solid about one time in three);
  one smooth surface with stitched ends (it rippled on some settings while passing the engine's own check).
- The neck's volume is the shaft by its cross-sections, the transition as the closed shape its sections
  make when joined by straight lines, and the flat part's area times its thickness. The CAD solid must
  match it within 1.5% or it is not saved; in a sweep of 48 randomized headstocks all were within 0.2%.
- Not built: tuner holes, nut slot, truss rod channel, heel screw holes.

## The truss rod channel

`src/model/truss.js`. A straight channel with a flat bottom on the centerline of the neck's top face (the
face the fretboard is glued to), for a two-way rod, with an optional wider pocket for the adjuster at the
headstock end or the heel end.

- **No size is built in.** The Fretboard Designer has no truss rod, and rods differ by maker, so every
  number starts at 0, which means "not entered". Until width, depth and length are typed in, the channel
  is not drawn and is in no file; the build checks ask for the missing ones. The adjuster's pocket needs
  all three of its sizes, or none.
- Build checks: the wood left under the channel at its thinnest place (the neck's depth on the centerline,
  volute included, less the channel's depth; an error at zero or less; no least thickness is built in),
  a channel wider than the neck, a channel running out of the end of the heel (a warning when the rod
  adjusts at the headstock, a plain note when it adjusts at the heel), a heel adjuster nothing opens to,
  and a neck screw coming up under the channel or its pocket.
- It is drawn dashed on the drawing and saved in a vector file of the neck's own, `...-cnc-neck.dxf`:
  x across, y along from the nut line (heel toward -y, the same way round as the headstock's file).
  Layers: `NECK_OUTLINE`, `GUIDE_CENTERLINE_AND_NUT_LINE`,
  `TOP_TRUSS_ROD_CHANNEL_<width>_WIDE_<depth>_DEEP`,
  `TOP_TRUSS_ROD_ADJUSTER_POCKET_<width>_WIDE_<depth>_DEEP`. The owner has not seen these names yet.
- Stated on screen: the ends are drawn square (a round bit leaves round ends); the channel is not in the
  3D picture or the 3D model; a headstock-end pocket is drawn in the plane of the neck's top face, so on
  an angled headstock its depth is measured from that plane and the wood under it there is not checked.

## The nut

The nut's slot is cut in the fretboard, by the Fretboard Designer. This app only reads the nut from a
Fretboard Designer build file and draws it (`nutFromFretboardFile`, `buildNut` in `src/model/truss.js`;
stored as `design.neck.nut`). No nut size is built in: until a file is loaded nothing is drawn.

- Read from the file: `nutThickness`; `zeroFret` and `nutZeroGap` (the nut sits that far behind a zero
  fret); `nutMount` and `spaceBeforeNut` (a 'flush' board ends at the back of the nut, a 'shelf' board
  runs `spaceBeforeNut` past the nut line).
- Drawn: the nut as a solid bar with its front face on the nut line (or behind the zero fret), and the
  fretboard carried on past the nut line to its end, both following the fretboard's edges.
- Nothing is cut for the nut in the neck, and it is not in the 3D picture or any file; the panel says so.
  "Remove the nut" under Neck clears it.

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
