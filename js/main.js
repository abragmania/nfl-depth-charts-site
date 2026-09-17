import * as router from "./router.js";
import { renderLanding } from "./landing.js";
import { renderTeam } from "./team.js";
import { renderZoomSide, renderZoomGroup } from "./zoom.js";
import { renderMatchup } from "./matchup.js";
import { openPanel } from "./panel.js";
import { esc } from "./cards.js";
import { disposeCurrentView } from "./viewfit.js";
import "./refresh.js"; // side effect only: defines window.NFLRefresh

const root = document.getElementById("app");
const search = document.getElementById("search");
const asof = document.getElementById("asof");
// Ruling E trimmed <main>'s padding right down so the team pages fit 1700x900 with no scrolling. The
// landing grid has no such constraint and reads better with room around it, so it keeps the old padding
// through one marker class (styles.css's `main.page-landing`) that every route clears on entry and only
// the landing route puts back.
// ONE teardown point for the whole app: every route change disposes the outgoing view's observers, timers
// and listeners before the incoming one renders — without it, a view navigated away from could keep a
// ResizeObserver on <main> that re-measures its own detached field and overwrites whatever page is on
// screen. `keepView` is the one exception: the player sub-route opens a panel on the page that is ALREADY
// rendered without re-rendering it (openPlayerPanel below), so tearing that page down would leave the
// field it is opening the panel on with nothing left to re-fit it.
const guard = (fn, { keepView = false } = {}) => (p) => {
  root.classList.remove("page-landing");
  if (!keepView) disposeCurrentView();
  // e.message can carry anything (a network error string, etc.); esc() it before it reaches innerHTML.
  return fn(p).catch((e) => { root.innerHTML = `<div class="notfound">Something broke: ${esc(e.message)}</div>`; });
};

// Finds a player card anywhere in an already-loaded TeamView — the depth-chart columns, or the
// "not on chart" trays — by playerKey. Used so a #/team/X/player/Y navigation can open the panel
// without re-rendering whatever view (this build's full field, or zoom.js's side/group views) is
// currently showing.
function findCard(view, playerKey) {
  for (const unit of ["OFF", "DEF"]) {
    for (const slot of view.units?.[unit] || []) {
      for (const p of slot.players || []) if (p.playerKey === playerKey) return p;
    }
    const byBand = view.unlisted?.[unit] || {};
    for (const band of Object.keys(byBand)) {
      for (const p of byBand[band] || []) if (p.playerKey === playerKey) return p;
    }
  }
  return null;
}

// window.__nflView is the shared contract every view-rendering module sets after it loads a team (this
// file's own renderTeam calls, and zoom.js's renderZoomSide/renderZoomGroup) — {abbr, view, teamMeta, page}.
// `page` ("team" | "off" | "def" | "group") names which page is currently on screen; only "team", "off"
// and "def" carry the `<aside class="player-panel">` D75 gave the offense/defense pages (team.js's
// teamBodyHtml, reused by zoom.js's renderZoomSide) for the panel to open into in place. When the route
// gains a /player/:id segment for the SAME abbr, on one of those three pages, with that aside actually
// present, the panel opens directly on it without re-rendering the view underneath it — so a defense page
// stays a defense page (route unchanged: #/team/X/player/Y) with the field re-fitting beside the panel,
// the same as the whole-team page already did before D72 put the side pages on the same field engine.
// If nothing matches yet (a direct link, a team switch, or a "group"/matchup page that has no aside at
// all), this falls back to rendering the full team field (the one view this file owns outright) so
// there's always an aside to open the panel on.
const KEEPABLE_PANEL_PAGES = new Set(["team", "off", "def"]);
async function openPlayerPanel(abbr, playerKey) {
  const A = String(abbr || "").toUpperCase();
  let cached = window.__nflView;
  const canKeepCurrentPage = cached && cached.abbr === A && KEEPABLE_PANEL_PAGES.has(cached.page) && root.querySelector(".player-panel");
  if (!canKeepCurrentPage) {
    await renderTeam(root, search, A);
    cached = window.__nflView;
  }
  const aside = root.querySelector(".player-panel");
  const card = cached && cached.abbr === A ? findCard(cached.view, playerKey) : null;
  if (aside && card) openPanel(aside, card, cached.view, cached.teamMeta);
}

router.on("/", guard(() => { document.title = "NFL Depth Charts"; root.classList.add("page-landing"); return renderLanding(root, search); }));
router.on("/team/:abbr", guard(({ abbr }) => renderTeam(root, search, abbr)));
router.on("/team/:abbr/player/:id", guard(({ abbr, id }) => openPlayerPanel(abbr, id), { keepView: true }));
router.on("/team/:abbr/off", guard(({ abbr }) => renderZoomSide(root, search, abbr, "OFF"))); // D45 zoom: side view
router.on("/team/:abbr/def", guard(({ abbr }) => renderZoomSide(root, search, abbr, "DEF")));
router.on("/team/:abbr/group/:band", guard(({ abbr, band }) => renderZoomGroup(root, search, abbr, band))); // D45 zoom: position-group view
router.on("/matchup/:a", guard(({ a }) => renderMatchup(root, search, a))); // D46: resolves :b from A's next opponent, or shows a bye picker
router.on("/matchup/:a/:b", guard(({ a, b }) => renderMatchup(root, search, a, b)));
router.start(() => { root.innerHTML = `<div class="notfound">Page not found. <a class="back" href="#/">Back to all teams</a></div>`; });
window.NFLRefresh?.autoRefreshIfStale(); // D53: refresh on open if data is older than 6h (public/js/refresh.js)

// League-wide "data as of" in the app bar, independent of whichever team page is open. Runs once at
// startup and again whenever a refresh cycle finishes anywhere in the app.
if (window.NFLRefresh?.renderStatus && asof) {
  window.NFLRefresh.renderStatus(asof);
  window.addEventListener("nfl:data-refreshed", () => window.NFLRefresh.renderStatus(asof));
}
