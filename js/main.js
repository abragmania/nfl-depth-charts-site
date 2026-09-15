import * as router from "./router.js";
import { renderLanding } from "./landing.js";
import { renderTeam } from "./team.js";
import { renderZoomSide, renderZoomGroup } from "./zoom.js";
import { renderMatchup } from "./matchup.js";
import { openPanel } from "./panel.js";
import { esc } from "./cards.js";
import { disposeCurrentView } from "./viewfit.js"; // an error message can carry anything; it must never reach innerHTML raw
import "./refresh.js"; // side effect only: defines window.NFLRefresh (integration task 2, 2026-09-11)

const root = document.getElementById("app");
const search = document.getElementById("search");
const asof = document.getElementById("asof");
// Ruling E trimmed <main>'s padding right down so the team pages fit 1700x900 with no scrolling. The
// landing grid has no such constraint and reads better with room around it, so it keeps the old padding
// through one marker class (styles.css's `main.page-landing`) that every route clears on entry and only
// the landing route puts back.
// 🔵 delta review finding 1: ONE teardown point for the whole app. Every route change disposes the
// outgoing view's observers, timers and listeners before the incoming one renders - without it, a view
// that had been navigated away from kept a ResizeObserver on <main>, and when it fired it re-measured
// its own detached field, decided the layout was wrong and wrote itself over whatever page was on screen.
// `keepView` is the one exception: the player sub-route opens a panel on the page that is ALREADY
// rendered without re-rendering it (openPlayerPanel below), so tearing that page down would leave the
// field it is opening the panel on with nothing left to re-fit it.
const guard = (fn, { keepView = false } = {}) => (p) => {
  root.classList.remove("page-landing");
  if (!keepView) disposeCurrentView();
  return fn(p).catch((e) => { root.innerHTML = `<div class="notfound">Something broke: ${esc(e.message)}</div>`; });
};

// Finds a player card anywhere in an already-loaded TeamView — the depth-chart columns, or the
// "not on chart" trays — by playerKey. Used so a #/team/X/player/Y navigation can open the panel
// without re-rendering whatever view (this build's full field, or zoom.js's side/group views) is
// currently showing (integration task 1, 2026-09-11).
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
// file's own renderTeam calls, and zoom.js's renderZoomSide/renderZoomGroup) — {abbr, view, teamMeta}.
// When the route gains a /player/:id segment for the SAME abbr already cached there, the panel opens
// directly on the existing <aside class="player-panel"> without re-rendering the view underneath it.
// If nothing matches yet (a direct link, or a team switch), this falls back to rendering the full field
// (the one view this file owns outright) so there's always an aside to open the panel on.
async function openPlayerPanel(abbr, playerKey) {
  const A = String(abbr || "").toUpperCase();
  // 🔵 review finding 5: the cached view might be the matchup or a zoom page, which have no
  // <aside class="player-panel"> at all - matching on the abbreviation alone meant clicking a card there
  // silently did nothing. Fall back to the full team page whenever there is no panel to open.
  let cached = window.__nflView;
  if (!cached || cached.abbr !== A || !root.querySelector(".player-panel")) {
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

// League-wide "data as of" in the app bar, independent of whichever team page is open (integration
// task 2). Runs once at startup and again whenever a refresh cycle finishes anywhere in the app.
if (window.NFLRefresh?.renderStatus && asof) {
  window.NFLRefresh.renderStatus(asof);
  window.addEventListener("nfl:data-refreshed", () => window.NFLRefresh.renderStatus(asof));
}
