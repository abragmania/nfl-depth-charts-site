import { getTeams } from "./api.js";

export const DIVISION_ORDER = ["AFC East", "AFC North", "AFC South", "AFC West", "NFC East", "NFC North", "NFC South", "NFC West"];
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const record = (r) => (r ? `${r.wins}-${r.losses}${r.ties ? "-" + r.ties : ""}` : "—");

// The tile's wash is the team's own primary colour, and a handful of clubs (New Orleans' old gold, and
// anyone else with a pale primary) are light enough that white text on them is barely legible. Relative
// luminance decides the ink instead of a hard-coded list, so a colour change in teams.json can never
// silently reintroduce the problem. See LIGHT_WASH_THRESHOLD below for how the cutoff was chosen.
function luminance(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  // #rgb shorthand is valid CSS and teams.json is hand-maintained, so a three-digit colour must not
  // silently fall through as "dark" and leave a pale tile unreadable.
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

// The wash is `linear-gradient(135deg, primary 0 55%, secondary 140%)`: the secondary only arrives past
// the right-hand edge, well beyond where the name and record sit, so the PRIMARY is what the text actually
// lies on and the primary alone decides — testing the brighter of the two gradient stops instead flips
// nearly every tile to dark ink, since half the league's SECONDARY colour is white, silver or gold.
//
// Measured across all 32 clubs: New Orleans is the only light primary at 0.517, and the next brightest is
// Tennessee at 0.274 — a mid blue that white reads on perfectly well. 0.40 sits in that gap, so it catches
// New Orleans and any genuinely pale primary a future rebrand brings, without touching a team that's fine.
const LIGHT_WASH_THRESHOLD = 0.40;
// Exported so the matchup header, which paints the same kind of team-colour wash, asks THIS function
// rather than growing a second copy of the threshold that would drift from this one.
export const isLightWash = (primary) => (luminance(primary) ?? 0) > LIGHT_WASH_THRESHOLD;

function tile(t) {
  const style = `--team-primary:${esc(t.colourPrimary)};--team-secondary:${esc(t.colourSecondary)}`;
  const ink = isLightWash(t.colourPrimary) ? " tile-light" : "";
  const q = esc((t.abbr + " " + t.name).toLowerCase());
  // onerror is attached at creation (inline) so a failed logo becomes a text badge, never a broken image icon.
  // Every interpolated field is escaped, not just the nickname — teams.json is hand-maintained, and "it
  // is our own data" is exactly the assumption that ages badly.
  const onerror = `this.replaceWith(Object.assign(document.createElement('div'),{className:'logo-fallback',textContent:'${esc(t.abbr)}'}))`;
  return `<a class="tile${ink}" href="#/team/${esc(t.abbr)}" data-q="${q}" style="${style}">
    <img src="${esc(t.logo)}" alt="${esc(t.abbr)}" loading="lazy" onerror="${onerror}">
    <div class="txt"><span class="abbr">${esc(t.abbr)}</span><span class="nick">${esc(t.nickname)}</span><span class="rec">${esc(record(t.record))}</span></div>
  </a>`;
}

// D172 (replaces D46's pick-two-teams form as the top bar itself): one chip per this week's game, away at
// home, kickoff order. The old form still exists for building an arbitrary matchup, but it's tucked behind
// an "Any matchup..." toggle at the end of the bar so the games are what the bar reads as by default.
const KICKOFF_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

// Pure: the two display lines for one chip (away line first, home line second - the caller adds the tags
// and does the escaping). The favorite's line sits by the favorite; the total, in brackets, sits by the
// other team; a pick'em prints "pk" by the home team and the total by the away team (D172).
//
// Team name: the nickname was tried first (D172 draft), but a full 16-game slate at 1920 wide truncates it
// mid-word once the line/total number is appended, so this reads the abbreviation instead - the same one
// the division grid above it already uses, and it never truncates at any slate size.
export function gameChipLines(g, teamsByAbbr) {
  const away = teamsByAbbr.get(g.away), home = teamsByAbbr.get(g.home);
  const awayName = away?.abbr || g.away;
  const homeName = home?.abbr || g.home;
  const hasOdds = g.favorite != null || g.overUnder != null;
  const isPickEm = hasOdds && g.favorite == null;
  const awayText = g.favorite === g.away ? `${awayName} -${g.line}`
    : hasOdds ? `${awayName} (${g.overUnder})` : awayName;
  const homeText = g.favorite === g.home ? `${homeName} -${g.line}`
    : isPickEm ? `${homeName} pk`
    : hasOdds ? `${homeName} (${g.overUnder})` : homeName;
  return { awayLine: `${awayText} ${g.neutral ? "vs" : "at"}`, homeLine: homeText };
}

function gameChipHtml(g, teamsByAbbr) {
  const { awayLine, homeLine } = gameChipLines(g, teamsByAbbr);
  const title = g.kickoff ? KICKOFF_FMT.format(new Date(g.kickoff)) : "";
  return `<a class="game-chip" href="#/matchup/${esc(g.away)}/${esc(g.home)}" title="${esc(title)}">
    <span class="game-chip-line">${esc(awayLine)}</span>
    <span class="game-chip-line">${esc(homeLine)}</span>
  </a>`;
}

// D46's original picker, now hidden behind the "Any matchup..." toggle rather than shown by default.
// Defaults to the first team alphabetically and, when known, that team's opponent from this week's
// schedule (both teams already carry `nextOpponent` on the /api/teams payload, so no extra fetch is
// needed just to fill the form).
function matchupFormHtml(teams) {
  const sorted = teams.slice().sort((a, b) => a.abbr.localeCompare(b.abbr));
  const defaultA = sorted[0];
  const defaultB = defaultA?.nextOpponent?.abbr && sorted.some((t) => t.abbr === defaultA.nextOpponent.abbr)
    ? defaultA.nextOpponent.abbr
    : (sorted[1] ? sorted[1].abbr : "");
  const opts = (selected) => sorted.map((t) => `<option value="${t.abbr}" ${t.abbr === selected ? "selected" : ""}>${esc(t.abbr)} — ${esc(t.name)}</option>`).join("");
  return `<form id="matchup-bar-form" class="matchup-bar-form" hidden>
    <select id="matchup-bar-a" aria-label="Offense team">${opts(defaultA?.abbr)}</select>
    <span class="matchup-bar-vs">offense vs</span>
    <select id="matchup-bar-b" aria-label="Defense team">${opts(defaultB)}</select>
    <span class="matchup-bar-vs">defense</span>
    <button type="submit">Go</button>
  </form>`;
}

export function matchupBarHtml(teams, games) {
  const teamsByAbbr = new Map(teams.map((t) => [t.abbr, t]));
  const chips = games.map((g) => gameChipHtml(g, teamsByAbbr)).join("");
  return `<div class="matchup-bar">
    <div class="games-row">${chips}</div>
    <button type="button" id="matchup-bar-any-toggle" class="matchup-bar-any">Any matchup…</button>
    ${matchupFormHtml(teams)}
  </div>`;
}

export async function renderLanding(root, search) {
  const { teams, games } = await getTeams();
  root.innerHTML = `${matchupBarHtml(teams, games ?? [])}<div class="divisions">${DIVISION_ORDER.map((d) =>
    `<section class="division"><h2>${d}</h2>${teams.filter((t) => t.division === d).map(tile).join("")}</section>`
  ).join("")}</div>`;
  search.hidden = false;
  search.value = "";
  // Filtering dims non-matches in place so the 8x4 division-grid geometry never changes.
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    root.querySelectorAll(".tile").forEach((el) => el.classList.toggle("dim", !!q && !el.dataset.q.includes(q)));
  };
  const anyToggle = root.querySelector("#matchup-bar-any-toggle");
  const matchupForm = root.querySelector("#matchup-bar-form");
  if (anyToggle && matchupForm) {
    anyToggle.addEventListener("click", () => { matchupForm.hidden = !matchupForm.hidden; });
  }
  if (matchupForm) {
    matchupForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const a = root.querySelector("#matchup-bar-a").value;
      const b = root.querySelector("#matchup-bar-b").value;
      if (a && b) location.hash = `#/matchup/${a}/${b}`;
    });
  }
}
