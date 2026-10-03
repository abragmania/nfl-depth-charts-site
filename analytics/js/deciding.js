// The figures behind the "Deciding" column set on the Receivers, Running backs and Quarterbacks tables (D224 increment F;
// ANALYTICS.md "The decision surface, D224"). table.js stays free of this: it draws what arrives on the rows. decorateDeciding
// adds, in place, to each aggregated row:
//   - the LAST-3 figures: his club's last three games as the Last 3 window defines them (filters.js gamesInWindow: each
//     club's three most recent games, a bye skipped) from a second league-wide aggregation under that window, whatever the
//     page's window, memoized across renders on the blocks, the players map and the switches that change it. Receivers:
//     snapL3, routeL3, tgtL3; backs: snapL3, rushL3 (carry share), tgtL3; quarterbacks: dbG (the season's Db/g, the QB
//     page's divisor) and dbGL3.
//   - this week's opponent and the vs-usual cell: the strip's own pieces (agg_week.js nextGame, weekAllowedCells,
//     vsUsualFor; kit.js vsUsualCell, so the figure, colour and rank are the This-week strip's, never recomputed here).
//     Current season only: a past season's table (or a club the teams file lacks) gets dashes. wkOpp sorts by club,
//     wkVs by the DK/g vs-usual figure.
import { aggregateUsage } from "./agg.js";
import { aggregateRush } from "./agg_rush.js";
import { aggregateQb } from "./agg_qb.js";
import { posGroup } from "./agg_allowed.js";
import { nextGame, vsUsualFor, weekAllowedCells, weekState, seasonBlocks, VS_USUAL_TEXT } from "./agg_week.js";
import { vsUsualCell } from "./views/kit.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isNum = (v) => v !== null && v !== undefined && Number.isFinite(+v);

const AGG = { rec: aggregateUsage, rb: aggregateRush, qb: aggregateQb };
// The last-3 window's state: the page's season (never last season: with2025 is off, and last3Rows feeds only that season's
// blocks) and its PI switch, every club, opponent and position (a man's club's last three games, whatever the page filters
// to), the Last 3 window.
export const last3State = (st) => ({ ...st, with2025: false, window: "last3", from: null, to: null, team: "", opp: "", pos: {}, ha: "", downs: [], qtrs: [], open: "" });
const memo = {};
// Map gsis -> the row of the Last 3 aggregation. kind: "rec" | "rb" | "qb".
export function last3Rows(kind, blocks, players, st) {
  const sig = `${st.season}|${st.po}|${st.pi}`;
  const m = memo[kind];
  if (m && m.sig === sig && m.players === players && m.blocks.length === blocks.length && m.blocks.every((b, i) => b === blocks[i])) return m.by;
  const by = new Map(AGG[kind](seasonBlocks(blocks, st.season), players, last3State(st)).rows.map((r) => [r.gsis, r]));
  memo[kind] = { sig, players, blocks: [...blocks], by };
  return by;
}

// The opponent cell and the vs-usual cell for one man. payload: the /api/teams body; cells: weekAllowedCells.
function weekCells(r, club, kind, payload, cells) {
  const entry = (payload.teams || []).find((t) => t.abbr === club);
  const g = entry ? nextGame(entry, payload.currentWeek) : null;
  r.wkOpp = null; r.wkVs = null; r.wkOppHtml = ""; r.wkVsHtml = "";
  if (!g) return;
  if (g.kind === "bye") { r.wkOppHtml = `<span class="an-wk-game" title="${esc(`${club} is on its bye this week`)}">Bye</span>`; return; }
  const tip = `${g.home ? "Home" : "Away"} against ${g.opp}${g.week ? `, week ${g.week}` : ""}${g.kickText ? ` · ${g.kickText}` : ""}${g.otherWeek ? " (not this week's slate)" : ""}`;
  r.wkOpp = g.opp;
  r.wkOppHtml = `<span class="an-wk-game" title="${esc(tip)}">${g.home ? "vs" : "@"} ${esc(g.opp)}</span>`;
  const grp = kind === "qb" ? "QB" : posGroup(r.pos) || (kind === "rb" ? "RB" : "WR");
  const m = vsUsualFor(cells, g.opp, grp);
  if (!m) return;
  r.wkVs = isNum(m.figs?.[0]?.v) ? +m.figs[0].v : null;
  r.wkVsHtml = vsUsualCell(m, { vsText: VS_USUAL_TEXT });
}

// Adds the Deciding figures to the aggregated rows in place and returns them. ctx: { blocks, players, st (the page's
// state), payload (the /api/teams body or null) }.
export function decorateDeciding(rows, kind, { blocks, players, st, payload = null }) {
  const by = last3Rows(kind, blocks, players, st);
  // A back with no carry in the last 3 has no Running backs row there but still has snaps and targets: the receivers' aggregation has him.
  const use = kind === "rb" ? last3Rows("rec", blocks, players, st) : null;
  const live = payload && isNum(payload.season) && +payload.season === +st.season ? payload : null;
  const cells = live ? weekAllowedCells(seasonBlocks(blocks, st.season), players, weekState(st)) : null;
  for (const r of rows) {
    const x = by.get(r.gsis) || null, u = use?.get(r.gsis) || null;
    r.gL3 = (x || u)?.g ?? null; // the games he played of his club's last 3, for the hover
    if (kind === "qb") {
      r.dbG = r.g > 0 ? r.db / r.g : null;
      r.dbGL3 = x && x.g > 0 ? x.db / x.g : null;
    } else {
      r.snapL3 = (x || u)?.snapPct ?? null;
      r.tgtL3 = (x || u)?.tgtShare ?? null;
      if (kind === "rec") r.routeL3 = x?.routePct ?? null; else r.rushL3 = x?.rushShare ?? null;
    }
    // His club now: the team of his last game in the last 3 (a range window that ends before a trade still shows the new club's opponent).
    if (live) weekCells(r, (x || u)?.team || r.team, kind, live, cells); else { r.wkOpp = null; r.wkVs = null; r.wkOppHtml = ""; r.wkVsHtml = ""; }
  }
  return rows;
}
