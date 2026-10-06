// Weekly small multiples for the player page: one strip per measure, a bar per week, the WINDOW's figure printed
// on the left (D181 totals; a share is total over total, passed in by the caller) and a dashed league-average line
// for his position group (D177 perspective). The whole loaded timeline is drawn; weeks outside the window are dimmed,
// and when two seasons are loaded a divider with the season names separates them. Each week is one clickable
// column (data-key) whose native tooltip gives the week, the opponent and every strip's value.
// Same rules and look as the expanded leaderboard row (table.js weeklyBars), sized up for a page.
import { weekLabel, splitKey } from "../filters.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// strips: [{ k, label, scale, fmt(v) -> string, short(v) -> string (bar label), total, totalText, avg, avgText, tier(v) -> "elite"|… }]
// series: [{ key, opp, home, inWin, [k]: value|null }]
// `fit` (optional; player-page kit, D193 second/third draft): a target total pixel width - "the graph that goes
// across the page", not a handful of bars stranded in the left fifth of the band. When given, each of the `n`
// weeks gets an even share of that width; the bar itself widens only up to `maxBw` (so 5 weeks don't turn into 5
// giant blocks), and whatever's left over in that week's share becomes extra gap, so the columns spread out to
// use the full width either way - a wide band with few weeks reads as evenly spaced, not bar-then-dead-space.
// `lw`/`rw` stay put, so the label column keeps its width and the league-line label stays pinned to the row's
// right edge. Omit `fit` and nothing here changes - every existing caller keeps its exact pixel output.
export function weeklyStrips(series, strips, { season, bw = 40, gap = 10, sh = 58, lw = 150, rw = 86, activeKey = null, fit = null, maxBw = 90 } = {}) {
  const n = series.length;
  if (fit && n > 0) {
    const cell = (fit - lw - rw) / n;
    bw = Math.max(18, Math.min(maxBw, cell * 0.72));
    gap = Math.max(gap, cell - bw);
  }
  const W = lw + n * (bw + gap) + rw, top0 = 22;
  const H = top0 + strips.length * (sh + 16) + 30;
  const x = (i) => lw + i * (bw + gap);
  let g = "";
  // Season divider(s) and season names across the top.
  let segStart = 0;
  const seasonName = (i) => String(splitKey(series[i].key).season);
  for (let i = 1; i <= n; i++) {
    if (i === n || splitKey(series[i].key).season !== splitKey(series[i - 1].key).season) {
      const multi = n && splitKey(series[0].key).season !== splitKey(series[n - 1].key).season;
      if (multi) g += `<text class="an-wb-season" x="${x(segStart)}" y="11">${esc(seasonName(segStart))}</text>`;
      if (i < n) { const dx = x(i) - gap / 2; g += `<line class="an-wb-div" x1="${dx}" x2="${dx}" y1="2" y2="${H - 2}"/>`; }
      segStart = i;
    }
  }
  strips.forEach((sp, si) => {
    const top = top0 + si * (sh + 16);
    const y = (v) => top + sh - Math.min(1, Math.max(0, v) / sp.scale) * (sh - 14);
    g += `<text class="an-wb-lab" x="0" y="${top + sh / 2 - 4}">${esc(sp.label)}</text>`
      + `<text class="an-wb-tot${sp.tier ? " t-" + sp.tier(sp.total) : ""}" x="0" y="${top + sh / 2 + 13}">${esc(sp.totalText)}</text>`
      + `<line class="an-wb-base" x1="${lw - 5}" x2="${W - rw + 5}" y1="${top + sh}" y2="${top + sh}"/>`;
    series.forEach((s, i) => {
      const v = s[sp.k], bx = x(i);
      const dim = s.inWin ? "" : " dim";
      // His club played that week but he has no rows in it: a muted "DNP" mark, no bar (zero height), never "bye".
      if (s.dnp) { g += `<text class="an-wb-dnp${dim}" x="${bx + bw / 2}" y="${top + sh - 4}">DNP</text>`; return; }
      if (v === null || v === undefined) { g += `<text class="an-wb-na${dim}" x="${bx + bw / 2}" y="${top + sh - 4}">–</text>`; return; }
      const h = Math.max(1.5, top + sh - y(v));
      g += `<rect class="an-wb-bar${dim}${sp.tier ? " t-" + sp.tier(v) : ""}" x="${bx}" y="${(top + sh - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="3"/>`
        + `<text class="an-wb-val${dim}" x="${bx + bw / 2}" y="${(top + sh - h - 4).toFixed(1)}">${esc(sp.short(v))}</text>`;
    });
    if (sp.avg !== null && sp.avg !== undefined) {
      const ay = y(sp.avg).toFixed(1);
      g += `<line class="an-wb-avg" x1="${lw - 5}" x2="${W - rw + 5}" y1="${ay}" y2="${ay}"/><text class="an-wb-avglab" x="${W - rw + 9}" y="${+ay + 3.5}">${esc(sp.avgText)}</text>`;
    }
  });
  // Week labels, opponent under each, and one transparent hit column per week (hover tooltip, click target).
  series.forEach((s, i) => {
    const bx = x(i), dim = s.inWin ? "" : " dim";
    const tip = [`${weekLabel(s.key, season)}${s.opp ? (s.home === false ? " at " : " vs ") + s.opp : " · no game"}`,
      ...strips.map((sp) => `${sp.label}: ${s[sp.k] === null || s[sp.k] === undefined ? "did not play" : sp.fmt(s[sp.k])}`),
      s.key === activeKey ? "Click to go back to the whole window" : "Click to show this week only"].join("\n");
    g += `<text class="an-wb-wk${dim}${s.key === activeKey ? " on" : ""}" x="${bx + bw / 2}" y="${H - 16}">${esc(weekLabel(s.key, season))}</text>`
      + `<text class="an-wb-opp${dim}" x="${bx + bw / 2}" y="${H - 3}">${s.opp ? (s.home === false ? "@" : "") + esc(s.opp) : "bye"}</text>`
      + `<rect class="an-wb-hit${s.key === activeKey ? " on" : ""}" data-key="${esc(s.key)}" x="${bx - gap / 2}" y="${top0 - 6}" width="${bw + gap}" height="${H - top0 - 2}" rx="4"><title>${esc(tip)}</title></rect>`;
  });
  return `<svg class="an-wbars an-wbars-lg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Week by week">${g}</svg>`;
}
