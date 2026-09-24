// PURE (no DOM): the analytics app's filter state, its hash-query form, and the play/game predicates the
// aggregators apply. Every view is a link (D177): the whole state round-trips through the hash query, and a
// value equal to its default is left out so a plain #/usage stays short.
//
// Week keys: a week is identified across seasons by "SSSS-WW" (e.g. "2025-14"), which sorts correctly as a
// string and is what the week-range filter stores. Labels: the default season's weeks read "W3"; any other
// season's weeks carry the season's last two digits, "25·W14" (D177's Include-2025 union).

export const CURRENT_SEASON = 2026;
export const POSITIONS = ["WR", "TE", "RB", "FB", "QB"];
export const WINDOWS = ["season", "last3", "range"];
export const DOWNS = [1, 2, 3, 4];
export const QUARTERS = [1, 2, 3, 4, 5]; // 5 = overtime

// Three-way position chips: "in" (show only included positions), "out" (always hide), absent = neutral.
export const DEFAULT_POS = Object.freeze({ WR: "in", TE: "in", RB: "in" });

export function defaultState() {
  return {
    season: CURRENT_SEASON, with2025: false,
    window: "season", from: null, to: null,
    pos: { ...DEFAULT_POS },
    team: "", opp: "",
    // Adam (2026-09-24): no home/away, down or quarter splits in this app. The predicates below still honour
    // these three if set, but nothing sets them: the filter bar has no control and the hash ignores them.
    ha: "", downs: [], qtrs: [],
    minTgt: 5, sort: "tgt", dir: "desc",
    open: "",                             // the leaderboard row expanded in place (a gsis id), so it is linkable
  };
}

export const weekKey = (season, week) => `${season}-${String(week).padStart(2, "0")}`;
export function splitKey(key) {
  const [s, w] = String(key).split("-");
  return { season: +s, week: +w };
}
export function weekLabel(key, currentSeason = CURRENT_SEASON) {
  const { season, week } = splitKey(key);
  return season === currentSeason ? `W${week}` : `${String(season).slice(-2)}·W${week}`;
}

// The seasons a state reads, newest first.
export const seasonsOf = (st) => (st.with2025 && st.season !== 2025 ? [st.season, 2025] : [st.season]);

// Three-way chip: neutral -> in -> out -> neutral.
export function cyclePos(posState, pos) {
  const next = { ...posState };
  const cur = next[pos];
  if (!cur) next[pos] = "in";
  else if (cur === "in") next[pos] = "out";
  else delete next[pos];
  return next;
}

// Is a player at `pos` shown? An excluded position never is; if any position is included, only included
// positions are; with nothing included, everything not excluded is.
export function posAllowed(posState, pos) {
  const p = String(pos || "").toUpperCase();
  if (posState[p] === "out") return false;
  const anyIn = Object.values(posState).some((v) => v === "in");
  return anyIn ? posState[p] === "in" : true;
}

// ---- hash query ----------------------------------------------------------------------------------------
const posToString = (pos) => POSITIONS.filter((p) => pos[p]).map((p) => (pos[p] === "out" ? "-" : "") + p).join(",");
function posFromString(s) {
  const out = {};
  for (const tok of String(s || "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean)) {
    const ex = tok.startsWith("-") || tok.startsWith("!");
    const p = ex ? tok.slice(1) : tok;
    if (POSITIONS.includes(p)) out[p] = ex ? "out" : "in";
  }
  return out;
}
const KEY_RE = /^\d{4}-\d{2}$/;

export function toQuery(st) {
  const d = defaultState();
  const q = new URLSearchParams();
  if (st.season !== d.season) q.set("season", st.season);
  if (st.with2025) q.set("with2025", "1");
  if (st.window !== d.window) q.set("window", st.window);
  if (st.window === "range") { if (st.from) q.set("from", st.from); if (st.to) q.set("to", st.to); }
  const ps = posToString(st.pos);
  if (ps !== posToString(d.pos)) q.set("pos", ps || "none");
  if (st.team) q.set("team", st.team);
  if (st.opp) q.set("opp", st.opp);
  if (st.minTgt !== d.minTgt) q.set("min", st.minTgt);
  if (st.sort !== d.sort) q.set("sort", st.sort);
  if (st.dir !== d.dir) q.set("dir", st.dir);
  if (st.open) q.set("open", st.open);
  return q.toString();
}

export function fromQuery(qs) {
  const q = new URLSearchParams(String(qs || "").replace(/^\?/, ""));
  const st = defaultState();
  if (q.has("season") && /^\d{4}$/.test(q.get("season"))) st.season = +q.get("season");
  st.with2025 = q.get("with2025") === "1";
  if (WINDOWS.includes(q.get("window"))) st.window = q.get("window");
  if (st.window === "range") {
    st.from = KEY_RE.test(q.get("from") || "") ? q.get("from") : null;
    st.to = KEY_RE.test(q.get("to") || "") ? q.get("to") : null;
  }
  if (q.has("pos")) st.pos = q.get("pos") === "none" ? {} : posFromString(q.get("pos"));
  const abbr = (v) => (/^[A-Z]{2,3}$/.test(String(v || "").toUpperCase()) ? String(v).toUpperCase() : "");
  st.team = abbr(q.get("team"));
  st.opp = abbr(q.get("opp"));
  if (q.has("min") && Number.isFinite(+q.get("min")) && +q.get("min") >= 0) st.minTgt = Math.floor(+q.get("min"));
  if (/^[a-zA-Z0-9]+$/.test(q.get("sort") || "")) st.sort = q.get("sort");
  if (["asc", "desc"].includes(q.get("dir"))) st.dir = q.get("dir");
  if (/^[A-Za-z0-9_.:-]{1,40}$/.test(q.get("open") || "")) st.open = q.get("open");
  return st;
}

// ---- window and predicates -----------------------------------------------------------------------------

// Which (week, team) games count. `games` is [{ key, team, gameId }] for every club-game loaded (one entry per
// club per game). season: all of them; range: from..to inclusive (either end open when null); last3: each
// club's three most recent games, so a club on a bye still gets three games, not three weeks.
// Returns a Set of `${key}|${team}`.
export function gamesInWindow(games, st) {
  const out = new Set();
  if (st.window === "last3") {
    const byTeam = new Map();
    for (const g of games) { if (!byTeam.has(g.team)) byTeam.set(g.team, []); byTeam.get(g.team).push(g); }
    for (const list of byTeam.values()) {
      const uniq = [...new Map(list.map((g) => [g.key, g])).values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      for (const g of uniq.slice(-3)) out.add(`${g.key}|${g.team}`);
    }
    return out;
  }
  for (const g of games) {
    if (st.window === "range") {
      if (st.from && g.key < st.from) continue;
      if (st.to && g.key > st.to) continue;
    }
    out.add(`${g.key}|${g.team}`);
  }
  return out;
}

// Play-level predicate from the situational filters (column indexes from colIndex). Team/opponent/home-away
// are game-level but live on every row, so they are applied here too.
export function playPredicate(st, C) {
  const downs = new Set(st.downs), qtrs = new Set(st.qtrs);
  return (r) => {
    if (st.team && r[C.posteam] !== st.team) return false;
    if (st.opp && r[C.defteam] !== st.opp) return false;
    if (st.ha === "home" && !r[C.homeOff]) return false;
    if (st.ha === "away" && r[C.homeOff]) return false;
    if (downs.size && !downs.has(+r[C.down])) return false;
    if (qtrs.size && !qtrs.has(Math.min(5, +r[C.qtr]))) return false;
    return true;
  };
}

// Down and quarter cannot be split out of a weekly table (routes, snaps): those columns go blank under them.
export const isSituational = (st) => st.downs.length > 0 || st.qtrs.length > 0;
