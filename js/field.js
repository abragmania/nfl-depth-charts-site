// Depth-aware field layout engine. Pure geometry — no DOM here except the small SVG markup builder
// at the bottom. Everything is computed in "layout units" on a fixed-width (LAYOUT_WIDTH) canvas;
// team.js scales the whole result to the wrapper with a single CSS transform, so this module never has
// to know the viewport size (👁 review requirement C: scale as one unit).
//
// Why computed instead of fixed coordinates (🔵 review, 2026-09-11): a slot can carry any number of
// players (D23 — no fixed roster cap), so a fixed y per band overlaps as soon as a column runs deep.
// Heights below are therefore a function of the deepest column in each band, and columns are spaced
// across a band's x-range rather than pinned to literal pixel anchors (review requirement B).
//
// ---------------------------------------------------------------------------------------------------
// RULING E (Adam, 2026-09-13) — "it does not fit on my monitor yet and I have a big monitor."
// The whole-team page is now a COMPACT OVERVIEW, designed from the start to fit a 1700x900 CSS-pixel
// viewport with no scrolling in either direction, rather than a big-card field that gets shrunk until
// it fits. Concretely: no headshots, each column is a label pill + the starter as one bold row
// (number, name, rating pill in its colour tier) + slim one-line rows for the backups, at most three
// of those with a "+N more" tail. Status badges, the STARTER_OUT/ACTIVE treatment and the rating tier
// colours all survive; levels, level stripes, level labels and the line of scrimmage all stay.
// The constants below are sized so the finished canvas is short enough that team.js's scale lands near
// 1.0 at 1700px wide — layout units are deliberately close to real screen pixels, so the type sizes in
// styles.css read the same on screen as they do here.
//
// RULING A (Adam, 2026-09-13, supersedes D14) — a defensive end is a DEFENSIVE LINEMAN. DE/LDE/RDE are
// band DL and share the LINE row with the tackles, so that row now holds 3-5 columns and has to place
// by LABEL, not by count (see placeLineColumns). A 4-3 whose ends are labelled DE therefore has an
// EMPTY EDGE band — an empty row must vanish completely: no height, no stripe, no label, no level gap.
//
// RULING B (Adam, 2026-09-13) — "put the backup boxes under the starters." Every column, offense and
// defense, now reads top-down: label, starter, backups beneath, tray at the row's bottom edge. The old
// `.column-stack.stack-reverse` / bottom-flush defensive rows are gone.
//
// RULING D (Adam, 2026-09-13) — "it's not helpful to see a long row of offensive guys with WR and
// offensive linemen combined", refined to "offensive line LT LG C RG RT go together; WRs go together,
// TEs go near WRs but not with them." The offense was three rows: LINE (the five linemen alone, still
// the grid the defense mirrors), BACKFIELD (QB on the centre with the backs flanking him) and RECEIVERS
// (one tight WR cluster, a deliberate gap, then the TE block under its own "TIGHT ENDS" label).
//
// D63 (Adam, 2026-09-15), which supersedes ruling D's third row — the receivers belong ON the line,
// where they actually line up. Left to right the comb reads: outside WR, slot WR, LT LG C RG RT, TE,
// outside WR, every column one pitch from the next (so the slot really is the midpoint between the
// left tackle and the outside receiver, and the right side mirrors that distance). A second tight-end
// column stacks directly UNDER the first instead of taking a second x. The RECEIVERS row and the TIGHT
// ENDS label are gone; BACKFIELD keeps QB/RB/FB.
// The pay-off is on the other side of the ball: the secondary can mirror the REAL receiver positions
// again (corners over the outside receivers, nickel over the slot) instead of the "two pitches outside
// the tackles" approximation ruling D forced on it.
//
// D69 (Adam, 2026-09-15) — "the offense takes up so little of the screen and the defense so much" plus
// "make a pass catchers section... visually separate from the linemen." First cut kept D63's single LINE
// row and carved it into two labelled SEGMENTS (receivers left/right of the line). Adam's refinement,
// given while that cut was already in progress, overrode it: "the pass catchers get their OWN ROW placed
// ABOVE the offensive line... even though it technically isn't how they line up, it's easier visually." So
// PASS CATCHERS is now a normal third offensive row — full width, its own stripe and label, exactly like
// LINE and BACKFIELD — sitting BETWEEN the line of scrimmage and the LINE row rather than sharing a row
// with it. Top-down from the LOS the offense now reads PASS CATCHERS, LINE, BACKFIELD (OFF_ROW_GROUPS).
//
// D71 (Adam, 2026-09-15), which supersedes D63's field-accurate receiver x's — "the pass catchers row is a
// normal centred cluster, not spread to the sidelines". layoutPassCatchers no longer hangs the receivers
// off the ends of the offensive-line comb: it places them as one evenly-pitched block centred on the
// field's centre line, reading left to right as outside WR, WR · Slot (always INSIDE the outside man),
// any further receivers, then the tight ends (TE2 still stacked under TE1 on one x). The knock-on is that
// the receivers no longer tell the defense where to stand: the corners go back to a fixed 1.4 pitches
// outside the tackles and the nickel to the gap between the left corner and the box, both computed once in
// mirrorLandmarks, so a defensive row's shape no longer changes with how many receivers a club charts.
//
// D72 (Adam, 2026-09-15) — the OFFENSE and DEFENSE pages are this same engine drawing ONE unit (zoom.js
// hands computeLayout a TeamView carrying only that unit, the way matchup.js already hands it a synthetic
// two-team one). Three things change for a half-field, all driven by `opts` rather than by a second engine:
// there is no line of scrimmage (losY is null and the canvas carries a single "OFFENSE"/"DEFENSE" caption
// instead of one per half), the canvas is CROPPED to the columns actually on it so the fit engine can scale
// a short chart up instead of being pinned by a full-width canvas it is not using, and the rows are drawn
// at the bigger `style` a 1.3-1.8x scale affords — a small headshot on each line-one row and one more depth
// row before the "+N" tail.

// D110 (Adam, 2026-09-16) — "pull the columns closer together so the layout is narrower than the screen
// ratio and the cards grow to fill it." The ruling named LAYOUT_WIDTH as the lever: take the canvas from
// 1800 down toward ~1475 and every column, being a fixed share of a narrower canvas, comes out bigger on
// screen. MEASURED, THAT LEVER IS ALREADY AT ITS STOP, and the canvas width therefore does NOT move.
//
// Why, in the fit engine's own terms (viewfit.js, which this ruling does not open). A team/matchup canvas
// is far taller in proportion than the box it has to land in — 1800 x 1106 is 1.63:1 against a measured
// 1619 x 584 field box at a 1700x900 window (2.77:1) and 1914 x 663 at Adam's 2000x980 (2.89:1). The
// engine closes that gap with `spread`: it rebuilds the canvas horizontally by kW/kH so that the width fit
// and the height fit land on the same scale, and a column's size on screen is then
//     card px = CARD_W x spread x scale = CARD_W x (box width / LAYOUT_WIDTH)
// — i.e. exactly the ratio the ruling is aiming at. BUT the spread is capped at MAX_SPREAD = 1.8, and the
// measured spreads are already 1.70 at 1700x900 and 1.77 at Adam's 2000x980. Narrowing LAYOUT_WIDTH raises
// the spread the engine ASKS for; past the cap it stops being granted, the formula above stops holding, and
// the card stays frozen at CARD_W x 1.8 x scale while the canvas simply stops reaching the right-hand edge.
// Concretely, at the ruling's own 1475 the cap binds on every screen: the card would come out 171 px at
// 1700x900 and 194 px at 2000x980 (against the ruling's targets of 195-205 and ~230) with ~350 px of dead
// turf down the sides of Adam's screen — the empty bands the ruling was raised to remove. The matchup page,
// whose halves are taller than the constant, is at the cap TODAY, so for it a narrower canvas is pure loss.
//
// So the ruling's ARITHMETIC is delivered where it is not capped — through the card's share of the canvas,
// CARD_W / LAYOUT_WIDTH, which is the one number that actually sets how big a column reads. The ruling asks
// for 180/1475 = 0.122; this file now carries 216/1800 = 0.120, the same chart at the same proportions, on a
// canvas wide enough that the fit engine can still spread onto it. The pitches come down in proportion
// exactly as the ruling describes (a column is now a much bigger share of the turf between its neighbours),
// and nothing vertical moves: D109's 1106 stands.
const REFERENCE_WIDTH = 1600; // the OFF_BANDS anchors below were tuned against this width
export const LAYOUT_WIDTH = 1800;
const SCALE = LAYOUT_WIDTH / REFERENCE_WIDTH;

// 🎨 Polish (2026-09-16): Adam's call on the field surface, both variants live in styles.css behind
// [data-field-variant="A"|"B"] — flip this one constant to switch every page (team/side/matchup) at once.
// "A" = neutral charcoal field with the club's colour only as a soft edge vignette; "B" = one vertical
// wash of the club's primary colour, darkest at the top/bottom edges, lighter at the line of scrimmage.
export const FIELD_VARIANT = "A";

// D111 (Adam, 2026-09-16) — THE ONE SWITCH THE WHOLE RULING SITS BEHIND. `true` draws the secondary as ONE
// row (corners at the outer edges, the nickel inside the left corner, the safeties inside them, all on a
// single y), shortens the canvas that follows from the row count, and moves the legend line INTO the team
// banner / the matchup header's centre block. `false` restores exactly what shipped before it — the two-row
// secondary (safeties on their own row above the corners), the taller canvas AND the separate legend line
// under the banner. team.js and matchup.js import this same constant to decide where the legend goes, so
// the whole ruling is undone by editing this one word and nothing else has to be touched to undo it.
//
// WHY ONE ROW. The secondary was the only level drawing two row bands, so a both-sides canvas had to reserve
// FIVE defensive rows' worth of height (D107 computes the canvas from the row count alone, never from the
// club's own chart). Collapsing the level to one row band takes that count from five to four, which takes
// BOTH_SIDES_HALF from 535 units to 433 — and because the team and matchup field is scaled to fit its
// HEIGHT, a shorter canvas is a bigger scale on screen, which is what the ruling is buying. Nothing
// horizontal moves: the corners keep D71's 1.15 pitches outside the tackles, the nickel keeps its place
// between the left corner and the box, and the safeties keep the x mirrorDefXs has always given them
// (spread across the guards), so this is a vertical change only. Net of EDGE_CHROME below, the canvas goes
// from 1106 units to 946.
export const SECONDARY_ONE_ROW = true;

// ---- compact overview geometry (ruling E) -------------------------------------------------------
// A column is now a stack of text rows, not photo cards, so its width is set by how much room a real
// name plus a rating pill needs ("Quinyon Mitchell" + "88") rather than by a headshot diameter.
// D103 (Adam, 2026-09-16) — "the player cells are too small even on a super large screen; don't go crazy
// blowing them up." The whole-team and matchup card is 15% wider (156 -> 180) and the row type scale goes
// up with it (styles.css's `.column-compact` block, which is scoped so D72's side pages keep their own).
// WIDTH is free here: LAYOUT_WIDTH is fixed and the fit engine spreads the canvas sideways to fill the
// window, so a wider card is simply a bigger share of the same canvas — and two 180-wide cards plus
// MIN_CARD_GAP still come to 192, inside MIN_PITCH's 200, so every column keeps exactly the x D71/D76
// place it at and no pitch constant has to move.
// D106 (Adam, 2026-09-16) corrects the claim above: 192 inside 200 left only a ~20-unit gap between two
// neighbouring cards on the LINE/pass-catcher rows — not enough air, per Adam's report that the boxes read
// as "super close together." A pitch constant DID have to move after all: MIN_PITCH is now 224 (see below).
// HEIGHT is NOT free: this page's scale is height-bound (a real Washington canvas is ~1200 layout units
// tall against ~584 CSS pixels of room), so every unit added to a row is handed straight back as a
// smaller scale on screen. The heights below therefore grow only as far as the bigger type genuinely
// needs: ROW_H by two units, while CARD_H1 and BANNER_H do not move at all, because a line-one row was
// already carrying ~8 units of slack above its own content.
//
// D109 (Adam, 2026-09-16) — "the player display things are still really small even on my big screen; do
// something about it." The whole-team and matchup canvas is HEIGHT-bound: the fit engine scales it so its
// full height lands in the ~687 CSS pixels left under the page chrome, so every layout unit of canvas
// height is a direct tax on the size everything renders at. The canvas was 1376 units tall, of which 506
// were air — gaps between rows, the line-of-scrimmage gutter, the page margins, and slack reserved inside
// each row that its own content never used. Those 506 were measured against the real rendered rows (with
// every min-height dropped, on MIA/WAS/HOU and the WAS matchup) rather than estimated, and the heights
// below are now the measured content plus one or two units, not a guess:
//   line one   19 units of content (35 with a D44 banner)  -> CARD_H1 23  (+13 banner = 36)
//   slim row   17 units of content                         -> ROW_H   18
//   label pill 15 units plus its 2-unit margin             -> LABEL_RESERVE 17
//   row gap    styles.css's .column-stack gap              -> CARD_GAP 1 on the team/matchup family
// styles.css's `.column-compact` block carries the matching min-heights and stack gap, so the drawn row
// and the box reserved for it still cannot disagree (the same contract D103 set up).
// D110 (Adam, 2026-09-16): 180 -> 216, the whole of this ruling's size gain (see the LAYOUT_WIDTH note at
// the top of the file for why it is spent here rather than on the canvas width). On screen a column is
// CARD_W x box width / LAYOUT_WIDTH, so this is 194 px on a 1700x900 window and 230 px on Adam's 2000x980,
// against 162 and 191 before. HEIGHT is untouched: the row heights, the type scale in styles.css and the
// scale the fit engine applies all come off D109's 1106-unit canvas, so the text is exactly the size it was
// and the extra 36 units go into the one thing that was short — the room a name has before it abbreviates.
const CARD_W = 216;
const CARD_H1 = 23;  // the starter's bold row: 19 units of content, 23 reserved (36 with a banner over 35)
const ROW_H = 18;    // a slim backup row on the team/matchup pages: 17 units of content (D109)
const SIDE_ROW_H = 18; // D72's offense/defense pages keep the slim-row height they already have
// D109: the team/matchup family tightens its stack gap to 1 (styles.css `.column-compact .column-stack`),
// which is three units off every full column; the side pages keep the 2 the shared `.column-stack` draws,
// so the gap is a per-view option the way `rowH` already is rather than one number for both families.
const CARD_GAP = 1;
const SIDE_CARD_GAP = 2;
const BANNER_H = 13; // extra strip on a line-one row carrying the red OUT / green FILLING IN banner
// D104 (Adam, 2026-09-16): a starter who is out, once somebody active is filling in for him, renders as a
// compact row at the BOTTOM of his column rather than on line one — still wearing his red OUT rail, so
// "big injury here" still reads at a glance. The rail is a strip stacked above that row's own text, so the
// box has to reserve height for it; a shade more than BANNER_H because a slim depth row, unlike a line-one
// row, has no spare slack of its own to lend it.
const OUT_RAIL_H = 15;
// The column's own label pill, which lives inside the reserved box. D109 measured it rather than deriving
// it from the type: the rendered pill is 15 units tall and carries a 2-unit margin under it, on the team,
// matchup AND side pages alike, so 17 is the exact box it needs and the 18th unit was slack.
const LABEL_RESERVE = 17;
export const MAX_DEPTH_ROWS = 3; // ruling E: at most three depth rows, the third becoming "+N more"
// D72: the single-unit (offense / defense) pages draw half as many rows, so the fit engine scales them to
// roughly 1.3-1.8x. At that size a line-one row has room for a small headshot at its left edge — the SAME
// row renderer as everywhere else, widened by an option (cards.js's overviewLineOne), never a second card
// type. HEADSHOT_PAD is the vertical air above and below it, so the row grows from CARD_H1 to 34.
const HEADSHOT_SIZE = 28;
const HEADSHOT_PAD = 6;
export const SIDE_MAX_DEPTH_ROWS = 4; // D72: one more depth row than the whole-team overview's cap
// D72: a headshot eats ~28 of a 156-unit row, and it eats it out of the one thing worth reading — the
// name. ("Riq Woolen" came out as "R. Wo…" on the first defense render.) A single-unit page has half the
// columns, so it can afford a wider one, and 180 was the widest that cost nothing: two 180-wide cards plus
// MIN_CARD_GAP still fit inside MIN_PITCH, so the columns kept exactly the pitch D71 places them at.
//
// D94 (👁 finding, 2026-09-15) — two WAS starters still ellipsised on the headshot row even with the D91
// snap trio moved off the name's line: "C. Okonkwo" (badge competing for the same ~134-unit text block)
// and "J. Croskey-Merritt", a longer surname than the 180-wide card was ever budgeted for. Widened by 30
// (180 -> 210), the smallest step that clears both on WAS off/def and the widest (four-WR-plus-TE) HOU
// pass-catcher row. This does cross the 188 ceiling the comment above used to cite (cardWidth + MIN_CARD_GAP
// > MIN_PITCH), so the offensive LINE row's own enforceNoOverlap pass now widens that row's five columns
// from MIN_PITCH's 200 to 222 to keep them from touching — the one on-canvas consequence, verified by render
// to still leave every row inside 1700x900 with no overlap. MIN_PITCH itself is untouched (it is shared with
// the team/matchup/group pages, which must not move), so nothing outside this single-unit side page changes.
export const SIDE_CARD_W = 210;

// D109: halved. These four are the canvas's pure air — 266 of the 1376 units the canvas used to stand at,
// which on a height-bound field is 266 units of card size handed back for nothing. A both-sides half still
// opens BAND_GAP between two rows of one level and BAND_GAP + LEVEL_GAP_EXTRA at a level boundary, so the
// levels still read as levels; on top of that every real club's rows are spread evenly across the half
// (placeSpan's extra gap), which is where the visible separation between rows actually comes from.
const BAND_GAP = 5; // vertical gap between adjacent rows inside one level
const LEVEL_GAP_EXTRA = 10; // on top of BAND_GAP, only between two rows in DIFFERENT levels
// D111: the top strip of the canvas used to be empty turf, because the nearest thing to it was the SAFETIES
// row and safeties stand over the guards, in the middle of the field. With the secondary on one row the
// TOP defensive row is the one carrying the two corners, whose cards sit 30 units off each sideline — and
// the two pieces of chrome the canvas prints up there both live exactly where those cards now are: the
// "SECONDARY" level label at the left edge (summarizeLevels lifts a crowded level's label into the gap
// ABOVE its first row, and with no gap there it was lifted clean off the canvas — it simply stopped being
// drawn) and renderFieldSvg's "DEFENSE" caption at the right edge (drawn under the cards, so the right
// corner's card covered all but its last letter; both were caught on the first LV render). So the canvas
// now opens a strip above its first row big enough for a 12.5px level label plus its lift and for the
// caption, and — because D96 puts the line of scrimmage on the canvas midpoint, which holds only while the
// two margins are equal — the same strip below the last offensive row, where the "OFFENSE" caption sits.
// 22 units, not LABEL_LIFT's 27: the label lands at row.top - LABEL_LIFT = 3 and is ~14 units tall, so 22
// clears it with air to spare, and every unit here is a unit of the size the ruling is buying back.
// Zero when the switch is off, so the two-row secondary draws on exactly the margins it always had.
const EDGE_CHROME = SECONDARY_ONE_ROW ? 22 : 0;
const MARGIN_TOP = 8 + EDGE_CHROME;
const MARGIN_BOTTOM = 8 + EDGE_CHROME;
const LOS_HALF_GAP = 10; // half the empty gutter straddling the line of scrimmage, same both sides
// D106 (Adam, 2026-09-16) — "the boxes on the team page are super close together." D103 widened the card
// from 156 to 180 but left this pitch at 200, so the clear turf between two neighbouring 180-wide columns
// on the LINE and pass-catcher rows fell from ~44 units to ~20 (enforceNoOverlap's minDist was
// max(180+12, 200) = 200, i.e. a 20-unit gap). Raised to 224 so that same pair is back to a ~44-unit gap
// (224 - 180 = 44), restoring the air D103 ate. LAYOUT_WIDTH does not grow (D58): the widest rows this
// pitch drives — five linemen, the five-wide Houston pass-catcher cluster, the corners 1.4 pitches outside
// the tackles — all still land inside the fixed canvas (checked by the D103 geometry test and by render).
// Review requirement B: never let two columns sit closer than this. Also the lever that decides how much
// of the canvas the chart actually covers — ruling E scales the whole canvas to fit the window's HEIGHT,
// so if the columns only spanned the middle of the canvas the page would waste the spare width. At 224
// the widest row (corners, 1.4 pitches outside the tackles) still reaches close to both sidelines, so the
// field keeps filling a 1700px window edge to edge instead of leaving a dead strip down one side.
//
// D110 (Adam, 2026-09-16) — 224 -> 242, and the clear turf between two neighbouring cards goes from 44
// units to 26 with it, which is this ruling relaxing D106's 44 on purpose ("the D106 44-unit gap is
// relaxed by this ruling"). The two numbers are the same trade seen from both ends: on a canvas whose
// width the fit engine has already stretched as far as it can (see LAYOUT_WIDTH), every unit a card gains
// is a unit of turf its neighbour loses. 26 units is not the drop it looks like — measured on screen it is
// ~23 px of air at 1700x900, against the ~18 px that D106 was raised to fix and the ~24 px the ruling's own
// numbers (a 180-wide card at a 202 pitch on a 1475 canvas) would have produced.
// The pitch has to CLEAR the card rather than merely being a floor under it: 216 + MIN_CARD_GAP is 242, so
// this constant and enforceNoOverlap's own minimum are now the same number by construction and no row is
// ever re-pitched after its placement function has chosen its x's (which is what D71's landmarks depend on).
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

// Adam (2026-09-11): "the where of where they play isn't that important, except that there should be
// levels of guys visually: DL on the line, LBs next, then DBs". Each row is tagged with the LEVEL it
// belongs to so computeLayout can (a) open a bigger gap at a level boundary than between rows inside
// one level and (b) hand back one label per level for the field to print at the left edge.
// Ruling A: the LINE row is the DL band, which now includes every defensive end.
// The two row models, written out in full rather than patched, so that reading either one tells you the
// whole defensive layout it produces. `order` is nearest-the-LOS first; `bands` says which compiled bands
// each row draws; `level` groups consecutive rows into the levels the stripes and labels are printed from.
const DEF_ROWS_ONE_ROW_SECONDARY = {
  order: ["LINE", "EDGE", "LB", "SECONDARY"],
  bands: { LINE: ["DL"], EDGE: ["EDGE"], LB: ["LB"], SECONDARY: ["CB", "NB", "S"] },
  level: { LINE: "LINE", EDGE: "EDGE", LB: "LB", SECONDARY: "SEC" },
};
const DEF_ROWS_TWO_ROW_SECONDARY = {
  order: ["LINE", "EDGE", "LB", "CB_NB", "S"],
  bands: { LINE: ["DL"], EDGE: ["EDGE"], LB: ["LB"], CB_NB: ["CB", "NB"], S: ["S"] },
  level: { LINE: "LINE", EDGE: "EDGE", LB: "LB", CB_NB: "SEC", S: "SEC" },
};
const DEF_ROWS = SECONDARY_ONE_ROW ? DEF_ROWS_ONE_ROW_SECONDARY : DEF_ROWS_TWO_ROW_SECONDARY;
const DEF_ROW_ORDER = DEF_ROWS.order; // nearest LOS -> farthest
const DEF_ROW_BANDS = DEF_ROWS.bands;
const DEF_ROW_LEVEL = DEF_ROWS.level;
const DEF_LEVEL_LABEL = { LINE: "LINE", EDGE: "EDGE", LB: "LINEBACKERS", SEC: "SECONDARY" };

// D107 (Adam, 2026-09-16) — "the JAX team display is still different than other teams." ONE FIELD SCALE FOR
// EVERY CLUB, on the team page and the matchup page alike.
//
// Until now a both-sides canvas was exactly as tall as the club's own chart needed (D96: the taller half's
// natural height, doubled). Ten clubs (ARI, CHI, CIN, CLE, HOU, IND, JAX, KC, SF, TEN) put all four of
// their linemen on the LINE row, so their compiled chart has NO EDGE row and their defence is four rows
// rather than five; other clubs differ again through banners, "+N more" tails and "not on chart" trays.
// Measured across the 32 charts the canvas ran from 874 units (ARI) to 1280 (MIA) — and the fit engine
// scales the canvas to the window, so a shorter canvas came out MAGNIFIED: Jacksonville's cards were
// visibly bigger than Las Vegas's for no reason a reader could see.
//
// So the both-sides canvas is now a CONSTANT, computed from the row constants alone and never from the
// club's own rows. BOTH_SIDES_HALF is the tallest defence this engine can draw at its natural pitch: EVERY
// row of DEF_ROW_ORDER (five before D111, four after it collapsed the secondary to one row), each as tall
// as a FULL column (its label pill, one bold starter row and the maximum number of slim depth rows), spaced
// at the minimum pitch — BAND_GAP between two rows of one level, plus LEVEL_GAP_EXTRA at each of the three
// level boundaries the defensive order contains (three either way: LINE, EDGE, LB and SEC are four levels
// whether the secondary draws on one row or two, which is why only the ROW count moves). Per D96
// the offence gets a half of exactly the same height, and the line of scrimmage sits on the boundary
// between them, which is the canvas midpoint. Every club therefore draws on the same canvas, so the fit
// engine hands every club the same scale, the same card size and the same half boundaries.
//
// A club whose half is SHORTER than the constant (every real club: the tallest measured half is Miami's
// defence at 607 against the constant's 655, and the tallest offence is San Francisco's at 427) spreads
// its rows evenly across the half with placeSpan's extra gap — which is exactly what D96 already did to
// the shorter of the two sides, now applied to both.
//
// THE DEEP-COLUMN QUESTION, stated as D107 asks. A row is as tall as the deepest column in it, and the
// deepest a column can be is its label plus a line-one row plus MAX_DEPTH_ROWS slim rows — which is
// precisely what DEF_ROW_FULL_H is, so a "+N more" tail costs nothing extra (the tail REPLACES the last
// slim row rather than adding one). Two things can still push a single row past it: the OUT rail D104
// stacks on a demoted starter's row, and a "not on chart" tray. Those are a per-row surcharge the
// constant does not attempt to predict, so the rule is kept honest by a floor rather than by arithmetic:
// the half is max(BOTH_SIDES_HALF, this club's own natural halves). No club in the league reaches it
// today (the 48 units of headroom above Miami cover several rails), and if one ever did it would grow its
// own canvas instead of drawing its rows through each other.
const DEF_ROW_FULL_H = LABEL_RESERVE + CARD_H1 + MAX_DEPTH_ROWS * (ROW_H + CARD_GAP);
// D109 leaves this derivation exactly as D107 wrote it — the constant is still the tallest defence this
// engine CAN draw, so no club's chart can push its own canvas past it — and moves the number by moving the
// row constants underneath it: 111 units per full row became 97, and the per-half gaps 100 became 50, so
// BOTH_SIDES_HALF falls from 655 to 535 and the canvas from 1376 to 1106.
// D111 leaves it alone again and moves the number the same way, by moving what it is derived FROM: with the
// secondary on one row DEF_ROW_ORDER.length is 4 rather than 5, so the half is 4*97 + 3*BAND_GAP +
// 3*LEVEL_GAP_EXTRA = 433, and the canvas — the half twice over plus the LOS gutter and the two margins,
// which D111 widens by EDGE_CHROME — is 946. The constants stay DERIVED — nobody may type 433 or 946 here
// — so a future ruling that adds or removes a defensive row moves the canvas with it automatically.
const DEF_LEVEL_BOUNDARIES = DEF_ROW_ORDER.reduce(
  (n, key, i) => (i && DEF_ROW_LEVEL[key] !== DEF_ROW_LEVEL[DEF_ROW_ORDER[i - 1]] ? n + 1 : n), 0);
export const BOTH_SIDES_HALF = DEF_ROW_ORDER.length * DEF_ROW_FULL_H
  + (DEF_ROW_ORDER.length - 1) * BAND_GAP
  + DEF_LEVEL_BOUNDARIES * LEVEL_GAP_EXTRA;
export const BOTH_SIDES_HEIGHT = MARGIN_TOP + BOTH_SIDES_HALF + 2 * LOS_HALF_GAP + BOTH_SIDES_HALF + MARGIN_BOTTOM;

// D108 (Adam, 2026-09-16) — "the offense and defense pages need to breathe at the top and the bottom." On a
// single-unit side page the first row sat on MARGIN_TOP and the last row on MARGIN_BOTTOM, i.e. hard against
// the turf's own edges, while the fill pass poured all the spare height into the gaps BETWEEN the rows. The
// content therefore read as pinned to the frame. One row pitch — the engine's own smallest unit of vertical
// air, the BAND_GAP + LEVEL_GAP_EXTRA it opens at a level boundary — is now inset above the first row and
// below the last, and the rows spread evenly inside what is left, so the block sits toward the middle of the
// screen. Deliberately one pitch and no more (Adam: "pushed in a LITTLE BIT, not a ton"); the fill mode, the
// card sizes and every x are untouched.
// D109 halved BAND_GAP/LEVEL_GAP_EXTRA to buy the whole-team and matchup pages their height back. The side
// pages are not height-bound (they crop to one unit and fill, so their rows are spread by the fill pass
// anyway) and D108 is a settled ruling about how they look, so the inset keeps the 30 units it was shipped
// at rather than tracking a pitch that moved for a different page's sake.
const SIDE_INSET = 30;

// D69: THREE offensive rows now, listed here nearest-the-LOS first. This IS the one constant Adam asked to
// be able to flip — reorder these entries and the whole offensive half reorders with them (levels,
// stripes, labels and gaps all fall out of it). PASS CATCHERS (WR+TE) sits above LINE (OL alone) — not
// real formation depth, a deliberate visual choice (D69) — so it prints its own full-width stripe and
// label instead of sharing LINE's.
const OFF_ROW_GROUPS = [
  { key: "PASS_CATCHERS", bands: ["WR", "TE"] }, // outside WR, slot WR, TE(s), outside WR
  { key: "LINE", bands: ["OL"] },                // LT LG C RG RT
  { key: "BACKFIELD", bands: ["QB", "BACKFIELD"] }, // QB centred on the centre, RB/FB flanking him
];
const OFF_ROW_LEVEL = { PASS_CATCHERS: "PASS_CATCHERS", LINE: "LINE", BACKFIELD: "BACKFIELD" };
const OFF_LEVEL_LABEL = { PASS_CATCHERS: "PASS CATCHERS", LINE: "LINE", BACKFIELD: "BACKFIELD" };

// D71: the corners keep the placement they have always had — 1.4 pitches outside the tackles — and they
// keep it whatever the receivers do, because the receivers are now a centred cluster that would drag the
// secondary into the middle of the field if the corners still mirrored it.
// D110 (Adam, 2026-09-16) — 1.4 -> 1.15, which the ruling asks for in as many words ("corners about 1.2
// pitches outside the tackles"). The corners are the widest thing on the field and therefore the row that
// decides whether a 216-wide card fits at all: at the new 242 pitch the corner sits 278 units outside the
// tackle, so its card's outer edge lands 30 units inside the sideline — roughly where a 180-wide card at
// 1.4 x 224 used to land, i.e. the secondary still reaches both sidelines and the field still fills the
// window. Leaving it at 1.4 would have pushed that edge 40 units OFF the canvas.
// The knock-on to name below: a corner only 1.15 pitches out leaves less room between him and the box, so
// the nickel's own floor (a full pitch inside the corner) now places him ~36 units outside the left tackle
// rather than ~90. He still reads as "inside the corner, outside the box", which is what D71 asked for, but
// he sits noticeably closer to the tackle than he did.
const CB_PITCH_OUT = 1.15;
// D112 (Adam, 2026-09-16, team view): "the OLBs / edges are way too far to the outside of the screen"
// (Eagles, Broncos, among others). The EDGE row used to sit on the same 1.0-pitch-out landmark as CB_PITCH_OUT's
// near neighbour (lm.OUTSIDE_L/R), which reads fine for a corner but drags an edge rusher out past where a real
// defensive end lines up. D112 first moved it to 0.6 pitches outside the tackle.
// D116 (Adam, 2026-09-16): "the EDGE and/or OLBs are still too far outside, tighten them up... I don't want to
// look the whole way across the screen to see the OLB/EDGE counterpart." 0.6 was still reading as "out past the
// corner's own gravity" on a 1700px screen — the EDGE pair sat ~1170 units apart. 0.2 pitches outside the tackle
// puts the column over the tackle itself, where a real edge defender's hand is actually in the dirt; the widest
// real EDGE row in data/cache/compiled (a 3-4's three edge columns, e.g. BAL/NYG/PIT/SEA) still clears
// MIN_CARD_GAP to its nearest neighbour at this value (see the D112 test below), so there was no floor stopping
// it from coming in this far.
const EDGE_PITCH_OUT = 0.2;
// D116: the LB band's two inside linebackers used to sit ON the guards (1.0 pitch off centre, same distance as
// the safeties), which put them at or past where the new, tighter EDGE columns land and defeated the point of
// tightening EDGE_PITCH_OUT — there was nothing between an EDGE man and his neighbouring ILB. Pulling the ILBs
// in to 0.85 pitches off centre (just inside the guards) keeps an EDGE column clearly outside its neighbouring
// ILB with a visible margin, and still clears MIN_CARD_GAP between the two ILB columns themselves (see the
// D116 test below).
const ILB_PITCH_FROM_CENTER = 0.85;
// D71: "the nickel sits between the corner and the box." Nominally one pitch outside the left tackle,
// which is what Adam described; the floor below it is arithmetic, not taste — two columns closer than
// MIN_PITCH overlap, and the corner is already at 1.4 pitches, so a literal one-pitch nickel would be
// drawn through him and then shoved clear by enforceNoOverlap anyway. Taking the max here puts him at the
// same place deliberately instead of by accident, and still reads as "inside the corner, outside the box".
const NB_PITCH_OUT = 1;
// D119 (Adam, 2026-09-16, the DEFENSE side page alone): "offense looks better than defense — defense is
// too spread out and the CBs are too far to the outside of the page." On the team and matchup pages the
// corners MUST reach both sidelines (D71/D110), because the offence is on the same canvas; a defence drawn
// on its own has no such duty, so its front and secondary are pitched off the CENTRE instead of off the
// tackles. The outermost column then sits 2.5 pitches out (~1210 units across) against the offense page's
// ~1162, so the two pages read as the same size chart. Only a defence-with-no-offence layout reads these.
const SIDE_DEF_CB_PITCH_FROM_CENTER = 2.5;
const SIDE_DEF_NB_PITCH_FROM_CENTER = 1.5;  // one pitch inside the left corner, one outside the left safety
const SIDE_DEF_S_PITCH_FROM_CENTER = 0.5;   // two safeties exactly MIN_PITCH apart, straddling the centre
const SIDE_DEF_EDGE_PITCH_FROM_CENTER = 1.9; // was the tackles ∓ EDGE_PITCH_OUT, i.e. 2.2 pitches off centre
// Vertical air between two columns stacked on the same x (TE2 under TE1).
const STACK_GAP = 8;
// D72: the margin left on each side of a cropped single-unit canvas, so the outermost column is not flush
// against the sideline the field SVG draws.
const CROP_MARGIN = 26;
// D72: the most spare height one gap between two rows may absorb on a single-unit page. Enough to turn a
// four-row defense on a 1700x900 screen into a full page; beyond it the rows would start reading as
// unrelated islands rather than as levels of one chart.
const MAX_EXTRA_GAP = 220; // D75: a three-row offense page spreads its rows to fill the height rather than zooming
// D76: receivers/TE cluster pitch as a multiple of MIN_PITCH. D110 (Adam, 2026-09-16) takes it 1.3 -> 1.2,
// which on the bigger MIN_PITCH leaves the widest real cluster (five places — Cleveland's WR·Slot, WR1, WR2,
// WR3 and a tight end, and Houston's five with its second tight end stacked on one x) almost exactly the
// absolute width it has today, so the row still spreads across the turf rather than huddling on the centre,
// while a hypothetical sixth place now fits inside the canvas with 66 units to spare instead of hanging off
// the sideline. The clear air between two neighbouring receivers is 74 units, nearly three times the line's.
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
// duplicated by a flank point that already landed exactly on the midpoint (👁 review, 2026-09-11).
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
// 🔵 review: this is now THE list for the whole front end (cards.js re-exports it, zoom.js and
// matchup.js import it from there) and it matches server/compile/status.js's willNotPlay exactly. Four
// separate copies had drifted, and all four were missing INACTIVE and EXEMPT — so a game-day inactive or
// a commissioner-exempt starter got no red banner anywhere in the UI, and field.js reserved no height
// for the one it did not draw.
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
  // D103: `headshot` is what tells the two row families apart — a headshot on line one is D72's own signal
  // that this is a single-unit side page — so the slim-row height keyed off it here is the same
  // discriminator styles.css uses for the type scale (`.column-compact`, which cards.js puts on every
  // column that is NOT drawing headshots). One question asked once, so the reserved box and the rendered
  // row cannot disagree about which family they are in.
  const side = !!opts.headshot;
  return {
    headshot: side ? HEADSHOT_SIZE : 0,
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
  const base = style.headshot ? Math.max(CARD_H1, style.headshot + HEADSHOT_PAD) : CARD_H1;
  return base + (isFullyOut(p) || p.role === "ACTIVE" ? BANNER_H : 0);
}

// D104 (Adam, 2026-09-16) — "put the red OUT cell and that hurt/suspended player at the bottom of the
// position; that way it still visually shows me 'big injury here' even if the hurt guy is at the bottom."
// How many of the players standing at the TOP of a slot are fully-out starters who have somebody active
// filling in behind them — that run is the block that moves to the bottom of the column. Zero (and no
// reordering at all) when the slot opens with a healthy man, or when the out man has nobody active behind
// him: with no replacement to promote, he stays on line one exactly as before, because he IS still the
// only answer the column has to "who plays here".
// Co-starters who are BOTH out are one such run of two and move together, keeping their order (Adam:
// "multiple OUT men: all at the bottom in their current relative order").
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
  // The demotion is decided before the co-starter question, not after it: a pair of co-starters who are
  // both out with a fill-in behind them is precisely the case Adam named, so the pair goes to the bottom
  // and the fill-in leads. A pair with no fill-in behind it is untouched and still reads as two bold rows.
  if (outFillInDemotion(players)) return 1;
  return players.length >= 2 && players[0].coStarter && players[1].coStarter ? 2 : 1;
}

// Ruling E: at most MAX_DEPTH_ROWS slim rows are drawn behind the line-one row(s). When more players
// exist than that, the LAST visible slim row is replaced by a "+N more" tail, so the row count (and
// therefore the reserved height) never exceeds the cap however deep a real chart runs.
export function visibleDepthRows(players, maxRows = MAX_DEPTH_ROWS) {
  return Math.min(Math.max(players.length - lineOneCount(players), 0), maxRows);
}

// D104: how many of the demoted OUT rows are actually DRAWN, which is what the reserved box has to pay the
// OUT_RAIL_H for. The "+N more" tail spends one of the visible places whenever anything is hidden, so the
// out rows can only fill what is left of the cap. This is the same arithmetic cards.js's renderColumn does
// when it decides how many places keepOutRowsVisible may fill — the two are kept in step deliberately, the
// way lineOneCount/visibleDepthRows already are, so the box and the markup cannot drift apart.
export function shownOutRows(players, style = {}) {
  const demoted = outFillInDemotion(players);
  if (!demoted) return 0;
  const visible = visibleDepthRows(players, style.maxDepthRows);
  const depthCount = Math.max(players.length - lineOneCount(players), 0);
  const places = depthCount > visible ? Math.max(visible - 1, 0) : visible;
  return Math.min(demoted, places);
}

// A slot's real rendered content height: the column's own label pill (which lives inside this box —
// 🎨 Polish round 3 item 3: leaving it out made the deepest column in a row overflow the shared bottom
// edge), plus each bold line-one row, plus the visible slim rows.
function slotContentHeight(slot, style) {
  const players = slot.players;
  if (!players.length) return CARD_H1 + LABEL_RESERVE;
  const ordered = displayOrder(players); // D104: measure the rows in the order they will be drawn
  const bold = lineOneCount(players);
  const rowH = style.rowH ?? ROW_H;
  const cardGap = style.cardGap ?? CARD_GAP;
  let h = LABEL_RESERVE;
  for (let i = 0; i < bold; i++) h += lineOneHeight(ordered[i], style) + (i ? cardGap : 0);
  const visible = visibleDepthRows(players, style.maxDepthRows);
  // D104: the demoted OUT rows are slim rows that also carry a red rail, so they each cost OUT_RAIL_H more
  // than the healthy rows beside them. They are never the rows that collapse behind "+N more" (that is the
  // whole point of moving them), so the count is known here without knowing which players they are.
  const outRows = shownOutRows(players, style);
  h += visible * (rowH + cardGap) + outRows * OUT_RAIL_H;
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

// WR · SLOT IS A REAL COLUMN OF SLOT RECEIVERS — D83 (Adam, 2026-09-15): "if he shows under WR · Slot,
// don't show him again under WR1 or WR2." Until now the slot was a club column wearing a different pill
// (D63/D64), so the man standing inside was also still the club's WR2 two boxes away. He is now lifted
// out: every charted receiver who really plays inside moves into one synthetic column and is removed from
// the club column he came from. Nobody over the bar is left behind and nobody
// is drawn twice. A team with nobody over the bar has no Slot column at all and keeps WR1/WR2/WR3 exactly
// as the club prints them — no archetype and no "last receiver" guesses, which is what D64 already ruled
// out.
//
// D86 (Adam, 2026-09-15) replaces the membership and ordering rules D85 had put in D83's place. A charted
// wide receiver moves into the column only when the slot is his MAIN alignment: at least
// SLOT_COLUMN_MIN_RATE percent of his own snaps taken inside (D64/D77 — PlayerProfiler). There is no
// volume or share test any more. D85 decided membership by each man's share of the TEAM's inside snaps,
// which pulled plainly outside receivers into the slot on nothing but their workload — Justin Jefferson
// lines up inside on 17% of his snaps and still takes the biggest share of his team's slot work — and,
// ordering purely by snaps, could seat a club's number-one receiver underneath a lesser man.
//
// D89 (Adam, 2026-09-15) had AMENDED D86's membership rule with a floor: a rate only counted once it had
// been measured over at least 100 inside snaps, else the man stayed in his club column whatever his rate
// said — thin samples like LaJohntay Wester's 24 Baltimore snaps at 53.3%, Tom Kennedy's 26 in Detroit and
// Jimmy Horn Jr.'s 75 in Carolina each invented a column, and in Baltimore's case hid Zay Flowers's own WR1
// pill behind a fourth-stringer. D117 (Adam, 2026-09-16) RETIRES D89: "if they line up frequently in the
// slot, they're a slot guy, who cares how often they are out there." Membership is the rate alone again
// (D86, SLOT_COLUMN_MIN_RATE) — a rate with no snap count at all is now admitted on the rate, same as a
// well-measured one; a thin sample is still evidence of where the man actually lines up, and D117 trusts it.
//
// D118 (Adam, 2026-09-16) LOWERS D86's bar from 50 to 40 percent (SLOT_COLUMN_MIN_RATE): of 175 receivers
// with 100+ offensive snaps in 2025, 42 (24%) were at 40 or more versus 26 (15%) at 50 or more, so the old
// bar was screening out real slot men. D90's ordering and D93's whole-column move are unchanged; D117's
// retirement of D89's snap floor stands.
//
// Ordering is the club's own chart, read tier first — D90 (Adam, 2026-09-15), amending D86's ordering: the
// tier a man is listed on inside his column (tier 0, a listed-OUT starter, then tier 1, then tier 2 and so
// on, a card with no tier at all last), then the rank of the column he came from (the ordinal position in
// wrSlots — the first receiver column is rank 1), then slot snaps, most first, then the row the club
// printed him on. D86 read the column before the tier, which put a BACKUP above a STARTER whenever the
// backup happened to be listed in an earlier column: in Tennessee, Chimere Dike (the WR1 column's tier-2
// man) stood above Wan'Dale Robinson (the WR2 column's tier-1 starter). Adam's principle is about the
// depth of the chart, not the left-to-right order of its boxes, so tier now leads and a backup is never
// shown above a starter; club rank still settles two men on the same tier, which is what keeps a club's
// number-one receiver above an equally-listed team-mate.
//
// D93 (Adam, 2026-09-15) AMENDS what MOVES, leaving the bar itself exactly as D86/D89 set it. Until now every
// qualifying man moved on his own and his backups stayed behind, which repeatedly left a club column holding
// nothing but a fourth-stringer (Green Bay's second column was Skyy Moore alone). A club that charts its slot
// receiver as the starter of a column has simply told us that column IS the slot: so when a column's own
// starter qualifies, the WHOLE column becomes the WR · Slot column — same players, same order, his backups
// stacked under him as the club listed them — and vanishes from the club columns. Backups elsewhere still move
// as individuals and join BELOW that group in D90's order. See pass three below for the two-starters case.
//
// Every man is judged on the SAME window: the pooled 2025+2026 rate (slotRatePooled) when his card carries
// one, otherwise the headline slotRate. The headline rate alone must not decide it — D77 switches a man to
// his current season alone the week his own snaps pass SLOT_SAMPLE_MIN, so team-mates carry different
// windows and a thin early-season sample could drop a season-long slot man out of his own column mid-year.
//
// This is a DISPLAY regrouping and nothing more: the compiled TeamView is the club's own chart and stays
// untouched, which is why every slot object is shallow-cloned before its player list is trimmed. The
// player cards themselves are carried across by reference, so the man in the Slot column is the very same
// card object the club column held — his role, banner, badges and heat ride along unchanged.
// A card's measured slot snaps over the pooled 2025+2026 window, or null when PlayerProfiler has no number
// for him. slotSnapsPooled is the window every man is read on; the headline slotSnaps is the fallback only
// for a card that carries no pooled count at all (an older compiled file, or a season whose total snaps
// could not be worked out so it never joined the pool). This count ORDERS the column (D90) and fills the
// tooltip's bracket; it no longer gates membership — D117 retired D89's floor, so a rate with no snap count
// at all is admitted on the rate alone, same as a well-measured one, and simply sorts last, unchanged from
// D90's null-snaps-sort-last rule.
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
// at. Exported for the tests — nothing else calls it.
export function regroupSlotReceivers(wrSlots) {
  // Pass one: every charted receiver PlayerProfiler has measured, deduped, each carrying where the club
  // lists him — the rank of the column he came from and his tier inside it — because D86 orders the
  // finished column by the club's own chart before it looks at any workload (D90: tier before column). wrSlots arrives in the club's
  // column order, so the array position IS the rank: the first receiver column is rank 1.
  const charted = [];
  const seen = new Set();
  wrSlots.forEach((s, rank) => {
    (s.players || []).forEach((p, row) => {
      // Belt and braces against a chart that lists one man in two receiver columns (dedupSlots already
      // resolves that on the server): one card object, and one playerKey, count once. The first listing
      // wins, which is the higher of the two club columns.
      if (seen.has(p) || (p.playerKey != null && seen.has(p.playerKey))) return;
      const rate = rateOf(p);
      if (rate == null) return;
      seen.add(p);
      if (p.playerKey != null) seen.add(p.playerKey);
      charted.push({ p, rate, rank, row, tier: tierOf(p), snaps: slotSnapsOf(p) });
    });
  });

  // Pass two: the men who play at least SLOT_COLUMN_MIN_RATE of their own snaps inside — no minimum snap
  // count any more (D117 retired D89's 100-snap floor; a rate with no snap count at all is admitted on the
  // rate alone). Ordered tier first so a backup never sits above a starter (D90), then the rank of the club
  // column he came from, then slot snaps with the bigger workload first (null snaps sort last), and the
  // club's own printed order settles anything still tied.
  const qualified = charted
    .filter((c) => c.rate >= SLOT_COLUMN_MIN_RATE)
    .sort((a, b) => a.tier - b.tier || a.rank - b.rank || (b.snaps ?? -1) - (a.snaps ?? -1) || a.row - b.row)
    .map((c) => c.p);
  if (!qualified.length) return null;
  const qualSet = new Set(qualified);
  const qualKeys = new Set(qualified.map((p) => p.playerKey).filter((k) => k != null));
  const isQualified = (p) => !!p && (qualSet.has(p) || (p.playerKey != null && qualKeys.has(p.playerKey)));

  // Pass three — D93 (Adam, 2026-09-15), which amends D86/D92. Up to here a qualifying man moved as an
  // INDIVIDUAL and left his backups behind, which is how Green Bay ended up with a column holding nobody but
  // Skyy Moore. Adam's ruling: when a club column's own STARTER plays inside, the club has simply charted its
  // slot receiver in that column, so the WHOLE column becomes the WR · Slot column — same players, same
  // order, his backups stacked under him exactly as the club listed them — and it disappears from the club
  // columns. Which man counts as the starter is columnDecider's business (a listed-OUT starter is decided by
  // his ACTIVE fill-in, and then moves with the column).
  //
  // If TWO starters qualify (rare), only one column can be the Slot column: the higher ESPN-ranked one wins
  // — i.e. the lower columnOrder, because the server has already ordered the receiver columns by ESPN's rank
  // of the man leading each (D92) — and the other starter moves as an individual below it, HIS backups
  // staying in his own club column. That leftover is therefore the one case that can still leave a club
  // column holding nothing but backups, which is why D92's "backup-led columns sort last" clause below is
  // still live rather than dead code.
  //
  // Where that second starter lands inside the column is D90's binding principle, not the order the two
  // groups happen to arrive in: a BACKUP never sits above a STARTER in any column. So the men who join the
  // source column's group are split — qualifying starters go directly under the source column's LINE ONE
  // block, ahead of the backups that column carried in, and qualifying backups go under all of them in D90's
  // order. Buffalo therefore reads Shakir, Robinson, Atwell: the two starters together, the carried backup
  // beneath them, rather than Robinson being stacked under another column's reserve.
  //
  // Accepted edge, low priority (Adam has not ruled on it and no real club hits it today): when the column
  // that LOSES the two-starters tie is a [STARTER_OUT, ACTIVE] pair and only the ACTIVE fill-in qualifies,
  // he moves into the Slot column alone and the out man is left leading his old column — whose `injury`
  // block still names that fill-in as the man covering for him, now drawn one column over.
  const starterColumns = wrSlots.filter((s) => starterLed(s) && isQualified(columnDecider(s)));
  const source = starterColumns.length
    ? starterColumns.reduce((a, b) => ((a.columnOrder ?? 0) <= (b.columnOrder ?? 0) ? a : b))
    : null;
  const group = source ? (source.players || []).slice() : [];
  const inGroup = new Set(group);
  const groupKeys = new Set(group.map((p) => p.playerKey).filter((k) => k != null));
  // Men who qualify on their own, from every OTHER column, join the starter-led group in D90's order (tier,
  // then the club column's rank, then slot snaps, then the printed row) — unchanged from D86 except for
  // where they land relative to the backups the source column carried in, above.
  const individuals = qualified.filter((p) => !inGroup.has(p) && !(p.playerKey != null && groupKeys.has(p.playerKey)));
  // A starter is a man his club lists on line one or two of a column (tier 0 or 1) or whom the server itself
  // marks as leading one (D12/D44's listed-OUT starter and his ACTIVE fill-in, and a co-starter) — the same
  // test starterLed applies to a whole column.
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
  // D92 (Adam, 2026-09-15): the server orders the receiver columns by ESPN's rank of the man LEADING each of
  // them, but lifting the slot men out can leave a column with nobody but backups in it. Under D93 that is no
  // longer the everyday case — a qualifying starter takes his backups with him — but it survives for the
  // two-starters-qualify shape above (the losing starter leaves his backups behind) and for a chart whose
  // column was never starter-led to begin with. A column of backups is not a number-two receiver and must not
  // be drawn ahead of a starter's column, so every column still led by a starter comes first and the
  // backup-led ones follow, each group keeping the order the server gave it. Roles are the server's own
  // (D12/D44): a co-starter, a listed-OUT starter and his ACTIVE fill-in all lead a starter's column.
  kept.sort((a, b) => (starterLed(a) ? 0 : 1) - (starterLed(b) ? 0 : 1));

  // D93: the derived column stands where the source club column stood, so it has to carry that column's own
  // dressing with it — `injury` is what cards.js reads for the heat underline and glow, `rankSource`/
  // `espnRank` and `clubLabel` are what columnRankReason quotes in the tooltip. Without them the Slot column
  // would lose a club's injury heat the moment its starter qualified. With no source column (only backups
  // qualified) there is nothing to carry and the fields are simply absent, as they were before D93.
  // `sourceSlotId` is informational only — nothing reads it, and it is kept so a reader of the rendered view
  // (or a future debugging aid) can see which club column this one was built out of.
  const slot = {
    slotId: "OFF-WR-SLOT", unit: "OFF", band: "WR", ordinal: 0, columnOrder: 0,
    label: "WR · Slot", derived: true, players: men,
    ...(source
      ? { injury: source.injury, rankSource: source.rankSource, espnRank: source.espnRank, clubLabel: source.clubLabel, sourceSlotId: source.slotId }
      : {}),
  };
  // D86: the tooltip leads with the number that put each man in the column — the rate the bar was read on
  // — and carries his slot snaps in brackets behind it, in the column's own order. D117 retired D89's floor,
  // so a man can reach the column on his rate alone with no snap count at all; the null-safe fallback below
  // is what drops the bracket for him rather than printing an empty one.
  const entryOf = (p) => {
    const snaps = slotSnapsOf(p);
    return `${lastName(p.name)} ${rateOf(p)}%${snaps == null ? "" : ` (${snaps} slot snaps)`}`;
  };
  // D93: the column can now hold men who never cleared the bar — a qualifying starter's own backups, carried
  // in with his column. The first sentence is a statement about who plays inside, so it names only the men the
  // bar was actually read on, in the column's own top-to-bottom order; a 12%-inside fourth-stringer riding
  // along under his starter would make it false. Those carried men are then named in a clause of their own, so
  // that a reader who sees a name on the column and not in the sentence is not left wondering why he is there:
  // he is in the column because the CLUB lists him in it, not because of anything he does inside.
  // (For D12/D44's shape the decider is the ACTIVE fill-in, so a listed-OUT starter above him who did not
  // clear the bar himself is named in this clause too — he is one of the men the column carried in.)
  const carriedOver = source ? men.filter((p) => inGroup.has(p) && !isQualified(p)) : [];
  const decider = source ? columnDecider(source) : null;
  const carriedClause = carriedOver.length && decider
    ? `; listed behind ${lastName(decider.name)} by the club: ${carriedOver.map((p) => lastName(p.name)).join(", ")}`
    : "";
  const reason = `Slot receivers (40 percent or more of their snaps inside): ${men.filter(isQualified).map(entryOf).join(", ")}${carriedClause}`;
  return { slot, kept, reason };
}

// D92 (Adam, 2026-09-15): a receiver column's number is no longer the club's — it is ESPN's rank of the man
// leading the column — so a leftover column's tooltip has to say where its number came from AND what the club
// itself prints, or the pill and the tooltip would contradict each other. `rankSource` is the server's own
// provenance: "espn" when ESPN ranked the leading man, "chart" when nothing but the printed order of the
// chart we hold placed the column. The club's printed position is the number on its own label when the club
// numbers its receiver rows, and otherwise the column's ordinal, which was counted off that printed order.
//
// D93 renumbers the surviving columns down their left-to-right order, so the pill on the box and the number
// in this sentence can be two different numbers (pill WR1, server label WR2). `displayLabel` is what the box
// actually prints: when it differs from the server's own label the sentence opens by saying so, or the
// tooltip would read as a flat contradiction of the pill above it. Called without one — as the tests call it
// directly — it is the plain provenance sentence it has always been.
//
// D94 (Adam, 2026-09-15): the WR band is now built straight off ESPN's own depth chart, not the club's page —
// every WR column carries `clubLabel: "WR (ESPN)"` (server/compile/starters.js's ESPN_WR_CLUB_LABEL, inlined
// here since this module takes no imports) and `labelSource: "espn"`. For those columns there is no club
// position to quote: `printedOrdinal` would find no digit in "WR (ESPN)" and fall back to `slot.ordinal`,
// which is just ESPN's own column count dressed up as something the club printed — a claim that is no longer
// true. So an ESPN column drops the "the club prints it" clause entirely and says only what is true: ESPN
// listed it at this number.
// Exported for the tests — nothing else calls it.
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

// The PASS CATCHERS row (D69's own row, D71's x-maths, D97's left-to-right order). D63 hung these columns
// off the ends of the offensive-line comb so the receivers stood where they really line up, two pitches
// outside the tackles; D71 replaced that with what Adam actually wants to read — ONE evenly-pitched cluster
// centred on the field's centre line, at the same MIN_PITCH every other row uses. D97 (Adam, 2026-09-16):
// the pills must climb left to right, so it reads
//   WR1 · WR · Slot (if any) · WR2 · ... · TE(s) · WRlast
// i.e. the club columns in their own ascending order, the Slot column (if any) right after WR1, and the
// tight end(s) tucked inside the last receiver. A second tight end still stacks directly under the first on
// one x, so a two-TE club takes no more width than a one-TE club.
// Nothing is written back into `lm` any more: with the receivers in a cluster there is no receiver
// position for the secondary to mirror, so the corners and the nickel are fixed off the tackles in
// mirrorLandmarks instead (D71).
function layoutPassCatchers(offSlots, lm, style) {
  const col = (slot, band, extra = {}) => ({ slot, x: lm.C, height: slotContentHeight(slot, style), width: colWidth(style), band, ...extra });
  const wrSlots = offSlots.filter((s) => s.band === "WR").slice().sort(byColumnOrder);
  const teCols = offSlots.filter((s) => s.band === "TE").slice().sort(byColumnOrder).map((s) => col(s, "TE"));

  // D83: the slot men are regrouped into their own column before any geometry happens, so the cluster is
  // laid out over the columns that will actually be drawn — an emptied club column is never given a place
  // in the comb and then hidden, it simply is not there.
  const grouped = regroupSlotReceivers(wrSlots);
  const slotCol = grouped ? col(grouped.slot, "WR", { displayLabel: "WR · Slot", derived: true, slotReason: grouped.reason }) : null;
  // D93 (Adam, 2026-09-15), replacing D83's addendum: the leftover columns used to read a plain "WR" with no
  // number at all, because with an inside man lifted out of the middle of the row "WR2" no longer described
  // the box. Now that a qualifying starter takes his WHOLE column with him, what is left is a clean run of
  // real receiver columns, so they are RENUMBERED WR1, WR2… down their existing left-to-right order (which is
  // still ESPN's, D92) — Philadelphia reads WR1, WR · Slot, WR2, TE rather than WR, WR · Slot, WR. The
  // renumbering is a display label only: the slot keeps the server's own `label`, so the tooltip can still say
  // both numbers truthfully ("Numbered WR1 here…; ESPN ranks this column WR2; the club prints it 3rd"). With
  // no Slot column at all nothing is regrouped and the server's WR1/WR2/WR3 pills stand exactly as before.
  //
  // Only a column still led by a STARTER takes a number. The two-starters case can leave a column holding
  // nothing but the losing starter's backups (see regroupSlotReceivers), and D92 already sorts that column
  // behind every starter's column precisely because it is not a number-two receiver — so it must not be
  // handed a rank pill either. It prints a plain "WR", claiming no place in the club's receiver order, and
  // the columns that ARE starter-led number straight through it: WR1, WR2, … WR.
  let wrRank = 0;
  const wrCols = grouped
    ? grouped.kept.map((s) => {
      const displayLabel = starterLed(s) ? `WR${++wrRank}` : "WR";
      return col(s, "WR", { displayLabel, slotReason: columnRankReason(s, displayLabel) });
    })
    : wrSlots.map((s) => col(s, "WR"));

  stackColumns(teCols); // TE2 under TE1: the stack takes ONE place in the cluster, not two
  const te = teCols.length ? [teCols[0]] : [];
  // D97 (Adam, 2026-09-16): the pills must read ascending left to right — WR1, WR2, WR3. The old order below
  // hung the LAST club column off the far end only when a Slot column sat between WR1 and the rest; with no
  // Slot column it instead read WR1, WR3, TE, WR2 (the Ravens), which is what D97 was raised against. Both
  // cases now share one shape: the club columns stay in their own ascending order, the Slot column (if any)
  // slots in right after WR1, and the tight end(s) stay tucked inside the last receiver exactly as D71/D76
  // already placed them. One club column left keeps that single column with the Slot column right after it;
  // none left (every charted receiver plays inside) leaves the Slot column alone with the TEs.
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
  // 👁 QA round 3 item 4: the backs used to step out from the centre by a fixed MIN_PITCH, which on the
  // SIDE view (where the whole row is scaled up to fill a 1700px window) opened a ~600px hole between
  // the quarterback and a lone running back. They are spread across the same tackle-to-tackle span the
  // rest of the offence uses, skipping the centre so the quarterback keeps it to himself.
  const half = Math.ceil(backs.length / 2);
  const left = spanPoints(lm.LT, lm.LG, half).slice(0, half);
  const right = spanPoints(lm.RG, lm.RT, backs.length - half);
  const backXs = [];
  for (let i = 0; i < backs.length; i++) backXs.push(i % 2 === 0 ? right[Math.floor(i / 2)] ?? left[Math.floor(i / 2)] : left[Math.floor(i / 2)] ?? right[Math.floor(i / 2)]);
  backs.forEach((slot, i) => cols.push(col(slot, backXs[i] ?? lm.C, "BACKFIELD")));
  return cols;
}

// Derives the defensive front's and secondary's mirror-grid landmarks from the OL row. Ruling D made the
// line row the five linemen alone, so the tackle/guard/centre landmarks are exact rather than being read
// out of a ten-column mixed row.
//
// D71: the WIDE landmarks (the two corners and the nickel) are decided HERE and nowhere else. D63 had
// them overwritten further down by whatever x the receivers landed on, so a corner stood on the man he
// covers; D71's centred receiver cluster killed that pairing — mirroring a cluster would drag the whole
// secondary into the middle of the field, which is the failure ruling D hit once already (PHI's two
// corners over the left hash with the safeties still centred). So the corners go back to a fixed 1.4
// pitches outside the tackles, the nickel to the gap between the left corner and the box, and a defensive
// row's shape no longer depends on how many receivers the club happens to chart.
//
// D119: `sideDefense` is true only for the single-unit DEFENSE page (a layout carrying defensive slots and
// no offensive ones — zoom.js's unitView(view, "DEF"), and nothing else in the app produces that shape).
// It is the ONLY thing that switches the tighter, centre-pitched landmarks on, so the team, matchup and
// offense pages keep every x they have today.
function mirrorLandmarks(olCols, sideDefense = false) {
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
  // D112/D116: edge rushers stand just outside the tackle, not out at the corner's landmark.
  // D119: on the defense page alone they come in another 0.3 of a pitch, measured off the centre.
  const EDGE_L = sideDefense ? C - SIDE_DEF_EDGE_PITCH_FROM_CENTER * pitch : LT - EDGE_PITCH_OUT * pitch;
  const EDGE_R = sideDefense ? C + SIDE_DEF_EDGE_PITCH_FROM_CENTER * pitch : RT + EDGE_PITCH_OUT * pitch;
  // D116: the inside linebackers stand just inside the guards, not on top of them, so they read as clearly
  // inside their neighbouring EDGE column rather than sharing a landmark with the safeties (which stay on
  // the guards themselves — see the "S" case below, untouched by this ruling).
  const ILB_L = C - ILB_PITCH_FROM_CENTER * pitch;
  const ILB_R = C + ILB_PITCH_FROM_CENTER * pitch;
  // D119: the defense page's corners, nickel and safeties are all pitched off the centre; every other page
  // keeps D71/D110's corners outside the tackles, D71's nickel inside the corner and the safeties on the
  // guards (S_L/S_R ARE the guards there, so mirrorDefXs's "S" case is the same placement it always was).
  const CB_L = sideDefense ? C - SIDE_DEF_CB_PITCH_FROM_CENTER * pitch : LT - CB_PITCH_OUT * pitch;
  const CB_R = sideDefense ? C + SIDE_DEF_CB_PITCH_FROM_CENTER * pitch : RT + CB_PITCH_OUT * pitch;
  const NB_X = sideDefense
    ? C - SIDE_DEF_NB_PITCH_FROM_CENTER * pitch
    : Math.max(LT - NB_PITCH_OUT * pitch, CB_L + MIN_PITCH);
  const S_L = sideDefense ? C - SIDE_DEF_S_PITCH_FROM_CENTER * pitch : LG;
  const S_R = sideDefense ? C + SIDE_DEF_S_PITCH_FROM_CENTER * pitch : RG;
  return { LT, LG, C, RG, RT, pitch, EDGE_L, EDGE_R, ILB_L, ILB_R, CB_L, CB_R, NB_X, S_L, S_R };
}

// Ruling A: the LINE row places by LABEL, not by count, because it can now hold 3-5 columns of two
// different kinds. Ends (label "DE") go over/just outside the tackles; the interior (DT, or a 3-4's NT)
// goes over the guards in a 4-3 and on the centre in a 3-4. Left to right that reads DE, DT/NT…, DE in
// a 4-3 and DE, NT, DE in a 3-4 — which is exactly how the two fronts actually line up. The slots keep
// their own chart order; only their x's are assigned by kind, so the DOM order never has to change.
const isEndLabel = (slot) => /^(?:[LR]?DE)$/.test(String(slot?.label || "").toUpperCase());
function placeLineColumns(slots, scheme, lm) {
  const xs = new Array(slots.length);
  const ends = [], interior = [];
  slots.forEach((s, i) => (isEndLabel(s) ? ends : interior).push(i));
  const interiorXs = scheme === "3-4"
    ? placeFlankedCenter(interior.length, lm.LG, lm.RG, lm.C) // one nose tackle sits on the centre
    : spanPoints(lm.LG, lm.RG, interior.length);             // 4-3 tackles sit over the two guards
  interior.forEach((idx, k) => (xs[idx] = interiorXs[k]));
  // Two ends flank the tackles; a rare third or fourth end spreads between the guards and is then
  // pushed clear of the interior linemen by enforceNoOverlap below.
  const endXs = placeOuterInner(ends.length, lm.LT, lm.RT, lm.LG, lm.RG);
  ends.forEach((idx, k) => (xs[idx] = endXs[k]));
  return xs;
}

// The per-band mirroring rule (Adam, 2026-09-11), as amended by ruling A and D116: the LINE row places by
// label (above); a 3-4's outside linebackers sit just outside the tackles and any other stand-up edge label
// spreads between them; MLB over the centre, OLB/ILB at ILB_PITCH_FROM_CENTER pitches off it (D116 — just
// inside the guards, not on top of them); CB wide of the tackles, NB inside the left corner (D71 — both
// fixed off the line, no longer mirrored off the receivers); safeties deepest but still centred over the
// guards (unmoved by D116 — only the LB band's landmark changed).
//
// D111 (Adam, 2026-09-16) changes NONE of the x's below, which is the point of it: the one-row secondary is
// the CB, NB and S bands drawn on a single y, each keeping exactly the place it already had. Left to right
// that reads corner, nickel, safety, safety, corner — the corner 1.15 pitches outside the left tackle
// (D71/D110), the nickel one pitch outside it but never closer than MIN_PITCH to the corner, and the two
// safeties on the guards. At the standard five-man shape every real club charts, the gaps come out 242,
// 278, 484, 520 units against a MIN_PITCH of 242, so nothing is re-pitched and no card touches another;
// computeLayout's secondaryFitsOneRow check below is what keeps that honest for a shape nobody charts yet.
function mirrorDefXs(band, slots, scheme, lm) {
  const count = slots.length;
  if (count <= 0) return [];
  switch (band) {
    case "DL": return placeLineColumns(slots, scheme, lm);
    // D112/D116: EDGE_L/EDGE_R sit EDGE_PITCH_OUT pitches outside the tackles (just outside, where a real
    // defensive end lines up) - not on the corner's own, much-further-out landmark.
    case "EDGE": return scheme === "3-4"
      ? placeOuterInner(count, lm.EDGE_L, lm.EDGE_R, lm.LG, lm.RG)
      : spanPoints(lm.EDGE_L, lm.EDGE_R, count);
    // D116: "the LB band's two inside linebackers" (Adam) is exactly the even-count case in this codebase —
    // a 3-4's 2 ILBs, its only real shape today, since a 3-4's OLBs live on the EDGE band, not here. That
    // pair moves in to ILB_L/ILB_R (ILB_PITCH_FROM_CENTER pitches off the centre) instead of the guards.
    // A 4-3's odd-count row (WLB, MLB, SLB — outside backers flanking a true inside one) is left on the
    // guards: placeFlankedCenter's odd branch splits the flank range into two HALVES and re-widens either
    // half up to MIN_PITCH if it is narrower, so reusing ILB_L/ILB_R there would push WLB/SLB further out
    // than intended instead of tighter — and Adam's ruling never named that shape as wrong. It was already
    // comfortably inside the tightened EDGE landmarks (1 pitch off centre vs. EDGE's new 2.2) before this
    // ruling and still is (see the D116 "3-LB row" test), so it does not need to move.
    case "LB": return count % 2 === 0
      ? placeFlankedCenter(count, lm.ILB_L, lm.ILB_R, lm.C)
      : placeFlankedCenter(count, lm.LG, lm.RG, lm.C);
    // 👁 QA item 8: spanPoints(xMin,xMax,1) lands a single point on the exact MIDPOINT of its range — fine
    // for a band that belongs in the middle (NB, S), wrong for CB, whose range is the two outside corners.
    // A team whose chart carries only one combined CB slot (both corners stacked as one column, e.g. WAS)
    // used to draw that corner dead centre, right on top of the nickel, leaving both real corner spots
    // empty — the opposite of how a defensive backfield actually lines up. A lone CB now takes the same
    // outside spot spanPoints(...,2) would give its first of two, so it still reads as "a corner", not
    // "a second nickel". (D48/D57: which specific side is not football-important, only that it is wide.)
    case "CB": return count === 1 ? [spanPoints(lm.CB_L, lm.CB_R, 2)[0]] : spanPoints(lm.CB_L, lm.CB_R, count);
    case "NB": return spanPoints(lm.NB_X, lm.NB_X, count);
    // D119: S_L/S_R are the guards everywhere except the defense-only side page, where they are half a
    // pitch either side of the centre — so two safeties land exactly MIN_PITCH apart, one lands on the
    // centre and a third shape spreads on the centre and one pitch either side of it.
    case "S": return spanPoints(lm.S_L, lm.S_R, count);
    default: return spanPoints(lm.C, lm.C, count);
  }
}

// Safety net applied to every row after its columns get an x: real depth charts occasionally carry an
// unusual slot count (👁 review, 2026-09-11 — two DIFFERENT bands sharing one row, each computed
// independently, can coincide in ways no single band's own placement function can see coming). This
// sorts a row's columns by x, pushes any pair closer than their two half widths plus a small clearance
// apart, then re-centres the group on its original midpoint so a rare fix-up doesn't drift the row.
// The bare minimum turf between two adjacent cards, used only as the floor when a view's cards are wide
// enough that MIN_PITCH alone would let them touch. D110 (Adam, 2026-09-16) makes it the number MIN_PITCH is
// actually BUILT from rather than a slack floor sitting well under it: the team/matchup card is 216 and
// MIN_PITCH is 242, so 216 + 26 = 242 and the two agree exactly. The Math.max below therefore still resolves
// to MIN_PITCH on every row — no row is re-pitched after its own placement function has chosen its x's,
// which is what D71's landmarks depend on — but now it does so by construction instead of by luck, and the
// gap a reader actually sees between two cards is this constant rather than a number derived elsewhere.
// D94's 210-wide side card is inside it too (210 + 26 = 236 < 242), so the offense/defense pages keep taking
// their pitch from MIN_PITCH the same as every other view.
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

// D111: "confirm nothing collides... if a club would collide, that club alone falls back to the two-row
// layout with a warning." This is that confirmation, asked of the club's OWN secondary before the row is
// committed to. It is deliberately stricter than "do the cards overlap": enforceNoOverlap would happily
// shove a crowded row apart, but doing so would re-pitch the corners off the 1.15 pitches D71 fixes them
// at, or push the outermost card off the sideline — so a shape that needs shoving is not a shape this row
// can draw, and that club falls back to the two-row secondary rather than silently drawing a wrong one.
//
// Measured against the league as compiled today (data/cache/compiled, all 32 clubs): the widest secondary
// anybody charts is 2 corners + 1 nickel + 2 safeties, i.e. the five-column shape the comment on
// mirrorDefXs works through, and 11 clubs chart four (no nickel). Nothing in the league reaches this check,
// so nothing falls back today; it exists for the chart that adds a third corner or a fourth safety.
function secondaryFitsOneRow(cols) {
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
// columns rather than spanning the whole row (👁 review, 2026-09-11).
function unlistedByBand(unlisted, unit) {
  const byBand = unlisted?.[unit] || {};
  return Object.entries(byBand).filter(([, list]) => Array.isArray(list) && list.length);
}

// A level label prints at the left edge of its span. When the level's own first row has a column close
// to that edge (D69's outside receiver, at the very end of the PASS CATCHERS row, is the real case), the
// label would otherwise land straight on top of that column's own label pill now that ruling B puts every
// column's pill at the top of its box. Lifting the label into the empty gap above the row — the same trick
// the old merged line row used — keeps both readable without moving either the stripe or the cards.
const LABEL_CLEAR_X = 190; // roughly the widest level label ("LINEBACKERS") plus its left inset
// Enough to clear the column pill below it AND leave visible air: the gap above any row is at least
// BAND_GAP, and at a level boundary BAND_GAP + LEVEL_GAP_EXTRA, so a 22-unit lift always lands the label
// inside empty turf rather than tight against the pill (👁 self-check: at 15 the level caption and
// the "WR1" pill under it read as one two-line block). computeLayout clamps the lift on the offensive
// side so it can never cross back over the line of scrimmage.
const LABEL_LIFT = 27;

// ---- the layout ----------------------------------------------------------------------------------

// Computes the full geometry for a TeamView: every column's box (x, top, height, width) plus a tray box
// per band that has unlisted players, and the line-of-scrimmage y.
export function computeLayout(teamView, opts = {}) {
  const scheme = teamView.scheme || "4-3";
  const defSlots = teamView.units?.DEF || [];
  const offSlots = teamView.units?.OFF || [];
  const unlisted = teamView.unlisted || {};
  const style = layoutStyle(opts);

  // The OL row is computed first — every defensive x below mirrors its tackle/guard/centre grid, the
  // backfield row hangs off the same centre, and D71's receiver cluster is centred on it. A view carrying
  // no offense at all (D72's defense page) simply takes mirrorLandmarks' own fallback comb, which is the
  // same centred five-column grid a real offensive line produces — so a defense is drawn identically
  // whether or not the offense is on screen beside it.
  // D119: a layout carrying a defence and no offence IS the defense side page (zoom.js's unitView; the
  // matchup page always builds both units, and the team page always has both). That single-unit page gets
  // the tighter, centre-pitched landmarks — computed here, once, so the D111 one-row-secondary fit check
  // below and every row that follows are all measured against the landmarks the page will actually use.
  const sideDefense = defSlots.length > 0 && offSlots.length === 0;
  const olCols = layoutOlColumns(offSlots, style);
  const lm = mirrorLandmarks(olCols, sideDefense);
  const passCatcherCols = layoutPassCatchers(offSlots, lm, style);
  const backfieldCols = layoutBackfieldRow(offSlots, lm, style);

  // A row is built with its columns only. Its tray height is decided afterwards by planTrays(), because a
  // tray whose own band has no columns has to be re-homed onto some OTHER row, and that row's height must
  // already account for it before the y-pass runs.
  const buildRow = (key, bands, unit, level, cols) => {
    // Two bands can share one row and be computed independently — belt and braces. A stacked column (D63's
    // TE2) is left out of the sweep and follows its leader afterwards, or the pass would read the two
    // columns sharing one x as an overlap and shove them apart sideways, which is the exact opposite of
    // what stacking them was for.
    enforceNoOverlap(cols.filter((c) => !c.stackUnder));
    for (const c of cols) if (c.stackUnder) c.x = c.stackUnder.x;
    // A stacked column's own height sits BELOW its leader, so the row has to be tall enough for the whole
    // stack, not just for its tallest single column.
    const contentHeight = cols.length ? cols.reduce((m, c) => Math.max(m, (c.yOffset ?? 0) + c.height), CARD_H1) : 0;
    return { key, bands, unit, level, cols, contentHeight, trays: [], trayHeight: 0, height: contentHeight };
  };

  // Ruling A: a band with no slots at all (a 4-3's EDGE band, now that its ends are linemen) takes ZERO
  // height — no floor of CARD_H1, no stripe, no label, no level gap. 👁 QA: that has to hold even when the
  // empty band still has UNLISTED players (ATL carries an edge rusher on the roster but on no chart row);
  // keeping the row alive just to hang his tray on cost a whole level of height and printed an "EDGE"
  // stripe over a blank strip. Empty rows are dropped outright and their trays re-homed by planTrays.
  // One row's worth of columns, freshly built every time it is asked for: the D111 fit check below places a
  // candidate SECONDARY row and may then throw it away, and buildRow mutates the x's it is given
  // (enforceNoOverlap), so nothing may be reused between the two attempts.
  const defColsFor = (bands) => bands.flatMap((band) => {
    const slots = defSlots.filter((s) => s.band === band).slice().sort(byColumnOrder);
    const xs = mirrorDefXs(band, slots, scheme, lm);
    return slots.map((slot, i) => ({ slot, x: xs[i], height: slotContentHeight(slot, style), band, width: colWidth(style) }));
  });

  // D111: the one-row secondary is used unless THIS club's own secondary cannot be drawn on one row without
  // being re-pitched or hanging off the sideline (see secondaryFitsOneRow). Such a club — none in the league
  // as compiled today — falls back to the two-row model on its own, which also means its defence is five
  // rows again and therefore taller than BOTH_SIDES_HALF, so D107's `half` floor grows ITS canvas rather
  // than drawing its rows through each other. Every other club is unaffected.
  let defRows = DEF_ROWS;
  if (SECONDARY_ONE_ROW && !secondaryFitsOneRow(defColsFor(DEF_ROWS_ONE_ROW_SECONDARY.bands.SECONDARY))) {
    defRows = DEF_ROWS_TWO_ROW_SECONDARY;
    console.warn("[field] this chart's secondary is too wide for one row; falling back to the two-row secondary (D111)");
  }

  const defRowsTopDown = defRows.order.slice().reverse().map((key) => {
    const bands = defRows.bands[key];
    return buildRow(key, bands, "DEF", defRows.level[key], defColsFor(bands));
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
  const placeSpan = (rows, top, extraGap) => {
    let y = top;
    let prevLevel = null;
    for (const row of rows) {
      if (prevLevel !== null) y += BAND_GAP + extraGap + (row.level !== prevLevel ? LEVEL_GAP_EXTRA : 0);
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
      if (prevLevel !== null) h += BAND_GAP + (row.level !== prevLevel ? LEVEL_GAP_EXTRA : 0);
      h += row.height;
      prevLevel = row.level;
    }
    return h;
  };

  let losY, layoutHeight;
  if (bothSides) {
    // D96 (Adam, 2026-09-16) — "give the offensive side more room; there's no reason it should be so much
    // smaller." The two halves get EQUAL height, LOS at the midpoint, each half's own rows spread evenly
    // across it. A side with one row (or none) has no internal gap to widen, so it simply sits at its
    // natural height inside the half.
    //
    // D107 (Adam, 2026-09-16) changes WHERE that half height comes from. It used to be the taller side's
    // own natural height, which made the canvas — and therefore the scale the fit engine chose — a
    // function of the club's chart: a four-row defence produced a short canvas that was then magnified,
    // so Jacksonville's cards came out bigger than everyone else's. The half is now the CONSTANT
    // BOTH_SIDES_HALF, so every club draws on an identical canvas and takes an identical scale. The
    // natural heights are still measured, but only as a floor (see BOTH_SIDES_HALF's note): a club taller
    // than the constant would grow its own canvas rather than have its rows compressed into each other.
    const defMin = naturalSpanHeight(defRowsTopDown);
    const offMin = naturalSpanHeight(offRowsTopDown);
    const half = Math.max(BOTH_SIDES_HALF, defMin, offMin);
    const spreadGap = (rows, natural) => (rows.length > 1 && half > natural) ? (half - natural) / (rows.length - 1) : 0;
    placeSpan(defRowsTopDown, MARGIN_TOP, spreadGap(defRowsTopDown, defMin));
    // D107: the half boundaries are the constant's, not the rows' — a defence with fewer rows than the
    // half can hold (a 4-3 with no EDGE row) leaves its spare height as air at the bottom of its own half
    // instead of dragging the line of scrimmage up, so the LOS stays on the canvas midpoint for every club.
    losY = MARGIN_TOP + half + LOS_HALF_GAP;
    const offStart = losY + LOS_HALF_GAP; // the same gutter both ways
    placeSpan(offRowsTopDown, offStart, spreadGap(offRowsTopDown, offMin));
    layoutHeight = offStart + half + MARGIN_BOTTOM;
  } else {
    // D72/D75: a single-unit page has no LOS and no second side, so both lists start at the same top and
    // only one of them is ever populated. `extraGap` is spare height handed back to the rows: the canvas
    // is usually WIDER than tall for the window it has to fit, so the scale is pinned by the width and the
    // leftover height would otherwise be a black band under the last row (D58 asks for both axes to be
    // used). Sharing it out between the rows spends it as air rather than shrinking or stretching anything.
    // D108: the rows start one SIDE_INSET below the top margin and finish one SIDE_INSET above the bottom
    // one, so the first and last rows no longer sit against the turf's edges; the fill pass below then
    // spreads whatever height is left between the rows exactly as it did before.
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
  const layout = { layoutWidth: LAYOUT_WIDTH, layoutHeight, losY, caption, columns, trays, levels, cardWidth: style.cardWidth, fieldMarginX: FIELD_MARGIN_X };
  if (opts.crop) cropLayout(layout);
  return opts.spread && opts.spread !== 1 ? spreadLayout(layout, opts.spread) : layout;
}

// D72: shrink-wraps the canvas around the columns actually on it. The full-width canvas exists because the
// whole-team field really does use it — the corners reach both sidelines — but ONE unit does not: an
// offense spans a little over half of it, so a canvas that stayed 1800 wide would make every single-unit
// page width-bound in the fit engine and leave a deep black gutter under the last row (D58 asks for the
// height to be used, not just the width). Cropping keeps every card the same size in layout units and only
// moves the canvas edges in, so the fit engine's own spread/scale arithmetic then does the enlarging.
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
    // 👁 QA (2026-09-15, item 10): a column's box is its OWN content height, never the row's. Every column
    // still starts on the row's shared top line, which is what makes a row read as one row; stretching the
    // boxes to a common bottom as well drew an empty framed rectangle under any column shorter than its
    // neighbours — glaring on a slot whose out starter has nobody behind him (TEN's OLB on the matchup:
    // a red OUT card above a tall empty frame that looks like a missing fill-in), and it stretched the
    // part-time hatch and the injury-heat glow over turf with nothing in it.
    c.top = row.contentTop + (c.stacked ? c.yOffset ?? 0 : 0);
    c.unit = row.unit;
  }
}

// Decides which row each band's "not on chart" tray hangs under, and grows that row to make room. A tray
// normally sits under its own band's row; when that band has no columns (so its row was dropped) it is
// re-homed onto the last populated row of the same unit — the LINE row for a collapsed EDGE band — and
// renders with its band name so those players are still attributed correctly (👁 QA, ATL).
const TRAY_STACK_GAP = 4;
function planTrays(rows, unlisted) {
  for (const unit of ["DEF", "OFF"]) {
    const unitRows = rows.filter((r) => r.unit === unit);
    if (!unitRows.length) continue;
    for (const [band, entries] of unlistedByBand(unlisted, unit)) {
      const own = unitRows.find((r) => r.bands.includes(band));
      const row = own ?? unitRows[unitRows.length - 1];
      row.trays.push({ band, unit, entries, homed: !own });
    }
    for (const row of unitRows) {
      row.trayHeight = row.trays.length ? TRAY_GAP + row.trays.length * TRAY_H + (row.trays.length - 1) * TRAY_STACK_GAP : 0;
      row.height = row.contentHeight + row.trayHeight;
    }
  }
}

// 👁 QA (2026-09-15, items 3 and 11): a tray is ONE strip TRAY_H tall, and its box used to be exactly as
// wide as its own band's columns. A single-column band (ATL's second tight end, DEN/KC/DAL's backfield)
// is 156 units wide, which is not enough for "NOT ON CHART · BACKFIELD" plus a name, so the chips wrapped
// to a second line — a line the row reserved no height for, so on the LAST row of the offense it spilled
// straight off the bottom edge of the field and got clipped. The strip is therefore widened to hold its
// own text on one line. The text is not measurable from here (this module never touches the DOM), so it
// is ESTIMATED from the character counts at the sizes styles.css gives .tray-label and .tray-chip, and
// deliberately estimated generously: too wide costs empty turf inside a dashed outline, while too narrow
// clips a name. styles.css also pins the strip to one line (`flex-wrap:nowrap`), so a bad estimate can
// only ever trim the tail of the last chip instead of bringing the wrap back.
const TRAY_TEXT_PAD = 20;      // .tray's own left+right padding
const TRAY_ITEM_GAP = 8;       // .tray's flex gap
const TRAY_LABEL_CHAR_W = 6.2; // 10px uppercase, .08em letter-spacing
const TRAY_CHIP_CHAR_W = 6.0;  // 11.5px italic
const TRAY_CHIP_PAD = 18;      // .tray-chip's own padding
function trayNaturalWidth(tray) {
  const label = tray.band ? `not on chart · ${tray.band}` : "not on chart";
  let w = TRAY_TEXT_PAD + label.length * TRAY_LABEL_CHAR_W;
  for (const p of tray.entries ?? []) {
    const text = `#${p.number ?? "—"} ${p.name ?? ""}${p.onActiveRoster === false ? " PS" : ""}`;
    w += TRAY_ITEM_GAP + TRAY_CHIP_PAD + text.length * TRAY_CHIP_CHAR_W;
  }
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

// A tray spans its own band's columns where the band has any, else the whole row it borrowed.
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
      cur = { level: row.level, label: labelMap[row.level] || row.level, unit: row.unit, top: row.top, bottom: row.bottom, firstRow: row, stripeIndex: stripeIndex++ };
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

// Ruling E scales the whole canvas to fit the window, and the binding constraint is almost always HEIGHT
// — which used to leave a ~90px dead strip of black down each side of the field (👁 QA: PHI vs CLE).
// Multiplying every x AND every column width by one factor, together with the canvas width itself, is a
// uniform horizontal magnification: the columns spread out to the sidelines and get proportionally wider,
// so the extra room goes into the names ("Quinyon Mitchell", "Dontayvion Wicks") instead of into margins.
// Heights are untouched, so the scale team.js then applies is unchanged and nothing re-flows vertically.
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
// BACKFIELD on offense) plus a bigger, higher-contrast label inside it at the left
// edge — 🎨 Polish (2026-09-11, round 2, item 3): a faint team-colour stripe (alternating a touch darker/
// lighter so adjacent levels read as distinct) makes the levels obvious at a glance the way D48 asks.
// Plain constant strings only (no player-supplied text), so no esc() is needed here.
export function renderLevelLabels(levels, layoutWidth = LAYOUT_WIDTH) {
  return levels.map((lv, i) => {
    const h = lv.bottom - lv.top;
    // Alternating by the level's OWN index rather than by position in this array, so that two entries
    // belonging to one level always share a tint and read as one band of turf (blue review).
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
// D72: `losY` is null on a single-unit canvas — no yellow line, no LINE OF SCRIMMAGE captions and no
// DEFENSE-above/OFFENSE-below pair; `caption` ("OFFENSE" / "DEFENSE", which computeLayout supplies) prints
// once at the top right instead, in exactly the type the whole-team field labels its halves with.
export function renderFieldSvg(layoutHeight, losY, layoutWidth = LAYOUT_WIDTH, caption = null) {
  const w = layoutWidth;
  const lines = [];
  // 👁 QA item 6: the hash-mark ticks used to sit at fixed 32%/68% canvas positions regardless of where
  // the columns actually landed — ruling E's compact overview reflows column x's per team, so those ticks
  // no longer line up with anything and just floated as stray grey dashes in whatever empty slot they
  // happened to fall in (PHI's secondary/LB/EDGE rows). The yard lines themselves still give the turf its
  // depth; only the un-anchored hash ticks are dropped.
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
  // 👁 review: a single centred caption sat directly over the NT/DT column and was hidden behind it. Two
  // shorter captions flanking the ends of the line never overlap any column.
  const losLabelLeft = `<text x="30" y="${losY - 5}" fill="#ffdd00" font-size="11" font-weight="700" text-anchor="start" letter-spacing="1.2">LINE OF SCRIMMAGE</text>`;
  const losLabelRight = `<text x="${w - 30}" y="${losY - 5}" fill="#ffdd00" font-size="11" font-weight="700" text-anchor="end" letter-spacing="1.2">LINE OF SCRIMMAGE</text>`;
  return `<svg viewBox="0 0 ${w} ${layoutHeight}" width="${w}" height="${layoutHeight}" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;pointer-events:none;">
    ${sidelineTop}${sidelineBottom}${lines.join("")}${los}${losLabelLeft}${losLabelRight}${unitLabel("DEFENSE", 20)}${unitLabel("OFFENSE", layoutHeight - 8)}
  </svg>`;
}

// D110 (Adam, 2026-09-16): the four HORIZONTAL constants join the bag as well. The pitch tests used to
// carry 224, 1.3 and 1.4 as literals copied out of this file, which is how a number goes stale silently the
// moment a ruling moves it; they now read them from here, so the test states the RELATIONSHIP (a corner is
// CB_PITCH_OUT pitches outside the tackle; two cards never come closer than MIN_CARD_GAP) and only the
// handful of assertions that are genuinely about a specific number still spell one out.
// D111 adds the DEFENSIVE ROW COUNT to the bag for the same reason: the canvas constant is derived from it,
// so a test that wants to state "the canvas is this many full rows plus its gaps" can read the count from
// here instead of hard-coding the 5 that D111 turned into a 4.
export const geometry = { CARD_W, CARD_H1, ROW_H, SIDE_ROW_H, CARD_GAP, SIDE_CARD_GAP, BANNER_H, OUT_RAIL_H, LABEL_RESERVE, MAX_DEPTH_ROWS, HEADSHOT_SIZE, BAND_GAP, LEVEL_GAP_EXTRA, LOS_HALF_GAP, MARGIN_TOP, MARGIN_BOTTOM, SIDE_INSET, DEF_ROW_FULL_H, DEF_ROW_COUNT: DEF_ROW_ORDER.length, DEF_LEVEL_BOUNDARIES, BOTH_SIDES_HALF, BOTH_SIDES_HEIGHT, MIN_PITCH, MIN_CARD_GAP, CB_PITCH_OUT, EDGE_PITCH_OUT, ILB_PITCH_FROM_CENTER, PASS_CATCHER_PITCH,
  SIDE_DEF_CB_PITCH_FROM_CENTER, SIDE_DEF_NB_PITCH_FROM_CENTER, SIDE_DEF_S_PITCH_FROM_CENTER, SIDE_DEF_EDGE_PITCH_FROM_CENTER };
