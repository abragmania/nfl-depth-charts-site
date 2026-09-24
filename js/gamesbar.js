// This week's games strip (D172) and the matchup page's game line (D173), shared by the landing page and the
// Matchup page so the two draw the same chips from the same /api/teams `games` list. Pure string builders, no
// DOM, so they are testable in Node (tests/landing.test.mjs, tests/gamesbar.test.mjs).
import { icon, weatherIconKey, espnIconKey } from "./icons.js";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

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

// Is this game the one between these two clubs, in either order? (The Matchup page is A's offense against B's
// defense, and either club may be the home side.)
const isPair = (g, a, b) => !!g && ((g.away === a && g.home === b) || (g.away === b && g.home === a));

function gameChipHtml(g, teamsByAbbr, active) {
  const { awayLine, homeLine } = gameChipLines(g, teamsByAbbr);
  const title = g.kickoff ? KICKOFF_FMT.format(new Date(g.kickoff)) : "";
  const cur = active ? ' aria-current="true"' : "";
  return `<a class="game-chip${active ? " is-active" : ""}" href="#/matchup/${esc(g.away)}/${esc(g.home)}" title="${esc(title)}"${cur}>
    <span class="game-chip-line">${esc(awayLine)}</span>
    <span class="game-chip-line">${esc(homeLine)}</span>
  </a>`;
}

// One chip per game, kickoff order as the server sent it. `active` = [a, b]: the chip for the game between
// those two clubs is marked as the one being viewed (D173). Clicking a chip opens away offense vs home defense.
export function gamesRowHtml(teams, games, active = null) {
  const teamsByAbbr = new Map(teams.map((t) => [t.abbr, t]));
  const chips = (games ?? []).map((g) => gameChipHtml(g, teamsByAbbr, !!active && isPair(g, active[0], active[1]))).join("");
  return `<div class="games-row">${chips}</div>`;
}

// The Matchup page's strip: the same row in the same panel as the landing page's bar, without the landing
// page's "Any matchup..." control (the Matchup page has its own opponent picker). Empty when there are no games.
export function gamesBarHtml(teams, games, active) {
  if (!games?.length) return "";
  return `<nav class="matchup-bar games-bar" aria-label="This week's games">${gamesRowHtml(teams, games, active)}</nav>`;
}

// This week's game between clubs a and b, in either order, or null (a hand-picked matchup, a bye).
export function findGame(games, a, b) {
  return (games ?? []).find((g) => isPair(g, a, b)) ?? null;
}

// Kickoff in Eastern time, labelled: "Thu Sep 24 · 8:15 PM ET". The site's own clock is Eastern (D159's week
// flip is 5:00 AM Eastern), so the game line says so rather than leaving the zone to the reader's machine.
const ET_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export function fmtKickoffET(iso) {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return null;
  const p = Object.fromEntries(ET_FMT.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.month} ${p.day} · ${p.hour}:${p.minute} ${p.dayPeriod} ET`;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
// Where the wind blows FROM (meteorological degrees, as Open-Meteo reports it) as a compass point.
export const compass = (deg) => (Number.isFinite(deg) ? COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] : null);

// Windy enough that the wind mark earns its place beside the figure.
const WINDY_MPH = 15, GUSTY_MPH = 25;
const SNOWY = new Set(["Snow"]);

// The conditions half of the game line, as HTML. Words and numbers always; icons alongside, never instead.
export function conditionsHtml(g) {
  const v = g?.venue;
  if (v?.indoor) return `<span class="game-wx">${icon("dome")}<span>Indoor</span></span>`;
  const w = g?.weather;
  if (w && (w.tempF != null || w.summary)) {
    const parts = [];
    const head = [w.summary, w.tempF != null ? `${w.tempF}°F` : null].filter(Boolean).join(", ");
    const feels = w.feelsF != null && w.tempF != null && Math.abs(w.feelsF - w.tempF) >= 5 ? ` (feels ${w.feelsF}°)` : "";
    parts.push(`${icon(weatherIconKey(w.summary, w.isDay))}<span>${esc(head + feels)}</span>`);
    if (w.windMph != null) {
      const dir = compass(w.windDir);
      const gust = w.gustMph != null && w.gustMph > w.windMph ? ` (gusts ${w.gustMph})` : "";
      const windy = w.windMph >= WINDY_MPH || (w.gustMph ?? 0) >= GUSTY_MPH;
      parts.push(`${windy ? icon("wind") : ""}<span>wind ${esc(dir ? dir + " " : "")}${w.windMph} mph${gust}</span>`);
    }
    if (w.precipPct != null) parts.push(`<span>${w.precipPct}% ${SNOWY.has(w.summary) || (w.snowIn ?? 0) > 0 ? "snow" : "rain"}</span>`);
    return `<span class="game-wx">${icon("stadium")}${parts.join('<span class="game-line-sep">·</span>')}</span>`;
  }
  const e = g?.espnWeather;
  if (e && (e.summary || e.tempF != null)) {
    const head = [e.summary, e.tempF != null ? `${e.tempF}°F` : null].filter(Boolean).join(", ");
    return `<span class="game-wx">${icon("stadium")}${icon(espnIconKey(e.summary))}<span>${esc(head)}</span></span>`;
  }
  return `<span class="game-wx">${icon("stadium")}<span>Open air · forecast not out yet</span></span>`;
}

// D173: the Matchup page's game line, "Thu Sep 24 · 8:15 PM ET · Lambeau Field, Green Bay, WI" then the
// conditions. Empty for a null game - a matchup that is not this week's game shows no game line at all.
export function gameLineHtml(g) {
  if (!g) return "";
  const v = g.venue ?? {};
  const where = [v.name, v.city, v.state || v.country].filter(Boolean).join(", ");
  const bits = [fmtKickoffET(g.kickoff), where ? where + (g.neutral ? " (neutral site)" : "") : (g.neutral ? "Neutral site" : null)].filter(Boolean);
  const w = g.weather;
  const title = v.indoor ? "Indoor venue: no forecast needed"
    : w ? `Forecast for the kickoff hour at the venue (Open-Meteo${w.fetchedAt ? `, fetched ${new Date(w.fetchedAt).toLocaleString()}` : ""})`
    : g.espnWeather ? "ESPN's forecast (Open-Meteo has none for this game yet)" : "";
  return `<div class="game-line"${title ? ` title="${esc(title)}"` : ""}>
    <span class="game-line-when">${esc(bits.join(" · "))}</span>
    <span class="game-line-sep">·</span>
    ${conditionsHtml(g)}
  </div>`;
}
