// PURE (no DOM, no fetch): team figures for the team page (#/team/:abbr, the offence) and the defence leaderboard
// (#/defense; D179: defence is team-only in v1). One pass over the play rows builds every club's OFFENCE (its own
// plays, keyed by posteam) and DEFENCE (the plays it faced, keyed by defteam), so a defence's "allowed" figure is
// exactly its opponents' offensive figure on those plays. Every figure has one source (D178):
//   play-by-play (nflverse): plays, dropbacks, pass rate, EPA, success, aDOT, completions, sacks, explosive plays, zones;
//   FTN charting (on the play rows): play action (offence), blitz (defence: 1+ blitzers);
//   PFR advanced stats (about a week behind the games): pressure %.
//
// Definitions (a club's "games" are its club-games in the window; the week window is judged per club, so "last 3"
// is each club's own last three games, on offence and on defence):
//   play         = a pass attempt, a sack, a scramble or a designed run. A defensive-pass-interference no-play the
//                  ledger kept (pi=1) is a receiver's target only and is in no team figure (as on the QB views).
//   dropback     = a pass attempt, a sack or a scramble. Pass rate = dropbacks / plays (plain: the ledger carries no
//                  score, so no neutral-situation rate).
//   EPA/play, Success %  = over plays carrying the figure; EPA/dropback over dropbacks; EPA/carry over designed runs.
//   aDOT         = air yards / attempts with air yards. Comp % = completions / attempts. Sack % = sacks / dropbacks.
//   Explosive %  = plays gaining 10+ yards on the ground (designed runs and scrambles) or 20+ on a completed pass,
//                  over plays.
//   PA %         = FTN: play-action dropbacks / dropbacks FTN charted. Blitz % = FTN: dropbacks faced with 1+
//                  blitzers / dropbacks faced FTN charted.
//   Pressure % (offence, allowed) = the club's QBs' PFR pressures / their PFR dropbacks, over the weeks PFR lists them
//                  (pfr.pass is keyed by QB; his club that week comes from the players file).
//   Pressure % (defence) = the QB SIDE (the lead, 2026-09-24, flagged to Adam under D178): the opposing QBs' PFR
//                  pressures / their PFR dropbacks against this defence, one pressure per dropback at most, so it
//                  cannot double count. Kept beside it for the tooltip as `pressPctDef`: the club's defenders' PFR
//                  pressures summed (pfr.def is keyed by defender gsis; his club that week comes from players.json
//                  teams[week]) / the dropbacks the defence faced in the weeks PFR lists any of its defenders; this
//                  double counts a throw two men pressured. A defender the players file cannot place is in `unmapped`.
// LEAGUE REFERENCE (Adam's perspective rule, D177): the plain mean over the clubs in the window (32 in a full week;
// fewer on a week with byes), and colour tiers at the clubs' 90/70/40/15th percentiles (agg.js; under 8 clubs,
// uncoloured). Lower-is-better keys are cut on the negated value; neutral keys (pass rate, aDOT, blitz %) are not
// coloured. Zone references are POOLED over every attempt in the window.
import { colIndex, clubGames, percentileCuts, tierFromCuts, MIN_POOL, aggregateUsage, usageReference } from "./agg.js";
import { gamesInWindow } from "./filters.js";
import { ZONE_KEYS, qbZones } from "./agg_qb.js";
import { aggregateRush, rushReference, rushTier } from "./agg_rush.js";

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
const ratio = (a, b) => (b > 0 ? a / b : null);
const finite = (x) => x !== null && x !== undefined && Number.isFinite(+x);
const mean = (vals) => { const v = vals.filter(finite).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export const EXPL_RUN = 10, EXPL_PASS = 20;

// One play row as a team play, or null (a pi row, or a type the ledger uses for nothing else).
export function teamPlay(r, C) {
  const type = r[C.type];
  if (truthy(r[C.pi]) || !["pass", "sack", "scramble", "run"].includes(type)) return null;
  const yards = num(r[C.yards]) ?? 0, att = type === "pass", complete = att && truthy(r[C.complete]);
  const db = type !== "run", bl = num(r[C.blitzers]);
  return {
    type, db, att, complete, yards, air: att ? num(r[C.air]) : null, epa: num(r[C.epa]), succ: num(r[C.success]),
    td: truthy(r[C.td]) && !truthy(r[C.int]), int: att && truthy(r[C.int]),
    pa: db && r[C.pa] !== null && r[C.pa] !== undefined ? truthy(r[C.pa]) : null,
    blitz: db && bl !== null ? bl >= 1 : null,
    expl: type === "run" || type === "scramble" ? yards >= EXPL_RUN : complete && yards >= EXPL_PASS,
    band: r[C.band], dir: r[C.dir],
  };
}

const emptyCell = () => ({ n: 0, cmp: 0, yds: 0, td: 0, int: 0, epa: 0, epaN: 0 });
function addCell(c, e) { c.n++; if (e.complete) { c.cmp++; c.yds += e.yards; } if (e.td) c.td++; if (e.int) c.int++; if (e.epa !== null) { c.epa += e.epa; c.epaN++; } }
const newSide = () => ({ games: new Set(), plays: 0, epa: 0, epaN: 0, succ: 0, succN: 0, db: 0, dbEpa: 0, dbEpaN: 0, runs: 0, runEpa: 0, runEpaN: 0,
  att: 0, cmp: 0, yds: 0, air: 0, airN: 0, sacks: 0, pa: 0, paN: 0, bl: 0, blN: 0, expl: 0,
  zones: Object.fromEntries(ZONE_KEYS.map((k) => [k, emptyCell()])), wk: new Map(),
  pfrPress: 0, pfrDb: 0, pfrWeeks: new Set(), qbPress: 0, qbDb: 0, qbWeeks: new Set() });

function addPlay(a, key, e, playRec) {
  a.plays++;
  const w = a.wk.get(key) || { plays: 0, db: 0, epa: 0, epaN: 0 };
  w.plays++; if (e.db) w.db++;
  if (e.epa !== null) { a.epa += e.epa; a.epaN++; w.epa += e.epa; w.epaN++; }
  a.wk.set(key, w);
  if (e.succ !== null) { a.succ += e.succ; a.succN++; }
  if (e.db) {
    a.db++;
    if (e.epa !== null) { a.dbEpa += e.epa; a.dbEpaN++; }
    if (e.pa !== null) { a.paN++; if (e.pa) a.pa++; }
    if (e.blitz !== null) { a.blN++; if (e.blitz) a.bl++; }
  } else { a.runs++; if (e.epa !== null) { a.runEpa += e.epa; a.runEpaN++; } }
  if (e.type === "sack") a.sacks++;
  if (e.expl) a.expl++;
  if (e.att) {
    a.att++;
    if (e.complete) { a.cmp++; a.yds += e.yards; }
    if (e.air !== null) { a.air += e.air; a.airN++; }
    const zk = e.band && e.dir ? e.band + e.dir : null;
    if (zk && a.zones[zk]) { addCell(a.zones[zk], e); if (playRec) (a.zones[zk].plays ||= []).push(playRec); }
  }
}

// { plays, playsG, passRate, epaPlay, ... } for one side of one club.
function sideRates(a, g) {
  return {
    g, plays: a.plays, playsG: ratio(a.plays, g), db: a.db, runs: a.runs, att: a.att, cmp: a.cmp, sacks: a.sacks,
    passRate: ratio(a.db, a.plays), epaPlay: ratio(a.epa, a.epaN), epaDb: ratio(a.dbEpa, a.dbEpaN), epaCar: ratio(a.runEpa, a.runEpaN),
    succPct: ratio(a.succ, a.succN), adot: ratio(a.air, a.airN), cmpPct: ratio(a.cmp, a.att), sackPct: ratio(a.sacks, a.db),
    paPct: ratio(a.pa, a.paN), blitzPct: ratio(a.bl, a.blN), explPct: ratio(a.expl, a.plays), expl: a.expl,
    pressPct: ratio(a.pfrPress, a.pfrDb), pfrPress: a.pfrPress, pfrDb: a.pfrDb, pfrWeeks: a.pfrWeeks.size,
    zones: a.zones,
  };
}

// Every club's offence and defence in the window. Returns { rows: [{ team, g, off, def, series: { off, def } }],
// weeks (window week keys, sorted), lgZones (pooled over every attempt), pfrThrough (latest window week with any PFR
// row), latestKey, unmapped ([{ key, gsis }] PFR defender rows the players file cannot place) }.
// `opts.playsFor`: a club whose zone cells (both sides) also keep the play list.
export function aggregateTeams(blocks, players, st, opts = {}) {
  const games = clubGames(blocks);
  const inWin = gamesInWindow(games, st);
  const info = new Map(games.map((g) => [`${g.key}|${g.team}`, g]));
  const off = new Map(), def = new Map();
  const S = (m, t) => { if (!m.has(t)) m.set(t, newSide()); return m.get(t); };
  const lgZones = Object.fromEntries(ZONE_KEYS.map((k) => [k, emptyCell()]));
  const unmapped = [];
  let pfrThrough = null;

  for (const b of blocks) {
    const C = colIndex(b.cols);
    for (const r of b.plays || []) {
      const pt = r[C.posteam], dt = r[C.defteam];
      if (!pt || !dt) continue;
      const e = teamPlay(r, C);
      if (!e) continue;
      const okOff = inWin.has(`${b.key}|${pt}`), okDef = inWin.has(`${b.key}|${dt}`);
      if (!okOff && !okDef) continue;
      const rec = opts.playsFor && (opts.playsFor === pt || opts.playsFor === dt) && e.att
        ? { key: b.key, off: pt, def: dt, down: num(r[C.down]), togo: num(r[C.ydstogo]), yl: num(r[C.yardline_100]), passer: r[C.passer] || null,
          target: r[C.target] || null, result: e.int ? "INT" : e.complete ? (e.td ? "TD" : "Comp") : "Inc", air: e.air, yards: e.complete ? e.yards : 0, epa: e.epa }
        : null;
      if (okOff) { const a = S(off, pt); a.games.add(b.key); addPlay(a, b.key, e, opts.playsFor === pt ? rec : null); }
      if (okDef) { const a = S(def, dt); a.games.add(b.key); addPlay(a, b.key, e, opts.playsFor === dt ? rec : null); }
      if (okOff && e.att && e.band && e.dir && lgZones[e.band + e.dir]) addCell(lgZones[e.band + e.dir], e);
    }
  }
  // PFR: the offence's QB rows, and the defence's defender rows (plus the QB-side check for the defence).
  for (const b of blocks) {
    let any = false;
    for (const [id, p] of Object.entries(b.pfr?.pass || {})) {
      const team = players?.[id]?.teams?.[b.key], db = num(p?.dropbacks);
      if (!team || db === null || db <= 0 || !inWin.has(`${b.key}|${team}`)) continue;
      const a = S(off, team); a.pfrPress += num(p.pressures) ?? 0; a.pfrDb += db; a.pfrWeeks.add(b.key); any = true;
      const opp = info.get(`${b.key}|${team}`)?.opp;
      if (opp && inWin.has(`${b.key}|${opp}`)) { const d = S(def, opp); d.qbPress += num(p.pressures) ?? 0; d.qbDb += db; d.qbWeeks.add(b.key); }
    }
    const defKeys = new Map(); // team -> pressures this week
    for (const [id, p] of Object.entries(b.pfr?.def || {})) {
      const team = players?.[id]?.teams?.[b.key];
      if (!team) { unmapped.push({ key: b.key, gsis: id }); continue; }
      if (!inWin.has(`${b.key}|${team}`)) continue;
      defKeys.set(team, (defKeys.get(team) || 0) + (num(p?.pressures) ?? 0));
    }
    for (const [team, pr] of defKeys) {
      const d = S(def, team), faced = d.wk.get(b.key)?.db || 0;
      if (!faced) continue;
      d.pfrPress += pr; d.pfrDb += faced; d.pfrWeeks.add(b.key); any = true;
    }
    const inWinKey = [...inWin].some((gk) => gk.startsWith(b.key + "|"));
    if (any && inWinKey && (!pfrThrough || b.key > pfrThrough)) pfrThrough = b.key;
  }

  const weeks = [...new Set([...inWin].map((gk) => gk.split("|")[0]))].sort();
  const teams = [...new Set([...off.keys(), ...def.keys()])].sort();
  const rows = teams.map((team) => {
    const o = off.get(team) || newSide(), d = def.get(team) || newSide();
    const g = [...inWin].filter((gk) => gk.endsWith("|" + team)).length;
    const series = (a, side) => weeks.map((key) => {
      const gm = info.get(`${key}|${team}`);
      if (!gm || !inWin.has(`${key}|${team}`)) return { key, bye: true, plays: null, passRate: null, epaPlay: null };
      const w = a.wk.get(key) || { plays: 0, db: 0, epa: 0, epaN: 0 };
      return { key, opp: gm.opp, home: gm.home, side, plays: w.plays, db: w.db, passRate: ratio(w.db, w.plays), epaPlay: ratio(w.epa, w.epaN) };
    });
    // The defence's shown pressure is the QB side; the defender sum rides along for the tooltip.
    const dr = { ...sideRates(d, g), pressPct: ratio(d.qbPress, d.qbDb), pfrDb: d.qbDb, pfrWeeks: d.qbWeeks.size, pressPctDef: ratio(d.pfrPress, d.pfrDb), pfrPressDef: d.pfrPress, pfrWeeksDef: d.pfrWeeks.size };
    return { team, g, off: sideRates(o, g), def: dr, series: { off: series(o, "off"), def: series(d, "def") } };
  });
  return { rows, weeks, lgZones, pfrThrough, latestKey: weeks[weeks.length - 1] || null, unmapped };
}

// ---- the league reference among clubs ------------------------------------------------------------------------
export const TEAM_LG_KEYS = ["plays", "playsG", "passRate", "epaPlay", "epaDb", "epaCar", "succPct", "adot", "cmpPct", "sackPct", "pressPct", "pressPctDef", "paPct", "blitzPct", "explPct"];
export const OFF_TIER = { epaPlay: 1, epaDb: 1, epaCar: 1, succPct: 1, cmpPct: 1, explPct: 1, sackPct: -1, pressPct: -1 };
export const DEF_TIER = { epaPlay: -1, epaDb: -1, epaCar: -1, succPct: -1, cmpPct: -1, explPct: -1, sackPct: 1, pressPct: 1 };
const dirOf = (side) => (side === "def" ? DEF_TIER : OFF_TIER);

// { n (clubs), lg: { off: {k: mean}, def: {k: mean} }, cuts: { off: {k: {cuts, n}}, def } , text }.
export function teamReference(rows) {
  const out = { n: rows.length, lg: {}, cuts: {}, text: `every club in the window (${rows.length})` };
  for (const side of ["off", "def"]) {
    out.lg[side] = Object.fromEntries(TEAM_LG_KEYS.map((k) => [k, mean(rows.map((r) => r[side][k]))]));
    out.cuts[side] = {};
    for (const [k, sgn] of Object.entries(dirOf(side))) {
      const v = rows.map((r) => r[side][k]).filter(finite).map((x) => sgn * x);
      out.cuts[side][k] = v.length >= MIN_POOL ? { cuts: percentileCuts(v), n: v.length } : { cuts: null, n: v.length };
    }
  }
  return out;
}
// A club's tier on one key ("" for a neutral key, a missing value or too few clubs).
export function teamTier(side, k, v, cuts) {
  const sgn = dirOf(side)[k];
  if (!sgn || !finite(v)) return "";
  return tierFromCuts(sgn * v, cuts?.[side]?.[k]?.cuts);
}
// A club's rank among the clubs with a value, 1 = best ("" direction keys rank high-first).
export function teamRank(rows, side, k, team) {
  const sgn = dirOf(side)[k] || 1;
  const list = rows.filter((r) => finite(r[side][k])).sort((a, b) => sgn * (b[side][k] - a[side][k]));
  const i = list.findIndex((r) => r.team === team);
  return i < 0 ? null : { rank: i + 1, of: list.length };
}
// A side's zone cells with the league's pooled cells, for the zone field (agg_qb.js's shape).
export const teamZones = (side, lgZones) => qbZones(side?.zones, lgZones);

// ---- the team page's distributions ---------------------------------------------------------------------------
// Pass catchers: agg.js's usage rows for the club (his games with that club, every position), each with his tier on
// target share at his position (agg.js's reference pool and cuts over the whole league, the same window) and his
// share of the club's targets in the window (`clubShare`: targets / every target the club threw, pi included when
// the switch counts them). Sorted by targets.
export function teamTargets(blocks, players, st, team) {
  const base = { ...st, opp: "", ha: "", downs: [], qtrs: [], pos: {} };
  const rows = aggregateUsage(blocks, players, { ...base, team }).rows.filter((r) => r.tgt > 0);
  const ref = usageReference(aggregateUsage(blocks, players, { ...base, team: "" }).rows);
  const total = rows.reduce((s, r) => s + r.tgt, 0);
  return rows.map((r) => ({ ...r, clubShare: ratio(r.tgt, total), tier: tierFromCuts(r.tgtShare, ref.at(r.pos).cuts?.tgtShare?.cuts), lgShare: ref.at(r.pos).lg?.overall?.tgtShare ?? null }))
    .sort((a, b) => b.tgt - a.tgt || String(a.name).localeCompare(String(b.name)));
}
// Ball carriers: agg_rush.js's rows for the club, tier on rush share at his position; `clubShare` = his carries /
// every carry the club logged (scrambles included). Sorted by carries.
export function teamCarries(blocks, players, st, team) {
  const base = { ...st, opp: "", ha: "", downs: [], qtrs: [], pos: {} };
  const rows = aggregateRush(blocks, players, { ...base, team }).rows.filter((r) => r.car > 0);
  const ref = rushReference(aggregateRush(blocks, players, { ...base, team: "" }).rows);
  const total = rows.reduce((s, r) => s + r.car, 0);
  return rows.map((r) => { const P = ref.at(r.pos); return { ...r, clubShare: ratio(r.car, total), tier: rushTier("rushShare", r.rushShare, P.cuts), epaTier: rushTier("epaCar", r.epaCar, P.cuts), lgShare: P.lg?.rushShare ?? null }; })
    .sort((a, b) => b.car - a.car || String(a.name).localeCompare(String(b.name)));
}

// Sort the defence rows on one side's key; nulls last whichever direction; ties by team.
export function sortTeamRows(rows, side, key, dir = "asc") {
  const s = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "team") return s * a.team.localeCompare(b.team);
    const x = a[side][key], y = b[side][key];
    if (!finite(x)) return !finite(y) ? a.team.localeCompare(b.team) : 1;
    if (!finite(y)) return -1;
    return s * (x - y) || a.team.localeCompare(b.team);
  });
}
