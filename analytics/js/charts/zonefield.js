// The target-zone field for the player page: D179's 4 x 3 grid (deep 20+, intermediate 10-19, short 1-9, behind the
// line; left, middle, right), drawn as a field with the line of scrimmage between short and behind.
// Comparison (D177 perspective): ONE grid, not two side by side. In the targets view a cell is shaded by his volume
// and prints his share of his targets beside his position group's share ("31% · lg 24%"); in the rate views
// (catch %, yards per target, EPA per target) a cell is coloured by HIS MINUS HIS POSITION'S figure there, green
// above, red below, and prints both, so good or bad reads in one look without comparing two grids.
// A cell with fewer than MIN_N of his targets keeps its numbers but is drawn neutral (too few to judge).
// Every cell with targets is a button (data-zone) that opens the plays behind it.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const MIN_N = 3;
export const ZONE_MODES = [
  { k: "tgt", label: "Targets" },
  { k: "catchPct", label: "Catch %", fmt: (v) => `${Math.round(v * 100)}%`, span: 0.25 },
  { k: "ydsTgt", label: "Yds/tgt", fmt: (v) => v.toFixed(1), span: 6 },
  { k: "epaTgt", label: "EPA/tgt", fmt: (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2), span: 0.6 },
];
const BANDS = [["D", "Deep", "20+"], ["I", "Inter", "10–19"], ["S", "Short", "1–9"], ["B", "Behind", "LOS"]];
const DIRS = [["L", "Left"], ["M", "Middle"], ["R", "Right"]];
const BAND_NAME = Object.fromEntries(BANDS.map(([b, n, r]) => [b, `${n} ${r}`]));
const DIR_NAME = Object.fromEntries(DIRS);
export const zoneName = (z) => `${BAND_NAME[z[0]] || z[0]} · ${DIR_NAME[z[1]] || z[1]}`;

// A signed difference, scaled to -1..1 by the mode's span (the gap that reads as "a lot").
export function zoneDiff(cell, mode) {
  const m = ZONE_MODES.find((x) => x.k === mode);
  if (!m || !m.span || !cell || cell.n < MIN_N) return null;
  const a = cell[mode], b = cell.lg?.[mode];
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return Math.max(-1, Math.min(1, (a - b) / m.span));
}

// zones: { [BL..BR]: { n, share, catchPct, ydsTgt, epaTgt, lg: { n, share, catchPct, ydsTgt, epaTgt } } }
export function zoneField(zones, mode = "tgt", { selected = null } = {}) {
  const m = ZONE_MODES.find((x) => x.k === mode) || ZONE_MODES[0];
  const max = Math.max(1, ...Object.values(zones).map((c) => c.n));
  const pct = (v) => (v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`);
  const cell = (b, d) => {
    const z = b + d, c = zones[z] || { n: 0, lg: {} };
    const sel = selected === z ? " sel" : "";
    if (m.k === "tgt") {
      const tip = `${zoneName(z)}: ${c.n} targets, ${pct(c.share)} of his zoned targets; ${pct(c.lg?.share)} for his position`;
      return `<button type="button" class="an-zf-c heat${sel}" data-zone="${z}" style="--heat:${(c.n / max).toFixed(3)}"${c.n ? "" : " disabled"} title="${esc(tip)}">`
        + `<b>${c.n || ""}</b><small>${c.n ? pct(c.share) : ""}<em> · lg ${pct(c.lg?.share)}</em></small></button>`;
    }
    const v = c[m.k], lv = c.lg?.[m.k];
    const diff = zoneDiff(c, m.k);
    const cls = diff === null ? "few" : diff >= 0 ? "up" : "down";
    const tip = `${zoneName(z)}: ${m.label} ${v === null || v === undefined ? "–" : m.fmt(v)} on ${c.n} targets; his position ${lv === null || lv === undefined ? "–" : m.fmt(lv)}${c.n && c.n < MIN_N ? " (too few targets to judge)" : ""}`;
    return `<button type="button" class="an-zf-c ${cls}${sel}" data-zone="${z}" style="--d:${Math.abs(diff ?? 0).toFixed(3)}"${c.n ? "" : " disabled"} title="${esc(tip)}">`
      + `<b>${v === null || v === undefined ? (c.n ? "–" : "") : m.fmt(v)}</b><small>${c.n ? `${c.n} tgt` : ""}<em>${lv === null || lv === undefined ? "" : ` · lg ${m.fmt(lv)}`}</em></small></button>`;
  };
  return `<div class="an-zf">`
    + `<div></div>${DIRS.map(([, l]) => `<div class="an-zf-h">${l}</div>`).join("")}`
    + BANDS.map(([b, n, r]) => `<div class="an-zf-r${b === "B" ? " los" : ""}"><span>${n}</span><small>${r}</small></div>${DIRS.map(([d]) => cell(b, d)).join("")}`).join("")
    + `</div>`;
}

export function zoneLegend(mode) {
  if (mode === "tgt") return `<span class="an-zf-leg"><i class="heat" style="--heat:.15"></i><i class="heat" style="--heat:.5"></i><i class="heat" style="--heat:1"></i> more of his targets · "lg" = share of his position's targets</span>`;
  return `<span class="an-zf-leg"><i class="down" style="--d:1"></i><i class="down" style="--d:.4"></i><i class="few"></i><i class="up" style="--d:.4"></i><i class="up" style="--d:1"></i> below → above his position there · grey: under ${MIN_N} targets</span>`;
}
