// D45 zoom levels: team -> Offense/Defense (side view) -> position group (group view).
//
// D72 (Adam, 2026-09-15) rewrote the SIDE view. It used to be this file's own flow layout: a row per
// level, a flex row of stacks per band, a big photo card per starter and compact rows beneath him. That
// meant a tight end moved house between the team page and the offense page, the columns carried none of
// the field's geometry, and two layout engines had to be kept in step with each other by hand. The side
// view is now the SAME field engine the team and matchup pages use (field.js's computeLayout, cards.js's
// renderColumn, team.js's mountTeamField), handed a TeamView carrying one unit — the same trick matchup.js
// already uses to draw two half-teams as one. Everything that page shows therefore comes from the shared
// engine: levels, stripes, column pills, compact rows, trays, D70's band colours and D61/D56's banners.
// The only differences are the three options computeLayout takes for it (no line of scrimmage, a canvas
// cropped to the one unit, and the bigger row style a 1.3-1.8x scale affords).
//
// What is left in this file is the GROUP view (one position group, big cards), which keeps its own
// fullCard renderer below — D49's zoom ladder puts the biggest cards in the app on that page, and it is
// a grid of ranked cards rather than a field. Visual language is kept identical to the main field by
// reusing the SAME class names cards.js/styles.css already define (card, tier-elite/strong/avg/weak/flat,
// card-banner, banner-out, banner-active, badge*, rating-pill, column-shaded, tray-label/tray-chip)
// rather than inventing parallel styles.
import { getTeams, getTeam, invalidateTeam } from "./api.js";
import { esc, BAND_DISPLAY, headshotHtml, wireDepthToggles, isFullyOut, isScratch, psBadge, snapHistoryHtml, withClubRole, NO_SNAP_ROW_TITLE } from "./cards.js";
import { headerHtml, mountTeamField, teamBodyHtml } from "./team.js";
import { SIDE_CARD_W, SIDE_MAX_DEPTH_ROWS, regroupSlotReceivers, columnRankReason } from "./field.js";
import { fitToViewport, disposeCurrentView, SIDE_MIN_READABLE_SCALE } from "./viewfit.js";
import { navStripHtml, wireNav } from "./nav.js";

// Which unit a #/team/X/group/BAND route belongs to, and what each band is called in prose. D72 retired
// this file's own level tables (OFF_BAND_LEVEL / DEF_LEVEL_SEQUENCE and friends): a side page's levels,
// their order and their labels now come from field.js, which is the single place that decision is made
// for the team, matchup and side pages alike.
const OFF_BAND_ORDER = ["OL", "QB", "BACKFIELD", "WR", "TE"];
const DEF_BAND_ORDER = ["DL", "EDGE", "LB", "CB", "NB", "S"];
const BAND_UNIT = {};
for (const b of OFF_BAND_ORDER) BAND_UNIT[b] = "OFF";
for (const b of DEF_BAND_ORDER) BAND_UNIT[b] = "DEF";
// D70: the group page's title and its nav crumb name the band, and so does the "not on chart" tray on
// every field — one table for all of them (cards.js's BAND_DISPLAY), so a position cannot be called one
// thing on the team page and another on its own group page.
const BAND_LABEL = BAND_DISPLAY;

// ---- shared per-player helpers (deliberately duplicated from cards.js — not exported there) ----

const STATUS_CLASS = {
  Q: "badge-q", D: "badge-d", OUT: "badge-out", IR: "badge-out", PUP: "badge-out", NFI: "badge-out",
  SUSP: "badge-susp", EXEMPT: "badge-susp", INACTIVE: "badge-inactive",
};
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
  // Never a blank where a rating belongs — an unrated player (no EA entry) reads "NR", muted.
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

// Shorter than cards.js's own banner text ("OUT · IR · back ~date") — at this build's wider card widths
// the reason code made the banner text truncate. The reason still shows (it's the corner status badge's
// own code/colour); the banner here only ever says "OUT · back ~date".
function outBannerText(status) {
  const ret = formatReturnDate(status?.returnDate);
  const code = status?.code || "OUT";
  if (code === "SUSP") return ret ? `SUSP · back ~${ret}` : "SUSP · out indefinitely";
  return ret ? `OUT · back ~${ret}` : "OUT · out indefinitely";
}

// D60 (Adam, approved 2026-09-15): a healthy game-day scratch gets a neutral grey banner and no return
// date - he is not hurt, he is simply not dressing. Same words as cards.js's whole-team row so the two
// views never describe the same man differently. A genuine OUT keeps the red banner.
const SCRATCH_BANNER = "INACTIVE · coach's decision";

function bannerHtml(p) {
  if (isScratch(p)) return `<div class="card-banner banner-inactive">${esc(SCRATCH_BANNER)}</div>`;
  if (isFullyOut(p)) return `<div class="card-banner banner-out">${esc(outBannerText(p.status))}</div>`;
  if (p.role === "ACTIVE") return `<div class="card-banner banner-active">ACTIVE · FILLING IN</div>`;
  return "";
}

// D48 calls for "a jersey crest with the number on each card". Identical markup to cards.js's own
// jerseyCrest (that file doesn't export it) so the shield renders the same way everywhere; only the size
// changes (zoom.css scopes .jersey-crest bigger for .zoom-group).
function jerseyCrest(p) {
  return `<span class="jersey-crest">#${esc(p.number ?? "—")}</span>`;
}

// Quiet role tag under the label — D44/D12: makes it explicit the line-one card is the real, opening
// starter (not just whoever the club currently ranks first). A co-starter who is OUT reads OUT here, never
// STARTER underneath his own red OUT banner — a card must not say two opposite things at once — whether he
// got there by being demoted to STARTER_OUT or by keeping tier 1 with an out status. This is a LABEL choice
// only: D56 still says a healthy co-starter means nobody behind him is promoted, and the compile step is
// what decides that (server/compile/starters.js's promoteFillIns).
function roleTagHtml(p) {
  // D60: a scratch reads INACTIVE, not OUT - the tag must agree with the grey banner directly above it.
  if (isScratch(p)) return `<span class="role-tag role-tag-inactive">INACTIVE</span>`;
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
// orange -> deep red. On the group view's per-slot stack; the side view gets the field's own column glow
// (cards.js's renderColumn) since D72 put it on the shared engine.
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

// Tiny quiet per-player markers (star-out glyph, faint "PS"/"new"/"low%") from card.signals.
function signalMarkers(p) {
  const sigs = Array.isArray(p.signals) ? p.signals : [];
  const html = sigs.map((s) => {
    // D148: a man the source has no row for is not "low" - same distinction cards.js draws from lowSnapsReason.
    const meta = s === "LOW_SNAPS" && p?.lowSnapsReason === "NO_ROW" ? { ...SIGNAL_META[s], glyph: "no data", title: NO_SNAP_ROW_TITLE } : SIGNAL_META[s];
    return meta ? `<span class="sig ${meta.cls}" title="${esc(meta.title)}">${esc(meta.glyph)}</span>` : "";
  }).join("");
  return html ? `<span class="zoom-signals">${html}</span>` : "";
}

// D49: the group view's "big" cards get one extra line — height/weight/age/college from card.bio when
// the compile step has attached it (ESPN bio fetch, per PROJECT.md, only happens on card-expand and is
// cached — so plenty of players won't have it yet); falls back to "#N · POS" so the line is never blank.
// `opts.posLabel` (D93 on the group page, below): the position line reads off the COLUMN the card is
// standing in, not off the club slot the server listed the man at, so a receiver drawn in the derived
// WR · Slot column cannot have the bio line underneath him still saying "WR2".
function bioLineText(p, opts = {}) {
  const bio = p.bio;
  if (bio) {
    const bits = [];
    if (bio.height) bits.push(`${Math.floor(bio.height / 12)}'${bio.height % 12}"`);
    if (bio.weight) bits.push(`${bio.weight} lbs`);
    if (bio.age) bits.push(`${bio.age} yrs`);
    // See panel.js: a null college with an "international" note is a stated fact, not a missing value. This
    // one-line summary is tight, so it says the short form.
    if (bio.college) bits.push(bio.college);
    else if (bio.collegeNote === "international") bits.push("No college");
    if (bits.length) return bits.join(" · ");
  }
  return `#${p.number ?? "—"} · ${positionLine(p, opts)}`;
}

// The one place this file decides what a card calls the position its man plays: the column's own label
// when the caller knows it (the group page, since D93 can move a man into a column his card has never
// heard of), otherwise the label the server listed him at.
function positionLine(p, opts = {}) {
  return opts.posLabel || p.displayLabel || p.position || "";
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
  // by another builder's view elsewhere in the app.
  const sizeCls = opts.compact ? " zoom-card-sm" : opts.big ? " zoom-card-lg" : "";
  // `min-height`, not a fixed height: a banner card (OUT / ACTIVE) needs ~24px more room than a plain card,
  // and under `.card{overflow:hidden}` a fixed height clips the rating pill clean off an OUT starter's card.
  // min-height lets a banner card grow the extra room it needs instead of clipping; the LINE_ONE/PAIR_ONE/
  // GROUP_* constants below are sized so the common case already fits without relying on the growth.
  // `fluid` sizes the card to its column instead of to a fixed pixel width; the cap lives on the column
  // (zoom.css's .zoom-stack-body, --card-cap) so a plain card, a co-starter pair and an out-starter stack
  // all end up exactly the same width with the same left edge. Everything else keeps its exact inline
  // width as before.
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
        <span class="card-label">${esc(positionLine(p, opts))}</span>
        ${opts.big ? `<span class="zoom-bio-line">${esc(bioLineText(p, opts))}</span>` : ""}
        ${roleTagHtml(p)}
      </span>
    </span>
    <span class="zoom-pill-row">${ratingPill(p.rating)}${snapHistoryHtml(p, opts)}</span>
  </a>`;
}

// ---- header ----

// Wires the controls inside the shared team.js header ("Refresh now") the same way team.js's own
// renderTeam does — reusing headerHtml's markup without wiring this would ship a dead button. D59: the
// team switcher moved out to the shared nav strip (nav.js's own wireNav, called separately by each render
// function below) — this function no longer touches it.
// `onRefresh()` re-renders this exact view in place once a refresh completes — it must be a direct call,
// not a hash change, since the hash doesn't change on a refresh.
// `page` (D75, "team"/"off"/"def"/"group") rides along on window.__nflView so main.js's openPlayerPanel
// knows whether the page it is caching has an `<aside class="player-panel">` it can open the panel into
// in place — only the side pages (D72) do, via teamBodyHtml; the group view still doesn't, so it keeps
// falling back to a full re-render exactly as before.
let zoomRefreshListener = null;
function wireHeaderControls(root, A, view, team, onRefresh, page) {
  window.__nflView = { abbr: A, view, teamMeta: team, page };
  root.querySelector(".refresh-btn")?.addEventListener("click", (e) => {
    window.NFLRefresh?.trigger(e.currentTarget);
  });
  // `{ once: true }` only removes the listener after it FIRES. Without dropping the previous one first,
  // every re-render (team switch, zoom step, refresh) would add another that never fired, so a single
  // refresh would eventually wake a stack of stale closures.
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

// ---- side view: ONE unit, drawn on the shared field engine (D72) ----

// The TeamView computeLayout is handed for a side page. Only the requested unit is carried, which is what
// makes the engine draw half a field: the other unit's rows come out empty and are dropped, the line of
// scrimmage goes with them, and the canvas is cropped to the columns that remain. The shape is exactly
// what matchup.js already assembles for its two half-teams, so there is one synthetic-view idiom in the
// app rather than two. `scheme` still rides along because it decides how a defensive front is placed
// (3-4 nose tackle on the centre vs 4-3 tackles over the guards).
function unitView(view, unit) {
  return {
    scheme: view.scheme,
    // 🔵 A0-2: and the club's ESPN-vs-club scheme disagreement, which decides what ESPN's own position
    // codes mean wherever this page's cards are judged against them (cards.js's espnSchemeOf).
    schemeOverride: view.schemeOverride ?? null,
    units: { [unit]: view.units?.[unit] || [] },
    unlisted: { [unit]: view.unlisted?.[unit] || {} },
  };
}

// The ways a single-unit field differs from the whole-team one (D72), all options on the shared engine
// rather than a second engine:
//   crop          shrink-wrap the canvas to this unit's own columns, so the fit engine can scale a short
//                 chart up to fill the window instead of being pinned by a canvas it is not using;
//   fillHeight    and where the width still pins the scale (a defense drawn over only four rows),
//                 spend the leftover height as air between the rows;
//   headshot      at the ~1.3-1.8x scale that produces, a line-one row has room for a small photo;
//   cardWidth     which it pays for out of a wider column, not out of the player's name;
//   maxDepthRows  and one more backup before the "+N more" tail.
const SIDE_LAYOUT = {
  // D75 (Adam, 2026-09-15): no horizontal crop, so offense and defense pages share one scale instead of the
  // narrower offense cluster zooming to ~1.5x; spare height becomes air between rows (fillHeight).
  crop: false, fillHeight: true, headshot: true, cardWidth: SIDE_CARD_W, maxDepthRows: SIDE_MAX_DEPTH_ROWS,
};

export async function renderZoomSide(root, search, abbr, unit) {
  search.hidden = true;
  disposeCurrentView(); // the outgoing view's observers must not outlive its DOM
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

  const sideView = unitView(view, unit);
  const hasSlots = (sideView.units[unit] || []).length > 0;

  // D59: the shared nav strip — same position, same job (Team/Offense/Defense/Matchup pills, the current
  // one lit), plus the team switcher. The D50 heat summary does NOT repeat here (2026-09-14 follow-up):
  // it already shows once as the red chip inside headerHtml, right below. The field is mounted EMPTY
  // first so mountTeamField can measure the real box before deciding how wide a canvas to build — the
  // same two-phase approach the team and matchup pages use (see viewfit.js's mountScaledField).
  // D75: hasSlots uses the exact same `<div class="team-body">` (field-outer + aside.player-panel) the
  // whole-team page renders (team.js's teamBodyHtml) instead of a field-outer-only copy that had nowhere
  // for the panel to open into — that gap is what forced main.js's openPlayerPanel to always fall back to
  // re-rendering the whole-team page when a card was clicked here. The no-slots placeholder keeps its own
  // markup: there is nothing to click, so no panel is needed.
  root.innerHTML = `<div class="zoom-page">
    ${navStripHtml({ teams, abbr: A, page: unit === "OFF" ? "off" : "def", primary: team.colourPrimary, secondary: team.colourSecondary })}
    ${headerHtml(team, view, fromFixture, teams)}
    ${hasSlots ? teamBodyHtml(team) : `<div class="team-body"><div class="placeholder">No ${esc(unitLabel.toLowerCase())} slots on this chart.</div></div>`}
  </div>`;
  wireNav(root); // D59: switcher routes to the equivalent page (same side) on the newly picked team
  wireHeaderControls(root, A, view, team, () => renderZoomSide(root, search, A, unit), unit === "OFF" ? "off" : "def");
  // mountTeamField registers its own teardown with viewfit.js. It is the team page's own mount: the same
  // measure/spread/draw/rescale/settle loop, the same delegated card clicks, the same name-fitting pass.
  // D134: these pages take step (3) only — no chrome to fold and no depth to give up, since they already
  // fit at laptop sizes. Their own floor, because a backup row here prints at the base 11px, not 12.5px.
  if (hasSlots) mountTeamField(root, sideView, team, A, SIDE_LAYOUT, { floor: SIDE_MIN_READABLE_SCALE });
}

// ---- group view (one position group, every slot side by side) ----

// D49: the group view is one zoom step in from the side view, so its cards are noticeably bigger — the
// first (line-one) row biggest of all, the rest a size down. D72 turned the side view into scaled-up
// overview ROWS with a 28px headshot on line one, so these are now the only real photo cards in the app
// and the zoom ladder (group > side > whole team) still reads as one step per level. Sized tall enough for
// a bio line AND a role tag on top of the head/crest/name/label stack the side view has, plus a bigger
// rating pill.
// RULING E: the group view fills the screen with its big cards — a deep group (three-plus rows) can
// otherwise fall off the bottom of a 900px window. These stay the biggest cards in the app by a wide
// margin (D49's zoom ladder is intact — group > side > whole team), just sized so three tiers of them fit
// the window. Deeper than GROUP_MAX_ROWS collapses behind a "+N more" that expands on click.
// The group grid spans the whole container, one equal fraction per slot, so a lone QB column is a large
// card rather than a narrow sliver marooned in a sea of black. `fluid` makes the card fill its grid cell up
// to a sane cap (a single column must not become a 1500px-wide card); fitToViewport's fill mode then
// scales the whole grid so the cards also consume the leftover HEIGHT.
const GROUP_LINE_ONE = { height: 196, headSize: 78, big: true, fluid: true };
const GROUP_REST = { height: 168, headSize: 56, big: true, fluid: true };
// A shallow WIDE group (QB, or a safety pair — at most GROUP_WIDE_MAX slots) has a lot of vertical budget
// and only 3-4 rows to spend it on, so the fitToViewport fill-mode scale-up alone can leave dead space at
// the bottom. Taller rows for the wide layout only (portrait groups are already tuned to their own budget)
// spend that budget directly instead of relying on the scale factor to find it.
const GROUP_LINE_ONE_WIDE = { height: 214, headSize: 84, big: true, fluid: true };
const GROUP_REST_WIDE = { height: 180, headSize: 60, big: true, fluid: true };
// The cap on a fluid card's width, by how many slots share the row. A ten-column group wants narrow
// cards; a one-column group (QB) wants a genuinely big one, since the alternative is a narrow sliver
// stranded in the middle of the screen — but not a 1500px-wide card either.
// With one or two slots the group switches to a HORIZONTAL card (headshot left, everything else stacked
// against it on the right — see .group-wide in zoom.css) and is allowed to run wider, because that layout
// actually fills the width instead of centring a narrow column of text in it.
const GROUP_WIDE_MAX = 2;
// The cap is applied to the COLUMN, not to each card (zoom.css's .zoom-stack-body): a rank row can be a
// single card, a co-starter pair or an out-starter/fill-in stack, and capping each of those separately
// would let them end up different widths with different left edges.
// A single-column group (QB) draws the WIDE horizontal card (group-wide, above), which is built to fill
// real width without going strange, so its cap is raised to actually reach the container rather than
// stopping two-thirds of the way there.
const groupCardCap = (n) => (n <= 1 ? 1600 : n === 2 ? 720 : 400);
const GROUP_MAX_ROWS = 3;

function tierRow(n, cardHtml) {
  const num = n == null ? "" : esc(String(n));
  return `<div class="tier-row"><span class="tier-num">${num}</span>${cardHtml}</div>`;
}

// field.js's own `starterLed`, which that file does not export: a column is led by a starter when its
// line-one man is a co-starter or carries one of the roles the server gives the man holding a column
// (D12's listed-OUT starter and D44's ACTIVE fill-in included). Only a starter-led leftover column takes a
// receiver number when the slot men are lifted out (D92/D93) — a column holding nothing but backups is not
// a number-two receiver, so it prints a plain "WR". Kept in step with field.js by hand, the same way this
// file's statusBadge/ratingPill helpers are kept in step with cards.js's.
const STARTER_LED_ROLES = new Set(["STARTER", "STARTER_OUT", "ACTIVE"]);
const starterLed = (slot) => {
  const lineOne = slot?.players?.[0];
  return !!lineOne && (lineOne.coStarter === true || STARTER_LED_ROLES.has(lineOne.role));
};

// D93 on the GROUP page. The team, offense and matchup pages all draw their receivers through field.js's
// layoutPassCatchers, which lifts the men who play inside into their own WR · Slot column and renumbers
// what survives WR1, WR2 down the row. D70 ("names consistent everywhere") makes the regrouped column the
// chart on every view, so the WR band here goes through the SAME regrouper, handed the same input the
// field hands it (the club's own column order), and is drawn in the same left-to-right order the field's
// pass-catcher row uses — rather than building its stacks straight from the API's own unregrouped slots.
//
// A column is `{ slot, label, reason }`: `label` is the pill AND the position line on every card standing
// in it (field.js calls the same thing `displayLabel`), and `reason` the tooltip sentence — the D86
// "who plays inside" sentence on the derived column, columnRankReason's provenance sentence on a club one.
// Every other band, and a receiver chart with nobody over the slot bar, comes back exactly as the API
// listed it, labels and all.
export function groupColumns(slots, band) {
  // D143: the club's own Sam/Mike/Will/Rush word rides on the label here too, so the group page's pill and
  // every card's position line in it read the same "OLB · Rush" the field's column pill prints.
  const plain = () => slots.map((slot) => ({ slot, label: withClubRole(slot.label, slot), reason: null }));
  if (band !== "WR") return plain();
  const grouped = regroupSlotReceivers(slots);
  if (!grouped) return plain();
  const slotCol = { slot: grouped.slot, label: grouped.slot.label, reason: grouped.reason, derived: true };
  let wrRank = 0;
  const clubCols = grouped.kept.map((slot) => {
    const label = starterLed(slot) ? `WR${++wrRank}` : "WR";
    return { slot, label, reason: columnRankReason(slot, label) };
  });
  // layoutPassCatchers' own placement, minus the tight ends (they have their own group page): the outside
  // receiver, the Slot column inside him, any further club columns, and the last club column on the right.
  // One club column left keeps the left end with the Slot column inside it; none left (every charted
  // receiver plays inside) leaves the Slot column standing alone.
  return clubCols.length > 1
    ? [clubCols[0], slotCol, ...clubCols.slice(1, -1), clubCols[clubCols.length - 1]]
    : [...clubCols, slotCol];
}

// D91: `unit`/`gamesPlayed` ride along on the same size objects (lineOne/rest) fullCard already takes as
// its own `opts` — renderZoomGroup is the one caller in this file that has both a known unit (BAND_UNIT)
// and the TeamView's own header.record in scope, so it is the only place in the whole front end that can
// pass gamesPlayed through without inventing a new way to ask for it (see cards.js's snapHistoryHtml for
// why every other caller omits it).
// `col` is one of groupColumns' entries above (never a raw slot), so the pill, the tooltip and every
// card's position line come from the column the men are actually drawn in. Exported for the tests.
export function renderGroupStack(col, teamAbbr, wide = false, unit, gamesPlayed) {
  const slot = col.slot;
  const posLabel = col.label;
  const lineOne = { ...(wide ? GROUP_LINE_ONE_WIDE : GROUP_LINE_ONE), wide, unit, gamesPlayed, posLabel };
  const rest = { ...(wide ? GROUP_REST_WIDE : GROUP_REST), wide, unit, gamesPlayed, posLabel };
  const hatched = slot.shadedByDefault ? " column-shaded" : "";
  const players = slot.players;
  // Lead ruling (2026-09-11, item 8): same "one slot, two names" label treatment as the side view, for
  // the same reason — an explicit coStarter pair at tier 1.
  // `!col.derived` is cards.js's own guard (D83): two men in the WR · Slot column may each be a co-starter
  // of the club column he came from, but they are not co-starters of each other, so the suffix must not
  // follow them into a column the layout built.
  const isPair = players.length >= 2 && players[0].coStarter && players[1].coStarter && !col.derived;
  const labelText = isPair ? `${col.label} · co-starters` : col.label;
  const rows = [];
  let i = 0;
  let rowIndex = 0;
  while (i < players.length) {
    const p = players[i];
    const next = players[i + 1];
    const size = rowIndex === 0 ? lineOne : rest;
    // D44/D12: an OUT starter and his ACTIVE fill-in read as tier "1" side by side, exactly like an
    // explicit coStarter pair — not "0"/"1" as sequential rows. This covers BOTH conventions the compile
    // step uses for "starter out, someone else filling in" (isFullyOut's own comment above has the full
    // explanation): an explicit coStarter:true pair, or a plain STARTER_OUT role followed by an ACTIVE one.
    const isCoPair = p.coStarter && next?.coStarter;
    const isOutFillIn = !isCoPair && isFullyOut(p) && next?.role === "ACTIVE";
    if (isCoPair || isOutFillIn) {
      // A co-starter PAIR is two men sharing one job, so they sit side by side. An out starter and his
      // ACTIVE fill-in are not a pair — they are D44's "how good was the hurt man, how good is his
      // replacement", which only reads as a comparison when the two ratings sit one directly above the
      // other, so they stack instead.
      const body = isCoPair
        ? `<div class="costarter-pair">${fullCard(p, teamAbbr, size)}${fullCard(next, teamAbbr, size)}</div>`
        : `<div class="outfillin-stack">${fullCard(p, teamAbbr, size)}${fullCard(next, teamAbbr, size)}</div>`;
      rows.push(tierRow(rowIndex + 1, body));
      i += 2;
    } else {
      // Numbered by DEPTH POSITION in this column (1, 2, 3...), not by the club chart's own tier value —
      // two men listed at the same tier is common, and a co-starter pair or an out-starter/fill-in row
      // collapses two rows into one, so the club's own tier numbers would repeat.
      rows.push(tierRow(rowIndex + 1, fullCard(p, teamAbbr, size)));
      i += 1;
    }
    rowIndex++;
  }
  // Ruling E: rows past the cap collapse behind a "+N more" button that reveals them in place
  // (cards.js's wireDepthToggles drives it).
  const visible = rows.slice(0, GROUP_MAX_ROWS);
  const hiddenRows = rows.slice(GROUP_MAX_ROWS);
  const rowsHtml = hiddenRows.length
    ? `${visible.join("")}<button type="button" class="depth-more" aria-expanded="false">+${hiddenRows.length} more</button><span class="depth-extra">${hiddenRows.join("")}</span>`
    : visible.join("");
  // D70: same band-hue pill as the main field and the side view — every slot on a group page shares one
  // band, so the tint is uniform here, but it stays the same colour a viewer just saw on the team page.
  // D93: the pill's tooltip is the same sentence the field's own column label carries (cards.js's
  // labelTitle) — why these men are the ones standing in the slot, or where a renumbered club column's
  // number came from — so a reader who questions a pill gets the same answer on either page.
  const labelTitle = col.reason ? ` title="${esc(col.reason)}"` : "";
  return `<div class="zoom-stack${hatched}${stackHeatClass(slot)}" data-slot-id="${esc(slot.slotId)}"${stackHeatTitle(slot)}>
    <div class="zoom-stack-label" data-band="${esc(slot.band || "")}"${labelTitle}>${esc(labelText)}</div>
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
  disposeCurrentView(); // the outgoing view's observers must not outlive its DOM
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

  // D91: the same wins+losses+ties reading server/compile/coverage.js's own playerRecords() uses for
  // "how many games has this club played" — the one figure the tooltip's "Games he missed leave a gap"
  // sentence needs and the one place in this file's own call chain that still has view.header on hand.
  const rec = view.header?.record;
  const gamesPlayed = rec ? (rec.wins ?? 0) + (rec.losses ?? 0) + (rec.ties ?? 0) : null;
  // D93: the WR band is regrouped exactly as the field regroups it before anything is measured or drawn,
  // so the grid is sized for the columns that will actually appear — a club column emptied into the
  // WR · Slot column is never given a slice of the grid and then left blank.
  const columns = groupColumns(slots, band);
  const wide = columns.length <= GROUP_WIDE_MAX;
  const stacksHtml = columns.map((col) => renderGroupStack(col, A, wide, unit, gamesPlayed)).join("");
  const trayHtml = unlistedEntries.length ? renderUnlistedStack(unlistedEntries, A) : "";

  // D59: same shared strip as the side view, with the group's band as a trailing crumb (linking nowhere —
  // it names the band you're already looking at) instead of the old breadcrumb's second segment.
  root.innerHTML = `<div class="zoom-page">
    ${navStripHtml({ teams, abbr: A, page: "group", unit, bandLabel, bandSlug: band.toLowerCase(), primary: team.colourPrimary, secondary: team.colourSecondary })}
    ${headerHtml(team, view, fromFixture, teams)}
    ${topOfUnitHtml(slots)}
    <div class="fit-outer"><div class="fit-inner"><div class="zoom zoom-group${wide ? " group-wide" : ""}" style="--group-cols:${Math.max(columns.length, 1)};--card-cap:${groupCardCap(columns.length)}px">${stacksHtml || `<div class="placeholder">No ${esc(bandLabel)} slots on this chart.</div>`}${trayHtml}</div></div></div>
  </div>`;
  // Fill mode: the grid is laid out at the container's own width and scaled so the cards use the leftover
  // height too, instead of a fixed design width that would leave most of the screen black.
  fitToViewport(root, { fill: true });
  wireDepthToggles(root); // ruling E: the "+N more" tail on a group stack deeper than GROUP_MAX_ROWS
  wireNav(root); // D59: switcher routes to the same band on the newly picked team
  wireHeaderControls(root, A, view, team, () => renderZoomGroup(root, search, A, bandParam), "group");
}
