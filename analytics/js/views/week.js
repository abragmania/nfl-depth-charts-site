// The This-week matchup page (#/week/AWAY/HOME; a bare #/week opens the next game to kick off), D224 increment C
// (ANALYTICS.md "The decision surface, D224"). One screen per game, current season only, season to date; no filter
// bar: the week's games strip on top switches games (each chip's kickoff row lands here, the chip itself still opens
// the depth chart's Matchup page). Top to bottom:
//   (1) kickoff, the line, the total and each club's implied points (agg_week.js gameOdds on the published /api/teams
//       game: the odds memory the games strip reads);
//   (2) two halves, each offence against the other side's defence: the offence's Play calling and O-line blocks beside
//       the defence's D-line block and coverage tiles - the club pages' own builders (team.js playCallingHtml and
//       olineBlockHtml, team_def.js dlineBlockHtml and coverageTilesHtml) fed the same aggregateTeams figures, so the
//       ranks and colours are the club pages';
//   (3) at the top of each half the offence's skill starters as charted (agg_week.js skillStarters on api/team/<CLUB>.json)
//       plus any 15%+ target man, each with his usage line (the club page's Target and Carry Share rows: agg_team.js
//       teamTargets/teamCarries, whose red-zone shares are agg_player.js rzI5Shares'), his last-3 arrows (agg_week.js
//       trendMarks on trendFigures or qbTrend, hidden under four games) and that defence's vs-usual figure for his
//       position (agg_week.js weekAllowedCells + vsUsualFor, drawn by kit.js vsUsualCell: the strip's own figure and
//       hover). An out starter is red with his fill-in beneath him.
// Every figure is computed elsewhere; this file loads, picks and draws.
import { backLink } from "../router.js";
import { fromQuery, toQuery, weekLabel } from "../filters.js";
import { loadFor, loadTeams, loadStatusFeed, loadTeamView } from "../data.js";
import { aggregateTeams, teamReference, teamTargets, teamCarries } from "../agg_team.js";
import { gridRows } from "../agg_grid.js";
import { trendFigures } from "../agg_player.js";
import { qbTrend } from "../agg_qb.js";
import { posGroup } from "../agg_allowed.js";
import { weekState, seasonBlocks, weekAllowedCells, vsUsualFor, trendMarks, VS_USUAL_TEXT, gameOdds, skillStarters, resolveWeekRoute } from "../agg_week.js";
import { gamesBarHtml, wireGamesToggle, fmtKickoffET } from "../../../js/gamesbar.js";
import { esc, isNum, pct, teamPill, pfrNote } from "./qb.js";
import { shareSample, shareCountHtml } from "../table.js";
import { teamPageState, playCallingHtml, olineBlockHtml, olineStripHtml } from "./team.js";
import { dlineBlockHtml, coverageTilesHtml, dlineStripHtml, coverageStripHtml } from "./team_def.js";
import { vsUsualCell, statusChip, statusNameClass, fmtVsUsual, WEEK_TREND_LABELS } from "./kit.js";

const DASH = "–";
// The games strip from inside the analytics app: a chip opens the depth chart's Matchup page one folder up, its
// kickoff row this page.
export const WEEK_LINKS = Object.freeze({
  matchup: (a, h) => `../#/matchup/${encodeURIComponent(a)}/${encodeURIComponent(h)}`,
  week: (a, h) => `#/week/${encodeURIComponent(a)}/${encodeURIComponent(h)}`,
});
const halfPts = (v) => (isNum(v) ? (Number.isInteger(+v) ? String(+v) : (+v).toFixed(1)) : DASH);

// (1) The game block: kickoff, line, total, implied points. PURE.
export function gameBlockHtml(g, teams) {
  const o = gameOdds(g);
  const name = (a) => teams.get(a)?.name || a;
  const spread = o.pick ? "Pick'em" : o.fav && isNum(o.line) ? `${o.fav} −${halfPts(o.line)}` : DASH;
  const tile = (label, value, title, extra = "") => `<div class="an-tile${extra}"${title ? ` title="${esc(title)}"` : ""}><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  const imp = (a) => tile(`${a} implied`, halfPts(o.pts[a]), isNum(o.pts[a])
    ? `${name(a)}'s implied points: ${a === o.fav ? "(total + spread) / 2" : o.pick ? "total / 2 (a pick'em)" : "(total − spread) / 2"}, rounded to the nearest half point`
    : "No line yet: implied points need both the spread and the total");
  const where = [g.venue?.name, g.neutral ? "neutral site" : ""].filter(Boolean).join(" · ");
  return `<div class="an-wv-game">${[
    tile("Kickoff", fmtKickoffET(g.kickoff) || DASH, where),
    tile("Spread", spread, o.fav || o.pick ? "DraftKings via ESPN, the last line before kickoff (the odds memory)" : "No line yet"),
    tile("Total", isNum(o.total) ? halfPts(o.total) : DASH, isNum(o.total) ? "Over/under, DraftKings via ESPN" : "No total yet"),
    imp(g.away), imp(g.home),
  ].join("")}</div>`;
}

// The last-3 cell: trendMarks' marks as the strip prints them (label, arrow, signed change), or a dash with the
// reason when the arrows are hidden (under four games). PURE.
export function trendCell(marks) {
  if (!marks) return `<td class="an-wv-tr">${DASH}</td>`;
  if (marks.hidden) return `<td class="an-wv-tr" title="${esc(`Last 3 vs season shows from four games played; he has ${marks.games}`)}">${DASH}</td>`;
  const items = marks.marks.map((x) => {
    const dir = x.delta > 0.05 ? "up" : x.delta < -0.05 ? "down" : "";
    const lab = WEEK_TREND_LABELS[x.k] || x.k;
    const fmt = (v) => (!Number.isFinite(v) ? DASH : x.unit === "pts" ? `${(v * 100).toFixed(1)}%` : v.toFixed(1));
    const tip = `${lab}: last 3 ${fmt(x.last3)} over ${x.n3} game${x.n3 === 1 ? "" : "s"}, season ${fmt(x.season)} over ${x.n} (${x.unit === "pts" ? "percentage points" : "per game"}); above or below only, never good or bad`;
    return `<span class="an-wk-tr" title="${esc(tip)}"><span class="an-wk-lab">${esc(lab)}</span> ${dir ? `<i class="an-wk-arrow">${dir === "up" ? "▲" : "▼"}</i> ` : ""}${fmtVsUsual(x.delta, 1)}</span>`;
  });
  return `<td class="an-wv-tr">${items.join("") || DASH}</td>`;
}

// (3) One side's starters table. rows: [{ slot, kind, man, fill, extra, usage: { snapPct, routePct, tgtShare,
// rushShare, rz: { k, r } | null, qb: { dbG, carG, rzDbG } | null }, marks, matchup }] (fill rows carry the same
// shape). def: the defence's abbreviation. q: the filter query the player links carry. PURE.
export function startersHtml(rows, { def = "", q = "" } = {}) {
  const P = (v, d = 0) => (isNum(v) ? `${(v * 100).toFixed(d)}%` : DASH);
  const link = (m) => `<a class="${statusNameClass(m.status)}" href="#/player/${encodeURIComponent(m.gsis)}${q ? "?" + q : ""}">${esc(m.name)}</a>${m.status?.code ? statusChip(m.status) : ""}`;
  const rzCell = (rz) => {
    if (!rz) return `<td class="num">${DASH}</td>`;
    const s = shareSample(rz.k, rz.r, {});
    const v = rz.r[rz.k];
    const txt = isNum(v) ? `${pct(v, 0)}%` : DASH; // whole percent, as the club page's share columns print it
    const what = rz.k === "i5Share" ? "Inside-the-5 carry share" : "Red-zone target share";
    return `<td class="num"${s.title ? ` title="${esc(`${what}: ${s.title}`)}"` : ""}>${txt}${shareCountHtml(s.count)}</td>`;
  };
  const line = (x, fill) => {
    const u = x.usage || {};
    const usage = u.qb
      ? `<td class="num">${P(u.snapPct)}</td><td class="an-wv-qbline" colspan="4">${[["dropbacks/g", u.qb.dbG], ["carries/g", u.qb.carG], ["red-zone dropbacks/g", u.qb.rzDbG]].map(([l, v]) => `<b>${isNum(v) ? (+v).toFixed(1) : DASH}</b> ${l}`).join(" · ")}</td>`
      : `<td class="num">${P(u.snapPct)}</td><td class="num">${P(u.routePct)}</td><td class="num">${P(u.tgtShare, 1)}</td><td class="num">${P(u.rushShare, 1)}</td>${rzCell(u.rz)}`;
    const slot = fill ? `<span class="an-wv-fill" title="Filling in for the out starter above">↳</span>` : esc(x.slot);
    return `<tr class="${fill ? "an-wv-fillrow" : ""}${x.extra ? " an-wv-extra" : ""}"><td class="an-wv-slot"${x.extra ? ` title="${esc(`Not a charted starter: ${isNum(x.clubShare) ? `${(x.clubShare * 100).toFixed(1)}%` : "15% or more"} of every target the club threw this season (15% or more adds him)`)}"` : ""}>${slot}</td><td class="an-wv-name">${link(x.man)}</td>${usage}${trendCell(x.marks)}<td class="an-wv-vs">${vsUsualCell(x.matchup, { vsText: VS_USUAL_TEXT })}</td></tr>`;
  };
  const body = rows.map((x) => line(x, false) + (x.fill ? line({ ...x.fill, slot: x.slot }, true) : "")).join("");
  const th = (h, t, cls = "num") => `<th class="${cls}" title="${esc(t)}">${h}</th>`;
  return `<table class="an-wv-table"><thead><tr>${th("", "Depth-chart slot", "an-wv-slot")}${th("Player", "As the depth chart lists him; red = will not play, his fill-in beneath him", "")}`
    + th("Snap %", "The mean of his weekly offensive snap % this season")
    + th("Route %", "Routes / club dropbacks in his games (heatradar, charted weeks)")
    + th("Tgt %", "His targets / the club's pass attempts in his games")
    + th("Car %", "His designed runs / the club's designed runs in his games")
    + th("RZ", "Red-zone target share (receivers) or inside-the-5 carry share (backs), with his count of the club's plays in his games; a dash under 3 such plays")
    + th("Last 3", "His last 3 games played against all his games this season (shows from four games)", "an-wv-tr")
    + th(`vs ${esc(def)}`, `What ${def} gives up to his position against what the same offenses' men usually get, DK points per game first (the allowed table's vs usual)`, "an-wv-vs")
    + `</tr></thead><tbody>${body}</tbody></table>`;
}

// The figures for every row of one side (PURE over the loaded data). blocks: the current season's blocks only.
export function sideRows({ view, club, def, blocks: allBlocks, players, ws, feed, cells }) {
  const blocks = seasonBlocks(allBlocks, ws.season); // the current season only, whatever the caller loaded
  const tg = teamTargets(blocks, players, { ...ws, pos: {} }, club);
  const cr = teamCarries(blocks, players, { ...ws, pos: {} }, club);
  const T = new Map(tg.map((r) => [r.gsis, r])), C = new Map(cr.map((r) => [r.gsis, r]));
  const starters = skillStarters(view, { targets: tg, feed });
  const fill = (x, kind, band) => {
    const g = x.man.gsis, t = T.get(g), c = C.get(g);
    const grp = kind === "qb" ? "QB" : posGroup(players?.[g]?.pos) || (kind === "back" ? "RB" : band === "TE" ? "TE" : "WR");
    let usage, trend;
    if (kind === "qb") {
      trend = qbTrend(blocks, players, ws, g);
      const f = (k) => trend.figures?.[k]?.season ?? null;
      usage = { snapPct: f("snapPct"), qb: { dbG: f("dbG"), carG: f("carG"), rzDbG: f("rzDbG") } };
    } else {
      const back = kind === "back";
      trend = trendFigures(blocks, players, ws, g, back);
      usage = { snapPct: (back ? c?.snapPct : t?.snapPct) ?? t?.snapPct ?? c?.snapPct ?? null, routePct: t?.routePct ?? null, tgtShare: t?.tgtShare ?? null, rushShare: c?.rushShare ?? null,
        rz: back ? (c ? { k: "i5Share", r: c } : null) : (t ? { k: "rzTgtShare", r: t } : null) };
    }
    return { ...x, kind, usage, marks: trendMarks(trend, kind), matchup: vsUsualFor(cells, def, grp) };
  };
  return starters.map((x) => ({ ...fill(x, x.kind, x.band), fill: x.fill ? fill({ ...x, man: x.fill, fill: null }, x.kind, x.band) : null }));
}

// The club figures (aggregateTeams over the whole league, its reference and Grid rows) do not depend on the game, so a
// switch between games reuses them: memoized on the blocks (element by element: seasonBlocks returns a new array each
// time), the players map and the switches that change them (agg_week.js weekAllowedCells' rule).
let teamMemo = null;
export function weekTeamFigures(blocks, players, ws) {
  const sig = `${ws.season}|${ws.window}|${ws.with2025}|${ws.po}|${ws.pi}`;
  const m = teamMemo;
  if (m && m.sig === sig && m.players === players && m.blocks.length === blocks.length && m.blocks.every((b, i) => b === blocks[i])) return m.out;
  const agg = aggregateTeams(blocks, players, teamPageState(ws));
  const out = { agg, ref: teamReference(agg.rows), grid: gridRows(agg) };
  teamMemo = { sig, players, blocks: [...blocks], out };
  return out;
}

// ---- #/week and #/week/:away/:home ---------------------------------------------------------------------------------
export async function renderWeek(ctx, params, query) {
  const { root, isCurrent } = ctx;
  const st = fromQuery(query);
  // 🔵: in-page links carry the page's own state (current season to date, the PI switch), never the reader's window,
  // team or include-previous; the reader's query is kept only for the Back fallback and the bare-address redirect.
  const readerQs = toQuery({ ...st, open: "" });
  const ws = weekState(st);
  const qs = toQuery({ ...ws, open: "" });
  if (!root.querySelector(".an-wv")) root.innerHTML = `<div class="an-msg">Loading this week…</div>`;
  let payload;
  try { payload = await loadTeams(); } catch (e) {
    if (isCurrent()) root.innerHTML = `<div class="an-msg an-msg-err">Could not load this week's games: ${esc(e.message)}</div>`;
    return;
  }
  if (!isCurrent()) return;
  const games = payload.games || [];
  const teams = new Map((payload.teams || []).map((t) => [t.abbr, t]));
  const r = resolveWeekRoute({ away: params.away, home: params.home, games, teams: payload.teams || [], season: st.season, payloadSeason: payload.season, currentWeek: payload.currentWeek });
  if (r.kind === "empty") { root.innerHTML = `<div class="an-msg">No games on this week's schedule.</div>`; return; }
  if (r.kind === "redirect") { location.replace(`#/week/${encodeURIComponent(r.away)}/${encodeURIComponent(r.home)}${readerQs ? "?" + readerQs : ""}`); return; }
  const { away, home } = r, game = r.game || null;
  // The depth-chart pages' own strip (gamesbar.js gamesBarHtml, its fold and links), this page's links passed in.
  const strip = gamesBarHtml([...teams.values()], games, [away, home], WEEK_LINKS);
  const pill = (a) => (teams.has(a) ? teamPill(a, teams, qs, "an-pl-pill an-tm-headpill") : esc(a));
  const head = `<div class="an-pl-head">${backLink(`#/grid${readerQs ? "?" + readerQs : ""}`, "Grid")}${pill(away)}<h1>${esc(teams.get(away)?.name || away)} at ${esc(teams.get(home)?.name || home)}</h1>${pill(home)}
    <div class="an-pl-links"><a href="../#/matchup/${encodeURIComponent(away)}/${encodeURIComponent(home)}">Depth-chart matchup →</a></div></div>`;
  document.title = `${away} at ${home} · This week · NFL Analytics`;
  const shell = (body) => `<section class="an-pl an-wv">${head}${strip}${body}</section>`;
  if (r.kind === "prior") {
    root.innerHTML = shell(`<div class="an-note an-wv-note">This week's page reads the current season only (${esc(payload.season)}). <a href="#/week/${encodeURIComponent(away)}/${encodeURIComponent(home)}">Open it for ${esc(payload.season)}</a></div>`);
    wireGamesToggle(root);
    return;
  }
  if (r.kind === "bye" || r.kind === "none") {
    const msg = r.kind === "bye" ? `${r.byes.map(esc).join(" and ")} ${r.byes.length > 1 ? "are" : "is"} on bye this week.` : `${esc(away)} and ${esc(home)} do not meet this week.`;
    root.innerHTML = shell(`<div class="an-note an-wv-note">${msg} Pick a game above.</div>`);
    wireGamesToggle(root);
    return;
  }
  let data, views, feed;
  try {
    [data, views, feed] = await Promise.all([
      loadFor([+st.season], ws),
      Promise.all([away, home].map((a) => loadTeamView(a).catch(() => null))),
      loadStatusFeed(),
    ]);
  } catch (e) {
    if (!isCurrent()) return;
    const notBuilt = e.status === 404 || e.status === 503;
    root.innerHTML = shell(notBuilt ? `<div class="an-msg">The ${esc(st.season)} analytics files have not been compiled yet.</div>` : `<div class="an-msg an-msg-err">Could not load the analytics data: ${esc(e.message)}</div>`);
    wireGamesToggle(root);
    return;
  }
  if (!isCurrent()) return;
  const blocks = seasonBlocks(data.blocks, st.season);
  const { agg, ref, grid } = weekTeamFigures(blocks, data.players, ws);
  const pnote = pfrNote(agg.pfrThrough, agg.latestKey, st.season);
  const cells = weekAllowedCells(blocks, data.players, ws);
  const lgOff = ref.lg.off, lgDef = ref.lg.def;
  const half = (off, def, view) => {
    const rOff = agg.rows.find((r) => r.team === off), rDef = agg.rows.find((r) => r.team === def);
    const O = rOff?.off || {}, D = rDef?.def || {};
    // D224 increment G: the blocks' per-game strips, season to date; a bar click opens that club's own page with that
    // game alone (data-href, wired below), since this page has no window of its own.
    const offHref = `#/team/${encodeURIComponent(off)}`, defHref = `#/team/${encodeURIComponent(def)}/defense`;
    const sArgs = { season: st.season, wn: "Season", pfrThrough: agg.pfrThrough };
    const olStrip = olineStripHtml({ ...sArgs, series: rOff?.series.off || [], O, L: lgOff, cuts: ref.cuts, href: offHref });
    const dlStrip = dlineStripHtml({ ...sArgs, series: rDef?.series.def || [], D, L: lgDef, cuts: ref.cuts, href: defHref });
    const covStrip = coverageStripHtml({ ...sArgs, series: rDef?.series.def || [], D, L: lgDef, cuts: ref.cuts, href: defHref });
    const gOff = grid.find((r) => r.team === off), gDef = grid.find((r) => r.team === def);
    const rows = view ? sideRows({ view, club: off, def, blocks, players: data.players, ws, feed, cells }) : null;
    const cov = `<div class="an-card an-line an-wv-cov"><div class="an-dh">Coverage <span class="an-dsub">PFR coverage charting, ${esc(def)}'s cornerbacks and safeties</span></div>${coverageTilesHtml({ D, L: lgDef, cuts: ref.cuts, qs })}${covStrip}</div>`;
    return `<div class="an-wv-half">
      <div class="an-wv-hh"><span class="an-wv-side">${pill(off)} offense</span><span class="an-wv-against">against</span><span class="an-wv-side">${pill(def)} defense</span></div>
      <div class="an-card an-wv-starters"><div class="an-dh">${esc(off)} skill starters <span class="an-dsub">as charted, plus anyone with 15%+ of every target the club threw this season · beside each, what ${esc(def)} gives up to his position against the usual</span></div>
        ${rows ? startersHtml(rows, { def, q: qs }) : `<div class="an-note">${esc(off)}'s depth chart could not be loaded.</div>`}</div>
      <div class="an-wv-cols">
        <div class="an-wv-col">${playCallingHtml({ O, L: lgOff, rows: agg.rows, abbr: off, qs, foot: false })}<div class="an-wv-ol">${olineBlockHtml({ O, L: lgOff, rows: agg.rows, abbr: off, qs, cuts: ref.cuts, gridRow: gOff, pnote, strip: olStrip })}</div></div>
        <div class="an-wv-col"><div class="an-wv-dl">${dlineBlockHtml({ D, L: lgDef, rows: agg.rows, abbr: def, qs, cuts: ref.cuts, gridRow: gDef, pnote, strip: dlStrip })}</div>${cov}</div>
      </div>
    </div>`;
  };
  const through = agg.weeks.length ? `through ${weekLabel(agg.weeks[agg.weeks.length - 1], st.season)}` : "no games yet";
  root.innerHTML = shell(`<div class="an-sub an-pl-sub">${esc(st.season)} season to date, ${esc(through)} · ranks and colours among the 32 clubs, as on the club pages${pnote ? " · " + esc(pnote) : ""}</div>
    ${gameBlockHtml(game, teams)}
    ${half(away, home, views[0])}
    ${half(home, away, views[1])}
    <p class="an-foot">Line and total: DraftKings via ESPN, the last line before kickoff. Club figures: nflverse play-by-play, FTN charting, PFR advanced stats (about a week behind), the same figures the club pages show. Starters and statuses: the depth chart. Shares: nflverse play-by-play; routes heatradar.app; snaps nflverse snap counts. vs usual: the Grid page's allowed table.</p>`);
  wireGamesToggle(root);
  wireLineStrips(root, ws);
}

// D224 increment G: a bar in a line block's per-game strip opens the club page it belongs to with that game alone, the
// address the club page's own isolate click writes (window=range, from = to = the game's week key).
export function lineStripGameHref(base, ws, key) {
  const q = toQuery({ ...ws, window: "range", from: key, to: key, open: "" });
  return `${base}${q ? "?" + q : ""}`;
}
function wireLineStrips(root, ws) {
  root.querySelectorAll(".an-line-strip[data-href] .an-wb-hit[data-key]").forEach((h) => h.addEventListener("click", () => {
    location.hash = lineStripGameHref(h.closest(".an-line-strip").dataset.href, ws, h.dataset.key);
  }));
}
