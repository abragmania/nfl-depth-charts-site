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
import { lineOneCount, lineOneHeight, visibleDepthRows, OUT_STATUS_CODES, isFullyOut, isScratch } from "./field.js";
// Re-exported so zoom.js and matchup.js can share the single definition rather than keeping their own
// copies, which had all drifted from it (blue review: every copy was missing INACTIVE and EXEMPT, so a
// game-day inactive starter got no red banner in any view). D60's isScratch rides the same route.
export { OUT_STATUS_CODES, isFullyOut, isScratch };

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

// D70: "position names must read the same everywhere in the project." A band's internal CODE is not its
// name — "NB" and "BACKFIELD" are storage, "CB · Nickel" and "Backfield" are what a reader sees — and the
// two had drifted apart: the tray under a nickel column printed "NOT ON CHART · NB" while the pill over it
// read "CB · Nickel", and zoom.js kept a second copy of the same table for its group pages. This is the
// one table; anything that shows a band to a human reads it (renderTray below, zoom.js's group title and
// nav crumb). An unknown code falls back to itself rather than to a blank.
export const BAND_DISPLAY = {
  QB: "QB", BACKFIELD: "Backfield", WR: "WR", TE: "TE", OL: "OL",
  DL: "DL", EDGE: "EDGE", LB: "LB", CB: "CB", NB: "CB · Nickel", S: "Safety",
};
export const bandDisplay = (band) => BAND_DISPLAY[band] || band || "";

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
// both draw the same circle at different sizes; this used to be a private copy in each file, which is
// exactly the duplication the OUT_STATUS_CODES review found elsewhere. A player with no photo gets his
// initials on a plain disc instead, and a photo that 404s swaps itself for the same disc at runtime.
function initials(p) {
  const a = (p.first || p.name || "?").trim()[0] || "?";
  const b = (p.last || "").trim()[0] || "";
  return (a + b).toUpperCase();
}

export function headshotHtml(p, size) {
  const ini = esc(initials(p));
  const boxStyle = `width:${size}px;height:${size}px`;
  const fallback = `this.replaceWith(Object.assign(document.createElement('div'),{className:'headshot-fallback',textContent:'${ini}',style:'${boxStyle};font-size:${Math.round(size * 0.34)}px'}))`;
  if (!p.headshot) return `<div class="headshot-fallback" style="${boxStyle};font-size:${Math.round(size * 0.34)}px">${ini}</div>`;
  return `<span class="headshot-box" style="${boxStyle}"><img class="headshot" src="${esc(p.headshot)}" alt="" loading="lazy" onerror="${fallback}"></span>`;
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

// 🎨 Polish (2026-09-11, round 2): "also OLB" was wide enough to shove the whole name out of a 40px
// depth row (item 2 — the chip has no shrink limit, so it always rendered at full width while the name
// beside it, the one column Adam actually reads, got squeezed to nothing). Dropping the "also " prefix
// keeps the same information (still a distinct chip, title text unchanged) in roughly half the width.
// 🎨 Polish (2026-09-12, round 3, item 1): a co-starter's alsoListedAt can point at the OTHER slot of the
// same shared band (e.g. PHI's Greenard, paired at EDGE with Hunt, also carries an alsoListedAt entry
// that resolves back to "EDGE" — the very column this card is already rendered under). That rendered as
// a ghost chip repeating the card's own column label right next to it, pure noise. `ownLabel` (the
// card's own slot.label, passed in by renderColumn below) lets this skip any resolved label that matches
// it — a genuinely different column (e.g. "SLOT WR") still shows normally.
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

// ESPN-disagrees ring (integration task 3, 2026-09-11): only shows when ESPN's own placement for this
// player actually differs from the club chart's — either a different band entirely, or a different rank
// within the position. Agreement (e.g. Lane Johnson, ESPN "rt #1", club RT tier 1) must show no ring;
// before this, the ring fired for every player who merely HAD an espnSlot value (nearly everyone in the
// real compiled data), which made it noise instead of a signal.
const ESPN_POS_BAND = {
  lt: "OL", rt: "OL", lg: "OL", rg: "OL", c: "OL",
  wr: "WR", te: "TE", qb: "QB", rb: "BACKFIELD", fb: "BACKFIELD",
  lde: "DL", rde: "DL",
  dt: "DL", nt: "DL", ldt: "DL", rdt: "DL",
  wlb: "LB", slb: "LB", mlb: "LB", lilb: "LB", rilb: "LB",
  lcb: "CB", rcb: "CB", nb: "NB", fs: "S", ss: "S",
};
function mapEspnSlotToBand(espnSlot, scheme) {
  const key = String(espnSlot || "").toLowerCase();
  // D18: a 3-4's outside linebackers are edge rushers; the same code in a non-3-4 context is an off-ball
  // backer instead — everything else in the table is scheme-independent. (Ruling A, which supersedes D14,
  // moved lde/rde to DL above: while they still mapped to EDGE this function reported a disagreement for
  // EVERY 4-3 defensive end, painting the whole line with the dashed "ESPN lists him elsewhere" ring and a
  // tooltip that was simply untrue.)
  if (key === "lolb" || key === "rolb") return scheme === "3-4" ? "EDGE" : "LB";
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
const BODY_DERIVED = new Set(["roster-body", "starter-of-record"]);

function espnDisagrees(p, slotBand, scheme, labelSource) {
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
  const mapped = mapEspnSlotToBand(p.espnSlot, scheme);
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
// 🎨 Polish (2026-09-12, round 3, item 1): this used to sit INSIDE .card-name, right after the player's
// name text — on a long name that already ellipsizes at the card's fixed width (e.g. "Jonathan
// Greenar…"), the glyph itself got swallowed by the ellipsis while still costing the name that same
// width, so a wider name truncated a character or two earlier than it needed to for a star nobody could
// even see (HOU's "Braden Smith ★" was the other half of this — the glyph rendered but crowded right up
// against the truncation point). Rendered as its own sibling in a fixed top-left corner instead (same
// corner slot zoom.js's group view already uses for the identical signals, via its own .zoom-signals) —
// it never competes with the name for width and stays visible regardless of name length.
function signalGlyphs(p) {
  const sig = Array.isArray(p.signals) ? p.signals : [];
  if (!sig.length) return "";
  return `<span class="prow-signals">${sig.map((s) => `<span class="signal-glyph sig-${esc(s)}" title="${esc(SIGNAL_TITLE[s] || s)}">${SIGNAL_GLYPH[s] || "•"}</span>`).join("")}</span>`;
}

// ---- ruling E: the whole-team overview's text rows ------------------------------------------------

// The rating as it appears on an overview row: just the number, coloured by its tier, because a 156px
// column has no room for "89 OVR · #4 DT" as well as a jersey number and a real name. Nothing is lost —
// the full rank rides in the row's own tooltip (see overviewTitle) and on the card in every zoomed-in
// view, which is where D15's "88 OVR, #4 RB" line is actually read.
function overviewOvr(rating, cls) {
  const v = rating?.current;
  // 👁 QA: an unrated player (HOU's fill-in Jake Hummel has no EA entry) used to leave a hole where every
  // other row has a number, which reads as a rendering fault rather than as "no rating exists". A muted
  // "NR" keeps the column a solid ranked list; the same treatment is used in every other view.
  if (v == null) return `<span class="prow-ovr ${cls} prow-ovr-none" title="Not rated — no Madden entry for this player">NR</span>`;
  return `<span class="prow-ovr ${cls}">${esc(v)}</span>`;
}

// The tooltip carries everything the shrunken row cannot: the full name, the Madden line with its
// positional rank, the injury prose and return date, and the Week-1/ESPN-disagrees notes.
function overviewTitle(p, disagrees) {
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
  if (p.snapShare != null) bits.push(`${Math.round(p.snapShare * 100)}% of snaps`);
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

// The starter's bold row: jersey number, full name, any badges, and the tier-coloured rating. A fully-
// out starter or an ACTIVE fill-in gets D44's banner strip stacked on top of the same row, which is the
// BANNER_H field.js reserves for it — so "who is out, and how good is the man replacing him" still reads
// straight down the column, just in two lines of text instead of two photographs.
// D72: `opts.style.headshot` is the one difference between a whole-team row and an offense/defense-page
// row — the same renderer, gated by an option, never a second card type. It is only ever set on the line-
// one row, because that is the man the page is about and the only row with the height to carry a photo.
function overviewLineOne(p, teamAbbr, opts = {}) {
  const style = opts.style || {};
  const disagrees = espnDisagrees(p, opts.band, opts.scheme, opts.labelSource);
  const espnRing = disagrees ? " espn-flag" : "";
  // No role tag here: on the overview the bold top row IS the starter, and an out or filling-in player
  // says so on his own banner. (It used to be rendered and then hidden in CSS — blue review.)
  const badges = [
    isFullyOut(p) ? "" : statusBadge(p.status),
    psBadge(p),
    slotBadge(p, opts),
    weekOneChip(p.weekOneNote),
    alsoListedChips(p, opts.slotLookup, opts.ownLabel),
  ].join("");
  // 👁 QA: the banner is INSIDE this anchor and inset from its edges (.prow-one .card-banner in
  // styles.css), and a bannered row takes the banner's own colour on its border, so "OUT · back ~Sep 19"
  // unmistakably belongs to the man underneath it. Before, a full-bleed strip sat in the gap between two
  // rows and read as a divider between them (PHI's EDGE co-starter pair).
  const head = style.headshot ? `<span class="prow-head">${headshotHtml(p, style.headshot)}</span>` : "";
  return `<a class="${overviewClasses(p, "prow prow-one")}${espnRing}" href="#/team/${esc(teamAbbr)}/player/${encodeURIComponent(p.playerKey)}" data-player-key="${esc(p.playerKey)}" title="${overviewTitle(p, disagrees)}" style="min-height:${lineOneHeight(p, style)}px">
    ${bannerHtml(p)}
    <span class="prow-line">
      ${head}
      <span class="prow-num">${esc(p.number ?? "—")}</span>
      <span class="prow-name" data-short="${esc(shortName(p))}">${esc(p.name)}</span>
      ${signalGlyphs(p)}
      <span class="prow-badges">${badges}</span>
      ${overviewOvr(p.rating, ratingTier(p.rating))}
    </span>
  </a>`;
}

// A slim backup row: number, name, rating. The name drops to "F. Last" as soon as a badge competes with
// it for the width (D37b — the row that matters most must stay readable).
function overviewDepth(p, teamAbbr, opts = {}) {
  const badges = [
    psBadge(p),
    slotBadge(p, opts),
    statusBadge(p.status),
    p.role === "ACTIVE" ? `<span class="badge badge-active">FILLING IN</span>` : "",
    weekOneChip(p.weekOneNote),
    alsoListedChips(p, opts.slotLookup, opts.ownLabel),
  ].join("");
  const name = badges.trim() ? shortName(p) : p.name;
  return `<a class="${overviewClasses(p, "prow")}" href="#/team/${esc(teamAbbr)}/player/${encodeURIComponent(p.playerKey)}" data-player-key="${esc(p.playerKey)}" title="${overviewTitle(p, false)}">
    <span class="prow-line">
      <span class="prow-num">${esc(p.number ?? "—")}</span>
      <span class="prow-name" data-short="${esc(shortName(p))}">${esc(name)}</span>
      <span class="prow-badges">${badges}</span>
      ${overviewOvr(p.rating, ratingTier(p.rating))}
    </span>
  </a>`;
}

// The "+N more" tail that replaces the last visible slim row when a slot runs deeper than the cap
// (D23 keeps the whole roster in the data, so this is common). It links to that band's group view,
// which is exactly the screen that shows every player at the position stacked 1, 2, 3… (D45).
function overviewMore(n, teamAbbr, band) {
  return `<a class="prow prow-more" href="#/team/${esc(teamAbbr)}/group/${esc(String(band || "").toLowerCase())}" title="See all ${n} more players at this position">+${n} more</a>`;
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
  const displayName = badgesHtml.trim() ? shortName(p) : p.name;
  // 👁 QA: "NR" rather than a dash for a player with no Madden entry — the same word every other view
  // uses, so a reader never has to work out whether a rating is missing or merely not rendered.
  const ovr = p.rating?.current ?? "NR";
  // D61 (Adam, 2026-09-15): a depth row for a man who will not play — the second-stringer on IR/PUP/NFI/
  // suspension that D61 puts at the bottom of his slot, and any other out backup — greys out the same way
  // an out line-one row already does (.prow-out), so the eye reads "he is not available" without reading
  // the badge. His rating pill keeps its colour: the whole point of showing him is "how good is the man
  // this unit is missing".
  const outCls = isFullyOut(p) ? " row-out" : "";
  return `<a class="row ${ratingTier(p.rating)}${outCls} ${p.shaded ? "row-shaded" : ""}" href="#/team/${esc(teamAbbr)}/player/${encodeURIComponent(p.playerKey)}" data-player-key="${esc(p.playerKey)}" title="${title}">
    <span class="row-number">#${p.number ?? "—"}</span>
    <span class="row-name">${esc(displayName)}</span>
    ${badgesHtml}
    <span class="row-ovr${p.rating?.current == null ? " row-ovr-none" : ""}">${esc(ovr)}</span>
  </a>`;
}

// Shared "slot body" renderer (final 👁 pass, item 5, 2026-09-12): every view that shows a stack of
// players under one slot label — this file's own renderColumn below (whole-team field), zoom.js's side
// view, and matchup.js — must render a co-starter pair or a STARTER_OUT+ACTIVE fill-in as two full-size
// "big" cards (D44: the two ratings sit directly one above/beside the other), and everything else as one
// big starter card plus a compactRow (40px) for every player behind him — never another stacked full
// card, so a deep column stays a scannable ranked list instead of ballooning the page height (the whole
// point of item 5: side/matchup views were running 2,600-3,000px tall because their backups were full
// cards, not rows). `renderBig(player, teamAbbr, opts)` is the caller's own big-card renderer (this
// zoom.js's fullCard, matchup.js's matchupCard — each a different size/shape. (The whole-team field no
// longer comes through here at all: ruling E gave it its own text-row renderer, overviewLineOne above.)
// `opts.pairOpts` (optional) lets a caller size a co-starter pair differently from a lone starter;
// every other caller can omit it and both cases share the same opts.
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
  });
}

// 👁 QA C5: a compact row's name is clipped with an ellipsis when it will not fit, which cuts people
// mid-word ("Emmanuel McNeil-Warr…"). Where the full name overflows its column, swap in the same
// "F. Surname" form the badge-crowded rows already use — a real abbreviation rather than a truncation.
// Measured rather than guessed from a character count, because the column width now varies with the
// spread factor field.js chose for that particular team and window. Called after mount and again once
// the webfonts have settled, since the metrics that decide this change when the real font arrives.
// D73 follow-up: measured with a Range, not with scrollWidth. scrollWidth is an INTEGER, so a name needing
// 100.4px inside a 100px box reported 100 > 100 — false — and the abbreviation never fired even though the
// browser was already drawing an ellipsis ("Cooper DeJe…", "DeVonta Smi…"). A Range over the text reports
// the true sub-pixel width and is not clipped by the overflow, and comparing it against the element's own
// rect keeps both numbers in the same coordinate space (the field is inside a CSS transform, which scales
// rects but not scrollWidth). The scrollWidth test stays as the fallback wherever Range is unavailable.
function textOverflows(el) {
  const avail = el.getBoundingClientRect().width;
  if (typeof document.createRange !== "function" || !avail) return el.scrollWidth > el.clientWidth + 1;
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect().width > avail + 0.5;
}

export function fitNames(root) {
  for (const el of root.querySelectorAll(".prow-name[data-short]")) {
    const full = el.dataset.full ?? el.textContent;
    el.dataset.full = full;
    el.textContent = full;
    if (el.dataset.short && el.dataset.short !== full && textOverflows(el)) el.textContent = el.dataset.short;
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
// reserve second-stringer as the LAST row of his slot, which made him the very first row that tail swallowed -
// the man the ruling exists to show was the one man hidden (review finding 2). An out row now outranks a
// healthy backup for the visible places: the same NUMBER of rows is drawn, so the column height the layout
// engine reserved is untouched; the DEEPEST healthy rows collapse instead, and whatever survives keeps the
// chart's own order. "+N more" still leads to the group view, where every row is shown in full.
function keepOutRowsVisible(depth, n) {
  if (n <= 0) return [];
  const outs = depth.filter(isFullyOut).slice(0, n);
  const keep = new Set(outs);
  for (const p of depth) { if (keep.size >= n) break; if (!keep.has(p)) keep.add(p); }
  return depth.filter((p) => keep.has(p));
}

// D61: a man on a reserve list already wears IR / PUP / NFI / SUSP; a second "PS" (off the 53) badge beside it
// reads as "practice squad", so the PS badge only shows when no reserve badge does.
const RESERVE_CODES = new Set(["IR", "PUP", "NFI", "SUSP", "EXEMPT"]);
// D77 (Adam): "Slot" describes the man, not only the column — a player who lines up inside often enough
// wears a small Slot tag wherever he sits.
// D83 (Adam, 2026-09-15): for RECEIVERS that tag is now redundant and gone. Every receiver over the bar
// stands in the real WR · Slot column (field.js's regroupSlotReceivers), so tagging him there — or
// anywhere else, since he is nowhere else any more — would print the same fact twice. TIGHT ENDS have no
// slot column to move into, so theirs stays, at Adam's 20% bar; no other position carries a rate at all.
export const SLOT_TAG_RATE = { TE: 20 };
const slotTagRate = (p) => (/TE/i.test(p.position || "") ? SLOT_TAG_RATE.TE : null);
export const slotBadge = (p, opts = {}) => { const bar = slotTagRate(p); return (bar != null && typeof p.slotRate === "number" && p.slotRate >= bar && !opts.isSlotColumn
  ? `<span class="badge badge-slot" title="Slot: ${esc(String(p.slotRate))}% of snaps${p.slotSeason ? " (" + esc(String(p.slotSeason)) + ")" : ""}">Slot</span>` : ""); };
export const psBadge = (p, title = true) => (p.onActiveRoster === false && !RESERVE_CODES.has(p.status?.code)
  ? `<span class="badge badge-ps"${title ? ' title="Not on the 53-man active roster"' : ""}>PS</span>` : "");
export function renderColumn(col, teamAbbr, opts = {}) {
  const { slot, x, top, height } = col;
  const players = slot.players;
  const hatched = slot.shadedByDefault ? " column-shaded" : "";
  const heatCls = slot.injury?.level && HEAT_CLASS[slot.injury.level] ? ` ${HEAT_CLASS[slot.injury.level]}` : "";
  const heatTitleText = heatCls ? heatTitle(slot.injury) : "";
  const labelHref = `#/team/${esc(teamAbbr)}/group/${esc((slot.band || "").toLowerCase())}`;
  // col.slotReason (D64): why THIS receiver is the one standing in the slot — his measured slot rate, the
  // Madden archetype, or the WR3 default. It leads the tooltip because on the slot column it is the thing a
  // reader actually questions; every other column has no reason and reads exactly as before.
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
  // pickSlotColumn), since which man plays inside is the question that row answers. The slot's own label
  // is still the identity everywhere else (the group link, the "also listed at" chips).
  const baseLabel = col.displayLabel || slot.label;
  const labelText = pair ? `${baseLabel} · co-starters` : baseLabel;
  // D70: the band hue on the pill comes from data-band (styles.css maps it to --band-color), one fixed
  // colour per position group across every team and every view — not the team tint the rest of the pill
  // used to carry alone.
  const label = `<a class="column-label${heatCls}" data-band="${esc(slot.band || "")}" href="${labelHref}" title="${labelTitle}">${esc(labelText)}</a>`;

  // ownLabel (🎨 Polish, round 3, item 1): the raw slot label (never the "· co-starters" suffixed
  // labelText above) — it's compared against slotLookup's own return value in alsoListedChips, which
  // resolves OTHER slots' plain labels the same way, so the two must use the identical un-suffixed form.
  // D72: the drawing options travel with the column the layout engine produced (field.js's layoutStyle),
  // so the markup below can no more disagree about the headshot or the depth cap than it already could
  // about the row count — both come from the same object the reserved box was measured with.
  const style = col.style || {};
  const colOpts = { ...opts, band: slot.band, ownLabel: slot.label, labelSource: slot.labelSource, style, isSlotColumn: /Slot/.test(col.displayLabel || "") };

  // Ruling E: bold line-one row(s) — one starter normally, two for a co-starter pair or for D44's
  // OUT-starter-plus-ACTIVE-fill-in — then up to MAX_DEPTH_ROWS slim rows, the last of which becomes a
  // "+N more" tail when the slot runs deeper. lineOneCount/visibleDepthRows come from field.js so the
  // markup below can never disagree with the box height the layout engine reserved for it.
  const bold = lineOneCount(players);
  const visible = visibleDepthRows(players, style.maxDepthRows);
  const depth = players.slice(bold);
  const hiddenCount = depth.length - visible;
  const shownDepth = hiddenCount > 0 ? keepOutRowsVisible(depth, Math.max(visible - 1, 0)) : depth;
  const body = [
    ...players.slice(0, bold).map((p) => overviewLineOne(p, teamAbbr, colOpts)),
    ...shownDepth.map((p) => overviewDepth(p, teamAbbr, colOpts)),
    hiddenCount > 0 && visible > 0 ? overviewMore(depth.length - shownDepth.length, teamAbbr, slot.band) : "",
  ].join("");

// Ruling B (Adam, 2026-09-13): "put the backup boxes under the starters." Every column, offense and
  // defense alike, now reads straight down — label, starter, backups — so there is no reversed stacking
  // direction and no `--align` any more; the old `.column-stack.stack-reverse` is gone from styles.css.
  // opts.colourStyle lets a caller push its own --team-primary/--team-secondary onto this one column:
  // the matchup view draws two different teams on one field, so the wash cannot come from a single
  // wrapper. It is concatenated INTO the style attribute, never added as a second one - a duplicate
  // `style` is silently dropped by the browser, which took every column's left/top with it.
  const colourStyle = opts.colourStyle ? `${opts.colourStyle};` : "";
  return `<div class="column${hatched}${heatCls}" data-slot-id="${esc(slot.slotId)}" style="${colourStyle}left:${x - col.width / 2}px;top:${top}px;width:${col.width}px;height:${height}px">
    ${label}
    <div class="column-stack">${body}</div>
  </div>`;
}

// Renders the small strip of players carried on the roster but absent from the chart (unlisted role),
// positioned against that specific band's own columns (left edge aligned to the band's first column,
// width spanning to its last) rather than the whole row, with the row's own tray gap keeping it clear
// of the deepest depth row above/below it (👁 review, 2026-09-11).
export function renderTray(tray, teamAbbr) {
  const chips = tray.entries.map((p) => `<a class="tray-chip" href="#/team/${esc(teamAbbr)}/player/${encodeURIComponent(p.playerKey)}" data-player-key="${esc(p.playerKey)}" title="Carried on the roster but not on the club depth chart">
      #${esc(p.number ?? "—")} ${esc(p.name)}${(psBadge(p, false) ? " " + psBadge(p, false) : "")}
    </a>`).join("");
  // 👁 QA: the tray carries its band's name. It normally hangs under that band's own columns so the name
  // is obvious, but a band with nothing charted has no row of its own any more (field.js collapses it),
  // and its tray is re-homed onto a neighbouring row — at which point the name is the only thing saying
  // these are, say, the edge rushers rather than more defensive linemen.
  // D70: the NAME, not the internal code — this printed "NOT ON CHART · NB" directly under a pill reading
  // "CB · Nickel", which is the same position called two different things a centimetre apart.
  const label = tray.band ? `not on chart · ${esc(bandDisplay(tray.band))}` : "not on chart";
  // data-unit so a click on one of these chips can be attributed to the right TEAM: the matchup view
  // draws two teams on one field, and a tray is not inside a `.column`, so it is the only thing that can
  // say which half of the ball it belongs to (🔵 review finding 4).
  return `<div class="tray${tray.homed ? " tray-homed" : ""}" data-unit="${esc(tray.unit || "")}" style="left:${tray.left}px;width:${tray.right - tray.left}px;top:${tray.top}px;height:${tray.bottom - tray.top}px">
    <span class="tray-label">${label}</span>${chips}
  </div>`;
}
