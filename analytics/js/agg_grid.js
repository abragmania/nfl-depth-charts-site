// PURE (no DOM, no fetch): the Team grid's cells (D195; drawn by views/grid.js). One row per club in the window, one
// cell per category and side of the ball, from agg_team.js's aggregateTeams() rows (so every figure equals the one
// the Offense and Defense pages show).
//
// A cell's RATING (D195, Adam 2026-09-25): 50 + 15 × z, z = (value − mean) / population standard deviation over the
// clubs in the window that have a value, with the direction applied so a higher rating is always better; clipped to
// 0-100 and rounded to a whole number. Built on the raw figure, never on a rank or percentile (which would stack a
// second normalization on top of the first; EPA, CPOE and the like are normalized against the play situation, not
// against the other clubs, so the club-against-club z does not double up on them). Bunched figures look bunched.
// A cell's RANK: competition ranking on the value rounded to the digits the page shows (1, 2, 2, 4), best first.
// A club with no value is null everywhere (value, rating, rank, n) and is not counted in anyone's mean, deviation,
// rank or n.
import { OFF_TIER, DEF_TIER } from "./agg_team.js";

// Frozen all the way down (the table is shared by every page that draws the grid).
const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const finite = (x) => x !== null && x !== undefined && Number.isFinite(+x);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Sources (D178: each figure has one source, named on the page).
const PBP = "play-by-play (nflverse)";
const PFR_PASS = "PFR advanced passing charting, about a week behind the games";
const PFR_RUSH = "PFR advanced rushing charting, about a week behind the games";
const PFR_COV = "PFR advanced defense charting, about a week behind the games; PFR's charters decide who was covering";

// One figure: k = the aggregateTeams side key; dir = 1 higher is better, -1 lower is better (from agg_team.js's
// OFF_TIER / DEF_TIER, the team pages' own directions); digits = decimals as displayed; pct = displayed × 100 as a
// percentage; signed = shown with a sign; proxy = the figure stands in for what the header names (Part 3, Part A).
const fig = (side, k, label, digits, extra = {}) => ({
  k, label, dir: (side === "def" ? DEF_TIER : OFF_TIER)[k], digits, pct: false, signed: false, proxy: false, lead: false, ...extra,
});

// The categories, in page order. Each has an offense side and a defense side (coverage: defense only), each a list of
// figures with exactly one `lead` (the figure that carries the cell); the others sit beside it.
export const GRID_CATEGORIES = deepFreeze([
  {
    key: "overall", label: "Overall", offLabel: "Overall", defLabel: "Overall", source: PBP,
    note: "Expected points added per play (pass attempts, sacks, scrambles and designed runs).",
    off: [fig("off", "epaPlay", "EPA/play", 3, { signed: true, lead: true, source: PBP })],
    def: [fig("def", "epaPlay", "EPA/play allowed", 3, { signed: true, lead: true, source: PBP })],
  },
  {
    key: "passEff", label: "Pass efficiency", offLabel: "Pass efficiency", defLabel: "Pass defense", source: PBP,
    note: "EPA per dropback (sacks and scrambles included).",
    off: [fig("off", "epaDb", "EPA/dropback", 3, { signed: true, lead: true, source: PBP })],
    def: [fig("def", "epaDb", "EPA/dropback allowed", 3, { signed: true, lead: true, source: PBP })],
  },
  {
    key: "runEff", label: "Run efficiency", offLabel: "Run game", defLabel: "Run defense", source: PBP,
    note: "Production first (Adam, 2026-09-25): rushing yards per game on designed runs leads; yards per carry and EPA per designed run beside it. Scrambles are not designed runs.",
    off: [
      fig("off", "rushYdsG", "Rush yds/g", 1, { lead: true, source: PBP }),
      fig("off", "ypc", "YPC", 1, { source: PBP }),
      fig("off", "epaCar", "EPA/carry", 3, { signed: true, source: PBP }),
    ],
    def: [
      fig("def", "rushYdsG", "Rush yds/g allowed", 1, { lead: true, source: PBP }),
      fig("def", "ypc", "YPC allowed", 1, { source: PBP }),
      fig("def", "epaCar", "EPA/carry allowed", 3, { signed: true, source: PBP }),
    ],
  },
  {
    key: "passPro", label: "Pass protection vs pass rush", offLabel: "Pass protection", defLabel: "Pass rush",
    source: `pressure % and hits %: ${PFR_PASS}; sack %: ${PBP}`,
    note: "Ranks on pressure % (share of dropbacks with any pressure, the quarterbacks' own PFR counts, one per throw); sack % and QB hits per dropback beside it. Pressure over sacks because sacks depend on how long the quarterback holds the ball. The offense side is a proxy for the line: the quarterback, backs and tight ends share the blame.",
    off: [
      fig("off", "pressPctAllowed", "Pressure % allowed", 1, { pct: true, lead: true, proxy: true, source: PFR_PASS }),
      fig("off", "sackPct", "Sack % allowed", 1, { pct: true, proxy: true, source: PBP }),
      fig("off", "hitPctAllowed", "Hits % allowed", 1, { pct: true, proxy: true, source: PFR_PASS }),
    ],
    def: [
      fig("def", "pressPctAllowed", "Pressure %", 1, { pct: true, lead: true, source: PFR_PASS }),
      fig("def", "sackPct", "Sack %", 1, { pct: true, source: PBP }),
      fig("def", "hitPctAllowed", "Hits %", 1, { pct: true, source: PFR_PASS }),
    ],
  },
  {
    key: "runBlock", label: "Run blocking vs run stuff", offLabel: "Run blocking", defLabel: "Run stuff",
    source: `yards before contact: ${PFR_RUSH}; stuffed %: ${PBP}`,
    note: "Offense: yards before contact per carry leads (the only free figure for the space before the back is touched; quarterbacks left out, since PFR's carries include their scrambles and kneels); stuffed % (designed runs for 0 or less) beside it as the footnote figure. The offense side is a proxy for the line: the back's vision is in it. Defense: stuffed % forced leads (play-by-play, no lag), yards before contact allowed beside it.",
    off: [
      fig("off", "ybcCar", "YBC/carry", 2, { lead: true, proxy: true, source: PFR_RUSH }),
      fig("off", "stuffPct", "Stuffed %", 1, { pct: true, proxy: true, source: PBP }),
    ],
    def: [
      fig("def", "stuffPct", "Stuffed % forced", 1, { pct: true, lead: true, source: PBP }),
      fig("def", "ybcCar", "YBC/carry allowed", 2, { source: PFR_RUSH }),
    ],
  },
  {
    key: "coverage", label: "Coverage", offLabel: null, defLabel: "Coverage", source: PFR_COV,
    note: "Defense only: passer rating allowed on throws at the club's cornerbacks and safeties, computed from PFR's coverage counts (completions, targets as attempts, yards, TDs, interceptions); yards per coverage target and completion % allowed beside it.",
    off: null,
    def: [
      fig("def", "covRating", "Rating allowed", 1, { lead: true, source: PFR_COV }),
      fig("def", "covYdsTgt", "Yds/target", 1, { source: PFR_COV }),
      fig("def", "covCmpPct", "Cmp % allowed", 1, { pct: true, source: PFR_COV }),
    ],
  },
  {
    key: "explosive", label: "Explosive plays", offLabel: "Explosive plays", defLabel: "Explosive plays allowed", source: PBP,
    note: "Plays gaining 10+ yards on the ground or 20+ on a completed pass, over plays.",
    off: [fig("off", "explPct", "Explosive %", 1, { pct: true, lead: true, source: PBP })],
    def: [fig("def", "explPct", "Explosive % allowed", 1, { pct: true, lead: true, source: PBP })],
  },
]);

// The figure as displayed, rounded (the rank's tie rule).
export const displayed = (v, f) => { const x = f.pct ? v * 100 : v; const p = 10 ** f.digits; return Math.round(x * p) / p; };

// 0-100 rating from a value against the clubs' mean and population deviation, direction applied (a flat field: 50).
export function zRating(v, mean, sd, dir = 1) {
  if (!finite(v) || !finite(mean)) return null;
  const z = sd > 0 ? (dir * (v - mean)) / sd : 0;
  return Math.round(clamp(50 + 15 * z, 0, 100));
}

// Competition ranks (1, 2, 2, 4), best first by `dir`, on the displayed value; null for a missing value.
export function rankWithTies(values, f) {
  const shown = values.map((v) => (finite(v) ? displayed(+v, f) : null));
  const dir = f.dir || 1;
  return shown.map((x) => (x === null ? null : 1 + shown.filter((y) => y !== null && dir * (y - x) > 0).length));
}

// One figure across the clubs: [{ value, rating, rank, n }] in `rows` order.
function figureCells(rows, side, f) {
  const vals = rows.map((r) => { const v = r?.[side]?.[f.k]; return finite(v) ? +v : null; });
  const have = vals.filter((v) => v !== null), n = have.length;
  const mean = n ? have.reduce((a, b) => a + b, 0) / n : null;
  const sd = n ? Math.sqrt(have.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : null;
  const ranks = rankWithTies(vals, f);
  return vals.map((v, i) => (v === null ? { value: null, rating: null, rank: null, n: null }
    : { value: v, rating: zRating(v, mean, sd, f.dir || 1), rank: ranks[i], n }));
}

// The grid: one row per club (aggregateTeams' order): { team, g, cells: { [category]: { off, def } } }, where a side
// is null (coverage on offense) or { k (the lead key), value, rating, rank, n (the lead's), figs: { [k]: { value,
// rating, rank, n } } }. `teamAgg` is aggregateTeams()'s result or its rows; opts.categories overrides the table.
export function gridRows(teamAgg, opts = {}) {
  const rows = Array.isArray(teamAgg) ? teamAgg : teamAgg?.rows || [];
  const cats = opts.categories || GRID_CATEGORIES;
  const out = rows.map((r) => ({ team: r.team, g: r.g, cells: {} }));
  for (const c of cats) {
    for (const side of ["off", "def"]) {
      const figs = c[side];
      if (!figs) { out.forEach((o) => { (o.cells[c.key] ||= {})[side] = null; }); continue; }
      const lead = figs.find((f) => f.lead) || figs[0];
      const per = Object.fromEntries(figs.map((f) => [f.k, figureCells(rows, side, f)]));
      out.forEach((o, i) => {
        const fcells = Object.fromEntries(figs.map((f) => [f.k, per[f.k][i]]));
        (o.cells[c.key] ||= {})[side] = { k: lead.k, ...fcells[lead.k], figs: fcells };
      });
    }
  }
  return out;
}

// Where a rating sits on the colour gradient, 0 (poor) to 1 (elite); null for no rating. The CSS owns the colours.
export const gradientStop = (rating) => (finite(rating) ? clamp(+rating, 0, 100) / 100 : null);
