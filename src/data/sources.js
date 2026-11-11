// Where every built-in number comes from. Each data entry points at one or more of these keys and
// carries a `basis` so the app can show people how much to trust it:
//   'published' - stated by the manufacturer or supplier named in the source
//   'scaled'    - measured off a manufacturer's diagram (the overall size is published, inner details are not)
//   'shop'      - taken from Black Chapel Studios' own class templates
//   'assumed'   - a starting value with no published source; check it against the real part
export const SOURCES = {
  warmothPocket: { title: 'Warmoth: Guitar Neck Pocket Options', url: 'https://warmoth.com/guitar-body-neck-pockets' },
  warmothNeckFit: { title: 'Warmoth: Guitar Neck Fit', url: 'https://warmoth.com/guitar-neck-fit' },
  warmothNeckHoles: { title: 'Warmoth: Neck Mounting Hole Options', url: 'https://warmoth.com/guitar-neck-mounting-holes' },
  warmothPickupRouts: { title: 'Warmoth: Guitar Body Pickup Routs (rout diagrams)', url: 'https://warmoth.com/guitar-pickup-routs' },
  warmothBridgeRouts: { title: 'Warmoth: Guitar Bridge Routs (rout diagrams)', url: 'https://warmoth.com/guitar-bridge-routs' },
  gotohTom: { title: 'Gotoh Tune-O-Matic stud mount bridge diagram (hosted by Warmoth)', url: 'https://warmoth.com/media/skin/images/PDFs/bridges/Gotoh_TuneOMatic_StudBridge_Diagram.pdf' },
  stewmacNeckPlate: { title: 'StewMac: Neck Mounting Plate, item 0131', url: 'https://www.stewmac.com/item/0131' },
  warmothNeckProfiles: { title: 'Warmoth: Guitar Neck Profiles (thickness at the 1st and 12th frets)', url: 'https://warmoth.com/guitar-neck-profiles' },
  fralin: { title: 'Fralin Pickups: Pickup Dimensions', url: 'https://www.fralinpickups.com/resources/pickup-dimensions/' },
  hipshot: { title: 'Hipshot: Hardtail Bridge Modern, .430 in spacing (drawing 41200M)', url: 'https://docs.hipshotproducts.com/41200M.PDF' },
  woodDb: { title: 'The Wood Database (average dried weight)', url: 'https://www.wood-database.com/' },
  amana: { title: 'Amana Tool: BTG-100 brass template guide set', url: 'https://www.amanatool.com/btg-100-10-piece-brass-template-guide-set.html' },
  shop: { title: 'Black Chapel Studios T-style and J-style class templates (shop files)', url: null },
  fretboardDesigner: { title: 'Black Chapel Fretboard Designer', url: 'https://www.blackchapelstudios.com/fretboard-designer' },
};

export const BASIS_LABEL = {
  published: 'Published',
  scaled: 'Scaled from maker’s diagram',
  shop: 'From Black Chapel shop templates',
  assumed: 'Starting value: check your part',
};
