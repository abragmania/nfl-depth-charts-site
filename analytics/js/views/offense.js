// Offense: the team OFFENSE leaderboard (#/offense, D198). Adam, 2026-09-26: "Teams should load that big teams
// list, Offense should load something that looks like the defense grid... as is Offense is showing what Teams
// should show." This file is a COPY of defense.js's table shell (Overall / Passing / Rushing groups, the EPA/play
// bar, expanded rows) rather than a generalisation of it: defense.js's own test imports it wholesale and the
// Defense page must stay byte-identical, so nothing there was touched to build this. Every figure comes from
// agg_team.js (pure), the same club rows defense.js reads, read on the OFFENSE side instead of the defense side.
//
// The root <section> carries "an-def an-pl an-off": an-pl for the page spacing every analytics page shares, an-off
// so a rule can address this page alone.
import { fromQuery, toQuery, seasonsOf, weekLabel } from "../filters.js";
import { loadFor, loadTeams } from "../data.js";
import { aggregateTeams, teamReference, teamTier, teamZones, sortTeamRows, OFF_TIER, SOFT_KEYS, RANK_LOW_FIRST } from "../agg_team.js";
import { TIER_NAMES } from "../agg.js";
import { renderFilterBar } from "../filterbar.js";
import { esc, NA, isNum, pct, fix, signed, teamPill, qbStrips, pfrNote, seasonLabel } from "./qb.js";
import { windowName } from "./qbplayer.js";
import { moreFrom, visibleCols, allOpen, toggleMore, moreCell, fitOpen, wireMore } from "../table.js";
import { nameOf, headerOf } from "../names.js";
import { teamPageState, clubZoneField, clubZoneLegend, zonePlaysHtml, TEAM_ZONE_MODES } from "./team.js";

const P = (v, d = 1) => (isNum(v) ? pct(v, d) : NA);
// The headline "how good are they" measure, EPA/play, leads the table with a bar (signed, centred on zero); the
// rest split into passing and rushing. Higher is better throughout offense, the mirror of defense.js's "allowed".
const EPA_BAR_SPAN = 0.4;
export const OFF_COLS = [
  { k: "epaPlay", h: headerOf("epaPlay"), t: "EPA per play (higher is better)", f: (v) => signed(v, 3), grp: "ov", bar: EPA_BAR_SPAN, signed: true },
  { k: "succPct", h: headerOf("succPct"), t: "Share of plays that were successful (higher is better)", f: (v) => P(v, 1), grp: "ov" },
  { k: "explPct", h: headerOf("explPct"), t: "Explosive plays: runs of 10+ yards and completions of 20+ / plays (higher is better)", f: (v) => P(v, 1), grp: "ov" },
  { k: "playsG", h: headerOf("playsG"), t: "Plays per game: pass attempts, sacks, scrambles and designed runs", f: (v) => fix(v, 1), grp: "ov" },
  { k: "passRate", h: headerOf("passRate"), t: "Dropbacks / plays, all situations (the neutral-script figure is Neutral PROE, under Passing)", f: (v) => P(v, 1), grp: "ov" },
  { k: "epaDb", h: headerOf("epaDb"), t: "EPA per dropback (sacks and scrambles included; higher is better)", f: (v) => signed(v, 3), grp: "pd" },
  { k: "cmpPct", h: headerOf("cmpPct"), t: "Completion % (higher is better)", f: (v) => P(v, 1), grp: "pd" },
  { k: "adot", h: headerOf("adot"), t: "Air yards per attempt", f: (v) => fix(v, 1), grp: "pd" },
  { k: "sackPct", h: headerOf("sackPct"), t: "Sacks / dropbacks (lower is better)", f: (v) => P(v, 1), grp: "pd" },
  { k: "pressPct", h: headerOf("pressPct"), t: "PFR: the club's quarterbacks' pressured dropbacks / their dropbacks, about a week behind (lower is better)", f: (v) => P(v, 1), grp: "pd" },
  { k: "paPct", h: headerOf("paPct"), t: "FTN: play-action dropbacks / dropbacks charted", f: (v) => P(v, 0), grp: "pd" },
  // D219 figure 1: pass rate over expectation, in percentage points; style, not quality, so uncoloured (not in OFF_TIER).
  { k: "proe", h: "PROE", t: "Pass rate over expectation: the dropback rate minus the expected pass rate (nflverse xpass) on the same plays, in percentage points, over the plays with an expectation. Style, not quality: not coloured. 1st = most pass-happy over expectation.", f: (v) => signed(v, 1), grp: "pd" },
  { k: "proeNeutral", h: "Neutral PROE", t: "Pass rate over expectation in neutral script (score within 7, quarters 1-3): the dropback rate minus the expected pass rate (nflverse xpass) on the same plays, in percentage points. Style, not quality: not coloured. 1st = most pass-happy over expectation.", f: (v) => signed(v, 1), grp: "pd" },
  { k: "epaCar", h: headerOf("epaCar"), t: "EPA per designed run (higher is better)", f: (v) => signed(v, 3), grp: "rd" },
  { k: "ypc", h: headerOf("ypc"), t: "Yards per designed run (higher is better)", f: (v) => fix(v, 1), grp: "rd" },
  { k: "rushYdsG", h: headerOf("rushYdsG", { inGroup: true }), t: "Rushing yards per game (designed runs)", f: (v) => fix(v, 1), grp: "rd" },
  { k: "stuffPct", h: headerOf("stuffPct"), t: "Designed runs gaining 0 or less / designed runs (lower is better)", f: (v) => P(v, 1), grp: "rd" },
  { k: "ybcCar", h: headerOf("ybcCar"), t: "PFR: yards before contact per carry (higher is better)", f: (v) => fix(v, 1), grp: "rd" },
  // D219 figure 7: a Drives group on the end (nothing before it moves), tiered higher-is-better (OFF_TIER).
  { k: "ptsDrive", h: headerOf("ptsDrive"), t: "Points per drive: the points the offense actually scored on its own snaps (a touchdown 6 plus the try, a field goal 3) / its drives, kneel-only drives left out (higher is better)", f: (v) => fix(v, 2), grp: "dr" },
  { k: "rzTdPct", h: headerOf("rzTdPct"), t: "Red-zone touchdown rate: drives that reached the opponent's 20 and ended in a touchdown / drives that reached it (a field goal is a trip, not a touchdown; higher is better)", f: (v) => P(v, 1), grp: "dr" },
  { k: "thirdPct", h: headerOf("thirdPct"), t: "Third-down conversion: third-down plays that gained a first down or scored / third-down plays, pass-interference plays left out; a first down a foul gave counts; reads a little under NFL.com's because penalty no-plays are not in the rows (higher is better)", f: (v) => P(v, 1), grp: "dr" },
  // D219 figures 2 and 3: a Pace group on the end (nothing before it moves); style, not quality, so uncoloured (not in
  // OFF_TIER). Seconds per play sorts fastest first (RANK_LOW_FIRST), the rest most first.
  { k: "neutralSecs", h: headerOf("neutralSecs"), t: "Seconds per play in neutral script (score within 7, quarters 1-3): the mean time from a snap to the offense's next snap in the same drive. Pace, not quality: not coloured. Fastest first.", f: (v) => fix(v, 1), grp: "pc" },
  { k: "noHuddlePct", h: "No-huddle %", t: "No-huddle plays / plays, the play-by-play's flag. Style, not quality: not coloured.", f: (v) => P(v, 1), grp: "pc" },
  { k: "shotgunPct", h: "Shotgun %", t: "Shotgun plays / plays, the play-by-play's flag with pistol counted as shotgun (FTN's charting disagrees on a small share; the audit logs them). Style, not quality: not coloured.", f: (v) => P(v, 1), grp: "pc" },
  { k: "motionPct", h: "Motion %", t: "FTN: plays with pre-snap motion / plays charted. Style, not quality: not coloured.", f: (v) => P(v, 1), grp: "pc" },
];
const GROUPS = [["ov", "Overall"], ["pd", "Passing"], ["rd", "Rushing"], ["dr", "Drives"], ["pc", "Pace"]];
OFF_COLS.forEach((c, i) => { c.gs = i === 0 || OFF_COLS[i - 1].grp !== c.grp; });
// D219 increment E fix: the Drives and Pace groups are ANCILLARY, hidden behind the Running backs table's More ▸ /
// ◂ Less toggle (table.js openGroups/visibleCols/toggleMore, keyed on a truthy `anc`), so the default table fits a
// 1536 window with no sideways scroll. A sort on one of their columns (a club tile's Rankings link) opens that group;
// more=1 opens both. Their cells keep their own tier colours (unlike the RB table's ancillary columns).
const ANC_GROUPS = new Set(["dr", "pc"]);
OFF_COLS.forEach((c) => { c.anc = ANC_GROUPS.has(c.grp) ? c.grp : ""; });
const DEFAULT_SORT = "epaPlay";
const SORTABLE = new Set([...OFF_COLS.map((c) => c.k), "team", "g"]);
// First click on a column sorts best-first: descending where higher is better (offense's default direction).
export const bestDir = (k) => (OFF_TIER[k] === -1 || k === "team" || (!OFF_TIER[k] && RANK_LOW_FIRST.has(k)) ? "asc" : "desc");
export const offSort = (query, st) => {
  const has = new URLSearchParams(String(query || "").replace(/^\?/, "")).has("sort");
  return has && SORTABLE.has(st.sort) ? { sort: st.sort, dir: st.dir } : { sort: "epaPlay", dir: "desc" };
};

// Weekly EPA/play as a tiny bar strip for the table (green above zero, red below: an offense wants EPA/play up).
function offSpark(series) {
  const W = 92, H = 22, n = series.length, bw = n ? Math.max(2, Math.min(9, (W - 2) / n - 2)) : 0;
  const mid = H / 2, span = 0.5;
  return `<svg class="an-def-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="EPA per play by week"><line x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>`
    + series.map((s, i) => {
      const x = 1 + i * (bw + 2);
      const lab = `${weekLabel(s.key)}${s.opp ? ` vs ${s.opp}` : ""}: ${isNum(s.epaPlay) ? signed(s.epaPlay, 3) + " EPA/play" : "bye"}`;
      if (!isNum(s.epaPlay)) return `<rect x="${x}" y="0" width="${bw}" height="${H}" fill="transparent"><title>${esc(lab)}</title></rect>`;
      const h = Math.max(1, Math.min(1, Math.abs(s.epaPlay) / span) * (mid - 1));
      return `<rect class="${s.epaPlay > 0 ? "good" : "bad"}" x="${x}" y="${(s.epaPlay > 0 ? mid - h : mid).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="1"><title>${esc(lab)}</title></rect>`;
    }).join("") + `</svg>`;
}

const ui = { zoneMode: "cmpPct", zone: null, team: null };

function zoneBlock(zones, st, players, q) {
  // No "an-zf-inv" wrapper (defense.js's colour-swap class): offense reads plain, the same as team.js's own field.
  return `<div class="an-pl-zhead"><div class="an-seg" data-zmode>${TEAM_ZONE_MODES.map((m) => `<button type="button" data-v="${m.k}" class="${ui.zoneMode === m.k ? "on" : ""}">${m.label}</button>`).join("")}</div>${clubZoneLegend(ui.zoneMode, "off")}</div>
    <div class="an-pl-zbody">${clubZoneField(zones, ui.zoneMode, { selected: ui.zone, small: true }, "off")}${ui.zone ? `<div class="an-pl-plays an-def-plays">${zonePlaysHtml(zones, ui.zone, st, players, q, "off")}</div>` : ""}</div>`;
}

function detailHtml(r, st, q, ref, wn, lgZones, players) {
  const O = r.off, L = ref.lg.off;
  const maxDb = Math.max(45, ...r.series.off.map((s) => s.db || 0));
  const maxRuns = Math.max(25, ...r.series.off.map((s) => s.runs || 0));
  const strips = [
    { k: "epaPlay", label: nameOf("epaPlay"), signed: true, span: 0.4, fmt: (v) => signed(v, 3), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: O.epaPlay, totalText: `${wn} ${isNum(O.epaPlay) ? signed(O.epaPlay, 3) : "–"}`, avg: L.epaPlay, avgText: `lg ${isNum(L.epaPlay) ? signed(L.epaPlay, 3) : "–"}`, tier: (v) => teamTier("off", "epaPlay", v, ref.cuts) },
    { k: "epaDb", label: nameOf("epaDb"), signed: true, span: 0.6, fmt: (v) => signed(v, 3), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: O.epaDb, totalText: `${wn} ${isNum(O.epaDb) ? signed(O.epaDb, 3) : "–"}`, avg: L.epaDb, avgText: `lg ${isNum(L.epaDb) ? signed(L.epaDb, 3) : "–"}`, tier: (v) => teamTier("off", "epaDb", v, ref.cuts) },
    { k: "epaCar", label: nameOf("epaCar"), signed: true, span: 0.6, fmt: (v) => signed(v, 3), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: O.epaCar, totalText: `${wn} ${isNum(O.epaCar) ? signed(O.epaCar, 3) : "–"}`, avg: L.epaCar, avgText: `lg ${isNum(L.epaCar) ? signed(L.epaCar, 3) : "–"}`, tier: (v) => teamTier("off", "epaCar", v, ref.cuts) },
    { k: "db", label: "Dropbacks", signed: false, span: maxDb * 1.05, fmt: (v) => `${v} dropbacks`, short: (v) => String(v), total: O.db, totalText: `${wn} ${O.db}`, avg: L.dbG, avgText: `lg ${isNum(L.dbG) ? L.dbG.toFixed(1) : "–"}/g` },
    { k: "runs", label: "Runs", signed: false, span: maxRuns * 1.05, fmt: (v) => `${v} runs`, short: (v) => String(v), total: O.runs, totalText: `${wn} ${O.runs}`, avg: L.runsG, avgText: `lg ${isNum(L.runsG) ? L.runsG.toFixed(1) : "–"}/g` },
  ];
  const zones = teamZones(O, lgZones);
  const tile = (label, val, k, lg, title = "") => {
    const t = k ? teamTier("off", k, O[k], ref.cuts) : "";
    return `<div class="an-tile${t ? " t-" + t : ""}"${title ? ` title="${esc(title)}"` : ""}><span>${label}</span><b>${val}</b>${lg && !String(lg).includes("an-na") ? `<em> · lg ${lg}</em>` : ""}</div>`;
  };
  const PP = (v, d = 1) => (isNum(v) ? pct(v, d) + "%" : NA);
  return `<div class="an-detail-in an-def-din">
    <div class="an-dcol"><div class="an-dh">Week by week <span class="an-dsub">${O.plays} plays in ${O.g} game${O.g === 1 ? "" : "s"}</span></div>${qbStrips(r.series.off.map((s) => ({ ...s, dnp: false })), strips, { season: st.season, bw: 28, gap: 7, sh: 50, lw: 128, rw: 70 })}</div>
    <div class="an-dcol"><div class="an-dh">Zone field <span class="an-dsub">the offense's attempts vs the league</span></div>
      <div data-zones>${zoneBlock(zones, st, players, q)}</div></div>
    <div class="an-dcol an-def-rush">
      <div class="an-dblk"><div class="an-dh">Passing</div><div class="an-dtiles">
        ${tile(nameOf("sackPct"), PP(O.sackPct), "sackPct", PP(L.sackPct), "Sacks / dropbacks")}
        ${tile(nameOf("pressPct"), PP(O.pressPct), "pressPct", PP(L.pressPct), "PFR: the club's quarterbacks' pressures / their dropbacks (lower is better)")}
        ${tile(nameOf("paPct"), PP(O.paPct, 0), "", PP(L.paPct, 0), "FTN: play-action dropbacks / dropbacks charted")}
        ${tile(nameOf("adot"), isNum(O.adot) ? O.adot.toFixed(1) : NA, "", isNum(L.adot) ? L.adot.toFixed(1) : NA, "Air yards per attempt")}
        ${tile(nameOf("explPct"), PP(O.explPct), "explPct", PP(L.explPct), "Runs of 10+ and completions of 20+ / plays")}
      </div></div>
      <div class="an-dblk"><div class="an-dh">Rushing</div><div class="an-dtiles">
        ${tile(nameOf("epaCar"), signed(O.epaCar, 3), "epaCar", signed(L.epaCar, 3), "EPA per designed run")}
        ${tile(nameOf("ypc"), isNum(O.ypc) ? O.ypc.toFixed(1) : NA, "ypc", isNum(L.ypc) ? L.ypc.toFixed(1) : NA, "Yards per designed run")}
        ${tile(nameOf("runSuccPct"), PP(O.runSuccPct), "runSuccPct", PP(L.runSuccPct), "Share of designed runs that were successful")}
        ${tile(nameOf("runExplPct"), PP(O.runExplPct), "runExplPct", PP(L.runExplPct), "Designed runs of 10+ yards / designed runs")}
        ${tile(nameOf("stuffPct"), PP(O.stuffPct), "stuffPct", PP(L.stuffPct), "Designed runs gaining 0 or less / designed runs (lower is better)")}
      </div></div>
      <div class="an-dlinks"><a href="#/team/${encodeURIComponent(r.team)}${q ? "?" + q : ""}">Team page →</a><a href="#/team/${encodeURIComponent(r.team)}/defense${q ? "?" + q : ""}">Defense page →</a><a href="#/grid${q ? "?" + q : ""}">Grid →</a><a href="../#/team/${encodeURIComponent(r.team)}">Depth chart →</a></div>
    </div></div>`;
}

export const offAnchor = { id: null, top: null };

// PURE (no DOM): the table's markup. view: { ref, teams, windowName, lgZones, players, sort, dir, hl }. `hl`
// (D208, the Rankings page's hl= query key) is a club abbr whose row gets the "is-hl" class (styled in
// analytics.css) so a Grid cell or a club tile's Rankings link can point straight at one club's row.
export function offTableHtml(rows, st, query, view) {
  const { ref, sort, dir, hl } = view;
  const list = sortTeamRows(rows, "off", sort, dir);
  // The More toggle (table.js): Drives and Pace show only with more=1 (st.more) or when the sort is one of theirs.
  const mst = { ...st, sort }, cols = visibleCols(OFF_COLS, mst, DEFAULT_SORT);
  const q = query || "", nCols = 3 + cols.length + 1;
  const th = (k, h, t, cls = "") => `<th class="${cls}${sort === k ? " sorted " + dir : ""}" data-sort="${k}" title="${esc(t)}">${h}</th>`;
  // The toggle leads the group row over rank and club (moreCell spans two); a blank cell sits over G.
  const groupRow = `<tr class="an-grp">${moreCell(allOpen(OFF_COLS, mst, DEFAULT_SORT))}<th></th>${GROUPS.map(([g, l]) => [g, l, cols.filter((c) => c.grp === g).length]).filter((x) => x[2] > 0).map(([g, l, n]) => `<th colspan="${n}" class="g-${g} gs">${l}</th>`).join("")}<th></th></tr>`;
  const head = `<tr>${th("rank", "#", "Rank")}${th("team", "Offense", "Club", "c-name")}${th("g", "G", "Games in the window")}${cols.map((c) => th(c.k, c.h, c.t, "g-" + c.grp + (c.gs ? " gs" : ""))).join("")}<th class="c-spark" title="EPA per play by week: green above zero (good), red below">EPA/play by week</th></tr>`;
  const body = list.map((r, i) => {
    const open = st.open === r.team;
    const cells = cols.map((c) => {
      const v = r.off[c.k], t = teamTier("off", c.k, v, ref.cuts);
      let bar = "";
      if (c.bar && isNum(v)) {
        if (c.signed) {
          // Each half is inset 3px from its outer edge, same as every other .an-bar's left:3px/max-width:calc(100% - 6px);
          // the fraction of that inset half-width comes from the value's share of the span.
          const ratio = Math.min(1, Math.abs(v) / c.bar).toFixed(4);
          const w = `calc((50% - 3px) * ${ratio})`;
          const left = v >= 0 ? "50%" : `calc(50% - (50% - 3px) * ${ratio})`;
          bar = `<i class="an-bar an-bar-ctr" style="left:${left};width:${w}"></i>`;
        } else {
          bar = `<i class="an-bar" style="width:${Math.min(100, (v / c.bar) * 100).toFixed(1)}%"></i>`;
        }
      }
      return `<td class="num g-${c.grp}${c.gs ? " gs" : ""}${t ? " t-" + t + (SOFT_KEYS.includes(c.k) ? " t-soft" : "") : ""}${bar ? " has-bar" : ""}${c.signed ? " c-signed" : ""}">${bar}<span>${c.f(v)}</span></td>`;
    }).join("");
    return `<tr class="an-row${open ? " open" : ""}${r.team === hl ? " is-hl" : ""}" data-id="${esc(r.team)}" tabindex="0" aria-expanded="${open}">
      <td class="c-rank">${i + 1}</td>
      <td class="c-name">${teamPill(r.team, view.teams, q)}<span class="an-def-name">${esc(view.teams?.get(r.team)?.nickname || view.teams?.get(r.team)?.name || r.team)}</span></td>
      <td class="num">${r.g}</td>${cells}<td class="c-spark">${offSpark(r.series.off)}</td></tr>`
      + (open ? `<tr class="an-detail"><td colspan="${nCols}"><div class="an-detail-wrap">${detailHtml(r, st, q, ref, view.windowName, view.lgZones, view.players)}</div></td></tr>` : "");
  }).join("");
  return `<div class="an-tbar">
      <span class="an-count">${list.length} offense${list.length === 1 ? "" : "s"}</span>
      <span class="an-legend" title="Each value against every club's in this window: elite at the clubs' 90th percentile or better, then the 70th, 40th and 15th; low below. Higher is better for EPA, success, completion %, explosive plays, YPC, rushing yards, yards before contact, points per drive, red-zone TD % and third-down %; lower is better for sack %, pressure % and stuffed %. Plays/g is coloured muted (a lean, not a verdict); pass %, aDOT, PA % and pass rate over expectation (PROE, Neutral PROE) and the Pace columns (seconds per play, no-huddle, shotgun, motion) are not coloured.">
        ${TIER_NAMES.map((t) => `<i class="t-${t}"></i>`).join("")}<span>elite → low among the clubs</span></span>
      <span class="an-hint">Click a row to open the offense</span>
    </div>
    <div class="an-tscroll"><table class="an-table an-def-table"><thead>${groupRow}${head}</thead><tbody>${body || `<tr><td colspan="${nCols}" class="an-empty">No games in this window.</td></tr>`}</tbody></table></div>`;
}

// PURE: the #/offense address for state n, `hl` (D208's highlighted club, or "") carried along - fix round: every
// OTHER call this page's go() used to make (a sort, a row open, a filter change) wrote toQuery(n) alone, which has
// no notion of hl, so the first click after arriving from a Grid cell or a Rankings link dropped the highlight. go()
// is DOM-bound (it sets location.hash), so the address-building line lives here where a test can reach it directly.
export function offHref(n, hl) {
  const params = new URLSearchParams(toQuery(n));
  if (hl) params.set("hl", hl);
  if (n.more) params.set("more", "1");
  const q = params.toString();
  return `#/offense${q ? "?" + q : ""}`;
}

// `opts.hl` (D208): the club abbr the Rankings page wants highlighted on this side, passed through to
// offTableHtml's view.hl. Nothing else calls renderOffense with a second table argument (main.js's own /offense
// route is now an alias, views/rankings.js is the only caller), so this stays a plain optional param rather than
// something read off the query here too.
export async function renderOffense(ctx, query, opts = {}) {
  const { root, isCurrent } = ctx;
  const { hl = "" } = opts;
  const st = fromQuery(query);
  st.more = moreFrom(query);
  const { sort, dir } = offSort(query, st);
  document.title = "Offense · NFL Analytics";
  const go = (n) => { location.hash = offHref(n, hl); };
  if (!root.querySelector(".an-off")) root.innerHTML = `<div class="an-msg">Loading offenses…</div>`;
  let data, teams;
  try {
    [data, teams] = await Promise.all([
      loadFor(seasonsOf(st), st),
      loadTeams().then((j) => new Map((j.teams || []).map((t) => [t.abbr, t]))).catch(() => new Map()),
    ]);
  } catch (e) {
    if (!isCurrent()) return;
    const notBuilt = e.status === 404 || e.status === 503;
    root.innerHTML = notBuilt ? `<div class="an-msg"><div class="an-msg-title">No ${st.season} analytics yet</div>The analytics files for ${st.season} have not been compiled yet.</div>`
      : `<div class="an-msg an-msg-err">Could not load the analytics data: ${esc(e.message)}</div>`;
    return;
  }
  if (!isCurrent()) return;
  if (ui.team !== st.open) { ui.team = st.open; ui.zone = null; }
  const pst = teamPageState(st);
  const agg = aggregateTeams(data.blocks, data.players, pst, { playsFor: st.open || null });
  const ref = teamReference(agg.rows);
  const wn = windowName(st, agg.weeks);
  const pnote = pfrNote(agg.pfrThrough, agg.latestKey, st.season);
  const qs = toQuery({ ...st, open: "" });
  const span = agg.weeks.length ? (agg.weeks.length === 1 ? weekLabel(agg.weeks[0], st.season) : `${weekLabel(agg.weeks[0], st.season)} to ${weekLabel(agg.weeks[agg.weeks.length - 1], st.season)}`) : "no games";
  root.innerHTML = `<section class="an-def an-pl an-off">
    <div class="an-head">
      <h1>Rankings</h1>
      <div class="an-sub">${esc(seasonLabel(st))} · ${esc(span)}${st.window === "last3" ? " (each club's last 3 games)" : ""} · league reference: ${esc(ref.text)}${pnote ? " · " + esc(pnote) : ""}</div>
      ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    </div>
    <div class="an-filters"></div>
    <div class="an-tablewrap"></div>
    <p class="an-foot">Plays, EPA, success, sacks, completions, aDOT, explosive plays and the zone field: nflverse play-by-play (defensive pass interference no-plays are left out). Play action: FTN charting. PROE: the expected pass rate is nflverse xpass (penalty no-plays are not in the rows). Drives: nflverse play-by-play drives, the points the offense scored on its own snaps; 3rd % reads a little under NFL.com's (penalty no-plays are not in the rows). Pace: seconds per play in neutral script, no-huddle and shotgun (pistol counted in) from nflverse play-by-play, motion from FTN charting. Pressure %: PFR advanced stats, the club's quarterbacks' pressured dropbacks over their dropbacks (about a week behind). Stuffed % and yards before contact: PFR advanced rushing${agg.unmapped.length ? ` (${agg.unmapped.length} row${agg.unmapped.length === 1 ? "" : "s"} could not be placed on a club)` : ""}. Zone references pool every attempt in the window.</p>
  </section>`;
  renderFilterBar(root.querySelector(".an-filters"), st, { keys: data.keys, teams: [] }, go);
  const el = root.querySelector(".an-tablewrap");
  el.innerHTML = offTableHtml(agg.rows, st, qs, { ref, teams, windowName: wn, lgZones: agg.lgZones, players: data.players, sort, dir, hl });
  // More open on a narrow window: the frame scrolls sideways only when the table is wider than it (.an-over).
  fitOpen(el);
  wireMore(el, () => go(toggleMore(OFF_COLS, { ...st, sort, dir }, DEFAULT_SORT)));
  el.querySelectorAll("th[data-sort]").forEach((h) => h.addEventListener("click", () => {
    const k = h.dataset.sort === "rank" ? "epaPlay" : h.dataset.sort;
    const d = sort === k ? (dir === "desc" ? "asc" : "desc") : bestDir(k);
    go({ ...st, sort: k, dir: d });
  }));
  const toggle = (tr) => {
    const id = tr.dataset.id;
    offAnchor.id = id; offAnchor.top = tr.getBoundingClientRect().top;
    const keep = { ...st, sort, dir };
    if (st.open === id) {
      const wrap = tr.nextElementSibling?.querySelector(".an-detail-wrap");
      if (wrap) { wrap.classList.add("closing"); setTimeout(() => go({ ...keep, open: "" }), 170); } else go({ ...keep, open: "" });
    } else go({ ...keep, open: id });
  };
  el.querySelectorAll("tr.an-row").forEach((tr) => {
    tr.addEventListener("click", (e) => { if (!e.target.closest("a")) toggle(tr); });
    tr.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !e.target.closest("a")) { e.preventDefault(); toggle(tr); } });
  });
  // The open row's zone field: its measure switch and the plays behind a cell repaint in place.
  const zbox = el.querySelector("[data-zones]");
  const openRow = agg.rows.find((r) => r.team === st.open);
  if (zbox && openRow) {
    const zones = teamZones(openRow.off, agg.lgZones);
    const repaint = () => { zbox.innerHTML = zoneBlock(zones, st, data.players, qs); wire(); };
    const wire = () => {
      zbox.querySelectorAll("[data-zmode] button").forEach((b) => b.addEventListener("click", () => { ui.zoneMode = b.dataset.v; repaint(); }));
      zbox.querySelectorAll("[data-zone]").forEach((c) => c.addEventListener("click", () => { ui.zone = ui.zone === c.dataset.zone ? null : c.dataset.zone; repaint(); }));
      zbox.querySelector("[data-close]")?.addEventListener("click", () => { ui.zone = null; repaint(); });
    };
    wire();
  }
  if (offAnchor.id) {
    const tr = [...root.querySelectorAll("tr.an-row")].find((t) => t.dataset.id === offAnchor.id);
    if (tr) window.scrollBy(0, tr.getBoundingClientRect().top - offAnchor.top);
    offAnchor.id = null;
  } else if (st.open) {
    root.querySelector("tr.an-row.open")?.scrollIntoView({ block: "center" });
  }
}
