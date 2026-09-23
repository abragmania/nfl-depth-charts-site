// Renders PlayerCard / Slot data into HTML strings. Every piece of player-supplied text goes through
// esc() before it touches innerHTML — the data contract is server/fixture JSON, never trusted as markup.
//
// RULING E (Adam, 2026-09-13): the WHOLE-TEAM field is a compact overview now — it has to fit a
// 1700x900 viewport with no scrolling — so its columns are built from text rows, not photo cards:
// a label pill, the starter as one bold row (number, name, rating pill in its colour tier), then slim
// one-line rows for the backups, at most three of them with a "+N more" tail that links through to the
// position-group view. Status badges, the red OUT / green FILLING IN banners, the shading hatch and the
// rating-tier surface colours all survive the shrink. The SIDE, GROUP and MATCHUP views keep their big
// headshot cards and their own renderers (zoom.js's fullCard, matchup.js's matchupCard) — they come
// through renderSlotBody below, which is deliberately untouched by this ruling.
import { lineOneCount, lineOneHeight, visibleDepthRows, displayOrder, outFillInDemotion, OUT_STATUS_CODES, isFullyOut, isScratch } from "./field.js";
// Re-exported so zoom.js and matchup.js share this single definition rather than keeping their own
// copies. D60's isScratch rides the same route.
export { OUT_STATUS_CODES, isFullyOut, isScratch };

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// D70: single source of truth for band display names — a band's internal CODE ("NB", "BACKFIELD") is not
// what a reader sees ("CB · Nickel", "Backfield"). Anything that shows a band to a human reads this table
// (renderTray below, zoom.js's group title and nav crumb). An unknown code falls back to itself, not a blank.
export const BAND_DISPLAY = {
  QB: "QB", BACKFIELD: "Backfield", WR: "WR", TE: "TE", OL: "OL",
  DL: "DL", EDGE: "EDGE", LB: "LB", CB: "CB", NB: "CB · Nickel", S: "Safety",
};
export const bandDisplay = (band) => BAND_DISPLAY[band] || band || "";

// D143: when the club's own chart calls a linebacker row Sam, Mike, Will or Rush, the server puts that word
// on the slot as `clubRole` and leaves the LABEL the plain baseline (MLB / OLB / ILB). It prints after the
// label exactly the way "CB · Nickel" and "WR · Slot" read (D70) — "OLB · Rush", "ILB · Will". The plain
// label is what every layout rule still reads (field.js's isMikeLabel/isEndLabel), so this composes for
// DISPLAY only, in one place shared by the column pill and by each card's position line.
export const withClubRole = (label, slot) => (slot?.clubRole ? `${label} · ${slot.clubRole}` : label);

const STATUS_CLASS = {
  Q: "badge-q", D: "badge-d", OUT: "badge-out", IR: "badge-out", PUP: "badge-out", NFI: "badge-out",
  SUSP: "badge-susp", EXEMPT: "badge-susp", INACTIVE: "badge-inactive",
};

// "F. Last" fallback for the 40px depth rows, where the full name plus a badge/chip won't fit
// (D37b — the fill-in row especially must stay readable). Falls back to the plain name if there's no
// separate first/last to abbreviate.
function shortName(p) {
  const first = (p.first || "").trim();
  const last = (p.last || "").trim();
  if (!first || !last) return p.name;
  return `${first[0]}. ${last}`;
}

// D43 (Adam, 2026-09-11): card surface tracks the player's Madden rating — better players get a
// glossy green card, worse players get a duller one. Tiers by rating.current; a missing rating reads
// as the lowest ("flat") tier rather than defaulting to average.
function ratingTier(rating) {
  const v = rating?.current;
  if (v == null) return "tier-flat";
  if (v >= 90) return "tier-elite";
  if (v >= 80) return "tier-strong";
  if (v >= 70) return "tier-avg";
  if (v >= 60) return "tier-weak";
  return "tier-flat";
}

// The one headshot renderer in the front end. zoom.js's group-view cards and D72's line-one overview rows
// both draw the same circle at different sizes. A player with no photo gets his initials on a plain disc
// instead, and a photo that 404s swaps itself for the same disc at runtime.
function initials(p) {
  const a = (p.first || p.name || "?").trim()[0] || "?";
  const b = (p.last || "").trim()[0] || "";
  return (a + b).toUpperCase();
}

// D138 (Adam): "no photos on phone; only for players rated 90 or above." `opts.minRating` is that floor — a
// man under it (or with no Madden rating at all) gets NO photo and NO initials disc, so the width goes to his
// name instead. Absent, which is every other caller, means "always draw one", so the option itself changes
// nothing for any of them.
export const PHONE_HEADSHOT_MIN_RATING = 90;
export function headshotHtml(p, size, opts = {}) {
  if (opts.minRating != null && !(p.rating?.current >= opts.minRating)) return "";
  const ini = esc(initials(p));
  const boxStyle = `width:${size}px;height:${size}px`;
  const fallback = `this.replaceWith(Object.assign(document.createElement('div'),{className:'headshot-fallback',textContent:'${ini}',style:'${boxStyle};font-size:${Math.round(size * 0.34)}px'}))`;
  if (!p.headshot) return `<div class="headshot-fallback" style="${boxStyle};font-size:${Math.round(size * 0.34)}px">${ini}</div>`;
  // `decoding="async"` and the intrinsic width/height keep a list of photos off the main thread and stop
  // the rows reflowing as each one lands; both match the box the style attribute already sets.
  return `<span class="headshot-box" style="${boxStyle}"><img class="headshot" src="${esc(p.headshot)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" onerror="${fallback}"></span>`;
}

function statusBadge(status) {
  if (!status) return "";
  const cls = STATUS_CLASS[status.code] || "badge-out";
  const title = [status.label, status.detail, status.shortComment, status.returnDate ? `Return: ${status.returnDate}` : null]
    .filter(Boolean).map(esc).join(" — ");
  return `<span class="badge ${cls}" title="${title}">${esc(status.code)}</span>`;
}

function weekOneChip(note) {
  if (!note) return "";
  return `<span class="chip chip-wk1" title="${esc(note)}">Wk1</span>`;
}

// D91 (Adam, 2026-09-15) front-end half: beside every name/rating pill, on every view, the man's last
// three games' share of HIS unit's snaps, newest first, as small muted numbers ("81 · 64 · 70"). The data
// comes from card.snapHistory = [{week, opponent, pct}] (server/compile/chart.js's makeCard — D91's server
// half, built alongside this): newest first, at most 3 entries, pct already measured on the card's OWN
// unit (an offensive card's numbers are always offense_pct, a defensive card's always defense_pct — see
// that file's own comment beside `card.snapHistory =`), [] or absent when he has no game rows. This file
// only has to print what is there: nothing at all when the array is empty or missing — no placeholder, no
// dash — the same "optional fact" treatment weekOneChip/alsoListedChips above already give a maybe-missing
// field.
const UNIT_SNAP_WORD = { OFF: "offensive", DEF: "defensive" };

// `opts.unit` is read off the column/slot/tray this card is drawn on (never guessed from the card itself)
// so the tooltip says "offensive snaps" on an OFF card, "defensive snaps" on a DEF one, and no side word
// at all when the caller has no unit to give (e.g. panel.js) — never an invented default. `opts.gamesPlayed`,
// when the caller has it, notes that a short trio is short because of games missed.
function snapHistoryTitle(history, unit, gamesPlayed) {
  const word = UNIT_SNAP_WORD[unit] || "";
  const lines = history.map((h) => `Wk ${esc(h.week)} vs ${esc(h.opponent)}: ${esc(h.pct)}% of ${word ? word + " " : ""}snaps`);
  if (history.length < 3 && typeof gamesPlayed === "number" && gamesPlayed > history.length) lines.push("Games he missed leave a gap");
  return lines.join("\n");
}

export function snapHistoryHtml(p, opts = {}) {
  const history = Array.isArray(p.snapHistory) ? p.snapHistory : [];
  if (!history.length) return "";
  const nums = history.map((h) => esc(String(h.pct))).join(" · ");
  return `<span class="snaps" title="${snapHistoryTitle(history, opts.unit, opts.gamesPlayed)}">${nums}</span>`;
}

// No "also " prefix, so the chip fits inside a 40px depth row without shoving the name out (title text
// still spells it out). `ownLabel` (the card's own slot.label, passed in by renderColumn below) skips any
// resolved label that matches it, so a co-starter's alsoListedAt pointing back at its own shared column
// doesn't render a ghost chip repeating the column's own label; a genuinely different column still shows.
function alsoListedChips(card, slotLookup, ownLabel) {
  const ids = card.alsoListedAt || [];
  if (!ids.length) return "";
  return ids.map((id) => {
    const label = slotLookup?.(id) || id;
    if (ownLabel && label === ownLabel) return "";
    return `<span class="chip chip-ghost" title="Also appears on the ${esc(label)} column">${esc(label)}</span>`;
  }).join("");
}

function formatReturnDate(returnDate) {
  const d = returnDate ? new Date(returnDate) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// D44 (Adam, 2026-09-11): the red top banner on a STARTER_OUT card, built from status.code/label plus
// returnDate — Adam wants to see at a glance "who's out and for how long" without opening the player.
// SUSP would ideally read as "N games" but that needs the full remaining schedule, which TeamView
// doesn't carry (only the next single game) — falls back to the same "back ~date" phrasing as IR/PUP/NFI.
function outBannerText(status) {
  const ret = formatReturnDate(status?.returnDate);
  const code = status?.code || "OUT";
  if (code === "SUSP") return ret ? `SUSP · back ~${ret}` : "SUSP · out indefinitely";
  const codePart = code !== "OUT" ? ` · ${code}` : "";
  return ret ? `OUT${codePart} · back ~${ret}` : `OUT${codePart} · out indefinitely`;
}

// D60 (Adam, approved 2026-09-15): a healthy game-day scratch is not an injury, so he never wears the red
// banner. Grey, neutral, and no "back ~date" — there is nothing to come back from; he is simply not dressing
// for this game. A genuine OUT (any named injury, including one who also made the inactive list) stays red.
const SCRATCH_BANNER = "INACTIVE · coach's decision";

function bannerHtml(p) {
  if (isScratch(p)) return `<div class="card-banner banner-inactive">${esc(SCRATCH_BANNER)}</div>`;
  if (isFullyOut(p)) return `<div class="card-banner banner-out">${esc(outBannerText(p.status))}</div>`;
  if (p.role === "ACTIVE") return `<div class="card-banner banner-active">ACTIVE · FILLING IN</div>`;
  return "";
}

// ESPN-disagrees ring: only shows when ESPN's own placement for this player actually differs from the
// club chart's — either a different band entirely, or a different rank within the position. Agreement
// must show no ring.
const ESPN_POS_BAND = {
  lt: "OL", rt: "OL", lg: "OL", rg: "OL", c: "OL",
  wr: "WR", te: "TE", qb: "QB", rb: "BACKFIELD", fb: "BACKFIELD",
  lde: "DL", rde: "DL",
  dt: "DL", nt: "DL", ldt: "DL", rdt: "DL",
  mlb: "LB", lilb: "LB", rilb: "LB",
  lcb: "CB", rcb: "CB", nb: "NB", fs: "S", ss: "S",
};
// D137 (2026-09-17): the WEAK-SIDE and STRONG-SIDE codes are scheme-dependent exactly as lolb/rolb are — in
// a 3-4 the man ESPN files at wlb/slb is an outside linebacker, i.e. an edge rusher, and only in a 4-3 is he
// an off-ball backer. Reading them as LB in every scheme rang a false dashed ring on every 3-4 outside
// linebacker in the league (Pittsburgh's T.J. Watt, Arizona's Zaven Collins). mlb/lilb/rilb are off-ball in
// both schemes and stay in the table above.
const SCHEME_OLB_CODES = new Set(["lolb", "rolb", "wlb", "slb"]);
function mapEspnSlotToBand(espnSlot, scheme) {
  const key = String(espnSlot || "").toLowerCase();
  // D18: a 3-4's outside linebackers are edge rushers; the same code in a non-3-4 context is an off-ball
  // backer instead — everything else in the table is scheme-independent. (Ruling A, which supersedes D14,
  // moved lde/rde to DL above: while they still mapped to EDGE this function reported a disagreement for
  // EVERY 4-3 defensive end, painting the whole line with the dashed "ESPN lists him elsewhere" ring and a
  // tooltip that was simply untrue.)
  if (SCHEME_OLB_CODES.has(key)) return scheme === "3-4" ? "EDGE" : "LB";
  return ESPN_POS_BAND[key] || null;
}

// D66: an end code describes the end of the line, which is the same physical spot whether this app calls the
// column DL or EDGE - the difference between those two bands is a judgement about the man's BODY, which ESPN's
// position code does not carry. Treating de/lde/rde as compatible with both keeps the dashed ring meaning what
// it says: ESPN puts this man somewhere else.
const ESPN_END_CODES = new Set(["de", "lde", "rde"]);
const FRONT_BANDS = new Set(["DL", "EDGE"]);
// ...and when the column's own band came from the man rather than from the club's label (D66's two rules:
// "roster-body" reads the man standing there, "starter-of-record" the man who owns the spot), there is nothing
// for ESPN's label to disagree WITH - the band is already an answer to the same question, reached from better
// evidence. Only the rank comparison survives.
// D136's "off-ball" columns (Baltimore's, the Giants' and Seattle's WLB) are the same kind of answer — the app
// read the club's own snap evidence and put a row labelled WLB/SLB on the LINEBACKERS row deliberately, so
// ESPN's band for that man cannot disagree with anything. Only the rank comparison survives.
const BODY_DERIVED = new Set(["roster-body", "starter-of-record", "off-ball"]);

// ESPN's position codes belong to ESPN's OWN formation, not the club's. D133 lets a club chart that
// plainly prints its front overrule ESPN's unit name (Arizona reads 3-4 while ESPN files it "Base 4-3 D"), and
// the compiled view records both in `schemeOverride` — so the code map below must be read in ESPN's scheme or
// every wlb/slb in such a club is mapped to the wrong band. Falls back to the club's scheme when they agree.
export function espnSchemeOf(view) {
  return view?.schemeOverride?.espn?.match(/\b[34]-[34]\b/)?.[0] ?? view?.scheme;
}

// D142: the same verdict, plus the one extra fact the panel's sentence needs — whether ESPN disagrees about
// the POSITION GROUP or only about the rank inside it. Derived from the same mapping espnDisagrees uses, so
// the rule the rings used and the line the panel prints can never part company.
export function espnPlacement(p, slotBand, scheme, labelSource, espnScheme = scheme) {
  if (!espnDisagrees(p, slotBand, scheme, labelSource, espnScheme)) return null;
  const key = String(p.espnSlot).toLowerCase();
  const mapped = mapEspnSlotToBand(p.espnSlot, espnScheme);
  const bandDiffers = !BODY_DERIVED.has(labelSource)
    && !(ESPN_END_CODES.has(key) && FRONT_BANDS.has(slotBand))
    && !!mapped && mapped !== slotBand;
  return { code: String(p.espnSlot).toUpperCase(), rank: p.espnRank ?? null, clubRank: p.tier ?? null, bandDiffers };
}

// Exported for the tests (D137): the verdict is a claim about a real player's real placement, so the
// rule that decides it is asserted directly rather than only through a rendered page.
// `espnScheme` is the formation ESPN itself files this club under (espnSchemeOf above); it decides
// what ESPN's own codes MEAN. It defaults to the club's scheme, which is the right answer whenever the two
// agree — 31 of 32 clubs today — so a caller that has only one scheme to give is unchanged.
export function espnDisagrees(p, slotBand, scheme, labelSource, espnScheme = scheme) {
  if (!p.espnSlot) return false;
  // A tier of 0 is not a rank: it is the sentinel starters.js stamps on a man it INSERTED onto line one from
  // the roster because today's chart does not list him at all (D61), and a null tier is the same for a reserve
  // second-stringer appended at the bottom. Neither number came from a chart, so neither can disagree with
  // ESPN's; comparing them rang the dashed ring on every out starter in the league (ATL's Walker and Pearce,
  // ATL's Tua, and so on) to report a difference that was an artefact of our own bookkeeping.
  const rankDiffers = p.espnRank != null && p.tier > 0 && p.espnRank !== p.tier;
  if (BODY_DERIVED.has(labelSource)) return rankDiffers;
  const key = String(p.espnSlot).toLowerCase();
  if (ESPN_END_CODES.has(key) && FRONT_BANDS.has(slotBand)) return rankDiffers;
  const mapped = mapEspnSlotToBand(p.espnSlot, espnScheme);
  if (mapped) return mapped !== slotBand || rankDiffers;
  return rankDiffers; // can't map this ESPN code to a band -> fall back to the rank comparison alone
}

function tooltipFor(p, disagrees) {
  const bits = [p.name];
  // D61 (review finding 5): the greyed extra row at the bottom of a slot is not just another backup - he is
  // the man who WAS the second-stringer here and is now on a reserve list. The row itself has no space to
  // say that, so the tooltip does.
  if (p.reserveBackup) bits.push("Second-stringer here, on reserve");
  if (p.status?.shortComment) bits.push(p.status.shortComment);
  if (p.status?.returnDate) bits.push(`Return: ${p.status.returnDate}`);
  if (p.weekOneNote) bits.push(p.weekOneNote);
  if (disagrees) bits.push(`ESPN lists him at ${p.espnSlot}${p.espnRank ? ` #${p.espnRank}` : ""}`);
  return esc(bits.join(" · "));
}

// D50, corrected (Adam, 2026-09-11): "when I say highlight I just mean the eye gets drawn to it... not
// HEY WE'RE HIGHLIGHTING THIS" — quiet glyphs, not badges/chips; the real detail lives in the tooltip
// (and the panel). Guarded: a card with no `signals` array renders nothing extra.
const SIGNAL_GLYPH = { STAR_OUT: "★", PROMOTED: "▲", NEW_ARRIVAL: "●", LOW_SNAPS: "◐" };
const SIGNAL_TITLE = {
  STAR_OUT: "A notably higher-rated player at this spot is out",
  PROMOTED: "Promoted on the depth chart",
  NEW_ARRIVAL: "New arrival on this roster",
  LOW_SNAPS: "Low recent snap share",
};
// D148 (3): the part-time marker covers two different facts and the tooltip must say WHICH. A measured share
// under the threshold is "low recent snap share"; the other case is the snap-count source having no row for him
// at all while it has rows for his team-mates, which says nothing about how much he played (Riq Woolen wore the
// glyph after playing every defensive snap of week 1). server/compile/heat.js decides which and writes it on
// the card as lowSnapsReason ("LOW_SHARE" / "NO_ROW"); the signal stays LOW_SNAPS so the glyph, the CSS and
// D135's give-up order are unchanged. Exported because the group view (public/js/zoom.js) draws the same
// marker and must say the same thing — two copies of one sentence is how two views come to word it differently.
export const NO_SNAP_ROW_TITLE = "No snap count on file for him (the source has no row)";
const signalTitle = (s, p) => (s === "LOW_SNAPS" && p?.lowSnapsReason === "NO_ROW" ? NO_SNAP_ROW_TITLE : SIGNAL_TITLE[s] || s);
// Rendered as its own sibling in a fixed top-left corner (same corner zoom.js's group view uses via its
// own .zoom-signals), not inside .card-name, so the glyph never competes with the name for width and
// stays visible regardless of name length.
function signalGlyphs(p) {
  const sig = Array.isArray(p.signals) ? p.signals : [];
  if (!sig.length) return "";
  return `<span class="prow-signals">${sig.map((s) => `<span class="signal-glyph sig-${esc(s)}" title="${esc(signalTitle(s, p))}">${SIGNAL_GLYPH[s] || "•"}</span>`).join("")}</span>`;
}

// ---- ruling E: the whole-team overview's text rows ------------------------------------------------

// The rating as it appears on an overview row: just the number, coloured by its tier, because a 156px
// column has no room for "89 OVR · #4 DT" as well as a jersey number and a real name. Nothing is lost —
// the full rank rides in the row's own tooltip (see overviewTitle) and on the card in every zoomed-in
// view, which is where D15's "88 OVR, #4 RB" line is actually read.
function overviewOvr(rating, cls) {
  const v = rating?.current;
  // An unrated player has no Madden entry; show a muted "NR" rather than a hole, so the column still reads
  // as a solid ranked list. The same treatment is used in every other view.
  if (v == null) return `<span class="prow-ovr ${cls} prow-ovr-none" title="Not rated — no Madden entry for this player">NR</span>`;
  return `<span class="prow-ovr ${cls}">${esc(v)}</span>`;
}

// The tooltip carries everything the shrunken row cannot: the full name, the Madden line with its
// positional rank, the injury prose and return date, and the Week-1/ESPN-disagrees notes.
export function overviewTitle(p, disagrees) {
  const bits = [p.name];
  if (p.rating?.current != null) {
    bits.push(p.rating.posRank && p.rating.posCount ? `${p.rating.current} OVR · #${p.rating.posRank} ${p.rating.maddenPos || ""}`.trim() : `${p.rating.current} OVR`);
  }
  if (p.role === "STARTER_OUT" || p.role === "ACTIVE") bits.push(p.role === "ACTIVE" ? "Filling in" : "Opening starter, out");
  if (p.status?.label) bits.push(p.status.label);
  if (p.status?.detail) bits.push(p.status.detail);
  if (p.status?.shortComment) bits.push(p.status.shortComment);
  if (p.status?.returnDate) bits.push(`Return: ${p.status.returnDate}`);
  if (p.weekOneNote) bits.push(p.weekOneNote);
  // D150: the card's share is pooled from the snap counts wherever the file establishes his club's own totals
  // for those games, and the average of the source's per-game percentages where it does not. The weaker figure
  // says so wherever it shows; the pooled one needs no footnote.
  if (p.snapShare != null) bits.push(`${Math.round(p.snapShare * 100)}% of snaps${p.snapShareMethod === "source-mean" ? " (average of the source's per-game percentages)" : ""}`);
  if (disagrees) bits.push(`ESPN lists him at ${p.espnSlot}${p.espnRank ? ` #${p.espnRank}` : ""}`);
  return esc(bits.join(" · "));
}

function overviewClasses(p, base) {
  const cls = [base, ratingTier(p.rating)];
  if (isFullyOut(p)) cls.push("prow-out");
  if (p.shaded) cls.push("prow-shaded");
  if (p.role === "ACTIVE") cls.push("prow-active");
  if (p.coStarter) cls.push("prow-costarter");
  return cls.join(" ");
}

// Row one of a column is whichever man the club's own tier order (D90) puts first — that is not always
// the actual starter, so line-one bold/photo/pill treatment is gated on the man's actual role: a real
// STARTER, a STARTER_OUT (still the starter, just hurt — D44's banner still belongs to him), an ACTIVE
// fill-in, or either half of a co-starter pair reads as the starter; a plain BACKUP who merely has nobody
// ranked above him reads in the same weight the rows below line one use.
function isLineOneStarter(p) {
  return p.role === "STARTER" || p.role === "STARTER_OUT" || p.role === "ACTIVE" || p.coStarter === true;
}

// The starter's bold row: jersey number, full name, any badges, and the tier-coloured rating. A fully-
// out starter or an ACTIVE fill-in gets D44's banner strip stacked on top of the same row, which is the
// BANNER_H field.js reserves for it — so "who is out, and how good is the man replacing him" still reads
// straight down the column, just in two lines of text instead of two photographs.
// D72: `opts.style.headshot` is the one difference between a whole-team row and an offense/defense-page
// row — the same renderer, gated by an option, never a second card type. It is only ever set on the line-
// one row, because that is the man the page is about and the only row with the height to carry a photo.
function overviewLineOne(p, teamAbbr, opts = {}) {
  const style = opts.style || {};
  // D142 (Adam, 2026-09-17): "ESPN lists him elsewhere can appear in his player card, don't think it's
  // necessary to see on the main page." The dashed teal ring is gone from every page; the verdict survives
  // in this row's own tooltip and, in full words, in the player panel (panel.js's espnPlacementLine).
  const disagrees = espnDisagrees(p, opts.band, opts.scheme, opts.labelSource, opts.espnScheme);
  // No role tag here: on the overview the bold top row IS the starter, and an out or filling-in player
  // says so on his own banner.
  const badges = [
    isFullyOut(p) ? "" : statusBadge(p.status),
    psBadge(p),
    slotBadge(p, opts),
    weekOneChip(p.weekOneNote),
    alsoListedChips(p, opts.slotLookup, opts.ownLabel),
  ].join("");
  // The banner sits INSIDE this anchor, inset from its edges (.prow-one .card-banner in styles.css), and
  // a bannered row takes the banner's own colour on its border, so it unmistakably belongs to the man
  // underneath it rather than reading as a divider between two rows.
  // D138: the phone list draws these same rows with a photo the LAYOUT never reserved (it is a CSS flow
  // there, not a scaled canvas), and only for a man over the rating floor — so the size and the floor may
  // come from the caller as well as from the layout style. Without `opts.headshot` this is exactly what it
  // was: the photo the layout reserved, or none.
  const headSize = opts.headshot?.size ?? style.headshot;
  const photo = headSize ? headshotHtml(p, headSize, opts.headshot || {}) : "";
  const head = photo ? `<span class="prow-head">${photo}</span>` : "";
  // `column-no-starter` (see isLineOneStarter above) keeps the exact same box — same tag, same classes
  // otherwise, same inline min-height straight off field.js's lineOneHeight — so the column's height and
  // everything stacked under it (the pass-catcher cluster included) sits exactly where the layout engine
  // already reserved it; only styles.css's bold/photo-pill treatment is switched off for this row.
  const starterCls = isLineOneStarter(p) ? "" : " column-no-starter";
  // `.prow-info` wraps everything but the headshot; `.prow-main` wraps everything but the D91 snap trio.
  // Both stay `display:contents` in CSS for every row family without a headshot, so this changes nothing
  // there. Only `.prow-one:has(.prow-head)` (styles.css) turns `.prow-info` into a two-line stack — trio
  // under the pill — so a long name on a headshot row keeps its full row width instead of eating into the
  // trio's space. CSS alone can't single out "every flex item but the first" without these wrapper spans,
  // so cards.js has to add them.
  return `<a class="${overviewClasses(p, "prow prow-one")}${starterCls}" href="#/team/${esc(teamAbbr)}/player/${encodeURIComponent(p.playerKey)}" data-player-key="${esc(p.playerKey)}" title="${overviewTitle(p, disagrees)}" style="min-height:${lineOneHeight(p, style)}px">
    ${bannerHtml(p)}
    <span class="prow-line">
      ${head}
      <span class="prow-info">
        <span class="prow-main">
          <span class="prow-num">#${esc(p.number ?? "—")}</span>
          <span class="prow-name" data-full="${esc(p.name)}" data-short="${esc(shortName(p))}">${esc(p.name)}</span>
          ${signalGlyphs(p)}
          <span class="prow-badges">${badges}</span>
          ${overviewOvr(p.rating, ratingTier(p.rating))}
        </span>
        ${snapHistoryHtml(p, opts)}
      </span>
    </span>
  </a>`;
}

// A slim backup row: number, name, rating. The name drops to "F. Last" as soon as a badge competes with
// it for the width (D37b — the row that matters most must stay readable).
// D104: `opts.outRail` marks the demoted OUT starter now sitting at the BOTTOM of his column. He keeps
// this compact weight — he is not the man playing here — but takes D44's red banner strip on top of the
// row at full strength, so the eye still lands on "big injury here" without reading a word. field.js's
// OUT_RAIL_H is the height reserved for that strip; no other depth row ever draws one, so a D61 reserve
// second-stringer who happens to be on IR is unaffected and still renders as a plain greyed row.
function overviewDepth(p, teamAbbr, opts = {}) {
  const badges = [
    psBadge(p),
    slotBadge(p, opts),
    statusBadge(p.status),
    p.role === "ACTIVE" ? `<span class="badge badge-active">FILLING IN</span>` : "",
    weekOneChip(p.weekOneNote),
    alsoListedChips(p, opts.slotLookup, opts.ownLabel),
  ].join("");
  // D135: the row is drawn with the man's FULL name whether or not he wears a badge, and fitOneName decides.
  // Shortening here first makes the abbreviation the "full" text fitNames records, so a badge row reads
  // "A. Sam" with 130px of spare room and D135 can never see it.
  const rail = opts.outRail ? bannerHtml(p) : "";
  const railCls = opts.outRail ? " prow-outrail" : "";
  return `<a class="${overviewClasses(p, "prow")}${railCls}" href="#/team/${esc(teamAbbr)}/player/${encodeURIComponent(p.playerKey)}" data-player-key="${esc(p.playerKey)}" title="${overviewTitle(p, false)}">
    ${rail}
    <span class="prow-line">
      <span class="prow-num">#${esc(p.number ?? "—")}</span>
      <span class="prow-name" data-full="${esc(p.name)}" data-short="${esc(shortName(p))}">${esc(p.name)}</span>
      <span class="prow-badges">${badges}</span>
      ${overviewOvr(p.rating, ratingTier(p.rating))}
      ${snapHistoryHtml(p, opts)}
    </span>
  </a>`;
}

// The "+N more" tail that replaces the last visible slim row when a slot runs deeper than the cap
// (D23 keeps the whole roster in the data, so this is common). It links to that band's group view,
// which is exactly the screen that shows every player at the position stacked 1, 2, 3… (D45).
function overviewMore(n, teamAbbr, band) {
  return `<a class="prow prow-more" href="#/team/${esc(teamAbbr)}/group/${esc(String(band || "").toLowerCase())}" title="See all ${n} more players at this position">+${n} more</a>`;
}

// D134's reduced state instead EXPANDS the column in place, so the tail is the same `.depth-more` button and
// `.depth-extra` span the group view already uses (wireDepthToggles drives both); the rows behind it are
// rendered, just not displayed, so expanding costs no re-render and loses no open panel or scroll position.
function depthMoreChip(rowsHtml, n) {
  return `<button type="button" class="prow-more depth-more" aria-expanded="false" title="Show the other ${n} players in this column">+${n} more</button><span class="depth-extra">${rowsHtml}</span>`;
}

// One compact 40px row for a backup stacked below (offense) or above (defense) the line-one card. Falls
// back to "F. Last" whenever a badge/chip is present — that's exactly when the full name doesn't fit
// (D37b: the fill-in row is the most important row on the chart and must stay readable). Every row also
// shows its own OVR at the right edge (D44 — Adam: "how good was the hurt player and how good is his
// backup" should be readable straight down the column, not just on the line-one card).
export function compactRow(p, teamAbbr, opts = {}) {
  const title = tooltipFor(p);
  const badgesHtml = [
    psBadge(p),
    slotBadge(p, opts),
    statusBadge(p.status),
    p.role === "ACTIVE" ? `<span class="badge badge-active">ACTIVE</span>` : "",
    weekOneChip(p.weekOneNote),
    alsoListedChips(p, opts.slotLookup, opts.ownLabel),
  ].join("");
  // D135, same rule as overviewDepth above: the full name is drawn and fitOneName decides, so a badge never
  // costs a name that had room. fitNames fits `.row-name[data-short]` as well as `.prow-name`.
  // "NR" rather than a dash for a player with no Madden entry — the same word every other view uses, so a
  // reader never has to work out whether a rating is missing or merely not rendered.
  const ovr = p.rating?.current ?? "NR";
  // D61 (Adam, 2026-09-15): a depth row for a man who will not play — the second-stringer on IR/PUP/NFI/
  // suspension that D61 puts at the bottom of his slot, and any other out backup — greys out the same way
  // an out line-one row already does (.prow-out), so the eye reads "he is not available" without reading
  // the badge. His rating pill keeps its colour: the whole point of showing him is "how good is the man
  // this unit is missing".
  const outCls = isFullyOut(p) ? " row-out" : "";
  return `<a class="row ${ratingTier(p.rating)}${outCls} ${p.shaded ? "row-shaded" : ""}" href="#/team/${esc(teamAbbr)}/player/${encodeURIComponent(p.playerKey)}" data-player-key="${esc(p.playerKey)}" title="${title}">
    <span class="row-number">#${p.number ?? "—"}</span>
    <span class="row-name" data-full="${esc(p.name)}" data-short="${esc(shortName(p))}">${esc(p.name)}</span>
    ${badgesHtml}
    <span class="row-ovr${p.rating?.current == null ? " row-ovr-none" : ""}">${esc(ovr)}</span>
    ${snapHistoryHtml(p, opts)}
  </a>`;
}

// Shared "slot body" renderer: every view that shows a stack of players under one slot label — this
// file's own renderColumn below (whole-team field), zoom.js's side view, and matchup.js — renders a
// co-starter pair or a STARTER_OUT+ACTIVE fill-in as two full-size "big" cards (D44: the two ratings sit
// directly one above/beside the other), and everything else as one big starter card plus a compactRow
// (40px) for every player behind him — never another stacked full card, so a deep column stays a
// scannable ranked list instead of ballooning the page height. `renderBig(player, teamAbbr, opts)` is the
// caller's own big-card renderer (zoom.js's fullCard, matchup.js's matchupCard — each a different
// size/shape). The whole-team field no longer comes through here: ruling E gave it its own text-row
// renderer, overviewLineOne above. `opts.pairOpts` (optional) lets a caller size a co-starter pair
// differently from a lone starter; every other caller can omit it and both cases share the same opts.
export function renderSlotBody(players, teamAbbr, renderBig, opts = {}) {
  const hasCoPair = players.length >= 2 && players[0].coStarter && players[1].coStarter;
  const hasOutFillIn = !hasCoPair && players.length >= 2 && isFullyOut(players[0]) && players[1].role === "ACTIVE";
  if (hasCoPair || hasOutFillIn) {
    const rest = players.slice(2);
    // A slot that draws TWO big cards (a co-starter pair, or D44's out starter above his ACTIVE fill-in)
    // is already the tallest thing in its level, so it gets a tighter depth cap than a one-card slot -
    // `maxDepthPaired` (ruling E; HOU's offense, with an out receiver AND an out right tackle, is what
    // needed it). Callers that set neither cap are unchanged: every backup still renders.
    const restHtml = renderDepth(rest, teamAbbr, opts, opts.maxDepthPaired ?? opts.maxDepth);
    if (hasCoPair) {
      const pairOpts = opts.pairOpts || opts;
      return `<div class="costarter-pair">${renderBig(players[0], teamAbbr, pairOpts)}${renderBig(players[1], teamAbbr, pairOpts)}</div>${restHtml}`;
    }
    return `${renderBig(players[0], teamAbbr, opts)}${renderBig(players[1], teamAbbr, opts)}${restHtml}`;
  }
  const [first, ...rest] = players;
  return `${first ? renderBig(first, teamAbbr, opts) : ""}${renderDepth(rest, teamAbbr, opts, opts.maxDepth)}`;
}

// RULING E (Adam, 2026-09-13): the side view has to fit a 900px-tall window with up to four levels
// stacked in it, and an eight-deep position group is what blows that budget. `opts.maxDepth` caps the
// visible backup rows; the rest collapse behind a "+N more" button that expands them in place on click
// (wireDepthToggles below). Callers that pass no maxDepth are unchanged — every backup still renders.
function renderDepth(rest, teamAbbr, opts, maxDepth) {
  const max = maxDepth ?? Infinity;
  const row = (p) => compactRow(p, teamAbbr, opts);
  if (rest.length <= max) return rest.map(row).join("");
  const shown = rest.slice(0, max);
  const hidden = rest.slice(max);
  return `${shown.map(row).join("")}<button type="button" class="depth-more" aria-expanded="false">+${hidden.length} more</button><span class="depth-extra">${hidden.map(row).join("")}</span>`;
}

// One delegated listener per rendered view for every "+N more" button on it. Expanding is purely visual
// (a class toggle), so it never re-renders and never loses the page's scroll position or the open panel.
export function wireDepthToggles(root) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".depth-more");
    if (!btn || !root.contains(btn)) return;
    e.preventDefault();
    const extra = btn.nextElementSibling;
    if (!extra?.classList.contains("depth-extra")) return;
    const open = extra.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", String(open));
    btn.textContent = open ? "show less" : `+${extra.childElementCount} more`;
    // A row inside a CLOSED `.depth-extra` measures 0 wide, so it is never fitted and would open showing an
    // abbreviation (or an ellipsis) whatever room it had. Fit it now that it has a real box.
    if (open) fitNames(extra);
  });
}

// A compact row's name overflowing its column swaps to the same "F. Surname" form the badge-crowded rows
// use — a real abbreviation rather than a mid-word ellipsis truncation. Measured rather than guessed from
// a character count, because the column width varies with the spread factor field.js chose for that team
// and window. Called after mount and again once webfonts settle, since the metrics change when the real
// font arrives.
// D73: measured with a Range, not scrollWidth. scrollWidth is an INTEGER, so a name needing e.g. 100.4px
// in a 100px box reports 100 > 100 — false — and the abbreviation never fires even though the browser is
// already drawing an ellipsis. A Range over the text reports the true sub-pixel width, and comparing it
// against the element's own rect keeps both numbers in the same coordinate space (the field sits inside a
// CSS transform, which scales rects but not scrollWidth). scrollWidth stays as the fallback where Range is
// unavailable.
function textOverflows(el) {
  const avail = el.getBoundingClientRect().width;
  if (typeof document.createRange !== "function" || !avail) return el.scrollWidth > el.clientWidth + 1;
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width > avail + 0.5;
}

// D135 (Adam, 2026-09-17): what a row gives up, in order, before its name is touched. The part-time marker
// goes first (the ◐ glyph that says this man plays a low share of the snaps), then the other quiet signals,
// then the purely descriptive chips. The rating pill, the status badges (Q/D/OUT/IR/PUP/SUSP/INACTIVE), the
// PS badge and the D91 snap trio are NOT on this list: each is a fact about whether and how much the man
// plays, which is what the row is for.
export const ROW_GIVE_UPS = [".sig-LOW_SNAPS", ".signal-glyph", ".chip-ghost", ".chip-wk1", ".badge-slot"];

// The three spacing states a row can be in, cheapest first. "normal" is the row as drawn; "tight"
// (`prow-tight`) drops the jersey number's reserved gutter and the wide gaps around it; "tighter"
// (`prow-tighter`) also takes the row's own 4-unit side padding down to 2.
export const ROW_SPACING = ["normal", "tight", "tighter"];

// D135's ladder, as a list of states rather than as control flow: what a row is allowed to spend, in order,
// before its name is cut, and what it may spend after. Pure and exported so the ORDER is pinned by a test
// instead of only by reading the DOM code below — the order IS the ruling, and it can look right in the code
// while behaving wrong.
//
// THE ORDER IS: the full name at normal spacing; the full name tightened; the full name after giving up each
// kind of quiet extra in turn; the full name at the tightest spacing there is — and only when all of that has
// failed, the short "F. Surname" form, which then starts again from the top (D146 (3): a shortened name gets
// its gutter and its part-time marker back, so it is never printed in a squeezed row with 30-65px of the row
// still idle). Spacing is spent before the name, and every rung is re-measured rather than guessed.
export function nameLadder({ giveUps = ROW_GIVE_UPS, hasShort = false } = {}) {
  const rungs = [];
  for (const name of hasShort ? ["full", "short"] : ["full"]) {
    rungs.push({ name, spacing: "normal", gave: 0 });
    for (let gave = 0; gave <= giveUps.length; gave++) rungs.push({ name, spacing: "tight", gave });
    rungs.push({ name, spacing: "tighter", gave: giveUps.length });
  }
  return rungs;
}

// Walks that ladder against one live row, stopping at the first rung whose name fits. A row whose name
// already fits is left in the state it is already in — no class write at all — so a page with no cut names
// costs one measurement per row and wakes nothing that observes the field.
function fitOneName(row, el) {
  // An emptied wrapper still costs the row a flex gap, so it goes with the last thing inside it.
  const dropEmptyWrappers = () => {
    for (const w of row.querySelectorAll(".prow-signals, .prow-badges")) {
      const live = [...w.children].some((c) => !c.classList.contains("prow-given-up"));
      w.classList.toggle("prow-given-up", !live);
    }
  };
  // Every element the row is allowed to hand over, found once. THE LIST OVERLAPS ON PURPOSE — the part-time
  // marker is `class="signal-glyph sig-LOW_SNAPS"`, so it is matched by the first selector and again by the
  // second — which is why a rung is applied as a SET rather than selector by selector: toggling each selector
  // in turn would have the second rung hand the part-time marker straight back to the row.
  const candidates = [...new Set(ROW_GIVE_UPS.flatMap((sel) => [...row.querySelectorAll(sel)]))];
  // Puts the row into exactly the state one rung describes, and answers whether anything actually moved. A
  // rung that changes nothing cannot change the answer either, so the caller skips re-measuring it — which
  // is what keeps the common case (a row with no extras to give up, so most of the middle rungs are no-ops)
  // to the same handful of measurements it always took.
  const applyRung = ({ name, spacing, gave }) => {
    let moved = false;
    const text = name === "short" ? el.dataset.short : el.dataset.full;
    if (el.textContent !== text) { el.textContent = text; moved = true; }
    for (const [cls, on] of [["prow-tight", spacing !== "normal"], ["prow-tighter", spacing === "tighter"]]) {
      if (row.classList.contains(cls) !== on) { row.classList.toggle(cls, on); moved = true; }
    }
    const handed = new Set();
    for (let i = 0; i < gave; i++) for (const n of row.querySelectorAll(ROW_GIVE_UPS[i])) handed.add(n);
    for (const n of candidates) {
      const on = handed.has(n);
      if (n.classList.contains("prow-given-up") !== on) { n.classList.toggle("prow-given-up", on); moved = true; }
    }
    if (moved) dropEmptyWrappers();
    return moved;
  };

  const hasShort = !!(el.dataset.short && el.dataset.short !== el.dataset.full);
  let measured = false;
  for (const rung of nameLadder({ hasShort })) {
    const moved = applyRung(rung);
    // The first rung is always measured (it is the question "does this row need anything at all?"); after
    // that only a rung that actually moved something is worth a measurement.
    if (!moved && measured) continue;
    measured = true;
    if (!textOverflows(el)) return;
  }
}

// `.row-name` (the 40px compactRow the side, group and matchup card views draw) is fitted by the same pass —
// it draws the full name too, so without this a badge row would simply ellipsise.
export function fitNames(root) {
  for (const el of root.querySelectorAll(".prow-name[data-short], .row-name[data-short]")) {
    el.dataset.full = el.dataset.full ?? el.textContent;
    const row = el.closest(".prow, .row");
    if (row) fitOneName(row, el);
  }
}

// Renders one whole column (a Slot) — the line-one card(s) plus any stacked compact rows — inside
// its already-computed box {x, top, height, width}. `align` is "top" (offense: starter first, backups
// below) or "bottom" (defense: starter nearest the line of scrimmage, backups stacked above it).
// D50 (a compile builder is adding slot.injury alongside this build): guarded for absence — a team
// whose compile hasn't been re-run since that field shipped simply renders no heat tint at all.
const HEAT_CLASS = { low: "heat-low", high: "heat-high", critical: "heat-critical" };
function heatTitle(injury) {
  if (!injury?.outStarter) return "";
  const { name: outName, ovr: outOvr } = injury.outStarter;
  const fillIn = injury.fillIn;
  if (!fillIn) return `Starter out: ${outName}${outOvr != null ? ` ${outOvr}` : ""}`;
  const delta = outOvr != null && fillIn.ovr != null ? outOvr - fillIn.ovr : null;
  const deltaStr = delta != null ? ` (${delta >= 0 ? "−" : "+"}${Math.abs(delta)})` : "";
  return `Starter out: ${outName}${outOvr != null ? ` ${outOvr}` : ""} → ${fillIn.name}${fillIn.ovr != null ? ` ${fillIn.ovr}` : ""}${deltaStr}`;
}

// Ruling E caps a column at MAX_DEPTH_ROWS slim rows and collapses the rest behind "+N more". D61 appends the
// reserve second-stringer as the LAST row of his slot, so an out row now outranks a
// healthy backup for the visible places: the same NUMBER of rows is drawn, so the column height the layout
// engine reserved is untouched; the DEEPEST healthy rows collapse instead, and whatever survives keeps the
// chart's own order. "+N more" still leads to the group view, where every row is shown in full.
// D104 adds a second, stronger claim on those places: the demoted OUT starter now lives at the very BOTTOM
// of his column, which is exactly where the "+N more" tail bites first — so `mustKeep` (the demoted rows,
// handed in by renderColumn) is filled before any other out row, and only then the rest of the chart's own
// order. field.js's shownOutRows does the same "how many places are left once the tail has taken one"
// arithmetic when it reserves the column's height, so the box and this selection stay in step.
function keepOutRowsVisible(depth, n, mustKeep = []) {
  if (n <= 0) return [];
  const keep = new Set(mustKeep.slice(0, n));
  for (const p of depth) { if (keep.size >= n) break; if (isFullyOut(p)) keep.add(p); }
  for (const p of depth) { if (keep.size >= n) break; keep.add(p); }
  return depth.filter((p) => keep.has(p));
}

// D61/D81: a man on a reserve list already wears IR / PUP / NFI / SUSP; a second "PS" badge beside it reads
// as "practice squad", so the PS badge only shows when no reserve badge does. It fires for a game-day
// elevation (off the 53) or for a man who was on any club's practice squad this season and now sits on the
// active roster (server's practiceSquadPromoted) — the tooltip wording tells the two cases apart.
const RESERVE_CODES = new Set(["IR", "PUP", "NFI", "SUSP", "EXEMPT"]);
// D77 (Adam): "Slot" describes the man, not only the column — a player who lines up inside often enough
// wears a small Slot tag wherever he sits.
// D83/D86 (Adam, 2026-09-15): for RECEIVERS that tag is now redundant and gone. Every receiver who qualifies
// stands in the real WR · Slot column (field.js's regroupSlotReceivers), so tagging him there — or
// anywhere else, since he is nowhere else any more — would print the same fact twice. TIGHT ENDS have no
// slot column to move into, so theirs stays, at Adam's 20% bar; no other position carries a rate at all.
export const SLOT_TAG_RATE = { TE: 20 };
const slotTagRate = (p) => (/TE/i.test(p.position || "") ? SLOT_TAG_RATE.TE : null);
export const slotBadge = (p, opts = {}) => { const bar = slotTagRate(p); return (bar != null && typeof p.slotRate === "number" && p.slotRate >= bar && !opts.isSlotColumn
  ? `<span class="badge badge-slot" title="Slot: ${esc(String(p.slotRate))}% of snaps${p.slotSeason ? " (" + esc(String(p.slotSeason)) + ")" : ""}">Slot</span>` : ""); };
export const psBadge = (p, title = true) => {
  if (RESERVE_CODES.has(p.status?.code)) return "";
  if (p.onActiveRoster === false) {
    return `<span class="badge badge-ps"${title ? ' title="Practice squad (game-day elevation, not on the 53)"' : ""}>PS</span>`;
  }
  if (p.practiceSquadPromoted === true) {
    return `<span class="badge badge-ps"${title ? ' title="Practice squad this season, now on the active roster"' : ""}>PS</span>`;
  }
  return "";
};
export function renderColumn(col, teamAbbr, opts = {}) {
  const { slot, x, top, height } = col;
  const players = slot.players;
  const hatched = slot.shadedByDefault ? " column-shaded" : "";
  const heatCls = slot.injury?.level && HEAT_CLASS[slot.injury.level] ? ` ${HEAT_CLASS[slot.injury.level]}` : "";
  const heatTitleText = heatCls ? heatTitle(slot.injury) : "";
  const labelHref = `#/team/${esc(teamAbbr)}/group/${esc((slot.band || "").toLowerCase())}`;
  // col.slotReason (D64): why THIS receiver is the one standing in the slot. On the Slot column it is the
  // D86 sentence naming the men at 35 percent or more of their own snaps inside (50 by D86, 40 by D118, 35 by D163); on a club
  // column it is columnRankReason's sentence, ESPN's rank of the column plus what the club printed (D92/D93).
  // It leads the tooltip because it is the thing a reader actually questions.
  const labelTitle = esc([col.slotReason || "", slot.labelSource ? `source: ${slot.labelSource}` : "", heatTitleText].filter(Boolean).join(" · "));
  // D83: `col.derived` marks a column the LAYOUT built rather than one the club charted (the WR · Slot
  // column). Two men in it may happen to be co-starters of the club columns they came from, but they are
  // not co-starters of each other, so the "· co-starters" suffix must not follow them into it.
  const pair = players.length >= 2 && players[0].coStarter && players[1].coStarter && !col.derived;
  // Lead ruling (2026-09-11): a co-starter pair is ONE slot with two names on it, not two separate
  // rankings — the column label says so directly instead of leaving it to be inferred from two adjacent
  // STARTER tags.
  // D63: the LAYOUT may override what a column calls itself — the receiver it places in the slot reads
  // "WR · Slot" regardless of his rank (D70: the rank moved into the tooltip, see slotReason in field.js's
  // regroupSlotReceivers), since which man plays inside is the question that row answers. The slot's own label
  // is still the identity everywhere else (the group link, the "also listed at" chips).
  // D143: and the club's own Sam/Mike/Will/Rush word follows the label it qualifies, the way the nickel's
  // "CB · Nickel" does. `ownLabel` below stays the raw slot label, which is what alsoListedChips matches on.
  const baseLabel = withClubRole(col.displayLabel || slot.label, slot);
  const labelText = pair ? `${baseLabel} · co-starters` : baseLabel;
  // D70: the band hue on the pill comes from data-band (styles.css maps it to --band-color), one fixed
  // colour per position group across every team and every view — not the team tint the rest of the pill
  // used to carry alone.
  const label = `<a class="column-label${heatCls}" data-band="${esc(slot.band || "")}" href="${labelHref}" title="${labelTitle}">${esc(labelText)}</a>`;

  // ownLabel: the raw slot label (never the "· co-starters" suffixed labelText above) — it is compared
  // against slotLookup's own return value in alsoListedChips, which resolves OTHER slots' plain labels the
  // same way, so the two must use the identical un-suffixed form.
  // D72: the drawing options travel with the column the layout engine produced (field.js's layoutStyle),
  // so the markup below can no more disagree about the headshot or the depth cap than it already could
  // about the row count — both come from the same object the reserved box was measured with.
  const style = col.style || {};
  // D91: col.unit (field.js's placeRow stamps it from the row) is the one place renderColumn actually
  // knows which side of the ball this column is on — never guessed from the players themselves — so every
  // row renderer below reads the tooltip's "offensive"/"defensive" word off opts.unit rather than each
  // reinventing its own way to ask.
  const colOpts = { ...opts, band: slot.band, ownLabel: slot.label, labelSource: slot.labelSource, style, isSlotColumn: /Slot/.test(col.displayLabel || ""), unit: col.unit };

  // Ruling E: bold line-one row(s) — one starter normally, two for a co-starter pair or for D44's
  // OUT-starter-plus-ACTIVE-fill-in — then up to MAX_DEPTH_ROWS slim rows, the last of which becomes a
  // "+N more" tail when the slot runs deeper. lineOneCount/visibleDepthRows come from field.js so the
  // markup below can never disagree with the box height the layout engine reserved for it.
  // D104: the rows are drawn in field.js's displayOrder, which moves a fully-out starter who has an ACTIVE
  // fill-in behind him to the BOTTOM of the column — the fill-in leads, the backups follow, the out man
  // brings up the rear still wearing his red rail. `players` itself is never reordered, so everything that
  // asks "who is the starter of record here" still reads the compiled players[0].
  const ordered = displayOrder(players);
  const bold = lineOneCount(players);
  const depth = ordered.slice(bold);
  const demoted = outFillInDemotion(players);
  const outRows = demoted ? depth.slice(depth.length - demoted) : [];
  const railed = new Set(outRows);
  const depthRow = (p) => overviewDepth(p, teamAbbr, p && railed.has(p) ? { ...colOpts, outRail: true } : colOpts);
  let shownRest, shownOut, tail;
  if (style.depthChip) {
    // D134's reduced state: one backup per column plus the chip, and the OUT rail, the fill-in and the
    // co-starters are all still drawn — the rail and the fill-in are never candidates for collapsing
    // (the rail rides behind the cap, the fill-in and co-starters are line-one rows, D104/D56).
    const cap = style.maxDepthRows ?? 1;
    const ordinary = depth.filter((p) => !railed.has(p));
    // The one visible backup is the first man who can actually PLAY this week, not merely the first man
    // listed — an OUT/INACTIVE/SUSP row there answers "who is behind him" with a man who is not.
    // Order is otherwise untouched, so the hidden men stay behind the chip in the chart's printed order,
    // and the COUNT is unchanged (field.js's depthPlan reserves the same box either way).
    const lead = ordinary.findIndex((p) => !isFullyOut(p));
    const ranked = lead > 0 ? [ordinary[lead], ...ordinary.filter((_, i) => i !== lead)] : ordinary;
    shownRest = ranked.slice(0, cap);
    shownOut = outRows;
    const hidden = ranked.slice(cap);
    tail = hidden.length ? depthMoreChip(hidden.map(depthRow).join(""), hidden.length) : "";
  } else {
    const visible = visibleDepthRows(players, style.maxDepthRows);
    const hiddenCount = depth.length - visible;
    const shownDepth = hiddenCount > 0 ? keepOutRowsVisible(depth, Math.max(visible - 1, 0), outRows) : depth;
    // The "+N more" tail stands for the healthy depth that was collapsed, so it belongs with that depth —
    // above the out man, not under him. Printing it last would put a dotted "+2 more" line beneath the red
    // rail and cost the ruling the one thing it is for: the bottom of the column is the injury.
    shownOut = shownDepth.filter((p) => railed.has(p));
    shownRest = shownDepth.filter((p) => !railed.has(p));
    tail = hiddenCount > 0 && visible > 0 ? overviewMore(depth.length - shownDepth.length, teamAbbr, slot.band) : "";
  }
  const body = [
    ...ordered.slice(0, bold).map((p) => overviewLineOne(p, teamAbbr, colOpts)),
    ...shownRest.map(depthRow),
    tail,
    ...shownOut.map(depthRow),
  ].join("");

// Ruling B (Adam, 2026-09-13): "put the backup boxes under the starters." Every column, offense and
  // defense alike, now reads straight down — label, starter, backups — so there is no reversed stacking
  // direction and no `--align` any more; the old `.column-stack.stack-reverse` is gone from styles.css.
  // opts.colourStyle lets a caller push its own --team-primary/--team-secondary onto this one column:
  // the matchup view draws two different teams on one field, so the wash cannot come from a single
  // wrapper. It is concatenated INTO the style attribute, never added as a second one - a duplicate
  // `style` is silently dropped by the browser, which took every column's left/top with it.
  const colourStyle = opts.colourStyle ? `${opts.colourStyle};` : "";
  // D103: `column-compact` is the whole-team/matchup row family — the one that draws no headshot and whose
  // type scale went up 15% with the wider card. The side pages (D72) draw headshots and keep their own
  // sizes, so styles.css scopes every new size under this class rather than changing the shared base rules.
  // The test is the same `style.headshot` field field.js's layoutStyle keys the slim-row height off, so the
  // markup and the reserved box can never end up in different families.
  const compact = style.headshot ? "" : " column-compact";
  return `<div class="column${compact}${hatched}${heatCls}" data-slot-id="${esc(slot.slotId)}" style="${colourStyle}left:${x - col.width / 2}px;top:${top}px;width:${col.width}px;height:${height}px">
    ${label}
    <div class="column-stack">${body}</div>
  </div>`;
}

// Renders the small strip of players carried on the roster but absent from the chart (unlisted role),
// positioned against that specific band's own columns (left edge aligned to the band's first column,
// width spanning to its last) rather than the whole row, with the row's own tray gap keeping it clear
// of the deepest depth row above/below it.
export function renderTray(tray, teamAbbr) {
  // D91: a tray chip carries no rating pill for the trio to sit "beside", so it sits beside the name
  // instead — tray.unit (renderColumn's own colOpts.unit source: field.js stamps both from the same
  // row.unit) is read the same way every other renderer here reads it, never guessed from the entry.
  const chips = (entries) => (entries ?? []).map((p) => {
    const badge = psBadge(p, false);
    return `<a class="tray-chip" href="#/team/${esc(teamAbbr)}/player/${encodeURIComponent(p.playerKey)}" data-player-key="${esc(p.playerKey)}" title="Carried on the roster but not on the club depth chart">
      #${esc(p.number ?? "—")} ${esc(p.name)}${badge ? " " + badge : ""}${snapHistoryHtml(p, { unit: tray.unit })}
    </a>`;
  }).join("");
  // The tray carries its band's name. It normally hangs under that band's own columns so the name is
  // obvious, but a band with nothing charted has no row of its own (field.js collapses it) and its tray is
  // re-homed onto a neighbouring row — at which point the name is the only thing saying these are, say, the
  // edge rushers rather than more defensive linemen.
  // D70: the NAME, not the internal code, so the tray label stays consistent with the column pill above it.
  //
  // D144: one of D111/D141's merged rows can be the home of two bands' spare men at once (New Orleans charts
  // a spare corner and a spare safety under its one SECONDARY row). field.js hands those over as ONE strip
  // carrying a `groups` list rather than two strips stacked under the row, so each band prints its own small
  // label inside the strip, in front of its own men: "not on chart · CB  #29 …  · Safety  #40 …". A strip
  // serving one band has no `groups` and renders exactly as it always did.
  const body = tray.groups?.length
    ? tray.groups.map((g, i) => `<span class="tray-label">${i ? "· " : "not on chart · "}${esc(bandDisplay(g.band))}</span>${chips(g.entries)}`).join("")
    : `<span class="tray-label">${tray.band ? `not on chart · ${esc(bandDisplay(tray.band))}` : "not on chart"}</span>${chips(tray.entries)}`;
  // data-unit so a click on one of these chips can be attributed to the right TEAM: the matchup view
  // draws two teams on one field, and a tray is not inside a `.column`, so it is the only thing that can
  // say which half of the ball it belongs to.
  return `<div class="tray${tray.homed ? " tray-homed" : ""}" data-unit="${esc(tray.unit || "")}" style="left:${tray.left}px;width:${tray.right - tray.left}px;top:${tray.top}px;height:${tray.bottom - tray.top}px">
    ${body}
  </div>`;
}

/* D156 (Adam, 2026-09-18): a two-sided field says which half is which with a pair of words etched into the
   turf — wide-tracked caps in stroke-only white with a faint wash of the club's own colour, at about a
   starter's type size, painted BEHIND the cards like the crest watermark rather than typeset on top of
   them. It lives here, with the other shared render helpers, because the whole-team field (team.js) and
   the matchup field (matchup.js) draw the identical mark from the identical rule; neither owns it.
   Everything below is drawing, never layout: the words go in the watermark layer, absolutely positioned,
   so no box moves and no fit scale changes. */
const TAG_SIZE = 21;   // canvas px: small — about a starter's name and a half — but faint ink needs the size to read
const TAG_PAD = 14;    // clear turf demanded left and right of the word
const TAG_PAD_Y = 8;   // and above and below it

function tagBox(word, cx, cy) {
  // The drawn word's box in canvas units (caps at TAG_SIZE with .3em tracking), plus the clear turf around it.
  const w = word.length * TAG_SIZE * 1.02;
  const h = TAG_SIZE * 1.25;
  return { left: cx - w / 2 - TAG_PAD, right: cx + w / 2 + TAG_PAD, top: cy - h / 2 - TAG_PAD_Y, bottom: cy + h / 2 + TAG_PAD_Y, cx, cy, w, h };
}

// Every drawn thing on the canvas, as rectangles: a column carries its own OUT rails and depth cards
// inside its height, and a tray already states its own box, so these two lists are the whole field.
function obstacleRects(layout) {
  const cols = layout.columns.map((c) => ({ left: c.x - c.width / 2, right: c.x + c.width / 2, top: c.top, bottom: c.top + c.height }));
  const trays = (layout.trays || []).map((t) => ({ left: t.left, right: t.right, top: t.top, bottom: t.bottom }));
  return cols.concat(trays);
}

function tagFits(box, rects, layout, bounds) {
  if (box.left < Math.max(8, bounds.minX || 0) || box.right > layout.layoutWidth - 8) return false;
  if (box.top < bounds.top || box.bottom > bounds.bottom) return false;
  return !rects.some((r) => box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top);
}

function tagHtml(word, team, cx, cy) {
  // One ink for every club: the wash inside a half runs from the club's colour at the line of scrimmage to
  // near-black at the sideline, so a "light club" rule (dark ink for New Orleans' gold) vanished wherever
  // the word actually lands. White paint at watermark strength reads on both ends of every club's wash.
  const tint = team?.colourPrimary || "#ffffff";
  return `<div class="matchup-unit-tag" style="left:${Math.round(cx)}px;top:${Math.round(cy)}px;font-size:${TAG_SIZE}px;--tag-tint:${esc(tint)}">${word}</div>`;
}

// Adam's placement ruling (2026-09-18): the two words are a PAIR. They share one horizontal centre out in
// the right-hand turf — past the last front column, short of the sideline — and they MIRROR about the line
// of scrimmage: DEFENSE the same distance above the yellow line as OFFENSE is below it. The distance is
// measured from the line itself, which floats per club (D152), so the pair travels with it. The position is
// searched jointly: every candidate (x, distance) is tested for BOTH words at once against every card, OUT
// rail and tray, and the first clear pair wins — a club whose chart fills the preferred spot steps the pair
// outward together (DEFENSE further up the field, OFFENSE the same distance further down, past the next
// faint band line) and only slides the shared x when no distance at that x works, so the symmetry holds.
// `defTeam` / `offTeam` are the same club on the whole-team page and the two opponents on the matchup page.
const PAIR_X_FRACTION = 0.89;  // share of the canvas width: where the approved render put the words
const PAIR_GAP = 87;           // canvas px from the line of scrimmage to a word's centre, same render
const PAIR_GAP_MIN = 62;       // never closer: the line's own "LINE OF SCRIMMAGE" caption lives in there
export function unitTagsHtml(layout, defTeam, offTeam) {
  if (layout?.losY == null) return ""; // a single-unit side page keeps its own one-word caption instead
  const rects = obstacleRects(layout);
  const W = layout.layoutWidth;
  const bounds = { top: 6, bottom: layout.layoutHeight - 6, minX: W * 0.5 };
  const tries = [];
  for (let xi = 0; xi <= 24; xi++) {
    for (let gi = 0; gi <= 40; gi++) {
      const x = W * PAIR_X_FRACTION + (xi % 2 ? 1 : -1) * Math.ceil(xi / 2) * 10;
      tries.push({ x, gap: PAIR_GAP + gi * 6, cost: xi * 100 + gi });
    }
  }
  tries.sort((a, b) => a.cost - b.cost);
  for (const t of tries) {
    if (t.gap < PAIR_GAP_MIN) continue;
    const def = tagBox("DEFENSE", t.x, layout.losY - t.gap);
    const off = tagBox("OFFENSE", t.x, layout.losY + t.gap);
    if (!tagFits(def, rects, layout, bounds) || !tagFits(off, rects, layout, bounds)) continue;
    return tagHtml("DEFENSE", defTeam, def.cx, def.cy) + tagHtml("OFFENSE", offTeam, off.cx, off.cy);
  }
  return "";
}
