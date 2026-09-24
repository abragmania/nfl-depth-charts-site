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
  const got = await Promise.all(seasonList.map((s) => loadSeason(s).then((v) => ({ s, ...v }), (e) => ({ s, error: e }))));
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
  return { blocks, players: mergePlayers(ok.map((g) => ({ season: g.s, players: g.players }))), keys, manifests: ok.map((g) => ({ season: g.s, ...g.manifest })), missing };
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
