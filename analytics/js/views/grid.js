// Team grid (#/grid, TEAMS group; D195). 32 rows, one column per category per side of the ball under an OFFENSE and a
// DEFENSE band. Each cell carries the club's 0-100 rating (50 at the clubs' mean, 15 per standard deviation, higher
// always better; agg_grid.js) in large type on a continuous poor-to-elite colour, with the figure and its rank small
// underneath; the Rank view swaps the big number to the rank on a plain one-hue ramp. Every number is formatted through
// agg_grid.js's displayed(v, f), so the text and the rank's tie rule share one rounding. The cells come from
// aggregateTeams() rows, so every figure equals the one the Offense and Defense pages show.
// Under the grid, D196's "What each defense allows, by position" (views/allowed_table.js; Adam, 2026-09-25: on this
// page, not the Defense page), on the same filters and window; its own sort (psort, pdir) and vs-usual switch (vs=1)
// ride in the same hash. The Rating / Rank switch is the grid's only.
import { fromQuery, toQuery, seasonsOf, weekLabel, defaultState } from "../filters.js";
import { loadFor, loadTeams } from "../data.js";
import { aggregateTeams } from "../agg_team.js";
import { allowedByPosition, allowedVsUsual } from "../agg_allowed.js";
import { gridRows, GRID_CATEGORIES, displayed } from "../agg_grid.js";
import { renderFilterBar } from "../filterbar.js";
import { esc, teamPill, pfrNote, seasonLabel } from "./qb.js";
import { teamPageState, ordinal } from "./team.js";
import { allowedState, allowedQuery, posCells, allowedSectionHtml, posBestDir } from "./allowed_table.js";

const SIDES = [["off", "Offense"], ["def", "Defense"]];
const PFR = /PFR/;
// What a proxy figure stands in for, and who else is in it (the category notes, in a few words for the hover).
// Each string is quoted from its category's note in agg_grid.js (a test pins that).
export const PROXY_TEXT = {
  passPro: "proxy for the line: the quarterback, backs and tight ends share the blame",
  runBlock: "proxy for the line: the back's vision is in it",
};

// The columns in page order: every category on offense, then every category on defense. A category with no figure
// on a side has no column there (Coverage is defense only; Adam, 2026-09-25: no empty offense column).
export const GRID_COLUMNS = SIDES.flatMap(([side]) => GRID_CATEGORIES.filter((c) => c[side]).map((c) => ({
  key: `${c.key}${side === "off" ? "Off" : "Def"}`, cat: c, side,
  label: side === "off" ? c.offLabel || c.label : c.defLabel || c.label,
  lead: c[side].find((f) => f.lead) || c[side][0],
})));
const COL_KEYS = new Set(GRID_COLUMNS.map((c) => c.key));
export const DEFAULT_SORT = "overallOff";

// Where a rating sits on the colour scale, 0 (poor) to 1 (elite): the ends are at 20 and 80 (two deviations either
// side of the mean), so the best club in a normal spread reads elite green and the worst red.
export const gridStop = (rating) => (Number.isFinite(rating) ? Math.min(1, Math.max(0, (rating - 20) / 60)) : null);
// The tile's colour strength over the dark panel, in percent: 22 at average, 72 at either end, rising quickly away
// from the middle (computed here rather than with CSS sqrt(), so an older browser keeps the colour).
export const tileAmt = (g) => 22 + 50 * Math.sqrt(Math.abs(2 * g - 1));

// One figure as text, through displayed(): digits as the category table says, a sign where the figure is signed
// (a true minus sign), a % where it is a percentage.
export function figText(v, f) {
  if (v === null || v === undefined || !Number.isFinite(+v)) return "–";
  let x = displayed(+v, f);
  if (Object.is(x, -0)) x = 0;
  const body = Math.abs(x).toFixed(f.digits);
  const sign = f.signed ? (x > 0 ? "+" : x < 0 ? "−" : "") : x < 0 ? "−" : "";
  return `${sign}${body}${f.pct ? "%" : ""}`;
}

// The page's view state from the hash: sort (a column key or "team"), dir ("desc" = best first for a column, A to Z
// for the club column's "asc"), mode ("rating" or "rank"; hash view=rank), al (the by-position table's allowedState:
// its sort, dir and vs).
export function gridState(query) {
  const q = new URLSearchParams(String(query || "").replace(/^\?/, ""));
  const st = fromQuery(query);
  const has = q.has("sort") && (COL_KEYS.has(st.sort) || st.sort === "team");
  const sort = has ? st.sort : DEFAULT_SORT;
  // toQuery leaves out "desc" (the app default), so a missing dir reads as desc.
  const dir = has ? st.dir : "desc";
  return { st, sort, dir, mode: q.get("view") === "rank" ? "rank" : "rating", al: allowedState(query) };
}
// The hash for a state: the filters, the sort, view=rank when the Rank view is on, then the by-position table's keys
// (al; omitted = its defaults).
export function gridQuery(st, sort, dir, mode, al) {
  return [toQuery({ ...st, open: "", sort, dir }), mode === "rank" ? "view=rank" : "", al ? allowedQuery(al) : ""].filter(Boolean).join("&");
}

const cellOf = (r, col) => r.cells?.[col.cat.key]?.[col.side] || null;
// Sorted copy. A column sorts on the rating (rating view) or the rank (rank view), best first for "desc"; clubs with
// no figure always sink to the bottom; ties fall back to the club's abbreviation. The club column sorts by name.
export function sortGrid(rows, sort, dir, mode, teams) {
  const name = (r) => String(teams?.get(r.team)?.nickname || teams?.get(r.team)?.name || r.team);
  const col = GRID_COLUMNS.find((c) => c.key === sort);
  const list = [...rows];
  if (!col) {
    const s = dir === "desc" ? -1 : 1;
    return list.sort((a, b) => s * name(a).localeCompare(name(b)) || a.team.localeCompare(b.team));
  }
  // "Goodness" of a cell: higher is better in both views.
  const good = (r) => { const c = cellOf(r, col); if (!c || c.rating === null || c.rating === undefined) return null; return mode === "rank" ? -c.rank : c.rating; };
  const s = dir === "asc" ? -1 : 1;
  return list.sort((a, b) => {
    const x = good(a), y = good(b);
    if (x === null || y === null) return (x === null) - (y === null) || a.team.localeCompare(b.team);
    // Equal ratings fall back to the rank (the unrounded order), equal ranks to the rating, then the club.
    const ca = cellOf(a, col), cb = cellOf(b, col);
    return s * (y - x) || s * (mode === "rank" ? cb.rating - ca.rating : ca.rank - cb.rank) || a.team.localeCompare(b.team);
  });
}

// The hover for one cell: the side and category, every figure (label: value, its rank), the source, the proxy flag.
function cellTitle(col, c) {
  const figs = col.cat[col.side];
  const lines = [`${col.side === "off" ? "Offense" : "Defense"} · ${col.label}`];
  if (c && c.value !== null) lines.push(`Rating ${c.rating} (50 = league average) · rank ${ordinal(c.rank)} of ${c.n}`);
  for (const f of figs) {
    const x = c?.figs?.[f.k];
    const has = x && x.value !== null && x.value !== undefined;
    lines.push(`${f.label}: ${has ? `${figText(x.value, f)} (${ordinal(x.rank)})` : "not yet"}${f.lead ? " — leads" : ""}`);
  }
  lines.push(`Source: ${col.cat.source}`);
  if (figs.some((f) => f.proxy)) lines.push(PROXY_TEXT[col.cat.key] || "proxy");
  return lines.join("\n");
}
const ordHtml = (n) => { const o = ordinal(n); return `${n}<small>${esc(o.slice(String(n).length))}</small>`; };

function cellHtml(col, c, mode) {
  const first = col === GRID_COLUMNS.find((x) => x.side === "def");
  const cls = `c-gc${first ? " gs" : ""}`;
  const title = esc(cellTitle(col, c));
  if (!c || c.value === null || c.value === undefined) {
    return `<td class="${cls}" title="${title}"><div class="gc gc-null"><b>not yet</b></div></td>`;
  }
  const fig = figText(c.value, col.lead);
  if (mode === "rank") {
    const ramp = c.n > 1 ? (c.n - c.rank) / (c.n - 1) : 1;
    return `<td class="${cls}" title="${title}"><div class="gc gc-rank" style="--r:${ramp.toFixed(3)}"><b>${ordHtml(c.rank)}</b><span>${esc(fig)} · ${c.rating}</span></div></td>`;
  }
  return `<td class="${cls}" title="${title}"><div class="gc" style="--g:${gridStop(c.rating).toFixed(3)};--amt:${tileAmt(gridStop(c.rating)).toFixed(1)}%"><b>${c.rating}</b><span>${esc(fig)} · ${esc(ordinal(c.rank))}</span></div></td>`;
}

// PURE (no DOM): the table's markup. rows = gridRows(); view: { teams (Map abbr -> club), q (the filters' query for
// the club links), sort, dir, mode }.
export function gridTableHtml(rows, view) {
  const { sort, dir, mode, q = "" } = view;
  const list = sortGrid(rows, sort, dir, mode, view.teams);
  const nOff = GRID_COLUMNS.filter((c) => c.side === "off").length, nDef = GRID_COLUMNS.length - nOff;
  const arrow = (k) => (sort === k ? ` sorted ${dir}` : "");
  const band = `<tr class="an-grp"><th class="c-club"></th><th colspan="${nOff}" class="g-off">Offense</th><th colspan="${nDef}" class="g-def gs">Defense</th></tr>`;
  const head = `<tr><th class="c-club${arrow("team")}" data-sort="team" title="Sort by club">Club</th>${GRID_COLUMNS.map((col, i) => {
    const gs = col.side === "def" && GRID_COLUMNS[i - 1]?.side === "off" ? " gs" : "";
    const lower = (col.lead.dir || 1) === -1;
    const proxy = col.cat[col.side].some((f) => f.proxy);
    const t = `${col.label}: ${col.lead.label} leads${lower ? " (lower is better)" : " (higher is better)"}. ${col.cat.note} Source: ${col.cat.source}.${proxy ? ` ${PROXY_TEXT[col.cat.key] || "proxy"}.` : ""} Click to sort by ${mode === "rank" ? "rank" : "rating"}.`;
    return `<th class="c-gh${gs}${arrow(col.key)}" data-sort="${col.key}" title="${esc(t)}"><span class="gh-l">${esc(col.label)}</span><span class="gh-f">${esc(col.lead.label)}${proxy ? ` <em>proxy</em>` : ""}</span></th>`;
  }).join("")}</tr>`;
  const body = list.map((r) => {
    const t = view.teams?.get(r.team);
    const nm = t?.nickname || t?.name || "";
    return `<tr class="an-grow"><td class="c-club">${teamPill(r.team, view.teams, q)}${nm ? `<span class="gc-name">${esc(nm)}</span>` : ""}</td>${GRID_COLUMNS.map((col) => cellHtml(col, cellOf(r, col), mode)).join("")}</tr>`;
  }).join("");
  return `<div class="an-tscroll"><table class="an-table an-grid-table${mode === "rank" ? " rank" : ""}"><thead>${band}${head}</thead><tbody>${body || `<tr><td colspan="${GRID_COLUMNS.length + 1}" class="an-empty">No games in this window.</td></tr>`}</tbody></table></div>`;
}

// PURE: the Rating / Rank switch and the legend line under the header. pnote = pfrNote()'s text or "".
export function gridBarHtml(mode, pnote) {
  const seg = `<div class="an-seg" data-gmode>${[["rating", "Rating"], ["rank", "Rank"]].map(([v, l]) => `<button type="button" data-v="${v}" class="${mode === v ? "on" : ""}" aria-pressed="${mode === v}">${l}</button>`).join("")}</div>`;
  const legend = mode === "rank"
    ? `<span class="gl-ramp rank"><i></i></span><span>Rank among the clubs in this window, 1st brightest; small: the figure and the rating (50 is the league average)</span>`
    : `<span class="gl-ramp"><i></i></span><span>50 is the league average, 15 points per standard deviation among the clubs in this window; colour runs poor to elite. Small: the figure and its rank</span>`;
  return `<div class="an-tbar an-gbar">${seg}<span class="an-glegend">${legend}</span>${pnote ? `<span class="an-gpfr">${esc(pnote)}</span>` : ""}</div>`;
}

// Does any PFR-sourced figure carry a value on the page? (The lag note shows only then.)
export function hasPfrFigure(rows) {
  return rows.some((r) => GRID_COLUMNS.some((col) => col.cat[col.side].some((f) => PFR.test(f.source || "") && Number.isFinite(r.cells?.[col.cat.key]?.[col.side]?.figs?.[f.k]?.value))));
}

export async function renderGrid(ctx, query) {
  const { root, asof, isCurrent } = ctx;
  const { st, sort, dir, mode, al } = gridState(query);
  document.title = "Grid · NFL Analytics";
  const go = (n, s = sort, d = dir, m = mode, a = al) => { const q = gridQuery(n, s, d, m, a); location.hash = `#/grid${q ? "?" + q : ""}`; };
  if (!root.querySelector(".an-grid")) root.innerHTML = `<div class="an-msg">Loading the team grid…</div>`;
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
  const pst = teamPageState(st);
  const agg = aggregateTeams(data.blocks, data.players, pst);
  const rows = gridRows(agg);
  // The by-position table on the grid's own club-level state, so both tables cover the same games.
  const allowed = allowedByPosition(data.blocks, data.players, pst);
  const usual = al.vs ? allowedVsUsual(data.blocks, data.players, pst) : null;
  const pnote = hasPfrFigure(rows) ? pfrNote(agg.pfrThrough, agg.latestKey, st.season) : "";
  if (asof) {
    const m = data.manifests.find((x) => x.season === st.season) || data.manifests[0];
    const last = (m?.weeks || []).reduce((a, b) => (!a || b.week > a.week ? b : a), null);
    asof.textContent = last ? `Through W${last.week}` : ""; asof.hidden = !last;
  }
  // The club links carry the filters, not the grid's sort (the team page has its own).
  const d0 = defaultState();
  const linkQ = toQuery({ ...st, open: "", sort: d0.sort, dir: d0.dir });
  const span = agg.weeks.length ? (agg.weeks.length === 1 ? weekLabel(agg.weeks[0], st.season) : `${weekLabel(agg.weeks[0], st.season)} to ${weekLabel(agg.weeks[agg.weeks.length - 1], st.season)}`) : "no games";
  root.innerHTML = `<section class="an-grid">
    <div class="an-head">
      <h1>Team grid</h1>
      <div class="an-sub">${esc(seasonLabel(st))} · ${esc(span)}${st.window === "last3" ? " (each club's last 3 games)" : ""} · ${rows.length} clubs</div>
      ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    </div>
    <div class="an-filters"></div>
    ${gridBarHtml(mode, pnote)}
    <div class="an-tablewrap">${gridTableHtml(rows, { teams, q: linkQ, sort, dir, mode })}</div>
    <p class="an-foot">Every figure is the one the Offense and Defense pages show. EPA, rushing, stuffed runs, sacks and explosive plays: nflverse play-by-play. Pressure, hits, yards before contact and coverage: PFR advanced stats, about a week behind the games; a club PFR has not charted yet reads "not yet" and is left out of the ratings. Hover a cell for every figure behind it and its source.</p>
  </section>
  ${allowedSectionHtml(posCells(allowed, usual, al.vs), { teams, q: linkQ, sort: al.sort, dir: al.dir, vs: al.vs, audit: allowed })}`;
  renderFilterBar(root.querySelector(".an-filters"), { ...st, sort, dir }, { keys: data.keys, teams: [] }, (n) => go(n));
  root.querySelectorAll("[data-gmode] button").forEach((b) => b.addEventListener("click", () => { if (b.dataset.v !== mode) go(st, sort, dir, b.dataset.v); }));
  root.querySelectorAll(".an-grid-table th[data-sort]").forEach((h) => h.addEventListener("click", () => {
    const k = h.dataset.sort;
    const first = k === "team" ? "asc" : "desc";
    go(st, k, sort === k ? (dir === "desc" ? "asc" : "desc") : first);
  }));
  const sec = root.querySelector(".an-gallow");
  sec.querySelectorAll("[data-dvs] button").forEach((b) => b.addEventListener("click", () => { const v = b.dataset.v === "1"; if (v !== al.vs) go(st, sort, dir, mode, { ...al, vs: v }); }));
  sec.querySelectorAll(".an-dpos-table th[data-sort]").forEach((h) => h.addEventListener("click", () => {
    const k = h.dataset.sort;
    go(st, sort, dir, mode, { ...al, sort: k, dir: al.sort === k ? (al.dir === "desc" ? "asc" : "desc") : posBestDir(k) });
  }));
}
