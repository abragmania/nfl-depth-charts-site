// Depth-aware field layout engine. Pure geometry — no DOM here except the small SVG markup builder
// at the bottom. Everything is computed in "layout units" on a fixed-width (LAYOUT_WIDTH) canvas;
// team.js scales the whole result to the wrapper with a single CSS transform, so the field always
// scales as one unit.
//
// A slot can carry any number of players (D23 — no fixed roster cap), so row/column heights are a
// function of the deepest column in each band rather than a fixed y per band, and columns are spread
// across a band's x-range rather than pinned to literal pixel anchors.
//
// RULING E — the whole-team page is a COMPACT OVERVIEW built to fit a 1700x900 viewport with no
// scrolling: no headshots, each column is a label pill + a bold starter row + up to MAX_DEPTH_ROWS
// slim backup rows with a "+N more" tail. Status badges, the STARTER_OUT/ACTIVE treatment, rating-tier
// colours, levels, level stripes/labels and the line of scrimmage all still apply.
//
// RULING A — a defensive end is a DEFENSIVE LINEMAN: DE/LDE/RDE share the LINE row with the tackles
// and place by LABEL, not by count (placeLineColumns), so a 4-3 whose ends are DE has an EMPTY EDGE
// band that draws nothing — no height, stripe, label or level gap.
//
// RULING B — every column, offense and defense, reads top-down: label, starter, backups beneath, tray
// at the row's bottom edge.
//
// Offensive row order top-down from the LOS is OFF_ROW_GROUPS below and nothing else. D130: the LINE
// (OL alone: LT LG C RG RT) sits on the line of scrimmage facing the defensive line, then PASS CATCHERS
// (WR+TE — D71's evenly-pitched cluster centred on the field's centre line, not field-accurate x's),
// then BACKFIELD (QB centred, RB/FB flanking). Because the receivers are a centred cluster rather than
// real alignments, the secondary is pitched off the tackles/centre instead of mirroring them
// (mirrorLandmarks) — a defensive row's shape does not change with how many receivers a club charts.
//
// D72 — the OFFENSE and DEFENSE pages are this same engine drawing ONE unit (zoom.js hands
// computeLayout a TeamView carrying only that unit). Driven entirely by `opts`: no line of scrimmage
// (losY null, one "OFFENSE"/"DEFENSE" caption instead of a pair), the canvas is CROPPED to the columns
// actually on it, and rows draw at a bigger `style` (a small headshot on line one, one extra depth row).

// D110 — LAYOUT_WIDTH cannot narrow further to grow the cards: the fit engine's `spread` (viewfit.js)
// is capped at MAX_SPREAD = 1.8 and real screens measure ~1.70-1.77, so a narrower canvas would only hit
// the cap and stop reaching the sidelines instead of growing anything. The ruling's lever is a card's
// share of the canvas, CARD_W / LAYOUT_WIDTH = 216/1800 (~0.120). Vertical sizing is untouched.
const REFERENCE_WIDTH = 1600; // the OFF_BANDS anchors below were tuned against this width
export const LAYOUT_WIDTH = 1800;
const SCALE = LAYOUT_WIDTH / REFERENCE_WIDTH;

// Both field-surface variants live in styles.css behind [data-field-variant="A"|"B"] — flip this one
// constant to switch every page (team/side/matchup) at once. "A" = neutral charcoal field with the
// club's colour as a soft edge vignette; "B" = one vertical wash of the club's primary colour, darkest
// at the top/bottom edges, lighter at the line of scrimmage.
export const FIELD_VARIANT = "A";

// D111: the secondary (CB, NB, S) draws on one row — corners at the outer edges, nickel inside the left
// corner, safeties inside them — instead of two, which keeps the defense at four rows and the shorter
// canvas that gives every club (D107). Horizontal placement is untouched: corners/nickel/safeties keep
// the x's mirrorLandmarks always gave them.
const SECONDARY_ONE_ROW = true;

// D141: the off-ball LINEBACKERS and the EDGE rushers draw on one row (backers on the row's top line, edge
// columns a FRONT_LB_LIFT step below, so the two groups still read apart), which drops the defence another
// row and shortens the canvas with it. Horizontal placement is untouched but for the one shape the ruling
// names: a club charting a LONE edge column takes the left edge spot on the shared row.
const FRONT_ONE_ROW = true;

// ---- compact overview geometry (ruling E) -------------------------------------------------------
// A column is a stack of text rows, not photo cards, so its width is set by how much room a real name
// plus a rating pill needs, not by a headshot diameter. WIDTH is free: LAYOUT_WIDTH is fixed and the fit
// engine spreads the canvas sideways to fill the window, so a wider card is simply a bigger share of the
// same canvas. HEIGHT is NOT free: the whole-team/matchup canvas is HEIGHT-bound (the fit engine scales
// it to fit the ~687 CSS px left under the page chrome), so every unit added to a row is a direct tax on
// the size everything renders at. The heights below are measured content plus one or two units of slack
// (D109), not guesses:
//   line one   19 units of content (35 with a D44 banner)  -> CARD_H1 23  (+13 banner = 36)
//   slim row   17 units of content                         -> ROW_H   18
//   label pill 15 units plus its 2-unit margin             -> LABEL_RESERVE 17
//   row gap    styles.css's .column-stack gap              -> CARD_GAP 1 on the team/matchup family
// styles.css's `.column-compact` block carries the matching min-heights and stack gap, so the drawn row
// and the reserved box cannot disagree.
const CARD_W = 216;
const CARD_H1 = 23;  // the starter's bold row: 19 units of content, 23 reserved (36 with a banner over 35)
const ROW_H = 18;    // a slim backup row on the team/matchup pages: 17 units of content (D109)
const SIDE_ROW_H = 18; // D72's offense/defense pages keep the slim-row height they already have
// The team/matchup family's stack gap is 1 (styles.css `.column-compact .column-stack`); the side pages
// keep the shared `.column-stack` gap of 2 — a per-view option the way `rowH` already is.
const CARD_GAP = 1;
const SIDE_CARD_GAP = 2;
const BANNER_H = 13; // extra strip on a line-one row carrying the red OUT / green FILLING IN banner
// D104: a starter who is out, once somebody active is filling in for him, renders as a compact row at
// the BOTTOM of his column instead of on line one, still wearing his red OUT rail so "big injury here"
// still reads at a glance. Costs a shade more than BANNER_H because a slim depth row has no slack of its
// own to lend it.
const OUT_RAIL_H = 15;
// The column's own label pill inside the reserved box: rendered pill is 15 units tall plus a 2-unit
// margin, on the team, matchup AND side pages alike.
const LABEL_RESERVE = 17;
export const MAX_DEPTH_ROWS = 3; // ruling E: at most three depth rows, the third becoming "+N more"
// D134 (Adam, 2026-09-17): the small-screen "less depth" step draws one backup per column and collapses the
// rest behind a "+N more" chip that EXPANDS THAT COLUMN in place, so the chip is an extra line of its own
// rather than ruling E's tail replacing the last row. It carries one short italic word, no jersey number,
// rating pill or snap trio, so it is reserved (and drawn — styles.css's `.prow-more.depth-more`) shorter
// than a player row; every unit it costs is a unit off the constant canvas every club is scaled to (D107).
export const REDUCED_DEPTH_ROWS = 1;
// The chip has to stay readable at the D134 scale floor it serves: styles.css prints it at 12.5px, which
// lands at ~9px there and needs a 15-unit line rather than 14 (border box).
const DEPTH_CHIP_H = 15;
// D72: the single-unit (offense/defense) pages draw half as many rows, so the fit engine scales them to
// roughly 1.3-1.8x — room for a small headshot on line one, the SAME row renderer widened by an option
// (cards.js's overviewLineOne), never a second card type. HEADSHOT_PAD is the air above/below it, so the
// row grows from CARD_H1 to 34.
const HEADSHOT_SIZE = 28;
const HEADSHOT_PAD = 6;
export const SIDE_MAX_DEPTH_ROWS = 4; // D72: one more depth row than the whole-team overview's cap
// D94: the side-page card is 210 wide (up from 180) so a headshot row leaves enough room for a long
// surname ("J. Croskey-Merritt") not to ellipsise. Two 210-wide columns plus MIN_CARD_GAP (236) still
// clear MIN_PITCH's floor, so this shares the same pitch as every other view with no extra widening.
export const SIDE_CARD_W = 210;

// D109: BAND_GAP/LEVEL_GAP_EXTRA halved to buy back canvas height. A both-sides half still opens
// BAND_GAP between two rows of one level and BAND_GAP + LEVEL_GAP_EXTRA at a level boundary, so levels
// still read as levels; placeSpan's fill pass then spreads a real club's rows evenly across the half,
// which is where the visible separation between rows actually comes from.
const BAND_GAP = 5; // vertical gap between adjacent rows inside one level
const LEVEL_GAP_EXTRA = 10; // on top of BAND_GAP, only between two rows in DIFFERENT levels
// D134's reduced state only: its rows are 9 units shorter than the full-depth ones, so the full-depth gaps
// left ~150 units of empty turf per half. These tighter gaps shorten the constant canvas AND every club's
// own natural span. The full-depth layout reads BAND_GAP/LEVEL_GAP_EXTRA and does not move by a pixel.
const REDUCED_BAND_GAP = 2;
const REDUCED_LEVEL_GAP_EXTRA = 4;
const bandGapOf = (style = {}) => (style.depthChip ? REDUCED_BAND_GAP : BAND_GAP);
const levelGapOf = (style = {}) => (style.depthChip ? REDUCED_LEVEL_GAP_EXTRA : LEVEL_GAP_EXTRA);
// D111: with the secondary on one row, the TOP defensive row carries the two corners, whose cards sit
// right where the canvas used to leave empty turf for the "SECONDARY" level label and the "DEFENSE"
// caption. EDGE_CHROME opens a strip above the first row, and an equal one below the last offensive row
// for "OFFENSE", tall enough for the lifted level label plus its height. Both are canvas margins, so they
// are unaffected by where the line of scrimmage lands (D152).
const EDGE_CHROME = 22;
const MARGIN_TOP = 8 + EDGE_CHROME;
const MARGIN_BOTTOM = 8 + EDGE_CHROME;
const LOS_HALF_GAP = 10; // half the empty gutter straddling the line of scrimmage, same both sides
// MIN_PITCH (242) is built to CLEAR the card rather than merely floor it: CARD_W (216) + MIN_CARD_GAP (26),
// so this constant and enforceNoOverlap's own minimum are the same number by construction and no row is ever
// re-pitched after its placement function chose its x's — which is what the D125 landmarks depend on.
const MIN_PITCH = 242;
const TRAY_H = 22; // height of an "unlisted" tray strip, when a band has one
const TRAY_GAP = 6;
const FIELD_MARGIN_X = 80 * SCALE; // left/right canvas margin so edge columns don't clip

// Canonical x-range + canonical column count per OFFENSE band that still uses a fixed anchor range.
// OL is the only one left: QB/BACKFIELD are placed relative to the centre (see layoutBackfieldRow) and
// WR/TE hang off the OL's own comb on the line row (D63, layoutLineRow), so their old ranges are gone.
const OFF_BANDS = {
  OL: { x: [560, 1040], n: 5 },
};

// Each row is tagged with the LEVEL it belongs to (DL on the line, LBs next, then DBs) so computeLayout
// can open a bigger gap at a level boundary than between rows inside one level, and hand back one label
// per level. Ruling A: the LINE row is the DL band, which now includes every defensive end.
// The four row models are written out in full rather than patched, so reading any one of them tells you the
// whole defensive layout it produces. `order` is nearest-the-LOS first; `bands` says which compiled bands
// each row draws; `level` groups consecutive rows into the levels the stripes and labels are printed from.
// Which one a club draws is the two switches, decided independently: a club whose own columns will not fit
// on a merged row falls back on THAT row alone (D111's secondary fallback, D141's front fallback).
const DEF_ROWS_SPLIT_SEC_SPLIT_FRONT = {
  order: ["LINE", "EDGE", "LB", "CB_NB", "S"],
  bands: { LINE: ["DL"], EDGE: ["EDGE"], LB: ["LB"], CB_NB: ["CB", "NB"], S: ["S"] },
  level: { LINE: "LINE", EDGE: "EDGE", LB: "LB", CB_NB: "SEC", S: "SEC" },
};
const DEF_ROWS_ONE_SEC_SPLIT_FRONT = {
  order: ["LINE", "EDGE", "LB", "SECONDARY"],
  bands: { LINE: ["DL"], EDGE: ["EDGE"], LB: ["LB"], SECONDARY: ["CB", "NB", "S"] },
  level: { LINE: "LINE", EDGE: "EDGE", LB: "LB", SECONDARY: "SEC" },
};
const DEF_ROWS_SPLIT_SEC_ONE_FRONT = {
  order: ["LINE", "FRONT", "CB_NB", "S"],
  bands: { LINE: ["DL"], FRONT: ["EDGE", "LB"], CB_NB: ["CB", "NB"], S: ["S"] },
  level: { LINE: "LINE", FRONT: "FRONT", CB_NB: "SEC", S: "SEC" },
};
const DEF_ROWS_ONE_SEC_ONE_FRONT = {
  order: ["LINE", "FRONT", "SECONDARY"],
  bands: { LINE: ["DL"], FRONT: ["EDGE", "LB"], SECONDARY: ["CB", "NB", "S"] },
  level: { LINE: "LINE", FRONT: "FRONT", SECONDARY: "SEC" },
};
const defRowModel = (secOneRow, frontOneRow) => (secOneRow
  ? (frontOneRow ? DEF_ROWS_ONE_SEC_ONE_FRONT : DEF_ROWS_ONE_SEC_SPLIT_FRONT)
  : (frontOneRow ? DEF_ROWS_SPLIT_SEC_ONE_FRONT : DEF_ROWS_SPLIT_SEC_SPLIT_FRONT));
const DEF_ROWS = defRowModel(SECONDARY_ONE_ROW, FRONT_ONE_ROW);
const DEF_ROW_ORDER = DEF_ROWS.order; // nearest LOS -> farthest
const DEF_ROW_BANDS = DEF_ROWS.bands;
const DEF_ROW_LEVEL = DEF_ROWS.level;
// D141: the merged row carries ONE label naming both groups, in the order they read down the field. It is
// narrower than the LABEL_CLEAR_X gutter the lift rule already reserves, so it prints on one line at every
// scale, and the alternative (stacking the two words) is not needed.
const DEF_LEVEL_LABEL = { LINE: "LINE", EDGE: "EDGE", LB: "LINEBACKERS", FRONT: "LINEBACKERS · EDGE", SEC: "SECONDARY" };

// THE STAGGER INSIDE A MERGED ROW. Both merged rows share one top line and start SOME of their bands' columns
// a step below it, so two groups read as two groups without costing a row:
//   SECONDARY  the corners and the nickel step below the safeties — 22 units (D121), then 34 (D125), then
//              D141's full card (LABEL_RESERVE + a line-one row, plus air), so the corner's own label pill
//              sits BELOW the bottom of the safety's line-one card rather than beside it.
//   FRONT      the edge rushers step below the off-ball linebackers (D141), which is what makes the backers
//              read as the higher, further-from-the-line group they are.
// A two-row model has neither: its corners and its edge rushers have rows of their own.
//
// D146 (2): THE CORNER STEP IS THE PAGE'S OWN CARD, NOT ONE NUMBER FOR ALL PAGES. A line-one row is 23 units
// on the team and matchup pages and 34 on the Offense/Defense pages, where it carries a headshot, so one flat
// number leaves the corner's pill beside the safety's card on one family or the other. It is derived from the
// style the page is drawing at:
//   team / matchup   LABEL_RESERVE + 23 + 6 air      = 46  (D141's own number, unchanged)
//   offense/defense  LABEL_RESERVE + 34 + BANNER_H   = 64
// The side pages spend a banner's worth on the last term where the team page spends 6 units of air, so the
// pill also clears a safety whose card wears a D44 banner; they are width-bound with idle turf under the
// corners and can pay for it. The team/matchup canvas is height-bound, where every unit is a tax on the size
// of every card, so it keeps the plain card.
const SECONDARY_CORNER_AIR = 6;
export function secondaryCornerDrop(style = {}) {
  return LABEL_RESERVE + lineOneBase(style) + (style.headshot ? BANNER_H : SECONDARY_CORNER_AIR);
}
// There is deliberately NO bare `SECONDARY_CORNER_DROP` constant. It used to exist, holding the team/matchup
// number (46), and it survived D146 (2) as an export — which invites back the exact mistake D146 fixed: a
// caller or a test asking "how far below the safeties do the corners start?" and getting the Team page's
// answer on an Offense/Defense page, where a line-one card carries a headshot and the step is 64. The only
// way to ask is secondaryCornerDrop(style), with the style of the page actually being drawn.
const FRONT_LB_LIFT = 18;
// `drop` is a FUNCTION of the style now, not a number, so every reader (the reserved row height, the
// constant canvas, the placement pass) asks the same question about the page actually being drawn.
const ROW_DROPS = {
  SECONDARY: { bands: new Set(["CB", "NB"]), drop: secondaryCornerDrop },
  FRONT: { bands: new Set(["EDGE"]), drop: () => FRONT_LB_LIFT },
};
const rowDropOf = (rowKey, band, style = {}) => {
  const d = ROW_DROPS[rowKey];
  return d && d.bands.has(band) ? d.drop(style) : 0;
};
// D141: the merged front row names only the groups actually standing on it, in the order they read down the
// field. Ruling A leaves a 4-3 whose ends are linemen with no EDGE column at all, and that row is plainly the
// linebackers — it must not be captioned with a group nobody can see.
function frontRowLabel(cols) {
  const parts = [];
  if (cols.some((c) => c.band === "LB")) parts.push(DEF_LEVEL_LABEL.LB);
  if (cols.some((c) => c.band === "EDGE")) parts.push(DEF_LEVEL_LABEL.EDGE);
  return parts.join(" · ") || DEF_LEVEL_LABEL.FRONT;
}

// D107 — ONE FIELD SCALE FOR EVERY CLUB, on the team and matchup pages alike. The both-sides canvas is a
// CONSTANT computed from the row constants alone and never from a club's own rows: when it was the club's
// own height, the fit engine MAGNIFIED a club with a shorter chart (a defence with no EDGE row) against one
// with a taller chart. BOTH_SIDES_HALF is the tallest defence this engine can draw at its natural pitch:
// every row of DEF_ROW_ORDER, each as tall as a FULL column (label pill + one bold row + MAX_DEPTH_ROWS slim
// rows — DEF_ROW_FULL_H; a "+N more" tail costs nothing extra since it REPLACES the last slim row instead of
// adding one), spaced at BAND_GAP inside a level and + LEVEL_GAP_EXTRA at a level boundary. A club shorter
// than the constant spreads its rows across its share with placeSpan's extra gap.
//
// Two things can still push a single row past DEF_ROW_FULL_H — the OUT rail D104 stacks on a demoted
// starter's row, and a "not on chart" tray — so a side can need more than half the canvas. D152: it then
// takes that room from the OTHER half's spare and the line of scrimmage moves to where the two meet; the
// canvas itself only grows when the two sides TOGETHER outgrow it, and then by that shortfall alone.
//
// D134: the same sum for whatever depth cap the page is drawing at — the reduced state's chip is an extra
// short line, so a full column there is the label, the line-one row, one backup and the chip, and that state
// also reserves D44's BANNER on the line-one row (without it an out starter's banner costs more than the
// reduced cap saves, and the reduced canvas buys nothing). The default argument reproduces the full-depth
// number exactly, so nothing about today's canvas moves.
function defRowFullH(style = {}) {
  const cap = style.maxDepthRows ?? MAX_DEPTH_ROWS;
  const rowH = style.rowH ?? ROW_H;
  const gap = style.cardGap ?? CARD_GAP;
  return LABEL_RESERVE + CARD_H1 + cap * (rowH + gap) + (style.depthChip ? DEPTH_CHIP_H + gap + BANNER_H : 0);
}
const DEF_ROW_FULL_H = defRowFullH();
// D111/D141: with the secondary AND the front each on one row, DEF_ROW_ORDER.length is 3 rather than 5, and
// both stagger steps are reserved on top of it — BOTH_SIDES_HALF/BOTH_SIDES_HEIGHT are currently 385 / 850
// and stay DERIVED, never hardcoded, so a future ruling that adds or removes a defensive row moves the
// canvas with it (with both switches off the same arithmetic gives D109's 535 / 1106 exactly).
const DEF_LEVEL_BOUNDARIES = DEF_ROW_ORDER.reduce(
  (n, key, i) => (i && DEF_ROW_LEVEL[key] !== DEF_ROW_LEVEL[DEF_ROW_ORDER[i - 1]] ? n + 1 : n), 0);
// D121/D141: a merged row's own reserved height grows by its stagger step (its deepest column may be a
// dropped corner, or a dropped edge rusher), so the constant half grows with it — one number for every club
// (D107), never per club, and the offensive half matches it (D96). Zero for a row model that has no stagger.
// D134: the constant is now a function of the depth cap the page is drawing at, derived exactly the way it
// always was; with no style it is the full-depth number every club renders on today.
export function bothSidesHalf(style = {}) {
  return DEF_ROW_ORDER.length * defRowFullH(style)
    + (DEF_ROW_ORDER.length - 1) * bandGapOf(style)
    + DEF_LEVEL_BOUNDARIES * levelGapOf(style)
    + DEF_ROW_ORDER.reduce((sum, key) => sum + (ROW_DROPS[key] ? ROW_DROPS[key].drop(style) : 0), 0);
}
export function bothSidesHeight(style = {}) {
  const half = bothSidesHalf(style);
  return MARGIN_TOP + half + 2 * LOS_HALF_GAP + half + MARGIN_BOTTOM;
}
export const BOTH_SIDES_HALF = bothSidesHalf();
export const BOTH_SIDES_HEIGHT = bothSidesHeight();

// D108 — a single-unit side page's rows used to sit flush against MARGIN_TOP/MARGIN_BOTTOM, reading as
// pinned to the frame. One row pitch (BAND_GAP + LEVEL_GAP_EXTRA) is now inset above the first row and
// below the last, with the rows spread evenly in what's left (Adam: "pushed in a LITTLE BIT, not a ton").
// The side pages are not height-bound (they crop to one unit and fill), so this inset keeps its own 30
// units regardless of BAND_GAP/LEVEL_GAP_EXTRA moving elsewhere (D109).
const SIDE_INSET = 30;

// D69: three offensive rows, nearest-the-LOS first. Reordering these entries reorders the whole offensive
// half — levels, stripes, labels and gaps all fall out of it. D130 (Adam, every page): the LINE sits on the
// line of scrimmage, facing the defensive line; PASS CATCHERS (WR+TE) sit behind it, then the BACKFIELD.
const OFF_ROW_GROUPS = [
  { key: "LINE", bands: ["OL"] },                // LT LG C RG RT
  { key: "PASS_CATCHERS", bands: ["WR", "TE"] }, // outside WR, slot WR, TE(s), outside WR
  { key: "BACKFIELD", bands: ["QB", "BACKFIELD"] }, // QB centred on the centre, RB/FB flanking him
];
const OFF_ROW_LEVEL = { PASS_CATCHERS: "PASS_CATCHERS", LINE: "LINE", BACKFIELD: "BACKFIELD" };
const OFF_LEVEL_LABEL = { PASS_CATCHERS: "PASS CATCHERS", LINE: "LINE", BACKFIELD: "BACKFIELD" };

// D125 — the whole secondary is pitched off the CENTRE of the line, with ONE set of numbers on every page
// that draws a defence, each landmark exactly one pitch outside the next. 0.6 is the floor while a card is
// 216 wide (neighbours need a full pitch between centres); it supersedes D71/D110's and D119/D122's numbers.
const S_PITCH_FROM_CENTER = 0.6;
const NB_PITCH_FROM_CENTER = 1.6;
const CB_PITCH_FROM_CENTER = 2.6;
// D116: edge rushers sit 0.2 pitches outside the tackle — essentially over the tackle itself, where a
// real edge defender's hand is in the dirt — tightened down from D112's first cut (1.0 -> 0.6 -> 0.2)
// after Adam reported the pair still read as too far apart on a 1700px screen. The widest real EDGE row
// (a 3-4's three edge columns) still clears MIN_CARD_GAP to its nearest neighbour at this value.
const EDGE_PITCH_OUT = 0.2;
// D116: the LB band's two inside linebackers sit 0.85 pitches off centre — just inside the guards,
// pulled in from sitting ON them — so an EDGE column stays clearly outside its neighbouring ILB with a
// visible margin, and the two ILB columns themselves still clear MIN_CARD_GAP.
const ILB_PITCH_FROM_CENTER = 0.85;
// Vertical air between two columns stacked on the same x (TE2 under TE1).
const STACK_GAP = 8;
// D72: the margin left on each side of a cropped single-unit canvas, so the outermost column is not flush
// against the sideline the field SVG draws.
const CROP_MARGIN = 26;
// D72: the most spare height one gap between two rows may absorb on a single-unit page. Enough to turn a
// four-row defense on a 1700x900 screen into a full page; beyond it the rows would read as unrelated
// islands rather than levels of one chart.
const MAX_EXTRA_GAP = 220; // D75: a three-row offense page spreads its rows to fill the height rather than zooming
// D76/D110: receivers/TE cluster pitch as a multiple of MIN_PITCH (1.2, down from 1.3) — the widest real
// cluster (five places, e.g. Cleveland's WR·Slot/WR1/WR2/WR3/TE) still spreads across the turf rather
// than huddling on the centre, and a hypothetical sixth place still fits inside the canvas.
const PASS_CATCHER_PITCH = 1.2;
const SLOT_COLUMN_MIN_RATE = 40; // D86: share of his OWN snaps a receiver must take inside to stand in the WR · Slot column; bar lowered from 50 to 40 by D118

function offBandRange(band) {
  const cfg = OFF_BANDS[band] || { x: [REFERENCE_WIDTH / 2, REFERENCE_WIDTH / 2], n: 1 };
  return { x: [cfg.x[0] * SCALE, cfg.x[1] * SCALE], n: cfg.n };
}

// Spreads `n` column centres across a band's canonical range, honouring the MIN_PITCH floor and
// keeping the set centred on the range's midpoint.
function distributeX(range, n) {
  const [xMin, xMax] = range.x;
  const canonicalN = Math.max(range.n, 1);
  const rangeWidth = xMax - xMin;
  const pitch = Math.max(MIN_PITCH, canonicalN > 1 ? rangeWidth / (canonicalN - 1) : MIN_PITCH);
  const mid = (xMin + xMax) / 2;
  if (n <= 1) return [mid];
  const totalWidth = pitch * (n - 1);
  const start = mid - totalWidth / 2;
  return Array.from({ length: n }, (_, i) => start + i * pitch);
}

// Evenly spaces `n` points across [xMin,xMax] INCLUSIVE of both ends (n=2 lands exactly on the two
// ends), widening symmetrically around the range's midpoint if MIN_PITCH would otherwise be violated.
// This is the building block every mirrored defensive placement below is made of.
function spanPoints(xMin, xMax, n) {
  if (n <= 0) return [];
  if (n === 1) return [(xMin + xMax) / 2];
  const pitch = Math.max(MIN_PITCH, (xMax - xMin) / (n - 1));
  const totalWidth = pitch * (n - 1);
  const mid = (xMin + xMax) / 2;
  const start = mid - totalWidth / 2;
  return Array.from({ length: n }, (_, i) => start + i * pitch);
}

// Outermost-two (by columnOrder) flank [flankMin,flankMax], an ODD count's true middle slot sits on
// centerX (MLB over the centre; a real 4-3 has exactly this: WLB, MLB, SLB) — an EVEN count has no
// natural "one middle" slot, so it just spreads evenly across the flank range instead (2 ILB at the
// two guards). Building the two halves independently guarantees the inserted centerX is never
// duplicated by a flank point that already landed exactly on the midpoint.
function placeFlankedCenter(count, flankMin, flankMax, centerX) {
  if (count <= 0) return [];
  if (count % 2 === 0) return spanPoints(flankMin, flankMax, count);
  const half = (count - 1) / 2;
  if (half === 0) return [centerX];
  const leftXs = spanPoints(flankMin, centerX, half + 1).slice(0, half);
  const rightXs = spanPoints(centerX, flankMax, half + 1).slice(1);
  return [...leftXs, centerX, ...rightXs];
}

// Outermost-two go to [outerMin,outerMax] (3-4 OLBs, just outside the tackles), everything else to
// [innerMin,innerMax].
function placeOuterInner(count, outerMin, outerMax, innerMin, innerMax) {
  if (count <= 0) return [];
  if (count <= 2) return spanPoints(outerMin, outerMax, count);
  const innerXs = spanPoints(innerMin, innerMax, count - 2);
  const [oL, oR] = spanPoints(outerMin, outerMax, 2);
  return [oL, ...innerXs, oR];
}

// A player reads as "fully out" for banner purposes either by role (the STARTER_OUT convention) or by
// status code (a co-starter who keeps role STARTER but carries status.code "OUT") — both show the same
// red "who's out and for how long" banner (D44), so both cost the same extra strip of height here.
// THE single list for the whole front end — cards.js re-exports it, zoom.js and matchup.js import it from
// there, and it must match server/compile/status.js's willNotPlay exactly. Do not fork a second copy: four
// separate copies once drifted apart and all four were missing INACTIVE and EXEMPT.
export const OUT_STATUS_CODES = new Set(["OUT", "IR", "PUP", "NFI", "SUSP", "INACTIVE", "EXEMPT"]);
export function isFullyOut(p) {
  return p.role === "STARTER_OUT" || OUT_STATUS_CODES.has(p.status?.code);
}

// D60 (Adam, approved 2026-09-15): a healthy game-day scratch - server/compile/status.js sets status.scratch
// on him - is still "fully out" for layout purposes (he cannot play, so he keeps the banner and the strip of
// height reserved for it), but the banner reads grey "INACTIVE · coach's decision" instead of the red
// "OUT · back ~date": nobody is hurt and there is no return date to wait for. One definition, imported by
// cards.js/zoom.js the same way isFullyOut is, so the three views cannot drift apart again.
export function isScratch(p) {
  return p.status?.code === "INACTIVE" && p.status?.scratch === true;
}

// The per-view drawing options a layout was computed with, normalised once in computeLayout and then
// stamped onto every column it produces (D72). cards.js reads it back off the column rather than being
// told separately, so the markup it draws and the box this module reserved for it cannot disagree — the
// same contract lineOneCount/visibleDepthRows already had.
export function layoutStyle(opts = {}) {
  // `headshot` is what tells the two row families apart — a headshot on line one is D72's own signal that
  // this is a single-unit side page — the same discriminator styles.css uses for `.column-compact`'s type
  // scale, so the reserved box and the rendered row cannot disagree about which family they're in.
  const side = !!opts.headshot;
  return {
    headshot: side ? HEADSHOT_SIZE : 0,
    // D134: `depthChip` is the reduced state's own flag — the "+N more" chip becomes an expanding extra
    // line instead of ruling E's tail, and a demoted OUT starter's rail is never collapsed behind it.
    depthChip: !!opts.depthChip,
    maxDepthRows: opts.maxDepthRows ?? MAX_DEPTH_ROWS,
    cardWidth: opts.cardWidth ?? CARD_W,
    rowH: side ? SIDE_ROW_H : ROW_H,
    // D109: the stack gap is the same question asked the same way — the team/matchup family draws 1
    // (styles.css `.column-compact .column-stack`), the side pages the shared 2.
    cardGap: side ? SIDE_CARD_GAP : CARD_GAP,
  };
}

// A line-one row is CARD_H1 tall normally, plus BANNER_H when it carries a banner — red for a fully-out
// player, green "ACTIVE · FILLING IN" for role ACTIVE (D44). D72: a row carrying a headshot is as tall as
// the headshot plus its air. cards.js imports this function (rather than keeping its own copy of the sum,
// which is how the two used to drift) so the rendered row is never taller than the box reserved for it.
export function lineOneHeight(p, style = {}) {
  return lineOneBase(style) + (isFullyOut(p) || p.role === "ACTIVE" ? BANNER_H : 0);
}
// The same row WITHOUT its player: how tall a line-one row is on this page before any banner. Pulled out
// because the corner step (secondaryCornerDrop, above) has to reserve a line-one card on a page where no
// particular player is in hand, and the two must never disagree about what a line-one row measures.
function lineOneBase(style = {}) {
  // Number(): a caller handing raw opts (`headshot: true`) instead of a layoutStyle would otherwise get a quiet
  // wrong number (true + 6) rather than the photo height.
  const hs = Number(style.headshot) || 0;
  return hs ? Math.max(CARD_H1, hs + HEADSHOT_PAD) : CARD_H1;
}

// D104: how many of the players standing at the TOP of a slot are fully-out starters with somebody active
// filling in behind them — that run moves to the bottom of the column so "big injury here" still reads at
// a glance. Zero (no reordering) when the slot opens with a healthy man, or when the out man has nobody
// active behind him to promote, since he's still the only answer to "who plays here". Co-starters who are
// BOTH out move together as one run, keeping their relative order.
export function outFillInDemotion(players) {
  let n = 0;
  while (n < players.length && isFullyOut(players[n])) n++;
  if (n === 0) return 0;
  return players[n]?.role === "ACTIVE" ? n : 0;
}

// D104 is a DISPLAY rule and nothing else: this returns a reordered COPY for drawing, and never touches
// the slot's own players[] array. Everything that reasons about who the starter of record is —
// columnDecider (D93), receiverColumnLeader, D61's reserve placement, the heir logic, slot.injury — keeps
// reading players[0] off the compiled data, which is unchanged.
export function displayOrder(players) {
  const n = outFillInDemotion(players);
  return n ? [...players.slice(n), ...players.slice(0, n)] : players;
}

// How many leading players render as BOLD line-one rows rather than slim depth rows, counted in DISPLAY
// order: a co-starter pair is two names on one slot (both bold). D44 used to put a fully-out starter and
// his ACTIVE fill-in on line one together; D104 sends the out man to the bottom instead, so line one is
// now the fill-in on his own. Everything else is one bold starter row. Shared with cards.js's renderColumn
// so the markup and this maths cannot diverge.
export function lineOneCount(players) {
  if (!players.length) return 0;
  // Demotion is decided before the co-starter question: a co-starter pair both out with a fill-in behind
  // them goes to the bottom with the fill-in leading; a pair with no fill-in is untouched (two bold rows).
  if (outFillInDemotion(players)) return 1;
  return players.length >= 2 && players[0].coStarter && players[1].coStarter ? 2 : 1;
}

// Ruling E: at most MAX_DEPTH_ROWS slim rows are drawn behind the line-one row(s). When more players
// exist than that, the LAST visible slim row is replaced by a "+N more" tail, so the row count (and
// therefore the reserved height) never exceeds the cap however deep a real chart runs.
export function visibleDepthRows(players, maxRows = MAX_DEPTH_ROWS) {
  return Math.min(Math.max(players.length - lineOneCount(players), 0), maxRows);
}

// How a column's depth rows divide up, in ONE place, so the reserved box (slotContentHeight below) and the
// drawn markup (cards.js's renderColumn) can never disagree about them:
//   rows   how many slim rows are drawn under the line-one block
//   rails  how many of those carry D104's red OUT rail (and therefore cost OUT_RAIL_H more)
//   chip   whether a "+N more" tail is drawn at all
// Ruling E's normal state is unchanged: the tail REPLACES the last visible row, and the rails take their
// places inside the cap (keepOutRowsVisible's own arithmetic). D134's reduced state instead draws `cap`
// ordinary rows, never collapses a rail, and gives the chip a short line of its own.
export function depthPlan(players, style = {}) {
  const depthCount = Math.max(players.length - lineOneCount(players), 0);
  const cap = style.maxDepthRows ?? MAX_DEPTH_ROWS;
  const demoted = outFillInDemotion(players);
  if (!style.depthChip) {
    const rows = Math.min(depthCount, cap);
    const places = depthCount > rows ? Math.max(rows - 1, 0) : rows;
    return { rows, rails: Math.min(demoted, places), chip: depthCount > rows, chipRow: false };
  }
  const rails = demoted; // D134: the injury rail is the column's whole point; it is never hidden
  const rows = Math.min(Math.max(depthCount - rails, 0), cap) + rails;
  return { rows, rails, chip: depthCount > rows, chipRow: depthCount > rows };
}

// D104: how many of the demoted OUT rows are actually DRAWN, which is what the reserved box has to pay the
// OUT_RAIL_H for. Kept as its own name because the tests and cards.js both ask exactly this question.
export function shownOutRows(players, style = {}) {
  return depthPlan(players, style).rails;
}

// A slot's real rendered content height: the column's own label pill (which lives INSIDE this box, or the
// deepest column in a row overflows the row's shared bottom edge), plus each bold line-one row, plus the
// visible slim rows.
function slotContentHeight(slot, style) {
  const players = slot.players;
  if (!players.length) return CARD_H1 + LABEL_RESERVE;
  const ordered = displayOrder(players); // D104: measure the rows in the order they will be drawn
  const bold = lineOneCount(players);
  const rowH = style.rowH ?? ROW_H;
  const cardGap = style.cardGap ?? CARD_GAP;
  let h = LABEL_RESERVE;
  for (let i = 0; i < bold; i++) h += lineOneHeight(ordered[i], style) + (i ? cardGap : 0);
  // D104: the demoted OUT rows are slim rows that also carry a red rail, so they each cost OUT_RAIL_H more
  // than the healthy rows beside them. They are never the rows that collapse behind "+N more" (that is the
  // whole point of moving them), so the count is known here without knowing which players they are.
  const plan = depthPlan(players, style);
  h += plan.rows * (rowH + cardGap) + plan.rails * OUT_RAIL_H;
  if (plan.chipRow) h += DEPTH_CHIP_H + cardGap; // D134: the expanding chip is its own short line
  return h;
}

const byColumnOrder = (a, b) => a.columnOrder - b.columnOrder;

// Ruling E made every player a text row, so a co-starter pair no longer needs a double-wide column to
// hold two photo cards side by side — both names simply stack as two bold rows in one normal column.
// Every column in one layout is therefore the same width; only the VIEW changes it (D72's single-unit
// pages run wider to pay for their headshot without eating the name).
const colWidth = (style) => style.cardWidth;

// Assigns x positions to every slot in an OFFENSE band that still uses a fixed canonical range (OL).
function layoutOffBandColumns(offSlots, band, style) {
  const slots = offSlots.filter((s) => s.band === band).slice().sort(byColumnOrder);
  if (!slots.length) return [];
  const xs = distributeX(offBandRange(band), slots.length);
  return slots.map((slot, i) => ({ slot, x: xs[i], height: slotContentHeight(slot, style), width: colWidth(style), band }));
}

// ---- the offensive rows --------------------------------------------------------------------------

// The five linemen, which are the reference grid the whole defensive front and secondary mirror
// (mirrorLandmarks below) and the comb the receivers are then hung off — so they are computed first.
const layoutOlColumns = (offSlots, style) => layoutOffBandColumns(offSlots, "OL", style);

// Stacks a set of columns on ONE x, top to bottom, instead of giving each its own place in the row
// (D63: "a second TE column stacks directly under the TE1 column"). The leader keeps its own natural
// height rather than being stretched to the row's, or its box would be drawn straight through the
// column stacked beneath it; the followers carry a y offset and a back-pointer so enforceNoOverlap can
// move the whole stack as one.
function stackColumns(cols) {
  if (cols.length < 2) return;
  let y = 0;
  for (const c of cols) { c.stacked = true; c.yOffset = y; y += c.height + STACK_GAP; }
  for (const c of cols.slice(1)) c.stackUnder = cols[0];
}

// WR · SLOT IS A REAL COLUMN OF SLOT RECEIVERS (D83): every charted receiver who qualifies for the slot
// is lifted out of his club column into one synthetic column and removed from the column he came from —
// nobody over the bar is left behind, nobody is drawn twice. A team with nobody over the bar has no Slot
// column at all and keeps WR1/WR2/WR3 exactly as the club prints them.
//
// Membership (D86, lowered 50 -> 40 by D118): a receiver qualifies once at least SLOT_COLUMN_MIN_RATE
// percent of his OWN snaps are taken inside — not his share of the team's inside snaps, and not gated by
// any minimum sample size (D117 retired D89's 100-snap floor: a thin sample is still evidence of where he
// lines up).
//
// Ordering (D90): tier first (a listed-OUT starter's tier 0, then 1, then 2…, untiered last) so a backup
// is never shown above a starter, then the rank of the column he came from, then slot snaps (most first,
// null last), then the row the club printed him on.
//
// Whole-column move (D93): when a club column's own STARTER qualifies (columnDecider below picks the
// decider for a listed-OUT/ACTIVE-fill-in pair), the WHOLE column becomes the WR · Slot column — same
// order, backups stacked under him — and vanishes from the club columns, rather than leaving behind a
// column of nothing but backups. If two starters qualify, the higher-ranked column (lower columnOrder,
// D92) wins and becomes the Slot column; the other starter moves in as an individual below it and HIS
// backups stay behind in his own, now backup-led, club column — the one case that can still leave a club
// column holding only backups, which is what D92's "backup-led columns sort last" below still covers.
// Within the merged group, D90's tier rule still governs: qualifying starters from other columns join
// directly under the source column's line-one block, ahead of its own carried backups.
//
// Every man is judged on the same rate window: the pooled 2025+2026 rate when a card carries one, else
// the headline rate (D77 can switch a man to his current season alone mid-year, so team-mates can carry
// different windows). This is a DISPLAY regrouping only — the compiled TeamView is untouched; every slot
// is shallow-cloned and player cards are carried by reference, so a man's role/banner/badges/heat in the
// Slot column are the same object the club column held.
// slotSnapsPooled is the count every man is ordered on (D90) and shown in the tooltip's bracket; the
// headline slotSnaps is only the fallback for a card with no pooled count at all. It no longer gates
// membership (D117), so a null count is admitted on the rate alone and simply sorts last.
const snapCount = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const slotSnapsOf = (p) => snapCount(p?.slotSnapsPooled) ?? snapCount(p?.slotSnaps);
// D86: the one rate window every man is judged on — the pooled 2025+2026 rate when the card carries one,
// else the headline rate D77 published for whichever season it picked. null means PlayerProfiler never
// measured him, and an unmeasured man is not evidence of anything: he stays in his club column.
const rateOf = (p) => {
  const pooled = p?.slotRatePooled;
  if (typeof pooled === "number" && Number.isFinite(pooled)) return pooled;
  const own = p?.slotRate;
  return typeof own === "number" && Number.isFinite(own) ? own : null;
};
// D92: the roles that make a man the leader of a real starter's column, as against a column of backups left
// behind when the slot men moved out. Same list assignRoles works in: a co-starter is a starter on a shared
// line one, a STARTER_OUT still holds his column (D12) and an ACTIVE man is the one filling in for him (D44).
const STARTER_LED_ROLES = new Set(["STARTER", "STARTER_OUT", "ACTIVE"]);
const starterLed = (slot) => {
  const lineOne = slot?.players?.[0];
  return !!lineOne && (lineOne.coStarter === true || STARTER_LED_ROLES.has(lineOne.role));
};
// D93: the one man whose qualification decides what happens to a whole club column. Normally the column's
// line-one man — the only receiver the front end can see "leading" a slot. The exception is D12/D44's pair:
// a listed-OUT starter with his ACTIVE fill-in under him. The fill-in is the receiver actually lining up
// there this week, so HIS rate decides, and if he qualifies the out man rides into the Slot column with the
// rest of the column rather than being stranded behind.
//
// The fill-in is NOT always row two. The server builds a column as [...outs, card, ...rest] and promoteFillIns
// tags the first playable man after the LAST out man, so real shapes include [OUT, OUT, ACTIVE] (two men
// listed out) and [OUT, backup on IR, ACTIVE] (the man behind him is unavailable too). So the decider is the
// first ACTIVE man ANYWHERE in the column — exactly the man the server's own receiverColumnLeader
// (server/compile/chart.js) picks when it ranks the column — and the out man himself only when the column
// carries no ACTIVE man at all.
function columnDecider(slot) {
  const players = slot?.players || [];
  const lineOne = players[0];
  if (!lineOne) return null;
  if (lineOne.role === "STARTER_OUT") return players.find((p) => p.role === "ACTIVE") || lineOne;
  return lineOne;
}

// How many rows of a column make up its LINE ONE — the block no other column's man may be pushed inside.
// Normally the single starter on row one; for D12/D44's shape every row from the listed-OUT starter down to
// and including the ACTIVE man filling in for him (the rows between them are men listed out or unavailable,
// which is exactly why the fill-in is not always row two); and for a co-starter pair, both names, which is
// what lineOneCount above already draws as bold rows. Used when a second qualifying starter joins the Slot
// column: he goes below that block, never between an out man and the man playing for him.
function lineOneBlock(slot) {
  const players = slot?.players || [];
  if (!players.length) return 0;
  if (players[0].role === "STARTER_OUT") {
    const fill = players.findIndex((p) => p.role === "ACTIVE");
    if (fill > 0) return fill + 1;
  }
  return lineOneCount(players);
}

// A card with no tier number sorts below every man who has one, in the order the club printed them.
const UNTIERED = Number.MAX_SAFE_INTEGER;
const tierOf = (p) => (typeof p?.tier === "number" && Number.isFinite(p.tier) ? p.tier : UNTIERED);

// "Puka Nacua" -> "Nacua" for the Slot column's tooltip. A generational suffix is not a surname, so
// "Marvin Harrison Jr." reads as "Harrison" rather than "Jr.".
const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);
function lastName(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1].toLowerCase())) parts.pop();
  return parts[parts.length - 1] || String(name ?? "");
}

// Builds the WR · Slot slot and the club slots that survive it, or null when no receiver clears the bar.
// Returns { slot, kept, reason }: `slot` is the synthetic column's slot object, `kept` the cloned club
// slots with their slot men removed (an emptied one is dropped outright, so its column disappears from
// the row), and `reason` the tooltip sentence naming every man in the column and the rate he plays inside
// at. Called by layoutPassCatchers below AND by zoom.js's group page, so the two draw one regrouping.
export function regroupSlotReceivers(wrSlots) {
  // Pass one: every charted receiver PlayerProfiler has measured, deduped by card/playerKey (first listing
  // wins — a chart that lists one man in two receiver columns; dedupSlots already resolves that on the
  // server, this is belt and braces). wrSlots arrives in the club's own column order, so the array
  // position IS the rank D90 orders by.
  const charted = [];
  const seen = new Set();
  wrSlots.forEach((s, rank) => {
    (s.players || []).forEach((p, row) => {
      if (seen.has(p) || (p.playerKey != null && seen.has(p.playerKey))) return;
      const rate = rateOf(p);
      if (rate == null) return;
      seen.add(p);
      if (p.playerKey != null) seen.add(p.playerKey);
      charted.push({ p, rate, rank, row, tier: tierOf(p), snaps: slotSnapsOf(p) });
    });
  });

  // Pass two: everyone at or above SLOT_COLUMN_MIN_RATE, ordered per D90 (tier, then column rank, then
  // slot snaps with the bigger workload first and null last, then the club's own printed row).
  const qualified = charted
    .filter((c) => c.rate >= SLOT_COLUMN_MIN_RATE)
    .sort((a, b) => a.tier - b.tier || a.rank - b.rank || (b.snaps ?? -1) - (a.snaps ?? -1) || a.row - b.row)
    .map((c) => c.p);
  if (!qualified.length) return null;
  const qualSet = new Set(qualified);
  const qualKeys = new Set(qualified.map((p) => p.playerKey).filter((k) => k != null));
  const isQualified = (p) => !!p && (qualSet.has(p) || (p.playerKey != null && qualKeys.has(p.playerKey)));

  // Pass three (D93): a club column whose own STARTER qualifies (columnDecider decides who that is for a
  // listed-OUT/ACTIVE-fill-in pair) takes its WHOLE column into the Slot column, same order, rather than
  // leaving its backups behind in an orphaned column. With two qualifying starters, the higher-ranked
  // column (lower columnOrder, D92) wins and becomes the Slot column; the other starter moves in as an
  // individual and HIS backups stay behind in his own, now backup-led, club column — the one case that can
  // still leave a club column holding nothing but backups (see the kept.sort below, D92).
  //
  // Accepted edge, low priority (no real club hits it today): if the column that LOSES the two-starters tie
  // is a [STARTER_OUT, ACTIVE] pair and only the fill-in qualifies, he moves in alone and the out man is
  // left leading his old column, whose `injury` block still names that fill-in as covering for him, now
  // drawn one column over.
  const starterColumns = wrSlots.filter((s) => starterLed(s) && isQualified(columnDecider(s)));
  const source = starterColumns.length
    ? starterColumns.reduce((a, b) => ((a.columnOrder ?? 0) <= (b.columnOrder ?? 0) ? a : b))
    : null;
  const group = source ? (source.players || []).slice() : [];
  const inGroup = new Set(group);
  const groupKeys = new Set(group.map((p) => p.playerKey).filter((k) => k != null));
  // Men who qualify on their own, from every OTHER column, join the starter-led group in D90's order (tier,
  // then column rank, then slot snaps, then printed row) — but split so a BACKUP never sits above a
  // STARTER (D90): a second qualifying starter joins right under the source column's line-one block, ahead
  // of the backups that column carried in.
  const individuals = qualified.filter((p) => !inGroup.has(p) && !(p.playerKey != null && groupKeys.has(p.playerKey)));
  // A starter is a man his club lists on line one or two (tier 0/1) or whom the server marks as leading a
  // column (D12/D44's listed-OUT starter + ACTIVE fill-in, or a co-starter) — the same test starterLed uses.
  const isStarter = (p) => tierOf(p) <= 1 || STARTER_LED_ROLES.has(p.role) || p?.coStarter === true;
  const head = group.slice(0, lineOneBlock(source));
  const carried = group.slice(head.length);
  const men = source
    ? [...head, ...individuals.filter(isStarter), ...carried, ...individuals.filter((p) => !isStarter(p))]
    : [...individuals];

  const moved = new Set(men);
  const movedKeys = new Set(men.map((p) => p.playerKey).filter((k) => k != null));
  const kept = [];
  for (const s of wrSlots) {
    const players = (s.players || []).filter((p) => !moved.has(p) && !(p.playerKey != null && movedKeys.has(p.playerKey)));
    if (players.length) kept.push({ ...s, players });
  }
  // D92: lifting the slot men out can leave a column with nothing but backups in it (the losing starter
  // above, or a chart never starter-led to begin with). That is not a number-two receiver and must not be
  // drawn ahead of a starter's column, so starter-led columns sort first and backup-led ones follow, each
  // group keeping the server's own order.
  kept.sort((a, b) => (starterLed(a) ? 0 : 1) - (starterLed(b) ? 0 : 1));

  // The derived column stands where the source club column stood, so it carries that column's own dressing
  // with it — `injury` (cards.js's heat underline/glow) and `rankSource`/`espnRank`/`clubLabel`
  // (columnRankReason's tooltip) — or the Slot column would lose a club's injury heat the moment its
  // starter qualified. Absent when no starter column qualified. `sourceSlotId` is informational only.
  const slot = {
    slotId: "OFF-WR-SLOT", unit: "OFF", band: "WR", ordinal: 0, columnOrder: 0,
    label: "WR · Slot", derived: true, players: men,
    ...(source
      ? { injury: source.injury, rankSource: source.rankSource, espnRank: source.espnRank, clubLabel: source.clubLabel, sourceSlotId: source.slotId }
      : {}),
  };
  // D86: the tooltip leads with the rate that qualified each man and carries his slot snaps in brackets
  // behind it (dropped when null — D117 admits a man on rate alone with no snap count).
  const entryOf = (p) => {
    const snaps = slotSnapsOf(p);
    return `${lastName(p.name)} ${rateOf(p)}%${snaps == null ? "" : ` (${snaps} slot snaps)`}`;
  };
  // D93: the column can hold men who never cleared the bar — a qualifying starter's own backups, carried in
  // with his column. The first sentence names only the men the bar was actually read on, so it stays true;
  // the carried men (including a listed-OUT starter above an ACTIVE fill-in who didn't clear the bar
  // himself) are named in a clause of their own, so nobody on the column is left unexplained.
  const carriedOver = source ? men.filter((p) => inGroup.has(p) && !isQualified(p)) : [];
  const decider = source ? columnDecider(source) : null;
  const carriedClause = carriedOver.length && decider
    ? `; listed behind ${lastName(decider.name)} by the club: ${carriedOver.map((p) => lastName(p.name)).join(", ")}`
    : "";
  const reason = `Slot receivers (40 percent or more of their snaps inside): ${men.filter(isQualified).map(entryOf).join(", ")}${carriedClause}`;
  return { slot, kept, reason };
}

// D92: a receiver column's number is ESPN's rank of the man leading it, not the club's, so a leftover
// column's tooltip has to say where its number came from AND what the club itself prints, or the pill and
// the tooltip would contradict each other. `rankSource` is the server's own provenance ("espn" when ESPN
// ranked the leading man, "chart" when only the chart's printed order placed the column); the club's
// printed position is the number on its own label, or the column's ordinal when the club doesn't number.
//
// D93 renumbers surviving columns down their left-to-right order, so the pill on the box and this sentence
// can quote two different numbers (pill WR1, server label WR2) — `displayLabel` is what the box actually
// prints, and when it differs from the server's own label the sentence opens by saying so.
//
// D94: WR columns built straight off ESPN's own chart carry `clubLabel: "WR (ESPN)"` and `labelSource:
// "espn"`, and have no real club position to quote (printedOrdinal would otherwise fall back to
// `slot.ordinal`, which is just ESPN's own column count dressed up as something the club printed). Such a
// column drops the "the club prints it" clause and says only what's true: ESPN listed it at this number.
// Called by layoutPassCatchers below AND by zoom.js's group page, so both print the same sentence.
const ORDINAL_SUFFIX = (n) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");
function printedOrdinal(slot) {
  const m = /(\d+)\s*$/.exec(String(slot?.clubLabel ?? ""));
  const n = m ? Number(m[1]) : Number(slot?.ordinal);
  return Number.isFinite(n) && n > 0 ? `${n}${ORDINAL_SUFFIX(n)}` : null;
}
export function columnRankReason(slot, displayLabel = null) {
  const printed = printedOrdinal(slot);
  const renumbered = displayLabel && displayLabel !== slot?.label
    ? `Numbered ${displayLabel} here because the slot man's column stands apart; `
    : "";
  const isEspnColumn = slot?.clubLabel === "WR (ESPN)" || (slot?.band === "WR" && slot?.labelSource === "espn");
  if (isEspnColumn) {
    return `${renumbered}ESPN lists this column ${slot.label}`;
  }
  if (slot?.rankSource === "espn") {
    return `${renumbered}ESPN ranks this column ${slot.label}${printed ? `; the club prints it ${printed}` : ""}`;
  }
  return `${renumbered}${printed ? `printed ${printed} on the chart` : "printed in the chart's own order"}`;
}

// The PASS CATCHERS row (D69's row, D71's x-maths, D97's left-to-right order): one evenly-pitched cluster
// centred on the field's centre line, at the same MIN_PITCH every other row uses — not the field-accurate
// "two pitches outside the tackles" placement D63 originally used. Reads left to right as
//   WR1 · WR · Slot (if any) · WR2 · ... · TE(s) · WRlast
// i.e. the club columns in ascending order, the Slot column (if any) right after WR1, tight end(s) tucked
// inside the last receiver (a second TE stacks under the first on one x, so a two-TE club takes no extra
// width). Nothing is written back into `lm`: with the receivers in a cluster there is no receiver position
// for the secondary to mirror, so the corners/nickel are fixed off the tackles in mirrorLandmarks (D71).
function layoutPassCatchers(offSlots, lm, style) {
  const col = (slot, band, extra = {}) => ({ slot, x: lm.C, height: slotContentHeight(slot, style), width: colWidth(style), band, ...extra });
  const wrSlots = offSlots.filter((s) => s.band === "WR").slice().sort(byColumnOrder);
  const teCols = offSlots.filter((s) => s.band === "TE").slice().sort(byColumnOrder).map((s) => col(s, "TE"));

  // D83: the slot men are regrouped into their own column before any geometry happens, so the cluster is
  // laid out over the columns that will actually be drawn — an emptied club column is never given a place
  // in the comb and then hidden, it simply is not there.
  const grouped = regroupSlotReceivers(wrSlots);
  const slotCol = grouped ? col(grouped.slot, "WR", { displayLabel: "WR · Slot", derived: true, slotReason: grouped.reason }) : null;
  // D93: once a qualifying starter's whole column moves into the Slot column, what's left is a clean run of
  // real receiver columns, so they are RENUMBERED WR1, WR2… down their own left-to-right order (still
  // ESPN's, D92) — a display label only: the slot keeps the server's own `label`, so the tooltip can still
  // quote both numbers truthfully. A column left holding only the losing starter's backups (see
  // regroupSlotReceivers, D92) is not a number-two receiver, so it prints a plain "WR" and takes no number;
  // starter-led columns number straight through it.
  let wrRank = 0;
  const wrCols = grouped
    ? grouped.kept.map((s) => {
      const displayLabel = starterLed(s) ? `WR${++wrRank}` : "WR";
      return col(s, "WR", { displayLabel, slotReason: columnRankReason(s, displayLabel) });
    })
    : wrSlots.map((s) => col(s, "WR"));

  stackColumns(teCols); // TE2 under TE1: the stack takes ONE place in the cluster, not two
  const te = teCols.length ? [teCols[0]] : [];
  // D97: the pills must read ascending left to right (WR1, WR2, WR3…): the club columns stay in their own
  // order, the Slot column (if any) slots in right after WR1, and the tight end(s) stay tucked inside the
  // last receiver as D71/D76 place them.
  const placed = (wrCols.length > 1
    ? [wrCols[0], ...(slotCol ? [slotCol] : []), ...wrCols.slice(1, -1), ...te, wrCols[wrCols.length - 1]]
    : [...wrCols, ...(slotCol ? [slotCol] : []), ...te]
  ).filter(Boolean);
  const pitch = MIN_PITCH * PASS_CATCHER_PITCH;
  placed.forEach((c, i) => { c.x = lm.C + (i - (placed.length - 1) / 2) * pitch; });
  return [...(slotCol ? [slotCol] : []), ...wrCols, ...teCols];
}

// The BACKFIELD row: the quarterback stays centred on the centre (Adam: "QB centred behind C as now")
// and the backs flank him, alternating right then left, so a lone running back sits just off-centre and
// a RB+FB pair straddles the QB rather than crowding one shoulder.
function layoutBackfieldRow(offSlots, lm, style) {
  const qb = offSlots.filter((s) => s.band === "QB").slice().sort(byColumnOrder);
  const backs = offSlots.filter((s) => s.band === "BACKFIELD").slice().sort(byColumnOrder);
  const col = (slot, x, band) => ({ slot, x, height: slotContentHeight(slot, style), width: colWidth(style), band });
  const cols = [];
  const qbXs = spanPoints(lm.C, lm.C, qb.length);
  qb.forEach((slot, i) => cols.push(col(slot, qbXs[i], "QB")));
  // The backs spread across the same tackle-to-tackle span the rest of the offence uses, skipping the
  // centre so the quarterback keeps it to himself. Stepping them out from the centre by a fixed MIN_PITCH
  // instead opened a ~600px hole beside a lone running back once the side view scaled the row up.
  const half = Math.ceil(backs.length / 2);
  const left = spanPoints(lm.LT, lm.LG, half).slice(0, half);
  const right = spanPoints(lm.RG, lm.RT, backs.length - half);
  const backXs = [];
  for (let i = 0; i < backs.length; i++) backXs.push(i % 2 === 0 ? right[Math.floor(i / 2)] ?? left[Math.floor(i / 2)] : left[Math.floor(i / 2)] ?? right[Math.floor(i / 2)]);
  backs.forEach((slot, i) => cols.push(col(slot, backXs[i] ?? lm.C, "BACKFIELD")));
  return cols;
}

// Derives the defensive front's and secondary's mirror-grid landmarks from the OL row (exact tackle/
// guard/centre positions, since ruling D made the line row the five linemen alone). D71: the secondary's
// landmarks are decided HERE and nowhere else, never mirrored off the receivers — their centred cluster
// would otherwise drag the whole secondary into the middle of the field.
function mirrorLandmarks(olCols) {
  const olXs = olCols.map((c) => c.x).sort((a, b) => a - b);

  let LT, LG, C, RG, RT;
  if (olXs.length === 5) [LT, LG, C, RG, RT] = olXs;
  else if (olXs.length) {
    LT = olXs[0]; RT = olXs[olXs.length - 1]; C = olXs[Math.floor((olXs.length - 1) / 2)];
    LG = (LT + C) / 2; RG = (C + RT) / 2;
  } else {
    C = LAYOUT_WIDTH / 2; LG = C - MIN_PITCH; RG = C + MIN_PITCH; LT = C - 2 * MIN_PITCH; RT = C + 2 * MIN_PITCH;
  }
  const pitch = Math.max(LG - LT, MIN_PITCH);
  // D112/D116: edge rushers stand just outside the tackle, not out at the corner's landmark — the same on
  // every page, which D125 left untouched.
  const EDGE_L = LT - EDGE_PITCH_OUT * pitch;
  const EDGE_R = RT + EDGE_PITCH_OUT * pitch;
  // D116: the inside linebackers stand just inside the guards, not on top of them, so they read as clearly
  // inside their neighbouring EDGE column.
  const ILB_L = C - ILB_PITCH_FROM_CENTER * pitch;
  const ILB_R = C + ILB_PITCH_FROM_CENTER * pitch;
  // D125: corners, nickel and safeties hang off the CENTRE by the same three numbers on every page, each one
  // pitch clear of the landmark inside it — the nickel now sits inside the left tackle, not outside it.
  const CB_L = C - CB_PITCH_FROM_CENTER * pitch;
  const CB_R = C + CB_PITCH_FROM_CENTER * pitch;
  const NB_X = C - NB_PITCH_FROM_CENTER * pitch;
  const S_L = C - S_PITCH_FROM_CENTER * pitch;
  const S_R = C + S_PITCH_FROM_CENTER * pitch;
  return { LT, LG, C, RG, RT, pitch, EDGE_L, EDGE_R, ILB_L, ILB_R, CB_L, CB_R, NB_X, S_L, S_R };
}

// Ruling A: the LINE row places by LABEL, not by count, because it can now hold 3-5 columns of two
// different kinds. Ends (label "DE") go over/just outside the tackles; the interior (DT, or a 3-4's NT)
// takes the middle. The slots keep their own chart order; only their x's are assigned by kind, so the
// DOM order never has to change.
//
// D127 (Adam, every page): "for DE/DT/D-lines you can take advantage of the gaps, they don't need to sit
// right over the guards." The interior is ONE evenly-pitched cluster centred on the centre — one man on
// the centre, two in the gaps either side of it (±0.5 pitch), three on the centre and ±1, four at ±0.5
// and ±1.5 — instead of the guards-and-nose comb, which left a two-gap hole over the centre on the
// four-man DE, DT, DT, DE line ten clubs chart. The scheme no longer decides anything here: the count of
// interior men does, which is why a 3-4's lone nose still lands on the centre.
const isEndLabel = (slot) => /^(?:[LR]?DE)$/.test(String(slot?.label || "").toUpperCase());
function placeLineColumns(slots, lm) {
  const xs = new Array(slots.length);
  const ends = [], interior = [];
  slots.forEach((s, i) => (isEndLabel(s) ? ends : interior).push(i));
  // D127 follow-up: a line charting THREE or more ends has no label-led shape to fill, so it draws in the
  // club's chart order: a three-column line on tackle, centre, tackle like every other three-man line
  // (Minnesota charts DE, DE, DE); anything wider one pitch apart, centred on the centre.
  if (ends.length >= 3) {
    if (slots.length === 3) return [lm.LT, lm.C, lm.RT];
    return slots.map((_, i) => lm.C + (i - (slots.length - 1) / 2) * lm.pitch);
  }
  // A two-column line of TWO ENDS is two ends, so it takes the two tackle spots — D132's rule does not stop
  // applying because the line is short. Any OTHER two-column line sits in the gaps either side
  // of the centre in printed order (Atlanta charts NT, DE: D132 keeps Atlanta exactly as the club prints it).
  if (slots.length === 2) return ends.length === 2 ? [lm.LT, lm.RT] : [lm.C - 0.5 * lm.pitch, lm.C + 0.5 * lm.pitch];
  // D132 (Adam): ends go on the ends, tackles in the middle. A three-man line with ONE end (Arizona, New
  // Orleans) used to stand him on the centre between the tackles. He takes the tackle spot on the side the
  // club printed him (right only when printed last); a lone nose, else the first interior man, takes the centre.
  if (slots.length === 3 && ends.length === 1) {
    const e = ends[0];
    const noses = interior.filter((i) => String(slots[i]?.label || "").toUpperCase() === "NT");
    const mid = noses.length === 1 ? noses[0] : interior[0];
    const far = interior.find((i) => i !== mid);
    const left = e !== 2;
    xs[e] = left ? lm.LT : lm.RT; xs[mid] = lm.C; xs[far] = left ? lm.RT : lm.LT;
    return xs;
  }
  interior.forEach((idx, k) => (xs[idx] = lm.C + (k - (interior.length - 1) / 2) * lm.pitch));
  const innerL = interior.length ? Math.min(...interior.map((idx) => xs[idx])) : lm.C;
  const innerR = interior.length ? Math.max(...interior.map((idx) => xs[idx])) : lm.C;
  // D127: an end keeps his tackle's landmark unless the interior cluster has grown out to within MIN_PITCH
  // of it, in which case he steps OUT (away from the centre) by exactly the shortfall.
  // D132: a LONE end in a wider line takes the tackle on the side the club printed him, never the centre.
  // "A wider line" means more than one column: a chart with a single DE row and nothing else has no side to
  // be on, so he sits on the centre where the only man on the line belongs.
  const endXs = ends.length === 1 && slots.length > 1
    ? [ends[0] >= slots.length / 2 ? lm.RT : lm.LT]
    : placeOuterInner(ends.length, lm.LT, lm.RT, lm.LG, lm.RG);
  ends.forEach((idx, k) => {
    const x = endXs[k];
    if (!interior.length || Math.abs(x - lm.C) < 0.5) xs[idx] = x;
    else xs[idx] = x < lm.C ? Math.min(x, innerL - MIN_PITCH) : Math.max(x, innerR + MIN_PITCH);
  });
  return xs;
}

// D128(1) (Adam, every club): Tennessee prints its linebackers MLB, OLB, OLB and the row was filled in that
// printed order, standing the middle linebacker on the LEFT. The row now places by LABEL like the line does:
// the one column the club calls MLB (or MIKE) takes the centre and the rest flank him keeping their printed
// left-to-right order. Only a row with a centre spot (an ODD count) is re-ordered: a two-backer row (MLB, OLB)
// stays the symmetric pair it always was, and two Mikes or none keeps D116's placement. Placement only —
// no column's label, slot or men ever change here (Adam: "before was right, make sure it's STILL right").
const isMikeLabel = (slot) => /^(?:MLB|MIKE)$/.test(String(slot?.label || "").toUpperCase());
function placeLbColumns(slots, lm) {
  const count = slots.length;
  const mikes = [];
  slots.forEach((s, i) => { if (isMikeLabel(s)) mikes.push(i); });
  if (mikes.length !== 1 || count % 2 === 0) {
    return count % 2 === 0
      ? placeFlankedCenter(count, lm.ILB_L, lm.ILB_R, lm.C)
      : placeFlankedCenter(count, lm.LG, lm.RG, lm.C);
  }
  const mike = mikes[0];
  const flankers = slots.map((_, i) => i).filter((i) => i !== mike);
  // How many flankers go left is where the club printed the Mike, pulled back to an even split when he is
  // printed at one end of the row — otherwise Tennessee's leading MLB would leave both its OLBs on one side
  // and the "centre" column would be the leftmost thing on the row.
  const left = Math.min(Math.max(mike, Math.floor(flankers.length / 2)), Math.ceil(flankers.length / 2));
  const leftXs = left ? spanPoints(lm.LG, lm.C, left + 1).slice(0, left) : [];
  const rightXs = flankers.length - left ? spanPoints(lm.C, lm.RG, flankers.length - left + 1).slice(1) : [];
  const xs = new Array(count);
  xs[mike] = lm.C;
  [...leftXs, ...rightXs].forEach((x, k) => (xs[flankers[k]] = x));
  return xs;
}

// The per-band mirroring rule: the LINE and LINEBACKER rows both place by label (above); a 3-4's outside
// linebackers sit just outside the tackles and any other stand-up edge label spreads between them; CB, NB
// and S on D125's centre-pitched landmarks.
//
// D111 changes NONE of the x's below — the one-row secondary is just the CB, NB and S bands drawn on a
// single y. Left to right that reads corner, nickel, safety, safety, corner; at the five-man shape every
// real club charts the gaps come out 242, 242, 290, 484 against a MIN_PITCH of 242, so nothing is re-pitched
// and no card touches another. colsFitOneRow below keeps that honest for a shape nobody charts yet.
function mirrorDefXs(band, slots, scheme, lm, frontOneRow = false) {
  const count = slots.length;
  if (count <= 0) return [];
  switch (band) {
    case "DL": return placeLineColumns(slots, lm);
    // D141: on the MERGED front row a club charting ONE edge column (Las Vegas) takes the LEFT edge spot
    // rather than the midpoint spanPoints would give it — the centre there is the linebackers' own ground,
    // and a lone rusher reads as a rusher only when he is wide, exactly as a lone end does under D132.
    case "EDGE": if (frontOneRow && count === 1) return [lm.EDGE_L];
      return scheme === "3-4"
        ? placeOuterInner(count, lm.EDGE_L, lm.EDGE_R, lm.LG, lm.RG)
        : spanPoints(lm.EDGE_L, lm.EDGE_R, count);
    // D128(1): by label, Mike on the centre (placeLbColumns). Its no-Mike fallback is D116's own rule —
    // a 3-4's ILB pair moves in to ILB_L/ILB_R, any other row spreads across the guards, which keeps
    // WLB/SLB outside rather than pushing them tighter than the inside backers they flank.
    case "LB": return placeLbColumns(slots, lm);
    // spanPoints(xMin,xMax,1) lands a single point on the exact MIDPOINT of its range — fine for a band
    // that belongs in the middle (NB, S), wrong for CB, whose range is the two outside corners: a chart
    // with only one combined CB slot (e.g. WAS) would draw it dead centre, on top of the nickel, leaving
    // both real corner spots empty. A lone CB instead takes the same outside spot spanPoints(...,2) would
    // give its first of two, so it still reads as "a corner". (D48/D57: which side is not football-
    // important, only that it is wide.)
    case "CB": return count === 1 ? [spanPoints(lm.CB_L, lm.CB_R, 2)[0]] : spanPoints(lm.CB_L, lm.CB_R, count);
    case "NB": return spanPoints(lm.NB_X, lm.NB_X, count);
    // D125: two safeties land S_PITCH_FROM_CENTER either side of the centre (1.2 pitches apart, ~74 units of
    // air between the cards), one lands on the centre, and three spread on the centre and one pitch either
    // side — MIN_PITCH floors that last shape, which is why three safeties keep today's wider spacing.
    case "S": return spanPoints(lm.S_L, lm.S_R, count);
    default: return spanPoints(lm.C, lm.C, count);
  }
}

// Safety net applied to every row after its columns get an x: real depth charts occasionally carry an
// unusual slot count where two DIFFERENT bands sharing one row, each computed independently, can coincide
// in ways no single band's own placement function can see coming. This sorts a row's columns by x, pushes
// any pair closer than their two half widths plus a small clearance apart, then re-centres the group on
// its original midpoint so a rare fix-up doesn't drift the row.
// The bare minimum turf between two adjacent cards — see MIN_PITCH above for why the two constants agree
// by construction (216 + 26 = 242) so this floor never actually re-pitches a row.
const MIN_CARD_GAP = 26;
function enforceNoOverlap(cols) {
  if (cols.length < 2) return;
  const originalMin = Math.min(...cols.map((c) => c.x));
  const originalMax = Math.max(...cols.map((c) => c.x));
  const sorted = cols.slice().sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const minDist = Math.max(sorted[i - 1].width / 2 + sorted[i].width / 2 + MIN_CARD_GAP, MIN_PITCH);
    if (sorted[i].x - sorted[i - 1].x < minDist) sorted[i].x = sorted[i - 1].x + minDist;
  }
  const shift = (originalMin + originalMax) / 2 - (sorted[0].x + sorted[sorted.length - 1].x) / 2;
  for (const c of sorted) c.x += shift;
}

// D111/D141: confirms a club's OWN columns can be drawn on one merged row before committing to it — stricter
// than "do the cards overlap", since enforceNoOverlap would happily shove a crowded row apart by re-pitching
// a column off its landmark or pushing a card off the sideline. A club that fails this falls back to the two
// rows it had before, on that row alone, instead of silently drawing a wrong one. No club's secondary fails
// it today — the widest anybody charts is 2 corners, a nickel and 2 safeties, and the check exists for a
// chart that adds a third corner or a fourth safety. On the front only Pittsburgh fails, with three edge
// columns and the middle one on the centre between its two inside backers.
function colsFitOneRow(cols) {
  if (cols.length < 2) return true;
  const sorted = cols.slice().sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const minDist = Math.max(sorted[i - 1].width / 2 + sorted[i].width / 2 + MIN_CARD_GAP, MIN_PITCH);
    if (sorted[i].x - sorted[i - 1].x < minDist - 0.5) return false;
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return first.x - first.width / 2 >= -0.5 && last.x + last.width / 2 <= LAYOUT_WIDTH + 0.5;
}

// Players carried on the roster but absent from the chart (role UNLISTED), grouped per real band —
// never merged across the bands sharing a row, so a tray can be aligned to that specific band's own
// columns rather than spanning the whole row.
function unlistedByBand(unlisted, unit) {
  const byBand = unlisted?.[unit] || {};
  return Object.entries(byBand).filter(([, list]) => Array.isArray(list) && list.length);
}

// A level label prints at the left edge of its span. When the level's own first row has a column close
// to that edge (D69's outside receiver, at the very end of the PASS CATCHERS row, is the real case), the
// label would otherwise land straight on top of that column's own label pill now that ruling B puts every
// column's pill at the top of its box. Lifting the label into the empty gap above the row — the same trick
// the old merged line row used — keeps both readable without moving either the stripe or the cards.
// Roughly the widest level label plus its left inset — D141's merged "LINEBACKERS · EDGE" is the widest
// there is and still measures under this at the level type's own size, so the gutter did not have to grow.
const LABEL_CLEAR_X = 190;
// Enough to clear the column pill below it AND leave visible air: the gap above any row is at least
// BAND_GAP, and at a level boundary BAND_GAP + LEVEL_GAP_EXTRA, so the lift lands the label inside empty
// turf rather than tight against the pill (at 15 the level caption and the "WR1" pill under it read as one
// two-line block). computeLayout clamps the lift on the offensive side so it can never cross back over the
// line of scrimmage.
const LABEL_LIFT = 27;

// D138 (the phone list): this engine's own rows, merged into LEVELS and in reading order — offence LINE,
// PASS CATCHERS, BACKFIELD (D130); defence LINE, EDGE, LINEBACKERS, SECONDARY. Derived from the very lists
// the field is drawn from (OFF_ROW_GROUPS, DEF_ROW_ORDER and their level maps), so a ruling that reorders
// the field reorders the list with it and the order is never written down a second time. Consecutive rows
// of one level merge (the one-row secondary is one SECONDARY level here).
export function levelGroups(unit) {
  const rows = unit === "OFF"
    ? OFF_ROW_GROUPS.map((g) => ({ level: OFF_ROW_LEVEL[g.key], label: OFF_LEVEL_LABEL[OFF_ROW_LEVEL[g.key]], bands: g.bands }))
    : DEF_ROW_ORDER.map((key) => ({ level: DEF_ROW_LEVEL[key], label: DEF_LEVEL_LABEL[DEF_ROW_LEVEL[key]], bands: DEF_ROW_BANDS[key] }));
  const out = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.level === row.level) last.bands.push(...row.bands);
    else out.push({ level: row.level, label: row.label, bands: [...row.bands] });
  }
  return out;
}

// ---- the layout ----------------------------------------------------------------------------------

// Computes the full geometry for a TeamView: every column's box (x, top, height, width) plus a tray box
// per band that has unlisted players, and the line-of-scrimmage y.
export function computeLayout(teamView, opts = {}) {
  const scheme = teamView.scheme || "4-3";
  const defSlots = teamView.units?.DEF || [];
  const offSlots = teamView.units?.OFF || [];
  const unlisted = teamView.unlisted || {};
  const style = layoutStyle(opts);

  // The OL row is computed first — every defensive x mirrors its tackle/guard/centre grid, the backfield
  // row hangs off the same centre, and D71's receiver cluster is centred on it. A view with no offense at
  // all (D72's defense page) takes mirrorLandmarks' own fallback comb, the same centred five-column grid a
  // real offensive line produces, so a defense draws identically whether or not the offense is on screen —
  // which is what makes D125's one set of secondary landmarks land on the same x's on all three pages.
  const olCols = layoutOlColumns(offSlots, style);
  const lm = mirrorLandmarks(olCols);
  const passCatcherCols = layoutPassCatchers(offSlots, lm, style);
  const backfieldCols = layoutBackfieldRow(offSlots, lm, style);

  // A row is built with its columns only; its tray height is decided afterwards by planTrays(), since a
  // tray whose own band has no columns is re-homed onto some OTHER row before the y-pass runs.
  const buildRow = (key, bands, unit, level, cols) => {
    // A stacked column (D63's TE2) is left out of enforceNoOverlap and follows its leader afterwards, or
    // the pass would read the two columns sharing one x as an overlap and shove them apart sideways.
    enforceNoOverlap(cols.filter((c) => !c.stackUnder));
    for (const c of cols) if (c.stackUnder) c.x = c.stackUnder.x;
    // A stacked column's height sits BELOW its leader, so the row must be tall enough for the whole stack.
    // D121: a dropped corner/nickel column starts `drop` below the row's top line, so it is reserved the
    // same way — which is also what keeps the row's bottom trays clear of it (planTrays hangs them off
    // contentHeight) and what pushes the LINEBACKERS row down by the drop.
    const contentHeight = cols.length
      ? cols.reduce((m, c) => Math.max(m, (c.yOffset ?? 0) + (c.drop ?? 0) + c.height), CARD_H1) : 0;
    return { key, bands, unit, level, cols, contentHeight, trays: [], trayHeight: 0, height: contentHeight };
  };

  // Ruling A: a band with no slots at all (a 4-3's EDGE band, now that its ends are linemen) takes ZERO
  // height — no floor, no stripe, no label, no level gap — even when it still has UNLISTED players (ATL
  // carries an edge rusher on the roster but no chart row); the row is dropped and its tray re-homed by
  // planTrays. Rebuilt fresh every call since the D111/D141 fit checks below build candidate merged rows and
  // throw them away, and buildRow mutates the x's it is given.
  // `frontOneRow` is the only thing a column's x depends on (D141's lone edge rusher), so it is asked for
  // explicitly rather than read off whichever row model has been chosen so far.
  const defColsFor = (bands, frontOneRow = false) => bands.flatMap((band) => {
    const slots = defSlots.filter((s) => s.band === band).slice().sort(byColumnOrder);
    const xs = mirrorDefXs(band, slots, scheme, lm, frontOneRow);
    return slots.map((slot, i) => ({ slot, x: xs[i], height: slotContentHeight(slot, style), band, width: colWidth(style) }));
  });

  // D111/D141: each merged row is used unless THIS club's own columns cannot be drawn on it without being
  // re-pitched or hanging off the sideline (colsFitOneRow). The two questions are asked separately, so a club
  // that fails one keeps the merged row it does fit. A fallback adds a row to that club's defence; if that
  // outgrew BOTH_SIDES_HALF, D152 would give it the offence's spare room (and only a club whose two halves
  // TOGETHER did not fit would grow its own canvas) rather than draw its rows through each other. Pittsburgh,
  // the one club that falls back, still fits inside BOTH_SIDES_HALF and draws at everyone's size.
  const secOneRow = colsFitOneRow(defColsFor(DEF_ROWS_ONE_SEC_ONE_FRONT.bands.SECONDARY));
  if (!secOneRow) console.warn("[field] this chart's secondary is too wide for one row; falling back to the two-row secondary (D111)");
  const frontOneRow = colsFitOneRow(defColsFor(DEF_ROWS_ONE_SEC_ONE_FRONT.bands.FRONT, true));
  if (!frontOneRow) console.warn("[field] this chart's edge rushers and linebackers are too wide for one row; falling back to two front rows (D141)");
  const defRows = defRowModel(secOneRow, frontOneRow);

  // D121/D141: the staggered bands of a merged row are stamped with their step before the row is measured, so
  // the reserved box, the trays below it and the row under it all see the same number. A club that fell back
  // to a two-row model above gets none of it (rowDropOf only knows the merged rows' own keys).
  const defRowsTopDown = defRows.order.slice().reverse().map((key) => {
    const bands = defRows.bands[key];
    const cols = defColsFor(bands, frontOneRow);
    for (const c of cols) {
      const drop = rowDropOf(key, c.band, style);
      if (drop) c.drop = drop;
    }
    const row = buildRow(key, bands, "DEF", defRows.level[key], cols);
    if (key === "FRONT") row.label = frontRowLabel(cols);
    return row;
  }).filter((row) => row.cols.length);

  const offRowCols = { PASS_CATCHERS: passCatcherCols, LINE: olCols, BACKFIELD: backfieldCols };
  const offRowsTopDown = OFF_ROW_GROUPS.map(({ key, bands }) =>
    buildRow(key, bands, "OFF", OFF_ROW_LEVEL[key], offRowCols[key])
  ).filter((row) => row.cols.length);

  planTrays([...defRowsTopDown, ...offRowsTopDown], unlisted);

  // D72: a line of scrimmage is the boundary BETWEEN two units, so a single-unit page has none — no yellow
  // line, no "LINE OF SCRIMMAGE" captions, and no gutter reserved for them. Instead the canvas carries one
  // caption naming the unit it is showing, where the whole-team field labels its two halves.
  const bothSides = defRowsTopDown.length > 0 && offRowsTopDown.length > 0;

  // Places one row list top-down starting at `top`, opening BAND_GAP between two rows in the same level,
  // BAND_GAP + LEVEL_GAP_EXTRA at a level boundary (Adam: "generous vertical separation" between levels),
  // plus a uniform `extraGap` spent as air between every pair of rows. Returns the y just past the last
  // row's bottom (or `top` unchanged for an empty list, so an empty side never pushes anything).
  // The gap pair is the one this style draws at — tighter in D134's reduced state, untouched anywhere else —
  // so a row's minimum pitch and the constant half above are always derived from the same numbers.
  const bandGap = bandGapOf(style);
  const levelGap = levelGapOf(style);
  const placeSpan = (rows, top, extraGap) => {
    let y = top;
    let prevLevel = null;
    for (const row of rows) {
      if (prevLevel !== null) y += bandGap + extraGap + (row.level !== prevLevel ? levelGap : 0);
      placeRow(row, y);
      y = row.bottom;
      prevLevel = row.level;
    }
    return rows.length ? y : top;
  };

  // The same span, measured at zero extra air — BAND_GAP/LEVEL_GAP_EXTRA only. This is the "minimum row
  // pitch that keeps cards from overlapping" D96 forbids compressing a side below.
  const naturalSpanHeight = (rows) => {
    let h = 0;
    let prevLevel = null;
    for (const row of rows) {
      if (prevLevel !== null) h += bandGap + (row.level !== prevLevel ? levelGap : 0);
      h += row.height;
      prevLevel = row.level;
    }
    return h;
  };

  let losY, layoutHeight, halves = null;
  if (bothSides) {
    // D107: the canvas is the CONSTANT BOTH_SIDES_HEIGHT, so every club draws on an identical canvas and
    // scale — it used to be the taller side's own natural height, and a shorter chart (a four-row defence)
    // came out MAGNIFIED by the fit engine. D152 decides how that one canvas is DIVIDED, and D96's equal
    // halves with the line on the midpoint hold only while both sides fit in half of it: a side that needs
    // more takes the other side's spare rather than making the whole canvas taller (the room arithmetic
    // below). Each half's rows spread evenly across its share; a side with one row sits at its natural height.
    const defMin = naturalSpanHeight(defRowsTopDown);
    const offMin = naturalSpanHeight(offRowsTopDown);
    // D140 (small screens only): `opts.ownHeight` drops the constant and gives the canvas THIS club's own
    // natural rows, so D134's scrolling page ends where the club's chart ends instead of at empty field. The
    // scale stays pinned to the floor (viewfit.js's SCROLL_STATE_OWN_HEIGHT). D152: the own height is now
    // defMin + offMin — each side exactly its own rows — rather than twice the taller side, so the page ends
    // where the chart ends on a club with one tall half too, and the line sits where the two meet.
    // D146 (4): SPEND SPARE HEIGHT WHEN THE WIDTH IS WHAT BINDS. With the player panel open the box is
    // narrower, so the canvas is scaled to fit the WIDTH, the height fit goes unused and a bare strip of turf
    // is left under the field. `opts.minHeight` spends it on air between the rows — the same lever the
    // single-unit pages have used since D72 (the `else` branch below), and the only one that fits D107,
    // because BOTH halves grow by the same amount: the fill alone never moves the line of scrimmage and every
    // club still draws at one size (the number depends on the window, never on the club). It can only ever
    // GROW the canvas past the constant, so a height-bound page asks for a minHeight under the constant and
    // nothing here moves. The ceiling is the single-unit page's own MAX_EXTRA_GAP per gap, and a side with one
    // row (nothing to spread) sets it to that side's natural height, which is to say: no growth at all.
    const spreadRoom = (rows, natural) => (rows.length > 1 ? natural + (rows.length - 1) * MAX_EXTRA_GAP : natural);
    // Never in D140's own-height state: filling would grow a short chart back toward the constant and put the
    // empty field back under it.
    const fillHalf = !opts.ownHeight && opts.minHeight > 0
      ? Math.min((opts.minHeight - MARGIN_TOP - MARGIN_BOTTOM - 2 * LOS_HALF_GAP) / 2,
        spreadRoom(defRowsTopDown, defMin), spreadRoom(offRowsTopDown, offMin))
      : 0;
    // D152: THE TWO HALVES SHARE ONE CANVAS. `room` is all the height there is for rows — the constant's two
    // halves, or the two sides' own needs when even that is not enough — and the line of scrimmage is then
    // placed where the two sides MEET rather than on the canvas midpoint:
    //   * both sides fit in half the room -> each gets exactly half, so the line is the midpoint and the
    //     layout is byte-identical to the equal-halves one (every club on the constant today);
    //   * one side needs more -> it takes its own minimum and the other keeps the rest, which is still at
    //     least that side's own minimum, and spreads its rows into it exactly as it always did;
    //   * both together need more than the constant -> the canvas grows by THAT shortfall (defMin + offMin),
    //     not by twice the larger side's overflow, which is what drew Atlanta 9.8 percent smaller.
    // The fill (D146 (4)) is untouched: it is still a per-half ceiling capped by what each side can actually
    // absorb, so it grows the room by the same amount on both sides and cannot move the line on a club whose
    // halves both fit — the no-feedback property D114 depends on (it can only ever ask for a TALLER canvas,
    // and a height-bound page asks for none at all).
    const constantHalf = opts.ownHeight ? 0 : bothSidesHalf(style);
    const room = Math.max(2 * constantHalf, defMin + offMin, 2 * fillHalf);
    // Half the room, unless one side's own rows need more than that — and never more than what leaves the
    // other side its own minimum. `room` is at least defMin + offMin, so that window is never empty.
    const defHalf = Math.min(Math.max(room / 2, defMin), room - offMin);
    const offHalf = room - defHalf;
    const spreadGap = (rows, natural, sideHalf) => (rows.length > 1 && sideHalf > natural) ? (sideHalf - natural) / (rows.length - 1) : 0;
    placeSpan(defRowsTopDown, MARGIN_TOP, spreadGap(defRowsTopDown, defMin, defHalf));
    // D107/D152: a side's boundary is its SHARE of the shared room, not its own rows' height — a defence with
    // fewer rows than its share can hold (a 4-3 with no EDGE row) leaves the spare as air at the bottom of its
    // own half instead of dragging the line up, so two clubs with the same needs put the line in the same place.
    losY = MARGIN_TOP + defHalf + LOS_HALF_GAP;
    const offStart = losY + LOS_HALF_GAP; // the same gutter both ways
    placeSpan(offRowsTopDown, offStart, spreadGap(offRowsTopDown, offMin, offHalf));
    layoutHeight = offStart + offHalf + MARGIN_BOTTOM;
    // D152: what the shared room was spent on, for the canvas watch in server/compile/coverage.js — which
    // side asked for more than its share, how far the line sits from the midpoint, and whether the club is
    // still on the constant. Read by nothing that draws, so it cannot change a layout.
    halves = { defMin, offMin, defHalf, offHalf, constantHalf, losShift: defHalf - (defHalf + offHalf) / 2 };
  } else {
    // D72/D75: a single-unit page has no LOS and no second side, so both lists start at the same top and
    // only one is ever populated. Spare height (`extraGap`) is shared out as air between the rows rather
    // than left as a black band under the last one (D58: use both axes). D108: the rows also start/end one
    // SIDE_INSET in from the margins so they don't sit flush against the turf's edges.
    const placeSingle = (extraGap) => {
      const top = MARGIN_TOP + SIDE_INSET;
      const defEnd = placeSpan(defRowsTopDown, top, extraGap);
      const offEnd = placeSpan(offRowsTopDown, top, extraGap);
      const end = defRowsTopDown.length ? defEnd : (offRowsTopDown.length ? offEnd : top);
      return end + SIDE_INSET + MARGIN_BOTTOM;
    };
    losY = null;
    layoutHeight = placeSingle(0);
    // The fill pass. `opts.minHeight` is the height this canvas would have to be to reach the bottom of the
    // window at the scale its width already dictates — viewfit.js measures the box and works it out, since
    // this module never sees a viewport. Only ever set on a single-unit page, and capped so a very sparse
    // unit ends up airy rather than adrift.
    const gapCount = defRowsTopDown.length + offRowsTopDown.length - 1;
    if (opts.minHeight > layoutHeight && gapCount > 0) {
      const extra = Math.min((opts.minHeight - layoutHeight) / gapCount, MAX_EXTRA_GAP);
      layoutHeight = placeSingle(extra);
    }
  }

  const allRows = [...defRowsTopDown, ...offRowsTopDown];
  const columns = allRows.flatMap((r) => r.cols);
  for (const c of columns) c.style = style; // D72: the box and the markup read the same options
  // The offensive labels may not be lifted above the line of scrimmage: D63's LINE row starts one
  // LOS_HALF_GAP below it, which is less than LABEL_LIFT, so an unclamped lift would print "LINE" on top
  // of the yellow line and its own "LINE OF SCRIMMAGE" captions. With no line of scrimmage (D72) there is
  // nothing above the first offensive row to protect, so the clamp is simply off.
  const levels = [...summarizeLevels(defRowsTopDown, DEF_LEVEL_LABEL), ...summarizeLevels(offRowsTopDown, OFF_LEVEL_LABEL, bothSides ? losY + 3 : -Infinity)];
  const trays = allRows.flatMap((row) => row.trays.map((t, i) => {
    const top = row.trayTop + i * (TRAY_H + TRAY_STACK_GAP);
    return { ...t, top, bottom: top + TRAY_H, ...fitTrayWidth(trayBounds(row, t.band), trayNaturalWidth(t)) };
  }));

  // D72: the caption the field SVG prints when there is no line of scrimmage to divide two halves.
  const caption = bothSides ? null : offRowsTopDown.length ? "OFFENSE" : defRowsTopDown.length ? "DEFENSE" : null;
  const layout = { layoutWidth: LAYOUT_WIDTH, layoutHeight, losY, caption, columns, trays, levels, halves, cardWidth: style.cardWidth, fieldMarginX: FIELD_MARGIN_X };
  if (opts.crop) cropLayout(layout);
  return opts.spread && opts.spread !== 1 ? spreadLayout(layout, opts.spread) : layout;
}

// D72: shrink-wraps the canvas around the columns actually on it. The full-width canvas exists because the
// whole-team field genuinely uses most of it (the corners are its widest row), but a single unit spans only
// a little over half of it — cropping keeps every card the same size in layout units and just moves the canvas
// edges in, so the fit engine's spread/scale arithmetic does the enlarging instead of leaving dead turf.
function cropLayout(layout) {
  let min = Infinity;
  let max = -Infinity;
  for (const c of layout.columns) {
    min = Math.min(min, c.x - c.width / 2);
    max = Math.max(max, c.x + c.width / 2);
  }
  if (!Number.isFinite(min) || max <= min) return layout;
  const dx = CROP_MARGIN - min;
  const width = max - min + CROP_MARGIN * 2;
  for (const c of layout.columns) c.x += dx;
  for (const lv of layout.levels) { if (lv.left != null) lv.left += dx; if (lv.right != null) lv.right += dx; }
  // Trays were fitted against the uncropped canvas, so one that had grown rightwards to hold its own text
  // has to be re-clamped to the narrower one rather than hanging off the new sideline.
  for (const t of layout.trays) {
    const w = Math.min(t.right - t.left, width);
    t.left = Math.min(Math.max(t.left + dx, 0), width - w);
    t.right = t.left + w;
  }
  layout.layoutWidth = width;
  return layout;
}

// Gives one row its y geometry. Ruling B: the column content sits at the row's TOP (label, starter, then
// backups reading downwards) on BOTH sides of the ball, and the "not on chart" trays are flush to the
// row's bottom. Every column is top-aligned on the row's shared top line, so a row reads as one row
// however deep the deepest column in it runs.
function placeRow(row, top) {
  row.top = top;
  row.bottom = top + row.height;
  row.contentTop = row.top;
  row.contentBottom = row.top + row.contentHeight;
  row.trayTop = row.trayHeight ? row.bottom - (row.trayHeight - TRAY_GAP) : row.bottom;
  row.trayBottom = row.bottom;
  for (const c of row.cols) {
    // D63: a stacked column (TE2 under TE1) takes its place down the stack rather than the row's top.
    // Every column starts on the row's shared top line (so a row reads as one row) but is sized to its OWN
    // content height, never stretched to the row's — otherwise a column shorter than its neighbours draws
    // an empty framed rectangle, with the part-time hatch and injury-heat glow, over turf with nothing in it.
    // D121: a corner/nickel column in the one-row secondary starts secondaryCornerDrop(style) below that
    // shared top line — the only thing on the field that does not start on its row's top line by choice.
    c.top = row.contentTop + (c.stacked ? c.yOffset ?? 0 : 0) + (c.drop ?? 0);
    c.unit = row.unit;
  }
}

// Decides which row each band's "not on chart" tray hangs under, and grows that row to make room. A tray
// normally sits under its own band's row; when that band has no columns (so its row was dropped) it is
// re-homed onto the last populated row of the same unit — the LINE row for a collapsed EDGE band — and
// renders with its band name so those players are still attributed correctly (Atlanta is the real case).
const TRAY_STACK_GAP = 4;
function planTrays(rows, unlisted) {
  for (const unit of ["DEF", "OFF"]) {
    const unitRows = rows.filter((r) => r.unit === unit);
    if (!unitRows.length) continue;
    for (const [band, entries] of unlistedByBand(unlisted, unit)) {
      const own = unitRows.find((r) => r.bands.includes(band));
      const row = own ?? unitRows[unitRows.length - 1];
      // D141: a MERGED row carries the EDGE band in its model even for a club that charts no edge column at
      // all, so the "these men are not standing under columns of their own" marker (styles.css's dashed
      // `.tray-homed`) asks whether the row actually DRAWS the band, not whether the model lists it.
      row.trays.push({ band, unit, entries, homed: !row.cols.some((c) => c.band === band) });
    }
    for (const row of unitRows) {
      combineRowTrays(row);
      row.trayHeight = row.trays.length ? TRAY_GAP + row.trays.length * TRAY_H + (row.trays.length - 1) * TRAY_STACK_GAP : 0;
      row.height = row.contentHeight + row.trayHeight;
    }
  }
}

// D144 — ONE TRAY STRIP PER ROW. A row's trays are DRAWN as one strip spanning that row's columns, with each
// band's own name printed inside it in front of its own men ("not on chart · CB  #29 …  · Safety  #40 …",
// cards.js's renderTray). A row with one band's tray is untouched and renders exactly as it always did.
// Why: D111/D141 merged two and three bands onto one row, and stacking one TRAY_H strip per band put the same
// men on two lines for height nobody reads as height. Because the reserve every club is measured against
// (defRowFullH) deliberately knows nothing about trays, that pushed New Orleans past the D107 constant and
// made the whole club draw smaller than the other 31.
//
// The escape hatch is width: the strip is one line (styles.css pins `flex-wrap:nowrap`), so a combined strip
// whose own estimated text is wider than the canvas would have names clipped off its right-hand end. Such a row
// keeps the stacked strips, which cost height but lose nothing.
//
// `homed` — styles.css's stronger dashed outline for "these men have no row of their own" — is true of the
// combined strip only when it is true of EVERY band on it, so a strip that is partly a visitor is not labelled
// as wholly one.
function combineRowTrays(row) {
  if (row.trays.length < 2) return;
  const first = row.trays[0];
  const combined = {
    // A strip carrying two bands has no single band, and `band: null` is what every reader of a tray already
    // understands: cards.js prints each group's own name instead of one label, and trayBounds spans the row's
    // whole set of columns rather than one band's, which is exactly where a shared strip belongs.
    band: null, unit: first.unit,
    entries: row.trays.flatMap((t) => t.entries ?? []),
    homed: row.trays.every((t) => t.homed),
    groups: row.trays.map((t) => ({ band: t.band, entries: t.entries })),
  };
  if (trayNaturalWidth(combined) > LAYOUT_WIDTH) return;
  row.trays = [combined];
}

// A tray is ONE strip TRAY_H tall. A single-column band's row is often not wide enough for "NOT ON CHART ·
// BACKFIELD" plus a name on one line, and styles.css pins the strip to one line (`flex-wrap:nowrap`), so
// the strip is widened to its own text's width instead. The text isn't measurable from here (this module
// never touches the DOM), so it's ESTIMATED from character counts at styles.css's tray sizes, deliberately
// generous: too wide costs empty turf, too narrow clips a name.
const TRAY_TEXT_PAD = 20;      // .tray's own left+right padding
const TRAY_ITEM_GAP = 8;       // .tray's flex gap
const TRAY_LABEL_CHAR_W = 6.2; // 10px uppercase, .08em letter-spacing
const TRAY_CHIP_CHAR_W = 6.0;  // 11.5px italic
const TRAY_CHIP_PAD = 18;      // .tray-chip's own padding
// One chip's estimated width — the piece the plain and the combined strip both need.
function trayChipWidth(p) {
  const text = `#${p.number ?? "—"} ${p.name ?? ""}${p.onActiveRoster === false ? " PS" : ""}`;
  return TRAY_ITEM_GAP + TRAY_CHIP_PAD + text.length * TRAY_CHIP_CHAR_W;
}
// A combined strip (combineRowTrays above) prints one label per band inside it — "not on chart · CB" in front of
// the corners, then "· Safety" in front of the safeties — so its estimate is the same arithmetic with a label
// per group. The rendered label is the band's DISPLAY name (cards.js's bandDisplay: "S" prints "Safety", "NB"
// prints "CB · Nickel"), and this module cannot read that table — cards.js already imports this file, and a
// circular import to estimate a string width is not worth having — so every group's band name is costed at the
// longest display name there is. The estimate is then never short, and erring long only ever sends a row back
// to today's stacked strips, which is the safe side of the decision.
const TRAY_BAND_NAME_CHARS = "CB · Nickel".length;
function trayNaturalWidth(tray) {
  if (tray.groups?.length) {
    let w = TRAY_TEXT_PAD;
    tray.groups.forEach((g, i) => {
      const label = (i ? "· " : "not on chart · ").length + TRAY_BAND_NAME_CHARS;
      w += (i ? TRAY_ITEM_GAP : 0) + label * TRAY_LABEL_CHAR_W;
      for (const p of g.entries ?? []) w += trayChipWidth(p);
    });
    return w;
  }
  const label = tray.band ? `not on chart · ${tray.band}` : "not on chart";
  let w = TRAY_TEXT_PAD + label.length * TRAY_LABEL_CHAR_W;
  for (const p of tray.entries ?? []) w += trayChipWidth(p);
  return w;
}

// Grows a tray's box to its natural width without letting it leave the canvas — .field-outer clips, so a
// tray hanging under the outermost column (D63 put a receiver at each end of the line row) would simply
// disappear off the sideline if it were allowed to grow rightwards unchecked.
function fitTrayWidth({ left, right }, natural) {
  const width = Math.min(Math.max(right - left, natural), LAYOUT_WIDTH);
  const l = Math.min(Math.max(left, 0), LAYOUT_WIDTH - width);
  return { left: l, right: l + width };
}

// A tray spans its own band's columns where the band has any, else the whole row it borrowed. A COMBINED strip
// (combineRowTrays) carries no single band, so the null it passes here takes that same whole-row span, which is
// where a strip serving two of the row's bands belongs.
function trayBounds(row, band) {
  const bandCols = row.cols.filter((c) => c.band === band);
  const cols = bandCols.length ? bandCols : row.cols;
  return {
    left: Math.min(...cols.map((c) => c.x - c.width / 2)),
    right: Math.max(...cols.map((c) => c.x + c.width / 2)),
  };
}

// One label per LEVEL (not per row) — consecutive rows sharing a level merge into a single span, so
// "secondary" (CB/NB and S, two rows) prints one label centred on its whole block. D63 removed the one
// row that used to carry two labels (the old RECEIVERS row's "RECEIVERS" and "TIGHT ENDS" segments), so
// every level is one label across the full canvas width again.
function summarizeLevels(rowsTopDown, labelMap, minLabelTop = -Infinity) {
  const out = [];
  let cur = null;
  let stripeIndex = 0;
  for (const row of rowsTopDown) {
    if (!cur || cur.level !== row.level) {
      // D141: a row may carry its OWN caption (the merged front row names only the groups actually on it);
      // every other row is named by its level, exactly as before.
      cur = { level: row.level, label: row.label || labelMap[row.level] || row.level, unit: row.unit, top: row.top, bottom: row.bottom, firstRow: row, stripeIndex: stripeIndex++ };
      out.push(cur);
    } else {
      cur.bottom = Math.max(cur.bottom, row.bottom);
    }
  }
  // Lift any label whose own first row has a column sitting under it (see LABEL_CLEAR_X above).
  for (const lv of out) {
    const cols = lv.firstRow ? lv.firstRow.cols : [];
    const crowded = lv.firstRow
      ? cols.some((c) => c.x - c.width / 2 < (lv.left ?? 0) + LABEL_CLEAR_X)
      : true; // a label with no row of its own sits directly over its block, so it always lifts
    if (crowded) lv.labelTop = Math.max(lv.top - LABEL_LIFT, minLabelTop);
    delete lv.firstRow;
  }
  return out;
}

// Ruling E scales the whole canvas to fit the window, and the binding constraint is almost always HEIGHT,
// which can leave dead black turf down each side of the field. Multiplying every x, column width and the
// canvas width by one factor spreads the columns to the sidelines and widens them proportionally, so the
// extra room goes into the names instead of margins. Heights are untouched, so nothing re-flows vertically.
export function spreadLayout(layout, S) {
  for (const c of layout.columns) { c.x *= S; c.width *= S; }
  for (const t of layout.trays) { t.left *= S; t.right *= S; }
  for (const lv of layout.levels) { if (lv.left != null) lv.left *= S; if (lv.right != null) lv.right *= S; }
  layout.layoutWidth *= S;
  layout.cardWidth *= S;
  layout.fieldMarginX *= S;
  return layout;
}

// One faint full-width tinted stripe per level (LINE/EDGE/LINEBACKERS/SECONDARY on defense, LINE and
// BACKFIELD on offense) plus a bigger, higher-contrast label at the left edge — a team-colour stripe
// (alternating darker/lighter so adjacent levels read as distinct) makes the levels obvious at a glance
// (D48). Plain constant strings only (no player-supplied text), so no esc() is needed here.
export function renderLevelLabels(levels, layoutWidth = LAYOUT_WIDTH) {
  return levels.map((lv, i) => {
    const h = lv.bottom - lv.top;
    // Alternating by the level's OWN index rather than by position in this array, so that two entries
    // belonging to one level always share a tint and read as one band of turf.
    const alpha = (lv.stripeIndex ?? i) % 2 === 0 ? 6 : 11;
    // A level entry MAY carry its own left/right instead of spanning the full canvas width, and its own
    // labelTop when the generic top+4 would land on a column's label pill.
    const left = lv.left ?? 0;
    const width = (lv.right ?? layoutWidth) - left;
    const labelTop = lv.labelTop ?? lv.top + 4;
    return `<div class="level-stripe" style="top:${lv.top}px;left:${left}px;width:${width}px;height:${h}px;--stripe-alpha:${alpha}%"></div>
      <div class="level-label" style="top:${labelTop}px;left:${left + 8}px">${lv.label}</div>`;
  }).join("");
}

// Builds the field's vector dressing (yard lines, hashes, highlighted line of scrimmage). Turf itself is
// a CSS repeating-gradient on the wrapper; this SVG only draws the thin vector marks on top of it, sized
// to exactly match the layout canvas so it scales together with the cards under the one shared transform.
// D72: `losY` is null on a single-unit canvas — no yellow line and no LINE OF SCRIMMAGE captions;
// `caption` ("OFFENSE" / "DEFENSE", which computeLayout supplies) prints once at the top right instead.
// D156: a TWO-sided canvas no longer prints the tiny corner pair here at all. Both pages that draw one
// (the whole-team field and the matchup field) now name their halves with the etched turf wordmarks in
// cards.js's unitTagsHtml, and the corner captions said the same thing a second time — the matchup page
// had already been hiding them in CSS since D113. The single-unit branch above is untouched.
export function renderFieldSvg(layoutHeight, losY, layoutWidth = LAYOUT_WIDTH, caption = null) {
  const w = layoutWidth;
  const lines = [];
  // Yard lines only — no hash-mark ticks: a fixed percentage position doesn't line up with any column once
  // ruling E's compact overview reflows column x's per team.
  for (let ly = 50; ly < layoutHeight - 30; ly += 80) {
    lines.push(`<line x1="40" y1="${ly}" x2="${w - 40}" y2="${ly}" stroke="rgba(255,255,255,.13)" stroke-width="2"/>`);
  }
  const sidelineTop = `<line x1="12" y1="0" x2="12" y2="${layoutHeight}" stroke="rgba(255,255,255,.35)" stroke-width="4"/>`;
  const sidelineBottom = `<line x1="${w - 12}" y1="0" x2="${w - 12}" y2="${layoutHeight}" stroke="rgba(255,255,255,.35)" stroke-width="4"/>`;
  const unitLabel = (text, y) => `<text x="${w - 26}" y="${y}" fill="rgba(255,255,255,.45)" font-size="14" font-weight="800" letter-spacing="3" text-anchor="end">${text}</text>`;
  if (losY == null) {
    // One unit on the canvas: the only dressing is the turf, the sidelines and the unit's own caption.
    const cap = /^[A-Z ]{1,20}$/.test(String(caption ?? "")) ? unitLabel(caption, 20) : "";
    return `<svg viewBox="0 0 ${w} ${layoutHeight}" width="${w}" height="${layoutHeight}" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;pointer-events:none;">
      ${sidelineTop}${sidelineBottom}${lines.join("")}${cap}
    </svg>`;
  }
  const los = `<line x1="20" y1="${losY}" x2="${w - 20}" y2="${losY}" stroke="#ffdd00" stroke-width="3"/>`;
  // Two shorter captions flanking the ends of the line, because a single centred one sat directly over the
  // NT/DT column and was hidden behind it.
  const losLabelLeft = `<text x="30" y="${losY - 5}" fill="#ffdd00" font-size="11" font-weight="700" text-anchor="start" letter-spacing="1.2">LINE OF SCRIMMAGE</text>`;
  const losLabelRight = `<text x="${w - 30}" y="${losY - 5}" fill="#ffdd00" font-size="11" font-weight="700" text-anchor="end" letter-spacing="1.2">LINE OF SCRIMMAGE</text>`;
  return `<svg viewBox="0 0 ${w} ${layoutHeight}" width="${w}" height="${layoutHeight}" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;pointer-events:none;">
    ${sidelineTop}${sidelineBottom}${lines.join("")}${los}${losLabelLeft}${losLabelRight}
  </svg>`;
}

// Exported so tests read these numbers from here instead of hardcoding literals that go stale silently the
// moment a ruling moves a constant — a test states the RELATIONSHIP (a corner is CB_PITCH_FROM_CENTER pitches
// off the centre; two cards never come closer than MIN_CARD_GAP) rather than a specific number.
export const geometry = { CARD_W, CARD_H1, ROW_H, SIDE_ROW_H, CARD_GAP, SIDE_CARD_GAP, BANNER_H, OUT_RAIL_H, LABEL_RESERVE, MAX_DEPTH_ROWS, REDUCED_DEPTH_ROWS, DEPTH_CHIP_H, HEADSHOT_SIZE, BAND_GAP, LEVEL_GAP_EXTRA, REDUCED_BAND_GAP, REDUCED_LEVEL_GAP_EXTRA, LOS_HALF_GAP, MARGIN_TOP, MARGIN_BOTTOM, SIDE_INSET, DEF_ROW_FULL_H, DEF_ROW_COUNT: DEF_ROW_ORDER.length, DEF_LEVEL_BOUNDARIES, BOTH_SIDES_HALF, BOTH_SIDES_HEIGHT, MIN_PITCH, MIN_CARD_GAP, EDGE_PITCH_OUT, ILB_PITCH_FROM_CENTER, PASS_CATCHER_PITCH, SECONDARY_CORNER_AIR, secondaryCornerDrop, FRONT_LB_LIFT,
  S_PITCH_FROM_CENTER, NB_PITCH_FROM_CENTER, CB_PITCH_FROM_CENTER,
  // The corner step is published as the FUNCTION alone, never as a number: it is 46 on the Team and Matchup
  // pages and 64 on the Offense/Defense pages, where a line-one card carries a headshot (D146 (2)). Ask
  // secondaryCornerDrop(layoutStyle(opts)) with the options of the page being drawn.
  lineOneBase };
