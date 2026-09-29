// The quarterback player page, #/player/:gsis when the man is a QB (D182: QBs are their own thing, no blocking;
// main.js routes here). NO QBR (D177). D193 re-cut (increment 6; PROJECT.md Part 4 "Analytics re-cut and team grid",
// section A "Quarterbacks"): the page is drawn in the kit's five layers (views/kit.js), top to bottom:
//   (1) HEADLINE: passing yards (per game under), TD–INT, total yards (passing + rushing, per game under), EPA per
//       dropback, CPOE; each with the pool's league figure, his rank in the QB reference pool and a tier colour. No
//       fantasy tile (Adam, first kit draft).
//   (2) FANTASY: one chart (DK points per week with a league line; his pass attempts and carries overlaid on a count
//       scale), a vertical game log (one row per game, totals per season and a grand total; Att, Yds and DK tinted
//       by tier against every pool QB's single games), then the Opportunity tiles.
//   (3) PASSING (purple) above RUSHING (gold), each at full width with its front tiles and a narrow side column; the
//       week-by-week strips (drawn across the block's width), the zone field and the splits stay inside the passing
//       block, the carries and yards strips inside rushing. The rushing front lights up for runners and sits grey for
//       pocket passers (qbTier's rush rule, as today's rushHeadline).
//   (4) VARIANCE: his TD %, INT %, receivers' drops per 100 attempts, fumbles lost and DK TD share beside the pool's.
//   (5) Madden passing attributes at the foot. (👁 fix round: the blocks stack at every width, as on the backs' and
//       receivers' pages, instead of Passing beside a right-hand column that left holes in both.)
// Every figure comes from agg_qb.js / agg_fantasy.js (pure); this file only formats, lays out and wires clicks.
// Interactivity (D177): a weekly column (strips or the fantasy chart) sets the window to that week and back; a zone
// cell lists the plays behind it; the header has a Back button (router.js backLink: the page he came from, else
// Quarterbacks) and links to his depth-chart card (new tab) and his team page.
import { fromQuery, seasonsOf, weekLabel, splitKey, gamesInWindow } from "../filters.js";
import { backLink } from "../router.js";
import { loadFor, loadTeams, displayName, loadStatusFeed } from "../data.js";
import { isStatic } from "../../../js/api.js";
import { clubGames } from "../agg.js";
import { aggregateQb, qbReference, qbTier, qbZones, qbSplits, SPLITS, QB_MADDEN_ATTRS, inQbPool, qbPoolStat, qbGameCuts } from "../agg_qb.js";
import { fantasyByPlayer } from "../agg_fantasy.js";
import { median, ratingTier, maddenEdition, iterationLabel } from "../agg_player.js";
import { renderFilterBar } from "../filterbar.js";
import { ratingBars } from "../charts/hbars.js";
import { headlineRow, fantasyBand, phaseBlock, varianceStrip, maddenFoot, playerHead, currentStatus, latestWeekIn } from "./kit.js";
import { esc, isNum, signed, teamPill, qbStrips, qbZoneField, qbZoneLegend, qbZoneName, QB_ZONE_MODES, qbQuery, minDbOf, pfrNote } from "./qb.js";

// Madden ratings for a season, from the data builder's madden.json (the same fetch as player.js's loadMadden, which
// is private to that page). Never fails: absent or unreadable resolves to null and the block says so.
const maddenCache = new Map();
function loadMadden(season) {
  if (!maddenCache.has(season)) {
    const url = isStatic() ? `../api/analytics/${season}/madden.json` : `/api/analytics/${season}/madden`;
    maddenCache.set(season, fetch(url, { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => { if (!j) maddenCache.delete(season); return j; }));
  }
  return maddenCache.get(season);
}

// PURE: the passing attributes as rating bars against the QB median ({ status, title, ovr, bars, peers }).
export function maddenQb(madden, gsis, season) {
  if (!madden?.players) return { status: "absent", title: null, ovr: null, bars: [], peers: 0 };
  const title = `${maddenEdition(madden.season ?? season)} · ${iterationLabel(madden.iteration)}`;
  const me = madden.players[gsis];
  if (!me) return { status: "unrated", title, ovr: null, bars: [], peers: 0 };
  const peers = Object.values(madden.players).filter((p) => String(p.pos || "").toUpperCase() === "QB");
  const bars = QB_MADDEN_ATTRS.map(([k, label]) => {
    const v = isNum(me.attrs?.[k]) ? +me.attrs[k] : null;
    return { k, label, v, median: median(peers.map((p) => p.attrs?.[k])), tier: ratingTier(v) };
  });
  return { status: "ok", title, ovr: isNum(me.ovr) ? +me.ovr : null, bars, peers: peers.length };
}

// The page ignores team, opponent and the position chips (one man; his reference is every QB in the window).
const pageState = (st) => ({ ...st, team: "", opp: "", ha: "", downs: [], qtrs: [], pos: {} });

// PURE: agg_qb.js's per-week series (no opponent) enriched with his club's opponent that week and whether the
// week was inside the window. His club for a week comes from players.json teams[week]; a week with no entry
// there (he had no dropback or carry) falls back to his nearest known week, so a week his club played still
// resolves its opponent instead of reading "bye". "car" is null only for a week he had no dropback or carry
// (agg_qb.js's series); a week his club had a game (g) but he did not is a DNP, not a bye.
export function qbWeeklySeries(rawSeries, meta, games, winKeys) {
  const weekNum = (key) => { const { season, week } = splitKey(key); return season * 100 + week; };
  const teamOf = (key) => {
    if (meta?.teams?.[key]) return meta.teams[key];
    let best = null, bestDist = Infinity;
    for (const k of Object.keys(meta?.teams || {})) {
      const d = Math.abs(weekNum(k) - weekNum(key));
      if (d < bestDist) { bestDist = d; best = k; }
    }
    return best ? meta.teams[best] : null;
  };
  return rawSeries.map((s) => {
    const t = teamOf(s.key);
    const g = t ? games.get(`${s.key}|${t}`) : null;
    const played = s.car !== null && s.car !== undefined;
    return { ...s, team: t, opp: g?.opp || null, home: g ? g.home : null, inWin: winKeys.has(s.key), dnp: !!g && !played };
  });
}
// PURE (🔵 on increment 6): under "last 3" the window's weeks are the union of every club's last three games, so a
// week another club needed (its bye fell elsewhere) could pull one of HIS games outside his club's last three into
// the log, the chart and the strips. winGames = gamesInWindow(clubGames(blocks), state): a week his club played a
// game that is not in that set is out of his window; a bye week (no game) is left as it is.
export function ownWindow(series, winGames) {
  return (series || []).map((s) => (s.opp && s.team && !winGames.has(`${s.key}|${s.team}`) ? { ...s, inWin: false } : s));
}
export function windowName(st, weeks) {
  if (st.window === "last3") return "Last 3";
  if (st.window === "range" && weeks.length) return weeks.length === 1 ? weekLabel(weeks[0], st.season) : `${weekLabel(weeks[0], st.season)}–${weekLabel(weeks[weeks.length - 1], st.season)}`;
  return st.with2025 ? `${String(st.season - 1).slice(-2)}+${String(st.season).slice(-2)}` : "Season";
}

// Same "picked season[ + previous season]" prefix as player.js's seasonLabel (D184).
export function seasonLabel(st) {
  return `${st.season}${st.with2025 ? " + " + (st.season - 1) : ""}`;
}

// ---- the re-cut's layers: plain-text formatting (the kit escapes every field, so no HTML here) --------------
const DASH = "–";
const tInt = (v) => (isNum(v) ? String(Math.round(v)) : DASH);
const tFix = (v, d) => (isNum(v) ? (+v).toFixed(d) : DASH);
const tSigned = (v, d) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) : DASH);
const tPct = (v, d = 1) => (isNum(v) ? (v * 100).toFixed(d) + "%" : DASH);
const ratioOf = (a, b) => (isNum(a) && isNum(b) && b > 0 ? a / b : null);
export function ordinal(n) {
  if (!isNum(n)) return "";
  const m100 = n % 100, m10 = n % 10;
  return n + (m100 >= 11 && m100 <= 13 ? "th" : m10 === 1 ? "st" : m10 === 2 ? "nd" : m10 === 3 ? "rd" : "th");
}
const dirOf = (me, lg) => (isNum(me) && isNum(lg) ? (me > lg ? "up" : me < lg ? "down" : null) : null);

// The layer orders, exported for the tests (the D193 re-cut rule: nothing on the page before goes missing after).
// QB_PAGE_BEFORE is every figure the page drew before the re-cut (the passing tiles, the rushing headline and the
// rushing tiles); QB_PAGE_FIGURES lists, per layer, every figure it now draws (a tile's value and its sub line).
export const QB_HEADLINE_ORDER = Object.freeze(["yds", "tdInt", "totYds", "epaDb", "cpoe"]);
export const QB_OPP_ORDER = Object.freeze(["dbG", "att", "rzDb", "rushAttG", "in10Car", "snapPct"]);
export const QB_PASS_FRONT = Object.freeze(["ypa", "cmpPct", "succPct", "sackPct"]);
export const QB_PASS_SIDE = Object.freeze(["adot", "pressPct", "paPct", "blitzPct", "ttt", "xcomp"]);
export const QB_RUSH_FRONT = Object.freeze(["rushAtt", "rushYdsG", "rushTd", "rushEpaG"]);
export const QB_RUSH_SIDE = Object.freeze(["scrPct", "scr", "des", "rushEpa"]);
export const QB_VARIANCE_ORDER = Object.freeze(["tdPct", "intPct", "dropPer100", "flRate", "dkTdShare"]);
export const QB_GAMELOG_COLUMNS = Object.freeze(["wk", "opp", "db", "att", "cmpPct", "yds", "td", "int", "sackPct", "car", "ryds", "rtd", "dk"]);
export const QB_PAGE_BEFORE = Object.freeze(["db", "att", "cmpPct", "yds", "td", "int", "adot", "epaDb", "succPct", "cpoe", "sackPct", "pressPct", "paPct", "ttt", "xcomp",
  "rushAttG", "rushEpaG", "scrPct", "rushAtt", "rushYds", "rushTd", "rushEpa", "scr", "scrYds", "des", "desYds"]);
export const QB_PAGE_FIGURES = Object.freeze({
  headline: ["yds", "ydsG", "td", "int", "totYds", "totYdsG", "epaDb", "cpoe"],
  fantasy: ["dk", "dkG"], opportunity: ["dbG", "db", "att", "attG", "rzDb", "rushAttG", "in10Car", "snapPct"],
  passFront: [...QB_PASS_FRONT], passSide: [...QB_PASS_SIDE],
  rushFront: ["rushAtt", "rushAttG", "rushYdsG", "rushYds", "rushTd", "rushEpaG"], rushSide: ["scrPct", "scr", "scrYds", "des", "desYds", "rushEpa"],
  variance: [...QB_VARIANCE_ORDER, "fl", "fum"],
});

// PURE: the headline tiles (kit tileData shape plus `key`). R: his aggregateQb row ({} when none); ref: qbReference.
// League figure = the pool's plain mean; rank = his place in the pool (only when he is in it); tier from the pool.
export function qbHeadlineTiles(R, ref) {
  const pool = ref?.pool || [];
  const inPool = inQbPool(R.db, R.clubG);
  const rankOf = `${pool.length} QBs`;
  const mk = (key, label, get, digits, fmt, { sub = null, lgFmt = fmt, title }) => {
    const s = qbPoolStat(pool, get, { digits });
    const v = get(R);
    return { key, label, value: fmt(v), lg: isNum(s.lg) ? lgFmt(s.lg) : null, rank: inPool && isNum(v) ? ordinal(s.rank(v)) : null, rankOf: inPool && isNum(v) ? rankOf : null, sub, tier: s.tier(v) || null, title };
  };
  const g = R.g || 0;
  const tot = (r) => (isNum(r.yds) || isNum(r.rushYds) ? (r.yds ?? 0) + (r.rushYds ?? 0) : null);
  const L = ref?.lg || {};
  const tiles = [
    mk("yds", "Passing yards", (r) => r.yds, 0, tInt, { sub: g ? `${tFix(R.yds / g, 1)} per game` : null, title: "Passing yards: yards on his completed passes (pass-interference no-plays excluded). League figure: the QB reference pool's mean; rank and colour among that pool. Source: nflverse play-by-play" }),
    { ...mk("tdInt", "TD–INT", (r) => (isNum(r.td) && isNum(r.int) ? r.td - r.int : null), 0, tInt, { title: "Passing touchdowns – interceptions. Ranked and coloured on the difference (TD minus INT) among the QB reference pool; the league figure is the pool's mean TD – mean INT. Source: nflverse play-by-play" }),
      value: isNum(R.td) ? `${R.td}–${R.int ?? 0}` : DASH, lg: isNum(L.td) ? `${tFix(L.td, 1)}–${tFix(L.int, 1)}` : null, sub: isNum(R.td) ? `${tSigned(R.td - (R.int ?? 0), 0) || "0"} difference` : null },
    mk("totYds", "Total yards", tot, 0, tInt, { sub: g && isNum(tot(R)) ? `${tFix(tot(R) / g, 1)} per game` : null, title: "Passing yards + rushing yards (designed runs and scrambles). League figure: the QB reference pool's mean; rank and colour among that pool. Source: nflverse play-by-play" }),
    mk("epaDb", "EPA / dropback", (r) => r.epaDb, 2, (v) => tSigned(v, 2), { title: "Expected points added per dropback (sacks and scrambles included). Source: nflverse play-by-play" }),
    mk("cpoe", "CPOE", (r) => r.cpoe, 1, (v) => tSigned(v, 1), { title: "Completion % over expected: the mean of the play-by-play CPOE over his attempts. Source: nflverse play-by-play" }),
  ];
  return tiles;
}

// PURE: the Opportunity tiles (inside the fantasy band).
export function qbOppTiles(R, ref) {
  const pool = ref?.pool || [], L = ref?.lg || {}, cuts = ref?.cuts;
  const dbG = qbPoolStat(pool, (r) => ratioOf(r.db, r.g), { digits: 1 });
  const tier = (k) => qbTier(k, R[k], cuts) || null;
  return [
    { key: "dbG", label: "Dropbacks / game", value: tFix(ratioOf(R.db, R.g), 1), lg: isNum(dbG.lg) ? tFix(dbG.lg, 1) : null, sub: `${tInt(R.db ?? 0)} dropbacks`, title: "Dropbacks (pass attempts + sacks + scrambles) per game he played. Source: nflverse play-by-play" },
    { key: "att", label: "Attempts", value: tInt(R.att ?? 0), lg: isNum(L.att) ? tFix(L.att, 0) : null, sub: R.g ? `${tFix(R.att / R.g, 1)} per game` : null, title: "Pass attempts (pass-interference no-plays excluded). Source: nflverse play-by-play" },
    { key: "rzDb", label: "Red-zone dropbacks", value: tInt(R.rzDb ?? 0), lg: isNum(L.rzDb) ? tFix(L.rzDb, 1) : null, title: "Dropbacks from the opponent's 20-yard line or closer. Source: nflverse play-by-play" },
    { key: "rushAttG", label: "Carries / game", value: tFix(R.rushAttG, 1), lg: isNum(L.rushAttG) ? tFix(L.rushAttG, 1) : null, tier: tier("rushAttG"), title: "Designed runs + scrambles per game he played (coloured only for runners). Source: nflverse play-by-play" },
    { key: "in10Car", label: "Carries inside the 10", value: tInt(R.in10Car ?? 0), lg: isNum(L.in10Car) ? tFix(L.in10Car, 1) : null, title: "Designed runs + scrambles from the opponent's 10-yard line or closer. Source: nflverse play-by-play" },
    { key: "snapPct", label: "Snap %", value: tPct(R.snapPct, 0), lg: isNum(L.snapPct) ? tPct(L.snapPct, 0) : null, share: true, bar: R.snapPct, lgBar: L.snapPct, title: "The mean of his weekly offensive snap share over his club's games the snap table lists him in (the dashed tick is the pool's mean). Source: nflverse snap counts" },
  ];
}

// PURE: the passing block's front tiles and side items.
export function qbPassTiles(R, ref, pnote = "") {
  const L = ref?.lg || {}, cuts = ref?.cuts;
  const tier = (k) => qbTier(k, R[k], cuts) || null;
  const lgT = (t) => (t && t !== DASH ? ` League (pool mean): ${t}.` : "");
  const front = [
    { key: "ypa", label: "Yards / attempt", value: tFix(R.ypa, 1), lg: isNum(L.ypa) ? tFix(L.ypa, 1) : null, tier: tier("ypa"), title: "Passing yards / pass attempts. Source: nflverse play-by-play" },
    { key: "cmpPct", label: "Cmp %", value: tPct(R.cmpPct), lg: isNum(L.cmpPct) ? tPct(L.cmpPct) : null, tier: tier("cmpPct"), title: "Completions / attempts. Source: nflverse play-by-play" },
    { key: "succPct", label: "Success %", value: tPct(R.succPct, 0), lg: isNum(L.succPct) ? tPct(L.succPct, 0) : null, tier: tier("succPct"), title: "Share of his dropbacks that were successful plays (nflverse success). Source: nflverse play-by-play" },
    { key: "sackPct", label: "Sack %", value: tPct(R.sackPct), lg: isNum(L.sackPct) ? tPct(L.sackPct) : null, tier: tier("sackPct"), title: "Sacks / dropbacks (lower is better). Source: nflverse play-by-play" },
  ];
  const side = [
    { key: "adot", label: "aDOT", value: tFix(R.adot, 1), title: `Air yards per attempt.${lgT(tFix(L.adot, 1))} Source: nflverse play-by-play` },
    { key: "pressPct", label: "Pressure %", value: tPct(R.pressPct, 0), tier: tier("pressPct"), title: `PFR pressures / PFR dropbacks${R.pfrWeeks ? ` over ${R.pfrWeeks} week${R.pfrWeeks === 1 ? "" : "s"}` : ""}.${lgT(tPct(L.pressPct, 0))}${pnote ? " " + pnote + "." : ""} Source: PFR advanced stats` },
    { key: "paPct", label: "Play action %", value: tPct(R.paPct, 0), title: `Share of his dropbacks with play action.${lgT(tPct(L.paPct, 0))} Source: FTN charting` },
    { key: "blitzPct", label: "Blitzed %", value: tPct(R.blitzPct, 0), title: `Share of his dropbacks with 1+ blitzers.${lgT(tPct(L.blitzPct, 0))} Source: FTN charting` },
    { key: "ttt", label: "Time to throw", value: isNum(R.ttt) ? R.ttt.toFixed(2) + "s" : DASH, title: `Average time to throw, weighted by his dropbacks each week.${lgT(isNum(L.ttt) ? L.ttt.toFixed(2) + "s" : "")} Source: Next Gen Stats` },
    { key: "xcomp", label: "Expected cmp %", value: tPct(R.xcomp), title: `Expected completion %, weighted by his attempts each week.${lgT(tPct(L.xcomp))} Source: Next Gen Stats` },
  ];
  return { front, side };
}

// PURE: the rushing block's four-figure front (carries with per game under, rush yards per game, rush TD, rush EPA
// per game) and side items. The front is new (the plan: the table's expanded row keeps rushHeadline). Carries per
// game alone is the Opportunity tile (the lead, 2026-09-25: not twice). Tiers follow qbTier's rush rule exactly as
// rushHeadline does (weak and low left uncoloured), so a pocket passer's front sits grey; total carries and rush TD,
// which the reference has no cuts for, are cut over the pool with qbPoolStat under the same rule.
export function qbRushTiles(R, ref) {
  const L = ref?.lg || {}, cuts = ref?.cuts;
  const tier = (k) => qbTier(k, R[k], cuts) || null;
  const lgT = (t) => (t && t !== DASH ? ` League (pool mean): ${t}.` : "");
  // A count at zero never colours: with most of the pool on 0 rush TD the cuts sit at 0, and 0 would read "strong".
  const runnerTier = (k) => { if (!(R[k] > 0)) return null; const t = qbPoolStat(ref?.pool || [], (r) => r[k]).tier(R[k]); return t === "weak" || t === "flat" ? null : t || null; };
  const front = [
    { key: "rushAtt", label: "Carries", value: tInt(R.rushAtt ?? 0), lg: isNum(L.rushAtt) ? tFix(L.rushAtt, 1) : null, sub: `${tFix(R.rushAttG, 1)} per game`, tier: runnerTier("rushAtt"), title: "Designed runs + scrambles (per game he played under it). Source: nflverse play-by-play" },
    { key: "rushYdsG", label: "Rush yards / game", value: tFix(R.rushYdsG, 1), lg: isNum(L.rushYdsG) ? tFix(L.rushYdsG, 1) : null, sub: `${tInt(R.rushYds ?? 0)} yds`, tier: tier("rushYdsG"), title: "Rushing yards (designed runs + scrambles) per game he played. Source: nflverse play-by-play" },
    { key: "rushTd", label: "Rush TD", value: tInt(R.rushTd ?? 0), lg: isNum(L.rushTd) ? tFix(L.rushTd, 1) : null, tier: runnerTier("rushTd"), title: "Rushing touchdowns (designed runs + scrambles). Source: nflverse play-by-play" },
    { key: "rushEpaG", label: "Rush EPA / game", value: tSigned(R.rushEpaG, 2), lg: isNum(L.rushEpaG) ? tSigned(L.rushEpaG, 2) : null, tier: tier("rushEpaG"), title: "Expected points added on his designed runs and scrambles, per game he played. Source: nflverse play-by-play" },
  ];
  const side = [
    { key: "scrPct", label: "Scramble rate", value: tPct(R.scrPct), tier: tier("scrPct"), title: `Scrambles / dropbacks.${lgT(tPct(L.scrPct))} Source: nflverse play-by-play` },
    { key: "scr", label: "Scrambles", value: `${tInt(R.scr ?? 0)} · ${tInt(R.scrYds ?? 0)} yds`, title: `Scrambles (dropbacks he ran from) and their yards.${lgT(tFix(L.scr, 1))} Source: nflverse play-by-play` },
    { key: "des", label: "Designed runs", value: `${tInt(R.des ?? 0)} · ${tInt(R.desYds ?? 0)} yds`, title: `Designed runs (called runs where he is the ball carrier; kneel-downs are not in the play rows) and their yards.${lgT(tFix(L.des, 1))} Source: nflverse play-by-play` },
    { key: "rushEpa", label: "EPA / carry", value: tSigned(R.rushEpa, 2), tier: tier("rushEpa"), title: `Expected points added per carry (designed runs and scrambles).${lgT(tSigned(L.rushEpa, 2))} Source: nflverse play-by-play` },
  ];
  return { front, side };
}

// PURE: the variance strip: his rate beside the pool's pooled rate (qbReference.pooled), marked above or below.
export function qbVarianceItems(R, ref) {
  const P = ref?.pooled || {};
  const fum = R.fum ?? 0, fl = R.fl ?? 0;
  return [
    { key: "tdPct", label: "TD %", me: tPct(R.tdPct), lg: tPct(P.tdPct), dir: dirOf(R.tdPct, P.tdPct), title: "Passing touchdowns / attempts, beside every pool QB's touchdowns over their attempts. Source: nflverse play-by-play" },
    { key: "intPct", label: "INT %", me: tPct(R.intPct), lg: tPct(P.intPct), dir: dirOf(R.intPct, P.intPct), title: "Interceptions / attempts, beside every pool QB's interceptions over their attempts. Source: nflverse play-by-play" },
    { key: "dropPer100", label: "Drops / 100 att", me: tFix(R.dropPer100, 1), lg: tFix(P.dropPer100, 1), dir: dirOf(R.dropPer100, P.dropPer100), title: "Passes his receivers dropped per 100 of his attempts, over the weeks PFR lists him (PFR runs about a week behind). Source: PFR advanced stats (drops), nflverse play-by-play (attempts)" },
    { key: "flRate", label: "Fumbles lost", me: `${fl} of ${fum}${fum ? ` (${tPct(R.flRate, 0)})` : ""}`, lg: tPct(P.flRate, 0), dir: dirOf(R.flRate, P.flRate), title: "His fumbles the defence recovered, out of his fumbles (any play; return fumbles are not in the rows), beside the pool's share lost. Source: nflverse play-by-play" },
    { key: "dkTdShare", label: "DK points from TDs", me: tPct(R.dkTdShare, 0), lg: tPct(P.dkTdShare, 0), dir: dirOf(R.dkTdShare, P.dkTdShare), title: "Share of his DraftKings points that came from touchdowns (4 per passing TD, 6 per rushing TD), beside the pool QBs' mean share. Source: nflverse play-by-play" },
  ];
}

// PURE: the game log's rows (kit fantasyBand shape) from his weekly series (qbWeeklySeries: the row's own series
// weeks, the window's only) and his fantasyByPlayer games. A week his club had no game reads BYE; a week his club
// played without him (no dropback or carry) reads DNP; a week whose only row was a lost fumble still scores, so it
// is shown as a played week. One total row per season when the weeks span seasons, then a grand total.
// cuts: { att, yds, dk } from qbGameCuts (each cell's tint against every pool QB's single games).
export function qbGameLog(series, fantasyGames, season, cuts = {}) {
  const fg = new Map((fantasyGames || []).map((g) => [String(g.gk).split("|")[0], g]));
  const weeks = (series || []).filter((s) => s.inWin !== false);
  const seasons = [...new Set(weeks.map((s) => splitKey(s.key).season))];
  const multi = seasons.length > 1;
  const columns = [
    { key: "wk", label: "Wk", align: "left" }, { key: "opp", label: "Opp", align: "left" },
    { key: "db", label: "Db" }, { key: "att", label: "Att", kind: "share1", cuts: cuts.att || null }, { key: "cmpPct", label: "Cmp %" },
    { key: "yds", label: "Yds", cuts: cuts.yds || null }, { key: "td", label: "TD" }, { key: "int", label: "INT" }, { key: "sackPct", label: "Sack %" },
    { key: "car", label: "Car", kind: "share2" }, { key: "ryds", label: "Rush yds" }, { key: "rtd", label: "Rush TD" },
    { key: "dk", label: "DK", kind: "dk", cuts: cuts.dk || null },
  ];
  const zero = () => ({ db: 0, att: 0, cmp: 0, yds: 0, td: 0, int: 0, sacks: 0, car: 0, ryds: 0, rtd: 0, dk: 0, n: 0 });
  const add = (t, w) => { for (const k of Object.keys(w)) t[k] += w[k]; };
  const totalCells = (label, t) => [label, t.n ? `${t.n} g` : "", String(t.db), String(t.att), tPct(ratioOf(t.cmp, t.att)), String(t.yds), String(t.td), String(t.int), tPct(ratioOf(t.sacks, t.db)), String(t.car), String(t.ryds), String(t.rtd), (Math.round(t.dk * 100) / 100).toFixed(1)];
  const rows = [];
  const grand = zero();
  for (const yr of seasons) {
    if (multi) rows.push({ type: "season", label: String(yr) });
    const tot = zero();
    for (const s of weeks.filter((w) => splitKey(w.key).season === yr)) {
      const g = fg.get(s.key) || null;
      // onField: a dropback or a carry that week (one of his games, G); a fumble-only week keeps its row and points
      // but is not one of his games, and only its DK cell takes a tint.
      const onField = s.car !== null && s.car !== undefined;
      const played = onField || !!g;
      const wk = weekLabel(s.key, season);
      const oppTxt = s.opp ? `${s.home === false ? "@" : ""}${s.opp}` : "";
      if (!played) {
        rows.push({ type: "week", key: s.key, wk, opp: oppTxt, season: yr, pts: null, shares: [null, null], note: s.dnp ? "dnp" : "bye", cells: [wk], heat: {} });
        continue;
      }
      const L = g?.line || {};
      const w = { db: s.db || 0, att: s.att || 0, cmp: isNum(s.cmpPct) ? Math.round(s.cmpPct * (s.att || 0)) : 0, yds: L.passYds || 0, td: L.passTd || 0, int: L.int || 0,
        sacks: s.sacks || 0, car: s.car || 0, ryds: s.ryds || 0, rtd: L.rushTd || 0, dk: isNum(g?.pts) ? g.pts : 0, n: onField ? 1 : 0 };
      add(tot, w);
      rows.push({
        type: "week", key: s.key, wk, opp: oppTxt, season: yr, pts: isNum(g?.pts) ? g.pts : 0, shares: [w.att, w.car], note: null,
        cells: [wk, oppTxt, String(w.db), String(w.att), tPct(s.cmpPct, 0), String(w.yds), String(w.td), String(w.int), tPct(ratioOf(w.sacks, w.db), 0), String(w.car), String(w.ryds), String(w.rtd), w.dk.toFixed(1)],
        heat: onField ? { att: w.att, yds: w.yds, dk: w.dk } : { dk: w.dk },
      });
    }
    add(grand, tot);
    if (multi) rows.push({ type: "total", cells: totalCells(`${yr} total`, tot) });
  }
  if (weeks.length) rows.push({ type: "total", cells: totalCells("Total", grand) });
  return { rows, columns, totals: grand };
}

// Page-local view state that does not belong in the link: the zone measure, the open zone, screens in the splits.
// pastOpen: the game log's previous-season weeks unfolded (folded to its totals row by default). layout: the measured
// fits (the chart's width, the log beside or under it, the strips' widths), keyed by the link and the page width.
const ui = { gsis: null, zoneMode: "cmpPct", zone: null, noScreens: false, pastOpen: false, layout: null };

// PURE: bar width and gap for qbStrips so its weeks spread across `fit` px (the same rule as charts/bars.js
// weeklyStrips' fit: an even share per week, the bar at most 90px wide, the rest gap); no fit, or under 44px a
// week (a "25-W10" label would overprint its neighbour), leaves the defaults.
export function stripFit(fit, n, { lw, rw, bw, gap }) {
  if (!(fit > 0) || !(n > 0)) return { bw, gap };
  const cell = (fit - lw - rw) / n;
  if (cell < 44) return { bw, gap };
  const b = Math.max(18, Math.min(90, cell * 0.72));
  return { bw: b, gap: Math.max(gap, cell - b) };
}
// PURE: the page's fits from what the page measured. The game log sits beside the chart when the chart keeps at
// least 44px a week there (room for a "25-W10" label; the chart's label and axis columns are 150 + 92px), else under it.
export function qbLayoutFrom({ bandW, logW, chartWeeks, weeksW, rushW }) {
  const out = {};
  if (logW > 0 && chartWeeks > 0) {
    const beside = bandW - logW - 28;
    if (beside >= 242 + chartWeeks * 44) out.chartW = Math.floor(beside);
    else out.stack = true;
  }
  if (weeksW > 0) out.weeksW = Math.floor(weeksW);
  if (rushW > 0) out.rushW = Math.floor(rushW);
  return out;
}

export async function renderQbPlayer(ctx, params, query) {
  const { root, isCurrent } = ctx;
  const gsis = params.gsis;
  const st = fromQuery(query);
  const minDb = minDbOf(query);
  if (ui.gsis !== gsis) { ui.gsis = gsis; ui.zone = null; ui.pastOpen = false; }
  const go = (n) => { const q = qbQuery({ ...n, open: "" }, minDb); location.hash = `#/player/${encodeURIComponent(gsis)}${q ? "?" + q : ""}`; };
  if (!root.querySelector(".an-qbp")) root.innerHTML = `<div class="an-msg">Loading quarterback…</div>`;
  let data, teams, madden, feed;
  try {
    // The injury status feed (D196) never fails: an empty feed simply shows no status.
    [data, teams, madden, feed] = await Promise.all([
      loadFor(seasonsOf(st), { ...st, window: "season" }),
      loadTeams().then((j) => new Map((j.teams || []).map((t) => [t.abbr, t]))).catch(() => new Map()),
      loadMadden(st.season),
      loadStatusFeed(),
    ]);
  } catch (e) {
    if (!isCurrent()) return;
    root.innerHTML = `<div class="an-msg an-msg-err">Could not load the analytics data: ${esc(e.message)}</div>`;
    return;
  }
  if (!isCurrent()) return;
  const qs = qbQuery({ ...st, open: "" }, minDb);
  const meta = data.players[gsis];
  if (!meta) {
    root.innerHTML = `<div class="an-msg"><div class="an-msg-title">No such player</div>No player with id ${esc(gsis)} in these analytics files. <a href="#/qb${qs ? "?" + qs : ""}">Back to Quarterbacks</a></div>`;
    return;
  }
  const pst = pageState(st);
  const fullSt = { ...pst, window: "season", from: null, to: null };
  const win = aggregateQb(data.blocks, data.players, pst, { playsFor: gsis });
  const full = aggregateQb(data.blocks, data.players, fullSt);
  const ref = qbReference(win.rows);
  const L = ref.lg, cuts = ref.cuts;
  const name = displayName(gsis, data.players);
  document.title = `${name} · NFL Analytics`;
  const r = win.rows.find((x) => x.gsis === gsis) || null;
  const frow = full.rows.find((x) => x.gsis === gsis) || null;
  const lastKey = Object.keys(meta.teams || {}).sort().pop();
  const team = r?.team || frow?.team || (lastKey ? meta.teams[lastKey] : "");
  const mq = maddenQb(madden, gsis, st.season);
  const wn = windowName(st, win.weeks);
  const activeKey = st.window === "range" && st.from && st.from === st.to ? st.from : null;
  const pnote = pfrNote(win.pfrThrough, win.latestKey, st.season);

  // The whole timeline, the window's weeks bright, with the opponent under each week.
  const games = new Map(clubGames(data.blocks).map((g) => [`${g.key}|${g.team}`, g]));
  const winKeys = new Set(win.weeks);
  const series = ownWindow(qbWeeklySeries(frow?.series || full.weeks.map((key) => ({ key })), meta, games, winKeys), gamesInWindow(clubGames(data.blocks), pst));
  const R = r || {};

  // (2) Fantasy: the game log over the window's weeks, its heat against every pool QB's games, the chart's overlay
  // (pass attempts and carries) on one count scale.
  const log = qbGameLog(series, fantasyByPlayer(data.blocks, data.players, fullSt).get(gsis)?.games, st.season, qbGameCuts(ref.pool, fantasyByPlayer(data.blocks, data.players, pst)));
  const ovTop = Math.max(10, Math.ceil(Math.max(0, ...log.rows.filter((x) => x.type === "week").flatMap((x) => (x.shares || []).filter(isNum))) / 10) * 10);
  const dkStat = qbPoolStat(ref.pool, (x) => x.dkG, { digits: 1 });
  const dkRank = inQbPool(R.db, R.clubG) && isNum(R.dkG) ? ` · ${ordinal(dkStat.rank(R.dkG))} of ${ref.pool.length} QBs` : "";
  // The chart sizes its columns to the width left beside the game log (kit.js has no DOM access): the page is drawn
  // at the fits measured last time (or the defaults), then measured and drawn once more if a fit moved.
  const rcs = getComputedStyle(root);
  const bandW = Math.max(600, Math.min((root.clientWidth || 1400) - (parseFloat(rcs.paddingLeft) || 0) - (parseFloat(rcs.paddingRight) || 0), 1760) - 32);
  const layoutKey = `${gsis}|${qs}|${root.clientWidth}|${ui.pastOpen}`;
  let lay = ui.layout?.key === layoutKey ? ui.layout.lay : {};
  const bandOpts = {
    title: "Fantasy", sub: `DraftKings · ${tFix(R.dkG, 1)} per game · ${tFix(R.dk, 1)} total${dkRank}`,
    rows: log.rows, columns: log.columns, shareLabels: ["Pass attempts", "Carries"], ovScale: { max: ovTop, top: `${ovTop} att`, bottom: "0" },
    total: `${wn} ${tFix(R.dk, 1)}`, avg: L.dkG, avgText: `lg ${tFix(L.dkG, 1)}/g`, tiles: qbOppTiles(R, ref), current: st.season,
  };
  const fantasyHtml = () => fantasyBand({ ...bandOpts, pastOpen: ui.pastOpen, width: lay.chartW || bandW, stack: !!lay.stack });

  // (3) Passing: the week-by-week strips, the zone field, the splits, unchanged, as the block's body.
  const maxAdot = Math.max(12, ...series.map((s) => (isNum(s.adot) ? s.adot : 0)));
  const strips = [
    { k: "epaDb", label: "EPA/dropback", signed: true, span: 0.6, fmt: (v) => signed(v, 2), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: R.epaDb, totalText: `${wn} ${isNum(R.epaDb) ? signed(R.epaDb, 2) : "–"}`, avg: L.epaDb, avgText: `lg ${isNum(L.epaDb) ? signed(L.epaDb, 2) : "–"}`, tier: (v) => qbTier("epaDb", v, cuts) },
    { k: "cpoe", label: "CPOE", signed: true, span: 15, fmt: (v) => signed(v, 1), short: (v) => signed(v, 0), total: R.cpoe, totalText: `${wn} ${isNum(R.cpoe) ? signed(R.cpoe, 1) : "–"}`, avg: L.cpoe, avgText: `lg ${isNum(L.cpoe) ? signed(L.cpoe, 1) : "–"}`, tier: (v) => qbTier("cpoe", v, cuts) },
    { k: "adot", label: "aDOT", signed: false, span: maxAdot * 1.05, fmt: (v) => v.toFixed(1), short: (v) => v.toFixed(1), total: R.adot, totalText: `${wn} ${isNum(R.adot) ? R.adot.toFixed(1) : "–"}`, avg: L.adot, avgText: `lg ${isNum(L.adot) ? L.adot.toFixed(1) : "–"}` },
  ];
  const weekly = () => (series.length ? qbStrips(series, strips, { season: st.season, activeKey, hit: true, big: true, lw: 140, sh: 72, ...stripFit(lay.weeksW, series.length, { lw: 140, rw: 82, bw: 38, gap: 9 }) }) : `<div class="an-note">No weeks loaded.</div>`);
  const zones = qbZones(r?.zones, win.lgZones);
  const zoned = Object.values(zones).reduce((s, c) => s + c.n, 0);
  const zoneHtml = () => `<div class="an-pl-zhead"><div class="an-seg" data-zmode>${QB_ZONE_MODES.map((m) => `<button type="button" data-v="${m.k}" class="${ui.zoneMode === m.k ? "on" : ""}">${m.label}</button>`).join("")}</div>${qbZoneLegend(ui.zoneMode)}</div>
    <div class="an-pl-zbody">${qbZoneField(zones, ui.zoneMode, { selected: ui.zone })}<div class="an-pl-plays">${playsHtml(zones, ui.zone, st, data.players)}</div></div>`;
  const passBody = () => `<div class="an-qbp-row">
      <div class="an-card an-qbp-weeks"><div class="an-dh">Week by week <span class="an-dsub">click a week to show it alone; click it again for the whole window</span></div><div class="an-pl-scroll">${weekly()}</div></div>
      <div class="an-card an-qbp-zones"><div class="an-dh">Attempts by zone <span class="an-dsub">${zoned} attempts with a depth and direction · each cell vs every QB there</span></div><div data-zones>${zoneHtml()}</div></div>
      <div class="an-card an-qbp-splitsc"><div class="an-dh">Splits <span class="an-dsub">his dropbacks vs every QB's, same window</span>
        <label class="an-switch an-qbp-scr" title="Leave FTN-charted screen passes out of every split"><input type="checkbox" data-screens${ui.noScreens ? " checked" : ""}><span>Exclude screens</span></label></div><div data-splits></div></div>
    </div>`;
  const pt = qbPassTiles(R, ref, pnote);
  const passBlock = () => phaseBlock({ title: "Passing", tint: "pass", front: pt.front, side: pt.side, body: passBody() });

  // Rushing: the four-figure front, the side items, carries and yards by week.
  const maxCar = Math.max(4, ...series.map((s) => (isNum(s.car) ? s.car : 0)));
  const maxRy = Math.max(20, ...series.map((s) => (isNum(s.ryds) ? s.ryds : 0)));
  const rushStrips = [
    { k: "car", label: "Carries", signed: false, span: maxCar * 1.05, fmt: (v) => `${v} carries`, short: (v) => String(v), total: R.rushAtt, totalText: `${wn} ${R.rushAtt ?? 0}`, avg: L.rushAttG, avgText: `lg ${isNum(L.rushAttG) ? L.rushAttG.toFixed(1) : "–"}/g` },
    { k: "ryds", label: "Rush yards", signed: false, span: maxRy * 1.05, fmt: (v) => `${v} yds`, short: (v) => String(v), total: R.rushYds, totalText: `${wn} ${R.rushYds ?? 0}`, avg: L.rushYdsG, avgText: `lg ${isNum(L.rushYdsG) ? L.rushYdsG.toFixed(0) : "–"}/g` },
  ];
  const rtl = qbRushTiles(R, ref);
  const rushBlock = () => phaseBlock({ title: "Rushing", tint: "rush", front: rtl.front, side: rtl.side,
    body: `<div class="an-pl-scroll an-qbp-rush">${series.length ? qbStrips(series, rushStrips, { season: st.season, activeKey, hit: true, sh: 40, lw: 108, rw: 62, ...stripFit(lay.rushW, series.length, { lw: 108, rw: 62, bw: 34, gap: 7 }) }) : ""}</div>` });

  // (4) Variance and (5) Madden.
  const variance = `<div class="an-qbp-var"><div class="an-dh">Variance <span class="an-dsub">his rate beside the QB pool's, above or below, never good or bad</span></div>${varianceStrip(qbVarianceItems(R, ref))}</div>`;
  const maddenHtml = `<div class="an-card an-qbp-madden"><div class="an-dh">Madden · passing ${mq.title ? `<span class="an-dsub">${esc(mq.title)}</span>` : ""}</div>
    ${mq.status === "absent" ? `<div class="an-note">Madden ratings not on file.</div>`
      : mq.status === "unrated" ? `<div class="an-note">No ${esc(maddenEdition(st.season))} rating on file for him.</div>`
      : ratingBars(mq.bars, "QB") + `<div class="an-note">EA's passing attributes; the tick is the QB median (${mq.peers} rated).</div>`}</div>`;

  const sub = `${seasonLabel(st)} · ${win.weeks.length ? (win.weeks.length === 1 ? weekLabel(win.weeks[0], st.season) : `${weekLabel(win.weeks[0], st.season)} to ${weekLabel(win.weeks[win.weeks.length - 1], st.season)}`) : "no games"}${st.window === "last3" ? " (each club's last 3 games)" : ""} · league reference: ${ref.text}${pnote ? " · " + pnote : ""}`;
  const ovr = isNum(mq.ovr) ? `<span class="an-pl-ovr t-${ratingTier(mq.ovr)}" title="${esc(mq.title)} overall"><b>${mq.ovr}</b><small>OVR</small></span>` : "";
  const depth = `../#/team/${encodeURIComponent(team)}/player/${encodeURIComponent(gsis)}`;

  const draw = () => { root.innerHTML = `<section class="an-pl an-qbp">
    ${playerHead({ lead: backLink(`#/qb${qs ? "?" + qs : ""}`, "Quarterbacks"), name, espnId: meta.espnId, colour: teams.get(team)?.colourPrimary,
      pills: `${team ? teamPill(team, teams, qs, "an-pl-pill") : ""}<span class="an-pospill" data-band="QB">QB</span>${ovr}`,
      links: `<div class="an-pl-links"><a href="${depth}" target="_blank" rel="noopener">Depth chart ↗</a>${team ? `<a href="#/team/${esc(team)}${qs ? "?" + qs : ""}">Team page →</a>` : ""}</div>`,
      status: currentStatus(feed, gsis, seasonsOf(st)), statusSeason: feed?.season ?? null, latestWeek: latestWeekIn(data.keys, feed?.season) })}
    <div class="an-pl-bar"><div class="an-filters"></div></div>
    <div class="an-sub an-pl-sub">${esc(sub)}</div>
    ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    ${r ? "" : `<div class="an-warn">No dropbacks or carries for him in this window.</div>`}
    ${headlineRow(qbHeadlineTiles(R, ref))}
    ${fantasyHtml()}
    <div class="an-qbp-split">${passBlock()}<div class="an-qbp-side">${rushBlock()}${variance}${maddenFoot(maddenHtml)}</div></div>
    <p class="an-foot">Dropbacks, attempts, completions, yards, TD, INT, aDOT, EPA, success, CPOE, sacks, scrambles, designed runs, red-zone and inside-the-10 figures, fumbles and zones: nflverse play-by-play. DraftKings points: the same play rows, DraftKings Classic scoring with no 2-point conversions or return touchdowns (kneel-downs are not in the rows). Snap %: nflverse snap counts. Play action, screens, blitz % and the blitz split: FTN charting. Pressure % and drops by his receivers: PFR advanced stats (a week behind). Pressured vs clean: the 2025 participation file (per-play pressure; none exists for 2026 yet). Time to throw and expected completion: Next Gen Stats. Passing attributes: EA Madden ratings. Zone references pool every QB attempt in the window; every other league figure is the QB reference pool's. No QBR.</p>
  </section>`; };
  draw();
  const q = (sel, prop = "clientWidth") => root.querySelector(sel)?.[prop] || 0;
  const measured = qbLayoutFrom({ bandW, logW: q(".an-rc-fanband .an-rc-gl", "offsetWidth"), chartWeeks: root.querySelectorAll(".an-rc-fanchart .an-wb-hit").length,
    weeksW: q(".an-qbp-weeks .an-pl-scroll"), rushW: q(".an-qbp-rush") });
  if (JSON.stringify(measured) !== JSON.stringify(lay)) { lay = measured; draw(); }
  ui.layout = { key: layoutKey, lay };
  root.querySelector("[data-gl-toggle]")?.addEventListener("click", () => { ui.pastOpen = !ui.pastOpen; renderQbPlayer(ctx, params, query); });
  renderFilterBar(root.querySelector(".an-filters"), st, { keys: data.keys, teams: [] }, go);
  root.querySelectorAll(".an-wb-hit[data-key]").forEach((h) => h.addEventListener("click", () => {
    const k = h.dataset.key;
    go(k === activeKey ? { ...st, window: "season", from: null, to: null } : { ...st, window: "range", from: k, to: k });
  }));
  const zbox = root.querySelector("[data-zones]");
  const wireZones = () => {
    zbox.querySelectorAll("[data-zmode] button").forEach((b) => b.addEventListener("click", () => { ui.zoneMode = b.dataset.v; zbox.innerHTML = zoneHtml(); wireZones(); }));
    zbox.querySelectorAll("[data-zone]").forEach((c) => c.addEventListener("click", () => { ui.zone = ui.zone === c.dataset.zone ? null : c.dataset.zone; zbox.innerHTML = zoneHtml(); wireZones(); }));
    zbox.querySelector("[data-close]")?.addEventListener("click", () => { ui.zone = null; zbox.innerHTML = zoneHtml(); wireZones(); });
  };
  wireZones();
  const sbox = root.querySelector("[data-splits]");
  const paintSplits = () => { sbox.innerHTML = splitsHtml(qbSplits(data.blocks, data.players, pst, gsis, { noScreens: ui.noScreens }), st); };
  paintSplits();
  root.querySelector("[data-screens]")?.addEventListener("change", (e) => { ui.noScreens = e.target.checked; paintSplits(); });
}

// The splits as one compact table: each split's two sides, his figure with every QB's beside it.
export function splitsHtml(sp, st) {
  const P = (v, d = 1) => (isNum(v) ? (v * 100).toFixed(d) + "%" : "–");
  const cells = (me, lg) => [
    `<td class="num">${me.db}</td>`,
    `<td class="num">${P(me.cmpPct, 0)}<em>${P(lg.cmpPct, 0)}</em></td>`,
    `<td class="num">${isNum(me.ypa) ? me.ypa.toFixed(1) : "–"}<em>${isNum(lg.ypa) ? lg.ypa.toFixed(1) : "–"}</em></td>`,
    `<td class="num ${isNum(me.epaDb) && isNum(lg.epaDb) ? (me.epaDb >= lg.epaDb ? "up" : "down") : ""}">${isNum(me.epaDb) ? signed(me.epaDb, 2) : "–"}<em>${isNum(lg.epaDb) ? signed(lg.epaDb, 2) : "–"}</em></td>`,
    `<td class="num">${P(me.succPct, 0)}<em>${P(lg.succPct, 0)}</em></td>`,
    `<td class="num">${P(me.sackPct)}<em>${P(lg.sackPct)}</em></td>`,
  ].join("");
  const rows = SPLITS.map(([k]) => {
    const s = sp[k];
    if (k === "pressure" && !s.available) {
      return `<tr class="an-qbp-sgap"><th>Pressured / clean</th><td colspan="6" class="an-note">${st.with2025 ? `No per-play pressure for him in the ${st.season - 1} weeks of this window.` : `Per-play pressure exists only in the ${st.season - 1} participation file: switch on Include ${st.season - 1}. (PFR gives ${st.season} weekly totals only: see Pressure %.)`}</td></tr>`;
    }
    return `<tr class="an-qbp-sfirst"><th>${esc(s.yesLabel)}</th>${cells(s.yes, s.lgYes)}</tr><tr><th>${esc(s.noLabel)}</th>${cells(s.no, s.lgNo)}</tr>`;
  }).join("");
  return `<table class="an-qbp-splits"><thead><tr><th></th><th class="num">Db</th><th class="num">Cmp %</th><th class="num">Y/A</th><th class="num">EPA/db</th><th class="num">Succ %</th><th class="num">Sack %</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="an-note">Small figure: every QB's dropbacks on that side, pooled. Blitzed = FTN charted 1+ blitzers.</div>`;
}

const ord = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n === 4 ? "4th" : "");
function playsHtml(zones, zone, st, players) {
  if (!zone) return `<div class="an-note">Click a zone to list the throws behind it.</div>`;
  const plays = [...(zones[zone]?.plays || [])].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const rows = plays.map((p) => `<tr class="res-${p.result === "Comp" ? "catch" : p.result === "Inc" ? "incomplete" : esc(p.result.toLowerCase())}"><td>${esc(weekLabel(p.key, st.season))}</td><td>${esc(p.opp || "")}</td>`
    + `<td>${p.down ? `${ord(p.down)} &amp; ${p.togo ?? ""}` : ""}${isNum(p.yl) ? ` <small>${p.yl <= 50 ? "opp" : "own"} ${p.yl <= 50 ? p.yl : 100 - p.yl}</small>` : ""}</td>`
    + `<td>${esc(p.result)}</td><td class="an-qbp-tgt">${p.target ? esc(displayName(p.target, players)) : ""}</td><td class="num">${isNum(p.air) ? p.air : ""}</td><td class="num">${p.yards}</td><td class="num">${signed(p.epa, 2)}</td></tr>`).join("");
  return `<div class="an-pl-plhead"><b>${esc(qbZoneName(zone))}</b> <span>${plays.length} attempt${plays.length === 1 ? "" : "s"}</span><button type="button" data-close title="Close">×</button></div>
    <div class="an-pl-pltable"><table><thead><tr><th>Wk</th><th>Opp</th><th>Down</th><th>Result</th><th>Target</th><th class="num">Air</th><th class="num">Yds</th><th class="num">EPA</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
