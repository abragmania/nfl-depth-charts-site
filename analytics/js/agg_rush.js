// PURE (no DOM, no fetch): the rushing leaderboard (#/rushing). Every man with a carry in the window: backs, fullbacks,
// quarterbacks (designed runs and scrambles) and receivers (jet sweeps). D177: efficiency matters (EPA per carry,
// success rate, yards per carry and over expected); rush direction was dropped by Adam and is not shown. D182: for a
// back, opportunity and involvement lead, so snap share, routes, targets and target share sit beside the carries.
// Every figure has one source (D178):
//   play-by-play (nflverse): carries, yards, TD, EPA, success, red-zone and goal-line carries, long, explosive runs,
//     the club's designed runs (rush share), targets and target share (through agg.js aggregateUsage, so a back's
//     targets here are the same figure the Usage page prints);
//   snap counts (nflverse): snap %; heatradar: routes;
//   Next Gen Stats (tracking only): rush yards over expected and efficiency.
//
// Definitions:
//   carry        = a designed run (ledger type "run", he is the rusher) or, for a passer, a scramble (type "scramble").
//                  Kneels and spikes never reach the ledger.
//   rush share   = his DESIGNED runs / his club's designed runs in his games (total over total). A scramble is a
//                  called pass, so it sits on neither side; this matches the RB player page's rush share.
//   YPC          = rush yards / carries. EPA/carry and Success % = means over carries carrying the figure.
//   RZ carries   = carries from the opponent's 20 or closer (the ledger's redzone flag).
//   GL carries   = carries from the opponent's 5 or closer (yardline_100 <= 5).
//   Long         = his longest carry in the window. Explosive % = carries of 10+ yards / carries.
//   carry bins   = his carries by gain: 0 or less (stuffed), 1-3, 4-9, 10+ (explosive).
//   RYOE/att     = NGS rush yards over expected summed over the weeks NGS lists him / his designed runs those weeks
//                  (the same rule as the RB player page). Eff = NGS efficiency (distance run / rush yards; LOWER is
//                  more north-south), weighted by his designed runs those weeks.
//   Snap %       = the mean of his weekly offensive snap percentages (as on the Usage page).
//   Games        = the club-games in the window where he appears on any play or took an offensive snap.
// OPPORTUNITIES (D191, Adam 2026-09-24: raw opportunities matter more than yards per opportunity; the counts lead):
//   Opp          = carries (a QB's scrambles included) + targets (the Usage page's count, so the PI-targets switch
//                  applies); a man with carries and no Usage row has 0 targets.
//   Opp/g        = Opp / games.
//   Opp %        = (designed runs + targets) / (the club's designed runs + the club's pass attempts) in his games. A
//                  scramble is a called pass but not a pass attempt, so it sits on neither side (as in rush share); a
//                  pass-interference target is never a club pass attempt (agg.js).
//   Yds/opp      = (rushing yards + receiving yards) / Opp.  EPA/opp = (EPA summed over his carries + EPA summed over
//                  his targets, agg.js's EPA/Tgt numerator) / Opp.  TD/opp = (rushing + receiving touchdowns) / Opp.
// REFERENCE POOL (Adam, 2026-09-24; agg.js's rule with carries): players AT HIS POSITION averaging 2+ carries per
// game of his club's games in the window, floor 5. The league line is the plain mean over that pool; the colour tiers
// are its 90/70/40/15th percentiles (agg.js tierCuts; under 8 men, the league-wide pool of every position).
// RE-CUT ADDITIONS (increment 3, PROJECT.md Part 4 B2; new keys only, no existing key changes):
//   in10, in10Td = carries from the opponent's 10 or closer (yardline_100 <= 10) and their TDs; in10TdRate = in10Td / in10.
//   rzTd         = TDs on his red-zone carries.  yds20 = rush yards on carries of 20+; yds20Share = yds20 / yds.
//   from his Usage row (every position, the same filters): rec, epaTgt, yprr, tprr, catchPct, routePct, rzTgt (his
//                  red-zone targets), rzTgtTd (TDs on them); (recYds and recTd were already here.)
//   rzOpp        = rz + rzTgt.  rzOppTd = rzTd + rzTgtTd.  rzOppTdRate = rzOppTd / rzOpp.
//   fum, fl      = rows where he is the fumbler (the offense fumbled) and those lost, any play type.  flRate = fl / fum.
//   ybcCar, btCar = PFR rushing (decision 3): Σ yards before contact / Σ PFR carries and Σ broken tackles / Σ PFR
//                  carries over the weeks PFR's rushing file lists him in his games (pfrCar = that denominator); null
//                  when it lists him in none (the file may be empty). PFR's carry count is only this denominator; the
//                  play-by-play carries stay canonical (D178).
//   dk, dkG, dkTdShare = agg_fantasy.js (DraftKings, D194), dkG over this row's g.
// Weekly-table figures (the PFR two) and DK go blank under a down or quarter filter.
import { colIndex, clubGames, aggregateUsage, inPool, tierCuts, tierFromCuts, referenceText, rushEvent, pooledRatio, plainMean } from "./agg.js";
import { gamesInWindow, playPredicate, posAllowed, POSITIONS, isSituational } from "./filters.js";
import { fantasyByPlayer, dkFields } from "./agg_fantasy.js";

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
const ratio = (a, b) => (b > 0 ? a / b : null);
const finite = (x) => x !== null && x !== undefined && Number.isFinite(+x);
const mean = (vals) => { const v = vals.filter(finite).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export const RUSH_DEFAULT_POS = Object.freeze({ RB: "in", FB: "in" });
export const RUSH_MIN_CAR = 10;
export const GOAL_LINE = 5, EXPLOSIVE = 10;
export const BIN_LABELS = ["0 or less", "1–3", "4–9", "10+"];
const binOf = (y) => (y <= 0 ? 0 : y <= 3 ? 1 : y <= 9 ? 2 : 3);

// Colour tiers by position. Eff is cut on the negated value (lower is better).
export const RUSH_TIER_KEYS = ["opp", "oppG", "oppShare", "carG", "rushShare", "ypc", "succPct", "epaCar", "ryoeAtt", "eff", "explPct", "snapPct", "tgtShare", "dkG"];
export const RUSH_LOWER_BETTER = new Set(["eff"]);
export const RUSH_LG_KEYS = ["opp", "oppG", "oppShare", "ydsOpp", "epaOpp", "tdOpp", "car", "carG", "rushShare", "yds", "ypc", "succPct", "epaCar", "ryoeAtt", "eff", "rz", "gl", "td", "long", "explPct", "snapPct", "routes", "tgt", "tgtShare",
  // re-cut increment 3 (B2)
  "in10", "in10Td", "rzTd", "yds20", "rec", "recYds", "recTd", "epaTgt", "yprr", "tprr", "catchPct", "routePct", "rzTgt", "rzOpp", "fum", "fl", "dk", "dkG", "dkTdShare", "ybcCar", "btCar"];
export const IN10 = 10, LONG_RUN = 20;
export const rushTier = (k, v, cuts) => (finite(v) ? tierFromCuts(RUSH_LOWER_BETTER.has(k) ? -v : +v, cuts?.[k]?.cuts) : "");

// One play row as a carry, or null: { id, designed }. Defined in agg.js (the Usage page's opportunities count carries
// by the same rule) and re-exported here.
export { rushEvent };

function gamePasses(st, g) {
  if (!g) return false;
  if (st.team && g.team !== st.team) return false;
  if (st.opp && g.opp !== st.opp) return false;
  return true;
}

const newAcc = () => ({ games: new Set(), car: 0, des: 0, scr: 0, yds: 0, epa: 0, epaN: 0, succ: 0, succN: 0, rz: 0, gl: 0, td: 0,
  long: null, expl: 0, bins: [0, 0, 0, 0], wk: new Map(), snaps: new Map(), in10: 0, in10Td: 0, rzTd: 0, yds20: 0 });

// Rows for every man with a carry in the window after the team, opponent and position filters. Returns
// { rows, weeks (window week keys, sorted) }. Each row's `series` spans the window's weeks:
// { key, car, des, yds, share } for a week he played (car 0 when he played without a carry), { key, dnp: true } when
// his club played without him, { key } (all null) for his club's bye.
export function aggregateRush(blocks, players, st) {
  const games = clubGames(blocks);
  const inWin = gamesInWindow(games, st);
  const info = new Map(games.map((g) => [`${g.key}|${g.team}`, g]));
  const gameOk = (gk) => inWin.has(gk) && gamePasses(st, info.get(gk));
  const acc = new Map();
  const A = (id) => { if (!acc.has(id)) acc.set(id, newAcc()); return acc.get(id); };
  const clubRuns = new Map(); // gk -> the club's designed runs
  const clubAtt = new Map(); // gk -> the club's pass attempts (agg.js's rule: a pass-interference target is not one)
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  const fumOf = new Map(); // gsis -> { fum, fl }; apart from acc so a fumbler-only man never adds a row

  for (const b of blocks) {
    const C = colIndex(b.cols);
    const pred = playPredicate(st, C);
    for (const r of b.plays || []) {
      const gk = `${b.key}|${r[C.posteam]}`;
      if (!gameOk(gk)) continue;
      const pi = truthy(r[C.pi]);
      if (!(pi && st.pi === false)) for (const col of ["passer", "target", "rusher"]) if (r[C[col]]) A(r[C[col]]).games.add(gk);
      if (!pred(r)) continue;
      const fid = C.fumbler === undefined ? null : r[C.fumbler];
      if (fid) { const f = fumOf.get(fid) || { fum: 0, fl: 0 }; f.fum++; if (truthy(r[C.fumLost])) f.fl++; fumOf.set(fid, f); }
      if (r[C.type] === "run") add(clubRuns, gk, 1);
      if (r[C.type] === "pass" && !pi) add(clubAtt, gk, 1);
      const e = rushEvent(r, C);
      if (!e) continue;
      const a = A(e.id);
      const y = num(r[C.yards]) ?? 0, ep = num(r[C.epa]), sc = num(r[C.success]), yl = num(r[C.yardline_100]);
      a.car++; if (e.designed) a.des++; else a.scr++;
      a.yds += y;
      if (ep !== null) { a.epa += ep; a.epaN++; }
      if (sc !== null) { a.succ += sc; a.succN++; }
      if (truthy(r[C.redzone])) a.rz++;
      if (yl !== null && yl <= GOAL_LINE) a.gl++;
      if (truthy(r[C.td])) a.td++;
      if (yl !== null && yl <= IN10) { a.in10++; if (truthy(r[C.td])) a.in10Td++; }
      if (truthy(r[C.redzone]) && truthy(r[C.td])) a.rzTd++;
      if (y >= LONG_RUN) a.yds20 += y;
      if (a.long === null || y > a.long) a.long = y;
      if (y >= EXPLOSIVE) a.expl++;
      a.bins[binOf(y)]++;
      const w = a.wk.get(b.key) || { car: 0, des: 0, yds: 0 };
      w.car++; if (e.designed) w.des++; w.yds += y;
      a.wk.set(b.key, w);
    }
    // Snaps: a game he took an offensive snap in is one of his games (a back who only blocked still played).
    for (const [id, s] of Object.entries(b.snaps || {})) {
      const off = num(s?.off);
      const team = players?.[id]?.teams?.[b.key];
      if (!team || off === null || off <= 0) continue;
      const gk = `${b.key}|${team}`;
      if (!gameOk(gk)) continue;
      const a = A(id); a.games.add(gk); a.snaps.set(gk, off / 100);
    }
  }

  // NGS rushing (weekly): summed RYOE and run-weighted efficiency over the window weeks he had a designed run.
  const ngs = new Map();
  for (const b of blocks) {
    for (const [id, n] of Object.entries(b.ngs?.rushing || {})) {
      const a = acc.get(id), w = a?.wk.get(b.key);
      if (!w || !w.des || ![...a.games].some((gk) => gk.startsWith(b.key + "|"))) continue;
      const x = ngs.get(id) || { ryoe: 0, ryoeCar: 0, eff: 0, effCar: 0 };
      if (num(n.ryoe) !== null) { x.ryoe += +n.ryoe; x.ryoeCar += w.des; }
      if (num(n.efficiency) !== null) { x.eff += n.efficiency * w.des; x.effCar += w.des; }
      ngs.set(id, x);
    }
  }

  // PFR rushing (weekly, decision 3): yards before contact and broken tackles over PFR's own carries, the weeks it
  // lists him in one of his window games.
  const situational = isSituational(st);
  const pfr = new Map();
  if (!situational) for (const b of blocks) {
    for (const [id, x] of Object.entries(b.pfr?.rush || {})) {
      const a = acc.get(id), car = num(x?.carries);
      if (!a || car === null || car <= 0 || ![...a.games].some((gk) => gk.startsWith(b.key + "|"))) continue;
      const p = pfr.get(id) || { ybc: 0, ybcCar: 0, bt: 0, btCar: 0 };
      if (num(x.ybc) !== null) { p.ybc += +x.ybc; p.ybcCar += car; }
      if (num(x.brokenTkl) !== null) { p.bt += +x.brokenTkl; p.btCar += car; }
      pfr.set(id, p);
    }
  }
  const fantasy = fantasyByPlayer(blocks, players, st);

  // Involvement: targets, target share and routes from the Usage aggregation (every position, the same filters).
  const usage = new Map(aggregateUsage(blocks, players, { ...st, pos: {} }).rows.map((r) => [r.gsis, r]));

  const clubWin = new Map();
  for (const gk of inWin) if (gameOk(gk)) { const t = gk.split("|")[1]; clubWin.set(t, (clubWin.get(t) || 0) + 1); }
  const weeks = [...new Set([...inWin].filter(gameOk).map((gk) => gk.split("|")[0]))].sort();
  const rows = [];
  for (const [id, a] of acc) {
    if (!a.car) continue;
    const meta = players?.[id] || {};
    const pos = String(meta.pos || "").toUpperCase();
    if (!posAllowed(st.pos, pos)) continue;
    const g = [...a.games].sort();
    const lastGk = g[g.length - 1];
    const team = lastGk ? lastGk.split("|")[1] : "";
    const runs = g.reduce((s, gk) => s + (clubRuns.get(gk) || 0), 0);
    const byKey = new Map(g.map((gk) => [gk.split("|")[0], gk]));
    const series = weeks.map((key) => {
      const gk = byKey.get(key);
      if (gk) {
        const w = a.wk.get(key) || { car: 0, des: 0, yds: 0 };
        return { key, car: w.car, des: w.des, yds: w.yds, share: ratio(w.des, clubRuns.get(gk) || 0) };
      }
      const t = meta.teams?.[key] || team;
      return gameOk(`${key}|${t}`) ? { key, dnp: true, car: null, share: null } : { key, car: null, share: null };
    });
    const n = ngs.get(id), u = usage.get(id);
    const att = g.reduce((s, gk) => s + (clubAtt.get(gk) || 0), 0);
    const tgt = u?.tgt ?? 0;
    const opp = a.car + tgt;
    rows.push({
      gsis: id, name: meta.name || id, pos, espnId: meta.espnId ?? null, team, g: g.length, clubG: clubWin.get(team) || 0,
      car: a.car, des: a.des, scr: a.scr, carG: ratio(a.car, g.length), rushShare: ratio(a.des, runs), clubRuns: runs,
      yds: a.yds, ypc: ratio(a.yds, a.car), succPct: ratio(a.succ, a.succN), epaCar: ratio(a.epa, a.epaN),
      rz: a.rz, gl: a.gl, td: a.td, long: a.long, explPct: ratio(a.expl, a.car), expl: a.expl, bins: a.bins,
      ryoeAtt: n ? ratio(n.ryoe, n.ryoeCar) : null, eff: n ? ratio(n.eff, n.effCar) : null,
      snapPct: a.snaps.size ? [...a.snaps.values()].reduce((s, x) => s + x, 0) / a.snaps.size : null,
      routes: u?.routes ?? null, tgt, tgtShare: u?.tgtShare ?? null,
      clubAtt: att, recYds: u?.yds ?? 0, recEpa: u?.recEpa ?? 0, recTd: u?.td ?? 0,
      opp, oppG: ratio(opp, g.length), oppShare: ratio(a.des + tgt, runs + att),
      ydsOpp: ratio(a.yds + (u?.yds ?? 0), opp), epaOpp: ratio(a.epa + (u?.recEpa ?? 0), opp), tdOpp: ratio(a.td + (u?.td ?? 0), opp),
      series,
      ...recutRush(a, u, fumOf.get(id), pfr.get(id)),
      ...dkFields(fantasy.get(id), g.length, st),
    });
  }
  return { rows, weeks };
}

// The re-cut's additive rushing keys (see the header).
function recutRush(a, u, f, p) {
  const rzTgt = u?.rz ?? 0, rzTgtTd = u?.rzTd ?? 0;
  const rzOpp = a.rz + rzTgt, rzOppTd = a.rzTd + rzTgtTd;
  const fum = f?.fum ?? 0, fl = f?.fl ?? 0;
  return {
    in10: a.in10, in10Td: a.in10Td, in10TdRate: ratio(a.in10Td, a.in10), rzTd: a.rzTd, yds20: a.yds20, yds20Share: ratio(a.yds20, a.yds),
    rec: u?.rec ?? 0, piTgt: u?.piTgt ?? 0, epaTgt: u?.epaTgt ?? null, yprr: u?.yprr ?? null, tprr: u?.tprr ?? null, catchPct: u?.catchPct ?? null,
    routePct: u?.routePct ?? null, rzTgt, rzTgtTd, rzOpp, rzOppTd, rzOppTdRate: ratio(rzOppTd, rzOpp),
    fum, fl, flRate: ratio(fl, fum),
    ybcCar: p ? ratio(p.ybc, p.ybcCar) : null, btCar: p ? ratio(p.bt, p.btCar) : null, pfrCar: p ? p.ybcCar : null, pfrYbc: p ? p.ybc : null,
  };
}

// The league reference from rows aggregated with no team, opponent or position filter (the whole league, the same
// window): `at(pos)` gives { lg (plain means over his position's pool, plus `bins`, the pool's carries by gain pooled
// as shares), n, cuts, text, pooled }. `pooled` (re-cut B2, the variance strip): each rate as the position pool's
// summed numerator over its summed denominator, except dkTdShare, the plain pool mean; lg's plain means are untouched. `pool` is every position's pool together (the league-wide tier fallback).
export function rushReference(rows) {
  const pool = rows.filter((r) => inPool(r.car, r.clubG));
  const forCuts = (list) => list.map((r) => ({ ...r, eff: finite(r.eff) ? -r.eff : null }));
  const lgPool = forCuts(pool);
  const cache = new Map();
  const at = (posIn) => {
    const pos = String(posIn || "").toUpperCase();
    if (!cache.has(pos)) {
      const q = pool.filter((r) => r.pos === pos);
      const lg = Object.fromEntries(RUSH_LG_KEYS.map((k) => [k, mean(q.map((r) => r[k]))]));
      const bins = [0, 1, 2, 3].map((i) => q.reduce((s, r) => s + r.bins[i], 0));
      const tot = bins.reduce((s, x) => s + x, 0);
      lg.bins = tot ? bins.map((x) => x / tot) : null;
      cache.set(pos, { pos, lg, n: q.length, cuts: tierCuts(forCuts(q), lgPool, RUSH_TIER_KEYS), text: referenceText(pos, q.length, "carries"), pooled: rushPooled(q) });
    }
    return cache.get(pos);
  };
  return { at, pool, n: pool.length };
}

export function rushPooled(q) {
  return {
    rzOppTdRate: pooledRatio(q, (r) => r.rzOppTd, (r) => r.rzOpp),
    in10TdRate: pooledRatio(q, (r) => r.in10Td, (r) => r.in10),
    yds20Share: pooledRatio(q, (r) => r.yds20, (r) => r.yds),
    ybcCar: pooledRatio(q, (r) => r.pfrYbc, (r) => r.pfrCar),
    catchPct: pooledRatio(q, (r) => r.rec, (r) => r.tgt - (r.piTgt || 0)),
    flRate: pooledRatio(q, (r) => r.fl, (r) => r.fum),
    dkTdShare: plainMean(q.map((r) => r.dkTdShare)),
  };
}

// Sort, nulls always last whichever direction; ties by carries.
export function sortRushRows(rows, key, dir = "desc") {
  const s = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (typeof x === "string" || typeof y === "string") return s * String(x ?? "").localeCompare(String(y ?? ""));
    if (!finite(x)) return !finite(y) ? b.car - a.car : 1;
    if (!finite(y)) return -1;
    return s * (x - y) || b.car - a.car;
  });
}

// ---- the page's hash -----------------------------------------------------------------------------------------
// The rushing page keeps its own defaults in the shared hash: positions RB + FB (not Usage's WR/TE/RB), sort by
// carries, and `mincar` (the minimum carries box, default 10), so the Usage page's Min targets is untouched.
const posStr = (pos) => POSITIONS.filter((p) => pos[p]).map((p) => (pos[p] === "out" ? "-" : "") + p).join(",");
export const samePos = (a, b) => posStr(a || {}) === posStr(b || {});
export function rushOpts(query) {
  const q = new URLSearchParams(String(query || "").replace(/^\?/, ""));
  const v = q.get("mincar");
  return {
    minCar: v !== null && Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : RUSH_MIN_CAR,
    hasPos: q.has("pos"), sort: /^[a-zA-Z0-9]+$/.test(q.get("sort") || "") ? q.get("sort") : "car",
  };
}
// `base` is filters.toQuery(st); the rushing page rewrites its pos, sort and mincar.
export function rushQueryFrom(base, st, minCar) {
  const q = new URLSearchParams(base);
  q.delete("pos"); q.delete("sort");
  if (!samePos(st.pos, RUSH_DEFAULT_POS)) q.set("pos", posStr(st.pos) || "none");
  if (st.sort && st.sort !== "car") q.set("sort", st.sort);
  if (minCar !== RUSH_MIN_CAR) q.set("mincar", minCar);
  return q.toString();
}
