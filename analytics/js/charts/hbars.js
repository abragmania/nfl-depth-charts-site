// Horizontal bars for the player page: Madden blocking ratings (0-99, coloured by the depth charts' rating tiers,
// a tick at his position's median) and the 2025 route list (targets per route, with his position's share of
// targets on that route as a faint reference bar behind his own share).
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// bars: [{ label, v, median, tier }]; `pos` names the reference ("WR median 58").
export function ratingBars(bars, pos) {
  return `<div class="an-rb">${bars.map((b) => {
    const has = b.v !== null && b.v !== undefined;
    const med = b.median === null || b.median === undefined ? "" : `<i class="an-rb-med" style="left:${Math.min(100, b.median)}%" title="${esc(pos)} median ${Math.round(b.median)}"></i>`;
    return `<div class="an-rb-row t-${esc(b.tier)}" title="${esc(b.label)} ${has ? b.v : "–"}${b.median === null || b.median === undefined ? "" : ` · ${pos} median ${Math.round(b.median)}`}">`
      + `<span class="an-rb-lab">${esc(b.label)}</span>`
      + `<span class="an-rb-track">${has ? `<i class="an-rb-fill" style="width:${Math.min(100, b.v)}%"></i>` : ""}${med}</span>`
      + `<b class="an-rb-v">${has ? b.v : "–"}</b>`
      + `<em class="an-rb-m">${b.median === null || b.median === undefined ? "" : `${esc(pos)} med ${Math.round(b.median)}`}</em></div>`;
  }).join("")}</div>`;
}

// routes: [{ route, n, share, catchPct, ydsTgt, lgShare }] sorted by n.
export function routeList(routes) {
  const max = Math.max(0.01, ...routes.map((r) => Math.max(r.share || 0, r.lgShare || 0)));
  const pct = (v) => (v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`);
  const title = (s) => String(s).toLowerCase().replace(/(^|[\s/])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return `<div class="an-rl"><div class="an-rl-h"><span>Route</span><span>Share of his targets <em>(faint: his position's)</em></span><span></span><span>Tgt</span><span>Catch %</span><span>Yds/tgt</span></div>`
    + routes.map((r) => `<div class="an-rl-row" title="${esc(title(r.route))}: ${r.n} targets, ${pct(r.share)} of his route-labelled targets; ${pct(r.lgShare)} of his position's">`
      + `<span class="an-rl-name">${esc(title(r.route))}</span>`
      + `<span class="an-rl-track"><i class="an-rl-lg" style="width:${((r.lgShare || 0) / max * 100).toFixed(1)}%"></i><i class="an-rl-me" style="width:${((r.share || 0) / max * 100).toFixed(1)}%"></i></span><span class="an-rl-pct">${pct(r.share)} <em>· lg ${pct(r.lgShare)}</em></span>`
      + `<b>${r.n}</b><span>${pct(r.catchPct)}</span><span>${r.ydsTgt === null || r.ydsTgt === undefined ? "–" : r.ydsTgt.toFixed(1)}</span></div>`).join("")
    + `</div>`;
}
