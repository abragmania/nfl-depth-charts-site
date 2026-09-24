// PURE (no DOM, no fetch): turns the compiled analytics week files into per-player pass-game usage (D177's
// first priority, fantasy in mind). Every figure here is computed from the play-by-play rows (D178: the
// play-by-play is canonical for targets, air yards, receptions, EPA); routes come only from the routes table
// (heatradar, D179) and snaps only from the snap-count table, each used for its own job.
//
// Input `blocks`: [{ season, week, key, cols, plays, snaps, routes }] where key is filters.weekKey(season, week)
// and plays are rows in the order `cols` names (the contract column list). `players`: { [gsis]: { name, pos,
// teams: { [key]: "ATL" } } } with teams keyed by week key (data.js merges the per-season files into this).
//
// Definitions (a player's "games" are the club-games in the window where he took an offensive snap or appears
// on a play, after the team/opponent/home-away filters):
//   target share    = his targets / his club's pass attempts in his games (pass plays only: no sacks, scrambles)
//   air-yards share = his air yards on targets / his club's air yards on pass attempts in his games
//   WOPR            = 1.5 x target share + 0.7 x air-yards share
//   aDOT            = his air yards / his targets (a pass-interference target with no air yards is left out)
//   TPRR, YPRR      = targets and receiving yards in the weeks the routes table covers him / his routes there
//   route %         = routes / the club dropbacks implied by each week's own route % (routes / pct)
//   snap %          = the mean of his weekly offensive snap percentages (the snap table gives 0-100 per week)
//   zones           = his targets by depth band (D179: B behind the line, S 1-9, I 10-19, D 20+) and direction
// PASS-INTERFERENCE TARGETS (D178 open decision 1, Adam 2026-09-24): a row with pi=1 is a defensive pass
// interference no-play the ledger kept. It counts as a target for the receiver (targets, target share's numerator,
// red-zone targets, EPA per target, TPRR) but it is NOT a pass attempt, so the club's pass attempts (target share's
// denominator) and club air yards leave it out; it is never a completion and adds no yards. With st.pi false
// ("excl. PI targets") pi rows are skipped entirely, as if the ledger had dropped them.
// Routes and snaps are weekly tables, so they go blank (null) under a down or quarter filter. A week the
// routes table does not list a man for (heatradar lists 8+ routes only) is left out of his route figures,
// never counted as zero.
import { gamesInWindow, playPredicate, posAllowed, isSituational } from "./filters.js";

export const colIndex = (cols) => Object.fromEntries((cols || []).map((c, i) => [c, i]));
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
const ratio = (a, b) => (b > 0 ? a / b : null);
// heatradar-style tables may give route % as 0-1 or 0-100; normalise to a fraction.
const frac = (p) => { const x = num(p); if (x === null || x <= 0) return null; return x > 1.5 ? x / 100 : x; };

// Every club-game the blocks hold: [{ key, team, gameId, opp, home }].
export function clubGames(blocks) {
  const seen = new Map();
  for (const b of blocks) {
    const C = colIndex(b.cols);
    for (const r of b.plays || []) {
      const team = r[C.posteam];
      if (!team) continue;
      const id = `${b.key}|${team}`;
      if (!seen.has(id)) seen.set(id, { key: b.key, team, gameId: r[C.game_id], opp: r[C.defteam], home: truthy(r[C.homeOff]) });
    }
  }
  return [...seen.values()];
}

function gamePasses(st, g) {
  if (st.team && g.team !== st.team) return false;
  if (st.opp && g.opp !== st.opp) return false;
  if (st.ha === "home" && !g.home) return false;
  if (st.ha === "away" && g.home) return false;
  return true;
}

export function aggregateUsage(blocks, players, st) {
  const games = clubGames(blocks);
  const inWin = gamesInWindow(games, st);
  const gameInfo = new Map(games.map((g) => [`${g.key}|${g.team}`, g]));
  const gameOk = (gk) => inWin.has(gk) && gamePasses(st, gameInfo.get(gk));
  const situational = isSituational(st);

  const teamAtt = new Map(), teamAir = new Map();
  const acc = new Map();
  const P = (id) => {
    if (!acc.has(id)) acc.set(id, { tgt: 0, air: 0, adotN: 0, rz: 0, ez: 0, rec: 0, yds: 0, td: 0, epa: 0, epaN: 0,
      games: new Set(), wk: new Map(), wkAir: new Map(), wkRec: new Map(), snaps: new Map(), routes: new Map(), zones: {} });
    return acc.get(id);
  };
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);

  for (const b of blocks) {
    const C = colIndex(b.cols);
    const pred = playPredicate(st, C);
    for (const r of b.plays || []) {
      const gk = `${b.key}|${r[C.posteam]}`;
      if (!gameOk(gk)) continue;
      const pi = truthy(r[C.pi]);
      if (pi && st.pi === false) continue;
      // Appearance on any play (before the down/quarter filter) makes it one of his games.
      for (const col of ["passer", "target", "rusher"]) if (r[C[col]]) P(r[C[col]]).games.add(gk);
      if (!pred(r)) continue;
      if (r[C.type] !== "pass") continue;
      const air = num(r[C.air]);
      // A pass-interference target is not a pass attempt: the club's attempts and air yards leave it out.
      if (!pi) { add(teamAtt, gk, 1); add(teamAir, gk, air ?? 0); }
      const id = r[C.target];
      if (!id) continue;
      const p = P(id);
      p.tgt++; p.air += air ?? 0; add(p.wkAir, gk, air ?? 0);
      if (!(pi && air === null)) p.adotN++;
      const band = r[C.band], dir = r[C.dir];
      if (band && dir) p.zones[`${band}${dir}`] = (p.zones[`${band}${dir}`] || 0) + 1;
      if (truthy(r[C.redzone])) p.rz++;
      if (truthy(r[C.ezTarget])) p.ez++;
      if (!pi && truthy(r[C.complete])) { p.rec++; const y = num(r[C.yards]) ?? 0; p.yds += y; add(p.wkRec, gk, y); }
      if (truthy(r[C.td]) && !truthy(r[C.int])) p.td++;
      const e = num(r[C.epa]); if (e !== null) { p.epa += e; p.epaN++; }
      add(p.wk, gk, 1);
    }
    // Snaps (percent of the club's offensive snaps, null when he did not play offence); his club that week
    // comes from the players file.
    for (const [id, s] of Object.entries(b.snaps || {})) {
      const off = num(s?.off);
      const team = players?.[id]?.teams?.[b.key];
      if (!team || off === null || off <= 0) continue;
      const gk = `${b.key}|${team}`;
      if (!gameOk(gk)) continue;
      const p = P(id); p.games.add(gk); p.snaps.set(gk, off / 100);
    }
    for (const [id, rt] of Object.entries(b.routes || {})) {
      const n = num(rt?.routes);
      const team = players?.[id]?.teams?.[b.key];
      if (!team || n === null) continue;
      const gk = `${b.key}|${team}`;
      if (!gameOk(gk)) continue;
      P(id).routes.set(gk, { n, pct: frac(rt.routePct) });
    }
  }

  // The club's games in the window (after the filters): the reference pool's per-game rule scales with it.
  const clubWin = new Map();
  for (const gk of inWin) if (gameOk(gk)) { const t = gk.split("|")[1]; clubWin.set(t, (clubWin.get(t) || 0) + 1); }
  const weeks = [...new Set([...inWin].filter(gameOk).map((gk) => gk.split("|")[0]))].sort();
  const rows = [];
  for (const [id, p] of acc) {
    const meta = players?.[id] || {};
    const pos = String(meta.pos || "").toUpperCase();
    if (!posAllowed(st.pos, pos)) continue;
    const routesTotal = [...p.routes.values()].reduce((s, x) => s + x.n, 0);
    if (p.tgt === 0 && routesTotal === 0) continue;
    const g = [...p.games].sort();
    const att = g.reduce((s, gk) => s + (teamAtt.get(gk) || 0), 0);
    const teamAy = g.reduce((s, gk) => s + (teamAir.get(gk) || 0), 0);
    const tgtShare = ratio(p.tgt, att);
    const ayShare = ratio(p.air, teamAy);
    const wopr = tgtShare === null || ayShare === null ? null : 1.5 * tgtShare + 0.7 * ayShare;

    let routes = null, routePct = null, tprr = null, yprr = null, snapPct = null;
    if (!situational && p.routes.size) {
      routes = routesTotal;
      let tRoutes = 0, tTgt = 0, tYds = 0, dropbacks = 0, pctOk = true;
      for (const [gk, x] of p.routes) {
        tRoutes += x.n; tTgt += p.wk.get(gk) || 0; tYds += p.wkRec.get(gk) || 0;
        if (x.pct) dropbacks += x.n / x.pct; else if (x.n > 0) pctOk = false;
      }
      routePct = pctOk ? ratio(tRoutes, dropbacks) : null;
      tprr = ratio(tTgt, tRoutes);
      yprr = ratio(tYds, tRoutes);
    }
    if (!situational && p.snaps.size) snapPct = [...p.snaps.values()].reduce((a, b) => a + b, 0) / p.snaps.size;
    const byKey = new Map();
    for (const gk of g) byKey.set(gk.split("|")[0], gk);
    const series = weeks.map((key) => {
      const gk = byKey.get(key);
      if (!gk) return { key, v: null, ay: null, snap: null, tgt: 0 };
      return { key, v: ratio(p.wk.get(gk) || 0, teamAtt.get(gk) || 0), ay: ratio(p.wkAir.get(gk) || 0, teamAir.get(gk) || 0),
        snap: situational ? null : p.snaps.get(gk) ?? null, tgt: p.wk.get(gk) || 0 };
    });
    const lastGk = g[g.length - 1];
    rows.push({
      gsis: id, name: meta.name || id, pos, espnId: meta.espnId ?? null,
      team: lastGk ? lastGk.split("|")[1] : "", g: g.length, clubG: lastGk ? clubWin.get(lastGk.split("|")[1]) || 0 : 0,
      tgt: p.tgt, tgtShare, ay: p.air, ayShare, wopr, adot: ratio(p.air, p.adotN),
      rz: p.rz, ez: p.ez, rec: p.rec, yds: p.yds, td: p.td, epaTgt: p.epaN ? p.epa / p.epaN : null,
      routes, routePct, tprr, yprr, snapPct, series, zones: p.zones,
    });
  }
  return { rows, weeks };
}

// PERSPECTIVE (Adam, 2026-09-24): every rate is shown against the league average for the same window. The
// average is the plain mean over the rows given with at least `minTgt` targets; usageReference below passes one
// position's reference pool with minTgt 0. `weekly[key]` holds the same means for each week, over the players
// who played that week. Rows come aggregated with no team or opponent filter, so a one-club view still compares
// with the whole league.
const AVG_KEYS = ["tgtShare", "ayShare", "wopr", "adot", "epaTgt", "yprr", "tprr", "routePct", "snapPct"];
export function leagueAverages(rows, minTgt = 0) {
  const q = rows.filter((r) => r.tgt >= minTgt);
  const mean = (vals) => { const v = vals.filter((x) => x !== null && x !== undefined); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const overall = Object.fromEntries(AVG_KEYS.map((k) => [k, mean(q.map((r) => r[k]))]));
  const weekly = {};
  for (const r of q) r.series.forEach((s) => { (weekly[s.key] ||= { v: [], ay: [], snap: [] }); for (const k of ["v", "ay", "snap"]) weekly[s.key][k].push(s[k]); });
  for (const key of Object.keys(weekly)) for (const k of ["v", "ay", "snap"]) weekly[key][k] = mean(weekly[key][k]);
  return { overall, weekly, n: q.length };
}

// ---- the reference pool and position tiers (Adam, 2026-09-24) -------------------------------------------
// POOL: the league reference and the colour tiers count the players AT HIS POSITION averaging at least 2
// targets per game of his club's games in the window, with a floor of 5 targets (carries likewise for the
// rushing references). One rule that scales with the window: 5 over one or two club games, 6 over three, 34
// over seventeen. The leaderboard's Min targets box is separate (it only hides rows).
export const POOL_PER_GAME = 2, POOL_FLOOR = 5;
export const poolMin = (clubG) => Math.max(POOL_FLOOR, POOL_PER_GAME * (clubG || 0));
export const inPool = (count, clubG) => (count || 0) >= poolMin(clubG);
export const REF_POS = new Set(["WR", "TE", "RB", "FB"]);
// "WRs with 2+ targets/game (min 5) in the window (84)"
export const referenceText = (pos, n, unit = "targets") => `${pos}s with ${POOL_PER_GAME}+ ${unit}/game (min ${POOL_FLOOR}) in the window (${n})`;

// TIERS: each coloured metric is cut at its position pool's 90th, 70th, 40th and 15th percentiles (linear
// interpolation between ranks); a value at or above a cut takes that tier: elite, strong, avg, weak, else flat
// ("low"). A pool under MIN_POOL men with a value falls back to the league-wide pool (every pass-catching position
// together) for that metric; under MIN_POOL there too, the metric is left uncoloured.
export const TIER_PCTS = [0.9, 0.7, 0.4, 0.15];
export const TIER_NAMES = ["elite", "strong", "avg", "weak", "flat"];
export const MIN_POOL = 8;
export const USAGE_TIER_KEYS = ["tgtShare", "ayShare", "wopr", "routePct", "snapPct", "tprr", "yprr", "epaTgt"];
const finite = (x) => x !== null && x !== undefined && Number.isFinite(+x);
export function percentileCuts(vals) {
  const v = vals.filter(finite).map(Number).sort((a, b) => a - b);
  if (!v.length) return null;
  const at = (p) => { const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  return TIER_PCTS.map(at);
}
export function tierFromCuts(v, cuts) {
  if (!cuts || !finite(v)) return "";
  const i = cuts.findIndex((c) => v >= c);
  return TIER_NAMES[i < 0 ? 4 : i];
}
// { [key]: { cuts, n (men in the pool that set the cuts), posN (men at his position with a value), src: "pos" |
// "league" | null } } for one position, from his position's pool items and the league-wide pool items.
export function tierCuts(posItems, leagueItems, keys) {
  const out = {};
  for (const k of keys) {
    const pv = posItems.map((x) => x[k]).filter(finite);
    if (pv.length >= MIN_POOL) { out[k] = { cuts: percentileCuts(pv), n: pv.length, posN: pv.length, src: "pos" }; continue; }
    const lv = leagueItems.map((x) => x[k]).filter(finite);
    out[k] = lv.length >= MIN_POOL ? { cuts: percentileCuts(lv), n: lv.length, posN: pv.length, src: "league" } : { cuts: null, n: lv.length, posN: pv.length, src: null };
  }
  return out;
}
// The hover text for a coloured value: empty when his own position set the cuts, else why it did not.
export function tierNote(entry, pos) {
  if (!entry || entry.src === "pos") return "";
  if (entry.src === "league") return `Colour from the league-wide cuts: only ${entry.posN} ${pos}${entry.posN === 1 ? "" : "s"} in the reference pool (under ${MIN_POOL})`;
  return `Not coloured: under ${MIN_POOL} players in the reference pool`;
}

// The usage reference for every position from rows aggregated with no team, opponent or position filter (the
// whole league, the same window): `at(pos)` gives { lg (leagueAverages over his position's pool, with tgt, rz,
// ez and routes means added), n, cuts, text }. `league` is every pass-catching position's pool together.
export function usageReference(rows) {
  const pool = rows.filter((r) => REF_POS.has(r.pos) && inPool(r.tgt, r.clubG));
  const mean = (vals) => { const v = vals.filter(finite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const cache = new Map();
  const at = (posIn) => {
    const pos = String(posIn || "").toUpperCase();
    if (!cache.has(pos)) {
      const q = pool.filter((r) => r.pos === pos);
      const lg = leagueAverages(q, 0);
      for (const k of ["tgt", "rz", "ez", "routes"]) lg.overall[k] = mean(q.map((r) => r[k]));
      cache.set(pos, { pos, lg, n: q.length, cuts: tierCuts(q, pool, USAGE_TIER_KEYS), text: referenceText(pos, q.length) });
    }
    return cache.get(pos);
  };
  return { at, pool, n: pool.length };
}

// Sort helper shared by the table: nulls always last, whichever direction.
export function sortRows(rows, key, dir = "desc") {
  const s = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === "string") return s * x.localeCompare(y);
    return s * (x - y) || b.tgt - a.tgt;
  });
}
