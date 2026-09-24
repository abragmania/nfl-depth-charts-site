// PURE (no DOM, no fetch): the quarterback figures for the Quarterbacks leaderboard (#/qb) and the QB player page
// (D182: QBs are their own thing, no blocking). NO QBR anywhere (D177). Every figure has one source (D178):
//   play-by-play (nflverse): dropbacks, attempts, completions, yards, TD, INT, air yards (aDOT), EPA, success,
//     CPOE, sacks, scrambles and designed runs, zones (D179 lines);
//   FTN charting (on the play rows): play action, screens, blitz % (1+ blitzers) and the blitz split;
//   PFR advanced stats (pfr.pass, per QB per week, about a week behind the games): pressure % only (its job:
//     pressures, hurries, hits, sacks; blitz belongs to FTN, the lead's ruling of 2026-09-24 under D178);
//   Next Gen Stats (ngs.passing, tracking only): time to throw, expected completion %.
//
// Definitions:
//   dropback     = a pass attempt, a sack or a scramble. Scrambles are dropbacks AND rushes. A defensive-pass-
//                  interference no-play the ledger kept (pi=1) is a receiver's target only: it is in no QB figure
//                  (not an attempt, not a dropback, not in EPA/db or Success %; the lead, 2026-09-24).
//   attempt      = a pass row that is not pi=1. Cmp % = completions / attempts; Y/A = passing yards / attempts.
//   Blitz %      = FTN: dropbacks with 1+ blitzers / dropbacks FTN charted.
//   aDOT         = air yards / attempts with air yards (intended air yards, completions and incompletions alike).
//   EPA/db       = EPA summed over dropbacks / dropbacks with an EPA; Success % likewise.
//   CPOE         = the mean of the play-by-play cpoe over attempts that carry one.
//   Sack %       = sacks / dropbacks. PA % = play-action dropbacks / dropbacks FTN charted (pa not null).
//   Pressure %   = PFR pressures / PFR dropbacks over the weeks PFR lists him (weighted, never a mean of weekly %).
//   TTT, xComp % = NGS weekly figures weighted by his dropbacks (TTT) or attempts (xComp) that week.
//   Rushing      = designed runs (type run, he is the rusher) + scrambles: carries, yards, TD, EPA; per game over
//                  his games; scramble rate = scrambles / dropbacks.
// REFERENCE POOL (Adam, 2026-09-24): QBs averaging 10+ dropbacks per game of his club's games in the window, with a
// floor of 20; the league line on every tile and chart is the plain mean over that pool, and the colour tiers are
// that pool's 90/70/40/15th percentiles (agg.js tierCuts; under 8 men, uncoloured). Sack % and Pressure % are cut
// on the negated value (lower is better). Zone references are POOLED over every QB attempt in the window.
import { colIndex, clubGames, percentileCuts, tierFromCuts, MIN_POOL } from "./agg.js";
import { gamesInWindow, playPredicate } from "./filters.js";

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
const ratio = (a, b) => (b > 0 ? a / b : null);
const finite = (x) => x !== null && x !== undefined && Number.isFinite(+x);
const mean = (vals) => { const v = vals.filter(finite).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export const QB_POOL_PER_GAME = 10, QB_POOL_FLOOR = 20, QB_MIN_DB = 20;
export const qbPoolMin = (clubG) => Math.max(QB_POOL_FLOOR, QB_POOL_PER_GAME * (clubG || 0));
export const inQbPool = (db, clubG) => (db || 0) >= qbPoolMin(clubG);
export const qbReferenceText = (n) => `QBs with ${QB_POOL_PER_GAME}+ dropbacks/game (min ${QB_POOL_FLOOR}) in the window (${n})`;

// Colour tiers among QBs. Rushing keys light up only for the runners: weak and low read as uncoloured (grey), so a
// pocket passer's rushing block sits quiet rather than red (Adam, 2026-09-24).
export const QB_TIER_KEYS = ["cmpPct", "epaDb", "succPct", "cpoe", "sackPct", "pressPct", "ypa", "rushAttG", "rushYdsG", "scrPct", "rushEpaG", "rushEpa"];
export const QB_LOWER_BETTER = new Set(["sackPct", "pressPct"]);
export const QB_RUSH_KEYS = new Set(["rushAttG", "rushYdsG", "scrPct", "rushEpaG", "rushEpa"]);
export function qbTierCuts(pool) {
  const out = {};
  for (const k of QB_TIER_KEYS) {
    const v = pool.map((r) => r[k]).filter(finite).map((x) => (QB_LOWER_BETTER.has(k) ? -x : +x));
    out[k] = v.length >= MIN_POOL ? { cuts: percentileCuts(v), n: v.length, posN: v.length, src: "pos" } : { cuts: null, n: v.length, posN: v.length, src: null };
  }
  return out;
}
export function qbTier(k, v, cuts) {
  if (!finite(v)) return "";
  const t = tierFromCuts(QB_LOWER_BETTER.has(k) ? -v : +v, cuts?.[k]?.cuts);
  return QB_RUSH_KEYS.has(k) && (t === "weak" || t === "flat") ? "" : t;
}

// ---- dropbacks and rushes -----------------------------------------------------------------------------
// One play row as a QB event, or null when it is not one: { kind: "att" | "sack" | "scramble" | "run", id, ... }.
// A pass-interference row (pi=1) is never one, whatever the receivers' PI switch says.
export function qbEvent(r, C) {
  const type = r[C.type];
  const pi = truthy(r[C.pi]);
  let kind = null, id = null;
  if (type === "pass") { if (pi) return null; kind = "att"; id = r[C.passer]; }
  else if (type === "sack") { kind = "sack"; id = r[C.passer]; }
  else if (type === "scramble") { kind = "scramble"; id = r[C.passer] || r[C.rusher]; }
  else if (type === "run") { kind = "run"; id = r[C.rusher]; }
  if (!id || !kind) return null;
  const complete = kind === "att" && truthy(r[C.complete]);
  const bl = num(r[C.blitzers]);
  return {
    kind, id, db: kind !== "run", att: kind === "att", complete,
    yards: num(r[C.yards]) ?? 0, air: kind === "att" ? num(r[C.air]) : null,
    td: truthy(r[C.td]) && !truthy(r[C.int]), int: kind === "att" && truthy(r[C.int]),
    epa: num(r[C.epa]), succ: num(r[C.success]), cpoe: kind === "att" ? num(r[C.cpoe]) : null,
    pa: r[C.pa] === null || r[C.pa] === undefined ? null : truthy(r[C.pa]), screen: truthy(r[C.screen]),
    blitz: bl === null ? null : bl >= 1, pressure: C.pressure === undefined || r[C.pressure] === null || r[C.pressure] === undefined ? null : truthy(r[C.pressure]),
    band: r[C.band], dir: r[C.dir], target: r[C.target] || null,
  };
}

export const ZONE_KEYS = ["D", "I", "S", "B"].flatMap((b) => ["L", "M", "R"].map((d) => b + d));
const emptyCell = () => ({ n: 0, cmp: 0, yds: 0, td: 0, int: 0, epa: 0, epaN: 0 });
function addCell(c, e) { c.n++; if (e.complete) { c.cmp++; c.yds += e.yards; } if (e.td) c.td++; if (e.int) c.int++; if (e.epa !== null) { c.epa += e.epa; c.epaN++; } }
// A zone cell's measures: attempts, comp %, yards per attempt, TD and INT (and (TD − INT) per attempt), EPA/att.
export function cellRates(c) {
  if (!c || !c.n) return { n: 0, cmp: 0, td: 0, int: 0, cmpPct: null, ydsAtt: null, tdint: null, epaAtt: null };
  return { n: c.n, cmp: c.cmp, td: c.td, int: c.int, cmpPct: c.cmp / c.n, ydsAtt: c.yds / c.n, tdint: (c.td - c.int) / c.n, epaAtt: c.epaN ? c.epa / c.epaN : null };
}
// His cells with the league's pooled cells and each cell's share of the zoned attempts, for the zone field.
export function qbZones(mine, lg) {
  const tot = (z) => ZONE_KEYS.reduce((s, k) => s + (z?.[k]?.n || 0), 0);
  const mt = tot(mine), lt = tot(lg);
  const out = {};
  for (const k of ZONE_KEYS) out[k] = { ...cellRates(mine?.[k]), share: ratio(mine?.[k]?.n || 0, mt), plays: mine?.[k]?.plays || [], lg: { ...cellRates(lg?.[k]), share: ratio(lg?.[k]?.n || 0, lt) } };
  return out;
}

function newAcc() {
  return { games: new Set(), keyGk: new Map(), db: 0, dbEpa: 0, dbEpaN: 0, dbSucc: 0, dbSuccN: 0, att: 0, cmp: 0, yds: 0, td: 0, int: 0,
    air: 0, airN: 0, cpoe: 0, cpoeN: 0, sacks: 0, pa: 0, paN: 0, bl: 0, blN: 0, scr: 0, scrYds: 0, des: 0, desYds: 0, rushTd: 0,
    rushEpa: 0, rushEpaN: 0, wk: new Map(), zones: Object.fromEntries(ZONE_KEYS.map((k) => [k, emptyCell()])),
    pfrPress: 0, pfrDb: 0, pfrKeys: new Set(), tttW: 0, ttt: 0, xcW: 0, xc: 0 };
}
const wkAcc = () => ({ db: 0, att: 0, cmp: 0, epa: 0, epaN: 0, cpoe: 0, cpoeN: 0, air: 0, airN: 0, car: 0, ryds: 0 });

function gamePasses(st, g) {
  if (!g) return false;
  if (st.team && g.team !== st.team) return false;
  if (st.opp && g.opp !== st.opp) return false;
  return true;
}

// Rows for every quarterback (players file pos QB) with a dropback or a carry in the window after the team and
// opponent filters. Returns { rows, weeks (window week keys, sorted), lgZones (pooled over every QB attempt),
// pfrThrough (the latest window week with any PFR passing row, or null), latestKey }. `opts.playsFor`: a gsis
// whose zone cells also keep the play list.
export function aggregateQb(blocks, players, st, opts = {}) {
  const games = clubGames(blocks);
  const inWin = gamesInWindow(games, st);
  const info = new Map(games.map((g) => [`${g.key}|${g.team}`, g]));
  const gameOk = (gk) => inWin.has(gk) && gamePasses(st, info.get(gk));
  const isQb = (id) => String(players?.[id]?.pos || "").toUpperCase() === "QB";
  const acc = new Map();
  const A = (id) => { if (!acc.has(id)) acc.set(id, newAcc()); return acc.get(id); };
  const lgZones = Object.fromEntries(ZONE_KEYS.map((k) => [k, emptyCell()]));
  let pfrThrough = null;

  for (const b of blocks) {
    const C = colIndex(b.cols);
    const pred = playPredicate(st, C);
    for (const r of b.plays || []) {
      const gk = `${b.key}|${r[C.posteam]}`;
      if (!gameOk(gk) || !pred(r)) continue;
      const e = qbEvent(r, C);
      if (!e || !isQb(e.id)) continue;
      const a = A(e.id);
      a.games.add(gk); a.keyGk.set(b.key, gk);
      if (!a.wk.has(b.key)) a.wk.set(b.key, wkAcc());
      const w = a.wk.get(b.key);
      if (e.db) {
        a.db++; w.db++;
        if (e.epa !== null) { a.dbEpa += e.epa; a.dbEpaN++; w.epa += e.epa; w.epaN++; }
        if (e.succ !== null) { a.dbSucc += e.succ; a.dbSuccN++; }
        if (e.pa !== null) { a.paN++; if (e.pa) a.pa++; }
        if (e.blitz !== null) { a.blN++; if (e.blitz) a.bl++; }
      }
      if (e.kind === "att") {
        a.att++; w.att++;
        if (e.complete) { a.cmp++; w.cmp++; a.yds += e.yards; }
        if (e.td) a.td++;
        if (e.int) a.int++;
        if (e.air !== null) { a.air += e.air; a.airN++; w.air += e.air; w.airN++; }
        if (e.cpoe !== null) { a.cpoe += e.cpoe; a.cpoeN++; w.cpoe += e.cpoe; w.cpoeN++; }
        const zk = e.band && e.dir ? e.band + e.dir : null;
        if (zk && a.zones[zk]) {
          addCell(a.zones[zk], e); addCell(lgZones[zk], e);
          if (opts.playsFor === e.id) {
            (a.zones[zk].plays ||= []).push({ key: b.key, opp: r[C.defteam], down: num(r[C.down]), togo: num(r[C.ydstogo]), yl: num(r[C.yardline_100]),
              target: e.target, result: e.int ? "INT" : e.complete ? (e.td ? "TD" : "Comp") : "Inc", air: e.air, yards: e.complete ? e.yards : 0, epa: e.epa });
          }
        }
      } else if (e.kind === "sack") a.sacks++;
      if (e.kind === "scramble" || e.kind === "run") {
        if (e.kind === "scramble") { a.scr++; a.scrYds += e.yards; } else { a.des++; a.desYds += e.yards; }
        w.car++; w.ryds += e.yards;
        if (e.td) a.rushTd++;
        if (e.epa !== null) { a.rushEpa += e.epa; a.rushEpaN++; }
      }
    }
  }
  // PFR and NGS: weekly tables, joined to the week and club game he played in the window. pfrThrough is the latest
  // window week whose file carries any PFR passing row (PFR runs about a week behind the games).
  const winKeys = new Set([...inWin].filter(gameOk).map((gk) => gk.split("|")[0]));
  for (const b of blocks) {
    if (winKeys.has(b.key) && Object.keys(b.pfr?.pass || {}).length && (!pfrThrough || b.key > pfrThrough)) pfrThrough = b.key;
    for (const [id, p] of Object.entries(b.pfr?.pass || {})) {
      const gk = acc.get(id)?.keyGk.get(b.key);
      if (!gk) continue;
      const a = acc.get(id), db = num(p.dropbacks);
      if (db === null || db <= 0) continue;
      a.pfrDb += db; a.pfrPress += num(p.pressures) ?? 0; a.pfrKeys.add(b.key);
    }
    for (const [id, n] of Object.entries(b.ngs?.passing || {})) {
      const a = acc.get(id); const w = a?.wk.get(b.key);
      if (!w) continue;
      if (num(n.ttt) !== null && w.db > 0) { a.ttt += n.ttt * w.db; a.tttW += w.db; }
      if (num(n.xcomp) !== null && w.att > 0) { a.xc += (n.xcomp / 100) * w.att; a.xcW += w.att; }
    }
  }

  const clubWin = new Map();
  for (const gk of inWin) if (gameOk(gk)) { const t = gk.split("|")[1]; clubWin.set(t, (clubWin.get(t) || 0) + 1); }
  const weeks = [...winKeys].sort();
  const rows = [];
  for (const [id, a] of acc) {
    const meta = players?.[id] || {};
    const g = [...a.games].sort();
    const lastGk = g[g.length - 1];
    const team = lastGk ? lastGk.split("|")[1] : "";
    const car = a.scr + a.des, gp = g.length;
    const usePfr = a.pfrDb > 0;
    rows.push({
      gsis: id, name: meta.name || id, pos: "QB", espnId: meta.espnId ?? null, team, g: gp, clubG: clubWin.get(team) || 0,
      db: a.db, att: a.att, cmp: a.cmp, cmpPct: ratio(a.cmp, a.att), yds: a.yds, ypa: ratio(a.yds, a.att), td: a.td, int: a.int,
      adot: ratio(a.air, a.airN), epaDb: ratio(a.dbEpa, a.dbEpaN), succPct: ratio(a.dbSucc, a.dbSuccN), cpoe: ratio(a.cpoe, a.cpoeN),
      sacks: a.sacks, sackPct: ratio(a.sacks, a.db), paPct: ratio(a.pa, a.paN),
      pressPct: usePfr ? a.pfrPress / a.pfrDb : null, pfrDb: a.pfrDb, pfrWeeks: a.pfrKeys.size,
      blitzPct: ratio(a.bl, a.blN),
      ttt: ratio(a.ttt, a.tttW), xcomp: ratio(a.xc, a.xcW),
      rushAtt: car, rushYds: a.scrYds + a.desYds, rushTd: a.rushTd, rushEpa: ratio(a.rushEpa, a.rushEpaN), rushEpaSum: a.rushEpa,
      scr: a.scr, scrYds: a.scrYds, des: a.des, desYds: a.desYds, scrPct: ratio(a.scr, a.db),
      rushAttG: ratio(car, gp), rushYdsG: ratio(a.scrYds + a.desYds, gp), rushEpaG: ratio(a.rushEpa, gp),
      series: weeks.map((key) => {
        const w = a.wk.get(key);
        if (!w || (w.db === 0 && w.car === 0)) return { key, db: 0, att: 0, epaDb: null, cpoe: null, adot: null, cmpPct: null, car: w ? 0 : null, ryds: null };
        return { key, db: w.db, att: w.att, epaDb: ratio(w.epa, w.epaN), cpoe: ratio(w.cpoe, w.cpoeN), adot: ratio(w.air, w.airN), cmpPct: ratio(w.cmp, w.att), car: w.car, ryds: w.ryds };
      }),
      zones: a.zones,
    });
  }
  return { rows, weeks, lgZones, pfrThrough, latestKey: weeks[weeks.length - 1] || null };
}

// The league reference from rows aggregated with no team or opponent filter: the pool, the plain means over it
// for every key a tile or chart compares, and the tier cuts.
export const QB_LG_KEYS = ["db", "att", "cmpPct", "yds", "ypa", "td", "int", "adot", "epaDb", "succPct", "cpoe", "sackPct", "pressPct", "paPct",
  "blitzPct", "ttt", "xcomp", "rushAtt", "rushYds", "rushTd", "rushEpa", "rushAttG", "rushYdsG", "rushEpaG", "scrPct", "scr", "des"];
export function qbReference(rows) {
  const pool = rows.filter((r) => inQbPool(r.db, r.clubG));
  const lg = Object.fromEntries(QB_LG_KEYS.map((k) => [k, mean(pool.map((r) => r[k]))]));
  return { pool, n: pool.length, lg, cuts: qbTierCuts(pool), text: qbReferenceText(pool.length) };
}

// Sort, nulls always last whichever direction; ties by dropbacks.
export function sortQbRows(rows, key, dir = "desc") {
  const s = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (!finite(x) && typeof x !== "string") return !finite(y) && typeof y !== "string" ? b.db - a.db : 1;
    if (!finite(y) && typeof y !== "string") return -1;
    if (typeof x === "string") return s * x.localeCompare(y);
    return s * (x - y) || b.db - a.db;
  });
}

// ---- splits (the player page) -----------------------------------------------------------------------------
// His dropbacks split three ways, each side against every QB's dropbacks pooled in the same window:
//   play action vs not (FTN pa), blitzed vs not (FTN: 1+ blitzers), pressured vs clean (2025 only: the participation
//   file's per-play pressure column; PFR gives weekly totals only, so no per-play pressure exists for 2026).
// `noScreens` leaves screen passes (FTN) out of every split. A side: { db, att, cmpPct, ypa, epaDb, succPct, sackPct }.
const sideAcc = () => ({ db: 0, att: 0, cmp: 0, yds: 0, epa: 0, epaN: 0, succ: 0, succN: 0, sacks: 0 });
function addSide(s, e) {
  s.db++;
  if (e.att) { s.att++; if (e.complete) { s.cmp++; s.yds += e.yards; } }
  if (e.kind === "sack") s.sacks++;
  if (e.epa !== null) { s.epa += e.epa; s.epaN++; }
  if (e.succ !== null) { s.succ += e.succ; s.succN++; }
}
const sideRates = (s) => ({ db: s.db, att: s.att, cmpPct: ratio(s.cmp, s.att), ypa: ratio(s.yds, s.att), epaDb: ratio(s.epa, s.epaN), succPct: ratio(s.succ, s.succN), sackPct: ratio(s.sacks, s.db) });
export const SPLITS = [["pa", "Play action", "No play action"], ["blitz", "Blitzed", "Not blitzed"], ["pressure", "Pressured", "Clean"]];
export function qbSplits(blocks, players, st, gsis, { noScreens = false } = {}) {
  const games = clubGames(blocks);
  const inWin = gamesInWindow(games, st);
  const isQb = (id) => String(players?.[id]?.pos || "").toUpperCase() === "QB";
  const mk = () => ({ yes: sideAcc(), no: sideAcc() });
  const me = Object.fromEntries(SPLITS.map(([k]) => [k, mk()])), lg = Object.fromEntries(SPLITS.map(([k]) => [k, mk()]));
  let pressureKnown = 0;
  for (const b of blocks) {
    const C = colIndex(b.cols);
    for (const r of b.plays || []) {
      const gk = `${b.key}|${r[C.posteam]}`;
      if (!inWin.has(gk)) continue;
      const e = qbEvent(r, C);
      if (!e || !e.db || !isQb(e.id)) continue;
      if (noScreens && e.screen) continue;
      for (const [k] of SPLITS) {
        const v = e[k];
        if (v === null || v === undefined) continue;
        addSide(lg[k][v ? "yes" : "no"], e);
        if (e.id === gsis) { addSide(me[k][v ? "yes" : "no"], e); if (k === "pressure") pressureKnown++; }
      }
    }
  }
  const out = {};
  for (const [k, yes, no] of SPLITS) out[k] = { yesLabel: yes, noLabel: no, yes: sideRates(me[k].yes), no: sideRates(me[k].no), lgYes: sideRates(lg[k].yes), lgNo: sideRates(lg[k].no) };
  out.pressure.available = pressureKnown > 0;
  return out;
}

// ---- Madden (QB passing attributes vs the QB median) ------------------------------------------------------
export const QB_MADDEN_ATTRS = [["throwPower", "Throw Power"], ["throwAccuracyShort", "Short Accuracy"], ["throwAccuracyMid", "Mid Accuracy"],
  ["throwAccuracyDeep", "Deep Accuracy"], ["throwOnTheRun", "On the Run"], ["throwUnderPressure", "Under Pressure"], ["playAction", "Play Action"], ["awareness", "Awareness"]];
