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
// where they actually line up. The LINE row now reads, left to right: outside WR, slot WR, LT LG C RG RT,
// TE, outside WR, every column one pitch from the next (so the slot really is the midpoint between the
// left tackle and the outside receiver, and the right side mirrors that distance). A second tight-end
// column stacks directly UNDER the first instead of taking a second x — the row is already as wide as the
// canvas allows. The RECEIVERS row and the TIGHT ENDS label are gone; BACKFIELD keeps QB/RB/FB.
// The pay-off is on the other side of the ball: the secondary can mirror the REAL receiver positions
// again (corners over the outside receivers, nickel over the slot) instead of the "two pitches outside
// the tackles" approximation ruling D forced on it.

const REFERENCE_WIDTH = 1600; // the OFF_BANDS anchors below were tuned against this width
export const LAYOUT_WIDTH = 1800;
const SCALE = LAYOUT_WIDTH / REFERENCE_WIDTH;

// ---- compact overview geometry (ruling E) -------------------------------------------------------
// A column is now a stack of text rows, not photo cards, so its width is set by how much room a real
// name plus a rating pill needs ("Quinyon Mitchell" + "88") rather than by a headshot diameter.
const CARD_W = 156;
const CARD_H1 = 27;  // the starter's bold row
const ROW_H = 18;    // a slim backup row
const CARD_GAP = 2;  // vertical gap between rows inside a column
const BANNER_H = 13; // extra strip on a line-one row carrying the red OUT / green FILLING IN banner
const LABEL_RESERVE = 17; // the column's own label pill, which lives inside the reserved box
export const MAX_DEPTH_ROWS = 3; // ruling E: at most three depth rows, the third becoming "+N more"

const BAND_GAP = 10; // vertical gap between adjacent rows inside one level
const LEVEL_GAP_EXTRA = 20; // on top of BAND_GAP, only between two rows in DIFFERENT levels
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 14;
const LOS_HALF_GAP = 18; // half the empty gutter straddling the line of scrimmage, same both sides
// Review requirement B: never let two columns sit closer than this. Also the lever that decides how much
// of the canvas the chart actually covers — ruling E scales the whole canvas to fit the window's HEIGHT,
// so if the columns only spanned the middle of the canvas the page would waste the spare width. At 200
// the widest row (corners, two pitches outside the tackles) reaches both sidelines, so the field fills a
// 1700px window edge to edge instead of leaving a dead strip down one side.
const MIN_PITCH = 200;
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
const DEF_ROW_ORDER = ["LINE", "EDGE", "LB", "CB_NB", "S"]; // nearest LOS -> farthest
const DEF_ROW_BANDS = { LINE: ["DL"], EDGE: ["EDGE"], LB: ["LB"], CB_NB: ["CB", "NB"], S: ["S"] };
const DEF_ROW_LEVEL = { LINE: "LINE", EDGE: "EDGE", LB: "LB", CB_NB: "SEC", S: "SEC" };
const DEF_LEVEL_LABEL = { LINE: "LINE", EDGE: "EDGE", LB: "LINEBACKERS", SEC: "SECONDARY" };

// D63: TWO offensive rows now, listed here nearest-the-LOS first. This IS the one constant Adam asked to
// be able to flip — reorder these entries and the whole offensive half reorders with them (levels,
// stripes, labels and gaps all fall out of it). The receivers and tight ends ride in the LINE row, which
// is exactly where they line up, so the old third RECEIVERS row is gone.
const OFF_ROW_GROUPS = [
  { key: "LINE", bands: ["OL", "WR", "TE"] },       // outside WR, slot WR, LT LG C RG RT, TE, outside WR
  { key: "BACKFIELD", bands: ["QB", "BACKFIELD"] }, // QB centred on the centre, RB/FB flanking him
];
const OFF_ROW_LEVEL = { LINE: "LINE", BACKFIELD: "BACKFIELD" };
const OFF_LEVEL_LABEL = { LINE: "LINE", BACKFIELD: "BACKFIELD" };

// D63 spacing, all in multiples of the offensive line's own pitch, so the whole row is one even comb and
// the slot receiver is exactly the midpoint between the left tackle and the outside receiver.
const SLOT_WR_PITCHES = 1;     // slot WR, one pitch outside the left tackle
const OUTSIDE_WR_PITCHES = 2;  // outside WRs, one pitch further out again (both ends of the row)
const TE_PITCHES = 1;          // TE1, one pitch outside the right tackle
// How far INSIDE his receiver the corner sits. Adam's 2026-09-15 tightening ("corners sat too far out")
// is already paid for by D63 itself: the corner is measured against the receiver he covers now, not
// against the tackle, and the outside receiver is the outermost thing on the field. Zero, therefore —
// the corner sits squarely on his man, which is the pairing D63 asks the eye to read. It stays a named
// constant because anything above ~0 is self-defeating at this width: the columns are already exactly
// MIN_PITCH apart, so pulling a corner in pushes the NICKEL off the slot receiver (enforceNoOverlap
// moves whichever column it finds too close), which trades a real alignment for a cosmetic one.
const CB_INSET_PITCHES = 0;
// Fallback only: a chart with no outside receiver column at all (the odd club page that lists none) keeps
// the pre-D63 placement — 1.4 pitches outside the tackle.
const CB_PITCH_OUT = 1.4;
// Vertical air between two columns stacked on the same x (TE2 under TE1).
const STACK_GAP = 8;

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

// A line-one row is CARD_H1 tall normally, plus BANNER_H when it carries a banner — red for a fully-out
// player, green "ACTIVE · FILLING IN" for role ACTIVE (D44). cards.js imports this same geometry so the
// rendered row is never taller than the box this module reserves.
function lineOneHeight(p) {
  return CARD_H1 + (isFullyOut(p) || p.role === "ACTIVE" ? BANNER_H : 0);
}

// How many leading players render as BOLD line-one rows rather than slim depth rows: a co-starter pair
// is two names on one slot (both bold), and a fully-out starter with his ACTIVE fill-in directly under
// him is D44's "the two ratings sit one above the other" case (also both bold). Everything else is one
// bold starter row. Shared with cards.js's renderColumn so the markup and this maths cannot diverge.
export function lineOneCount(players) {
  if (!players.length) return 0;
  const hasCoPair = players.length >= 2 && players[0].coStarter && players[1].coStarter;
  const hasOutFillIn = !hasCoPair && players.length >= 2 && isFullyOut(players[0]) && players[1].role === "ACTIVE";
  return hasCoPair || hasOutFillIn ? 2 : 1;
}

// Ruling E: at most MAX_DEPTH_ROWS slim rows are drawn behind the line-one row(s). When more players
// exist than that, the LAST visible slim row is replaced by a "+N more" tail, so the row count (and
// therefore the reserved height) never exceeds the cap however deep a real chart runs.
export function visibleDepthRows(players) {
  return Math.min(Math.max(players.length - lineOneCount(players), 0), MAX_DEPTH_ROWS);
}

// A slot's real rendered content height: the column's own label pill (which lives inside this box —
// 🎨 Polish round 3 item 3: leaving it out made the deepest column in a row overflow the shared bottom
// edge), plus each bold line-one row, plus the visible slim rows.
function slotContentHeight(slot) {
  const players = slot.players;
  if (!players.length) return CARD_H1 + LABEL_RESERVE;
  const bold = lineOneCount(players);
  let h = LABEL_RESERVE;
  for (let i = 0; i < bold; i++) h += lineOneHeight(players[i]) + (i ? CARD_GAP : 0);
  h += visibleDepthRows(players) * (ROW_H + CARD_GAP);
  return h;
}

const byColumnOrder = (a, b) => a.columnOrder - b.columnOrder;

// Ruling E made every player a text row, so a co-starter pair no longer needs a double-wide column to
// hold two photo cards side by side — both names simply stack as two bold rows in one normal column.
// Every column is therefore exactly CARD_W wide, which is why this is a constant rather than a lookup.
const colWidth = () => CARD_W;

// Assigns x positions to every slot in an OFFENSE band that still uses a fixed canonical range (OL).
function layoutOffBandColumns(offSlots, band) {
  const slots = offSlots.filter((s) => s.band === band).slice().sort(byColumnOrder);
  if (!slots.length) return [];
  const xs = distributeX(offBandRange(band), slots.length);
  return slots.map((slot, i) => ({ slot, x: xs[i], height: slotContentHeight(slot), width: colWidth(), band }));
}

// ---- the offensive rows --------------------------------------------------------------------------

// The five linemen, which are the reference grid the whole defensive front and secondary mirror
// (mirrorLandmarks below) and the comb the receivers are then hung off — so they are computed first.
const layoutOlColumns = (offSlots) => layoutOffBandColumns(offSlots, "OL");

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

// D63 step (1): the Madden archetype is the only free signal that says a receiver plays the slot — EA
// tags him "Slot - WR" (ESPN publishes no slot label at all, D19). ratings.js carries EA's own
// {id,label} object through untouched, and a hand-built fixture may carry a plain string, so both read.
function isSlotArchetype(player) {
  const a = player?.rating?.archetype;
  const label = typeof a === "string" ? a : (a?.label ?? a?.id ?? "");
  return /slot/i.test(String(label));
}

// WHICH RECEIVER PLAYS THE SLOT — deliberately the only place that decision is made (D63), because the
// signal is expected to change: the moment a slot snap-share source exists, the compile step can set
// `slot.isSlot` on the WR slot itself and step (1) below picks it up with nothing else in the front end
// changing. Until then it is derived here from the Madden archetype of each candidate column's line-one
// man, and only when EXACTLY ONE of the top three columns carries it — two slot archetypes (Kansas
// City's Rice and Royals, though Royals is a backup and so never a candidate) or none is not an answer,
// and D19's default of WR3 is the honest fallback. Returns the column, or null when the team does not
// carry three receiver columns to choose between.
export function pickSlotColumn(wrColumns) {
  if (wrColumns.length < 3) return null;
  const top3 = wrColumns.slice(0, 3);
  const flagged = top3.filter((c) => c.slot?.isSlot);
  if (flagged.length === 1) return flagged[0];
  const byArchetype = top3.filter((c) => isSlotArchetype(c.slot?.players?.[0]));
  if (byArchetype.length === 1) return byArchetype[0];
  return top3[2]; // D19: WR3 is the slot until something better says otherwise
}

// The LINE row (D63): outside WR, slot WR, LT LG C RG RT, TE, outside WR, one pitch apart the whole way
// across. It also WRITES BACK the three receiver landmarks the defense mirrors (lm.OUTER_WR_L/R,
// lm.SLOT_WR) — before D63 those were guesses derived from the tackles, and now they are the real
// receiver positions, which is the whole point of putting the receivers on the line.
function layoutLineRow(offSlots, olCols, lm) {
  const col = (slot, x, band) => ({ slot, x, height: slotContentHeight(slot), width: colWidth(), band });
  const pitch = lm.pitch;
  const wrCols = offSlots.filter((s) => s.band === "WR").slice().sort(byColumnOrder).map((s) => col(s, lm.C, "WR"));
  const teCols = offSlots.filter((s) => s.band === "TE").slice().sort(byColumnOrder)
    .map((s) => col(s, lm.RT + TE_PITCHES * pitch, "TE"));

  const slotCol = pickSlotColumn(wrCols);
  if (slotCol) {
    slotCol.x = lm.LT - SLOT_WR_PITCHES * pitch;
    // The column says so out loud, since which man is the slot is the question this whole row answers:
    // "WR3 · Slot", or "WR1 · Slot" when the archetype says the team's best receiver plays inside.
    slotCol.displayLabel = `${slotCol.slot.label} · Slot`;
  }
  // Everything else goes wide: the first to the left end of the row, the second to the right end. A rare
  // fourth receiver column has nowhere left to stand at this width, so he stacks under the left one the
  // same way TE2 stacks under TE1.
  const outside = wrCols.filter((c) => c !== slotCol);
  const [outsideL, outsideR] = outside;
  if (outsideL) outsideL.x = lm.LT - OUTSIDE_WR_PITCHES * pitch;
  if (outsideR) outsideR.x = lm.RT + OUTSIDE_WR_PITCHES * pitch;
  stackColumns([outsideL, ...outside.slice(2)].filter(Boolean));
  stackColumns(teCols);

  lm.SLOT_WR = slotCol ? slotCol.x : lm.C;
  lm.OUTER_WR_L = outsideL ? outsideL.x + CB_INSET_PITCHES * pitch : lm.LT - CB_PITCH_OUT * pitch;
  lm.OUTER_WR_R = outsideR ? outsideR.x - CB_INSET_PITCHES * pitch : lm.RT + CB_PITCH_OUT * pitch;
  return [...olCols, ...wrCols, ...teCols];
}

// The BACKFIELD row: the quarterback stays centred on the centre (Adam: "QB centred behind C as now")
// and the backs flank him, alternating right then left, so a lone running back sits just off-centre and
// a RB+FB pair straddles the QB rather than crowding one shoulder.
function layoutBackfieldRow(offSlots, lm) {
  const qb = offSlots.filter((s) => s.band === "QB").slice().sort(byColumnOrder);
  const backs = offSlots.filter((s) => s.band === "BACKFIELD").slice().sort(byColumnOrder);
  const col = (slot, x, band) => ({ slot, x, height: slotContentHeight(slot), width: colWidth(), band });
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
// The WIDE landmarks (the outside corners and the nickel) are only PLACEHOLDERS here: ruling D had packed
// every receiver into a readability cluster in its own row, so mirroring that cluster would have dragged
// the secondary off to one side of the field for no football reason (it did exactly that on the first
// render: PHI's two corners sat over the left hash while the safeties stayed centred), and the corners
// were placed off the tackles instead. D63 put the receivers back on the line, so layoutLineRow above
// overwrites OUTER_WR_L/OUTER_WR_R/SLOT_WR with the real receiver x's and the corners cover the men they
// are actually covering again. What is left here is the fallback for a chart with no receivers on it.
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
  const OUTSIDE_L = LT - pitch;
  const OUTSIDE_R = RT + pitch;
  const OUTER_WR_L = LT - CB_PITCH_OUT * pitch;
  const OUTER_WR_R = RT + CB_PITCH_OUT * pitch;
  const SLOT_WR = C;
  return { LT, LG, C, RG, RT, pitch, OUTSIDE_L, OUTSIDE_R, OUTER_WR_L, OUTER_WR_R, SLOT_WR };
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

// The per-band mirroring rule (Adam, 2026-09-11), as amended by ruling A: the LINE row places by label
// (above); a 3-4's outside linebackers sit just outside the tackles and any other stand-up edge label
// spreads between them; MLB over the centre, OLB/ILB over the guards; CB over the outside receivers,
// NB over the slot receiver; safeties deepest but still centred over the guards.
function mirrorDefXs(band, slots, scheme, lm) {
  const count = slots.length;
  if (count <= 0) return [];
  switch (band) {
    case "DL": return placeLineColumns(slots, scheme, lm);
    case "EDGE": return scheme === "3-4"
      ? placeOuterInner(count, lm.OUTSIDE_L, lm.OUTSIDE_R, lm.LG, lm.RG)
      : spanPoints(lm.OUTSIDE_L, lm.OUTSIDE_R, count);
    case "LB": return placeFlankedCenter(count, lm.LG, lm.RG, lm.C);
    // 👁 QA item 8: spanPoints(xMin,xMax,1) lands a single point on the exact MIDPOINT of its range — fine
    // for a band that belongs in the middle (NB, S), wrong for CB, whose range is the two outside corners.
    // A team whose chart carries only one combined CB slot (both corners stacked as one column, e.g. WAS)
    // used to draw that corner dead centre, right on top of the nickel, leaving both real corner spots
    // empty — the opposite of how a defensive backfield actually lines up. A lone CB now takes the same
    // outside spot spanPoints(...,2) would give its first of two, so it still reads as "a corner", not
    // "a second nickel". (D48/D57: which specific side is not football-important, only that it is wide.)
    case "CB": return count === 1 ? [spanPoints(lm.OUTER_WR_L, lm.OUTER_WR_R, 2)[0]] : spanPoints(lm.OUTER_WR_L, lm.OUTER_WR_R, count);
    case "NB": return spanPoints(lm.SLOT_WR, lm.SLOT_WR, count);
    case "S": return spanPoints(lm.LG, lm.RG, count);
    default: return spanPoints(lm.C, lm.C, count);
  }
}

// Safety net applied to every row after its columns get an x: real depth charts occasionally carry an
// unusual slot count (👁 review, 2026-09-11 — two DIFFERENT bands sharing one row, each computed
// independently, can coincide in ways no single band's own placement function can see coming). This
// sorts a row's columns by x, pushes any pair closer than their two half widths plus a small clearance
// apart, then re-centres the group on its original midpoint so a rare fix-up doesn't drift the row.
const MIN_CLEARANCE = MIN_PITCH - CARD_W;
function enforceNoOverlap(cols) {
  if (cols.length < 2) return;
  const originalMin = Math.min(...cols.map((c) => c.x));
  const originalMax = Math.max(...cols.map((c) => c.x));
  const sorted = cols.slice().sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const minDist = sorted[i - 1].width / 2 + sorted[i].width / 2 + MIN_CLEARANCE;
    if (sorted[i].x - sorted[i - 1].x < minDist) sorted[i].x = sorted[i - 1].x + minDist;
  }
  const shift = (originalMin + originalMax) / 2 - (sorted[0].x + sorted[sorted.length - 1].x) / 2;
  for (const c of sorted) c.x += shift;
}

// Players carried on the roster but absent from the chart (role UNLISTED), grouped per real band —
// never merged across the bands sharing a row, so a tray can be aligned to that specific band's own
// columns rather than spanning the whole row (👁 review, 2026-09-11).
function unlistedByBand(unlisted, unit) {
  const byBand = unlisted?.[unit] || {};
  return Object.entries(byBand).filter(([, list]) => Array.isArray(list) && list.length);
}

// A level label prints at the left edge of its span. When the level's own first row has a column close
// to that edge (D63's outside receiver, at the very end of the line row, is the real case), the label would otherwise land
// straight on top of that column's own label pill now that ruling B puts every column's pill at the top
// of its box. Lifting the label into the empty gap above the row — the same trick the old merged line
// row used — keeps both readable without moving either the stripe or the cards.
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

  // The OFF line row is computed first — every defensive x below mirrors its tackle/guard/centre grid,
  // and the backfield row hangs off the same centre. D63: layoutLineRow also hangs the receivers and the
  // tight ends off that same comb and writes the real receiver landmarks back into `lm`, so it has to run
  // BEFORE any defensive column is placed (the corners and the nickel read those landmarks).
  const olCols = layoutOlColumns(offSlots);
  const lm = mirrorLandmarks(olCols);
  const lineCols = layoutLineRow(offSlots, olCols, lm);
  const backfieldCols = layoutBackfieldRow(offSlots, lm);

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
  const defRowsTopDown = DEF_ROW_ORDER.slice().reverse().map((key) => {
    const bands = DEF_ROW_BANDS[key];
    const cols = bands.flatMap((band) => {
      const slots = defSlots.filter((s) => s.band === band).slice().sort(byColumnOrder);
      const xs = mirrorDefXs(band, slots, scheme, lm);
      return slots.map((slot, i) => ({ slot, x: xs[i], height: slotContentHeight(slot), band, width: colWidth() }));
    });
    return buildRow(key, bands, "DEF", DEF_ROW_LEVEL[key], cols);
  }).filter((row) => row.cols.length);

  const offRowsTopDown = OFF_ROW_GROUPS.map(({ key, bands }) =>
    buildRow(key, bands, "OFF", OFF_ROW_LEVEL[key], key === "LINE" ? lineCols : backfieldCols)
  ).filter((row) => row.cols.length);

  planTrays([...defRowsTopDown, ...offRowsTopDown], unlisted);

  // --- DEF rows, farthest-from-LOS first (top of canvas) down to nearest (LINE, bottom of the half) ---
  let y = MARGIN_TOP;
  let prevDefLevel = null;
  for (const row of defRowsTopDown) {
    // Adam: "generous vertical separation" between LEVELS — rows that share a level (CB/NB and S, both
    // "secondary") keep the normal BAND_GAP between them.
    if (prevDefLevel !== null && row.level !== prevDefLevel) y += LEVEL_GAP_EXTRA;
    placeRow(row, y);
    y = row.bottom + BAND_GAP;
    prevDefLevel = row.level;
  }
  const defEnd = defRowsTopDown.length ? y - BAND_GAP : MARGIN_TOP;
  const losY = defEnd + LOS_HALF_GAP;
  const offStart = losY + LOS_HALF_GAP; // same gap as the defensive side: a consistent gutter both ways

  // --- OFF rows, nearest-LOS first down to farthest (D63: LINE, then BACKFIELD) ---
  y = offStart;
  let prevOffLevel = null;
  for (const row of offRowsTopDown) {
    if (prevOffLevel !== null && row.level !== prevOffLevel) y += LEVEL_GAP_EXTRA;
    placeRow(row, y);
    y = row.bottom + BAND_GAP;
    prevOffLevel = row.level;
  }
  const offEnd = offRowsTopDown.length ? y - BAND_GAP : offStart;
  const layoutHeight = offEnd + MARGIN_BOTTOM;

  const allRows = [...defRowsTopDown, ...offRowsTopDown];
  const columns = allRows.flatMap((r) => r.cols);
  // The offensive labels may not be lifted above the line of scrimmage: D63's LINE row starts one
  // LOS_HALF_GAP below it, which is less than LABEL_LIFT, so an unclamped lift would print "LINE" on top
  // of the yellow line and its own "LINE OF SCRIMMAGE" captions.
  const levels = [...summarizeLevels(defRowsTopDown, DEF_LEVEL_LABEL), ...summarizeLevels(offRowsTopDown, OFF_LEVEL_LABEL, losY + 3)];
  const trays = allRows.flatMap((row) => row.trays.map((t, i) => {
    const top = row.trayTop + i * (TRAY_H + TRAY_STACK_GAP);
    return { ...t, top, bottom: top + TRAY_H, ...fitTrayWidth(trayBounds(row, t.band), trayNaturalWidth(t)) };
  }));

  const layout = { layoutWidth: LAYOUT_WIDTH, layoutHeight, losY, columns, trays, levels, cardWidth: CARD_W, fieldMarginX: FIELD_MARGIN_X };
  return opts.spread && opts.spread !== 1 ? spreadLayout(layout, opts.spread) : layout;
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
  const xs = (bandCols.length ? bandCols : row.cols).map((c) => c.x);
  return { left: Math.min(...xs) - CARD_W / 2, right: Math.max(...xs) + CARD_W / 2 };
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
export function renderFieldSvg(layoutHeight, losY, layoutWidth = LAYOUT_WIDTH) {
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
  const los = `<line x1="20" y1="${losY}" x2="${w - 20}" y2="${losY}" stroke="#ffdd00" stroke-width="3"/>`;
  // 👁 review: a single centred caption sat directly over the NT/DT column and was hidden behind it. Two
  // shorter captions flanking the ends of the line never overlap any column.
  const losLabelLeft = `<text x="30" y="${losY - 5}" fill="#ffdd00" font-size="11" font-weight="700" text-anchor="start" letter-spacing="1.2">LINE OF SCRIMMAGE</text>`;
  const losLabelRight = `<text x="${w - 30}" y="${losY - 5}" fill="#ffdd00" font-size="11" font-weight="700" text-anchor="end" letter-spacing="1.2">LINE OF SCRIMMAGE</text>`;
  const defLabel = `<text x="${w - 26}" y="20" fill="rgba(255,255,255,.45)" font-size="14" font-weight="800" letter-spacing="3" text-anchor="end">DEFENSE</text>`;
  const offLabel = `<text x="${w - 26}" y="${layoutHeight - 8}" fill="rgba(255,255,255,.45)" font-size="14" font-weight="800" letter-spacing="3" text-anchor="end">OFFENSE</text>`;
  return `<svg viewBox="0 0 ${w} ${layoutHeight}" width="${w}" height="${layoutHeight}" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;pointer-events:none;">
    ${sidelineTop}${sidelineBottom}${lines.join("")}${los}${losLabelLeft}${losLabelRight}${defLabel}${offLabel}
  </svg>`;
}

export const geometry = { CARD_W, CARD_H1, ROW_H, CARD_GAP, BANNER_H, LABEL_RESERVE, MAX_DEPTH_ROWS };
