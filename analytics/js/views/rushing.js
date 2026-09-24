// Rushing: the rushing leaderboard (#/rushing). Every man with a carry (backs and fullbacks by default; QBs and
// receivers on the position chips). D177: efficiency (EPA/carry, success, YPC and over expected) with a league
// reference beside every rate and a total for anything weekly; rush direction was dropped by Adam. D182: a back
// leads with opportunity and involvement, so the Volume group opens the table and an Involvement group (snap %,
// routes, targets, target share) closes it. Every figure comes from agg_rush.js (pure); this file draws, sorts and
// wires clicks. The weekly strips and the team pill are qb.js's, shared.
import { fromQuery, toQuery, seasonsOf, weekLabel, POSITIONS, DEFAULT_POS } from "../filters.js";
import { loadFor, loadTeams, displayName } from "../data.js";
import { clubGames, tierNote, TIER_NAMES, MIN_POOL, POOL_PER_GAME, POOL_FLOOR } from "../agg.js";
import { aggregateRush, rushReference, rushTier, sortRushRows, rushOpts, rushQueryFrom, samePos, RUSH_DEFAULT_POS, RUSH_MIN_CAR, RUSH_TIER_KEYS, BIN_LABELS, GOAL_LINE } from "../agg_rush.js";
import { renderFilterBar } from "../filterbar.js";
import { esc, NA, isNum, pct, fix, signed, int, teamPill, qbStrips, seasonLabel } from "./qb.js";

const COLS = [
  { k: "car", h: "Car", t: "Carries: designed runs, plus scrambles for a quarterback", f: int, grp: "v" },
  { k: "carG", h: "Car/g", t: "Carries per game he played", f: (v) => fix(v, 1), grp: "v", bar: 22 },
  { k: "rushShare", h: "Rush %", t: "Rush share: his designed runs / his club's designed runs in his games (scrambles are called passes: on neither side)", f: (v) => pct(v), grp: "v", bar: 0.8 },
  { k: "yds", h: "Yds", t: "Rushing yards", f: int, grp: "v" },
  { k: "ypc", h: "YPC", t: "Yards per carry", f: (v) => fix(v, 1), grp: "e" },
  { k: "succPct", h: "Succ %", t: "Share of his carries that were successful plays (nflverse success)", f: (v) => pct(v, 0), grp: "e" },
  { k: "epaCar", h: "EPA/car", t: "Expected points added per carry", f: (v) => signed(v, 2), grp: "e" },
  { k: "ryoeAtt", h: "RYOE/att", t: "NGS rush yards over expected per carry (the weeks NGS lists him)", f: (v) => signed(v, 2), grp: "e" },
  { k: "eff", h: "Eff", t: "NGS efficiency: distance run per rushing yard; lower is more north-south (weighted by his carries each week)", f: (v) => fix(v, 2), grp: "e" },
  { k: "rz", h: "RZ", t: "Red-zone carries (opponent's 20 or closer)", f: int, grp: "z" },
  { k: "gl", h: "GL", t: `Goal-line carries (opponent's ${GOAL_LINE} or closer)`, f: int, grp: "z" },
  { k: "td", h: "TD", t: "Rushing touchdowns", f: int, grp: "z" },
  { k: "long", h: "Long", t: "Longest carry", f: int, grp: "b" },
  { k: "explPct", h: "Expl %", t: "Explosive rate: carries of 10+ yards / carries", f: (v) => pct(v, 0), grp: "b" },
  { k: "snapPct", h: "Snap %", t: "Share of his club's offensive snaps (nflverse snap counts)", f: (v) => pct(v, 0), grp: "i", bar: 1 },
  { k: "routes", h: "Routes", t: "Routes run (heatradar, charted; weeks under 8 routes are not listed)", f: int, grp: "i" },
  { k: "tgt", h: "Tgt", t: "Targets (the Usage page's count)", f: int, grp: "i" },
  { k: "tgtShare", h: "Tgt %", t: "Target share: his targets / his club's pass attempts in his games", f: (v) => pct(v), grp: "i", bar: 0.3 },
];
const GROUPS = [["v", "Volume"], ["e", "Efficiency"], ["z", "Scoring zone"], ["b", "Big plays"], ["i", "Involvement"]];
COLS.forEach((c, i) => { c.gs = i === 0 || COLS[i - 1].grp !== c.grp; });
const TIERED = new Set(RUSH_TIER_KEYS);
const SORTABLE = new Set([...COLS.map((c) => c.k), "name", "g"]);
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
      ${tile("YPC", fix(r.ypc, 1), "ypc", fix(L.ypc, 1))}${tile("EPA/car", signed(r.epaCar, 2), "epaCar", signed(L.epaCar, 2))}
      ${tile("Succ %", pct(r.succPct, 0), "succPct", pct(L.succPct, 0))}${tile("Expl %", pct(r.explPct, 0), "explPct", pct(L.explPct, 0))}
      ${tile("RYOE/att", signed(r.ryoeAtt, 2), "ryoeAtt", signed(L.ryoeAtt, 2), "NGS rush yards over expected per carry")}${tile("Eff", fix(r.eff, 2), "eff", fix(L.eff, 2), "NGS efficiency: lower is more north-south")}
    </div></div>
    <div class="an-dcol"><div class="an-dh">Involvement</div><div class="an-dtiles">
      ${tile("Snap %", pct(r.snapPct, 0), "snapPct", pct(L.snapPct, 0))}${tile("Rush %", pct(r.rushShare), "rushShare", pct(L.rushShare))}
      ${tile("Tgt %", pct(r.tgtShare), "tgtShare", pct(L.tgtShare))}${tile("Targets", int(r.tgt), "", fix(L.tgt, 1))}
      ${tile("Routes", int(r.routes), "", fix(L.routes, 0), "heatradar, charted")}${tile("Car/g", fix(r.carG, 1), "carG", fix(L.carG, 1))}
      <div class="an-dlinks"><a href="#/player/${encodeURIComponent(r.gsis)}${q ? "?" + q : ""}">Player page →</a><a href="${depth}" target="_blank" rel="noopener">Depth chart ↗</a></div>
    </div></div></div>`;
}

export const rushAnchor = { id: null, top: null };

// PURE (no DOM): the table's markup. view: { ref (rushReference), windowName, teams, minCar }.
export function rushTableHtml(allRows, st, query, view = {}) {
  const sortKey = SORTABLE.has(st.sort) ? st.sort : "car";
  const minCar = view.minCar ?? RUSH_MIN_CAR;
  const rows = sortRushRows(allRows.filter((r) => r.car >= minCar), sortKey, st.dir);
  const q = query || "", ref = view.ref;
  const nCols = 3 + COLS.length + 1;
  const th = (k, h, t, cls = "") => `<th class="${cls}${sortKey === k ? " sorted " + st.dir : ""}" data-sort="${k}" title="${esc(t)}">${h}</th>`;
  const groupRow = `<tr class="an-grp"><th colspan="3"></th>${GROUPS.map(([g, l]) => `<th colspan="${COLS.filter((c) => c.grp === g).length}" class="g-${g} gs">${l}</th>`).join("")}<th></th></tr>`;
  const head = `<tr>${th("rank", "#", "Rank", "c-rank")}${th("name", "Player", "Player, team, position", "c-name")}${th("g", "G", "Games in the window")}${COLS.map((c) => th(c.k, c.h, c.t, "g-" + c.grp + (c.gs ? " gs" : ""))).join("")}<th class="c-spark" title="Weekly carries; dashed: his position's carries per game; hover a point for the week">Carries by week</th></tr>`;
  const cell = (c, r) => {
    const v = r[c.k], P = ref?.at(r.pos);
    const tier = TIERED.has(c.k) ? rushTier(c.k, v, P?.cuts) : "";
    let title = TIERED.has(c.k) && isNum(v) ? tierNote(P?.cuts?.[c.k], r.pos) : "";
    if (c.k === "car" && r.scr) title = `${r.des} designed runs, ${r.scr} scrambles`;
    const bar = c.bar && isNum(v) ? `<i class="an-bar" style="width:${Math.min(100, (v / c.bar) * 100).toFixed(1)}%"></i>` : "";
    return `<td class="num g-${c.grp}${c.gs ? " gs" : ""}${tier ? " t-" + tier : ""}${bar ? " has-bar" : ""}"${title ? ` title="${esc(title)}"` : ""}>${bar}<span>${c.f(v)}</span></td>`;
  };
  const body = rows.map((r, i) => {
    const open = st.open === r.gsis;
    const depth = `../#/team/${encodeURIComponent(r.team)}/player/${encodeURIComponent(r.gsis)}`;
    return `<tr class="an-row${open ? " open" : ""}" data-id="${esc(r.gsis)}" tabindex="0" aria-expanded="${open}">
      <td class="c-rank">${i + 1}</td>
      <td class="c-name"><a class="an-pname" href="#/player/${encodeURIComponent(r.gsis)}${q ? "?" + q : ""}">${esc(r.name)}</a>${teamPill(r.team, view.teams, q)}<span class="an-pospill" data-band="${BAND(r.pos)}">${esc(r.pos)}</span><a class="an-dc" href="${depth}" target="_blank" rel="noopener" title="Open his depth-chart card in a new tab" aria-label="Depth chart">↗</a></td>
      <td class="num">${r.g}</td>
      ${COLS.map((c) => cell(c, r)).join("")}
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
  return { st, minCar: o.minCar };
}
export const rushQuery = (st, minCar) => rushQueryFrom(toQuery(st), st, minCar);

export async function renderRushing(ctx, query) {
  const { root, asof, isCurrent } = ctx;
  const { st, minCar } = rushState(query);
  document.title = "Rushing · NFL Analytics";
  const go = (n, mc = minCar) => {
    // The filter bar's Reset returns Usage's default positions (WR/TE/RB); a chip click changes one position, so a
    // jump to exactly that set that changes more than one is the Reset: send it to the rushing default instead.
    const diff = POSITIONS.filter((p) => (n.pos[p] || "") !== (st.pos[p] || "")).length;
    if (diff > 1 && samePos(n.pos, DEFAULT_POS)) n = { ...n, pos: { ...RUSH_DEFAULT_POS } };
    const q = rushQuery(n, mc); location.hash = `#/rushing${q ? "?" + q : ""}`;
  };
  if (!root.querySelector(".an-rush")) root.innerHTML = `<div class="an-msg">Loading rushing…</div>`;
  let data, teams;
  try {
    [data, teams] = await Promise.all([loadFor(seasonsOf(st), st), loadTeams().then((j) => j.teams || []).catch(() => [])]);
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
  // League references and tier cuts always come from the whole league at every position, the same window.
  const ref = rushReference(aggregateRush(data.blocks, data.players, { ...st, team: "", opp: "", pos: {} }).rows);
  for (const r of agg.rows) r.name = displayName(r.gsis, data.players);
  const weeks = agg.weeks;
  const windowName = st.window === "last3" ? "Last 3" : st.window === "range" && weeks.length ? `${weekLabel(weeks[0], st.season)}–${weekLabel(weeks[weeks.length - 1], st.season)}` : "Season";
  const clubTeams = [...new Set(clubGames(data.blocks).map((g) => g.team))].sort();
  const teamsByAbbr = new Map(teams.map((t) => [t.abbr, t]));
  if (asof) {
    const m = data.manifests.find((x) => x.season === st.season) || data.manifests[0];
    const last = (m?.weeks || []).reduce((a, b) => (!a || b.week > a.week ? b : a), null);
    asof.textContent = last ? `Through W${last.week}` : ""; asof.hidden = !last;
  }
  const shownPos = POSITIONS.filter((p) => agg.rows.some((r) => r.pos === p));
  const refLine = `League reference and colour tiers, by position: players at his position with ${POOL_PER_GAME}+ carries/game (min ${POOL_FLOOR}) in the window (${shownPos.map((p) => `${p}s ${ref.at(p).n}`).join(" · ") || "none"})`;
  const posText = POSITIONS.filter((p) => st.pos[p] === "in").join(" · ") || "All positions";
  const exText = POSITIONS.filter((p) => st.pos[p] === "out");
  const qs = rushQuery({ ...st, open: "" }, minCar);
  root.innerHTML = `<section class="an-rush">
    <div class="an-head">
      <h1>Rushing</h1>
      <div class="an-sub">${esc(seasonLabel(st))} · ${esc(windowText(st, weeks))} · ${esc(posText)}${exText.length ? ` · excluding ${esc(exText.join(", "))}` : ""}${st.team ? ` · ${esc(st.team)}` : ""}${st.opp ? ` · vs ${esc(st.opp)}` : ""}</div>
      ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    </div>
    <div class="an-sub an-ref">${esc(refLine)}</div>
    <div class="an-filters"></div>
    <div class="an-tablewrap"></div>
    <p class="an-foot">Carries, yards, TD, EPA, success, red-zone and goal-line carries, long and explosive runs, rush share, targets and target share: nflverse play-by-play (a quarterback's carries include scrambles; rush share counts designed runs only). Rush yards over expected and efficiency: Next Gen Stats. Snaps: nflverse snap counts. Routes: heatradar.app (charted). Fumbles are not in the ledger.</p>
  </section>`;
  renderFilterBar(root.querySelector(".an-filters"), st, { keys: data.keys, teams: clubTeams }, (n) => go(n));
  const el = root.querySelector(".an-tablewrap");
  el.innerHTML = rushTableHtml(agg.rows, st, qs, { ref, windowName, teams: teamsByAbbr, minCar });
  el.querySelectorAll("th[data-sort]").forEach((h) => h.addEventListener("click", () => {
    const k = h.dataset.sort === "rank" ? "car" : h.dataset.sort;
    const cur = SORTABLE.has(st.sort) ? st.sort : "car";
    const dir = cur === k ? (st.dir === "desc" ? "asc" : "desc") : k === "name" ? "asc" : "desc";
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
}
