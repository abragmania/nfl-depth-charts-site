// PURE (no DOM, no fetch): DraftKings fantasy points (D194) for every man, per club-game and over the window, from the
// compiled play rows only (re-cut decision 11). Past games only, never a projection. Adam, 2026-09-25: DraftKings
// NFL Classic scoring, but NO 2-point conversions and NO return touchdowns, ever; no expected points or any model of
// ours. Kneel-downs never reach the ledger (decision 2) and return fumbles are not in our rows (decision 1).
//
// Per man per club-game (gk = "week key|his club", the play's offense) inside the window after the team and opponent
// filters; a pass-interference no-play (pi=1) never scores, whatever the receivers' PI-targets switch says:
//   passYds = yards on his completed passes (type pass, passer = him)      passTd = his pass rows with td and no int
//   int     = his pass rows with int                                        (so a receiver's trick-play pass scores)
//   rushYds, rushTd = agg.js rushEvent (designed runs and, for a passer, scrambles; aggregateRush's rule)
//   rec, recYds = his completed targets and their yards                     recTd = his targets with td and no int
//   fl      = rows where he is the fumbler (fumbled by the offense) and the fumble was lost
// A game's points = .04 passYds + 4 passTd - int + (passYds >= 300 ? 3 : 0) + .1 rushYds + 6 rushTd
//   + (rushYds >= 100 ? 3 : 0) + rec + .1 recYds + 6 recTd + (recYds >= 100 ? 3 : 0) - fl, rounded to 2 decimals.
// The bonuses are per game, never per window. dk = the sum of his games; dkG = dk / the aggregator row's own games;
// dkTdShare = (4 passTd + 6 rushTd + 6 recTd) / dk, null when dk <= 0. Under a down or quarter filter dk is null
// (the bonuses are whole-game), though nothing in the app sets those filters today.
import { colIndex, clubGames, rushEvent } from "./agg.js";
import { gamesInWindow, playPredicate, isSituational } from "./filters.js";

export const DK = Object.freeze({
  passYd: 0.04, passTd: 4, int: -1, passBonus: 3, passBonusAt: 300,
  rushYd: 0.1, rushTd: 6, rushBonus: 3, rushBonusAt: 100,
  rec: 1, recYd: 0.1, recTd: 6, recBonus: 3, recBonusAt: 100,
  fl: -1,
});
export const DK_PARTS = ["passYds", "passTd", "int", "rushYds", "rushTd", "rec", "recYds", "recTd", "fl"];

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
const round2 = (x) => Math.round(x * 100) / 100 + 0; // + 0 turns a -0 into 0
const emptyLine = () => Object.fromEntries(DK_PARTS.map((k) => [k, 0]));

// One game's DraftKings points from its line { passYds, passTd, int, rushYds, rushTd, rec, recYds, recTd, fl } (a
// missing part is 0), rounded to 2 decimals.
export function dkGamePoints(line) {
  const v = (k) => num(line?.[k]) ?? 0;
  const pts = DK.passYd * v("passYds") + DK.passTd * v("passTd") + DK.int * v("int") + (v("passYds") >= DK.passBonusAt ? DK.passBonus : 0)
    + DK.rushYd * v("rushYds") + DK.rushTd * v("rushTd") + (v("rushYds") >= DK.rushBonusAt ? DK.rushBonus : 0)
    + DK.rec * v("rec") + DK.recYd * v("recYds") + DK.recTd * v("recTd") + (v("recYds") >= DK.recBonusAt ? DK.recBonus : 0)
    + DK.fl * v("fl");
  return round2(pts);
}

// The touchdown points inside a window's parts (4 per passing TD, 6 per rushing or receiving TD).
export const dkTdPoints = (parts) => DK.passTd * (parts?.passTd || 0) + DK.rushTd * (parts?.rushTd || 0) + DK.recTd * (parts?.recTd || 0);

function gamePasses(st, g) {
  if (!g) return false;
  if (st.team && g.team !== st.team) return false;
  if (st.opp && g.opp !== st.opp) return false;
  if (st.ha === "home" && !g.home) return false;
  if (st.ha === "away" && g.home) return false;
  return true;
}

function compute(blocks, st) {
  const games = clubGames(blocks);
  const inWin = gamesInWindow(games, st);
  const info = new Map(games.map((g) => [`${g.key}|${g.team}`, g]));
  const gameOk = (gk) => inWin.has(gk) && gamePasses(st, info.get(gk));
  const lines = new Map(); // gsis -> Map(gk -> line)
  const L = (id, gk) => {
    if (!lines.has(id)) lines.set(id, new Map());
    const m = lines.get(id);
    if (!m.has(gk)) m.set(gk, emptyLine());
    return m.get(gk);
  };
  for (const b of blocks) {
    const C = colIndex(b.cols);
    const pred = playPredicate(st, C);
    for (const r of b.plays || []) {
      const gk = `${b.key}|${r[C.posteam]}`;
      if (!gameOk(gk) || !pred(r)) continue;
      if (truthy(r[C.pi])) continue; // a pass-interference no-play never scores
      const y = num(r[C.yards]) ?? 0, td = truthy(r[C.td]), int = truthy(r[C.int]);
      if (r[C.type] === "pass") {
        const cmp = truthy(r[C.complete]);
        if (r[C.passer]) {
          const l = L(r[C.passer], gk);
          if (cmp) l.passYds += y;
          if (td && !int) l.passTd++;
          if (int) l.int++;
        }
        if (r[C.target]) {
          const l = L(r[C.target], gk);
          if (cmp) { l.rec++; l.recYds += y; }
          if (td && !int) l.recTd++;
        }
      }
      const ev = rushEvent(r, C);
      if (ev) { const l = L(ev.id, gk); l.rushYds += y; if (td) l.rushTd++; }
      const f = C.fumbler === undefined ? null : r[C.fumbler];
      if (f && truthy(r[C.fumLost])) L(f, gk).fl++;
    }
  }
  const situational = isSituational(st);
  const out = new Map();
  for (const [id, m] of lines) {
    const parts = emptyLine();
    const list = [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([gk, l]) => {
      for (const k of DK_PARTS) parts[k] += l[k];
      return Object.freeze({ gk, pts: situational ? null : dkGamePoints(l), line: Object.freeze(l) });
    });
    // Frozen before caching: a page that sorts or edits what it gets cannot corrupt the shared cache.
    out.set(id, Object.freeze({ dk: situational ? null : round2(list.reduce((s, x) => s + x.pts, 0)), parts: Object.freeze(parts), games: Object.freeze(list) }));
  }
  return out;
}

// Map gsis -> { dk, parts (the window's sums of the nine parts), games: [{ gk, pts, line }] sorted by gk }, for every
// man with a scoring-relevant row in the window (a pass thrown, a target, a carry, a lost fumble). Memoized on the
// blocks array's identity and the window/filter fields, so the three aggregators and the player page share one pass;
// treat the result as read-only. `players` is accepted for symmetry with the aggregators and not needed.
const memo = new WeakMap();
const stKey = (st) => JSON.stringify([st.season, st.with2025, st.window, st.from, st.to, !!st.po, st.team || "", st.opp || "", st.ha || "", st.downs || [], st.qtrs || []]);
export function fantasyByPlayer(blocks, players, st) {
  let byBlocks = memo.get(blocks);
  if (!byBlocks) { byBlocks = new Map(); memo.set(blocks, byBlocks); }
  const k = stKey(st);
  if (!byBlocks.has(k)) byBlocks.set(k, compute(blocks, st));
  return byBlocks.get(k);
}

// The three DK fields an aggregator row carries, from his fantasyByPlayer entry (none: he scored nothing, dk 0) and
// the row's own games. All null under a down or quarter filter.
export function dkFields(entry, g, st) {
  if (isSituational(st)) return { dk: null, dkG: null, dkTdShare: null };
  const dk = entry?.dk ?? 0;
  return { dk, dkG: g > 0 ? dk / g : null, dkTdShare: dk > 0 ? dkTdPoints(entry?.parts) / dk : null };
}
