// Running backs (#/rbs; the old Rushing page, #/rushing still works, D193): the ball carriers' leaderboard. Every man
// with a carry (backs and fullbacks by default; QBs and receivers on the position chips). D177: efficiency (EPA/carry,
// success, YPC and over expected) with a league reference beside every rate and a total for anything weekly; rush
// direction was dropped by Adam. The columns read Production, Opportunity, Efficiency, then the ancillary groups (the
// COLS note below). Every figure comes from agg_rush.js (pure); this file draws, sorts and wires clicks.
// The weekly strips and the team pill are qb.js's, shared.
import { fromQuery, toQuery, seasonsOf, weekLabel, POSITIONS, DEFAULT_POS } from "../filters.js";
import { loadFor, loadTeams, loadStatusFeed, displayName } from "../data.js";
import { clubGames, tierNote, TIER_NAMES, MIN_POOL, POOL_PER_GAME, POOL_FLOOR } from "../agg.js";
import { aggregateRush, rushReference, rushTier, sortRushRows, rushOpts, rushQueryFrom, samePos, RUSH_DEFAULT_POS, RUSH_MIN_CAR, RUSH_TIER_KEYS, BIN_LABELS, GOAL_LINE } from "../agg_rush.js";
import { renderFilterBar } from "../filterbar.js";
import { decorateDeciding } from "../deciding.js";
import { involvementSignals, signalHtml } from "../agg_signal.js";
import { esc, NA, isNum, pct, fix, signed, int, teamPill, qbStrips, seasonLabel } from "./qb.js";
import { DK_TIPS, CATCH_TIP, withGroups, RZ_TIPS, withRzFigures, shareSample, shareCountHtml, groupCells, viewFrom, withView, columnsFor, pickView, viewCell, wantsDeciding, withViewSort, defaultSortFor, l3Title, WK_COLS, DEC_GROUPS, L3_NOTE, fitOpen, wireView, statusChip, statusNameClass, statusApplies, hlOf, withHl, scrollToHl } from "../table.js";

// 👁 fix round, finding 4: qb.js's fix()/int() print JS's native ASCII hyphen for a negative value ("-2", "-0.12"),
// while epaCar/epaTgt/epaOpp/ryoeAtt on this same table already use signed() and print the true minus ("−0.90").
// Long, Eff and Yds/opp (and, in principle, DK on a fumble-heavy week) can all go negative, so this table read
// inconsistent. These wrap qb.js's own formatters (shared with the QB and other tables, so left untouched) and
// swap the leading hyphen for U+2212 whenever the value is negative; agg_rush.js (the aggregation) is untouched.
const fixM = (v, d) => fix(v, d).replace(/^-/, "−");
const intM = (v) => int(v).replace(/^-/, "−");

// Re-cut increment 7b (D193, Adam's answer 10: "Production, Opportunity, Efficiency, then the rest; the divide doesn't
// need to be so stark"): Production, Opportunity and Efficiency lead; two lighter ancillary groups close the table,
// the rushing detail tinted gold and the receiving detail purple, never tier-coloured and never barred. Every column
// keeps its key, value, format, tooltip and sort; the old Volume, Scoring zone, Big plays and Involvement headers and
// D191's "Efficiency (opp)" are gone (D191's Opp/g and Opp % now sit in Opportunity, the rest in the gold group).
// Lead's call (7b): the raw Opp and Car counts are dropped from the gold group so the open table fits the 1760 column
// at 2560; Opp/g carries Opp, and sort=opp links still sort (the rank header sorts by carries). Car came back as a
// column on 2026-09-27 (Adam).
const COLS = [
  { k: "dkG", h: "DK/g", t: DK_TIPS.dkG, f: (v) => fixM(v, 1), grp: "p" },
  { k: "dk", h: "DK", t: DK_TIPS.dk, f: (v) => fixM(v, 1), grp: "p" },
  { k: "yds", h: "Rush yds", t: "Rushing yards", f: intM, grp: "p" },
  { k: "td", h: "Rush TD", t: "Rushing touchdowns", f: intM, grp: "p" },
  { k: "rec", h: "Rec", t: "Receptions", f: intM, grp: "p" },
  { k: "recYds", h: "Rec yds", t: "Receiving yards", f: intM, grp: "p" },
  { k: "recTd", h: "Rec TD", t: "Receiving touchdowns", f: intM, grp: "p" },
  { k: "oppG", h: "Opp/g", t: "Opportunities (carries + targets) per game he played", f: (v) => fixM(v, 1), grp: "o", bar: 28 },
  { k: "oppShare", h: "Opp %", t: "Opportunity share: (his designed runs + his targets) / (his club's designed runs + his club's pass attempts) in his games (scrambles are on neither side)", f: (v) => pct(v), grp: "o", bar: 0.5 },
  // Adam, 2026-09-27: "carries should be a sortable stat, obviously" - the raw count is a column again (7b had
  // dropped it for width; sort=car had kept working through the rank header, but nothing on screen said so).
  { k: "car", h: "Car", t: "Carries in the window (designed runs plus scrambles)", f: intM, grp: "o" },
  { k: "carG", h: "Car/g", t: "Carries per game he played", f: (v) => fixM(v, 1), grp: "o", bar: 22 },
  { k: "rushShare", h: "Rush %", t: "Rush share: his designed runs / his club's designed runs in his games (scrambles are called passes: on neither side)", f: (v) => pct(v), grp: "o", bar: 0.8 },
  { k: "tgt", h: "Tgt", t: "Targets (the Receivers page's count)", f: intM, grp: "o" },
  { k: "tgtShare", h: "Tgt %", t: "Target share: his targets / his club's pass attempts in his games", f: (v) => pct(v), grp: "o", bar: 0.3 },
  { k: "rzOppG", h: "RZ opp/g", t: RZ_TIPS.rzOppG, f: (v) => fixM(v, 2), grp: "o" },
  { k: "i5Share", h: "i5 %", t: RZ_TIPS.i5Share, f: (v) => pct(v, 0), grp: "o", bar: 0.6 },
  { k: "snapPct", h: "Snap %", t: "Share of his club's offensive snaps (nflverse snap counts)", f: (v) => pct(v, 0), grp: "o", bar: 1 },
  { k: "ypc", h: "YPC", t: "Yards per carry", f: (v) => fixM(v, 1), grp: "e" },
  { k: "epaCar", h: "EPA/car", t: "Expected points added per carry", f: (v) => signed(v, 2), grp: "e" },
  { k: "ryoeAtt", h: "RYOE/att", t: "NGS rush yards over expected per carry (the weeks NGS lists him)", f: (v) => signed(v, 2), grp: "e" },
  { k: "yprr", h: "YPRR", t: "Receiving yards per route run (heatradar routes, charted)", f: (v) => fixM(v, 2), grp: "e" },
  { k: "epaTgt", h: "EPA/tgt", t: "Expected points added per target", f: (v) => signed(v, 2), grp: "e" },
  { k: "succPct", h: "Succ %", t: "Share of his carries that were successful plays (nflverse success)", f: (v) => pct(v, 0), grp: "xr" },
  { k: "eff", h: "Eff", t: "NGS efficiency: distance run per rushing yard; lower is more north-south (weighted by his carries each week)", f: (v) => fixM(v, 2), grp: "xr" },
  { k: "long", h: "Long", t: "Longest carry", f: intM, grp: "xr" },
  { k: "explPct", h: "Expl %", t: "Explosive rate: carries of 10+ yards / carries", f: (v) => pct(v, 0), grp: "xr" },
  { k: "rzOpp", h: "RZ opp", t: "Red-zone opportunities: his red-zone carries + his red-zone targets (opponent's 20 or closer), the window's total", f: intM, grp: "xr" },
  { k: "rzCarG", h: "RZ car/g", t: RZ_TIPS.rzCarG, f: (v) => fixM(v, 2), grp: "xr" },
  { k: "rz", h: "RZ", t: "Red-zone carries (opponent's 20 or closer)", f: intM, grp: "xr" },
  { k: "gl", h: "GL", t: `Goal-line carries (opponent's ${GOAL_LINE} or closer)`, f: intM, grp: "xr" },
  { k: "ydsOpp", h: "Yds/opp", t: "(Rushing yards + receiving yards) / opportunities (carries + targets)", f: (v) => fixM(v, 1), grp: "xr" },
  { k: "epaOpp", h: "EPA/opp", t: "(EPA summed over his carries + EPA summed over his targets) / opportunities (carries + targets)", f: (v) => signed(v, 2), grp: "xr" },
  { k: "tdOpp", h: "TD/opp", t: "(Rushing touchdowns + receiving touchdowns) / opportunities (carries + targets)", f: (v) => (isNum(v) ? pct(v) + "%" : NA), grp: "xr" },
  { k: "routes", h: "Routes", t: "Routes run (heatradar, charted; weeks under 8 routes are not listed)", f: intM, grp: "xp" },
  { k: "tprr", h: "TPRR", t: "Targets per route run", f: (v) => fixM(v, 2), grp: "xp" },
  { k: "catchPct", h: "Catch %", t: CATCH_TIP, f: (v) => pct(v), grp: "xp" },
];
// [key, label, ancillary tint or ""]; table.js's withGroups sets each column's classes.
const GROUPS = [["p", "Production", ""], ["o", "Opportunity", ""], ["e", "Efficiency", ""], ["xr", "Rushing detail", "run"], ["xp", "Receiving detail", "pass"]];
withGroups(COLS, GROUPS);
// The column order, grouped, for tests and the lead.
export const RB_TABLE_ORDER = GROUPS.map(([g, l]) => [l, COLS.filter((c) => c.grp === g).map((c) => c.k)]);
// D224 F: the Deciding set, left to right (table.js "the Deciding preset"). The L3 columns read his club's last 3 games and are
// tier-coloured and barred by the base figure's own cuts; the rushing page's default sort (carries) never promotes the view.
const col = (k, over = {}) => ({ ...COLS.find((c) => c.k === k), ...over });
const DEC_COLS = withGroups([
  col("dkG", { grp: "dp" }),
  { ...WK_COLS.wkOpp, grp: "dw" },
  { ...WK_COLS.wkVs, grp: "dw" },
  { k: "snapL3", h: "Snap % L3", t: `Share of his club's offensive snaps over ${L3_NOTE}`, f: (v) => pct(v, 0), grp: "du", base: "snapPct", bar: 1 },
  { k: "rushL3", h: "Rush % L3", t: `Rush share (his designed runs / his club's designed runs in his games) over ${L3_NOTE}`, f: (v) => pct(v), grp: "du", base: "rushShare", bar: 0.8 },
  col("rushShare", { grp: "du" }),
  { k: "tgtL3", h: "Tgt % L3", t: `Target share (his targets / his club's pass attempts in his games) over ${L3_NOTE}`, f: (v) => pct(v), grp: "du", base: "tgtShare", bar: 0.3 },
  col("tgtShare", { grp: "du" }),
  col("i5Share", { grp: "dr" }),
], DEC_GROUPS);
export const RB_DECIDING = DEC_COLS.map((c) => c.k);
export const rbWantsDeciding = (st) => wantsDeciding(COLS, DEC_COLS, st);
const TIERED = new Set(RUSH_TIER_KEYS);
const SORTABLE = new Set([...COLS.map((c) => c.k), ...RB_DECIDING, "name", "g", "car", "opp"]);
// The totals that sort but are not columns, and the column that shows them (🔵 on 7b: the default sort is carries).
export const SHOWN_AS = { opp: "oppG" }; // car is its own column now (2026-09-27)
const SHOWN_AS_TEXT = { opp: "total opportunities" };
const BAND = (pos) => (pos === "RB" || pos === "FB" ? "BACKFIELD" : pos);

// Weekly carries: a line with the position's carries-per-game league line dashed behind it.
export function carrySpark(series, st, lgCarG) {
  const W = 84, H = 22, pad = 3, n = series.length;
  const max = Math.max(12, ...series.map((s) => s.car || 0), lgCarG || 0);
  const x = (i) => (n <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1));
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  let d = "", pen = false;
  series.forEach((s, i) => { if (!isNum(s.car)) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(s.car).toFixed(1)}`; pen = true; });
  const pts = series.map((s, i) => {
    const w = n <= 1 ? W : (W - 2 * pad) / (n - 1);
    const lab = `${weekLabel(s.key, st.season)}: ${s.dnp ? "did not play" : isNum(s.car) ? `${s.car} carr${s.car === 1 ? "y" : "ies"}, ${s.yds} yds${isNum(s.share) ? `, ${Math.round(s.share * 100)}% of club runs` : ""}` : "bye"}`;
    return `<g class="an-sp-pt"><rect x="${(x(i) - w / 2).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" fill="transparent"><title>${esc(lab)}</title></rect>`
      + (isNum(s.car) ? `<circle cx="${x(i).toFixed(1)}" cy="${y(s.car).toFixed(1)}" r="${i === n - 1 ? 2.4 : 1.6}"/>` : "") + `</g>`;
  }).join("");
  const ref = isNum(lgCarG) ? `<line class="an-sp-ref" x1="0" x2="${W}" y1="${y(lgCarG).toFixed(1)}" y2="${y(lgCarG).toFixed(1)}"/>` : "";
  return `<svg class="an-spark an-rush-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Weekly carries">${ref}<path d="${d}"/>${pts}</svg>`;
}

// His carries by gain as one stacked bar, the position pool's split as a thin bar under it (D177 perspective).
function binsBar(bins, lgBins) {
  const tot = bins.reduce((s, x) => s + x, 0);
  const seg = (shares, cls) => shares.map((v, i) => `<i class="b${i}" style="width:${(v * 100).toFixed(2)}%"${cls ? "" : ` title="${esc(`${BIN_LABELS[i]} yards: ${bins[i]} carries (${Math.round(v * 100)}%)${lgBins ? ` · lg ${Math.round(lgBins[i] * 100)}%` : ""}`)}"`}></i>`).join("");
  const mine = tot ? bins.map((x) => x / tot) : [0, 0, 0, 0];
  return `<div class="an-rbins"><div class="an-rbins-me">${seg(mine, "")}</div>${lgBins ? `<div class="an-rbins-lg" title="His position's reference pool, carries pooled">${seg(lgBins, "lg")}</div>` : ""}`
    + `<div class="an-rbins-leg">${BIN_LABELS.map((l, i) => `<span class="b${i}"><i></i>${l}<b>${Math.round(mine[i] * 100)}%</b>${lgBins ? `<em>lg ${Math.round(lgBins[i] * 100)}%</em>` : ""}</span>`).join("")}</div></div>`;
}

function detailHtml(r, st, q, P, wn) {
  const L = P?.lg || {}, cuts = P?.cuts;
  const tile = (label, val, k, lg, title = "") => {
    const t = k ? rushTier(k, r[k], cuts) : "";
    return `<div class="an-tile${t ? " t-" + t : ""}"${title ? ` title="${esc(title)}"` : ""}><span>${label}</span><b>${val}</b>${lg && !lg.includes("an-na") ? `<em title="League average: ${esc(P?.text || "")}"> · lg ${lg}</em>` : ""}</div>`;
  };
  const maxCar = Math.max(12, ...r.series.map((s) => s.car || 0));
  const maxSh = Math.max(0.6, ...r.series.map((s) => s.share || 0));
  const strips = [
    { k: "car", label: "Carries", span: maxCar * 1.05, fmt: (v) => `${v} carries`, short: (v) => String(v), total: r.car, totalText: `${wn} ${r.car}`,
      avg: L.carG, avgText: `lg ${isNum(L.carG) ? L.carG.toFixed(1) : "–"}/g`, tier: () => rushTier("carG", r.carG, cuts) },
    { k: "share", label: "Rush share", span: maxSh * 1.05, fmt: (v) => `${(v * 100).toFixed(1)}% of club runs`, short: (v) => String(Math.round(v * 100)),
      total: r.rushShare, totalText: `${wn} ${isNum(r.rushShare) ? (r.rushShare * 100).toFixed(1) + "%" : "–"}`, avg: L.rushShare,
      avgText: `lg avg ${isNum(L.rushShare) ? Math.round(L.rushShare * 100) + "%" : "–"}`, tier: (v) => rushTier("rushShare", v, cuts) },
  ];
  const depth = `../#/team/${encodeURIComponent(r.team)}/player/${encodeURIComponent(r.gsis)}`;
  const qbNote = r.scr ? ` · ${r.des} designed, ${r.scr} scramble${r.scr === 1 ? "" : "s"}` : "";
  return `<div class="an-detail-in an-rush-din">
    <div class="an-dcol"><div class="an-dh">Week by week <span class="an-dsub">${r.car} carries · ${r.yds} yds${qbNote}</span></div>${r.series.length ? qbStrips(r.series, strips, { season: st.season, bw: 26, gap: 7, sh: 48, lw: 104, rw: 64 }) : `<div class="an-note">No weeks in this window.</div>`}</div>
    <div class="an-dcol an-rush-mid"><div class="an-dh">Carries by gain <span class="an-dsub">vs ${esc(r.pos)} pool</span></div>${binsBar(r.bins, L.bins)}
      <div class="an-rush-zone"><span><b>${r.rz}</b> RZ</span><span><b>${r.gl}</b> GL</span><span><b>${r.td}</b> TD</span><span><b>${isNum(r.long) ? r.long : "–"}</b> long</span></div></div>
    <div class="an-dcol"><div class="an-dh">Efficiency</div><div class="an-dtiles">
      ${tile("YPC", fixM(r.ypc, 1), "ypc", fixM(L.ypc, 1))}${tile("EPA/car", signed(r.epaCar, 2), "epaCar", signed(L.epaCar, 2))}
      ${tile("Succ %", pct(r.succPct, 0), "succPct", pct(L.succPct, 0))}${tile("Expl %", pct(r.explPct, 0), "explPct", pct(L.explPct, 0))}
      ${tile("RYOE/att", signed(r.ryoeAtt, 2), "ryoeAtt", signed(L.ryoeAtt, 2), "NGS rush yards over expected per carry")}${tile("Eff", fixM(r.eff, 2), "eff", fixM(L.eff, 2), "NGS efficiency: lower is more north-south")}
    </div></div>
    <div class="an-dcol"><div class="an-dh">Involvement</div><div class="an-dtiles">
      ${tile("Snap %", pct(r.snapPct, 0), "snapPct", pct(L.snapPct, 0))}${tile("Rush %", pct(r.rushShare), "rushShare", pct(L.rushShare))}
      ${tile("Tgt %", pct(r.tgtShare), "tgtShare", pct(L.tgtShare))}${tile("Targets", intM(r.tgt), "", fixM(L.tgt, 1))}
      ${tile("Routes", intM(r.routes), "", fixM(L.routes, 0), "heatradar, charted")}${tile("Car/g", fixM(r.carG, 1), "carG", fixM(L.carG, 1))}
      <div class="an-dlinks"><a href="#/player/${encodeURIComponent(r.gsis)}${q ? "?" + q : ""}">Player page →</a><a href="${depth}">Depth chart →</a></div>
    </div></div></div>`;
}

export const rushAnchor = { id: null, top: null };

// PURE (no DOM): the table's markup. view: { ref (rushReference), windowName, teams, minCar, signal (true: D230's ▲/▼ marker) }.
// `status`: D196's injury-status map (gsis -> status), already season-gated by the caller (table.js's
// statusApplies) - pass {} to draw no badges. Never fetched here.
export function rushTableHtml(allRows, st, query, view = {}, status = {}) {
  const sortKey = SORTABLE.has(st.sort) ? st.sort : "car";
  const minCar = view.minCar ?? RUSH_MIN_CAR;
  const rows = sortRushRows(allRows.filter((r) => r.car >= minCar), sortKey, st.dir);
  const q = query || "", ref = view.ref;
  // D224 F: the chosen column set (Deciding, Standard or All), after any sort promotion (table.js columnsFor).
  const sel = columnsFor(COLS, DEC_COLS, { ...st, sort: sortKey }, "car", GROUPS, DEC_GROUPS);
  const cols = sel.cols;
  // D230: the involved-vs-producing marker after the name, only when the caller opts in (view.signal); the pool is these rows.
  const sig = view.signal ? involvementSignals(rows, "rb") : null;
  const nCols = 3 + cols.length + 1;
  // A sort on a total that is not a column (carries, opportunities) lights the per-game column that stands for it.
  const th = (k, h, t, cls = "") => {
    const stand = sortKey !== k && SHOWN_AS[sortKey] === k;
    return `<th class="${cls}${sortKey === k || stand ? " sorted " + st.dir : ""}" data-sort="${k}" title="${esc(stand ? `${t} (sorted by ${SHOWN_AS_TEXT[sortKey]})` : t)}">${h}</th>`;
  };
  // The toggle (moreCell) leads the row, spanning rank+name; a blank cell fills the G spot, and the trailing
  // cell over the sparkline is blank in its place (👁 fix round, findings 1, 5).
  const groupRow = `<tr class="an-grp">${viewCell(sel.view)}<th></th>${groupCells(cols, sel.groups)}<th class="c-spark"></th></tr>`;
  // an-stick on rank/name: the lead's CSS pins these two columns left while the frame scrolls (finding 1).
  const head = `<tr>${th("rank", "#", "Rank", "c-rank an-stick")}${th("name", "Player", "Player, team, position", "c-name an-stick")}${th("g", "G", "Games in the window")}${cols.map((c) => th(c.k, c.h, c.t, c.cls)).join("")}<th class="c-spark" title="Weekly carries; dashed: his position's carries per game; hover a point for the week">Carries by week</th></tr>`;
  const cell = (c, r) => {
    if (c.html) return `<td class="num ${c.cls}${c.td ? " " + c.td : ""}">${r[c.html] || NA}</td>`;
    const v = r[c.k], P = ref?.at(r.pos), tk = c.base || c.k; // an L3 column is judged by its base figure's cuts
    // Ancillary columns are never tier-coloured, whatever the aggregation tiers (Opp, Succ %, Eff, Expl % here).
    const tiered = TIERED.has(tk) && !c.anc;
    const tier = tiered ? rushTier(tk, v, P?.cuts) : "";
    let title = tiered && isNum(v) ? tierNote(P?.cuts?.[tk], r.pos) : "";
    if (c.k === "carG" && r.scr) title = `${title ? title + ". " : ""}${r.car} carries: ${r.des} designed runs, ${r.scr} scrambles`;
    const bar = c.bar && isNum(v) ? `<i class="an-bar" style="width:${Math.min(100, (v / c.bar) * 100).toFixed(1)}%"></i>` : "";
    const ss = shareSample(c.k, r, st);
    if (ss.title) title = [title, ss.title].filter(Boolean).join(". ");
    if (c.base) title = [title, l3Title(r)].filter(Boolean).join(". ");
    return `<td class="num ${c.cls}${tier ? " t-" + tier : ""}${bar ? " has-bar" : ""}"${title ? ` title="${esc(title)}"` : ""}>${bar}<span>${c.f(v)}${shareCountHtml(ss.count)}</span></td>`;
  };
  const body = rows.map((r, i) => {
    const open = st.open === r.gsis;
    const depth = `../#/team/${encodeURIComponent(r.team)}/player/${encodeURIComponent(r.gsis)}`;
    const ps = status[r.gsis];
    const chip = statusChip(ps, { season: view.statusSeason }), nameCls = statusNameClass(ps);
    const mark = sig ? signalHtml("rb", sig, r.gsis) : "";
    return `<tr class="an-row${open ? " open" : ""}${view.hl && r.gsis === view.hl ? " is-hl" : ""}" data-id="${esc(r.gsis)}" tabindex="0" aria-expanded="${open}">
      <td class="c-rank an-stick">${i + 1}</td>
      <td class="c-name an-stick"><a class="an-pname${nameCls ? " " + nameCls : ""}" href="#/player/${encodeURIComponent(r.gsis)}${q ? "?" + q : ""}" title="${esc(r.name)}">${esc(r.name)}</a>${mark}${teamPill(r.team, view.teams, q)}<span class="an-pospill" data-band="${BAND(r.pos)}">${esc(r.pos)}</span>${chip}<a class="an-dc" href="${depth}" title="Open his depth-chart card" aria-label="Depth chart">→</a></td>
      <td class="num">${r.g}</td>
      ${cols.map((c) => cell(c, r)).join("")}
      <td class="c-spark">${carrySpark(r.series, st, ref?.at(r.pos)?.lg?.carG)}</td></tr>`
      + (open ? `<tr class="an-detail"><td colspan="${nCols}"><div class="an-detail-wrap">${detailHtml(r, st, q, ref?.at(r.pos), view.windowName || "Window")}</div></td></tr>` : "");
  }).join("");
  return `<div class="an-tbar">
      <label class="an-min">Min carries <input type="number" min="0" step="1" value="${minCar}" data-min></label>
      <span class="an-count">${rows.length} player${rows.length === 1 ? "" : "s"}</span>
      <span class="an-legend" title="The depth charts' rating colours, by position: each value against his own position's reference pool in this window (elite at its 90th percentile or above, then the 70th, 40th and 15th; low below). Eff: lower is better. A position with under ${MIN_POOL} men in the pool uses the league-wide cuts for that column (hover the cell).">
        ${TIER_NAMES.map((t) => `<i class="t-${t}"></i>`).join("")}<span>elite → low by position</span></span>
      <span class="an-hint">Click a row to open it</span>
    </div>
    <div class="an-tscroll"><table class="an-table an-rush-table"><thead>${groupRow}${head}</thead><tbody>${body || `<tr><td colspan="${nCols}" class="an-empty">No ball carriers match these filters.</td></tr>`}</tbody></table></div>`;
}

function windowText(st, weeks) {
  if (!weeks.length) return "no games";
  const span = weeks.length === 1 ? weekLabel(weeks[0], st.season) : `${weekLabel(weeks[0], st.season)} to ${weekLabel(weeks[weeks.length - 1], st.season)}`;
  return st.window === "last3" ? `each club's last 3 games (${span})` : span;
}

// The page's state: the shared filters with the rushing defaults (RB + FB when the hash names no positions; sort
// by carries when it names no sort).
export function rushState(query) {
  const st = fromQuery(query), o = rushOpts(query);
  if (!o.hasPos) st.pos = { ...RUSH_DEFAULT_POS };
  st.sort = o.sort;
  st.view = viewFrom(query);
  return { st: withViewSort(st, query), minCar: o.minCar }; // a Deciding address with no sort opens on DK/g
}
export const rushQuery = (st, minCar) => withView(rushQueryFrom(toQuery(st), st, minCar), st.view, st);

export async function renderRushing(ctx, query) {
  const { root, isCurrent } = ctx;
  const { st, minCar } = rushState(query);
  const hl = hlOf(query); // D225b: a player page's ranking link highlights his row; the reader's own changes keep it and never re-scroll
  document.title = "Running backs · NFL Analytics";
  const go = (n, mc = minCar) => {
    n = { ...n, view: n.view || st.view }; // Reset and the filter bar send no view: keep the one on screen
    // The filter bar's Reset returns Usage's default positions (WR/TE/RB); a chip click changes one position, so a
    // jump to exactly that set that changes more than one is the Reset: send it to the rushing default instead.
    const diff = POSITIONS.filter((p) => (n.pos[p] || "") !== (st.pos[p] || "")).length;
    if (diff > 1 && samePos(n.pos, DEFAULT_POS)) n = { ...n, pos: { ...RUSH_DEFAULT_POS } };
    const q = withHl(rushQuery(n, mc), hl); location.hash = `#/rbs${q ? "?" + q : ""}`;
  };
  if (!root.querySelector(".an-rush")) root.innerHTML = `<div class="an-msg">Loading running backs…</div>`;
  let data, teams, statusFeed, payload = null;
  try {
    // The D196 injury-status feed loads alongside the analytics data; it never throws (loadStatusFeed's own
    // contract), so a failure there never blocks the leaderboard.
    [data, payload, statusFeed] = await Promise.all([loadFor(seasonsOf(st), st), loadTeams().catch(() => null), loadStatusFeed()]);
    teams = payload?.teams || [];
  } catch (e) {
    if (!isCurrent()) return;
    const notBuilt = e.status === 404 || e.status === 503;
    root.innerHTML = notBuilt
      ? `<div class="an-msg"><div class="an-msg-title">No ${st.season} analytics yet</div>The analytics files for ${st.season} have not been compiled yet.</div>`
      : `<div class="an-msg an-msg-err">Could not load the analytics data: ${esc(e.message)}</div>`;
    return;
  }
  if (!isCurrent()) return;
  const agg = aggregateRush(data.blocks, data.players, st);
  // D224 A: red-zone rates and the inside-the-5 share on the rows (the share is blank under an opponent, down or quarter filter).
  withRzFigures(agg.rows, data.blocks, data.players, st, "rb");
  // League references and tier cuts always come from the whole league at every position, the same window.
  const lgSt = { ...st, team: "", opp: "", pos: {} };
  const ref = rushReference(withRzFigures(aggregateRush(data.blocks, data.players, lgSt).rows, data.blocks, data.players, lgSt, "rb"));
  for (const r of agg.rows) r.name = displayName(r.gsis, data.players);
  const weeks = agg.weeks;
  const windowName = st.window === "last3" ? "Last 3" : st.window === "range" && weeks.length ? `${weekLabel(weeks[0], st.season)}–${weekLabel(weeks[weeks.length - 1], st.season)}` : "Season";
  const clubTeams = [...new Set(clubGames(data.blocks).map((g) => g.team))].sort();
  const teamsByAbbr = new Map(teams.map((t) => [t.abbr, t]));
  const shownPos = POSITIONS.filter((p) => agg.rows.some((r) => r.pos === p));
  const refLine = `League reference and colour tiers, by position: players at his position with ${POOL_PER_GAME}+ carries/game (min ${POOL_FLOOR}) in the window (${shownPos.map((p) => `${p}s ${ref.at(p).n}`).join(" · ") || "none"})`;
  const posText = POSITIONS.filter((p) => st.pos[p] === "in").join(" · ") || "All positions";
  const exText = POSITIONS.filter((p) => st.pos[p] === "out");
  // Player and team links carry the filters but not the column set, as on the Receivers page.
  const qs = rushQuery({ ...st, open: "", view: "" }, minCar);
  root.innerHTML = `<section class="an-rush">
    <div class="an-head">
      <h1>Running backs</h1>
      <div class="an-sub">${esc(seasonLabel(st))} · ${esc(windowText(st, weeks))} · ${esc(posText)}${exText.length ? ` · excluding ${esc(exText.join(", "))}` : ""}${st.team ? ` · ${esc(st.team)}` : ""}${st.opp ? ` · vs ${esc(st.opp)}` : ""}</div>
      ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    </div>
    <div class="an-sub an-ref">${esc(refLine)}</div>
    <div class="an-filters"></div>
    <div class="an-tablewrap"></div>
    <p class="an-foot">Carries, yards, TD, EPA, success, red-zone and goal-line carries, long and explosive runs, rush share, targets and target share: nflverse play-by-play (a quarterback's carries include scrambles; rush share counts designed runs only). Rush yards over expected and efficiency: Next Gen Stats. Snaps: nflverse snap counts. Routes, YPRR, TPRR: heatradar.app (charted). Receptions, receiving yards and TDs, EPA per target and catch %: nflverse play-by-play, the Receivers page's figures. Fumbles lost are counted from the play rows (a fumble lost on a kick or punt return is not in them). DK: DraftKings Classic points from the same play rows, a lost fumble included (no 2-point conversions or return touchdowns).</p>
  </section>`;
  renderFilterBar(root.querySelector(".an-filters"), st, { keys: data.keys, teams: clubTeams }, (n) => go(n));
  const el = root.querySelector(".an-tablewrap");
  // D196: badges are current-season only - statusApplies gates on the feed's own season against the window shown.
  const status = statusApplies(st, statusFeed.season) ? statusFeed.players : {};
  // D224 F: the Deciding set's last-3, this-week and status figures, only when that set is (or a sort needs it) on screen.
  if (rbWantsDeciding(st)) { try { decorateDeciding(agg.rows, "rb", { blocks: data.blocks, players: data.players, st, payload }); } catch (e) { console.warn("Deciding figures unavailable:", e); } }
  el.innerHTML = rushTableHtml(agg.rows, st, qs, { ref, windowName, teams: teamsByAbbr, minCar, statusSeason: statusFeed.season, hl, signal: true }, status);
  fitOpen(el);
  wireView(el, (v) => go(pickView(COLS, DEC_COLS, { ...st, sort: SORTABLE.has(st.sort) ? st.sort : "car" }, v, "car")));
  el.querySelectorAll("th[data-sort]").forEach((h) => h.addEventListener("click", () => {
    const k = h.dataset.sort === "rank" ? defaultSortFor(columnsFor(COLS, DEC_COLS, { ...st, sort: SORTABLE.has(st.sort) ? st.sort : "car" }, "car", GROUPS, DEC_GROUPS).view, "car") : h.dataset.sort;
    const cur = SORTABLE.has(st.sort) ? st.sort : "car";
    const dir = cur === k ? (st.dir === "desc" ? "asc" : "desc") : k === "name" || k === "wkOpp" ? "asc" : "desc";
    go({ ...st, sort: k, dir });
  }));
  const min = el.querySelector("[data-min]");
  min?.addEventListener("change", () => go(st, Math.max(0, Math.floor(+min.value || 0))));
  const toggle = (tr) => {
    const id = tr.dataset.id;
    rushAnchor.id = id; rushAnchor.top = tr.getBoundingClientRect().top;
    if (st.open === id) {
      const wrap = tr.nextElementSibling?.querySelector(".an-detail-wrap");
      if (wrap) { wrap.classList.add("closing"); setTimeout(() => go({ ...st, open: "" }), 170); } else go({ ...st, open: "" });
    } else go({ ...st, open: id });
  };
  el.querySelectorAll("tr.an-row").forEach((tr) => {
    tr.addEventListener("click", (e) => { if (!e.target.closest("a")) toggle(tr); });
    tr.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !e.target.closest("a")) { e.preventDefault(); toggle(tr); } });
  });
  if (rushAnchor.id) {
    const tr = [...root.querySelectorAll("tr.an-row")].find((t) => t.dataset.id === rushAnchor.id);
    if (tr) window.scrollBy(0, tr.getBoundingClientRect().top - rushAnchor.top);
    rushAnchor.id = null;
  }
  scrollToHl(root, hl, query);
}
