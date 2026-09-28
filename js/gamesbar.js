// This week's games strip (D172) and the matchup page's game line (D173), shared by the landing page and the
// Matchup page so the two draw the same chips from the same /api/teams `games` list. Pure string builders, no
// DOM, so they are testable in Node (tests/landing.test.mjs, tests/gamesbar.test.mjs).
import { icon, weatherIconKey, espnIconKey } from "./icons.js";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

// D172 as redrawn by Adam, 2026-09-24 (after ESPN's scoreboard strip): the spread and total are NOT mixed into
// the team names. Each chip is a small cell: the kickoff on top (short, Eastern: "Thu 8:15 PM"), then one row
// per team, away first, each a small logo and the abbreviation, with the game data in its own column to the
// right - the favorite's row shows its line ("-4.5"), the other row the total ("O/U 42.5"); a pick'em prints
// "PK" on the home row and the total on the away row; a neutral site adds a small "vs" to the kickoff line (its title says "neutral site").
const SHORT_ET = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
export function fmtKickoffShort(iso) {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "";
  const p = Object.fromEntries(SHORT_ET.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

// Pure: what each chip says. `data` per row is {kind, text}: kind "line" (the favorite's spread), "total"
// (the over/under, printed with a muted "O/U"), "pk" (pick'em, home row) or null (ESPN lists no odds).
export function gameChipData(g) {
  const hasOdds = g.favorite != null || g.overUnder != null;
  const isPickEm = g.line === 0; // 🔵 review: a total with no usable spread is not a pick'em
  const total = g.overUnder != null ? { kind: "total", text: String(g.overUnder) } : null;
  const rowData = (abbr, isHome) => {
    if (g.favorite === abbr) return g.line != null ? { kind: "line", text: `-${g.line}` } : null;
    if (isPickEm && isHome) return { kind: "pk", text: "PK" };
    return hasOdds ? total : null;
  };
  return {
    kick: fmtKickoffShort(g.kickoff),
    neutral: !!g.neutral,
    rows: [{ abbr: g.away, data: rowData(g.away, false) }, { abbr: g.home, data: rowData(g.home, true) }],
  };
}

// Is this game the one between these two clubs, in either order? (The Matchup page is A's offense against B's
// defense, and either club may be the home side.)
const isPair = (g, a, b) => !!g && ((g.away === a && g.home === b) || (g.away === b && g.home === a));

function logoUrl(t) {
  let u = t?.logoDark || t?.logo || "";
  if (u && !/^https?:\/\//.test(u) && !u.startsWith("/")) u = "/" + u;
  return u;
}

function gameChipHtml(g, teamsByAbbr, active) {
  const d = gameChipData(g);
  const cur = active ? ' aria-current="true"' : "";
  const title = [fmtKickoffET(g.kickoff), g.venue?.name].filter(Boolean).join(" · ");
  const rows = d.rows.map(({ abbr, data }) => {
    const url = logoUrl(teamsByAbbr.get(abbr));
    const logo = url ? `<img class="game-chip-logo" src="${esc(url)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="game-chip-logo"></span>';
    const val = !data ? "" : data.kind === "total"
      ? `<span class="game-chip-ou">O/U</span> ${esc(data.text)}` : esc(data.text);
    return `${logo}<span class="game-chip-abbr">${esc(abbr)}</span><span class="game-chip-data game-chip-data-${data?.kind ?? "none"}">${val}</span>`;
  }).join("");
  const note = d.neutral ? '<span class="game-chip-note" title="neutral site">vs</span>' : "";
  return `<a class="game-chip${active ? " is-active" : ""}" href="#/matchup/${esc(g.away)}/${esc(g.home)}" title="${esc(title)}"${cur}>
    <span class="game-chip-kick">${esc(d.kick)}${note}</span>${rows}
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
  if (!g.venue) return ""; // 🔵 review: no venue on file means nothing to claim about the stadium
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
