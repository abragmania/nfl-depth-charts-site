// The usage leaderboard table: sortable columns, a minimum-targets box, the depth charts' five rating-tier
// colours on the share and efficiency columns, a weekly target-share sparkline per row, and a row that
// expands in place (one at a time, its gsis kept in the hash as `open`) into the player's weekly share bars
// and his target-zone grid. Inline SVG only, no library.
//
// RULES FOR EVERY CHART IN THIS APP (Adam, 2026-09-24; later screens follow them too):
// 1. PERSPECTIVE: a rate is never drawn alone. Show the league average for the same window and positions
//    beside it (a dashed "lg avg 18%" line on bars, "· lg 18.4" beside a stat), so good or bad reads at a glance.
// 2. TOTALS: anything broken down by week also prints its window total. A share totals by weighting (his
//    targets / the club attempts over the window), never as a mean of the weekly percentages.
import { sortRows, tierFromCuts, tierNote, TIER_NAMES, USAGE_TIER_KEYS, MIN_POOL } from "./agg.js";
import { weekLabel, POSITIONS } from "./filters.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DASH = `<span class="an-na">–</span>`;

// Copied two-line rule from public/js/landing.js's isLightWash (relative luminance of the team's primary
// colour decides light or dark ink for the team pill below): keep the two in step if that threshold ever
// changes, same as analytics.css already does for its copied colour tokens.
function luminance(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
const isLightWash = (primary) => (luminance(primary) ?? 0) > 0.40;

// The team abbreviation as a small pill in the team's own colours (primary background, readable ink).
// `teams` is the Map<abbr, {colourPrimary, colourSecondary}> from public/js/api.js's getTeams(), or empty
// if that load failed; an unknown abbr falls back to the neutral colours set on .an-teampill itself.
function teamPill(abbr, teams, q) {
  const t = teams?.get(abbr);
  const style = t ? ` style="--team-bg:${esc(t.colourPrimary)};--team-ink:${isLightWash(t.colourPrimary) ? "#14181d" : "#fff"}"` : "";
  return `<a class="an-teampill" href="#/team/${esc(abbr)}${q ? "?" + q : ""}"${style}>${esc(abbr)}</a>`;
}
const pct = (v, d = 1) => (v === null || v === undefined ? DASH : (v * 100).toFixed(d));
const fix = (v, d) => (v === null || v === undefined ? DASH : (+v).toFixed(d));
const signed = (v, d) => (v === null || v === undefined ? DASH : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d));
const int = (v) => (v === null || v === undefined ? DASH : String(Math.round(v)));

// Tier colours (Adam, 2026-09-24): POSITION-SPECIFIC. `cuts` is one position's map from agg.js's
// usageReference(...).at(pos).cuts (or the rushing block's): each metric cut at that position's reference-pool
// 90th, 70th, 40th and 15th percentiles over the window, so a back's 20% target share reads elite among backs.
// No cuts (or too small a pool league-wide as well) leaves the value uncoloured.
export const tierOf = (key, v, cuts) => tierFromCuts(v, cuts?.[key]?.cuts);
const TIER_KEYS = new Set(USAGE_TIER_KEYS);

// Columns. `bar` draws a magnitude bar behind the number (the share columns, scaled to `max`).
const COLS = [
  { k: "tgt", h: "Tgt", t: "Targets", f: int, grp: "t" },
  { k: "tgtShare", h: "Tgt %", t: "Target share: his targets / his club's pass attempts in his games", f: (v) => pct(v), grp: "t", bar: 0.4 },
  { k: "ay", h: "AY", t: "Air yards on his targets", f: int, grp: "t" },
  { k: "ayShare", h: "AY %", t: "Air-yards share: his air yards / his club's air yards in his games", f: (v) => pct(v), grp: "t", bar: 0.55 },
  { k: "wopr", h: "WOPR", t: "Weighted opportunity: 1.5 x target share + 0.7 x air-yards share", f: (v) => fix(v, 2), grp: "t", bar: 0.9 },
  { k: "adot", h: "aDOT", t: "Average depth of target (air yards per target)", f: (v) => fix(v, 1), grp: "t" },
  { k: "rz", h: "RZ", t: "Red-zone targets (inside the 20)", f: int, grp: "t" },
  { k: "ez", h: "EZ", t: "End-zone targets", f: int, grp: "t" },
  { k: "rec", h: "Rec", t: "Receptions", f: int, grp: "p" },
  { k: "yds", h: "Yds", t: "Receiving yards", f: int, grp: "p" },
  { k: "td", h: "TD", t: "Receiving touchdowns", f: int, grp: "p" },
  { k: "epaTgt", h: "EPA/Tgt", t: "Expected points added per target", f: (v) => signed(v, 2), grp: "p" },
  { k: "routes", h: "Routes", t: "Routes run (heatradar, charted; weeks under 8 routes are not listed)", f: int, grp: "r" },
  { k: "routePct", h: "Rt %", t: "Route participation: routes / club dropbacks", f: (v) => pct(v, 0), grp: "r", bar: 1 },
  { k: "tprr", h: "TPRR", t: "Targets per route run", f: (v) => fix(v, 2), grp: "r" },
  { k: "yprr", h: "YPRR", t: "Receiving yards per route run", f: (v) => fix(v, 2), grp: "r" },
  { k: "snapPct", h: "Snap %", t: "Share of his club's offensive snaps (nflverse snap counts)", f: (v) => pct(v, 0), grp: "s", bar: 1 },
];
const GROUPS = [["t", "Opportunity"], ["p", "Production"], ["r", "Routes · heatradar"], ["s", "Snaps"]];
// First column of each group gets a hairline on its left (class gs).
COLS.forEach((c, i) => { c.gs = i === 0 || COLS[i - 1].grp !== c.grp; });
const BAND = (pos) => (pos === "RB" || pos === "FB" ? "BACKFIELD" : pos);

// D182 (Adam, 2026-09-24): air yards are not relevant for a running back. When the position chips leave only
// RB visible, the AY, AY %, WOPR and aDOT columns are dropped from the table entirely; in a mixed view they
// stay (perspective for the WRs and TEs on the same page), but an RB's own row prints a dash in them rather
// than a real-but-misleading number. Exported (pure) so tests can check both without a DOM.
const AY_ONLY_KEYS = new Set(["ay", "ayShare", "wopr", "adot"]);
export const rbOnlyMode = (pos) => Boolean(pos?.RB === "in" && !POSITIONS.some((p) => p !== "RB" && pos[p] === "in"));

// ---- inline SVG ----------------------------------------------------------------------------------------
export function sparkline(series, st) {
  const W = 84, H = 22, pad = 3;
  const vals = series.map((s) => s.v);
  const max = Math.max(0.35, ...vals.filter((v) => v !== null));
  const n = series.length;
  const x = (i) => (n <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1));
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  let d = "", pen = false;
  series.forEach((s, i) => {
    if (s.v === null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(s.v).toFixed(1)}`; pen = true;
  });
  const hit = series.map((s, i) => {
    const w = n <= 1 ? W : (W - 2 * pad) / (n - 1);
    const lab = `${weekLabel(s.key, st.season)}: ${s.v === null ? "did not play" : `${(s.v * 100).toFixed(1)}% (${s.tgt} tgt)`}`;
    return `<g class="an-sp-pt"><rect x="${(x(i) - w / 2).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" fill="transparent"><title>${esc(lab)}</title></rect>`
      + (s.v === null ? "" : `<circle cx="${x(i).toFixed(1)}" cy="${y(s.v).toFixed(1)}" r="${i === n - 1 ? 2.4 : 1.6}"/>`) + `</g>`;
  }).join("");
  const ref = 0.2 <= max ? `<line class="an-sp-ref" x1="0" x2="${W}" y1="${y(0.2).toFixed(1)}" y2="${y(0.2).toFixed(1)}"/>` : "";
  return `<svg class="an-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Weekly target share">${ref}<path d="${d}"/>${hit}</svg>`;
}

// Small multiples: one strip per measure, a bar per week, each strip on its own scale, value on top.
// Each strip carries its window total on the left ("Season 35.1%": shares are total targets / total club
// attempts, from the row, never a mean of the weekly bars) and a dashed league-average line with its label.
function weeklyBars(row, st, P, windowName) {
  const lg = P?.lg, cuts = P?.cuts;
  const strips = [["v", "Target share", 0.5, "tgtShare"], ["ay", "Air-yards share", 0.7, "ayShare"], ["snap", "Snap share", 1, "snapPct"]];
  const n = row.series.length, bw = 30, gap = 8, lw = 118, sh = 46, rw = 74;
  const W = lw + n * (bw + gap) + rw, H = strips.length * (sh + 14) + 16;
  let g = "";
  strips.forEach(([k, label, scale, tierKey], si) => {
    const top = si * (sh + 14) + 12;
    const tot = row[tierKey], avg = lg?.overall?.[tierKey];
    g += `<text class="an-wb-lab" x="0" y="${top + sh / 2 - 3}">${label}</text>`
      + `<text class="an-wb-tot t-${tierOf(tierKey, tot, cuts)}" x="0" y="${top + sh / 2 + 12}">${esc(windowName)} ${tot === null || tot === undefined ? "–" : (tot * 100).toFixed(1) + "%"}</text>`
      + `<line class="an-wb-base" x1="${lw - 4}" x2="${W - rw + 4}" y1="${top + sh}" y2="${top + sh}"/>`;
    let avgSvg = ""; // drawn after the bars so the line reads across them
    if (avg !== null && avg !== undefined) {
      const ay = (top + sh - Math.min(1, avg / scale) * (sh - 12)).toFixed(1);
      avgSvg = `<line class="an-wb-avg" x1="${lw - 4}" x2="${W - rw + 4}" y1="${ay}" y2="${ay}"/><text class="an-wb-avglab" x="${W - rw + 8}" y="${+ay + 3.5}">lg avg ${Math.round(avg * 100)}%</text>`;
    }
    row.series.forEach((s, i) => {
      const v = s[k], bx = lw + i * (bw + gap);
      if (v === null || v === undefined) { g += `<text class="an-wb-na" x="${bx + bw / 2}" y="${top + sh - 3}">–</text>`; return; }
      const h = Math.max(1.5, Math.min(1, v / scale) * (sh - 12));
      g += `<rect class="an-wb-bar t-${tierOf(tierKey, v, cuts)}" x="${bx}" y="${(top + sh - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="3"><title>${esc(`${weekLabel(s.key, st.season)} ${label}: ${(v * 100).toFixed(1)}%`)}</title></rect>`
        + `<text class="an-wb-val" x="${bx + bw / 2}" y="${(top + sh - h - 3).toFixed(1)}">${Math.round(v * 100)}</text>`;
    });
    g += avgSvg;
  });
  row.series.forEach((s, i) => { g += `<text class="an-wb-wk" x="${lw + i * (bw + gap) + bw / 2}" y="${H - 1}">${esc(weekLabel(s.key, st.season))}</text>`; });
  return `<svg class="an-wbars" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Weekly shares">${g}</svg>`;
}

// D179 zone lines: deep 20+, intermediate 10-19, short 1-9, behind the line 0 or less; left, middle, right.
function zoneGrid(row) {
  const bands = [["D", "Deep 20+"], ["I", "Inter 10–19"], ["S", "Short 1–9"], ["B", "Behind LOS"]];
  const dirs = [["L", "Left"], ["M", "Middle"], ["R", "Right"]];
  const z = row.zones || {};
  const total = Object.values(z).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(z));
  const cell = (b, d) => {
    const n = z[b + d] || 0;
    const share = total ? n / total : 0;
    return `<div class="an-zc" style="--heat:${(n / max).toFixed(3)}" title="${n} targets (${(share * 100).toFixed(0)}% of his zoned targets)"><b>${n || ""}</b>${n ? `<small>${(share * 100).toFixed(0)}%</small>` : ""}</div>`;
  };
  return `<div class="an-zone"><div class="an-zone-h"></div>${dirs.map(([, l]) => `<div class="an-zone-h">${l}</div>`).join("")}`
    + bands.map(([b, l]) => `<div class="an-zone-r${b === "B" ? " los" : ""}">${l}</div>${dirs.map(([d]) => cell(b, d)).join("")}`).join("")
    + `</div>${total ? "" : `<div class="an-note">No targets with a depth and direction in this window.</div>`}`;
}

function detailHtml(row, st, q, P, windowName) {
  const L = P?.lg?.overall || {}, cuts = P?.cuts;
  const t = (k, v) => tierOf(k, v, cuts);
  const tile = (label, val, tier = "", avg = "") => `<div class="an-tile${tier ? " t-" + tier : ""}"><span>${label}</span><b>${val}</b>${avg && !avg.includes("an-na") ? `<em title="League average: ${esc(P?.text || "his position, same window")}"> · lg ${avg}</em>` : ""}</div>`;
  const depth = `../#/team/${encodeURIComponent(row.team)}/player/${encodeURIComponent(row.gsis)}`;
  return `<div class="an-detail-in">
    <div class="an-dcol"><div class="an-dh">Week by week</div>${row.series.length ? weeklyBars(row, st, P, windowName) : `<div class="an-note">No weeks in this window.</div>`}</div>
    <div class="an-dcol"><div class="an-dh">Target zones <span class="an-dsub">${row.tgt} targets</span></div>${zoneGrid(row)}</div>
    <div class="an-dcol an-dtiles">
      ${tile("Tgt %", pct(row.tgtShare), t("tgtShare", row.tgtShare), pct(L.tgtShare))}${tile("AY %", pct(row.ayShare), t("ayShare", row.ayShare), pct(L.ayShare))}
      ${tile("WOPR", fix(row.wopr, 2), t("wopr", row.wopr), fix(L.wopr, 2))}${tile("aDOT", fix(row.adot, 1), "", fix(L.adot, 1))}
      ${tile("EPA/Tgt", signed(row.epaTgt, 2), t("epaTgt", row.epaTgt), signed(L.epaTgt, 2))}${tile("YPRR", fix(row.yprr, 2), t("yprr", row.yprr), fix(L.yprr, 2))}
      <div class="an-dlinks"><a href="#/player/${encodeURIComponent(row.gsis)}${q ? "?" + q : ""}">Player page →</a><a href="${depth}" target="_blank" rel="noopener">Depth chart ↗</a></div>
    </div></div>`;
}

// The row the reader just clicked and where it sat on screen, so the re-render that follows can keep it there.
export const anchor = { id: null, top: null };

// ---- table ---------------------------------------------------------------------------------------------
// The table's markup as a pure string (no DOM): everything renderTable needs to know to decide what to show,
// split out so tests can check column visibility and RB dashing without a document. `view`: { ref
// (agg.usageReference over the league-wide rows: each row's league reference and tier cuts come from
// ref.at(row.pos)), windowName ("Season", "Last 3", "W1–W2"), teams }.
export function tableHtml(allRows, st, query, view = {}) {
  const rows = sortRows(allRows.filter((r) => r.tgt >= st.minTgt), st.sort, st.dir);
  const q = query || "";
  const teams = view.teams;
  // D182: RB-only views drop the air-yards columns entirely; a mixed view keeps them.
  const cols = rbOnlyMode(st.pos) ? COLS.filter((c) => !AY_ONLY_KEYS.has(c.k)) : COLS;
  // Player, team and Pos now share one cell (c-name), so the fixed columns are rank/player/games, not four.
  const nCols = 3 + cols.length + 1;
  const th = (k, h, t, cls = "") => `<th class="${cls}${st.sort === k ? " sorted " + st.dir : ""}" data-sort="${k}" title="${esc(t)}">${h}</th>`;
  const groupRow = `<tr class="an-grp"><th colspan="3"></th>${GROUPS.map(([g, l]) => `<th colspan="${cols.filter((c) => c.grp === g).length}" class="g-${g} gs">${l}</th>`).join("")}<th></th></tr>`;
  // The Tgt header says whether pass-interference targets are in the count (the "PI targets" switch below).
  const colTitle = (c) => (c.k === "tgt" ? `${c.t} (${st.pi === false ? "excludes" : "includes"} pass-interference targets)` : c.t);
  const head = `<tr>${th("rank", "#", "Rank", "c-rank")}${th("name", "Player", "Player, team, position", "c-name")}${th("g", "G", "Games in the window")}${cols.map((c) => th(c.k, c.h, colTitle(c), "g-" + c.grp + (c.gs ? " gs" : ""))).join("")}<th class="c-spark" title="Weekly target share; hover a point for the week">Tgt % by week</th></tr>`;
  const cell = (c, r) => {
    // D182: a mixed table keeps the air-yards columns for perspective, but an RB's own numbers there are not
    // meaningful, so his cells show a dash instead of the real (but misleading) figure.
    const v = AY_ONLY_KEYS.has(c.k) && r.pos === "RB" ? null : r[c.k];
    const P = view.ref?.at(r.pos);
    const tier = tierOf(c.k, v, P?.cuts);
    const note = TIER_KEYS.has(c.k) && v !== null && v !== undefined ? tierNote(P?.cuts?.[c.k], r.pos) : "";
    const bar = c.bar && v !== null && v !== undefined ? `<i class="an-bar" style="width:${Math.min(100, (v / c.bar) * 100).toFixed(1)}%"></i>` : "";
    return `<td class="num g-${c.grp}${c.gs ? " gs" : ""}${tier ? " t-" + tier : ""}${bar ? " has-bar" : ""}"${note ? ` title="${esc(note)}"` : ""}>${bar}<span>${c.f(v)}</span></td>`;
  };
  const body = rows.map((r, i) => {
    const open = st.open === r.gsis;
    const depth = `../#/team/${encodeURIComponent(r.team)}/player/${encodeURIComponent(r.gsis)}`;
    return `<tr class="an-row${open ? " open" : ""}" data-id="${esc(r.gsis)}" tabindex="0" aria-expanded="${open}">
      <td class="c-rank">${i + 1}</td>
      <td class="c-name"><a class="an-pname" href="#/player/${encodeURIComponent(r.gsis)}${q ? "?" + q : ""}">${esc(r.name)}</a>${teamPill(r.team, teams, q)}<span class="an-pospill" data-band="${BAND(r.pos)}">${esc(r.pos)}</span><a class="an-dc" href="${depth}" target="_blank" rel="noopener" title="Open his depth-chart card in a new tab" aria-label="Depth chart">↗</a></td>
      <td class="num">${r.g}</td>
      ${cols.map((c) => cell(c, r)).join("")}
      <td class="c-spark">${sparkline(r.series, st)}</td></tr>`
      + (open ? `<tr class="an-detail"><td colspan="${nCols}"><div class="an-detail-wrap">${detailHtml(r, st, q, view.ref?.at(r.pos), view.windowName || "Window")}</div></td></tr>` : "");
  }).join("");

  return `<div class="an-tbar">
      <label class="an-min">Min targets <input type="number" min="0" step="1" value="${st.minTgt}" data-min></label>
      <label class="an-switch" title="A defensive pass interference is a no-play in the play-by-play; on, it counts as a target for the receiver (never a pass attempt, catch or yards)"><input type="checkbox" data-pi${st.pi === false ? "" : " checked"}><span>${st.pi === false ? "excl. PI targets" : "PI targets"}</span></label>
      <span class="an-count">${rows.length} player${rows.length === 1 ? "" : "s"}</span>
      <span class="an-legend" title="The depth charts' rating colours on the share and efficiency columns, by position: each value against his own position's reference pool in this window (elite at its 90th percentile or above, then the 70th, 40th and 15th; low below). A position with under ${MIN_POOL} men in the pool uses the league-wide cuts for that column (hover the cell).">
        ${TIER_NAMES.map((t) => `<i class="t-${t}"></i>`).join("")}<span>elite → low by position</span></span>
      <span class="an-hint">Click a row to open it</span>
    </div>
    <div class="an-tscroll"><table class="an-table"><thead>${groupRow}${head}</thead><tbody>${body || `<tr><td colspan="${nCols}" class="an-empty">No players match these filters.</td></tr>`}</tbody></table></div>`;
}

// `onState(next)` receives a new filter state (sort, minimum, open row); `query` is the current hash query.
export function renderTable(el, allRows, st, query, onState, view = {}) {
  el.innerHTML = tableHtml(allRows, st, query, view);

  el.querySelectorAll("th[data-sort]").forEach((h) => h.addEventListener("click", () => {
    const k = h.dataset.sort === "rank" ? "tgt" : h.dataset.sort;
    const textual = ["name", "pos"].includes(k);
    const dir = st.sort === k ? (st.dir === "desc" ? "asc" : "desc") : textual ? "asc" : "desc";
    onState({ ...st, sort: k, dir });
  }));
  const min = el.querySelector("[data-min]");
  min?.addEventListener("change", () => { const v = Math.max(0, Math.floor(+min.value || 0)); onState({ ...st, minTgt: v }); });
  el.querySelector("[data-pi]")?.addEventListener("change", (e) => onState({ ...st, pi: e.target.checked, open: "" }));
  const toggle = (tr) => {
    const id = tr.dataset.id;
    anchor.id = id; anchor.top = tr.getBoundingClientRect().top;
    if (st.open === id) {
      // Animate the close, then drop it from the hash.
      const wrap = tr.nextElementSibling?.querySelector(".an-detail-wrap");
      if (wrap) { wrap.classList.add("closing"); setTimeout(() => onState({ ...st, open: "" }), 170); }
      else onState({ ...st, open: "" });
    } else onState({ ...st, open: id });
  };
  el.querySelectorAll("tr.an-row").forEach((tr) => {
    tr.addEventListener("click", (e) => { if (!e.target.closest("a")) toggle(tr); });
    tr.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !e.target.closest("a")) { e.preventDefault(); toggle(tr); } });
  });
}
