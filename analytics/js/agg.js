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
      team: lastGk ? lastGk.split("|")[1] : "", g: g.length,
      tgt: p.tgt, tgtShare, ay: p.air, ayShare, wopr, adot: ratio(p.air, p.adotN),
      rz: p.rz, ez: p.ez, rec: p.rec, yds: p.yds, td: p.td, epaTgt: p.epaN ? p.epa / p.epaN : null,
      routes, routePct, tprr, yprr, snapPct, series, zones: p.zones,
    });
  }
  return { rows, weeks };
}

// PERSPECTIVE (Adam, 2026-09-24): every rate is shown against the league average for the same window. The
// average is the plain mean over the qualifying players (the rows that pass the position chips and have at
// least `minTgt` targets), so it narrows to his position when the chips do. `weekly[key]` holds the same means
// for each week, over the qualifying players who played that week. The caller passes rows aggregated with no
// team or opponent filter, so a one-club view still compares with the whole league.
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
