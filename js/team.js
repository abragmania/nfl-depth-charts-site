import { getTeams, getTeam, invalidateTeam } from "./api.js";
import { computeLayout, renderFieldSvg, renderLevelLabels } from "./field.js";
import { renderColumn, renderTray, esc, fitNames } from "./cards.js";
import { mountScaledField, disposeCurrentView } from "./viewfit.js";
import { navStripHtml, wireNav } from "./nav.js";

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
export function headerHtml(team, view, fromFixture = false, teams) {
  const rec = view.header?.record ?? team.record;
  const bye = view.header?.byeWeek ?? team.byeWeek;
  const opp = view.header?.nextOpponent ?? team.nextOpponent;
  const oppTeam = opp ? teams.find((t) => t.abbr === opp.abbr) : null;
  const schemeText = view.scheme ? esc(view.schemeLabel || view.scheme) : "Scheme unknown";
  const stale = ageHours(view.dataAsOf) > STALE_HOURS;

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
    <div class="teamhead-controls">
      <div class="chip-row">${chips.join("")}</div>
      <button type="button" class="refresh-btn">Refresh now</button>
      <span class="asof-chip ${stale ? "amber" : ""}" title="Data as of ${view.dataAsOf ? esc(new Date(view.dataAsOf).toLocaleString()) : dash}">as of ${view.dataAsOf ? esc(fmtAsOf(view.dataAsOf)) : dash}</span>
    </div>
  </div>`;
}

// D44 (Adam, 2026-09-11): a one-line, muted key above the field so a first-time viewer knows what the
// banners/badges/shading/card surface mean without having to ask.
// 🎨 Polish (2026-09-11, round 2, item 7): the legend used to cite internal decision numbers ("(D12)",
// "(D22)") straight in the UI — meaningless to anyone but the build team, and it also wrapped onto three
// lines at 1366px. Reworded to plain English and tightened to fit.
// Ruling E replaced the whole-team view's photo cards with text rows, so the first legend entry no longer
// describes a visible "STARTER" tag — on the overview the STARTER is simply the bold top row of a column.
// The wording follows the pixels rather than the other way round.
function legendHtml() {
  return `<div class="legend">
    <span><b>Bold top row</b> = opening-day starter</span>
    <span><span class="sw sw-out"></span><b>OUT</b> starter out</span>
    <span><span class="sw sw-active"></span><b>FILLING IN</b> active replacement</span>
    <span><span class="sw sw-q"></span>Q <span class="sw sw-d"></span>D <span class="sw sw-out"></span>OUT IR PUP NFI SUSP <span class="sw sw-inactive"></span>INACTIVE</span>
    <span><span class="sw sw-shaded"></span>▨ part-time</span>
    <span><span class="tier-strip"><span style="background:var(--tier-elite)"></span><span style="background:var(--tier-strong)"></span><span style="background:var(--tier-avg)"></span><span style="background:var(--tier-weak)"></span><span style="background:var(--tier-flat)"></span></span>▬ row tint = rating</span>
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
  const opts = { slotLookup, scheme: view.scheme };
  const columnsHtml = layout.columns.map((c) => renderColumn(c, teamAbbr, opts)).join("");
  const traysHtml = layout.trays.map((t) => renderTray(t, teamAbbr)).join("");
  const levelsHtml = renderLevelLabels(layout.levels, layout.layoutWidth);
  // layout.caption is null on a two-sided field (the SVG then labels both halves itself) and "OFFENSE" /
  // "DEFENSE" on a single-unit one, where it replaces the line of scrimmage as the thing naming the view.
  const svg = renderFieldSvg(layout.layoutHeight, layout.losY, layout.layoutWidth, layout.caption);
  // D48: a faint, large team-logo watermark centred behind the cards — never competing with them, so
  // it lives in the CSS background (low opacity, no pointer events) rather than as a real <img> element.
  const watermarkUrl = team.logoDark || team.logo || "";
  return {
    layout,
    html: `
    <div class="field-outer" style="--team-primary:${team.colourPrimary};--team-secondary:${team.colourSecondary}">
      <div class="field-scale" style="width:${layout.layoutWidth}px;height:${layout.layoutHeight}px">
        ${watermarkUrl ? `<div class="field-watermark" style="background-image:url('${esc(watermarkUrl)}')"></div>` : ""}
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
// 🔵 delta review: it used to be a second copy of that logic, which is how the two drifted and how the
// missing teardown turned into "the team page's observer overwrites the matchup's field".
// D72: exported, because the offense and defense pages are this same field — zoom.js hands it a TeamView
// carrying one unit plus the single-unit layout options, and gets the identical measure/spread/draw/
// rescale/settle loop, delegated card clicks and name-fitting pass rather than a parallel implementation.
export function mountTeamField(root, view, team, teamAbbr, layoutOpts = {}) {
  const panel = root.querySelector(".player-panel");
  return mountScaledField({
    root,
    probe: computeLayout(view, layoutOpts), // pure and cheap: the natural (unspread) canvas, for the spread maths
    build: (spread, minHeight) => fieldHtml(view, team, { ...layoutOpts, spread, minHeight }),
    fillHeight: !!layoutOpts.fillHeight, // D72: single-unit pages spend spare height on air between rows
    panel,
    observe: [root.querySelector(".nav-strip"), root.querySelector(".teamhead"), root.querySelector(".legend")],
    onDraw: (el) => { wireFieldClicks(el, teamAbbr); fitNames(el); },
    // 🔵 review finding 8: a name that fits at one scale can stop fitting at another (a webfont swap, a
    // window resize, the panel opening), so the abbreviate-don't-truncate pass runs on every scale
    // change, not only when the markup is rebuilt.
    onScale: (el) => fitNames(el),
  });
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
  // observer still pointed at the old DOM is exactly what let one page overwrite another (🔵 review 1).
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

  // The field is mounted EMPTY first so mountTeamField can measure the real box (header height, legend
  // wrapping, the window) before it decides how wide a canvas to ask field.js for — see mountTeamField.
  // D59: the shared nav strip renders first, directly under the app bar, on every team-context page.
  root.innerHTML = `
    ${navStripHtml({ teams, abbr: A, page: "team", primary: team.colourPrimary, secondary: team.colourSecondary })}
    ${headerHtml(team, view, fromFixture, teams)}
    ${legendHtml()}
    <div class="team-body">
      <div class="field-outer" style="--team-primary:${team.colourPrimary};--team-secondary:${team.colourSecondary}"></div>
      <aside class="player-panel" hidden></aside>
    </div>
    `;

  // Integration task 1 (2026-09-11): the router keys the player panel off whichever view last rendered,
  // not off this module specifically — main.js reads this cache to open/close the panel without
  // re-rendering the view underneath it. zoom.js sets the same shape for its own views.
  window.__nflView = { abbr: A, view, teamMeta: team };

  wireNav(root); // D59: switcher routes to the equivalent page on the newly picked team

  // Integration task 2: "Refresh now" kicks off a server-side refresh cycle (window.NFLRefresh, from
  // refresh.js — main.js imports it for this side effect) and reloads this team once it's done. The
  // listener is added once per render (a fresh header each time) rather than delegated, since there's
  // only ever one such button on the page.
  root.querySelector(".refresh-btn")?.addEventListener("click", (e) => {
    window.NFLRefresh?.trigger(e.currentTarget);
  });
  // 🔵 review: `{ once: true }` only removes a listener after it FIRES, so every re-render added another
  // that never did. The previous one is dropped explicitly before a new one is registered.
  if (teamRefreshListener) window.removeEventListener("nfl:data-refreshed", teamRefreshListener);
  teamRefreshListener = () => {
    if (window.__nflView?.abbr !== A) return; // navigated away before the refresh finished — stale, ignore
    invalidateTeam(A);
    renderTeam(root, search, A, playerKey);
  };
  window.addEventListener("nfl:data-refreshed", teamRefreshListener, { once: true });

  mountTeamField(root, view, team, A); // registers its own teardown with viewfit.js
  highlightSelected(root, playerKey);
}
