// The analytics app's one data door. Loads a season's manifest and players file once, then only the week
// files a view needs, caching all of it per season for the page's life. Live mode asks the local server's
// /api/analytics routes; static mode (the published site, <meta name="nfl-static" content="1">) reads the
// flat files the publish step writes, through the same staticPathFor() the depth charts use (public/js/api.js).
// This app is served one folder down (/analytics/), so every static path gets a "../" in front.
import { isStatic, staticPathFor } from "../../js/api.js";
import { weekKey, splitKey } from "./filters.js";

// Mirrors the analytics contract's static layout, used only if api.js's staticPathFor() does not (yet) map
// an analytics URL: /api/analytics/{s}/manifest -> api/analytics/{s}/manifest.json, .../players -> players.json,
// .../w/{n} -> w{NN}.json.
export function analyticsStaticPath(url) {
  if (/^\/?api\/analytics\/identity$/.test(String(url).split("?")[0])) return "api/analytics/identity.json";
  if (/^\/?api\/analytics\/seasons$/.test(String(url).split("?")[0])) return "api/analytics/seasons.json";
  const m = String(url).split("?")[0].match(/^\/?api\/analytics\/(\d{4})\/(manifest|players|w\/(\d+))$/);
  if (!m) return null;
  if (m[3]) return `api/analytics/${m[1]}/w${String(+m[3]).padStart(2, "0")}.json`;
  return `api/analytics/${m[1]}/${m[2]}.json`;
}

export function resolveAnalyticsUrl(url) {
  if (!isStatic()) return url;
  const p = staticPathFor(url) ?? analyticsStaticPath(url);
  return p ? `../${p}` : url;
}

async function getJson(url, bust) {
  const u = resolveAnalyticsUrl(url) + (bust ? `?v=${encodeURIComponent(bust)}` : "");
  const r = await fetch(u, { headers: { accept: "application/json" } });
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON body */ }
  if (!r.ok || !body) {
    const e = new Error(body?.error?.message || `${r.status} ${url}`);
    e.status = r.status;
    throw e;
  }
  return body;
}

const seasons = new Map(); // season -> Promise<{ manifest, players }>
const weekFiles = new Map(); // "season-week" -> Promise<week file>
let teamsPromise = null; // the team registry (colours, names): same for every season, fetched once
let identityPromise = null; // D183: {builtAt, players: {[gsis]: {name, onChart}}}, or null when it cannot be had
let seasonsPromise = null; // D184: the sorted [year,...] every season the API has data for, or null when it cannot be had
let identityNames = null; // gsis -> the depth-chart spelling, once loaded
let lastPlayers = {}; // the merged players of the latest loadFor(), displayName()'s fallback

// D183: the identity file's printed name per gsis (the depth chart's spelling for every man a chart carries, else
// nflverse's). Never fails: a missing or unreadable file resolves to null and names fall back to players.json.
export function loadIdentity() {
  if (!identityPromise) {
    identityPromise = getJson("/api/analytics/identity")
      .then((body) => { identityNames = new Map(Object.entries(body?.players || {}).map(([g, p]) => [g, p?.name]).filter(([, n]) => n)); return body; })
      .catch(() => { identityPromise = null; return null; });
  }
  return identityPromise;
}

// D183: the name to print for a gsis id. The identity file's (depth-chart) spelling first, then the name the
// season's players.json carries (`players`, default: the latest loadFor()'s merged map), then the id itself.
export function displayName(gsis, players = lastPlayers) {
  return identityNames?.get(gsis) ?? players?.[gsis]?.name ?? gsis ?? null;
}

// PURE: the merged players map with every name the identity file knows replaced by its depth-chart spelling.
export function applyIdentityNames(players, names) {
  if (!names || !names.size) return players;
  const out = {};
  for (const [g, p] of Object.entries(players || {})) out[g] = names.has(g) ? { ...p, name: names.get(g) } : p;
  return out;
}

// D184: every season the seasons endpoint lists, ascending. Never fails: a missing/unreadable endpoint resolves
// to null and callers fall back to the current season alone.
export function loadSeasons() {
  if (!seasonsPromise) {
    seasonsPromise = getJson("/api/analytics/seasons")
      .then((body) => (Array.isArray(body?.seasons) ? body.seasons.map(Number).sort((a, b) => a - b) : null))
      .catch(() => { seasonsPromise = null; return null; });
  }
  return seasonsPromise;
}

// The team registry for colour-coding (table.js's team pill). Routed through resolveAnalyticsUrl, not
// public/js/api.js's own getTeams(), because that module's relative static path assumes it is called from
// a page at the site root; this app is served one folder down (/analytics/) and needs the "../" prefix
// resolveAnalyticsUrl already knows how to add.
export function loadTeams() {
  if (!teamsPromise) teamsPromise = getJson("/api/teams").catch((e) => { teamsPromise = null; throw e; });
  return teamsPromise;
}

export function loadSeason(season) {
  if (!seasons.has(season)) {
    const p = Promise.all([getJson(`/api/analytics/${season}/manifest`), getJson(`/api/analytics/${season}/players`)])
      .then(([manifest, players]) => ({ manifest, players }))
      .catch((e) => { seasons.delete(season); throw e; });
    seasons.set(season, p);
  }
  return seasons.get(season);
}

function loadWeek(season, w) {
  const k = weekKey(season, w.week);
  if (!weekFiles.has(k)) {
    weekFiles.set(k, getJson(`/api/analytics/${season}/w/${w.week}`, w.hash).catch((e) => { weekFiles.delete(k); throw e; }));
  }
  return weekFiles.get(k);
}

// Which week keys a window needs fetched. last3 reads the four most recent weeks (three games plus a bye).
export function weeksNeeded(allKeys, st) {
  const keys = [...allKeys].sort();
  if (st.window === "last3") return keys.slice(-4);
  if (st.window === "range") return keys.filter((k) => (!st.from || k >= st.from) && (!st.to || k <= st.to));
  return keys;
}

// Everything a view needs for a filter state: { blocks, players, keys, manifests, missing }.
// `seasonList` is filters.seasonsOf(st). A season whose files are absent (e.g. 2025 before its compile has run)
// is reported in `missing` rather than failing the whole page, unless it is the only season asked for.
export async function loadFor(seasonList, st) {
  const [got] = await Promise.all([
    Promise.all(seasonList.map((s) => loadSeason(s).then((v) => ({ s, ...v }), (e) => ({ s, error: e })))),
    loadIdentity(),
  ]);
  const ok = got.filter((g) => !g.error);
  if (!ok.length) throw got[0].error;
  const missing = got.filter((g) => g.error).map((g) => g.s);
  const byKey = new Map();
  for (const g of ok) for (const w of g.manifest.weeks || []) byKey.set(weekKey(g.s, w.week), { season: g.s, w, cols: g.manifest.cols });
  const keys = [...byKey.keys()].sort();
  const need = weeksNeeded(keys, st);
  const files = await Promise.all(need.map((k) => { const x = byKey.get(k); return loadWeek(x.season, x.w).then((f) => ({ k, x, f })); }));
  const blocks = files.map(({ k, x, f }) => ({
    season: x.season, week: splitKey(k).week, key: k, cols: f.cols || x.cols,
    plays: f.plays || [], snaps: f.snaps || null, routes: f.routes || null, ngs: f.ngs || null, pfr: f.pfr || null,
  }));
  // D183: the players map views read carries the depth-chart spelling already; displayName() is the same lookup.
  lastPlayers = applyIdentityNames(mergePlayers(ok.map((g) => ({ season: g.s, players: g.players }))), identityNames);
  return { blocks, players: lastPlayers, keys, manifests: ok.map((g) => ({ season: g.s, ...g.manifest })), missing };
}

// PURE: the per-season players files merged into one map whose `teams` are keyed by week key ("2025-14"),
// newest season's name/pos winning.
export function mergePlayers(list) {
  const out = {};
  for (const { season, players } of [...list].sort((a, b) => a.season - b.season)) {
    for (const [id, p] of Object.entries(players || {})) {
      const prev = out[id];
      const teams = { ...(prev?.teams || {}) };
      for (const [w, t] of Object.entries(p.teams || {})) teams[weekKey(season, w)] = t;
      out[id] = { name: p.name ?? prev?.name, pos: p.pos ?? prev?.pos, espnId: p.espnId ?? prev?.espnId ?? null, teams };
    }
  }
  return out;
}
