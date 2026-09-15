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
// The column's own label pill, which lives inside the reserved box. 18, not 17: the pill really is 17.6
// tall in styles.css (10.5px text at 1.2 line-height, 1px of padding each side, 3px margin under it), and
// rounding that down is what pushed every column a fraction over its own box.
const LABEL_RESERVE = 18;
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
// columns, so it can afford a wider one, and 180 is the widest that costs nothing: two 180-wide cards plus
// MIN_CARD_GAP still fit inside MIN_PITCH, so the columns keep exactly the pitch D71 places them at.
export const SIDE_CARD_W = 180;

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
const CB_PITCH_OUT = 1.4;
// D71: "the nickel sits between the corner and the box." Nominally one pitch outside the left tackle,
// which is what Adam described; the floor below it is arithmetic, not taste — two columns closer than
// MIN_PITCH overlap, and the corner is already at 1.4 pitches, so a literal one-pitch nickel would be
// drawn through him and then shoved clear by enforceNoOverlap anyway. Taking the max here puts him at the
// same place deliberately instead of by accident, and still reads as "inside the corner, outside the box".
const NB_PITCH_OUT = 1;
// Vertical air between two columns stacked on the same x (TE2 under TE1).
const STACK_GAP = 8;
// D72: the margin left on each side of a cropped single-unit canvas, so the outermost column is not flush
// against the sideline the field SVG draws.
const CROP_MARGIN = 26;
// D72: the most spare height one gap between two rows may absorb on a single-unit page. Enough to turn a
// four-row defense on a 1700x900 screen into a full page; beyond it the rows would start reading as
// unrelated islands rather than as levels of one chart.
const MAX_EXTRA_GAP = 220; // D75: a three-row offense page spreads its rows to fill the height rather than zooming
const PASS_CATCHER_PITCH = 1.3; // D76: receivers/TE cluster pitch as a multiple of MIN_PITCH
const SLOT_COLUMN_MIN_RATE = 50; // D86: share of his OWN snaps a receiver must take inside to stand in the WR · Slot column

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
  return {
    headshot: opts.headshot ? HEADSHOT_SIZE : 0,
    maxDepthRows: opts.maxDepthRows ?? MAX_DEPTH_ROWS,
    cardWidth: opts.cardWidth ?? CARD_W,
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
export function visibleDepthRows(players, maxRows = MAX_DEPTH_ROWS) {
  return Math.min(Math.max(players.length - lineOneCount(players), 0), maxRows);
}

// A slot's real rendered content height: the column's own label pill (which lives inside this box —
// 🎨 Polish round 3 item 3: leaving it out made the deepest column in a row overflow the shared bottom
// edge), plus each bold line-one row, plus the visible slim rows.
function slotContentHeight(slot, style) {
  const players = slot.players;
  if (!players.length) return CARD_H1 + LABEL_RESERVE;
  const bold = lineOneCount(players);
  let h = LABEL_RESERVE;
  for (let i = 0; i < bold; i++) h += lineOneHeight(players[i], style) + (i ? CARD_GAP : 0);
  h += visibleDepthRows(players, style.maxDepthRows) * (ROW_H + CARD_GAP);
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
// Ordering is therefore the club's own chart first and the workload second: club rank (the ordinal
// position of the receiver column he came from — the first column in wrSlots is rank 1), then his tier
// inside that column, then slot snaps, most first. A man on tier 2 of WR-1 stands above the tier-1 man of
// WR-2, because Adam's principle is that a man listed number one on the club's depth chart is never shown
// under anyone.
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
// could not be worked out so it never joined the pool). D86 uses this to ORDER the column and to fill the
// tooltip's bracket — membership itself is decided by the rate below, so a man with a measured rate but no
// snap count still stands in the column.
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
  // finished column by the club's own chart before it looks at any workload. wrSlots arrives in the club's
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

  // Pass two: the men who play at least SLOT_COLUMN_MIN_RATE of their own snaps inside, in club order —
  // column rank, then tier within that column, then slot snaps with the bigger workload first (the club's
  // own printed order settles anything still tied).
  const men = charted
    .filter((c) => c.rate >= SLOT_COLUMN_MIN_RATE)
    .sort((a, b) => a.rank - b.rank || a.tier - b.tier || (b.snaps ?? -1) - (a.snaps ?? -1) || a.row - b.row)
    .map((c) => c.p);
  if (!men.length) return null;

  const moved = new Set(men);
  const movedKeys = new Set(men.map((p) => p.playerKey).filter((k) => k != null));
  const kept = [];
  for (const s of wrSlots) {
    const players = (s.players || []).filter((p) => !moved.has(p) && !(p.playerKey != null && movedKeys.has(p.playerKey)));
    if (players.length) kept.push({ ...s, players });
  }

  const slot = {
    slotId: "OFF-WR-SLOT", unit: "OFF", band: "WR", ordinal: 0, columnOrder: 0,
    label: "WR · Slot", derived: true, players: men,
  };
  // D86: the tooltip leads with the number that put each man in the column — the rate the bar was read on
  // — and carries his slot snaps in brackets behind it, in the column's own order. A man PlayerProfiler
  // published no snap count for shows his rate alone rather than an empty bracket.
  const entryOf = (p) => {
    const snaps = slotSnapsOf(p);
    return `${lastName(p.name)} ${rateOf(p)}%${snaps == null ? "" : ` (${snaps} slot snaps)`}`;
  };
  const reason = `Slot receivers (half or more of their snaps inside): ${men.map(entryOf).join(", ")}`;
  return { slot, kept, reason };
}

// The PASS CATCHERS row (D69's own row, D71's x-maths). D63 hung these columns off the ends of the
// offensive-line comb so the receivers stood where they really line up, two pitches outside the tackles;
// D71 replaced that with what Adam actually wants to read — ONE evenly-pitched cluster centred on the
// field's centre line, at the same MIN_PITCH every other row uses. Left to right it reads:
//   outside WR · WR · Slot · any further WRs · TE(s)
// so the slot man is always drawn INSIDE (to the right of) the outside receiver, which is the one spatial
// fact the row is there to carry. A second tight end still stacks directly under the first on one x, so a
// two-TE club takes no more width than a one-TE club.
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
  // D83 addendum (Adam): with the inside men lifted out, a leftover column's rank no longer describes what
  // is in the box, so every remaining receiver column reads a plain "WR" and the club's own label moves
  // into the tooltip. With no Slot column the club's WR1/WR2/WR3 pills stand exactly as before.
  const wrCols = grouped
    ? grouped.kept.map((s) => col(s, "WR", { displayLabel: "WR", slotReason: `club lists this column as ${s.label}` }))
    : wrSlots.map((s) => col(s, "WR"));

  stackColumns(teCols); // TE2 under TE1: the stack takes ONE place in the cluster, not two
  const te = teCols.length ? [teCols[0]] : [];
  // D71/D76 order, now over the surviving columns: outside WR, WR · Slot, any further WRs, TE(s), and the
  // last club column on the right — so the slot men are always drawn INSIDE the outside receiver and the
  // tight end inside the right-side receiver. One club column left keeps the left end with the Slot column
  // inside it; none left (every charted receiver plays inside) leaves the Slot column alone with the TEs.
  const placed = (slotCol
    ? (wrCols.length > 1
      ? [wrCols[0], slotCol, ...wrCols.slice(1, -1), ...te, wrCols[wrCols.length - 1]]
      : [...wrCols, slotCol, ...te])
    : [wrCols[0], ...wrCols.slice(2), ...te, wrCols[1]]).filter(Boolean);
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
  const CB_L = LT - CB_PITCH_OUT * pitch;
  const CB_R = RT + CB_PITCH_OUT * pitch;
  const NB_X = Math.max(LT - NB_PITCH_OUT * pitch, CB_L + MIN_PITCH);
  return { LT, LG, C, RG, RT, pitch, OUTSIDE_L, OUTSIDE_R, CB_L, CB_R, NB_X };
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
// spreads between them; MLB over the centre, OLB/ILB over the guards; CB wide of the tackles, NB inside
// the left corner (D71 — both fixed off the line, no longer mirrored off the receivers); safeties deepest
// but still centred over the guards.
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
    case "CB": return count === 1 ? [spanPoints(lm.CB_L, lm.CB_R, 2)[0]] : spanPoints(lm.CB_L, lm.CB_R, count);
    case "NB": return spanPoints(lm.NB_X, lm.NB_X, count);
    case "S": return spanPoints(lm.LG, lm.RG, count);
    default: return spanPoints(lm.C, lm.C, count);
  }
}

// Safety net applied to every row after its columns get an x: real depth charts occasionally carry an
// unusual slot count (👁 review, 2026-09-11 — two DIFFERENT bands sharing one row, each computed
// independently, can coincide in ways no single band's own placement function can see coming). This
// sorts a row's columns by x, pushes any pair closer than their two half widths plus a small clearance
// apart, then re-centres the group on its original midpoint so a rare fix-up doesn't drift the row.
// The bare minimum turf between two adjacent cards, used only as the floor when a view's cards are wide
// enough that MIN_PITCH alone would let them touch. At the standard 156 (and at D72's 180) two cards plus
// this gap still fit inside MIN_PITCH, so the Math.max below resolves to MIN_PITCH and every row keeps
// exactly the pitch its own placement function chose — which is what D71 depends on.
const MIN_CARD_GAP = 12;
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
  const olCols = layoutOlColumns(offSlots, style);
  const lm = mirrorLandmarks(olCols);
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
  const defRowsTopDown = DEF_ROW_ORDER.slice().reverse().map((key) => {
    const bands = DEF_ROW_BANDS[key];
    const cols = bands.flatMap((band) => {
      const slots = defSlots.filter((s) => s.band === band).slice().sort(byColumnOrder);
      const xs = mirrorDefXs(band, slots, scheme, lm);
      return slots.map((slot, i) => ({ slot, x: xs[i], height: slotContentHeight(slot, style), band, width: colWidth(style) }));
    });
    return buildRow(key, bands, "DEF", DEF_ROW_LEVEL[key], cols);
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

  // The y-pass, as one function so it can be run twice (see the fill pass below). `extraGap` is spare
  // height handed back to the rows: on a single-unit page the canvas is usually WIDER than tall for the
  // window it has to fit, so the scale is pinned by the width and the leftover height would otherwise be
  // a black band under the last row (D58 asks for both axes to be used). Sharing it out between the rows
  // spends it as air rather than shrinking or stretching anything — every column keeps its own box, so
  // the page is the same chart with more room around it.
  const placeAll = (extraGap) => {
    // --- DEF rows, farthest-from-LOS first (top of canvas) down to nearest (LINE, bottom of the half) ---
    let y = MARGIN_TOP;
    let prevDefLevel = null;
    for (const row of defRowsTopDown) {
      // Adam: "generous vertical separation" between LEVELS — rows that share a level (CB/NB and S, both
      // "secondary") keep the normal BAND_GAP between them.
      if (prevDefLevel !== null) y += extraGap + (row.level !== prevDefLevel ? LEVEL_GAP_EXTRA : 0);
      placeRow(row, y);
      y = row.bottom + BAND_GAP;
      prevDefLevel = row.level;
    }
    const defEnd = defRowsTopDown.length ? y - BAND_GAP : MARGIN_TOP;
    const los = bothSides ? defEnd + LOS_HALF_GAP : null;
    const offStart = bothSides ? los + LOS_HALF_GAP : MARGIN_TOP; // the same gutter both ways when there is one

    // --- OFF rows, nearest-LOS first down to farthest (D69: PASS CATCHERS, LINE, BACKFIELD) ---
    y = offStart;
    let prevOffLevel = null;
    for (const row of offRowsTopDown) {
      if (prevOffLevel !== null) y += extraGap + (row.level !== prevOffLevel ? LEVEL_GAP_EXTRA : 0);
      placeRow(row, y);
      y = row.bottom + BAND_GAP;
      prevOffLevel = row.level;
    }
    const offEnd = offRowsTopDown.length ? y - BAND_GAP : defEnd;
    return { losY: los, layoutHeight: offEnd + MARGIN_BOTTOM };
  };

  let { losY, layoutHeight } = placeAll(0);
  // The fill pass. `opts.minHeight` is the height this canvas would have to be to reach the bottom of the
  // window at the scale its width already dictates — viewfit.js measures the box and works it out, since
  // this module never sees a viewport. Only ever set on a single-unit page, and capped so a very sparse
  // unit ends up airy rather than adrift.
  const gapCount = defRowsTopDown.length + offRowsTopDown.length - 1;
  if (opts.minHeight > layoutHeight && gapCount > 0) {
    const extra = Math.min((opts.minHeight - layoutHeight) / gapCount, MAX_EXTRA_GAP);
    ({ losY, layoutHeight } = placeAll(extra));
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

export const geometry = { CARD_W, CARD_H1, ROW_H, CARD_GAP, BANNER_H, LABEL_RESERVE, MAX_DEPTH_ROWS, HEADSHOT_SIZE };
