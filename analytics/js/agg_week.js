// PURE (no DOM, no fetch): the "This week" strip on every analytics player page (D224 increment B; ANALYTICS.md "The
// decision surface, D224"). One thin line under his depth-chart card, current season only, left to right:
//   (1) his club's next game from the /api/teams entry (nextOpponent { abbr, home, kickoff, week } and byeWeek, the
//       fields the depth chart's team header reads): "@ BUF · Sun 1:00 PM" (kickoff through gamesbar.js's own
//       fmtKickoffShort, Eastern), or "Bye" when byeWeek is the league's current week;
//   (2) that defence against his position "vs usual" with its rank among the defences: the allowed table's own
//       figure (agg_allowed.js allowedVsUsual) coloured and ranked by the allowed table's own cell builder
//       (views/allowed_table.js posCells with vs on), never recomputed here. DK/g is the headline; beside it Tgt/g
//       for a WR or TE, Car/g and Tgt/g for a back, Pass yds/g for a QB. Rank 1 = held the position furthest under
//       its norm (the toughest matchup), so a high rank is a soft one;
//   (3) his last 3 games played against every game he played in the season: agg_player.js trendFigures for backs
//       and receivers, agg_qb.js qbTrend for quarterbacks, both on the current season's regular-season window
//       (weekState). Under four games played the arrows hide (the page's Trend strip rule), the strip does not;
//   (4) health chips for the men his usage depends on, from his club's compiled depth chart (api/team/<CLUB>.json)
//       and the injury feed (the feed's entry wins: it carries willNotPlay, the absence layer's `missing` rule,
//       agg_absence.js isMissing): a receiver gets his QB1 and the club's other top three men by targets; a back the
//       other listed backs; a QB his top three targets and every offensive-line starter the chart marks OUT, IR,
//       D or Q (name and status only). "Top by targets" counts the club's targets in the current season and keeps
//       only men on the club's current depth chart (a traded or released man drops out).
// Everything here is free of page state so the This-week matchup page (increment C) reuses it.
import { colIndex, clubGames } from "./agg.js";
import { gamesInWindow, splitKey } from "./filters.js";
import { allowedByPosition, allowedVsUsual, ALLOWED_FIGURES, posGroup } from "./agg_allowed.js";
import { isMissing } from "./agg_absence.js";
import { posCells } from "./views/allowed_table.js";
import { fmtKickoffShort } from "../../js/gamesbar.js";

const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
const isNum = (v) => v !== null && v !== undefined && Number.isFinite(+v);
const FIG = Object.fromEntries(ALLOWED_FIGURES.map((f) => [f.k, f]));

// The figures shown per position group (ALLOWED_FIGURES keys; the first is the headline).
export const WEEK_POS_FIGS = Object.freeze({
  QB: Object.freeze(["dk", "passYds"]),
  RB: Object.freeze(["dk", "carries", "targets"]),
  WR: Object.freeze(["dk", "targets"]),
  TE: Object.freeze(["dk", "targets"]),
});
// The allowed table's own sentence (views/allowed_table.js vsSegHtml and its note).
export const VS_USUAL_TEXT = "vs usual: what that defense allowed minus what the same offenses' men of that position usually get in their other games in the window, averaged over its games where the offense has another game to compare. Below zero = held them under their norm";

// The trend keys the strip shows per kind (the trend objects may carry more).
export const WEEK_TREND_KEYS = Object.freeze({
  receiver: Object.freeze(["tgtShare", "routePct", "ayShare"]),
  back: Object.freeze(["oppShare", "snapPct", "tgtShare"]),
  qb: Object.freeze(["dbG", "carG", "rzDbG", "snapPct"]),
});

// The strip's window: the picked (current) season's regular season to date, whatever the page's window, club, opponent
// or previous-season switch says (a this-week line is season-to-date on purpose); the PI-targets switch is kept.
// weekInScope does not drop a loaded previous season on its own, so every figure is fed seasonBlocks() too.
export const seasonBlocks = (blocks, season) => (blocks || []).filter((b) => splitKey(b.key).season === +season);
export const weekState = (st) => ({ ...st, with2025: false, window: "season", from: null, to: null, po: false, team: "", opp: "", ha: "", downs: [], qtrs: [] });

// (1) The next game from a /api/teams entry. currentWeek: the payload's currentWeek. Returns
// { kind: "bye", week } | { kind: "game", opp, home, kickoff, kickText, week, otherWeek } | null (nothing scheduled).
// kickText is "" once the kickoff is more than STALE_KICK_MS in the past (the teams file has not moved on yet: the
// opponent alone); otherWeek is true when that game is not in the league's current week (the strip adds "Wk N").
export const STALE_KICK_MS = 5 * 3600 * 1000;
export function nextGame(teamEntry, currentWeek, now = Date.now()) {
  if (!teamEntry) return null;
  const bye = teamEntry.byeWeek;
  if (isNum(bye) && isNum(currentWeek) && +bye === +currentWeek) return { kind: "bye", week: +bye };
  const o = teamEntry.nextOpponent;
  if (!o?.abbr) return null;
  const t = Date.parse(o.kickoff ?? "");
  const stale = Number.isFinite(t) && now - t > STALE_KICK_MS;
  const week = isNum(o.week) ? +o.week : null;
  return { kind: "game", opp: o.abbr, home: !!o.home, kickoff: o.kickoff ?? null, kickText: stale ? "" : fmtKickoffShort(o.kickoff) || "", week,
    otherWeek: week !== null && isNum(currentWeek) && week !== +currentWeek };
}

// (2) The allowed table's vs-usual cells for the whole league in `st` (pass weekState(st)): posCells(allowed, usual,
// true). Memoized on the blocks (each one), the players map, the fantasy argument and the switches that change it.
let cellMemo = null;
export function weekAllowedCells(blocks, players, st, fantasy) {
  const sig = `${st.season}|${st.with2025}|${st.window}|${st.po}|${st.pi}`;
  const same = cellMemo && cellMemo.sig === sig && cellMemo.players === players && cellMemo.fantasy === fantasy && cellMemo.blocks.length === blocks.length && cellMemo.blocks.every((b, i) => b === blocks[i]);
  if (same) return cellMemo.cells;
  const cells = posCells(allowedByPosition(blocks, players, st, fantasy), allowedVsUsual(blocks, players, st, fantasy), true);
  cellMemo = { blocks: [...blocks], players, fantasy, sig, cells };
  return cells;
}
// One defence against one position group: { team, n (games with a baseline), g, grp, figs: [{ k, label, digits, v,
// rank, of, tier, allowed, usual }] }, or null when the defence has no row.
export function vsUsualFor(cells, defTeam, grp) {
  const r = cells?.get?.(defTeam);
  const keys = WEEK_POS_FIGS[grp];
  if (!r || !keys) return null;
  const figs = keys.map((k) => {
    const c = r.cells?.[grp]?.[k] || {};
    return { k, label: FIG[k].label, digits: FIG[k].digits, v: isNum(c.v) ? +c.v : null, rank: c.rank ?? null, of: c.of ?? 0, tier: c.tier || "", allowed: c.allowed ?? null, usual: c.usual ?? null };
  });
  return { team: defTeam, n: r.n ?? 0, g: r.g ?? 0, grp, figs };
}

// (3) The trend's marks: { hidden, games, marks: [{ k, last3, season, delta, unit: "pts" | "" }] }. Shares
// (backs, receivers and the QB's snap %) move in percentage points; the QB's per-game counts in their own units.
export function trendMarks(trend, kind) {
  if (!trend) return null;
  const games = trend.games || 0;
  // The page's Trend strip rule: shown only when the window holds more games than the last 3 (four or more).
  if (!(games >= 2) || games <= (trend.last3Games || 0)) return { hidden: true, games, marks: [] };
  const marks = (WEEK_TREND_KEYS[kind] || []).map((k) => {
    const f = trend.figures?.[k];
    if (!f) return null;
    const share = kind !== "qb" || k === "snapPct";
    const delta = share ? f.pts : f.delta;
    if (!isNum(delta)) return null;
    return { k, last3: f.last3, season: f.season, delta: +delta, unit: share ? "pts" : "", n3: f.n3, n: f.n };
  }).filter(Boolean);
  return { hidden: false, games, last3Games: trend.last3Games, last3Weeks: trend.last3Weeks || [], marks };
}

// (4) The depth chart as one lookup: Map gsis -> { gsis, name, role, status, band, label, ordinal, unit, listed }.
// A man on several slots keeps his first listed (units before the unlisted tray).
export function chartIndex(view) {
  const out = new Map();
  const put = (p, s, unit, listed) => {
    const g = p?.gsisId ? String(p.gsisId) : null;
    if (!g || out.has(g)) return;
    out.set(g, { gsis: g, name: p.name || g, role: p.role ?? null, status: p.status ?? null, band: s?.band ?? null, label: s?.label ?? null, ordinal: s?.ordinal ?? null, unit, listed });
  };
  for (const unit of ["OFF", "DEF"]) for (const s of view?.units?.[unit] || []) for (const p of s?.players || []) put(p, s, unit, true);
  for (const unit of ["OFF", "DEF"]) for (const [band, list] of Object.entries(view?.unlisted?.[unit] || {})) for (const p of Array.isArray(list) ? list : []) put(p, { band }, unit, false);
  return out;
}

// The club's targets in the window (st: weekState), most first: [{ gsis, tgt }]. The PI rule is agg.js's: a
// pass-interference target counts unless "excl. PI targets" is on.
export function clubTargetCounts(blocks, st, team) {
  const win = gamesInWindow(clubGames(blocks), st);
  const n = new Map();
  for (const b of blocks || []) {
    const C = colIndex(b.cols);
    for (const r of b.plays || []) {
      if (r[C.posteam] !== team || !win.has(`${b.key}|${team}`)) continue;
      if (r[C.type] !== "pass" || !r[C.target]) continue;
      if (truthy(r[C.pi]) && st.pi === false) continue;
      n.set(r[C.target], (n.get(r[C.target]) || 0) + 1);
    }
  }
  return [...n].map(([gsis, tgt]) => ({ gsis, tgt })).sort((a, b) => b.tgt - a.tgt || a.gsis.localeCompare(b.gsis));
}

const WILL_NOT = new Set(["INACTIVE", "SUSP", "EXEMPT", "IR", "PUP", "NFI", "OUT"]); // server/compile/status.js willNotPlay
const OL_FLAG = new Set(["OUT", "IR", "D", "Q", "PUP", "NFI", "SUSP"]);
const STARTING = new Set(["STARTER", "STARTER_OUT"]);
// A man's status: the feed's entry when it names him (it carries willNotPlay), else the chart's with willNotPlay
// derived from its code the way the server derives it.
function statusOf(gsis, entry, feed) {
  const f = feed?.players?.[gsis];
  if (f?.code) return f;
  const s = entry?.status;
  if (!s?.code) return null;
  return { ...s, willNotPlay: WILL_NOT.has(String(s.code).toUpperCase()) };
}

// The health list: [{ gsis, name, why: "QB1" | "target" | "back" | "OL", status, code, missing }].
// kind: "receiver" | "back" | "qb"; targets: clubTargetCounts() for his club.
export function healthList(kind, gsis, view, { targets = [], feed = null, nTargets = 3 } = {}) {
  const idx = chartIndex(view);
  const off = view?.units?.OFF || [];
  const chip = (e, why) => {
    const status = statusOf(e.gsis, e, feed);
    return { gsis: e.gsis, name: e.name, why, status, code: status?.code ? String(status.code).toUpperCase() : null, missing: isMissing(status) };
  };
  const out = [], seen = new Set([gsis]);
  const add = (e, why) => { if (e && !seen.has(e.gsis)) { seen.add(e.gsis); out.push(chip(e, why)); } };
  const slotMen = (pred) => off.filter(pred).flatMap((s) => (s.players || []).map((p) => idx.get(String(p.gsisId || ""))).filter(Boolean));
  const topTargets = () => {
    let k = 0;
    for (const t of targets) {
      if (k >= nTargets) break;
      const e = idx.get(t.gsis);
      if (!e || e.unit !== "OFF" || seen.has(t.gsis)) continue;
      if (posGroup(e.band === "BACKFIELD" ? "RB" : e.band) === "QB") continue;
      add(e, "target"); k++;
    }
  };
  if (kind === "receiver") {
    const qbSlot = off.filter((s) => s.band === "QB").sort((a, b) => (a.ordinal ?? 9) - (b.ordinal ?? 9))[0];
    const qbs = (qbSlot?.players || []).map((p) => idx.get(String(p.gsisId || ""))).filter(Boolean);
    add(qbs.find((e) => STARTING.has(e.role)) || qbs[0], "QB1");
    topTargets();
  } else if (kind === "back") {
    for (const e of slotMen((s) => s.band === "BACKFIELD" || s.band === "RB" || s.band === "FB")) add(e, "back");
  } else if (kind === "qb") {
    topTargets();
    for (const e of slotMen((s) => s.band === "OL")) {
      const st = statusOf(e.gsis, e, feed);
      if (STARTING.has(e.role) && st?.code && OL_FLAG.has(String(st.code).toUpperCase())) add(e, "OL");
    }
  }
  return out;
}

// The strip's data, or null off the current season or when his club has no entry in the teams file. Pass blocks of
// the current season only (seasonBlocks) to everything that fed `cells`, `trend` and `targets`. args: { kind, pos, gsis, season, teamsPayload (the /api/teams
// body: season, currentWeek, teams), club (his club's abbreviation), cells (weekAllowedCells), trend (trendFigures /
// qbTrend on weekState), view (his club's compiled depth chart, or null), feed (the status feed), targets
// (clubTargetCounts for his club) }.
export function weekStrip({ kind, pos, gsis, season, teamsPayload, club, cells, trend, view = null, feed = null, targets = [], now = Date.now() } = {}) {
  const cur = teamsPayload?.season;
  if (!isNum(cur) || +season !== +cur || !club) return null;
  const entry = (teamsPayload.teams || []).find((t) => t.abbr === club) || null;
  if (!entry) return null;
  const game = nextGame(entry, teamsPayload.currentWeek, now);
  const grp = kind === "qb" ? "QB" : posGroup(pos) || (kind === "back" ? "RB" : "WR");
  return {
    kind, club, grp, week: isNum(teamsPayload.currentWeek) ? +teamsPayload.currentWeek : null,
    game,
    matchup: game?.kind === "game" ? vsUsualFor(cells, game.opp, grp) : null,
    trend: trendMarks(trend, kind),
    health: view ? healthList(kind, gsis, view, { targets, feed }) : [],
  };
}
