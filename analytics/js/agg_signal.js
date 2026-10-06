// D230 INVOLVED VS PRODUCING (Adam, 2026-10-03): a small ▲ or ▼ after a man's name on the Receivers and Running backs
// tables when his involvement rank and his production rank sit a third of the pool or more apart. ▲ = used more than he
// has scored, ▼ = scoring more than his usage supports. No column and no raw gap figure (D196 struck "that gross raw
// number"); the hover says what it means in plain words and gives both ranks. Pure: no DOM, no imports.
//
// THE DEFINITION, so a reader can check it:
// - POOLS, BY POSITION: the rows the table ranks, as filtered (the page's window, season, positions, club, opponent and
//   the table's own minimum box: Min targets on Receivers, Min carries on Running backs, applied by the caller before
//   this runs), split by position, each group ranked on its own: on Receivers wide receivers among wide receivers and
//   tight ends among tight ends; on Running backs RBs and FBs together. Every other position on a table (a back or
//   quarterback on Receivers; a quarterback or receiver on Running backs) carries no marker and is in no pool: a tight
//   end's snaps include blocking, a back's DK/g his rushing, a quarterback's his passing, so their scales differ. Each
//   pool drops any man with no DK points per game (dkG blank, e.g. under a down or quarter filter) or with none of his
//   involvement components. Everything below (pool size, threshold, minimum games, 12-man floor) is per pool.
// - PRODUCTION RANK: DK points per game in the window (dkG, D194), 1 = most.
// - INVOLVEMENT RANK: usage, never results. Receivers: route share (routePct; only when no man in his pool has a route
//   share, routes per game instead, for everyone), target share (tgtShare), snap share (snapPct). Backs: snap share
//   (snapPct), carry share (rushShare, designed runs), opportunities per game (oppG, carries + targets, D191). Each
//   component is ranked among the pool men who have it (1 = most); a component a man lacks is skipped for him, never
//   counted as zero. His component ranks are averaged and the averages ranked again, smallest first.
// - TIES: standard competition ranking. Equal values share the best rank and the next value skips (1, 2, 2, 4), at
//   every step: each component, DK/g, and the averaged ranks.
// - SAME GAMES: every component and DK/g are over the games HE played in the window (the row's g: a game with a snap,
//   target or carry), never his club's games: target, carry and opportunity shares divide by his club's plays in his
//   games, snap share averages his games' snap percents, route share his route weeks', DK/g his points over g. A game he
//   left early counts on both sides alike.
// - MARKER: |involvement rank − production rank| ≥ ceil(pool / 3). ▲ when involvement is the better (smaller) rank,
//   ▼ when production is. A pool under 12 men: no markers in it. Only a man who played at least min(3, the most games
//   any man in his pool played) games in the window carries one (a two-game man in a three-week season does not; a
//   one-game window lets everyone); a man under that still counts in the pool when the others are ranked.
// It follows whatever rows arrive: a Last 3 window ranks last-3 figures, a past season its own, and the Deciding column
// set changes nothing (it reads the page window's shares, not the L3 columns).

const fin = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(+v);
export const SIGNAL_MIN_POOL = 12;
export const SIGNAL_MIN_GAMES = 3;
// Per table: the plain words for the involvement components, and its position pools (position -> pool key) with the
// noun each pool's hover uses.
export const SIGNAL_KINDS = {
  rec: { words: "routes, targets, snaps", pool: { WR: "WR", TE: "TE" }, noun: { WR: "wide receivers", TE: "tight ends" } },
  rb: { words: "snaps, carries, opportunities", pool: { RB: "RB", FB: "RB" }, noun: { RB: "running backs" } },
};
// The pool a row belongs to on a table, or null (no marker).
export const signalPool = (kind, pos) => SIGNAL_KINDS[kind]?.pool[String(pos || "").toUpperCase()] || null;

// The involvement components for a pool, as functions of a row (null when he lacks it).
function components(kind, pool) {
  if (kind === "rb") return [(r) => r.snapPct, (r) => r.rushShare, (r) => r.oppG];
  const anyShare = pool.some((r) => fin(r.routePct));
  const route = anyShare ? (r) => r.routePct : (r) => (fin(r.routes) && r.g > 0 ? r.routes / r.g : null);
  return [route, (r) => r.tgtShare, (r) => r.snapPct];
}

// Competition ranks of the given values among the men who have one. high: true ranks the largest 1st.
// Returns an array parallel to `vals`, null where the value is missing.
export function competitionRanks(vals, { high = true } = {}) {
  const have = vals.filter(fin).map(Number);
  return vals.map((v) => {
    if (!fin(v)) return null;
    const x = +v;
    return 1 + have.filter((y) => (high ? y > x : y < x)).length;
  });
}

// One position pool, ranked. Writes each man's entry into `by` and returns the pool's { n, gap, minG }.
function rankPool(rows, kind, noun, by) {
  const base = rows.filter((r) => fin(r.dkG));
  const comps0 = components(kind, base);
  const pool = base.filter((r) => comps0.some((c) => fin(c(r))));
  const comps = components(kind, pool);
  const n = pool.length, gap = Math.ceil(n / 3);
  const prod = competitionRanks(pool.map((r) => r.dkG));
  const compRanks = comps.map((c) => competitionRanks(pool.map((r) => c(r))));
  const avg = pool.map((_, i) => {
    const rs = compRanks.map((cr) => cr[i]).filter((x) => x !== null);
    return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  });
  const inv = competitionRanks(avg, { high: false });
  const games = (r) => (fin(r.g) ? +r.g : 0);
  const minG = Math.min(SIGNAL_MIN_GAMES, Math.max(0, ...pool.map(games)));
  pool.forEach((r, i) => {
    let dir = null;
    if (n >= SIGNAL_MIN_POOL && games(r) >= minG && inv[i] !== null && Math.abs(inv[i] - prod[i]) >= gap) dir = inv[i] < prod[i] ? "up" : "down";
    by.set(r.gsis, { inv: inv[i], prod: prod[i], dir, n, noun });
  });
  return { n, gap, minG };
}

// The ranks and the marker for every man in a position pool. rows: the table's rows as filtered. kind: "rec" | "rb".
// Returns { pools: { <pool key>: { n, gap (ceil(n/3)), minG (the games a marker needs) } },
//           by: Map gsis -> { inv, prod, dir: "up" | "down" | null, n (his pool's size), noun (his pool's) } }.
// A man in no pool (another position, no DK/g, no usage figure) has no entry.
export function involvementSignals(rows, kind) {
  const groups = new Map();
  for (const r of rows || []) {
    const k = r ? signalPool(kind, r.pos) : null;
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const by = new Map(), pools = {};
  for (const [k, g] of groups) pools[k] = rankPool(g, kind, SIGNAL_KINDS[kind].noun[k], by);
  return { pools, by };
}

export const ordinal = (k) => {
  const t = k % 100, u = k % 10;
  return `${k}${t >= 11 && t <= 13 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th"}`;
};

// The hover, plain words. s: one entry of involvementSignals(...).by (it carries his pool's size and noun).
export function signalText(kind, s) {
  if (!s?.dir) return "";
  const { words } = SIGNAL_KINDS[kind];
  return s.dir === "up"
    ? `Used more than he has scored: ${ordinal(s.inv)} of ${s.n} ${s.noun} by involvement (${words}), ${ordinal(s.prod)} by DK points per game.`
    : `Scoring more than his usage supports: ${ordinal(s.prod)} of ${s.n} ${s.noun} by DK points per game, ${ordinal(s.inv)} by involvement (${words}).`;
}

const escAttr = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// The marker's markup for the name cell ("" when he carries none). sig: the involvementSignals result.
export function signalHtml(kind, sig, gsis) {
  const s = sig?.by.get(gsis);
  if (!s?.dir) return "";
  const t = escAttr(signalText(kind, s));
  return `<span class="an-sig an-sig-${s.dir}" role="img" title="${t}" aria-label="${t}">${s.dir === "up" ? "▲" : "▼"}</span>`;
}
