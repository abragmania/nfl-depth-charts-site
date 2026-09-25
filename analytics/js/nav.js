// PURE (no DOM): the app bar's nav, grouped under labelled headings (D193, Adam 2026-09-25: "all those groups
// probably go under Players, then there's Teams"). main.js paints the string this returns into #an-nav and wires
// nothing here - every link is a plain <a href="#/...">, so the nav keeps working with JS off and needs no
// listeners; it re-renders on every route change with the section's own hash query (D177: every view is a link).
export const SECTIONS = [
  { group: "PLAYERS", path: "qb", label: "Quarterbacks" },
  { group: "PLAYERS", path: "rbs", label: "Running backs" },
  { group: "PLAYERS", path: "receivers", label: "Receivers" },
  { group: "TEAMS", path: "teams", label: "Offense" },
  { group: "TEAMS", path: "defense", label: "Defense" },
  { group: "TEAMS", path: "grid", label: "Grid" },
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Groups the flat SECTIONS list by its `group` field, preserving list order (no Map/Set needed for six entries).
function grouped(sections) {
  const out = [];
  for (const s of sections) {
    let g = out[out.length - 1];
    if (!g || g.name !== s.group) { g = { name: s.group, items: [] }; out.push(g); }
    g.items.push(s);
  }
  return out;
}

/** The #an-nav innerHTML: labelled PLAYERS / TEAMS groups of tabs, the `active` section's tab lit, every tab
 * carrying the current filter query (D177's every-view-is-a-link) so switching section keeps the filters. The
 * query is HTML-escaped (🔵 review, 2026-09-25): it can carry a team abbreviation or search text a reader typed
 * into a select/URL, and an unescaped "&", quote or angle bracket would either break the attribute or, unescaped
 * quotes, let it close the href early - esc() keeps the attribute well-formed; the browser un-escapes it back to
 * the real query string when it reads the href. */
export function renderNav(active, query, sections = SECTIONS) {
  const q = query ? `?${esc(query)}` : "";
  return grouped(sections).map((g) => `<div class="an-navgrp"><span class="an-navlabel">${esc(g.name)}</span>${g.items.map((s) =>
    `<a class="an-tab${s.path === active ? " on" : ""}" href="#/${s.path}${q}">${esc(s.label)}</a>`).join("")}</div>`).join("");
}

// D193 (2026-09-25): which app-bar tab a player's own page lights, by his position. Pure so main.js's route
// handler and this file's tests both use the same rule instead of main.js keeping its own inline copy.
export function sectionForPos(pos) {
  const p = String(pos || "").toUpperCase();
  if (p === "QB") return "qb";
  if (p === "RB" || p === "FB") return "rbs";
  return "receivers";
}
