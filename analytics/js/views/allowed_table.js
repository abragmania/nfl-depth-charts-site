// What each defense allows, by position (D196): per game to QBs, RBs, WRs and TEs (agg_allowed.js), each figure with
// its rank among the defenses small under it, coloured against them (fewer allowed = better colour, more interceptions
// = better). A "vs usual" switch (hash vs=1, default off) swaps each figure for allowedVsUsual's difference from what
// the same offenses' men usually get. Built for the Defense page, moved under the Team grid (Adam, 2026-09-25, D196's
// last paragraph: placement, not a redesign), so the cells stay compact rather than the grid's 0-100 tiles. PURE: no
// DOM; views/grid.js renders it and wires its switch and headers.
import { TIER_NAMES, MIN_POOL, percentileCuts, tierFromCuts } from "../agg.js";
import { ALLOWED_FIGURES, POS_GROUPS } from "../agg_allowed.js";
import { rankWithTies, displayed } from "../agg_grid.js";
import { esc, NA, isNum, teamPill } from "./qb.js";
import { ordinal } from "./team.js";

// The columns per position group (ALLOWED_FIGURES keys, in order) and their short heads; the group header names the
// position. Every figure is per game except Yds/opp (yards / (targets + carries) over the window).
export const POS_VIEW_COLS = Object.freeze({
  QB: Object.freeze(["dk", "attempts", "passYds", "passTd", "int", "carries"]),
  RB: Object.freeze(["dk", "carries", "targets", "redZoneLooks", "ydsPerOpp", "td"]),
  WR: Object.freeze(["dk", "targets", "redZoneLooks", "ydsPerOpp", "td"]),
  TE: Object.freeze(["dk", "targets", "redZoneLooks", "ydsPerOpp", "td"]),
});
const POS_HEAD = { dk: "DK/g", attempts: "Att", passYds: "Pass yds", passTd: "Pass TD", int: "INT", carries: "Car", targets: "Tgt", redZoneLooks: "RZ looks", ydsPerOpp: "Yds/opp", td: "TD" };
const POS_TIP = {
  dk: "DraftKings Classic points per game (D194)", attempts: "pass attempts per game", passYds: "passing yards per game",
  passTd: "passing touchdowns per game", int: "interceptions thrown per game (more is better for the defense)",
  carries: "carries per game (designed runs, plus scrambles for quarterbacks)", targets: "targets per game",
  redZoneLooks: "red-zone targets plus red-zone carries per game", ydsPerOpp: "yards per opportunity: receiving plus rushing yards / (targets + carries) over the window",
  td: "receiving plus rushing touchdowns per game",
};
const POS_NAME = { QB: "quarterbacks", RB: "running backs", WR: "wide receivers", TE: "tight ends" };
const FIG = Object.fromEntries(ALLOWED_FIGURES.map((f) => [f.k, f]));
// A column's sort key: the group then the figure ("RBcarries"), letters only.
export const posKey = (grp, k) => `${grp}${k}`;
const POS_KEYS = new Map(POS_GROUPS.flatMap((g) => POS_VIEW_COLS[g].map((k) => [posKey(g, k), { grp: g, k }])));
const POS_SORTABLE = new Set([...POS_KEYS.keys(), "team", "g"]);
// First click on a column sorts best-first: ascending where fewer allowed is better (every figure but INT).
export const posBestDir = (key) => { const c = POS_KEYS.get(key); return c ? (FIG[c.k].dir === -1 ? "asc" : "desc") : key === "team" ? "asc" : "desc"; };
export const POS_DEFAULT_SORT = Object.freeze({ sort: "team", dir: "asc" });

// The table's state from the hash: its own sort (psort, pdir; the Team grid keeps sort and dir) and the vs-usual
// switch (vs=1). An unknown column falls back to the club order.
export function allowedState(query) {
  const q = new URLSearchParams(String(query || "").replace(/^\?/, ""));
  const ps = q.get("psort");
  const has = POS_SORTABLE.has(ps);
  return { sort: has ? ps : POS_DEFAULT_SORT.sort, dir: has ? (q.get("pdir") === "desc" ? "desc" : "asc") : POS_DEFAULT_SORT.dir, vs: q.get("vs") === "1" };
}
// The hash keys for a state, to append after the page's own: psort and pdir when not the default, vs=1 when on.
export function allowedQuery({ sort, dir, vs }) {
  const out = [];
  if (sort !== POS_DEFAULT_SORT.sort || dir !== POS_DEFAULT_SORT.dir) out.push(`psort=${encodeURIComponent(sort)}`, `pdir=${dir}`);
  if (vs) out.push("vs=1");
  return out.join("&");
}

// A number with its figure's digits, through displayed() (a true minus; `sign` adds "+" to a positive diff).
const figNum = (v, f, sign = false) => {
  if (!isNum(v)) return NA;
  let x = displayed(+v, f);
  if (Object.is(x, -0)) x = 0;
  return `${x < 0 ? "−" : sign && x > 0 ? "+" : ""}${Math.abs(x).toFixed(f.digits)}`;
};

// PURE: each club's cells. allowed = allowedByPosition()'s result; usual = allowedVsUsual()'s (needed only when vs).
// Map team -> { team, g, n, cells: { QB|RB|WR|TE: { [k]: { v, rank, tier, of, allowed?, usual? } } } }: v is the
// shown value (the per-game figure, or allowed − usual when vs), rank its rank among the defenses with a value (1 =
// toughest matchup; allowedByPosition's own ranks when not vs), tier its colour against them (fewer allowed is
// better, more interceptions is better; no colour under MIN_POOL defenses), of = how many defenses have a value.
export function posCells(allowed, usual, vs) {
  const rows = allowed?.rows || [];
  const uBy = new Map((usual?.rows || []).map((r) => [r.team, r]));
  const out = new Map(rows.map((r) => [r.team, { team: r.team, g: r.g, n: vs ? (uBy.get(r.team)?.n ?? 0) : r.g, cells: {} }]));
  for (const grp of POS_GROUPS) {
    for (const k of POS_VIEW_COLS[grp]) {
      const f = FIG[k];
      const u = (r) => uBy.get(r.team)?.pos?.[grp];
      const vals = rows.map((r) => { if (!r.g) return null; const v = vs ? u(r)?.diff?.[k] : r.pos?.[grp]?.pg?.[k]; return isNum(v) ? +v : null; });
      const ranks = vs ? rankWithTies(vals, f) : rows.map((r, i) => (vals[i] === null ? null : r.pos?.[grp]?.rank?.[k] ?? null));
      const pool = vals.filter((v) => v !== null).map((v) => f.dir * v);
      const cuts = pool.length >= MIN_POOL ? percentileCuts(pool) : null;
      rows.forEach((r, i) => {
        const c = { v: vals[i], rank: ranks[i], tier: vals[i] === null ? "" : tierFromCuts(f.dir * vals[i], cuts), of: pool.length };
        if (vs) { c.allowed = u(r)?.allowed?.[k] ?? null; c.usual = u(r)?.usual?.[k] ?? null; }
        (out.get(r.team).cells[grp] ||= {})[k] = c;
      });
    }
  }
  return out;
}

// PURE: sorted copy of posCells' values. A figure column sorts on the shown value (asc = fewer first), clubs with no
// value always last; ties fall back to the club's abbreviation. "team" sorts by abbreviation, "g" by games.
export function sortPosRows(list, sort, dir) {
  const s = dir === "asc" ? 1 : -1, c = POS_KEYS.get(sort);
  const val = (r) => (c ? (r.g ? r.cells?.[c.grp]?.[c.k]?.v ?? null : null) : sort === "g" ? r.g || null : null);
  return [...list].sort((a, b) => {
    if (sort === "team") return s * a.team.localeCompare(b.team);
    const x = val(a), y = val(b);
    if (!isNum(x)) return !isNum(y) ? a.team.localeCompare(b.team) : 1;
    if (!isNum(y)) return -1;
    return s * (x - y) || a.team.localeCompare(b.team);
  });
}

// PURE: the Per game / vs usual switch.
export function vsSegHtml(vs) {
  const opts = [["0", "Per game", "The figures allowed per game"], ["1", "vs usual", "Each figure minus what the same offenses' men of that position usually get in their other games"]];
  const cur = vs ? "1" : "0";
  return `<div class="an-seg" data-dvs>${opts.map(([v, l, t]) => `<button type="button" data-v="${v}" class="${cur === v ? "on" : ""}" aria-pressed="${cur === v}" title="${esc(t)}">${l}</button>`).join("")}</div>`;
}

// PURE: the section under the Team grid: its heading with the vs-usual switch, the count and legend, the table, and
// the notes. cells = posCells(); view: { teams, q (the filters' query for the club links), sort, dir, vs, audit
// ({ unpositioned, otherPos } or null) }.
export function allowedSectionHtml(cells, view) {
  const { sort, dir, vs } = view;
  const list = sortPosRows([...cells.values()], sort, dir);
  const q = view.q || "", nCols = 2 + POS_GROUPS.reduce((a, g) => a + POS_VIEW_COLS[g].length, 0);
  const th = (k, h, t, cls = "") => `<th class="${cls}${sort === k ? " sorted " + dir : ""}" data-sort="${k}" title="${esc(t)}">${h}</th>`;
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const groupRow = `<tr class="an-grp"><th colspan="2"></th>${POS_GROUPS.map((g) => `<th colspan="${POS_VIEW_COLS[g].length}" class="g-${g} gs" title="${esc(`Allowed to ${POS_NAME[g]}`)}">${g}</th>`).join("")}</tr>`;
  const head = `<tr>${th("team", "Defense", "Club", "c-name")}${th("g", "G", "Games in the window")}${POS_GROUPS.map((g) => POS_VIEW_COLS[g].map((k, i) =>
    th(posKey(g, k), POS_HEAD[k], `${cap(POS_NAME[g])}: ${POS_TIP[k]}${vs ? ", minus what the same offenses' " + POS_NAME[g] + " usually get" : " allowed"}`, `g-${g}${i === 0 ? " gs" : ""}`)).join("")).join("")}</tr>`;
  // The club cell stays a table cell (its flex row sits inside it) so it stretches to the two-line figure cells.
  const body = list.map((r) => {
    const tds = POS_GROUPS.map((g) => POS_VIEW_COLS[g].map((k, i) => {
      const cls = `num g-${g}${i === 0 ? " gs" : ""} an-dp-v`; // an-dp-v: one min-width for every value cell (a signed figure must not widen the table)
      if (!r.g) return `<td class="${cls}"></td>`;
      const c = r.cells[g][k], f = FIG[k];
      if (!isNum(c.v)) return `<td class="${cls}">${NA}</td>`;
      const rk = isNum(c.rank) ? ordinal(c.rank) : "";
      const title = vs
        ? `${POS_HEAD[k]} to ${POS_NAME[g]}: ${figNum(c.allowed, f)} allowed against ${figNum(c.usual, f)} usual over ${r.n} game${r.n === 1 ? "" : "s"} with a baseline, ${figNum(c.v, f, true)}${rk ? ` · ${rk} of ${c.of}` : ""}`
        : `${POS_HEAD[k]} allowed to ${POS_NAME[g]}: ${figNum(c.v, f)}${rk ? ` · ${rk} of ${c.of} (1st = toughest matchup)` : ""}`;
      return `<td class="${cls}${c.tier ? " t-" + c.tier : ""}" title="${esc(title)}"><span>${figNum(c.v, f, vs)}</span>${rk ? `<br><em class="an-rb-m an-dp-rk">${rk}</em>` : ""}</td>`;
    }).join("")).join("");
    return `<tr class="an-dp-row" data-id="${esc(r.team)}">
      <td class="an-dp-club"><div class="c-name">${teamPill(r.team, view.teams, q)}<span class="an-def-name">${esc(view.teams?.get(r.team)?.nickname || view.teams?.get(r.team)?.name || r.team)}</span></div></td>
      <td class="num">${r.g || ""}</td>${tds}</tr>`;
  }).join("");
  // vs usual: a short legend in the bar and the full sentence under it.
  const legend = vs
    ? "allowed minus usual, per game; rank 1 = held furthest under their norm; DraftKings Classic scoring (D194)"
    : "per game allowed to men of that position; rank 1 = toughest matchup; DraftKings Classic scoring (D194)";
  const au = view.audit, un = au?.unpositioned?.n || 0, ot = au?.otherPos?.n || 0;
  const men = (n) => `${n} m${n === 1 ? "a" : "e"}n`;
  const nDef = list.filter((r) => r.g).length;
  return `<section class="an-gallow">
    <div class="an-gallow-head"><h2>What each defense allows, by position</h2>${vsSegHtml(vs)}</div>
    <div class="an-tbar">
      <span class="an-count">${nDef} defense${nDef === 1 ? "" : "s"}</span>
      <span class="an-legend" title="Colour against the defenses in this window: elite at their 90th percentile or better, then the 70th, 40th and 15th; low below. Fewer allowed is better, except INT, where more is better.">
        ${TIER_NAMES.map((t) => `<i class="t-${t}"></i>`).join("")}<span>${esc(legend)}</span></span>
    </div>${vs ? `
    <p class="an-note an-dpos-note">vs usual: each figure is what the defense allowed minus what the same offenses' men of that position usually get in their other games in the window, averaged over its games where the offense has another game to compare. Below zero = held them under their norm; for INT, above zero is the good side. Yds/opp compares yards per opportunity, not per game.</p>` : ""}
    <div class="an-tscroll"><table class="an-table an-def-table an-dpos-table${vs ? " vs" : ""}"><thead>${groupRow}${head}</thead><tbody>${nDef ? body : `<tr><td colspan="${nCols}" class="an-empty">No games in this window.</td></tr>`}</tbody></table></div>
    ${un + ot ? `<p class="an-note">Left out of every position: ${[un ? `${men(un)} with no listed position` : "", ot ? `${men(ot)} listed at another position (a lineman's catch, a punter's fake)` : ""].filter(Boolean).join(" and ")}.</p>` : ""}
    <p class="an-foot">nflverse play-by-play, each man grouped by his listed position (fullbacks with the running backs); a defense's figures are what the offenses it faced produced in its games in the window. DraftKings Classic points computed from the same plays (D194). Every figure is per game except Yds/opp, receiving plus rushing yards over targets plus carries.</p>
  </section>`;
}
