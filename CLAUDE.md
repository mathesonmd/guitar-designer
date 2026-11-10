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

    npm test                  # 28 geometry and export tests
    npm run build
    node test/interact.mjs    # 29 click-through steps in headless Chromium
    node test/viewer.mjs      # 19 checks of the claude.ai artifact build

All must pass. Add a test for every new behavior and for every bug fixed. The two browser scripts need
Playwright with Chromium, which is not in `package.json`: Anthropic's cloud sessions have it installed;
on another machine install it first.

When an export changes, also run `python3 tools/check_exports.py` after the click-through. It re-reads
the files the page really saved with its own DXF and SVG readers, sharing no code with the app. That is
how the pocket width, hole diameters and curve agreement were confirmed.

## Geometry

- Everything is millimeters. Inches are a display choice only.
- x = 0 is the centerline, +x is the treble side (seen from the front, neck up).
- y = 0 is the scale line, exactly one scale length from the nut. +y points to the neck.
- z = 0 is the back face.
- A mirrored outline stores only the bass half.

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
offsets, laser kerf, alignment pins, engraved legend; DXF, SVG, PDF and zip export.

**Not built:** tremolos, basses, set necks and angled pockets, fanned frets, left-handed bodies,
carved tops, STEP export, whole-guitar balance, ordering cut templates.

**Never checked in the real world:** nothing has been cut on a laser or routed in wood; the files have
not been opened in LightBurn, Vectric or Fusion; the published artifact has not been opened signed in;
touch gestures, Safari and Firefox are untried.

**Waiting on the owner:**
- Whether the T-style and J-style outlines (traced from his class templates) ship in a public release.
- Notch or separate template as the neck pocket default.
- Where alignment pins go in his shop, and whether they go through the body.
- How ordering a cut template should work.

## Things that are easy to get wrong

- `src/data/shop.js` is generated from the owner's class-template files, which are not in this
  repository. Do not edit it by hand.
- The page loads React, three.js, Clipper and jsPDF from CDNs at the exact versions pinned in
  `package.json`. Change both together, and keep `build.mjs` in step.
- Inside a claude.ai artifact a page cannot start a download. Saves go through the viewer's downloads
  capability (`src/ui/files.js`), which refuses `.dxf`; that is why the DXF travels inside the zip.
- Rebuild before committing so `dist/` matches `src/`.
