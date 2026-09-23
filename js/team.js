import { getTeams, getTeam, invalidateTeam } from "./api.js";
import { computeLayout, renderFieldSvg, renderLevelLabels, FIELD_VARIANT, REDUCED_DEPTH_ROWS } from "./field.js";
import { renderColumn, renderTray, esc, fitNames, wireDepthToggles, espnSchemeOf, unitTagsHtml } from "./cards.js";
import { mountScaledField, disposeCurrentView, MIN_READABLE_SCALE, decideViewMode, HEADER_FOLD_WIDTH } from "./viewfit.js";
import { navStripHtml, wireNav } from "./nav.js";
import { renderPhoneList } from "./phonelist.js";

const dash = "—";
const STALE_HOURS = 36;

const record = (r) => (r ? `${r.wins}-${r.losses}${r.ties ? "-" + r.ties : ""}` : dash);

function fmtKickoff(iso) {
  if (!iso) return dash;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return dash;
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Ruling E: the header is one line, and the full "9/13/2026, 11:15:33 AM" was ~50px of that line spent on
// a seconds value nobody reads. Short form on the chip, the full timestamp in its title.
function fmtAsOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return dash;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ageHours(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 3_600_000;
}

// D50 (guarded — a compile builder is adding view.heat alongside this build; render nothing extra for
// a team compiled before that field existed): "Defense: 4 out, 1 critical · Offense: 1 out".
function heatSummaryChip(view) {
  if (!view.heat?.summary) return "";
  return `<span class="chip chip-heat" title="Injury impact vs. each slot's opening starter">${esc(view.heat.summary)}</span>`;
}

// Exported so the zoom/matchup views can reuse the exact same header instead of re-deriving their own
// (integration note, 2026-09-11) — team/view/teams are the same shapes renderTeam already works with;
// fromFixture defaults to false since most callers other than this file's own renderTeam() won't have
// that flag handy.
// D111: `withLegend` is opt-in and defaults to false, so zoom.js's offense/defense and player pages — which
// call this same header and which the ruling leaves alone ("nothing else changes there") — are untouched.
// Only the whole-team page asks for the legend inside its banner.
export function headerHtml(team, view, fromFixture = false, teams, withLegend = false) {
  const rec = view.header?.record ?? team.record;
  const bye = view.header?.byeWeek ?? team.byeWeek;
  const opp = view.header?.nextOpponent ?? team.nextOpponent;
  const oppTeam = opp ? teams.find((t) => t.abbr === opp.abbr) : null;
  const schemeText = view.scheme ? esc(view.schemeLabel || view.scheme) : "Scheme unknown";
  const stale = ageHours(view.dataAsOf) > STALE_HOURS;
  // The compact header hides the "as of" chip to stay on one line, so the timestamp it
  // carries has to be somewhere that is always on the page — the Refresh button's own tooltip.
  const asOfFull = view.dataAsOf ? esc(new Date(view.dataAsOf).toLocaleString()) : dash;

  const oppHtml = opp
    ? `<span class="opp">${opp.home ? "vs" : "@"} ${oppTeam ? `<img class="opp-logo" src="${esc(oppTeam.logo)}" alt="${esc(opp.abbr)}">` : ""}${esc(opp.abbr)} · ${fmtKickoff(opp.kickoff)}</span>`
    : `<span class="opp">${dash}</span>`;

  const chips = [heatSummaryChip(view)];
  if (view.chartSource === "espn") chips.push(`<span class="chip chip-warn" title="The club depth-chart page could not be read; showing ESPN's chart instead.">chart: ESPN (club page unavailable)</span>`);
  if (fromFixture) chips.push(`<span class="chip chip-sample" title="The live /api/team endpoint is not compiled yet; showing bundled sample data.">sample data</span>`);

  // Ruling E (Adam, 2026-09-13): one line. The name, record, next opponent, bye and scheme now sit on
  // the SAME row as the controls instead of stacking three deep, and the crest shrinks from 96px to
  // 38px — every pixel this header used to spend came straight out of the field's height budget, and the
  // field is the thing that has to fit. Nothing is dropped: the same facts are all still here, and the
  // chips (heat summary, ESPN-fallback warning, sample data) are the only part allowed to wrap, because
  // most of the time there aren't any. D59: the team switcher and the Offense/Defense/Matchup pills moved
  // out of this header into the shared nav strip (nav.js) that now sits above every team-context page.
  return `
  <div class="teamhead" style="--team-primary:${team.colourPrimary};--team-secondary:${team.colourSecondary}">
    <img src="${esc(team.logoDark)}" alt="${esc(team.abbr)}">
    <div class="teamhead-main">
      <h1>${esc(team.name)}</h1>
      <div class="meta">
        <span>${record(rec)}</span>
        <span>Next: ${oppHtml}</span>
        <span>Bye ${bye ?? dash}</span>
        <span>${schemeText}</span>
      </div>
    </div>
    ${withLegend ? legendHtml("legend-banner") : ""}
    <div class="teamhead-controls">
      <div class="chip-row">${chips.join("")}</div>
      <button type="button" class="refresh-btn" title="Refresh now · data as of ${asOfFull}">Refresh now</button>
      <span class="asof-chip ${stale ? "amber" : ""}" title="Data as of ${asOfFull}">as of ${view.dataAsOf ? esc(fmtAsOf(view.dataAsOf)) : dash}</span>
    </div>
  </div>`;
}

// D44 (Adam, 2026-09-11): a one-line, muted key above the field so a first-time viewer knows what the
// banners/badges/shading/card surface mean without having to ask, worded in plain English (never internal
// decision numbers) and tight enough to fit on one line at 1366px.
// Ruling E replaced the whole-team view's photo cards with text rows, so the first legend entry no longer
// describes a visible "STARTER" tag — on the overview the STARTER is simply the bold top row of a column.
// The wording follows the pixels rather than the other way round.
//
// D111 (Adam, 2026-09-16) — "the legend line under the team banner moves INTO the banner row". The KEY ITSELF
// is unchanged: every item (bold starter, OUT, FILLING IN, Q/D, IR PUP NFI SUSP, INACTIVE, part-time and the
// rating-tint strip) is still here in the same words and the same order. Only where it is printed moves, and
// it moves by a class: `legend-banner` (styles.css) is the same key re-set smaller, right-aligned and on a
// dark plate so it reads on any club's colour, sitting in the banner's own row between the club's details
// and its controls. Because it is now INSIDE .teamhead, whose height is set by the 38px crest, the banner
// does not grow and the line the legend used to occupy goes to the field.
// D134 (Adam, 2026-09-17): "the legend must never wrap to a second or third line." On a window too short to
// draw the field readably the key collapses to the one "Legend" chip below, which shows the whole key on
// hover or tap (styles.css's `.legend-collapsed`). `.legend-items` is `display:contents` until then, so the
// six items stay direct flex children of `.legend` and every window big enough today renders identically.
export function legendHtml(extraClass = "") {
  return `<div class="legend${extraClass ? " " + extraClass : ""}">
    <button type="button" class="legend-chip" aria-label="Show the key">Legend</button>
    <span class="legend-items">
    <span><b>Bold top row</b> = opening-day starter</span>
    <span><span class="sw sw-out"></span><b>OUT</b> starter out</span>
    <span><span class="sw sw-active"></span><b>FILLING IN</b> active replacement</span>
    <span><span class="sw sw-q"></span>Q <span class="sw sw-d"></span>D <span class="sw sw-out"></span>OUT IR PUP NFI SUSP <span class="sw sw-inactive"></span>INACTIVE</span>
    <span><span class="sw sw-shaded"></span>▨ part-time</span>
    <span><span class="tier-strip"><span style="background:var(--tier-elite)"></span><span style="background:var(--tier-strong)"></span><span style="background:var(--tier-avg)"></span><span style="background:var(--tier-weak)"></span><span style="background:var(--tier-flat)"></span></span>▬ row tint = rating</span>
    </span>
  </div>`;
}

function slotLookupFor(view) {
  const map = new Map();
  for (const unit of ["OFF", "DEF"]) for (const s of view.units?.[unit] || []) map.set(s.slotId, s.label);
  return (slotId) => map.get(slotId);
}

// `layoutOpts` is passed straight through to field.js's computeLayout: the whole-team page passes only
// the spread, and D72's offense/defense pages add crop/headshot/maxDepthRows so the same engine draws one
// unit, scaled up, with no line of scrimmage (see zoom.js's SIDE_LAYOUT).
function fieldHtml(view, team, layoutOpts = {}) {
  const teamAbbr = team.abbr;
  const layout = computeLayout(view, layoutOpts);
  const slotLookup = slotLookupFor(view);
  // D137: `scheme` places the front (the club's own), `espnScheme` reads ESPN's codes (ESPN's own).
  const opts = { slotLookup, scheme: view.scheme, espnScheme: espnSchemeOf(view) };
  const columnsHtml = layout.columns.map((c) => renderColumn(c, teamAbbr, opts)).join("");
  const traysHtml = layout.trays.map((t) => renderTray(t, teamAbbr)).join("");
  const levelsHtml = renderLevelLabels(layout.levels, layout.layoutWidth);
  // layout.caption is null on a two-sided field (the SVG then labels both halves itself) and "OFFENSE" /
  // "DEFENSE" on a single-unit one, where it replaces the line of scrimmage as the thing naming the view.
  const svg = renderFieldSvg(layout.layoutHeight, layout.losY, layout.layoutWidth, layout.caption);
  // D48/D95: a large, clearly-visible team-logo watermark centred behind the cards — never competing with
  // them, so it lives in the CSS background (z-index 0, no pointer events) rather than as a real <img>
  // element. The URL goes through the --wm-url custom property (not a direct background-image) so styles.
  // css's own light-plate layer can sit behind the crest in the same background-image stack (D95).
  // Root-relative: a relative url() inside a custom property resolves against the STYLESHEET's own URL
  // (styles.css lives at /css/), not the document's, so the plain "img/logos/WAS-dark.png" the API returns
  // would 404 at /css/img/logos/WAS-dark.png and the watermark would silently vanish.
  let watermarkUrl = team.logoDark || team.logo || "";
  if (watermarkUrl && !/^https?:\/\//.test(watermarkUrl) && !watermarkUrl.startsWith("/")) watermarkUrl = "/" + watermarkUrl;
  // The field-variant's "B" wash lightens the surface around the real line of scrimmage, so it needs the
  // same --los-pct a matchup page already carries; a single-unit side page has no losY (D72), so it falls
  // back to the vertical middle rather than lighting up a spot that means nothing on that page.
  const losPct = layout.losY != null ? ((layout.losY / layout.layoutHeight) * 100).toFixed(2) + "%" : "50%";
  return {
    layout,
    html: `
    <div class="field-outer" data-field-variant="${FIELD_VARIANT}" style="--team-primary:${team.colourPrimary};--team-secondary:${team.colourSecondary};--los-pct:${losPct}">
      <div class="field-scale" style="width:${layout.layoutWidth}px;height:${layout.layoutHeight}px">
        <div class="field-watermark"${watermarkUrl ? ` style="--wm-url:url('${esc(watermarkUrl)}')"` : ` data-no-crest="1"`}>${unitTagsHtml(layout, team, team)}</div>
        ${svg}
        <div class="field-layer">${columnsHtml}${traysHtml}</div>
        <div class="level-layer">${levelsHtml}</div>
      </div>
    </div>`,
  };
}

// RULING E (Adam, 2026-09-13): "it does not fit on my monitor yet and I have a big monitor." The field
// is scaled to fit the window on both axes, and the canvas it is built on is widened first so the spare
// width goes into the columns rather than into black margins. All of that - the measuring, the spread,
// the rebuild-if-the-first-measurement-was-wrong, the settle and the teardown - lives in viewfit.js's
// mountScaledField, which the matchup view uses too; this function is only the team-page specifics.
// D72: exported, because the offense and defense pages are this same field — zoom.js hands it a TeamView
// carrying one unit plus the single-unit layout options, and gets the identical measure/spread/draw/
// rescale/settle loop, delegated card clicks and name-fitting pass rather than a parallel implementation.
// D134: the options that put a page into the "less depth" step — one backup per column and an expanding
// "+N more" chip. One object, imported by whoever mounts a field, so the reduced probe the cascade measures
// and the markup the page then draws can never be computed from different numbers.
export const REDUCED_DEPTH_OPTS = { maxDepthRows: REDUCED_DEPTH_ROWS, depthChip: true };

// `cascadeOpts` (D134): `floor` is this page's own readable-scale floor, `depth` whether it offers the
// less-depth step, `setCompact` its own chrome-folding hook, and `foldWidth` (D107) the window width below
// which that hook is held on for every club however well this one fits. A page that passes none of them keeps the
// team page's own defaults. D138 adds `setList`: only a page that knows how to draw itself as the phone
// list offers that step, which today is the Team page alone (step 1).
export function mountTeamField(root, view, team, teamAbbr, layoutOpts = {}, cascadeOpts = {}) {
  const panel = root.querySelector(".player-panel");
  let depthOpts = null; // set by the cascade's setDepth hook below; read by every build from here on
  const probe = computeLayout(view, layoutOpts); // pure and cheap: the natural (unspread) canvas, for the spread maths
  // D140: the same two canvases at THIS club's own natural height, for the scrolling state alone. Only a
  // two-sided canvas has a constant height to narrow — a single-unit page (Offense/Defense, no line of
  // scrimmage) is already drawn at its own rows' height, so it is handed none and behaves exactly as before.
  const ownHeightOpts = { ...layoutOpts, ownHeight: true };
  const own = probe.losY == null ? null : {
    full: computeLayout(view, ownHeightOpts),
    reduced: cascadeOpts.depth ? computeLayout(view, { ...ownHeightOpts, ...REDUCED_DEPTH_OPTS }) : null,
  };
  return mountScaledField({
    root,
    probe,
    build: (spread, minHeight, ownHeight) => fieldHtml(view, team, { ...layoutOpts, ...(depthOpts || {}), spread, minHeight, ownHeight }),
    fillHeight: !!layoutOpts.fillHeight, // D72: single-unit pages spend spare height on air between rows
    panel,
    observe: [root.querySelector(".nav-strip"), root.querySelector(".teamhead"), root.querySelector(".legend")],
    cascade: {
      floor: cascadeOpts.floor ?? MIN_READABLE_SCALE,
      reduced: cascadeOpts.depth ? computeLayout(view, { ...layoutOpts, ...REDUCED_DEPTH_OPTS }) : null,
      own, // D140
      setDepth: cascadeOpts.depth ? (on) => { depthOpts = on ? REDUCED_DEPTH_OPTS : null; } : null,
      setCompact: cascadeOpts.setCompact || null,
      // D107: the whole-team page hands in the width below which the key folds for EVERY club (see
      // HEADER_FOLD_WIDTH). The Offense/Defense pages print no key and pass nothing, so they never fold on
      // width alone — their header is one line at every width by CSS.
      foldWidth: cascadeOpts.foldWidth || 0,
      setList: cascadeOpts.setList || null, // D138: a window that has become a phone window re-renders the page
    },
    onDraw: (el) => { wireFieldClicks(el, teamAbbr); wireDepthToggles(el); fitNames(el); },
    // The names are fitted when the markup is drawn, and again once the real font has landed — the
    // one event that changes the answer. A scale change cannot: the whole field is one CSS transform, so
    // the name and the box it has to fit in scale together.
    onText: (el) => fitNames(el),
  });
}

// D134 step 1 on the whole-team page: the banner's key folds to its "Legend" chip (legendHtml above) and
// the banner stops being the tallest thing above the field. Nothing else in the header moves — the club,
// its record, next opponent, bye, scheme and controls all stay exactly where they are.
function setTeamCompact(root, on) {
  root.querySelector(".teamhead")?.classList.toggle("teamhead-compact", on);
  root.querySelector(".legend-banner")?.classList.toggle("legend-collapsed", on);
}

// D75: the field-plus-panel shell every team-context page mounts a field into — the whole-team page and,
// since D72 put the offense/defense pages on this same engine, those pages too. Exported so zoom.js's
// renderZoomSide can build the identical `<div class="team-body">` (empty `.field-outer` for mountTeamField
// to replace, plus the `<aside class="player-panel">` mountTeamField already looks for and panel.js already
// knows how to fill), so a card click on the offense/defense pages opens the panel in place instead of
// re-rendering the whole-team page.
export function teamBodyHtml(team) {
  return `<div class="team-body">
      <div class="field-outer" data-field-variant="${FIELD_VARIANT}" style="--team-primary:${team.colourPrimary};--team-secondary:${team.colourSecondary}"></div>
      <aside class="player-panel" hidden></aside>
    </div>`;
}

// Single delegated click listener for the whole field (review requirement E) instead of a listener
// per card — there can be a couple hundred player elements once a roster's full depth is on screen.
function wireFieldClicks(fieldOuter, teamAbbr) {
  fieldOuter.addEventListener("click", (e) => {
    const el = e.target.closest("[data-player-key]");
    if (!el || !fieldOuter.contains(el)) return;
    e.preventDefault();
    location.hash = `#/team/${encodeURIComponent(teamAbbr)}/player/${encodeURIComponent(el.dataset.playerKey)}`;
  });
}

function highlightSelected(root, selectedKey) {
  if (!selectedKey) return;
  const el = root.querySelector(`[data-player-key="${CSS.escape(selectedKey)}"]`);
  if (!el) return;
  el.classList.add("selected");
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
}

let teamRefreshListener = null;

export async function renderTeam(root, search, abbr, playerKey) {
  search.hidden = true;
  // Whatever view was on screen goes first: this function is about to replace root.innerHTML, and an
  // observer still pointed at the old DOM could let one page overwrite another.
  // The router guard disposes too; disposeCurrentView is idempotent, so both is deliberate.
  disposeCurrentView();
  const A = (abbr || "").toUpperCase();
  const { teams } = await getTeams();
  const team = teams.find((t) => t.abbr === A);
  if (!team) {
    document.title = "NFL Depth Charts";
    root.innerHTML = `<div class="notfound">No such team "${esc(abbr)}". <a class="back" href="#/">Back to all teams</a></div>`;
    return;
  }
  document.title = `${team.name} — NFL Depth Charts`;

  let view, fromFixture;
  try {
    ({ data: view, fromFixture } = await getTeam(A));
  } catch (e) {
    root.innerHTML = `<div class="notfound">Couldn't load ${esc(team.name)}'s depth chart: ${esc(e.message)} <a class="back" href="#/">Back to all teams</a></div>`;
    return;
  }

  // D138 step 1: an upright phone, or a tablet held upright, gets the vertical list instead of the field.
  // ONE decision function makes that call — viewfit.js's own cascade, measuring the window, never a
  // user-agent string and never a CSS media query. Everything below the branch is the field page,
  // untouched by the ruling.
  const nav = navStripHtml({ teams, abbr: A, page: "team", primary: team.colourPrimary, secondary: team.colourSecondary });
  const asList = decideViewMode() === "list";
  if (asList) {
    // The nav strip, the club header and the key are this module's markup; the list is handed them as
    // strings so the two files never import each other. The header goes in without its banner legend
    // (phonelist puts the key's own chip in the phone header instead).
    renderPhoneList(root, {
      view, team, abbr: A,
      chrome: { nav, header: headerHtml(team, view, fromFixture, teams, false), legend: legendHtml("legend-banner legend-collapsed") },
      rerender: () => renderTeam(root, search, A, playerKey),
    });
  } else {
    // The field is mounted EMPTY first so mountTeamField can measure the real box (header height, legend
    // wrapping, the window) before it decides how wide a canvas to ask field.js for — see mountTeamField.
    // D59: the shared nav strip renders first, directly under the app bar, on every team-context page.
    root.innerHTML = `
      ${nav}
      ${headerHtml(team, view, fromFixture, teams, true)}
      ${teamBodyHtml(team)}
      `;
  }

  // The router keys the player panel off whichever view last rendered, not off this module specifically —
  // main.js reads this cache to open/close the panel without re-rendering the view underneath it. zoom.js
  // sets the same shape for its own views.
  // `page` (D75) tells main.js's openPlayerPanel whether the page currently on screen is one that carries
  // a `<aside class="player-panel">` it can open the panel into in place ("team"/"off"/"def") — the group
  // and matchup pages don't set this at all, so main.js's default fallback (re-render the whole-team page)
  // still applies to them, unchanged.
  window.__nflView = { abbr: A, view, teamMeta: team, page: "team" };

  if (!asList) wireNav(root); // D59: switcher routes to the equivalent page on the newly picked team (the list wires its own)

  // "Refresh now" kicks off a server-side refresh cycle (window.NFLRefresh, from refresh.js — main.js
  // imports it for this side effect) and reloads this team once it's done. The listener is added once per
  // render (a fresh header each time) rather than delegated, since there's only ever one such button on
  // the page.
  root.querySelector(".refresh-btn")?.addEventListener("click", (e) => {
    window.NFLRefresh?.trigger(e.currentTarget);
  });
  // `{ once: true }` only removes a listener after it FIRES, so every re-render would add another that
  // never did. The previous one is dropped explicitly before a new one is registered.
  if (teamRefreshListener) window.removeEventListener("nfl:data-refreshed", teamRefreshListener);
  teamRefreshListener = () => {
    if (window.__nflView?.abbr !== A) return; // navigated away before the refresh finished — stale, ignore
    invalidateTeam(A);
    renderTeam(root, search, A, playerKey);
  };
  window.addEventListener("nfl:data-refreshed", teamRefreshListener, { once: true });

  if (asList) { highlightSelected(root, playerKey); return; }
  // D134: the whole-team page offers all three steps — fold the legend into its chip, then one backup per
  // column behind a "+N more" chip, then the readable floor with the page scrolling. D138 adds a fourth
  // answer above all of them: a window narrow enough for the list re-renders this page as the list.
  // D146 (4): `fillHeight` — with the player panel open the field is WIDTH-bound and the height fit
  // goes unused, so the rows spread into it instead of leaving a bare strip under the field (field.js's
  // bothSides branch). It is inert whenever the height binds, which is every window with the panel shut.
  mountTeamField(root, view, team, A, { fillHeight: true }, {
    depth: true,
    // D107: below this width the key folds into its chip for every one of the 32 clubs,
    // whether or not this club's own header would have wrapped, so the field starts at the same y and draws
    // at the same scale on every club's page.
    foldWidth: HEADER_FOLD_WIDTH,
    setCompact: (on) => setTeamCompact(root, on),
    setList: () => renderTeam(root, search, A, playerKey),
  });
  highlightSelected(root, playerKey);
}
