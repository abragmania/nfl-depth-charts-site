// PURE (no DOM, no fetch): everything the pass-catcher player page (#/player/:gsis, D182) shows, computed from
// the same compiled week blocks the usage leaderboard reads, through agg.js's aggregateUsage() so a figure on
// this page is the same figure the leaderboard prints for him (D178: the play-by-play is canonical).
//
// PERSPECTIVE (D177): every rate carries a league reference for HIS POSITION GROUP over the SAME WINDOW. Tile
// references are the plain mean over his position's reference pool (agg.js: 2+ targets per club game in the window,
// floor 5; carries likewise for rushing) and tile colours are that pool's percentile tiers (agg.js tierCuts;
// under 8 men, the league-wide cuts). Zone and route references are POOLED over every target
// to his position group in the window (a cell's catch % is all their catches / all their targets there), because
// a per-player mean of a four-target cell is noise.
// TOTALS (D181): the weekly strips print the window's figure; a share totals as total over total, never a mean
// of weekly percentages (the window row from aggregateUsage already is).
// The weekly chart always spans every loaded week (the whole timeline, both seasons when Include 2025 is on) so a
// one-week window can be seen in context; the window's weeks are flagged `inWin` and drawn bright.
import { aggregateUsage, clubGames, colIndex, usageReference, inPool, tierCuts, referenceText } from "./agg.js";
import { gamesInWindow, splitKey } from "./filters.js";
import { aggregateRush, rushReference } from "./agg_rush.js";
import { fantasyByPlayer } from "./agg_fantasy.js";

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
const ratio = (a, b) => (b > 0 ? a / b : null);
const mean = (vals) => { const v = vals.filter((x) => x !== null && x !== undefined && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
export const median = (vals) => {
  const v = vals.filter((x) => x !== null && x !== undefined && Number.isFinite(+x)).map(Number).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export const CATCHER_POS = new Set(["WR", "TE", "RB", "FB"]);
export const RUSHER_POS = new Set(["RB", "FB"]);
export const RUSH_TIER_KEYS = ["ypc", "epaCar", "succPct", "rushShare", "ryoeAtt"];
// D191: a back's opportunity tiles are coloured against the rushing pool (as on the Rushing table); WR/TE use the usage pool.
export const OPP_TIER_KEYS = ["opp", "oppG", "oppShare"];
const OPP_KEYS = ["opp", "oppG", "oppShare", "ydsOpp", "epaOpp", "tdOpp"];
// Which page a position gets: the pass-catcher page for WR/TE/RB/FB; QBs and everyone else a "coming next" stub.
export function pageKind(pos) {
  const p = String(pos || "").toUpperCase();
  if (CATCHER_POS.has(p)) return "catcher";
  if (p === "QB") return "qb";
  return "other";
}
// The player page ignores team, opponent and the position chips (it is one man; his reference is his position).
export const pageState = (st) => ({ ...st, team: "", opp: "", ha: "", downs: [], qtrs: [], pos: {} });

const ZONE_BANDS = ["D", "I", "S", "B"];
const ZONE_DIRS = ["L", "M", "R"];
export const ZONE_KEYS = ZONE_BANDS.flatMap((b) => ZONE_DIRS.map((d) => b + d));

function emptyCell() { return { n: 0, pi: 0, rec: 0, yds: 0, epa: 0, epaN: 0 }; }
function addTarget(c, t) {
  c.n++; if (t.pi) c.pi++;
  if (t.complete) { c.rec++; c.yds += t.yards; }
  if (t.epa !== null) { c.epa += t.epa; c.epaN++; }
}
// The four zone measures for a cell (or a route): targets, catch % (catches / targets that were real passes: a
// pass-interference target is never a catch or an incompletion), yards per target, EPA per target.
export function cellRates(c) {
  if (!c || !c.n) return { n: 0, catchPct: null, ydsTgt: null, epaTgt: null };
  return { n: c.n, catchPct: ratio(c.rec, c.n - c.pi), ydsTgt: c.yds / c.n, epaTgt: c.epaN ? c.epa / c.epaN : null };
}

function resultText(t) {
  if (t.pi) return "DPI";
  if (t.int) return "INT";
  if (t.complete && t.td) return "TD";
  return t.complete ? "Catch" : "Incomplete";
}

// ---- the page ------------------------------------------------------------------------------------------
// `blocks` must hold every week the page's timeline shows (data.loadFor with window "season"); `st` is the page
// filter state (its window picks the weeks every total and tile uses). Returns null for an unknown gsis.
export function playerView(blocks, players, stIn, gsis) {
  const meta = players?.[gsis];
  if (!meta) return null;
  const st = pageState(stIn);
  const pos = String(meta.pos || "").toUpperCase();
  const kind = pageKind(pos);
  const out = { gsis, name: meta.name || gsis, pos, kind, espnId: meta.espnId ?? null };
  if (kind !== "catcher") { out.team = lastTeam(meta); return out; }

  const group = { [pos]: "in" };
  // Window rows for the whole league (every position: the tier cuts fall back to the league-wide pool when his
  // position's is small): his row, and his position's reference and tier cuts.
  const win = aggregateUsage(blocks, players, st);
  const row = win.rows.find((r) => r.gsis === gsis) || null;
  const uRef = usageReference(win.rows);
  const ref = uRef.at(pos);
  const lg = ref.lg;

  // The whole timeline: every loaded week, window or not.
  const fullSt = { ...st, pos: group, window: "season", from: null, to: null };
  const full = aggregateUsage(blocks, players, fullSt);
  const frow = full.rows.find((r) => r.gsis === gsis) || null;
  const games = clubGames(blocks);
  const oppOf = new Map(games.map((g) => [`${g.key}|${g.team}`, g]));
  const winSet = gamesInWindow(games, st);
  const winKeys = new Set(win.weeks);

  // One pass over the plays: his targets and carries (whole timeline, flagged in/out of the window), and the
  // position group's per-player and pooled figures inside the window.
  const grp = new Map(); // id -> per-player window accumulators for the group
  const G = (id) => {
    if (!grp.has(id)) grp.set(id, { tgt: 0, pi: 0, rec: 0, yac: 0, succ: 0, succN: 0, car: 0, ryds: 0, repa: 0, repaN: 0, rsucc: 0, rsuccN: 0, games: new Set(), wkTgt: new Map(), wkRec: new Map(), wkCar: new Map() });
    return grp.get(id);
  };
  const posOf = (id) => String(players?.[id]?.pos || "").toUpperCase();
  const inGroup = (id) => id && posOf(id) === pos;
  // Per-player accumulators run for every pass-catching position (the league-wide fallback pool needs them);
  // the pooled zone and route references stay his position's only.
  const tracked = (id) => id && CATCHER_POS.has(posOf(id));
  const clubWin = new Map(); // team -> the club's games in the window (the reference pool's per-game rule)
  for (const gk of winSet) { const t = gk.split("|")[1]; clubWin.set(t, (clubWin.get(t) || 0) + 1); }
  const clubGOf = (a) => { const last = [...a.games].sort().pop(); return last ? clubWin.get(last.split("|")[1]) || 0 : 0; };
  const lgZone = Object.fromEntries(ZONE_KEYS.map((k) => [k, emptyCell()]));
  const myZone = Object.fromEntries(ZONE_KEYS.map((k) => [k, { ...emptyCell(), plays: [] }]));
  const lgRoute = new Map(), myRoute = new Map();
  let lgZoned = 0, lgRouted = 0;
  const clubRuns = new Map(); // gk -> designed runs
  const clubAtt = new Map(); // gk -> pass attempts (agg.js's rule: a pass-interference target is not one)
  const myWeek = new Map(); // key -> { car, ryds, gk }
  const my = { ryds: 0, rz: 0, rtd: 0 }; // his window rushing counts the per-player accumulator does not keep
  let has2025Routes = false;

  for (const b of blocks) {
    const C = colIndex(b.cols);
    for (const r of b.plays || []) {
      const team = r[C.posteam];
      const gk = `${b.key}|${team}`;
      const inW = winSet.has(gk);
      const type = r[C.type];
      if (type === "run") clubRuns.set(gk, (clubRuns.get(gk) || 0) + 1);
      if (type === "pass" && !truthy(r[C.pi])) clubAtt.set(gk, (clubAtt.get(gk) || 0) + 1);
      // A pass-interference target with "excl. PI targets" is as if the ledger had dropped it: not even a game played.
      const piOff = truthy(r[C.pi]) && st.pi === false;
      if (!piOff) for (const col of ["passer", "target", "rusher"]) { const id = r[C[col]]; if (inW && tracked(id)) G(id).games.add(gk); }
      if (type === "pass" && r[C.target]) {
        const pi = truthy(r[C.pi]);
        if (pi && st.pi === false) continue;
        const id = r[C.target];
        const t = {
          pi, complete: !pi && truthy(r[C.complete]), yards: pi ? 0 : num(r[C.yards]) ?? 0, epa: num(r[C.epa]),
          yac: num(r[C.yac]), succ: num(r[C.success]), td: truthy(r[C.td]), int: truthy(r[C.int]),
          band: r[C.band], dir: r[C.dir], route: C.route !== undefined ? r[C.route] : null,
        };
        const zk = t.band && t.dir ? t.band + t.dir : null;
        if (inW && tracked(id)) {
          const a = G(id);
          a.tgt++; if (pi) a.pi++;
          a.wkTgt.set(gk, (a.wkTgt.get(gk) || 0) + 1);
          if (t.complete) { a.rec++; a.yac += t.yac ?? 0; a.wkRec.set(gk, (a.wkRec.get(gk) || 0) + 1); }
          if (t.succ !== null) { a.succ += t.succ; a.succN++; }
        }
        if (inW && inGroup(id)) {
          if (zk && lgZone[zk]) { addTarget(lgZone[zk], t); lgZoned++; }
          if (b.season === 2025 && t.route) {
            if (!lgRoute.has(t.route)) lgRoute.set(t.route, emptyCell());
            addTarget(lgRoute.get(t.route), t); lgRouted++;
          }
        }
        if (id === gsis && inW) {
          if (zk && myZone[zk]) {
            addTarget(myZone[zk], t);
            myZone[zk].plays.push({ key: b.key, opp: r[C.defteam], down: num(r[C.down]), togo: num(r[C.ydstogo]), yl: num(r[C.yardline_100]),
              qtr: num(r[C.qtr]), result: resultText(t), yards: t.yards, air: num(r[C.air]), epa: t.epa });
          }
          if (b.season === 2025 && t.route) {
            has2025Routes = true;
            if (!myRoute.has(t.route)) myRoute.set(t.route, emptyCell());
            addTarget(myRoute.get(t.route), t);
          }
        }
      } else if (type === "run" && r[C.rusher]) {
        const id = r[C.rusher];
        const yds = num(r[C.yards]) ?? 0, epa = num(r[C.epa]), succ = num(r[C.success]);
        if (inW && tracked(id)) {
          const a = G(id);
          a.car++; a.ryds += yds; a.wkCar.set(gk, (a.wkCar.get(gk) || 0) + 1);
          if (epa !== null) { a.repa += epa; a.repaN++; }
          if (succ !== null) { a.rsucc += succ; a.rsuccN++; }
        }
        if (id === gsis) {
          const w = myWeek.get(b.key) || { car: 0, ryds: 0, gk };
          w.car++; w.ryds += yds; myWeek.set(b.key, w);
          if (inW) {
            my.ryds += yds;
            if (truthy(r[C.redzone])) my.rz++;
            if (truthy(r[C.td])) my.rtd++;
          }
        }
      }
    }
    // Snaps count a game as played (a back who only blocked still played).
    for (const [id, s] of Object.entries(b.snaps || {})) {
      if (!tracked(id)) continue;
      const team = players?.[id]?.teams?.[b.key];
      const gk = `${b.key}|${team}`;
      if (team && winSet.has(gk) && (num(s?.off) ?? 0) > 0) G(id).games.add(gk);
    }
  }

  // ---- NGS (tracking only, D178): weekly values, weighted by his targets (separation, cushion) or catches
  // (YAC over expected) that week; rushing yards over expected summed and divided by his carries those weeks.
  const ngsFor = (id, a) => {
    let sepW = 0, sep = 0, cushW = 0, cush = 0, yoeW = 0, yoe = 0, ryoe = 0, ryoeCar = 0;
    for (const b of blocks) {
      const team = players?.[id]?.teams?.[b.key];
      const gk = `${b.key}|${team}`;
      if (!team || !winSet.has(gk)) continue;
      const rc = b.ngs?.receiving?.[id];
      const w = a.wkTgt.get(gk) || 0, wr = a.wkRec.get(gk) || 0;
      if (rc && w > 0) {
        if (num(rc.separation) !== null) { sep += rc.separation * w; sepW += w; }
        if (num(rc.cushion) !== null) { cush += rc.cushion * w; cushW += w; }
      }
      if (rc && wr > 0 && num(rc.yacOverExp) !== null) { yoe += rc.yacOverExp * wr; yoeW += wr; }
      const ru = b.ngs?.rushing?.[id];
      const car = a.wkCar.get(gk) || 0;
      if (ru && car > 0 && num(ru.ryoe) !== null) { ryoe += ru.ryoe; ryoeCar += car; }
    }
    return { sep: ratio(sep, sepW), cushion: ratio(cush, cushW), yacOE: ratio(yoe, yoeW), ryoeAtt: ratio(ryoe, ryoeCar) };
  };
  const effFor = (id) => {
    const a = grp.get(id) || G(id);
    const n = ngsFor(id, a);
    return { catchPct: ratio(a.rec, a.tgt - a.pi), yacRec: ratio(a.yac, a.rec), succPct: ratio(a.succ, a.succN), sep: n.sep, cushion: n.cushion, yacOE: n.yacOE };
  };
  // D191 opportunities for any man: his Usage row's figures (targets + carries, the Rushing page's count), or, with
  // no Usage row (no targets, no routes), his window carries from this page's rushing count (designed runs) with 0
  // targets over the same denominators (the club's designed runs + pass attempts in his games). Null when he has
  // neither.
  const usageById = new Map(win.rows.map((x) => [x.gsis, x]));
  const oppFor = (id) => {
    const u = usageById.get(id);
    if (u) return Object.fromEntries(OPP_KEYS.map((k) => [k, u[k]]));
    const a = grp.get(id);
    if (!a || !a.car) return Object.fromEntries(OPP_KEYS.map((k) => [k, null]));
    const den = [...a.games].reduce((s, gk) => s + (clubRuns.get(gk) || 0) + (clubAtt.get(gk) || 0), 0);
    const rtd = id === gsis ? my.rtd : null; // touchdowns are only kept for him (tdOpp is not in any pool)
    return { opp: a.car, oppG: ratio(a.car, a.games.size), oppShare: ratio(a.car, den), ydsOpp: ratio(a.ryds, a.car), epaOpp: ratio(a.repa, a.car), tdOpp: rtd === null ? null : ratio(rtd, a.car) };
  };
  const rushFor = (id) => {
    const a = grp.get(id);
    if (!a) return null;
    const runs = [...a.games].reduce((s, gk) => s + (clubRuns.get(gk) || 0), 0);
    return { car: a.car, ypc: ratio(a.ryds, a.car), epaCar: ratio(a.repa, a.repaN), succPct: ratio(a.rsucc, a.rsuccN),
      rushShare: ratio(a.car, runs), carG: ratio(a.car, a.games.size), ryoeAtt: ngsFor(id, a).ryoeAtt, ...oppFor(id) };
  };

  // His efficiency and the group's (per-player means over his position's reference pool).
  const qIds = [...grp.entries()].filter(([id, a]) => posOf(id) === pos && inPool(a.tgt, clubGOf(a))).map(([id]) => id);
  const effs = qIds.map(effFor);
  const mine = effFor(gsis);
  const eff = { epaTgt: row?.epaTgt ?? null, ...mine };
  const lgEff = { epaTgt: lg.overall.epaTgt };
  for (const k of ["catchPct", "yacRec", "succPct", "sep", "cushion", "yacOE"]) lgEff[k] = mean(effs.map((e) => e[k]));

  // Zones: his cells and the group's pooled cells, with each cell's share of all zoned targets.
  const myZoned = ZONE_KEYS.reduce((s, k) => s + myZone[k].n, 0);
  const zones = {};
  for (const k of ZONE_KEYS) {
    zones[k] = { ...cellRates(myZone[k]), share: ratio(myZone[k].n, myZoned), plays: myZone[k].plays.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0)),
      lg: { ...cellRates(lgZone[k]), share: ratio(lgZone[k].n, lgZoned) } };
  }

  // Weekly timeline: target share, air-yards share, snap share (from the whole-timeline row) with the opponent.
  // His club for a week comes from players.json teams[week]; a week with no entry there (he had no rows) falls
  // back to his nearest known week, so a week the club played still resolves its opponent instead of reading "bye".
  const weekNum = (key) => { const { season, week } = splitKey(key); return season * 100 + week; };
  const teamOf = (key) => {
    if (meta.teams?.[key]) return meta.teams[key];
    let best = null, bestDist = Infinity;
    for (const k of Object.keys(meta.teams || {})) {
      const d = Math.abs(weekNum(k) - weekNum(key));
      if (d < bestDist) { bestDist = d; best = k; }
    }
    return best ? meta.teams[best] : null;
  };
  const series = (frow?.series || full.weeks.map((key) => ({ key, v: null, ay: null, snap: null, tgt: 0 }))).map((s) => {
    const team = teamOf(s.key);
    const g = team ? oppOf.get(`${s.key}|${team}`) : null;
    const w = myWeek.get(s.key);
    const runs = g ? clubRuns.get(`${s.key}|${team}`) || 0 : 0;
    const played = s.v !== null || s.snap !== null || !!w;
    // His club had a game that week (g) but he has no rows in it: a DNP, not a bye.
    return { ...s, opp: g?.opp || null, home: g?.home ?? null, inWin: winKeys.has(s.key), dnp: !!g && !played,
      car: played ? w?.car || 0 : null, rushShare: played ? ratio(w?.car || 0, runs) : null,
      // D191 opportunities that week: the Usage row's targets + carries; with no Usage row, 0 targets + his carries.
      // (named oppN: a series entry's "opp" is the opponent).
      oppN: played ? s.oppN ?? (s.tgt || 0) + (w?.car || 0) : null };
  });

  // D191 opportunities for the tile row and the Opportunities strip's window total (oppFor above).
  const opps = oppFor(gsis);

  const result = {
    ...out, team: row?.team || frow?.team || lastTeam(meta), row, lg, cuts: ref.cuts, refText: ref.text, weeks: win.weeks, series, zones, zoned: myZoned,
    eff, lgEff, rush: null, routes: null, has2025Routes, opps,
  };

  if (RUSHER_POS.has(pos)) {
    const mineR = rushFor(gsis) || { car: 0, ypc: null, epaCar: null, succPct: null, rushShare: null, carG: null, ryoeAtt: null };
    // The rushing pool: 2+ carries per club game in the window (floor 5); league-wide = every tracked position.
    const allR = [...grp.entries()].filter(([, a]) => inPool(a.car, clubGOf(a))).map(([id]) => ({ pos: posOf(id), ...rushFor(id) }));
    const qR = allR.filter((x) => x.pos === pos);
    const lgR = {};
    for (const k of ["car", "ypc", "epaCar", "succPct", "rushShare", "carG", "ryoeAtt", "opp", "oppG", "oppShare", "ydsOpp", "epaOpp"]) lgR[k] = mean(qR.map((x) => x[k]));
    lgR.rz = null;
    result.rush = { ...mineR, yds: my.ryds, rz: my.rz, td: my.rtd, lg: lgR, n: qR.length, cuts: tierCuts(qR, allR, [...RUSH_TIER_KEYS, ...OPP_TIER_KEYS]), refText: referenceText(pos, qR.length, "carries") };
  }

  result.recut = recutLayers({ blocks, players, st, gsis, pos, row, uRef, ref, lgEff, eff });

  if (has2025Routes) {
    const list = [...myRoute.entries()].map(([route, c]) => ({ route, ...cellRates(c), lgShare: ratio(lgRoute.get(route)?.n || 0, lgRouted), lg: cellRates(lgRoute.get(route)) }));
    const tot = list.reduce((s, x) => s + x.n, 0);
    for (const x of list) x.share = ratio(x.n, tot);
    result.routes = list.sort((a, b) => b.n - a.n || a.route.localeCompare(b.route));
  }
  return result;
}

// ---- the re-cut's five layers (increment 3, PROJECT.md Part 4 A and B2) ------------------------------------
// Plain values for the headline, opportunity and variance layers, each beside its league figure; the passing and
// rushing blocks read the existing `row`, `eff` and `rush` plus `recut.rushRow`. A back (RB, FB) reads his Running
// backs table row (agg_rush.js) and its reference, so his headline, DK and opportunity tiles are the table's figures
// and colours (D191's rushing-pool rule, now for DK too); a WR or TE reads his Receivers (Usage) row and reference.
//   headline, back:     dkG, dk, scrimYds (rush yds + rec yds), totTd (rush td + rec td), ydsOpp, epaOpp
//   headline, receiver: dkG, dk, rec, yds, ydsG (yds / g), td, yprr, epaTgt
//   opportunity, back:  oppG, oppShare, car, rushShare, tgt, tgtShare, rzOpp, gl, snapPct, routePct
//   opportunity, rec.:  tgtG, tgtShare, tprr, ayShare, adot, wopr, rz, ez, routePct, snapPct
//   variance, back:     rzOppTdRate, in10TdRate, yds20Share, ybcCar, flRate, dkTdShare (league: rushReference pooled)
//   variance, receiver: tdTgt, rzTdRate, cpoeTgt, yacOE, dropPer100, flRate, dkTdShare (league: usageReference pooled;
//                       yacOE's league is the NGS mean the efficiency tiles already use)
// headlineLg and opportunityLg are plain means over his position's reference pool (the row keys' own references).
// `recut.cuts` (the name is RECUT_CUTS) is his position pool's tier cuts for both the headline and opportunity tiles:
// a back's are the Running backs table's (rushReference), a receiver's the Receivers table's (usageReference).
export const RECUT_CUTS = "cuts";
// `rushRow` is his Running backs row (any position, null with no carries: "Rushing block only when he has carries").
export const RB_HEADLINE_KEYS = ["dkG", "dk", "scrimYds", "totTd", "ydsOpp", "epaOpp"];
export const REC_HEADLINE_KEYS = ["dkG", "dk", "rec", "yds", "ydsG", "td", "yprr", "epaTgt"];
export const RB_OPP_KEYS = ["oppG", "oppShare", "car", "rushShare", "tgt", "tgtShare", "rzOpp", "gl", "snapPct", "routePct"];
export const REC_OPP_KEYS = ["tgtG", "tgtShare", "tprr", "ayShare", "adot", "wopr", "rz", "ez", "routePct", "snapPct"];
export const RB_VARIANCE_KEYS = ["rzOppTdRate", "in10TdRate", "yds20Share", "ybcCar", "flRate", "dkTdShare"];
export const REC_VARIANCE_KEYS = ["tdTgt", "rzTdRate", "cpoeTgt", "yacOE", "dropPer100", "flRate", "dkTdShare"];
const withDerived = (r, back) => (r ? (back
  ? { ...r, scrimYds: (r.yds ?? 0) + (r.recYds ?? 0), totTd: (r.td ?? 0) + (r.recTd ?? 0) }
  : { ...r, ydsG: ratio(r.yds, r.g) }) : null);
const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r?.[k] ?? null]));

function recutLayers({ blocks, players, st, gsis, pos, row, uRef, ref, lgEff, eff }) {
  const back = RUSHER_POS.has(pos);
  const rush = aggregateRush(blocks, players, st);
  const rRef = rushReference(rush.rows);
  const rr = rRef.at(pos);
  const rushRow = rush.rows.find((r) => r.gsis === gsis) || null;
  const f = fantasyByPlayer(blocks, players, st).get(gsis) || null;
  const fantasy = { parts: f?.parts ?? null, games: f?.games ?? [] };
  if (back) {
    // A back with no carries still has his Receivers row: its scrimmage figures stand in (rushYds, rushTd, yds, td).
    const src = withDerived(rushRow, true) || (row ? { ...row, scrimYds: (row.yds ?? 0) + (row.rushYds ?? 0), totTd: (row.td ?? 0) + (row.rushTd ?? 0) } : null);
    const q = rRef.pool.filter((r) => r.pos === pos).map((r) => withDerived(r, true));
    return {
      kind: "back", rushRow, fantasy: { ...fantasy, ...pick(src, ["dk", "dkG", "dkTdShare"]) },
      headline: pick(src, RB_HEADLINE_KEYS), headlineLg: Object.fromEntries(RB_HEADLINE_KEYS.map((k) => [k, meanOf(q, k)])),
      opportunity: pick(rushRow || row, RB_OPP_KEYS), opportunityLg: pick(rr.lg, RB_OPP_KEYS), cuts: rr.cuts, opportunityRefText: rr.text,
      variance: pick(rushRow, RB_VARIANCE_KEYS), varianceLg: pick(rr.pooled, RB_VARIANCE_KEYS),
      rushRef: { lg: rr.lg, cuts: rr.cuts, n: rr.n, text: rr.text, pooled: rr.pooled },
    };
  }
  const src = withDerived(row, false);
  const q = uRef.pool.filter((r) => r.pos === pos).map((r) => withDerived(r, false));
  return {
    kind: "receiver", rushRow, fantasy: { ...fantasy, ...pick(src, ["dk", "dkG", "dkTdShare"]) },
    headline: pick(src, REC_HEADLINE_KEYS), headlineLg: Object.fromEntries(REC_HEADLINE_KEYS.map((k) => [k, meanOf(q, k)])),
    opportunity: pick(row, REC_OPP_KEYS), opportunityLg: Object.fromEntries(REC_OPP_KEYS.map((k) => [k, meanOf(q, k)])), cuts: ref.cuts, opportunityRefText: ref.text,
    variance: { ...pick(row, REC_VARIANCE_KEYS), yacOE: eff?.yacOE ?? null }, varianceLg: { ...pick(ref.pooled, REC_VARIANCE_KEYS), yacOE: lgEff?.yacOE ?? null },
    rushRef: rushRow ? { lg: rr.lg, cuts: rr.cuts, n: rr.n, text: rr.text, pooled: rr.pooled } : null,
  };
}
const meanOf = (rows, k) => mean(rows.map((r) => (r[k] === null || r[k] === undefined ? null : +r[k])));

function lastTeam(meta) {
  const ks = Object.keys(meta?.teams || {}).sort();
  return ks.length ? meta.teams[ks[ks.length - 1]] : "";
}

// ---- Madden blocking (D182) ------------------------------------------------------------------------------
export const BLOCK_ATTRS = [["runBlock", "Run Block"], ["passBlock", "Pass Block"], ["impactBlocking", "Impact Blocking"], ["leadBlock", "Lead Block"]];
const normPos = (p) => { const x = String(p || "").toUpperCase(); return x === "HB" ? "RB" : x; };
// The depth charts' rating tiers (public/js/cards.js ratingTier): 90 elite, 80 strong, 70 avg, 60 weak, else flat.
export function ratingTier(v) {
  if (v === null || v === undefined || !Number.isFinite(+v)) return "flat";
  return v >= 90 ? "elite" : v >= 80 ? "strong" : v >= 70 ? "avg" : v >= 60 ? "weak" : "flat";
}
// "1-base" -> "Launch ratings"; "week-3" / 3 -> "Week 3 ratings".
export function iterationLabel(it) {
  const s = String(it?.label ?? it?.id ?? it ?? "").trim();
  if (!s) return "ratings";
  if (/base|launch/i.test(s)) return "Launch ratings";
  const m = s.match(/(\d+)/);
  return m ? `Week ${+m[1]} ratings` : `${s} ratings`;
}
export const maddenEdition = (season) => `Madden NFL ${String(+season + 1).slice(-2)}`;

// { status: "absent" (no file) | "unrated" (no entry for him) | "ok", title, ovr, bars: [{ k, label, v, median, tier }] }
export function maddenBlocking(madden, gsis, pos, season) {
  if (!madden || !madden.players) return { status: "absent", title: null, ovr: null, bars: [] };
  const title = `${maddenEdition(madden.season ?? season)} · ${iterationLabel(madden.iteration)}`;
  const me = madden.players[gsis];
  if (!me) return { status: "unrated", title, ovr: null, bars: [] };
  const myPos = normPos(me.pos || pos);
  const peers = Object.values(madden.players).filter((p) => normPos(p.pos) === myPos);
  const bars = BLOCK_ATTRS.map(([k, label]) => {
    const v = num(me.attrs?.[k]);
    return { k, label, v, median: median(peers.map((p) => p.attrs?.[k])), tier: ratingTier(v) };
  });
  return { status: "ok", title, ovr: num(me.ovr), pos: myPos, peers: peers.length, bars };
}
