// The player-page kit (D193 re-cut, B3 increment 5; PROJECT.md "Analytics re-cut and team grid — the plan",
// section A and B3). Every re-cut player page (QB, RB, Receivers - increments 6 and 7a) draws its layers with
// these builders instead of hand-rolling markup, so the layers look identical across positions: (1) HEADLINE,
// compact large-type tiles, each carrying the league figure and his league rank; (2) FANTASY BAND (Adam's third-
// draft call): one section among equals, not the whole page - ONE compact chart (DK points per week as bars,
// with up to two participation shares - opportunity/target share for a back, target/air-yards share for a
// receiver - overlaid as thin lines on a right-hand 0-100% scale), a compact game log table (one row per game, a
// totals row, cross-season grouping with a season header and a per-season + grand total when the window spans
// more than one season, a per-column heat tint by tier against a caller-supplied cuts reference so a season of
// rows reads as a quiet heat strip down the tinted columns), then the Opportunity tiles; (3) a PASSING (purple)
// or RUSHING (gold) phaseBlock, front tiles up top and a narrow tinted side column
// for the rest, with room below for the zone field the pages already draw; (4) a VARIANCE strip, his rate beside
// the league's, marked above/below in a neutral colour, never good/bad; (5) a small Madden foot.
//
// PURE STRING BUILDERS ONLY: no DOM access, no computed figures - every number, label, rank and tier arrives
// already worked out by the calling page's agg_*.js. Every plain-text field is HTML-escaped here; the spots that
// take ready-made HTML (`body` in phaseBlock, `html` in maddenFoot) are passed through unescaped by design, the
// same convention every other analytics view file uses for its own assembled fragments. The one exception is
// geometry math for laying out the fantasy chart (column widths, bar heights, line points) - that is rendering,
// not football logic, the same kind of math oppRow's bar-fill percentage already does.
//
// The fantasy chart is its OWN SVG string built here, not charts/bars.js's weeklyStrips - that renderer draws
// bars only, one measure per row, and has no notion of a second 0-100% line overlay; teaching it one for this
// single caller would be more invasive than just drawing the (much simpler, single-row) chart this band needs.
// charts/bars.js is untouched by this file as of this draft.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A tier string is only ever used inside a class="" attribute, so it is restricted to word characters rather than
// merely escaped - anything else (an accidental quote, say) is dropped rather than risking a broken attribute.
const tierClass = (tier) => (tier && /^[a-zA-Z0-9_-]+$/.test(String(tier)) ? ` t-${tier}` : "");
const titleAttr = (title) => (title ? ` title="${esc(title)}"` : "");
const has = (v) => v !== null && v !== undefined && v !== "";

// tileData: the one shape every tile-taking builder below expects ({ label, value, lg, rank, rankOf, sub, tier,
// title }, plus oppRow's own `share`/`bar`/`lgBar`). Pages may build the plain object themselves; this just fills
// in the blanks so a page can pass only the fields it has. Never computes anything, never touches HTML.
// rank/rankOf: his league rank beside the league figure ("lg 812 · 4th of 68 RBs") - both pre-formatted strings
// the caller already worked out ("4th", "68 RBs"); kit.js only ever joins and escapes them.
export function tileData({ label = "", value = "", lg = null, rank = null, rankOf = null, sub = null, tier = null, title = null, share = false, bar = null, lgBar = null } = {}) {
  return { label, value, lg, rank, rankOf, sub, tier, title, share, bar, lgBar };
}

// The "lg 812 · 4th of 68 RBs" line shared by headlineRow and oppRow: lg alone, rank alone, or both joined by " · ".
function lgRankEm(cls, d) {
  const parts = [];
  if (has(d.lg)) parts.push(`lg ${esc(d.lg)}`);
  if (has(d.rank)) parts.push(has(d.rankOf) ? `${esc(d.rank)} of ${esc(d.rankOf)}` : esc(d.rank));
  return parts.length ? `<em class="${cls}">${parts.join(" · ")}</em>` : "";
}

// ---- (1) HEADLINE: compact large-type tiles, each with the league figure and his league rank -------------------
export function headlineRow(tiles = []) {
  const items = (tiles || []).map((t) => {
    const d = tileData(t);
    return `<div class="an-rc-htile${tierClass(d.tier)}"${titleAttr(d.title)}>` +
      `<span class="an-rc-label">${esc(d.label)}</span>` +
      `<b class="an-rc-val">${esc(d.value)}</b>` +
      lgRankEm("an-rc-lg", d) +
      (d.sub ? `<div class="an-rc-sub">${esc(d.sub)}</div>` : "") +
      `</div>`;
  }).join("");
  return `<div class="an-rc-headline">${items}</div>`;
}

// ---- OPPORTUNITY tiles: count tiles plain, share tiles carry a bar + league tick --------------------------------
// Lives inside fantasyBand, under the game log (Adam's third-draft call). oppRow itself is unchanged - a page may
// still call it standalone.
export function oppRow(tiles = []) {
  const items = (tiles || []).map((t) => {
    const d = tileData(t);
    const kind = d.share ? "share" : "count";
    const bar = d.share
      ? `<div class="an-rc-obar">` +
        `<i class="an-rc-ofill" style="width:${pctOf(d.bar)}%"></i>` +
        (has(d.lgBar) && Number.isFinite(+d.lgBar) ? `<i class="an-rc-otick" style="left:${pctOf(d.lgBar)}%"></i>` : "") +
        `</div>`
      : "";
    return `<div class="an-rc-otile ${kind}${tierClass(d.tier)}"${titleAttr(d.title)}>` +
      `<span class="an-rc-olabel">${esc(d.label)}</span>` +
      `<b class="an-rc-oval">${esc(d.value)}</b>` +
      lgRankEm("an-rc-olg", d) +
      bar +
      (d.sub ? `<div class="an-rc-osub">${esc(d.sub)}</div>` : "") +
      `</div>`;
  }).join("");
  return `<div class="an-rc-opp"><div class="an-rc-opph">Opportunity</div><div class="an-rc-opprow">${items}</div></div>`;
}
// A share/lgBar/overlay fraction (0..1) clamped to a percentage; anything non-numeric reads as 0, never "NaN%".
function pctOf(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n * 100)) * 100) / 100;
}

// ---- the fantasy chart: DK points (bars) + up to two 0-100% share lines overlaid, columns filling `fit` --------
// weekRows: [{ key, wk, opp, season, pts, shares:[n0|null, n1|null], note: null|"bye"|"dnp" }] (chart-only fields;
// the game log table below reads its own `cells` off the same row objects). shareLabels: [label0, label1] - a
// falsy entry skips that line and its legend entry entirely (a receiver with only one relevant share still works).
const OV_CLASS = ["an-rc-ov1", "an-rc-ov2"];
function fanChartSvg(weekRows, shareLabels, { fit = null, label = "DK points", totalText = "", avg = null, avgText = "", scale = null } = {}) {
  // sh is the plot height alone: about the size of today's week-by-week card (Adam, third draft: the band is one
  // section among equals, not the whole page), plus top0/week-label margins bring the whole SVG to ~200px tall.
  const n = weekRows.length;
  const lw = 150, rw = 92, top0 = 20, sh = 114;
  let bw = 40, gap = 10;
  // Fourth draft (Adam: "you don't have to fill up all the space"): the chart no longer stretches to the band's
  // full width. Each week still gets an even share of `fit`, but that share is capped at maxCell (~120px) so five
  // weeks in a wide band don't turn into five giant columns - when the natural share is under the cap nothing
  // changes from before; when it's over, the chart simply ends short of the band's edge, legend and all (the
  // legend sits at the chart's own right edge, x = W - rw, so it moves in with it).
  const maxCell = 120;
  if (fit && n > 0) {
    const cell = Math.min(maxCell, (fit - lw - rw) / n);
    bw = Math.max(18, Math.min(90, cell * 0.72));
    gap = Math.max(gap, cell - bw);
  }
  const W = lw + n * (bw + gap) + rw;
  const H = top0 + sh + 16 + 30;
  const x = (i) => lw + i * (bw + gap);
  const maxPts = Math.max(scale || 0, ...weekRows.map((w) => w.pts || 0)) * 1.05 || 10;
  const yFor = (v) => top0 + sh - Math.min(1, Math.max(0, v) / maxPts) * (sh - 14);
  let g = "";
  // Season divider(s) and season names across the top (only prints when the rows actually span more than one).
  let segStart = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || weekRows[i].season !== weekRows[i - 1].season) {
      const multi = n && weekRows[0].season !== weekRows[n - 1].season;
      if (multi) g += `<text class="an-wb-season" x="${x(segStart)}" y="11">${esc(weekRows[segStart].season)}</text>`;
      if (i < n) { const dx = x(i) - gap / 2; g += `<line class="an-wb-div" x1="${dx}" x2="${dx}" y1="2" y2="${H - 2}"/>`; }
      segStart = i;
    }
  }
  g += `<text class="an-wb-lab" x="0" y="${top0 + sh / 2 - 4}">${esc(label)}</text>` +
    `<text class="an-wb-tot" x="0" y="${top0 + sh / 2 + 13}">${esc(totalText)}</text>` +
    `<line class="an-wb-base" x1="${lw - 5}" x2="${W - rw + 5}" y1="${top0 + sh}" y2="${top0 + sh}"/>`;
  weekRows.forEach((w, i) => {
    const bx = x(i);
    if (w.note === "bye") g += `<text class="an-wb-na" x="${bx + bw / 2}" y="${top0 + sh - 4}">BYE</text>`;
    else if (w.note === "dnp") g += `<text class="an-wb-dnp" x="${bx + bw / 2}" y="${top0 + sh - 4}">DNP</text>`;
    else if (has(w.pts)) {
      const h = Math.max(1.5, top0 + sh - yFor(w.pts));
      g += `<rect class="an-wb-bar" x="${bx}" y="${(top0 + sh - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="3"/>` +
        `<text class="an-wb-val" x="${bx + bw / 2}" y="${(top0 + sh - h - 4).toFixed(1)}">${(+w.pts).toFixed(1)}</text>`;
    }
    g += `<text class="an-wb-wk" x="${bx + bw / 2}" y="${H - 16}">${esc(w.wk)}</text>` +
      `<text class="an-wb-opp" x="${bx + bw / 2}" y="${H - 3}">${esc(w.opp || "")}</text>`;
  });
  if (has(avg)) {
    const ay = yFor(avg).toFixed(1);
    g += `<line class="an-wb-avg" x1="${lw - 5}" x2="${W - rw + 5}" y1="${ay}" y2="${ay}"/><text class="an-wb-avglab" x="${W - rw + 9}" y="${+ay + 3.5}">${esc(avgText)}</text>`;
  }
  // Up to two overlay lines, each on the full sh height as its own 0-100% scale (independent of the bars' scale).
  (shareLabels || []).slice(0, 2).forEach((lbl, si) => {
    if (!lbl) return;
    const pts = weekRows.map((w, i) => {
      const v = w.shares?.[si];
      return has(v) ? [x(i) + bw / 2, top0 + sh - Math.max(0, Math.min(1, v)) * sh] : null;
    }).filter(Boolean);
    if (!pts.length) return;
    g += `<polyline class="an-rc-ovline ${OV_CLASS[si]}" points="${pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ")}"/>`;
    pts.forEach(([px, py]) => { g += `<circle class="an-rc-ovdot ${OV_CLASS[si]}" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3"/>`; });
  });
  g += `<text class="an-rc-ovaxis" x="${W - rw + 9}" y="${top0 + 4}">100%</text>` +
    `<text class="an-rc-ovaxis" x="${W - rw + 9}" y="${top0 + sh}">0%</text>`;
  const legend = (shareLabels || []).slice(0, 2).map((lbl, si) => (lbl ? `<tspan class="${OV_CLASS[si]}">— </tspan>${esc(lbl)}` : "")).filter(Boolean);
  if (legend.length) g += `<text class="an-rc-ovlegend" x="${W - rw}" y="${top0 - 8}" text-anchor="end">${legend.join("   ")}</text>`;
  weekRows.forEach((w, i) => {
    const bx = x(i);
    const tip = [`${w.wk}${w.opp ? (w.note === "bye" ? "" : " vs " + w.opp) : ""}`, w.note === "bye" ? "Bye" : w.note === "dnp" ? "Did not play" : `DK: ${has(w.pts) ? (+w.pts).toFixed(1) : "–"}`].join("\n");
    g += `<rect class="an-wb-hit" data-key="${esc(w.key)}" x="${bx - gap / 2}" y="${top0 - 6}" width="${bw + gap}" height="${H - top0 - 2}" rx="4"><title>${esc(tip)}</title></rect>`;
  });
  return `<svg class="an-wbars an-wbars-lg an-rc-fansvg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)} by week">${g}</svg>`;
}

// ---- the game log table: one row per game, a totals row, season headers + per-season/grand totals when the ----
// window spans more than one season. `rows` is one ordered list mixing three row shapes (a page builds this once
// and hands the whole thing to both the chart and the table, since the chart reads its own fields off the same
// week rows and ignores the rest):
//   { type: "week", key, wk, opp, season, pts, shares, note, cells, heat }  - cells.length === columns.length
//   { type: "season", label }                                              - a small season header ("2025")
//   { type: "total", cells }                                               - a totals row (untinted, never heat)
// columns: [{ key, label, align: "left"|"right", kind: "dk"|"share1"|"share2", cuts }] - kind drives text colour
// (DK gold, share columns tinted to match their overlay line); `cuts`, when given, turns on this column's heat:
// four descending numbers, elite/strong/avg/weak (same shape as the app's existing per-key tier cuts, e.g.
// rushReference(...).cuts[key].cuts) - the caller is responsible for orienting values so "higher is better" the
// same way those cuts objects already are (negate first for a lower-is-better stat, as the rest of the app does).
// A week row's `heat[col.key]` supplies that cell's value on the SAME orientation; no cuts or no heat entry means
// the cell is left untinted. Adam (fourth draft): "low-alpha fills of the existing tier hues, no coloured text" -
// the tier only ever sets a background wash here, never the DK/share columns' own text colour.
const TIER_NAMES = ["elite", "strong", "avg", "weak", "flat"];
function tierFromCuts(v, cuts) {
  if (!cuts || !Number.isFinite(v)) return null;
  const i = cuts.findIndex((c) => v >= c);
  return TIER_NAMES[i < 0 ? 4 : i];
}
function glCellClass(col, tier) {
  // The tier token always carries its own leading space (rather than joining it in with the rest and hoping
  // something else came first) so `[class*=" t-"]` (the heat-tint CSS rule, and every other tier rule in
  // analytics.css) matches even when a tinted column has no other class - e.g. a plain numeric column with cuts
  // but no `kind`.
  const base = [col.align === "left" ? "" : "num", col.kind === "dk" ? "an-rc-gl-dk" : col.kind === "share1" ? "an-rc-gl-s1" : col.kind === "share2" ? "an-rc-gl-s2" : ""].filter(Boolean).join(" ");
  const cls = base + (tier ? ` t-${tier}` : "");
  return cls ? ` class="${cls}"` : "";
}
function glTable(rows, columns) {
  const head = (columns || []).map((c) => `<th${glCellClass(c)}>${esc(c.label)}</th>`).join("");
  const body = (rows || []).map((r) => {
    if (r.type === "season") return `<tr class="an-rc-gl-season"><td colspan="${columns.length}">${esc(r.label)}</td></tr>`;
    if (r.type === "total") return `<tr class="an-rc-gl-total">${(r.cells || []).map((v, i) => `<td${glCellClass(columns[i] || {})}>${esc(v)}</td>`).join("")}</tr>`;
    // type === "week"
    if (r.note === "bye" || r.note === "dnp") {
      return `<tr class="an-rc-gl-row dim"><td>${esc(r.cells?.[0])}</td><td colspan="${Math.max(1, columns.length - 1)}">${r.note === "bye" ? "BYE" : "DNP"}</td></tr>`;
    }
    return `<tr class="an-rc-gl-row">${(r.cells || []).map((v, i) => {
      const col = columns[i] || {};
      const tier = col.cuts ? tierFromCuts(Number(r.heat?.[col.key]), col.cuts) : null;
      return `<td${glCellClass(col, tier)}>${esc(v)}</td>`;
    }).join("")}</tr>`;
  }).join("");
  return `<table class="an-rc-gl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ---- FANTASY BAND: one section among equals - a compact chart, a compact game log, the Opportunity tiles -----
// title/sub: pre-built header text - kit.js never assembles stat phrases itself, only escapes what it is given.
// total/avg/avgText/scale: the chart's left-hand total and dashed league-average line (avg is a number for the
// line's height; avgText is its pre-formatted label, e.g. "lg 13.2/g").
// width: the band's available content width in px (kit.js has no DOM access, so a DOM-aware caller - a page, or
// this file's own demo - measures its container and passes the number down; without it the chart falls back to
// its own default bar width). tiles: fed straight to oppRow, printed under the game log inside this same band.
export function fantasyBand({ title = "Fantasy", sub = "", rows = [], columns = [], shareLabels = [], total = "", avg = null, avgText = "", scale = null, width = null, tiles = [] } = {}) {
  const weekRows = (rows || []).filter((r) => r.type === "week");
  const chart = weekRows.length ? fanChartSvg(weekRows, shareLabels, { fit: width, label: "DK points", totalText: total, avg, avgText, scale }) : "";
  return `<div class="an-rc-fanband">` +
    `<div class="an-rc-fanhead"><span class="an-rc-fanh">${esc(title)}</span>${sub ? `<span class="an-rc-fansub">${esc(sub)}</span>` : ""}</div>` +
    (chart ? `<div class="an-rc-fanchart">${chart}</div>` : "") +
    glTable(rows, columns) +
    oppRow(tiles) +
    `</div>`;
}

// ---- (3) a PASSING (purple) or RUSHING (gold) phase block: front tiles + a narrow tinted side column ----------
// front/side: [{ label, value, lg, sub, tier, title }] (tileData shape; lg/sub apply to front tiles only - side
// items stay compact, label + value only, because the whole point of the side column is that it is secondary).
// body: ready-made HTML the page already drew (the zone field) - not escaped, see file header.
export function phaseBlock({ title = "", tint = "pass", front = [], side = [], body = "" } = {}) {
  const t = tint === "rush" ? "rush" : "pass";
  const frontHtml = (front || []).map((f) => {
    const d = tileData(f);
    return `<div class="an-tile${tierClass(d.tier)}"${titleAttr(d.title)}>` +
      `<span>${esc(d.label)}</span><b>${esc(d.value)}</b>` +
      (has(d.lg) ? `<em> · lg ${esc(d.lg)}</em>` : "") +
      (d.sub ? `<div class="an-rc-sub">${esc(d.sub)}</div>` : "") +
      `</div>`;
  }).join("");
  const sideHtml = (side || []).map((s) => {
    const d = tileData(s);
    return `<div class="an-rc-sideitem${tierClass(d.tier)}"${titleAttr(d.title)}><span>${esc(d.label)}</span><b>${esc(d.value)}</b></div>`;
  }).join("");
  return `<div class="an-rc-phase an-rc-phase-${t}">` +
    `<div class="an-rc-phase-top">` +
    `<div class="an-rc-phase-main"><div class="an-rc-phaseh">${esc(title)}</div><div class="an-rc-fronttiles">${frontHtml}</div></div>` +
    `<div class="an-rc-phase-side"><div class="an-rc-sideh">More</div>${sideHtml}</div>` +
    `</div>` +
    (body ? `<div class="an-rc-phasebody">${body}</div>` : "") +
    `</div>`;
}

// ---- (4) VARIANCE: his rate beside the league's, marked above/below in a neutral colour, never good/bad --------
// items: [{ label, me, lg, dir ("up"|"down"|null), title }]. `dir` only ever picks an up/down glyph; it never
// changes colour (Adam: never good/bad colouring) - both glyphs render in the same muted tone.
export function varianceStrip(items = []) {
  const html = (items || []).map((it) => {
    const dir = it?.dir === "up" ? "up" : it?.dir === "down" ? "down" : "";
    const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "";
    return `<div class="an-rc-varitem"${titleAttr(it?.title)}>` +
      `<span class="an-rc-varlabel">${esc(it?.label)}</span>` +
      `<span class="an-rc-varvals"><b>${esc(it?.me)}</b>` +
      (arrow ? `<i class="an-rc-vararrow ${dir}">${arrow}</i>` : "") +
      `<span class="an-rc-varlg">lg ${esc(it?.lg)}</span></span>` +
      `</div>`;
  }).join("");
  return `<div class="an-rc-variance">${html}</div>`;
}

// ---- (5) a small wrapper for the Madden ratings at the bottom --------------------------------------------------
// html: ready-made HTML (e.g. the ratingBars() output pages already build) - not escaped, see file header.
export function maddenFoot(html = "") {
  return `<div class="an-rc-maddenfoot">${html || ""}</div>`;
}
