// PURE (no DOM, no fetch): what each defense allows by position (D196, Adam 2026-09-25: "do I want to start a RB/WR
// against X defense?"; the by-position view sits beside the current Defense table). From the play rows and the
// DraftKings games agg_fantasy.js already builds (D194 scoring: no 2-point conversions, no return TDs).
//
// WHO IS WHICH POSITION: the man's listed position in the players file (data.js's merged map), grouped QB, RB (FB and
// HB counted as backs), WR, TE. A man with no position is left out of every group and counted in `unpositioned`; a
// man with some other position (a lineman's catch, a punter's fake) is left out and counted in `otherPos`. Both
// audits cover the games in the defenses' window and carry the men's ids and the DK points they scored there.
//
// WHICH GAMES: a defense's games are its own club-games in the window (gamesInWindow; "last 3" is the defense's own
// last three, as on the Defense page, agg_team.js). Every play the opposing offense ran in those games counts against
// it. The team, opponent, home/away, down and quarter filters are ignored (the Defense page ignores them too); the
// week window, the playoffs switch and the PI-targets switch apply.
//
// PER MAN, PER PLAY (the other pages' rules, to the play):
//   targets      = pass rows where he is the target. A pass-interference no-play (pi=1) counts as a target unless
//                  the PI-targets switch is off (st.pi === false), in which case pi rows are skipped entirely (agg.js).
//   carries      = agg.js rushEvent: a designed run (he is the rusher) or, for a passer, a scramble.
//   redZoneLooks = red-zone targets (same PI rule) + red-zone carries (the ledger's redzone flag).
//   oppYds       = receiving yards on his completed non-PI targets + rushing yards on his carries.
//   td           = receiving TDs (td and no int on his targets, agg.js's rule) + rushing TDs on his carries.
//   dropbacks    = his non-PI pass attempts + his sacks + his scrambles (agg_qb.js). attempts = his non-PI pass rows.
//   passYds      = yards on his completed non-PI passes. passTd = his non-PI pass rows with td and no int.
//   int          = his non-PI pass rows with int.
//   dk           = his DraftKings points in that game (fantasyByPlayer's per-game pts), all of them credited to the
//                  defense his club faced in that game.
// Every group carries every figure (a receiver's jet sweep is a WR carry, a trick-play pass is a WR attempt); the page
// chooses which to show (targets for WR/TE/RB, carries for RB/QB, the passing figures for QBs).
//
// PER GAME (allowedByPosition): a figure's total over the defense's games / the defense's games (g). ydsPerOpp is
// not per game: oppYds / (targets + carries) over the window. Every ratio is null on a zero denominator. A defense
// with no games in the window has every figure, rank and total null and is left out of the league mean and ranks.
// RANK: rankWithTies (agg_grid.js) across the defenses with games, on the value rounded to the figure's `digits`;
// rank 1 = the toughest matchup: the fewest allowed, except int, where the most interceptions ranks 1.
// LEAGUE: the plain mean of each per-game figure (and of ydsPerOpp) over the defenses with games.
// INVARIANT (tested): with a season or range window, for every group and figure, the defenses' totals summed equal
// the offenses' men's totals summed over the same window (every play has one offense and one defense).
//
// SECOND COLUMN, OPTIONAL (allowedVsUsual; Adam's open choice, the page decides whether to show it): the same figures
// against what the same offenses' men of that position usually do, so a defense that met only weak offenses is not
// flattered. For each of the defense's games in the window whose opposing offense has at least one OTHER game in the
// window (its own club-games in the window, not against this defense): usual = that offense's group total over its
// other games / the number of those games. Then over those games (n): allowed = Σ allowed / n, usual = Σ usual / n,
// diff = allowed − usual (per game; negative = the defense held them under their norm). For ydsPerOpp, allowed and
// usual are Σ oppYds / Σ (targets + carries) on each side and diff is their difference. A game whose offense has
// no other game in the window is left out of both sides; n = 0 gives nulls.
//
// FANTASY ARGUMENT: optional. When given it must be fantasyByPlayer(blocks, players, allowedFantasyState(st)) (the
// whole scope of the blocks, no team, opponent, down or quarter filter); omitted, that is computed (memoized there).
// Results are frozen all the way down.
import { colIndex, clubGames, rushEvent } from "./agg.js";
import { fantasyByPlayer } from "./agg_fantasy.js";
import { gamesInWindow } from "./filters.js";
import { rankWithTies } from "./agg_grid.js";

export const POS_GROUPS = Object.freeze(["QB", "RB", "WR", "TE"]);
const GROUP_OF = Object.freeze({ QB: "QB", RB: "RB", FB: "RB", HB: "RB", WR: "WR", TE: "TE" });
// The group a players-file position falls in: "QB" | "RB" | "WR" | "TE", "" for no position, null for any other.
export function posGroup(pos) {
  const p = String(pos || "").trim().toUpperCase();
  if (!p) return "";
  return GROUP_OF[p] ?? null;
}

// The summed parts per man-game (TOT_KEYS) and the displayed figures (ALLOWED_FIGURES; dir -1 = lower is better).
export const TOT_KEYS = Object.freeze(["dk", "targets", "carries", "redZoneLooks", "oppYds", "td", "dropbacks", "attempts", "passYds", "passTd", "int"]);
const fig = (k, label, digits, extra = {}) => Object.freeze({ k, label, digits, dir: -1, pct: false, perGame: true, ...extra });
export const ALLOWED_FIGURES = Object.freeze([
  fig("dk", "DK pts/g", 1),
  fig("targets", "Tgt/g", 1),
  fig("carries", "Car/g", 1),
  fig("redZoneLooks", "RZ looks/g", 1),
  fig("ydsPerOpp", "Yds/opp", 2, { perGame: false }),
  fig("td", "TD/g", 2),
  fig("dropbacks", "Db/g", 1),
  fig("attempts", "Att/g", 1),
  fig("passYds", "Pass yds/g", 1),
  fig("passTd", "Pass TD/g", 2),
  fig("int", "INT/g", 2, { dir: 1 }),
]);
export const ALLOWED_KEYS = Object.freeze(ALLOWED_FIGURES.map((f) => f.k));

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
const ratio = (a, b) => (b > 0 ? a / b : null);
const finite = (x) => x !== null && x !== undefined && Number.isFinite(+x);
const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const emptyTot = () => Object.fromEntries(TOT_KEYS.map((k) => [k, 0]));
const emptyGroups = () => Object.fromEntries(POS_GROUPS.map((p) => [p, emptyTot()]));
const nullFigs = () => Object.fromEntries(ALLOWED_KEYS.map((k) => [k, null]));
const addTot = (a, b) => { for (const k of TOT_KEYS) a[k] += b[k]; return a; };

// The state fantasyByPlayer is called with here: the whole scope of the blocks (season window, playoffs switch kept),
// no team, opponent, home/away, down or quarter filter.
export const allowedFantasyState = (st) => ({ ...st, window: "season", from: "", to: "", team: "", opp: "", ha: "", downs: [], qtrs: [] });

// One pass: the group totals of every offense club-game in scope, and the audits' raw material.
function accumulate(blocks, players, st, fantasyIn) {
  const base = { ...st, team: "", opp: "", ha: "", downs: [], qtrs: [] };
  const games = clubGames(blocks);
  const inWin = gamesInWindow(games, base);
  const scope = gamesInWindow(games, allowedFantasyState(st));
  const info = new Map(games.map((g) => [`${g.key}|${g.team}`, g]));
  const byGame = new Map(); // offense gk -> { QB: tot, RB: tot, WR: tot, TE: tot }
  const odd = new Map(); // gk -> Map(gsis -> { group: "" | null, pos, dk }) for men outside the four groups
  const G = (gk) => { if (!byGame.has(gk)) byGame.set(gk, emptyGroups()); return byGame.get(gk); };
  // The man's totals in that game, or null (outside the groups; noted for the audit).
  const T = (gk, id) => {
    const pos = players?.[id]?.pos, grp = posGroup(pos);
    if (grp) return G(gk)[grp];
    if (!odd.has(gk)) odd.set(gk, new Map());
    if (!odd.get(gk).has(id)) odd.get(gk).set(id, { group: grp, pos: String(pos || "").toUpperCase(), dk: 0 });
    return null;
  };

  for (const b of blocks) {
    const C = colIndex(b.cols);
    for (const r of b.plays || []) {
      const gk = `${b.key}|${r[C.posteam]}`;
      if (!scope.has(gk)) continue;
      G(gk);
      const pi = truthy(r[C.pi]);
      if (pi && st.pi === false) continue;
      const type = r[C.type], y = num(r[C.yards]) ?? 0, td = truthy(r[C.td]), int = truthy(r[C.int]), rz = truthy(r[C.redzone]);
      if (type === "pass") {
        if (r[C.target]) {
          const t = T(gk, r[C.target]);
          if (t) {
            t.targets++;
            if (rz) t.redZoneLooks++;
            if (!pi && truthy(r[C.complete])) t.oppYds += y;
            if (td && !int) t.td++;
          }
        }
        if (!pi && r[C.passer]) {
          const t = T(gk, r[C.passer]);
          if (t) {
            t.attempts++; t.dropbacks++;
            if (truthy(r[C.complete])) t.passYds += y;
            if (td && !int) t.passTd++;
            if (int) t.int++;
          }
        }
      } else if (type === "sack" && r[C.passer]) {
        const t = T(gk, r[C.passer]);
        if (t) t.dropbacks++;
      }
      const ev = rushEvent(r, C);
      if (ev) {
        const t = T(gk, ev.id);
        if (t) {
          t.carries++; t.oppYds += y;
          if (td) t.td++;
          if (rz) t.redZoneLooks++;
          if (!ev.designed) t.dropbacks++; // a scramble is a dropback and a carry (agg_qb.js)
        }
      }
    }
  }
  const fantasy = fantasyIn || fantasyByPlayer(blocks, players, allowedFantasyState(st));
  for (const [id, entry] of fantasy) {
    for (const x of entry?.games || []) {
      if (!scope.has(x.gk) || !finite(x.pts)) continue;
      const t = T(x.gk, id);
      if (t) t.dk += x.pts;
      else odd.get(x.gk).get(id).dk += x.pts;
    }
  }
  // A defense's offense club-games in the window: [offense gk] for each of its own club-games in inWin.
  const teams = [...new Set(games.map((g) => g.team))].sort();
  const faced = (d) => [...inWin].filter((gk) => gk.endsWith("|" + d)).sort().map((gk) => {
    const key = gk.split("|")[0], o = info.get(gk)?.opp;
    return o ? { key, off: o, offGk: `${key}|${o}` } : null;
  }).filter(Boolean);
  return { inWin, info, byGame, odd, teams, faced };
}

const round2 = (x) => Math.round(x * 100) / 100 + 0;
// Per-game figures from a window total over g games.
function perGame(tot, g) {
  const out = {};
  for (const f of ALLOWED_FIGURES) out[f.k] = f.k === "ydsPerOpp" ? ratio(tot.oppYds, tot.targets + tot.carries) : ratio(tot[f.k], g);
  return out;
}

// { rows: [{ team, g, pos: { QB|RB|WR|TE: { tot, pg, rank } } }], lg: { [group]: { [k]: mean } }, n (defenses with
// games), unpositioned: { n, ids, dk }, otherPos: { n, men: [{ gsis, pos }], dk }, figures, groups }.
// `tot` holds the window totals (TOT_KEYS; dk rounded to 2 decimals), `pg` the displayed figures, `rank` their ranks.
export function allowedByPosition(blocks, players, st, fantasy) {
  const A = accumulate(blocks, players, st, fantasy);
  const rows = A.teams.map((team) => {
    const list = A.faced(team), g = list.length;
    const pos = {};
    for (const grp of POS_GROUPS) {
      if (!g) { pos[grp] = { tot: null, pg: nullFigs(), rank: nullFigs() }; continue; }
      const tot = emptyTot();
      for (const x of list) { const gt = A.byGame.get(x.offGk); if (gt) addTot(tot, gt[grp]); }
      tot.dk = round2(tot.dk);
      pos[grp] = { tot, pg: perGame(tot, g), rank: nullFigs() };
    }
    return { team, g, pos };
  });
  const lg = {};
  for (const grp of POS_GROUPS) {
    lg[grp] = {};
    for (const f of ALLOWED_FIGURES) {
      const vals = rows.map((r) => (r.g ? r.pos[grp].pg[f.k] : null));
      const ranks = rankWithTies(vals, f);
      rows.forEach((r, i) => { if (r.g) r.pos[grp].rank[f.k] = ranks[i]; });
      const have = vals.filter(finite);
      lg[grp][f.k] = have.length ? have.reduce((a, b) => a + b, 0) / have.length : null;
    }
  }
  // The audits over the defenses' window games.
  const winOff = new Set(A.teams.flatMap((t) => A.faced(t).map((x) => x.offGk)));
  const un = new Map(), other = new Map();
  for (const [gk, m] of A.odd) {
    if (!winOff.has(gk)) continue;
    for (const [id, x] of m) {
      const tgt = x.group === "" ? un : other;
      const cur = tgt.get(id) || { gsis: id, pos: x.pos, dk: 0 };
      cur.dk += x.dk; tgt.set(id, cur);
    }
  }
  const sumDk = (m) => round2([...m.values()].reduce((s, x) => s + x.dk, 0));
  return deepFreeze({
    rows, lg, n: rows.filter((r) => r.g).length,
    unpositioned: { n: un.size, ids: [...un.keys()].sort(), dk: sumDk(un) },
    otherPos: { n: other.size, men: [...other.values()].map(({ gsis, pos }) => ({ gsis, pos })).sort((a, b) => a.gsis.localeCompare(b.gsis)), dk: sumDk(other) },
    figures: ALLOWED_FIGURES, groups: POS_GROUPS,
  });
}

// SECOND COLUMN, OPTIONAL (see the header). { rows: [{ team, g, n, pos: { QB|RB|WR|TE: { allowed, usual, diff } } }] },
// each of allowed / usual / diff keyed by ALLOWED_KEYS; n = the defense's games with a baseline.
export function allowedVsUsual(blocks, players, st, fantasy) {
  const A = accumulate(blocks, players, st, fantasy);
  // Each offense's club-games in the window.
  const offGames = new Map();
  for (const gk of A.inWin) { const t = gk.split("|")[1]; if (!offGames.has(t)) offGames.set(t, []); offGames.get(t).push(gk); }
  const rows = A.teams.map((team) => {
    const list = A.faced(team);
    const al = emptyGroups(), us = emptyGroups();
    let n = 0;
    for (const x of list) {
      const others = (offGames.get(x.off) || []).filter((gk) => A.info.get(gk)?.opp !== team);
      if (!others.length) continue;
      n++;
      const gt = A.byGame.get(x.offGk) || emptyGroups();
      for (const grp of POS_GROUPS) {
        addTot(al[grp], gt[grp]);
        const sum = emptyTot();
        for (const gk of others) { const o = A.byGame.get(gk); if (o) addTot(sum, o[grp]); }
        for (const k of TOT_KEYS) us[grp][k] += sum[k] / others.length;
      }
    }
    const pos = {};
    for (const grp of POS_GROUPS) {
      if (!n) { pos[grp] = { allowed: nullFigs(), usual: nullFigs(), diff: nullFigs() }; continue; }
      const allowed = perGame(al[grp], n), usual = perGame(us[grp], n);
      const diff = Object.fromEntries(ALLOWED_KEYS.map((k) => [k, finite(allowed[k]) && finite(usual[k]) ? allowed[k] - usual[k] : null]));
      pos[grp] = { allowed, usual, diff };
    }
    return { team, g: list.length, n, pos };
  });
  return deepFreeze({ rows, figures: ALLOWED_FIGURES, groups: POS_GROUPS });
}
