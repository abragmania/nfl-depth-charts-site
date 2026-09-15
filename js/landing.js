import { getTeams } from "./api.js";

export const DIVISION_ORDER = ["AFC East", "AFC North", "AFC South", "AFC West", "NFC East", "NFC North", "NFC South", "NFC West"];
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const record = (r) => (r ? `${r.wins}-${r.losses}${r.ties ? "-" + r.ties : ""}` : "—");

// 👁 QA B3: the tile's wash is the team's own primary colour, and a handful of clubs (New Orleans' old
// gold, and anyone else with a pale primary) are light enough that white text on them is barely legible.
// Relative luminance decides the ink instead of a hard-coded list, so a colour change in teams.json can
// never silently reintroduce the problem. The 0.55 threshold is a touch above the usual 0.5 because the
// gradient lightens further toward the secondary colour at the right-hand end of the tile.
function luminance(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  // 🔵 review finding 11: #rgb shorthand is valid CSS and teams.json is hand-maintained, so a three-digit
  // colour must not silently fall through as "dark" and leave a pale tile unreadable.
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

// 👁 QA round 3 item 3. The first attempt tested the primary with a 0.55 threshold and missed New
// Orleans by a whisker (its gold measures 0.517); the second used the brighter of the two gradient
// stops, which was worse — half the league's SECONDARY colour is white, silver or gold, so nearly every
// tile flipped to dark ink on a dark wash. The wash is `linear-gradient(135deg, primary 0 55%,
// secondary 140%)`: the secondary only arrives past the right-hand edge, well beyond where the name and
// record sit, so the PRIMARY is what the text actually lies on and the primary alone decides.
//
// Measured across all 32 clubs (tools note): New Orleans is the only light primary at 0.517, and the
// next brightest is Tennessee at 0.274 — a mid blue that white reads on perfectly well. 0.40 sits in
// that gap, so it catches New Orleans today and any genuinely pale primary a future rebrand brings,
// without touching a single team that is fine as it is.
const LIGHT_WASH_THRESHOLD = 0.40;
// Exported (👁 QA 2026-09-15, item 7): the matchup header paints the same kind of team-colour wash and
// had the same problem on a pale club, so it asks THIS function rather than growing a second copy of the
// threshold that would drift from this one.
export const isLightWash = (primary) => (luminance(primary) ?? 0) > LIGHT_WASH_THRESHOLD;

function tile(t) {
  const style = `--team-primary:${esc(t.colourPrimary)};--team-secondary:${esc(t.colourSecondary)}`;
  const ink = isLightWash(t.colourPrimary) ? " tile-light" : "";
  const q = esc((t.abbr + " " + t.name).toLowerCase());
  // onerror is attached at creation (inline) so a failed logo becomes a text badge, never a broken image icon.
  // 🔵 review finding 11: every interpolated field is escaped, not just the nickname - these come from a
  // hand-maintained teams.json, and "it is our own data" is exactly the assumption that ages badly.
  const onerror = `this.replaceWith(Object.assign(document.createElement('div'),{className:'logo-fallback',textContent:'${esc(t.abbr)}'}))`;
  return `<a class="tile${ink}" href="#/team/${esc(t.abbr)}" data-q="${q}" style="${style}">
    <img src="${esc(t.logo)}" alt="${esc(t.abbr)}" loading="lazy" onerror="${onerror}">
    <div class="txt"><span class="abbr">${esc(t.abbr)}</span><span class="nick">${esc(t.nickname)}</span><span class="rec">${esc(record(t.record))}</span></div>
  </a>`;
}

// D46: a compact "build a matchup" shortcut above the division grid. Defaults to the first team
// alphabetically and, when known, that team's opponent from this week's schedule (both teams already
// carry `nextOpponent` on the /api/teams payload, so no extra fetch is needed just to fill the form).
function matchupBarHtml(teams) {
  const sorted = teams.slice().sort((a, b) => a.abbr.localeCompare(b.abbr));
  const defaultA = sorted[0];
  const defaultB = defaultA?.nextOpponent?.abbr && sorted.some((t) => t.abbr === defaultA.nextOpponent.abbr)
    ? defaultA.nextOpponent.abbr
    : (sorted[1] ? sorted[1].abbr : "");
  const opts = (selected) => sorted.map((t) => `<option value="${t.abbr}" ${t.abbr === selected ? "selected" : ""}>${esc(t.abbr)} — ${esc(t.name)}</option>`).join("");
  return `<div class="matchup-bar">
    <span class="matchup-bar-label">Matchup</span>
    <form id="matchup-bar-form" class="matchup-bar-form">
      <select id="matchup-bar-a" aria-label="Offense team">${opts(defaultA?.abbr)}</select>
      <span class="matchup-bar-vs">offense vs</span>
      <select id="matchup-bar-b" aria-label="Defense team">${opts(defaultB)}</select>
      <span class="matchup-bar-vs">defense</span>
      <button type="submit">Go</button>
    </form>
  </div>`;
}

export async function renderLanding(root, search) {
  const { teams } = await getTeams();
  root.innerHTML = `${matchupBarHtml(teams)}<div class="divisions">${DIVISION_ORDER.map((d) =>
    `<section class="division"><h2>${d}</h2>${teams.filter((t) => t.division === d).map(tile).join("")}</section>`
  ).join("")}</div>`;
  search.hidden = false;
  search.value = "";
  // Filtering dims non-matches in place so the 8x4 geometry never changes (review finding 13a).
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    root.querySelectorAll(".tile").forEach((el) => el.classList.toggle("dim", !!q && !el.dataset.q.includes(q)));
  };
  const matchupForm = root.querySelector("#matchup-bar-form");
  if (matchupForm) {
    matchupForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const a = root.querySelector("#matchup-bar-a").value;
      const b = root.querySelector("#matchup-bar-b").value;
      if (a && b) location.hash = `#/matchup/${a}/${b}`;
    });
  }
}
