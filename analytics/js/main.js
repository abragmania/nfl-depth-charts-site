// NFL Analytics (D177): a separate app from the depth charts, opened in its own tab from the depth-chart app
// bar. Usage (pass-game usage, fantasy first) is the default page; the other sections are registered now
// and fill in over the next increments.
import * as router from "./router.js";
import { renderUsage } from "./views/usage.js";
import { renderPlayer } from "./views/player.js";
import { renderQb } from "./views/qb.js";
import { renderQbPlayer } from "./views/qbplayer.js";
import { renderRushing } from "./views/rushing.js";
import { loadSeason } from "./data.js";
import { fromQuery, seasonsOf } from "./filters.js";

const root = document.getElementById("app");
const nav = document.getElementById("an-nav");
const asof = document.getElementById("an-asof");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const SECTIONS = [
  { path: "usage", label: "Usage" },
  { path: "qb", label: "Quarterbacks" },
  { path: "rushing", label: "Rushing" },
  { path: "team", label: "Teams" },
  { path: "defense", label: "Defense" },
];

// The nav keeps whatever filter query is on screen, so switching section keeps the filters.
function paintNav(active, query) {
  nav.innerHTML = SECTIONS.map((s) => `<a class="an-tab${s.path === active ? " on" : ""}" href="#/${s.path}${query ? "?" + query : ""}">${s.label}</a>`).join("");
}

let seq = 0;
const view = (section, fn) => async (params, query) => {
  const my = ++seq;
  paintNav(section, query);
  try { await fn(params, query, { root, asof, isCurrent: () => my === seq }); }
  catch (e) { if (my === seq) root.innerHTML = `<div class="an-msg an-msg-err">Something broke: ${esc(e.message)}</div>`; }
};

const stub = (title, blurb) => async () => {
  document.title = `${title} · NFL Analytics`;
  root.innerHTML = `<div class="an-msg"><div class="an-msg-title">${esc(title)}</div>${esc(blurb)} Coming next.</div>`;
};

router.on("/", view("usage", (p, q, ctx) => renderUsage(ctx, q)));
router.on("/usage", view("usage", (p, q, ctx) => renderUsage(ctx, q)));
// D182: a player page is built for his position. A quarterback (the newest loaded season's players file says QB)
// gets the QB page with the Quarterbacks pill lit; everyone else the pass-catcher page.
async function isQb(gsis, query) {
  for (const s of seasonsOf(fromQuery(query))) {
    try { const p = (await loadSeason(s)).players?.[gsis]; if (p) return String(p.pos || "").toUpperCase() === "QB"; } catch { /* season not built */ }
  }
  return false;
}
router.on("/player/:gsis", view("usage", async (p, q, ctx) => {
  if (await isQb(p.gsis, q)) { if (ctx.isCurrent()) paintNav("qb", q); return renderQbPlayer(ctx, p, q); }
  return renderPlayer(ctx, p, q);
}));
router.on("/qb", view("qb", (p, q, ctx) => renderQb(ctx, q)));
router.on("/rushing", view("rushing", (p, q, ctx) => renderRushing(ctx, q)));
router.on("/team", view("team", stub("Teams", "Team offence and defence side by side.")));
router.on("/team/:abbr", view("team", stub("Team", "One club's offence and defence.")));
router.on("/defense", view("defense", stub("Defense", "Team defence: EPA allowed, pressure and blitz rates.")));
router.start(() => { paintNav("", ""); root.innerHTML = `<div class="an-msg">Page not found. <a href="#/usage">Back to Usage</a></div>`; });
