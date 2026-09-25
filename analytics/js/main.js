// NFL Analytics (D177): a separate app from the depth charts, opened in its own tab from the depth-chart app
// bar. D193 (2026-09-25) regrouped the app bar into PLAYERS (Quarterbacks, Running backs, Receivers) and TEAMS
// (Offense, Defense, Grid); Receivers is today's Usage view and Running backs is today's Rushing view, each
// keeping its own title and body this increment (only the route, nav and default position chip move). The old
// links (#/usage, #/rushing, #/teams, #/team) keep working as aliases so nothing already bookmarked breaks.
import * as router from "./router.js";
import { renderNav, sectionForPos } from "./nav.js";
import { renderUsage } from "./views/usage.js";
import { renderPlayer } from "./views/player.js";
import { renderQb } from "./views/qb.js";
import { renderQbPlayer } from "./views/qbplayer.js";
import { renderRushing } from "./views/rushing.js";
import { renderTeams, renderTeam } from "./views/team.js";
import { renderDefense } from "./views/defense.js";
import { renderGrid } from "./views/grid.js";
import { loadSeason } from "./data.js";
import { fromQuery, seasonsOf, weekKey, weekLabel, CURRENT_SEASON } from "./filters.js";

const root = document.getElementById("app");
const nav = document.getElementById("an-nav");
const asof = document.getElementById("an-asof");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The nav keeps whatever filter query is on screen, so switching section keeps the filters.
function paintNav(active, query) {
  nav.innerHTML = renderNav(active, query);
}

// D-badge fix (2026-09-25): every page used to set #an-asof itself, so a team or player page opened cold showed
// nothing, and a page that never touches it again (any page reached after viewing a past season) left the badge
// reading the earlier season's week. One source instead: after every successful render, the view wrapper below
// derives the badge from the season on screen (fromQuery(query).season, the same rule every page's own filter
// bar uses) and that season's cached manifest (data.js's loadSeason). weekLabel(key, season) already reads "W3"
// for the season passed as its own `currentSeason` argument (filters.js), so passing st.season both ways gives the
// bare week token - "WC"/"DIV"/"CONF"/"SB" for weeks 19-22, "W<n>" otherwise - with no season prefix to strip.
async function paintAsof(query, isCurrent) {
  if (!asof) return;
  const st = fromQuery(query);
  try {
    const { manifest } = await loadSeason(st.season);
    if (!isCurrent()) return;
    const weeks = manifest?.weeks || [];
    if (!weeks.length) { asof.hidden = true; return; }
    const last = weeks.reduce((a, b) => (a.week > b.week ? a : b));
    const label = weekLabel(weekKey(st.season, last.week), st.season);
    // Usage.js's old "· built <date>" suffix, kept for the current season only - a past season's build time means
    // nothing to a reader.
    const t = st.season === CURRENT_SEASON && last.builtAt ? new Date(last.builtAt) : null;
    const built = t && !isNaN(t) ? ` · built ${t.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
    asof.textContent = `Through ${label}${built}`;
    asof.hidden = false;
  } catch { if (isCurrent()) asof.hidden = true; } // the season's files are not built yet, or could not load: no badge
}

let seq = 0;
const view = (section, fn) => async (params, query) => {
  const my = ++seq;
  paintNav(section, query);
  try {
    await fn(params, query, { root, asof, isCurrent: () => my === seq });
    if (my === seq) await paintAsof(query, () => my === seq);
  } catch (e) {
    if (my === seq) {
      root.innerHTML = `<div class="an-msg an-msg-err">Something broke: ${esc(e.message)}</div>`;
      if (asof) asof.hidden = true;
      router.forgetCurrent(); // the reader's Back button must not return to this dead page
    }
  }
};

router.on("/", view("receivers", (p, q, ctx) => renderUsage(ctx, q)));
router.on("/receivers", view("receivers", (p, q, ctx) => renderUsage(ctx, q)));
router.on("/usage", view("receivers", (p, q, ctx) => renderUsage(ctx, q))); // alias, D193
// D182: a player page is built for his position. Quarterback -> Quarterbacks tab and the QB page; RB/FB ->
// Running backs tab; everyone else -> Receivers. The newest loaded season's players file supplies his position;
// sectionForPos (nav.js, pure) is the one rule both this lookup and nav.js's own tests use.
async function sectionForPlayer(gsis, query) {
  for (const s of seasonsOf(fromQuery(query))) {
    try {
      const p = (await loadSeason(s)).players?.[gsis];
      if (p) return sectionForPos(p.pos);
    } catch { /* season not built */ }
  }
  return "receivers";
}
// 🔵 review (2026-09-25): no tab lights while his position is still being looked up, rather than lighting
// Receivers and then correcting to Quarterbacks/Running backs once the lookup resolves.
router.on("/player/:gsis", view("", async (p, q, ctx) => {
  const section = await sectionForPlayer(p.gsis, q);
  if (ctx.isCurrent()) paintNav(section, q);
  if (section === "qb") return renderQbPlayer(ctx, p, q);
  return renderPlayer(ctx, p, q);
}));
router.on("/qb", view("qb", (p, q, ctx) => renderQb(ctx, q)));
router.on("/rbs", view("rbs", (p, q, ctx) => renderRushing(ctx, q)));
router.on("/rushing", view("rbs", (p, q, ctx) => renderRushing(ctx, q))); // alias, D193
// #/teams (and a bare #/team) is the club picker, Offense-tab; #/team/:abbr the club's offense; #/defense the
// defense leaderboard, whose expanded row is the defense page in v1 (D179); #/grid the team grid (stub).
router.on("/teams", view("teams", (p, q, ctx) => renderTeams(ctx, q)));
router.on("/team", view("teams", (p, q, ctx) => renderTeams(ctx, q)));
router.on("/team/:abbr", view("teams", (p, q, ctx) => renderTeam(ctx, p, q)));
router.on("/defense", view("defense", (p, q, ctx) => renderDefense(ctx, q)));
router.on("/grid", view("grid", (p, q, ctx) => renderGrid(ctx, q)));
// "/" is its own route above; any hash that matches nothing (a stale link, a typo) goes to Receivers too, the
// app's new default section, rather than showing a dead end (D193 plan, Routes). location.replace (🔵 review,
// 2026-09-25), not location.hash =, so the bad address does not get its own entry in browser history - Back
// from Receivers should leave the app, not bounce to the dead link that sent the reader here.
router.start(() => { location.replace("#/receivers"); });
