// Hash router for the analytics app. A route is a path plus an optional query that carries the filter state
// (filters.js): #/usage?pos=WR,-RB&window=last3. Handlers receive (params, query).
const routes = [];

export function on(pattern, handler) {
  routes.push({ parts: pattern.split("/").filter(Boolean), handler });
}

export function split(hash) {
  const raw = String(hash || "#/").replace(/^#\/?/, "");
  const i = raw.indexOf("?");
  return { path: i < 0 ? raw : raw.slice(0, i), query: i < 0 ? "" : raw.slice(i + 1) };
}

export function parse(hash) {
  const { path, query } = split(hash);
  const segs = path.split("/").filter(Boolean);
  for (const r of routes) {
    if (r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    r.parts.forEach((p, i) => {
      if (p.startsWith(":")) { try { params[p.slice(1)] = decodeURIComponent(segs[i]); } catch { params[p.slice(1)] = segs[i]; } }
      else if (p !== segs[i]) ok = false;
    });
    if (ok) return { handler: r.handler, params, query, path };
  }
  return null;
}

// Where the reader was before the page on screen (Adam, 2026-09-24: a detail page needs a Back button that returns
// to where he was). The trail is every hash this tab has shown, in order; a filter change on the same page changes
// only the query, so "before" means the last hash whose PATH differs from the current one - the list, team or
// player page he came from, with the filters he had there. Null on a cold open (the app opens in a new tab from
// the depth charts, so a player page can be the first thing seen); the caller then links to its own section.
const trail = [];
export function previousPage() {
  const here = split(trail[trail.length - 1] ?? location.hash).path;
  for (let i = trail.length - 2; i >= 0; i--) if (split(trail[i]).path !== here) return trail[i];
  return null;
}
// Appends `hash` to the trail unless it is already the last entry (start()'s go() calls this with location.hash;
// exported, pure list bookkeeping with no window/location of its own, so tests can drive it directly).
export function recordVisit(hash) {
  if (trail[trail.length - 1] !== hash) trail.push(hash);
}
// A render that throws paints the "Something broke" message (main.js's view wrapper); the reader's Back button
// must not return to that dead page. main.js calls this from its catch so the trail forgets the hash it just
// failed to render - previousPage() then falls straight through to the hash before it, the next time it is asked.
export function forgetCurrent() {
  if (trail.length) trail.pop();
}
// D193 (2026-09-25): Usage became Receivers and Rushing became Running backs, and the app bar's Teams group split
// into Offense and Defense with Grid added; the old hash segments (usage, rushing, teams, team) still resolve as
// aliases (main.js), so their labels follow the page's new name rather than the old link text.
const SECTION_NAMES = {
  usage: "Receivers", receivers: "Receivers",
  rushing: "Running backs", rbs: "Running backs",
  qb: "Quarterbacks",
  teams: "Offense", team: "Offense",
  defense: "Defense",
  grid: "Grid",
  player: "Player",
};
export function pageName(hash) {
  const segs = split(hash).path.split("/").filter(Boolean);
  if (segs[0] === "team" && segs[1]) return segs[1].toUpperCase();
  return SECTION_NAMES[segs[0] || "usage"] ?? "Back";
}
const escAttr = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** The Back button for a detail page's header: the previous page, or the section the page belongs to. */
export function backLink(fallbackHref, fallbackName) {
  const prev = previousPage();
  const href = prev ?? fallbackHref;
  const name = prev ? pageName(prev) : fallbackName;
  return `<a class="an-back" href="${escAttr(href)}" title="Back to ${escAttr(name)}">&larr; Back<small>${escAttr(name)}</small></a>`;
}

export function start(fallback) {
  const go = () => {
    recordVisit(location.hash);
    const m = parse(location.hash);
    if (m) m.handler(m.params, m.query, m.path); else fallback();
  };
  window.addEventListener("hashchange", go);
  go();
}
