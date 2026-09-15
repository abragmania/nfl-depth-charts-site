// D45 zoom levels: team -> Offense/Defense (side view) -> position group (group view).
// Owns its own BIG-card renderer (fullCard, below) rather than sharing one with the whole-team view —
// the sizes/shapes differ per zoom level, and since ruling E the whole-team view has no cards at all. Depth below the line-one card reuses cards.js's own compactRow
// (via the shared renderSlotBody helper, final 👁 pass item 5) so a backup row looks identical wherever
// it renders. Visual language is kept identical to the main field by reusing the SAME class names
// cards.js/styles.css already define (card, tier-elite/strong/avg/weak/flat, card-banner, banner-out,
// banner-active, badge*, rating-pill, column-shaded, tray-label/tray-chip) rather than inventing
// parallel styles.
import { getTeams, getTeam, invalidateTeam } from "./api.js";
import { esc, renderSlotBody, wireDepthToggles, isFullyOut, psBadge } from "./cards.js";
import { headerHtml } from "./team.js";
import { fitToViewport, disposeCurrentView } from "./viewfit.js";
import { navStripHtml, wireNav } from "./nav.js";

// Final 👁 pass (item 4, 2026-09-12): ONE canonical level order everywhere, mirrored off the line of
// scrimmage — offense farthest-to-nearest is RECEIVERS (WR) → BACKFIELD (QB, RB/FB) → LINE (OL, with TE
// riding at the end of it); defense nearest-to-farthest is LINE → EDGE → LINEBACKERS → SECONDARY
// (CB/NB/S together, D14's EDGE kept its own level between the line and the linebackers). WR used to
// share the "LINE" level with OL/TE (true-formation alignment on the whole-team field put them on the
// same row) — it's now its own RECEIVERS level here, same canonical order the matchup view's two facing
// lines rely on (matchup.js: A's offense RECEIVERS→BACKFIELD→LINE, then the LOS divider, then B's defense
// LINE→EDGE→LINEBACKERS→SECONDARY). Band order is reordered here so bands sharing a level render
// adjacently within that level's shared row.
// Ruling D/D57: TE belongs with the receivers, not on the line — the same grouping the whole-team
// field uses, so a tight end does not move house when you zoom in (👁 QA item 7).
const OFF_BAND_ORDER = ["OL", "QB", "BACKFIELD", "WR", "TE"];
const DEF_BAND_ORDER = ["DL", "EDGE", "LB", "CB", "NB", "S"];
const BAND_UNIT = {};
for (const b of OFF_BAND_ORDER) BAND_UNIT[b] = "OFF";
for (const b of DEF_BAND_ORDER) BAND_UNIT[b] = "DEF";
const BAND_LABEL = { QB: "QB", BACKFIELD: "Backfield", WR: "WR", TE: "Tight ends", OL: "OL", DL: "DL", EDGE: "EDGE", LB: "LB", CB: "CB", NB: "NB", S: "Safety" };
const OFF_BAND_LEVEL = { WR: "RECEIVERS", QB: "BACKFIELD", BACKFIELD: "BACKFIELD", OL: "LINE", TE: "RECEIVERS" };
// D63 / 👁 QA (2026-09-15, item 4): there is no band caption any more. The tight ends used to get a
// "TIGHT ENDS" line over their block; D63 retired that label on the team and matchup views, and here it
// was the last one left - a lone caption floating between ATL's two TE stacks, and a second word directly
// above PHI's single "TE" pill saying the same thing twice. Each stack's own label is the label.
const DEF_BAND_LEVEL = { DL: "LINE", EDGE: "EDGE", LB: "LB", CB: "SEC", NB: "SEC", S: "SEC" };
// D62 (Adam, 2026-09-15): the side views no longer PRINT a level name — the LINE / BACKFIELD / EDGE
// chips and the alternating row washes are gone ("they were not helpful there"). A level is still what
// groups the bands into one row, in the order below; it just reads as a block of cards with air around
// it now rather than as a captioned band, so there is no label table here any more.
// 👁 QA item 8: a SIDE view reads from the line of scrimmage downward, the same direction on both sides
// of the ball — line first, then each level further from the ball. The defense already did; the offense
// was printed the other way round (receivers at the top, line at the bottom), so flipping between the two
// tabs turned the picture upside down. The MATCHUP view keeps the facing order instead — its two units
// meet at a divider, so the offense above it must read bottom-up toward the line (matchup.js).
const OFF_LEVEL_SEQUENCE = ["LINE", "BACKFIELD", "RECEIVERS"];
const DEF_LEVEL_SEQUENCE = ["LINE", "EDGE", "LB", "SEC"];

// ---- shared per-player helpers (deliberately duplicated from cards.js — not exported there) ----

const STATUS_CLASS = {
  Q: "badge-q", D: "badge-d", OUT: "badge-out", IR: "badge-out", PUP: "badge-out", NFI: "badge-out",
  SUSP: "badge-susp", EXEMPT: "badge-susp", INACTIVE: "badge-inactive",
};
function initials(p) {
  const a = (p.first || p.name || "?").trim()[0] || "?";
  const b = (p.last || "").trim()[0] || "";
  return (a + b).toUpperCase();
}

function headshotHtml(p, size) {
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

// PFF-inspired (Adam, 2026-09-11): shared tier-colour scale on the pill fill (styles.css :root's
// --tier-*, same thresholds as ratingTier() below) plus a secondary-emphasis span for the position rank —
// identical treatment to cards.js's own ratingPill so a pill looks the same on every view.
function ratingPill(rating) {
  // 👁 QA: never a blank where a rating belongs — an unrated player (no EA entry) reads "NR", muted.
  if (!rating || rating.current == null) return `<span class="rating-pill tier-none" title="Not rated — no Madden entry for this player">NR</span>`;
  const rank = rating.posRank && rating.posCount
    ? `<span class="rating-pill-rank"> · #${rating.posRank} ${esc(rating.maddenPos || "")}</span>`.replace(/ (?=<\/span>)/, "")
    : "";
  return `<span class="rating-pill ${ratingTier(rating)}">${rating.current} OVR${rank}</span>`;
}

function ratingTier(rating) {
  const v = rating?.current;
  if (v == null) return "tier-flat";
  if (v >= 90) return "tier-elite";
  if (v >= 80) return "tier-strong";
  if (v >= 70) return "tier-avg";
  if (v >= 60) return "tier-weak";
  return "tier-flat";
}

function formatReturnDate(returnDate) {
  const d = returnDate ? new Date(returnDate) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// 👁 QA, 2026-09-11: shortened from cards.js's original ("OUT · IR · back ~date") — at this build's
// wider card widths the reason code made the banner text truncate. The reason still shows (it's the
// corner status badge's own code/colour); the banner now only ever says "OUT · back ~date".
function outBannerText(status) {
  const ret = formatReturnDate(status?.returnDate);
  const code = status?.code || "OUT";
  if (code === "SUSP") return ret ? `SUSP · back ~${ret}` : "SUSP · out indefinitely";
  return ret ? `OUT · back ~${ret}` : "OUT · out indefinitely";
}

function bannerHtml(p) {
  if (isFullyOut(p)) return `<div class="card-banner banner-out">${esc(outBannerText(p.status))}</div>`;
  if (p.role === "ACTIVE") return `<div class="card-banner banner-active">ACTIVE · FILLING IN</div>`;
  return "";
}

// Cross-view consistency (🎨 Polish, 2026-09-11): D48 calls for "a jersey crest with the number on each
// card", but only the whole-team field's own cards.js actually drew one — this view fell back to plain
// "#82" text, so a card looked like it came from a different builder depending on the zoom level.
// Identical markup to cards.js's own jerseyCrest (that file doesn't export it) so the shield renders the
// same way everywhere; only the size changes (zoom.css scopes .jersey-crest bigger for .zoom-group).
function jerseyCrest(p) {
  return `<span class="jersey-crest">#${esc(p.number ?? "—")}</span>`;
}

// Quiet role tag under the label — D44/D12: makes it explicit the line-one card is the real, opening
// starter (not just whoever the club currently ranks first).
// 👁 QA: a co-starter who is OUT used to be tagged "STARTER" underneath his own red OUT banner, which is
// a card saying two opposite things at once (PHI's Greenard). A man who will not play now reads OUT,
// whether he got there by being demoted to STARTER_OUT or by keeping tier 1 with an out status. Note this
// is a LABEL change only: D56 still says a healthy co-starter means nobody behind him is promoted, and
// the compile step is what decides that (server/compile/starters.js's promoteFillIns).
function roleTagHtml(p) {
  if (isFullyOut(p)) return `<span class="role-tag role-tag-out">OUT</span>`;
  if (p.role === "ACTIVE") return "";
  if (p.coStarter) return `<span class="role-tag">STARTER</span>`;
  return `<span class="role-tag">${esc(p.role)}</span>`;
}

function cardClasses(p) {
  const cls = ["card", ratingTier(p.rating)];
  if (isFullyOut(p)) cls.push("card-out");
  if (p.shaded) cls.push("card-shaded");
  if (p.coStarter) cls.push("card-costarter");
  return cls.join(" ");
}

function tooltipFor(p) {
  const bits = [p.name];
  if (p.status?.shortComment) bits.push(p.status.shortComment);
  if (p.status?.returnDate) bits.push(`Return: ${p.status.returnDate}`);
  return esc(bits.join(" · "));
}

// ---- D50 injury heat, corrected (Adam, 2026-09-11: "subtle, not loud" — no chips, no banner) ----
// None of this exists in the compiled data yet, so every function here guards for the field being
// absent/undefined and renders nothing rather than throwing. Class names (heat-low/high/critical,
// sig-star/sig-ps/sig-new/sig-lowsnaps) are the step-4 builder's own, defined in styles.css so every
// view matches — this file only applies them; a fallback look for each is defined in zoom.css scoped to
// .zoom, so this build still reads correctly even before/without those styles.css rules landing (the
// same pattern this build already uses for the D43 tier-* classes).
// Shapes once compiled: slot.injury = {starterOut, outStarter:{name,ovr}, fillIn:{name,ovr}, drop,
// level:"none"|"low"|"high"|"critical"}; view.heat = {OFF:{band:{thin,cluster,starOutCount}}, DEF:{...}, summary};
// card.signals = subset of ["STAR_OUT","PROMOTED","NEW_ARRIVAL","LOW_SNAPS"].
const HEAT_LEVEL_CLASS = { low: "heat-low", high: "heat-high", critical: "heat-critical" };
const SIGNAL_META = {
  STAR_OUT: { cls: "sig-star", glyph: "★", title: "A starter here is out" },
  PROMOTED: { cls: "sig-ps", glyph: "PS", title: "Promoted starter" },
  NEW_ARRIVAL: { cls: "sig-new", glyph: "new", title: "New arrival" },
  LOW_SNAPS: { cls: "sig-lowsnaps", glyph: "low%", title: "Low snap share" },
};

function heatDropText(injury) {
  return injury?.drop != null ? `, −${Math.abs(injury.drop)}` : "";
}

// A soft glow class for the whole stack (not just the label) — scaled by slot.injury.level, amber ->
// orange -> deep red. Applied to both the side view's per-slot stack and the group view's per-slot stack.
function stackHeatClass(slot) {
  const inj = slot.injury;
  if (!inj?.starterOut || !inj.level || inj.level === "none") return "";
  return ` ${HEAT_LEVEL_CLASS[inj.level] || ""}`;
}

// All the loud detail lives in the tooltip only, per Adam's correction.
function stackHeatTitle(slot) {
  const inj = slot.injury;
  if (!inj?.starterOut || !inj.outStarter || !inj.fillIn) return "";
  return ` title="Starter out: ${esc(inj.outStarter.name)} ${esc(String(inj.outStarter.ovr))} → ${esc(inj.fillIn.name)} ${esc(String(inj.fillIn.ovr))}${esc(heatDropText(inj))}"`;
}

// Side view band header gets a soft tint, not a "N OUT" chip — cluster (multiple injuries in this band)
// reads stronger than thin (depth just running low), from view.heat[unit][band] = {thin,cluster,starOutCount}.
function bandHeatClass(view, unit, band) {
  const h = view.heat?.[unit]?.[band];
  if (!h) return "";
  if (h.cluster) return " heat-high";
  if (h.thin) return " heat-low";
  return "";
}

function bandHeatTitle(view, unit, band) {
  const h = view.heat?.[unit]?.[band];
  if (!h) return "";
  const bits = [];
  if (h.starOutCount) bits.push(`${h.starOutCount} starter${h.starOutCount === 1 ? "" : "s"} out`);
  if (h.thin) bits.push("depth thin here");
  if (h.cluster) bits.push("multiple injuries clustered here");
  return bits.length ? ` title="${esc(bits.join(" · "))}"` : "";
}

// Tiny quiet per-player markers (star-out glyph, faint "PS"/"new"/"low%") from card.signals.
function signalMarkers(p) {
  const sigs = Array.isArray(p.signals) ? p.signals : [];
  const html = sigs.map((s) => {
    const meta = SIGNAL_META[s];
    return meta ? `<span class="sig ${meta.cls}" title="${esc(meta.title)}">${esc(meta.glyph)}</span>` : "";
  }).join("");
  return html ? `<span class="zoom-signals">${html}</span>` : "";
}

// D49: the group view's "big" cards get one extra line — height/weight/age/college from card.bio when
// the compile step has attached it (ESPN bio fetch, per PROJECT.md, only happens on card-expand and is
// cached — so plenty of players won't have it yet); falls back to "#N · POS" so the line is never blank.
function bioLineText(p) {
  const bio = p.bio;
  if (bio) {
    const bits = [];
    if (bio.height) bits.push(`${Math.floor(bio.height / 12)}'${bio.height % 12}"`);
    if (bio.weight) bits.push(`${bio.weight} lbs`);
    if (bio.age) bits.push(`${bio.age} yrs`);
    if (bio.college) bits.push(bio.college);
    if (bits.length) return bits.join(" · ");
  }
  return `#${p.number ?? "—"} · ${p.displayLabel || p.position || ""}`;
}

// A full player card at any size. The rating pill is rendered as a sibling AFTER .card-body (not
// inside it) — the STARTER_OUT dim rule in styles.css is `.card.card-out .card-body { opacity/grayscale }`,
// scoped to .card-body only, so keeping the pill outside that wrapper is what keeps it "fully visible,
// never dimmed" on a greyed-out card, per this build's own spec, without needing any CSS override.
// opts.compact: the side view's small backup cards (drops the role tag, shrinks the headshot further).
// opts.big: the group view's large cards (D49 — bigger headshot, an extra bio line, no role tag; the
// bio line takes that line's place). Sizing itself is always inline width/height, never a CSS class, so
// there is nothing here that could bleed into another builder's cards elsewhere in the app.
function fullCard(p, teamAbbr, opts = {}) {
  const w = opts.width || 130;
  const h = opts.height || 160;
  const headSize = opts.headSize || Math.round(w * (opts.compact ? 0.32 : 0.42));
  const title = tooltipFor(p);
  // .zoom-card-sm / .zoom-card-lg are size-tier markers ONLY (no width/height/tier-color rules of their
  // own — that stays inline per-instance) so zoom.css can target "the compact side-view backup cards"
  // or "the big group-view cards" specifically, without a selector that could ever reach a card drawn
  // by another builder's view elsewhere in the app (👁 QA, 2026-09-11).
  const sizeCls = opts.compact ? " zoom-card-sm" : opts.big ? " zoom-card-lg" : "";
  // 🎨 Polish (2026-09-11, round 2, CRITICAL fix): this used to be a fixed `height:${h}px`, and every
  // banner card (OUT / ACTIVE) used the SAME height as a plain card even though the banner needs ~24px
  // more room — under `.card{overflow:hidden}` that hid the rating pill completely on an OUT starter
  // (item 1: PHI's Greenard, HOU's E.J. Speed). `min-height` lets a banner card grow the extra room it
  // needs instead of clipping; the LINE_ONE/PAIR_ONE/GROUP_* constants below were also bumped so the
  // common case already fits without relying on the growth.
  // `fluid` sizes the card to its column instead of to a fixed pixel width; the cap lives on the column
  // (zoom.css's .zoom-stack-body, --card-cap) so a plain card, a co-starter pair and an out-starter stack
  // all end up exactly the same width with the same left edge (👁 round 3 item 1). Everything else keeps
  // its exact inline width as before.
  const widthStyle = opts.fluid ? "width:100%" : `width:${w}px`;
  return `<a class="${cardClasses(p)}${sizeCls}" href="#/team/${esc(teamAbbr)}/player/${encodeURIComponent(p.playerKey)}" data-player-key="${esc(p.playerKey)}" title="${title}" style="${widthStyle};min-height:${h}px">
    ${bannerHtml(p)}
    ${signalMarkers(p)}
    <span class="card-badges">
      ${isFullyOut(p) ? "" : statusBadge(p.status)}
      ${psBadge(p)}
    </span>
    <span class="card-body${opts.wide ? " card-body-wide" : ""}">
      <span class="card-head">${headshotHtml(p, headSize)}${opts.wide ? jerseyCrest(p) : ""}</span>
      ${opts.wide ? "" : jerseyCrest(p)}
      <span class="${opts.wide ? "card-text" : "card-textflow"}">
        <span class="card-name">${esc(p.name)}</span>
        <span class="card-label">${esc(p.displayLabel || p.position || "")}</span>
        ${opts.big ? `<span class="zoom-bio-line">${esc(bioLineText(p))}</span>` : ""}
        ${roleTagHtml(p)}
      </span>
    </span>
    <span class="zoom-pill-row">${ratingPill(p.rating)}</span>
  </a>`;
}

// ---- header ----

// Wires the controls inside the shared team.js header ("Refresh now") the same way team.js's own
// renderTeam does — 👁 QA, 2026-09-11: reusing headerHtml's markup without wiring this would ship a dead
// button. D59: the team switcher moved out to the shared nav strip (nav.js's own wireNav, called
// separately by each render function below) — this function no longer touches it.
// `onRefresh()` re-renders this exact view in place once a refresh completes — it must be a direct call,
// not a hash change, since the hash doesn't change on a refresh.
let zoomRefreshListener = null;
function wireHeaderControls(root, A, view, team, onRefresh) {
  window.__nflView = { abbr: A, view, teamMeta: team };
  root.querySelector(".refresh-btn")?.addEventListener("click", (e) => {
    window.NFLRefresh?.trigger(e.currentTarget);
  });
  // 🔵 review: `{ once: true }` only removes the listener after it FIRES. Every re-render (team switch,
  // zoom step, refresh) added another one that never fired, so a single refresh eventually woke a stack of
  // stale closures. The previous one is now explicitly dropped before a new one is registered.
  if (zoomRefreshListener) window.removeEventListener("nfl:data-refreshed", zoomRefreshListener);
  zoomRefreshListener = () => {
    if (window.__nflView?.abbr !== A) return; // navigated away before the refresh finished — stale, ignore
    invalidateTeam(A);
    onRefresh();
  };
  window.addEventListener("nfl:data-refreshed", zoomRefreshListener, { once: true });
}

function notFoundHtml(abbr) {
  return `<div class="notfound">No such team "${esc(abbr)}". <a class="back" href="#/">Back to all teams</a></div>`;
}

function errorHtml(team, e) {
  return `<div class="notfound">Couldn't load ${esc(team.name)}'s depth chart: ${esc(e.message)} <a class="back" href="#/">Back to all teams</a></div>`;
}

// ---- side view (one band per row) ----

// 🎨 Polish (2026-09-11, round 2): heights bumped (160->188) — a real line-one card's content (55px
// headshot + crest + name + label + role tag, plus the rating pill rendered as a sibling below) needs
// ~170-176px; 160 undershot that consistently, which is what item 1's clipping bug was. Widths bumped too
// (130->145 / 120->132) so a real name ("Quinyon Mitchell") has room before the ellipsis kicks in (item 2).
// RULING E (Adam, 2026-09-13): a full defensive side is four levels deep (LINE, EDGE, LINEBACKERS,
// SECONDARY) and all four have to fit inside a 900px window with the header, breadcrumb and back link
// still on screen. That leaves roughly 175px per level, so the side view's cards shrink to a 38px
// headshot and drop the bio line's worth of slack — they are still real photo cards (ruling E: "the side
// view keeps headshot cards"), just sized for the budget. Depth below them is capped at SIDE_MAX_DEPTH
// rows with a "+N more" that expands on click (cards.js's renderDepth/wireDepthToggles).
// D62 (Adam, 2026-09-15): "the cards are too big and bulky" on the side views — the CHROME is what went:
// padding, border weight, tier glow, crest, type sizes and the leading around the rating pill (all in
// zoom.css). 👁 QA (2026-09-15, items 1 and 6) then made the view fill the window's height, which changes
// what these numbers mean: the whole canvas is scaled by one factor now, so what matters is each piece's
// SHARE of the card, not its pixel value. The headshot takes a much bigger share than it did (26 of ~103
// before D62, 38 of ~90 now) - it is the one thing on a side card that wants to be big, and the QA note
// asks for ~40-44px of it on screen, which is what 30 design px comes to once the fit scales the view up.
const LINE_ONE = { width: 136, height: 86, headSize: 38 };
const PAIR_ONE = { width: 124, height: 86, headSize: 38 };
// The scale ceiling for the fill fit (viewfit.js). A three-level offense needs ~1.4 to reach the bottom of
// a 1700x900 window; beyond ~1.6 a sparse unit stops looking like a chart and starts looking like a poster.
const SIDE_MAX_GROW = 1.6;
const SIDE_MAX_DEPTH = 2;
// A slot drawing two big cards (an out starter above his ACTIVE fill-in, or a co-starter pair) is
// already the tallest thing in its level, so it shows one backup row instead of two before the tail.
const SIDE_MAX_DEPTH_PAIRED = 1;

// Final 👁 pass (item 5, 2026-09-12): depth below the line-one card (or the co-starter/fill-in pair) now
// renders as this file's own SAME compact row cards.js already uses on the whole-team field — not another
// stacked full card — via the shared renderSlotBody helper (cards.js). That's the fix for the side view
// running 2,600-3,000px tall: a column of 4-5 backups used to cost ~124px each as a shrunk full card;
// a compact row is 40px, matching the main field's own convention exactly (same classes, same look).
function renderSideStack(slot, teamAbbr, view, unit, slotLookup) {
  const hatched = slot.shadedByDefault ? " column-shaded" : "";
  const players = slot.players;
  const isPair = players.length >= 2 && players[0].coStarter && players[1].coStarter;
  // 👁 QA (2026-09-15, item 5): slotLookup/ownLabel are what turn a depth row's "also listed at" chip
  // from the raw slot id it was printing here ("OFF-OL-5" under ATL's M. Jerrell) into the human column
  // name the whole-team field has always shown. cards.js's alsoListedChips falls back to the id when no
  // lookup is passed, and this view was the one caller not passing one.
  const body = renderSlotBody(players, teamAbbr, fullCard, { ...LINE_ONE, pairOpts: PAIR_ONE, maxDepth: SIDE_MAX_DEPTH, maxDepthPaired: SIDE_MAX_DEPTH_PAIRED, slotLookup, ownLabel: slot.label });
  // Lead ruling (2026-09-11, item 8): a co-starter pair is one slot with two names on it — say so on the
  // label instead of leaving it to be inferred from two adjacent STARTER tags.
  const labelText = isPair ? `${slot.label} · co-starters` : slot.label;
  // Final 👁 pass (item 5, 2026-09-12): the old per-band sidebar label (a separate 120px-wide column
  // reserved on every band row) is gone — "level header is the only label system" now (see
  // renderZoomSide's level-row grouping below). Its "click through to the whole group" behaviour moves
  // onto this slot's own label instead, and the D50 band-heat tint/tooltip that used to live on that
  // sidebar link moves here too (still band-level data — every slot in a thin/clustered band shows it).
  const band = slot.band;
  const bandTitle = bandHeatTitle(view, unit, band);
  const labelHref = `#/team/${esc(teamAbbr)}/group/${esc((band || "").toLowerCase())}`;
  const labelTitleAttr = bandTitle || ` title="See the whole ${esc(BAND_LABEL[band] || band)} group"`;
  return `<div class="zoom-side-stack${hatched}${stackHeatClass(slot)}" data-slot-id="${esc(slot.slotId)}"${stackHeatTitle(slot)}>
    <a class="zoom-stack-label${bandHeatClass(view, unit, band)}" href="${labelHref}"${labelTitleAttr}>${esc(labelText)}</a>
    ${body}
  </div>`;
}

export async function renderZoomSide(root, search, abbr, unit) {
  search.hidden = true;
  disposeCurrentView(); // the outgoing view's observers must not outlive its DOM (🔵 review 1)
  const A = (abbr || "").toUpperCase();
  const { teams } = await getTeams();
  const team = teams.find((t) => t.abbr === A);
  if (!team) {
    document.title = "NFL Depth Charts";
    root.innerHTML = notFoundHtml(abbr);
    return;
  }
  const unitLabel = unit === "OFF" ? "Offense" : "Defense";
  document.title = `${team.name} ${unitLabel} — NFL Depth Charts`;

  let view, fromFixture;
  try {
    ({ data: view, fromFixture } = await getTeam(A));
  } catch (e) {
    root.innerHTML = errorHtml(team, e);
    return;
  }

  const bandOrder = unit === "OFF" ? OFF_BAND_ORDER : DEF_BAND_ORDER;
  const bandLevel = unit === "OFF" ? OFF_BAND_LEVEL : DEF_BAND_LEVEL;
  const levelSequence = unit === "OFF" ? OFF_LEVEL_SEQUENCE : DEF_LEVEL_SEQUENCE;
  // Final 👁 pass (item 4/5, 2026-09-12): a LEVEL is now one shared row (a tinted band header, D48,
  // exactly like the whole-team field's own level-stripe) holding every band that belongs to it, instead
  // of a separate full row PER BAND under one grey heading line — that dual system was the "300px empty
  // label gutter" (e.g. offense's BACKFIELD level = QB + RB/FB, two mostly-empty band rows before this).
  // One id -> label map across both units, the same shape team.js builds for the whole-team field.
  const slotLabels = new Map();
  for (const u of ["OFF", "DEF"]) for (const sl of view.units?.[u] || []) slotLabels.set(sl.slotId, sl.label);
  const slotLookup = (slotId) => slotLabels.get(slotId);
  const bandsByLevel = new Map();
  for (const band of bandOrder) {
    const level = bandLevel[band] || band;
    if (!bandsByLevel.has(level)) bandsByLevel.set(level, []);
    bandsByLevel.get(level).push(band);
  }
  const rowsHtml = levelSequence.map((level) => {
    const bandsHere = bandsByLevel.get(level) || [];
    const groupsHtml = bandsHere.map((band) => {
      const slots = (view.units?.[unit] || []).filter((s) => s.band === band).slice().sort((a, b) => a.columnOrder - b.columnOrder);
      if (!slots.length) return "";
      return `<div class="zoom-band-group"><div class="zoom-band-row">${slots.map((slot) => renderSideStack(slot, A, view, unit, slotLookup)).join("")}</div></div>`;
    }).join("");
    if (!groupsHtml) return "";
    // D62: the level's caption chip is gone (see the note by DEF_BAND_LEVEL above). The wrapper stays —
    // it is what keeps a level's bands on one row and gives the next level its gap — and each stack still
    // carries its own position label, which is the label a reader of this view actually uses.
    return `<div class="zoom-level"><div class="zoom-band-stacks">${groupsHtml}</div></div>`;
  }).join("");

  // D59: the shared nav strip replaces this view's old breadcrumb — same position, same job (Team/
  // Offense/Defense/Matchup pills, the current one lit), plus the team switcher it used to borrow from
  // the header. The D50 heat summary does NOT repeat here (2026-09-14 follow-up) — it already shows once
  // as the red chip inside headerHtml, right below.
  root.innerHTML = `<div class="zoom-page">
    ${navStripHtml({ teams, abbr: A, page: unit === "OFF" ? "off" : "def", primary: team.colourPrimary, secondary: team.colourSecondary })}
    ${headerHtml(team, view, fromFixture, teams)}
    <div class="fit-outer"><div class="fit-inner"><div class="zoom zoom-side">${rowsHtml || `<div class="placeholder">No ${esc(unitLabel.toLowerCase())} slots on this chart.</div>`}</div></div></div>
  </div>`;
  // 👁 QA (2026-09-15, item 1): the side view fills BOTH axes now (viewfit.js's fill mode, whose
  // single-correction-pass bug is what used to shrink the cards of a few-level unit - see the note there).
  // D62's leaner cards left ~190px of black under PHI's offense and defense on a 1700x900 screen; filling
  // the height spends that on the cards, the headshots and the air between the levels, all at one scale.
  // SIDE_MAX_GROW caps it: a unit with only two levels (a hypothetical chart with nothing but a line and a
  // backfield) would otherwise blow its cards up to fill a screen it has no content for.
  fitToViewport(root, { fill: true, maxGrow: SIDE_MAX_GROW }); // registers its own teardown with viewfit.js
  wireDepthToggles(root); // ruling E: the "+N more" tails on capped depth stacks
  wireNav(root); // D59: switcher routes to the equivalent page (same side) on the newly picked team
  wireHeaderControls(root, A, view, team, () => renderZoomSide(root, search, A, unit));
}

// ---- group view (one position group, every slot side by side) ----

// D49: the group view is one zoom step in from the side view, so its cards are noticeably bigger — the
// first (line-one) row biggest of all, the rest a size down. Both are still well above the side view's
// medium LINE_ONE size above (the side view's own backups are compact rows, not cards — item 5).
// 🎨 Polish (2026-09-11, round 2): widened (180->210, item 12: "bigger headshot") and heightened
// (230->256 / 198->220, item 1: the group view's big card adds a bio line AND a role tag on top of the
// same head/crest/name/label stack the side view has, plus a bigger rating pill — 230 undershot that).
// RULING E (Adam, 2026-09-13): "the group view fills the screen with the big cards as now (it has one
// band, so it already fits - verify)." Verified, and it did NOT: HOU's corner group is three deep and
// its third card fell off the bottom of a 900px window. These are still the biggest cards in the app by
// a wide margin (D49's zoom ladder is intact - group > side > whole team), just sized so three tiers of
// them fit the window. Deeper than GROUP_MAX_ROWS collapses behind a "+N more" that expands on click.
// 👁 QA A1: the group grid spans the whole container, one equal fraction per slot, so a lone QB column
// is a large card rather than a 220px sliver marooned in a sea of black. `fluid` makes the card fill its
// grid cell up to a sane cap (a single column must not become a 1500px-wide card); fitToViewport's fill
// mode then scales the whole grid so the cards also consume the leftover HEIGHT.
const GROUP_LINE_ONE = { height: 196, headSize: 78, big: true, fluid: true };
const GROUP_REST = { height: 168, headSize: 56, big: true, fluid: true };
// 👁 QA item 3: a shallow WIDE group (QB, or a safety pair — at most GROUP_WIDE_MAX slots) has a lot of
// vertical budget and only 3-4 rows to spend it on, so the fitToViewport fill-mode scale-up alone left
// ~120px dead at the bottom. Taller rows for the wide layout only (portrait groups are already tuned to
// their own budget — HOU's three-deep corners already fell off the bottom once, 👁 round 3) spend that
// budget directly instead of relying on the scale factor to find it.
const GROUP_LINE_ONE_WIDE = { height: 214, headSize: 84, big: true, fluid: true };
const GROUP_REST_WIDE = { height: 180, headSize: 60, big: true, fluid: true };
// The cap on a fluid card's width, by how many slots share the row. A ten-column group wants narrow
// cards; a one-column group (QB) wants a genuinely big one, since the alternative is a 220px sliver
// stranded in the middle of the screen - but not a 1500px-wide card either (👁 QA A1's own wording).
// 👁 QA round 3 item 2: with one or two slots the group switches to a HORIZONTAL card (headshot left,
// everything else stacked against it on the right - see .group-wide in zoom.css) and is allowed to run
// wider, because that layout actually fills the width instead of centring a narrow column of text in it.
const GROUP_WIDE_MAX = 2;
// The cap is applied to the COLUMN, not to each card (zoom.css's .zoom-stack-body): a rank row can be a
// single card, a co-starter pair or an out-starter/fill-in stack, and capping each of those separately is
// exactly how they ended up different widths with different left edges (👁 round 3 item 1).
// 👁 QA item 3: a single-column group (QB) only reached 1120px of a ~1650px-wide field — 1120 was sized
// for the old portrait card, but a lone slot now draws the WIDE horizontal card (group-wide, above), which
// is built to fill real width without going strange. Raised so it actually reaches the container HOU's
// three-column WR group already reaches (x≈1522) instead of stopping two-thirds of the way there.
const groupCardCap = (n) => (n <= 1 ? 1600 : n === 2 ? 720 : 400);
const GROUP_MAX_ROWS = 3;

function tierRow(n, cardHtml) {
  const num = n == null ? "" : esc(String(n));
  return `<div class="tier-row"><span class="tier-num">${num}</span>${cardHtml}</div>`;
}

function renderGroupStack(slot, teamAbbr, wide = false) {
  const lineOne = { ...(wide ? GROUP_LINE_ONE_WIDE : GROUP_LINE_ONE), wide };
  const rest = { ...(wide ? GROUP_REST_WIDE : GROUP_REST), wide };
  const hatched = slot.shadedByDefault ? " column-shaded" : "";
  const players = slot.players;
  // Lead ruling (2026-09-11, item 8): same "one slot, two names" label treatment as the side view, for
  // the same reason — an explicit coStarter pair at tier 1.
  const isPair = players.length >= 2 && players[0].coStarter && players[1].coStarter;
  const labelText = isPair ? `${slot.label} · co-starters` : slot.label;
  const rows = [];
  let i = 0;
  let rowIndex = 0;
  while (i < players.length) {
    const p = players[i];
    const next = players[i + 1];
    const size = rowIndex === 0 ? lineOne : rest;
    // 👁 QA correction (D44/D12, 2026-09-11): an OUT starter and his ACTIVE fill-in read as tier "1" side
    // by side, exactly like an explicit coStarter pair — not "0"/"1" as sequential rows. This covers BOTH
    // conventions the compile step uses for "starter out, someone else filling in" (isFullyOut's own
    // comment above has the full explanation): an explicit coStarter:true pair, or a plain STARTER_OUT
    // role followed by an ACTIVE one. `(p.tier || i + 1)` (not `??`) also fixes the "0" itself directly —
    // a tier value of 0 is never meaningful for a real depth slot, so it falls back the same as a missing one.
    const isCoPair = p.coStarter && next?.coStarter;
    const isOutFillIn = !isCoPair && isFullyOut(p) && next?.role === "ACTIVE";
    if (isCoPair || isOutFillIn) {
      // 👁 QA item 10: a co-starter PAIR is two men sharing one job, so they sit side by side. An out
      // starter and his ACTIVE fill-in are not a pair — they are D44's "how good was the hurt man, how
      // good is his replacement", which only reads as a comparison when the two ratings sit one directly
      // above the other. Rendering them side by side also left a hole in the grid under the fill-in.
      const body = isCoPair
        ? `<div class="costarter-pair">${fullCard(p, teamAbbr, size)}${fullCard(next, teamAbbr, size)}</div>`
        : `<div class="outfillin-stack">${fullCard(p, teamAbbr, size)}${fullCard(next, teamAbbr, size)}</div>`;
      rows.push(tierRow(rowIndex + 1, body));
      i += 2;
    } else {
      // 👁 QA B2: numbered by DEPTH POSITION in this column (1, 2, 3...), not by the club chart's own
      // tier value. Two men listed at the same tier - which the clubs do all the time, and which a
      // co-starter pair or an out-starter/fill-in row collapses further - used to print "1, 2, 2".
      rows.push(tierRow(rowIndex + 1, fullCard(p, teamAbbr, size)));
      i += 1;
    }
    rowIndex++;
  }
  // Ruling E: rows past the cap collapse behind a "+N more" button that reveals them in place - same
  // mechanism as the side view's capped depth stacks (cards.js's wireDepthToggles drives both).
  const visible = rows.slice(0, GROUP_MAX_ROWS);
  const hiddenRows = rows.slice(GROUP_MAX_ROWS);
  const rowsHtml = hiddenRows.length
    ? `${visible.join("")}<button type="button" class="depth-more" aria-expanded="false">+${hiddenRows.length} more</button><span class="depth-extra">${hiddenRows.join("")}</span>`
    : visible.join("");
  return `<div class="zoom-stack${hatched}${stackHeatClass(slot)}" data-slot-id="${esc(slot.slotId)}"${stackHeatTitle(slot)}>
    <div class="zoom-stack-label">${esc(labelText)}</div>
    <div class="zoom-stack-body">${rowsHtml}</div>
  </div>`;
}

// PFF-inspired (Adam, 2026-09-11): "a compact ranked list treatment for the group view header: 'Top of
// the unit: Carter 89 · Davis 82 · Ojomo 75' as a quiet line" — every player in the group (not just
// starters), ranked by current OVR, top 3, surname-only to stay short.
function topOfUnitHtml(slots) {
  const players = slots.flatMap((s) => s.players || []).filter((p) => p.rating?.current != null);
  players.sort((a, b) => b.rating.current - a.rating.current);
  const top = players.slice(0, 3).map((p) => `${esc(p.last || p.name)} ${esc(p.rating.current)}`);
  return top.length ? `<div class="zoom-heat-line zoom-top-line">Top of the unit: ${top.join(" · ")}</div>` : "";
}

function renderUnlistedStack(entries, teamAbbr) {
  const chips = entries.map((p) => `<a class="tray-chip" href="#/team/${esc(teamAbbr)}/player/${encodeURIComponent(p.playerKey)}" data-player-key="${esc(p.playerKey)}" title="Carried on the roster but not on the club depth chart">
      #${p.number ?? "—"} ${esc(p.name)}${(psBadge(p, false) ? " " + psBadge(p, false) : "")}
    </a>`).join("");
  return `<div class="zoom-unlisted"><span class="tray-label">not on chart</span>${chips}</div>`;
}

export async function renderZoomGroup(root, search, abbr, bandParam) {
  search.hidden = true;
  disposeCurrentView(); // the outgoing view's observers must not outlive its DOM (🔵 review 1)
  const A = (abbr || "").toUpperCase();
  const band = String(bandParam || "").toUpperCase();
  const unit = BAND_UNIT[band];
  const { teams } = await getTeams();
  const team = teams.find((t) => t.abbr === A);
  if (!team || !unit) {
    document.title = "NFL Depth Charts";
    root.innerHTML = notFoundHtml(unit ? abbr : `${abbr} / ${bandParam}`);
    return;
  }
  const bandLabel = BAND_LABEL[band] || band;
  document.title = `${team.name} ${bandLabel} — NFL Depth Charts`;

  let view, fromFixture;
  try {
    ({ data: view, fromFixture } = await getTeam(A));
  } catch (e) {
    root.innerHTML = errorHtml(team, e);
    return;
  }

  let slots = (view.units?.[unit] || []).filter((s) => s.band === band).slice().sort((a, b) => a.columnOrder - b.columnOrder);
  let unlistedEntries = (view.unlisted?.[unit]?.[band]) || [];
  // NB rides along inside the CB group view as its own stack (D45 spec: "treat nb as part of the cb
  // group and show it as its own stack labelled NB") rather than getting its own route.
  if (band === "CB") {
    const nbSlots = (view.units?.DEF || []).filter((s) => s.band === "NB").slice().sort((a, b) => a.columnOrder - b.columnOrder);
    slots = slots.concat(nbSlots);
    unlistedEntries = unlistedEntries.concat((view.unlisted?.DEF?.NB) || []);
  }

  const wide = slots.length <= GROUP_WIDE_MAX;
  const stacksHtml = slots.map((slot) => renderGroupStack(slot, A, wide)).join("");
  const trayHtml = unlistedEntries.length ? renderUnlistedStack(unlistedEntries, A) : "";

  // D59: same shared strip as the side view, with the group's band as a trailing crumb (linking nowhere —
  // it names the band you're already looking at) instead of the old breadcrumb's second segment.
  root.innerHTML = `<div class="zoom-page">
    ${navStripHtml({ teams, abbr: A, page: "group", unit, bandLabel, bandSlug: band.toLowerCase(), primary: team.colourPrimary, secondary: team.colourSecondary })}
    ${headerHtml(team, view, fromFixture, teams)}
    ${topOfUnitHtml(slots)}
    <div class="fit-outer"><div class="fit-inner"><div class="zoom zoom-group${wide ? " group-wide" : ""}" style="--group-cols:${Math.max(slots.length, 1)};--card-cap:${groupCardCap(slots.length)}px">${stacksHtml || `<div class="placeholder">No ${esc(bandLabel)} slots on this chart.</div>`}${trayHtml}</div></div></div>
  </div>`;
  // 👁 QA A1: fill mode - the grid is laid out at the container's own width and scaled so the cards use
  // the leftover height too, instead of a fixed design width that left most of the screen black.
  fitToViewport(root, { fill: true });
  wireDepthToggles(root); // ruling E: the "+N more" tail on a group stack deeper than GROUP_MAX_ROWS
  wireNav(root); // D59: switcher routes to the same band on the newly picked team
  wireHeaderControls(root, A, view, team, () => renderZoomGroup(root, search, A, bandParam));
}
