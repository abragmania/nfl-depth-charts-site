// Teams: the club picker (#/teams, 32 team pills by division) and the team page (#/team/:abbr, the OFFENSE; the
// defense lives on the Defense leaderboard's expanded row in v1, D179). Tiles carry the league reference among the
// clubs and are tier-coloured among them (D177 perspective); the week-by-week bars carry the window's figure and the
// league line (D181 totals); the pass zone field compares each cell with every attempt in the league; the target and
// carry distributions list the club's pass catchers and ball carriers, each a way into his player page (D177
// interactivity). Every figure comes from agg_team.js (pure); this file draws and wires clicks.
import { backLink } from "../router.js";
import { fromQuery, toQuery, seasonsOf, weekLabel } from "../filters.js";
import { loadFor, loadTeams, loadStatusFeed, loadClubCards, displayName } from "../data.js";
import { aggregateTeams, teamReference, teamTier, teamRank, teamZones, teamTargets, teamCarries, OFF_TIER, DEF_TIER, SOFT_KEYS, RANK_LOW_FIRST } from "../agg_team.js";
import { gridRows, GRID_CATEGORIES, displayed } from "../agg_grid.js";
import { absences, isMissing } from "../agg_absence.js";
import { renderFilterBar } from "../filterbar.js";
import { esc, NA, isNum, pct, fix, signed, int, teamPill, qbStrips, qbZoneField, qbZoneName, QB_ZONE_MODES, pfrNote, seasonLabel } from "./qb.js";
import { windowName } from "./qbplayer.js";
import { lostCardHtml } from "./lost.js";
import { lineBlock } from "./kit.js";
import { RZ_I5_FLOOR } from "../agg_player.js";
import { depthBarHtml } from "../table.js";

const P = (v, d = 1) => (isNum(v) ? pct(v, d) + "%" : NA);
// A missing figure on a kit.js lineBlock tile. lineBlock escapes every value, so the NA placeholder (HTML markup, for
// the raw-HTML tiles and rows) would print as text there; these tiles take a plain dash instead.
const DASH = "–";
const BAND = (pos) => (pos === "RB" || pos === "FB" ? "BACKFIELD" : pos);
export const TEAM_ZONE_MODES = QB_ZONE_MODES.filter((m) => ["att", "cmpPct", "ydsAtt", "epaAtt"].includes(m.k));
const ord = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n === 4 ? "4th" : "");

// The page ignores the position chips, team and opponent (one club; its reference is every club in the window).
export const teamPageState = (st) => ({ ...st, team: "", opp: "", ha: "", downs: [], qtrs: [], pos: {} });

// D198: the header's Offense | Defense segment, shared by team.js's offense sub-page and team_def.js's defense
// sub-page (replaces the old plain "Offense" side label and the "Defense →" link, which pointed at the Defense
// leaderboard's expanded row before a club had its own defense page). `active` is "off" or "def"; qs carries the
// page's filters.
export function teamSideSeg(abbr, qs, active) {
  const A = encodeURIComponent(abbr), q = qs ? "?" + qs : "";
  const off = active === "off";
  return `<div class="an-tm-seg" role="tablist">` +
    `<a class="an-tm-segbtn${off ? " on" : ""}" href="#/team/${A}${q}" aria-current="${off}">Offense</a>` +
    `<a class="an-tm-segbtn${off ? "" : " on"}" href="#/team/${A}/defense${q}" aria-current="${!off}">Defense</a>` +
    `</div>`;
}

// D198: the O-line block's proxy note (mirrors views/grid.js's PROXY_TEXT wording verbatim; not imported, since
// grid.js already imports from this file and importing it back here would risk a module cycle).
const OLINE_PASS_PROXY = "Pressure %, hit % and hurry % allowed: proxy for the line — the quarterback, backs and tight ends share the blame.";
const OLINE_RUN_PROXY = "Stuffed % and yards before contact: proxy for the line — the back's vision is in it.";

// D206: every figure tile links to the Rankings table sorted by its own column, the club highlighted - but only when
// the key actually has a column there. These mirror views/offense.js's OFF_COLS and views/defense.js's DEF_COLS key
// lists (read-only) rather than importing them: both those files already import from this one (teamPageState and
// friends), so importing them back here would risk a module cycle - the same reason OLINE_PASS_PROXY/OLINE_RUN_PROXY
// above are copied rather than imported from views/grid.js. Keep these two sets in step with OFF_COLS/DEF_COLS by hand.
export const RANKINGS_OFF_KEYS = new Set(["epaPlay", "succPct", "explPct", "playsG", "passRate", "epaDb", "cmpPct", "adot", "sackPct", "pressPct", "paPct", "proe", "proeNeutral", "epaCar", "ypc", "rushYdsG", "stuffPct", "ybcCar", "ptsDrive", "rzTdPct", "thirdPct", "neutralSecs", "noHuddlePct", "shotgunPct", "motionPct"]);
export const RANKINGS_DEF_KEYS = new Set(["epaPlay", "succPct", "explPct", "playsG", "epaDb", "cmpPct", "adot", "sackPct", "pressPct", "pressuresG", "blitzPct", "epaCar", "ypc"]);
// The direction that puts the best club first for a key (OFF_TIER/DEF_TIER's -1 = lower is better = ascending;
// everything else, including a neutral key, descending) - the offense/defense tables' own bestDir rule.
// An untiered key in RANK_LOW_FIRST (seconds per play: the fastest first) is ascending too.
const rankingsBestDir = (side, k) => {
  const d = (side === "def" ? DEF_TIER : OFF_TIER)[k];
  return d === -1 || (!d && RANK_LOW_FIRST.has(k)) ? "asc" : "desc";
};
// The href for one tile's figure: side ("off"/"def"), the key, the club's abbreviation, and the page's current
// filter query (carried the way every other link on this page already carries it).
export function rankingsHref(side, k, abbr, qs) {
  return `#/rankings?side=${side}&sort=${encodeURIComponent(k)}&dir=${rankingsBestDir(side, k)}&hl=${encodeURIComponent(abbr)}${qs ? "&" + qs : ""}`;
}

// D206 fix round (👁: 12 tiles linked nowhere because their key has no Rankings column - O-line pressure/hit/hurry %
// allowed; D-line hit %, hurry %, stuffed % forced, run-stop %, YBC/carry allowed; the four coverage tiles). A
// Rankings link stays a Rankings link; a tile whose key has no Rankings column instead links to the Grid page,
// sorted by that key's own category column, best first (every Grid column's rating already bakes in its direction,
// so "desc" is always best-first there - see views/grid.js's own click handler), carrying the same filter query.
export function gridTileHref(col, qs) {
  return `#/grid?sort=${encodeURIComponent(col)}&dir=desc${qs ? "&" + qs : ""}`;
}

// D205: the club page's own Grid row - the same 0-100 ratings, figures and ranks agg_grid.js's gridRows() computes
// for the Grid page, for the side being shown, in the Grid's own cell markup (views/grid.js's .gc). gridStop/tileAmt/
// figText below mirror grid.js's own formulas byte for byte rather than importing them, for the same module-cycle
// reason as OLINE_PASS_PROXY/OLINE_RUN_PROXY (kit.js's lineBlock duplicates the same two formulas for its chips).
const clubGridStop = (rating) => (Number.isFinite(rating) ? Math.min(1, Math.max(0, (rating - 20) / 60)) : null);
const clubTileAmt = (g) => 22 + 50 * Math.sqrt(Math.abs(2 * g - 1));
function clubFigText(v, f) {
  if (v === null || v === undefined || !Number.isFinite(+v)) return "–";
  let x = displayed(+v, f);
  if (Object.is(x, -0)) x = 0;
  const body = Math.abs(x).toFixed(f.digits);
  const sign = f.signed ? (x > 0 ? "+" : x < 0 ? "−" : "") : x < 0 ? "−" : "";
  return `${sign}${body}${f.pct ? "%" : ""}`;
}
// gridRow: gridRows()'s row for this club (or undefined - every cell then reads "not yet"); side: "off" or "def".
export function clubGridRowHtml(gridRow, side) {
  const cats = GRID_CATEGORIES.filter((c) => c[side]);
  const cells = cats.map((c) => {
    const figs = c[side];
    const lead = figs.find((f) => f.lead) || figs[0];
    const label = side === "off" ? (c.offLabel || c.label) : (c.defLabel || c.label);
    const cell = gridRow?.cells?.[c.key]?.[side] || null;
    const body = !cell || cell.value === null || cell.value === undefined
      ? `<div class="gc gc-null"><b>not yet</b></div>`
      : `<div class="gc" style="--g:${clubGridStop(cell.rating).toFixed(3)};--amt:${clubTileAmt(clubGridStop(cell.rating)).toFixed(1)}%"><b>${cell.rating}</b><span>${esc(clubFigText(cell.value, lead))} · ${esc(ordinal(cell.rank))}</span></div>`;
    return `<div class="an-tm-gc" title="${esc(`${label}: ${c.note}`)}"><span class="an-tm-gc-label">${esc(label)}</span>${body}</div>`;
  }).join("");
  return `<div class="an-card an-line an-tm-gridrow"><div class="an-dh">Grid <span class="an-dsub">the same 0-100 ratings the Team grid shows for this club</span></div><div class="an-tm-gridcells">${cells}</div></div>`;
}

// D219 figure 1: the club page's "Play calling" block (kit.js lineBlock, no headline chips): pass rate over
// expectation overall and in four situations, and the neutral-script pass rate. Style, not quality, so every tile is
// uncoloured (none of these keys is in OFF_TIER); each carries the league mean and the club's rank (1st = the most
// pass-happy). PURE: O = the club's side row, L = the league means for that side, rows = every club's rows (for the
// rank), side "off" (the defense page may later pass "def": the same figures, what the defense faced).
const PROE_TILES = [
  ["PROE", "proe", "on every play"],
  ["PROE early downs", "proeEarly", "on 1st and 2nd down"],
  ["Neutral PROE", "proeNeutral", "in neutral script (score within 7, quarters 1-3)"],
  ["PROE red zone", "proeRz", "in the red zone (the opponent's 20 or closer)"],
  ["PROE inside 5", "proeI5", "inside the opponent's 5"],
];
// foot: false leaves the explanatory paragraph out (the This-week page, D224 C; the club page keeps it).
export function playCallingHtml({ O = {}, L = {}, rows = [], abbr = "", qs = "", side = "off", foot = true } = {}) {
  const pts = (v) => (isNum(v) ? `${signed(v, 1)} pts` : null);
  const rankOf = (k) => (isNum(O[k]) ? teamRank(rows, side, k, abbr) : null);
  const href = (k) => (side === "off" && RANKINGS_OFF_KEYS.has(k) ? rankingsHref("off", k, abbr, qs) : null);
  const plays = (n) => `${n ?? 0} play${n === 1 ? "" : "s"}`;
  const tiles = PROE_TILES.map(([label, k, where]) => {
    const rk = rankOf(k), n = O[k + "N"] ?? 0;
    return { label, value: pts(O[k]) ?? DASH, lg: pts(L[k]), rank: rk ? ordinal(rk.rank) : null, rankOf: rk ? String(rk.of) : null,
      sub: plays(n), href: href(k),
      title: `Pass rate over expectation ${where}: the dropback rate minus the expected pass rate (nflverse xpass) on the same plays, in percentage points, over ${plays(n)} with an expectation. Style, not quality: not coloured. 1st = most pass-happy over expectation.` };
  });
  const nrk = rankOf("neutralPassRate");
  tiles.push({ label: "Neutral pass rate", value: isNum(O.neutralPassRate) ? P(O.neutralPassRate) : DASH, lg: isNum(L.neutralPassRate) ? P(L.neutralPassRate) : null,
    rank: nrk ? ordinal(nrk.rank) : null, rankOf: nrk ? String(nrk.of) : null, sub: plays(O.neutralPlays), href: href("neutralPassRate"),
    title: `Dropbacks / plays in neutral script (score within 7, quarters 1-3), over ${plays(O.neutralPlays)}. Style, not quality: not coloured. 1st = passes most.` });
  tiles.push(...paceShapeTiles({ O, L, rankOf, href, plays, side }));
  // an-pc: analytics.css sets the twelve tiles as two even rows of six (pass rate, then pace and shape) on a desktop
  // window instead of letting them wrap ten and two.
  return lineBlock({
    title: "Play calling",
    tiles,
    foot: !foot ? "" : esc("Expected pass rate: nflverse xpass, the play-by-play model's chance an average offense drops back given the down, distance, field position, score and clock. A dropback is a pass attempt, sack or scramble. Penalty no-plays are not in the rows and the model is a fixed baseline, so the average club sits at the league figure shown, not at zero. Pass rate over expectation is style, not quality, so it is not coloured. Pace and shape (seconds per play, no-huddle, shotgun with pistol counted in, motion from FTN charting, personnel from nflverse) are style too, not coloured."),
  }).replace('<div class="an-card an-line">', '<div class="an-card an-line an-pc">');
}

// D219 figures 2 and 3: the Play calling block's pace and shape tiles, after the PROE tiles. Style, not quality: none
// is coloured; rank 1st = the most (for seconds per play, the fastest: RANK_LOW_FIRST). A window with no such column
// (a season compiled before D219) reads "–"; the personnel tile reads "–" with "published after the season" when the
// window's rows are D219 rows (they carry the shotgun flag) but no personnel, which nflverse publishes after a season.
function paceShapeTiles({ O, L, rankOf, href, plays, side }) {
  const faced = side === "def" ? " faced" : "";
  const f1 = (v) => (+v).toFixed(1), pc = (v) => `${(v * 100).toFixed(1)}%`, sec = (v) => `${(+v).toFixed(1)} s`;
  const NONE = "not in this window's files";
  const of = (x, n, what) => (n > 0 ? `${x ?? 0} of ${n} ${what}` : NONE);
  const tile = (label, k, fmt, sub, title) => {
    const rk = rankOf(k);
    return { label, value: isNum(O[k]) ? fmt(O[k]) : DASH, lg: isNum(L[k]) ? fmt(L[k]) : null,
      rank: rk ? ordinal(rk.rank) : null, rankOf: rk ? String(rk.of) : null, sub, href: href(k), title };
  };
  const persSub = O.persN > 0 ? of(O.pers11, O.persN, "plays") : O.shotgunN > 0 ? "published after the season" : NONE;
  return [
    tile("Neutral sec/play", "neutralSecs", sec, O.neutralSecsN > 0 ? plays(O.neutralSecsN) : NONE,
      `Seconds per play${faced} in neutral script (score within 7, quarters 1-3): the mean time from a snap to the offense's next snap in the same drive, over ${plays(O.neutralSecsN)} with a next snap (a drive's last snap and a snap before a quarter break have none). Pace, not quality: not coloured. Ranked fastest first: 1st = the fewest seconds.`),
    tile("Neutral plays/g", "neutralPlaysG", f1, isNum(O.neutralPlaysG) ? `${plays(O.neutralPlays)} in ${O.g ?? 0} game${O.g === 1 ? "" : "s"}` : NONE,
      `Neutral-script plays per game${faced} (score within 7, quarters 1-3): pass attempts, sacks, scrambles and designed runs. Volume, not quality: not coloured. 1st = the most.`),
    tile("No-huddle %", "noHuddlePct", pc, of(O.noHuddle, O.noHuddleN, "plays"),
      `No-huddle plays${faced} / plays, the play-by-play's no-huddle flag (FTN's charting agrees on every play so far). Style, not quality: not coloured. 1st = the most.`),
    tile("Shotgun %", "shotgunPct", pc, of(O.shotgun, O.shotgunN, "plays"),
      `Shotgun plays${faced} / plays, the play-by-play's shotgun flag with pistol counted as shotgun. FTN's charting disagrees on a small share of plays; the audit logs them. Style, not quality: not coloured. 1st = the most.`),
    tile("Motion %", "motionPct", pc, of(O.motion, O.motionN, "charted"),
      `Plays${faced} with pre-snap motion / plays FTN charted (every play type). Style, not quality: not coloured. 1st = the most.`),
    tile("11 personnel %", "pers11Pct", pc, persSub,
      `Plays${faced} with one back, one tight end and three receivers (11 personnel) / plays with a personnel value, nflverse's offense personnel. nflverse publishes personnel after the season, so the current season reads a dash. Style, not quality: not coloured. 1st = the most.`),
  ];
}

// D219 figure 7: the club page's "Drives" block (kit.js lineBlock, no headline chips), right after Play calling.
// Points per drive, red-zone TD % and 3rd-down % are tiered (OFF_TIER/DEF_TIER: higher is better on offense, lower
// on defense); drives per game and red-zone trips per game are volume, uncoloured. Each tile carries the league
// mean, the club's rank and its denominator. A window whose week files carry no drives block (a season compiled
// before D219) reads "–" with a sub line saying so, never NaN. PURE, the playCallingHtml signature; side "def" gives
// what the defense faced (built, not drawn yet). Values are plain text: kit.js escapes them, so never the NA markup.
export function drivesHtml({ O = {}, L = {}, rows = [], abbr = "", qs = "", side = "off", cuts = null } = {}) {
  const rankOf = (k) => (isNum(O[k]) ? teamRank(rows, side, k, abbr) : null);
  const href = (k) => (side === "off" && RANKINGS_OFF_KEYS.has(k) ? rankingsHref("off", k, abbr, qs) : null);
  const n =(x, one, many) => `${x ?? 0} ${x === 1 ? one : many}`;
  const noDrives = !(O.driveG > 0), noThird = !(O.third > 0);
  const faced = side === "def" ? " faced" : "";
  const tile = (label, k, fmt, sub, title) => {
    const rk = rankOf(k);
    return { label, value: isNum(O[k]) ? fmt(O[k]) : DASH, lg: isNum(L[k]) ? fmt(L[k]) : null,
      rank: rk ? ordinal(rk.rank) : null, rankOf: rk ? String(rk.of) : null, sub, href: href(k),
      tier: teamTier(side, k, O[k], cuts), title };
  };
  const f2 = (v) => (+v).toFixed(2), f1 = (v) => (+v).toFixed(1), pc = (v) => `${(v * 100).toFixed(1)}%`;
  const NO_DRIVES = "no drive data in this window's files", NO_THIRD = "no third-down data in this window's files";
  const dSub = (s) => (noDrives ? NO_DRIVES : s);
  const tiles = [
    tile("Points/drive", "ptsDrive", f2, dSub(n(O.drives, "drive", "drives")),
      `Points per drive${faced}: the points the offense actually scored on its own snaps (a touchdown 6 plus the try, a field goal 3, a defensive score against it 0) / its drives, over ${n(O.drives, "drive", "drives")}. Kneel-only drives are left out.`),
    tile("Drives/g", "drivesG", f1, dSub(`${n(O.drives, "drive", "drives")} in ${n(O.driveG, "game", "games")}`),
      `Drives per game${faced}: offensive drives / games, kneel-only drives left out. Volume, not quality: not coloured. 1st = the most drives.`),
    tile("Red-zone trips/g", "rzTripsG", f1, dSub(n(O.rzTrips, "trip", "trips")),
      `Red-zone trips per game${faced}: drives that ran a play from the opponent's 20 or closer / games. Volume, not quality: not coloured. 1st = the most trips.`),
    tile("Red-zone TD %", "rzTdPct", pc, dSub(`${O.rzTd ?? 0} TD of ${n(O.rzTrips, "trip", "trips")}`),
      `Red-zone touchdown rate${faced}: red-zone drives that ended in a touchdown / red-zone drives (a field goal is a trip, not a touchdown), over ${n(O.rzTrips, "trip", "trips")}.`),
    tile("3rd-down %", "thirdPct", pc, noThird ? NO_THIRD : `${O.thirdConv ?? 0} of ${n(O.third, "3rd down", "3rd downs")}`,
      `Third-down conversion${faced}: third-down plays that gained a first down or scored / third-down plays, over ${n(O.third, "play", "plays")}. Defensive pass-interference plays are left out on both sides; a first down a foul gave the offense counts.`),
  ];
  return lineBlock({
    title: "Drives",
    tiles,
    foot: esc("Drives and their points: nflverse play-by-play drives, the points the offense actually scored on its own snaps (defensive and return scores are not drive points). A red-zone trip is a drive that ran a play from the opponent's 20 or closer. 3rd-down % reads a little under NFL.com's because penalty no-plays are not in the rows; a first down a foul gave the offense on a real play counts as a conversion."),
  });
}

// D198: the club offense page's O-line block (kit.js lineBlock): the grid's pass-protection and run-blocking chips over
// six tier tiles. PURE, pulled out of renderTeam (D224 increment C) so the This-week page (views/week.js) draws the
// same block from the same figures: O/L = the club's and the league's off-side figures, rows = every club's window rows
// (the rank), cuts = teamReference().cuts, gridRow = agg_grid.js gridRows()'s row for the club, pnote = the PFR-lag
// caption (or ""), qs = the page's filter query for the tile links. strip (D224 increment G): olineStripHtml's per-game
// strips, drawn under the tiles; without one the block is exactly as it was.
export function olineBlockHtml({ O = {}, L = {}, rows = [], abbr = "", qs = "", cuts = null, gridRow = null, pnote = "", strip = "" } = {}) {
  const passProCell = gridRow?.cells?.passPro?.off || null;
  const runBlockCell = gridRow?.cells?.runBlock?.off || null;
  // D206 fix round: pressure/hit/hurry % allowed have no Offense table column (they are O-line-only figures), so
  // they link to the Grid's own Pass protection column instead - never a dead end.
  const OL_GRID_LINK = { pressPctAllowed: "passProOff", hitPctAllowed: "passProOff", hurryPctAllowed: "passProOff" };
  const olTile = (label, k, sub, digits = null) => {
    const v = O[k], lgv = L[k];
    const tr = teamTier("off", k, v, cuts);
    const rk = isNum(v) ? teamRank(rows, "off", k, abbr) : null;
    const fmt = (x) => (digits === null ? P(x) : fix(x, digits));
    // lineBlock's own tileData() normalizes this - no need to call it here too. D199 review: match the headline
    // chips' "12th of 32" wording (no "clubs") rather than the tile's own "22nd of 32 clubs".
    // D206: linked to Rankings when the key has a column there, else to the Grid's own category column - never a
    // dead end (kit.js's lineBlock wraps a tile in <a> when href is set).
    return { label, value: isNum(v) ? fmt(v) : DASH, lg: isNum(lgv) ? fmt(lgv) : null,
      rank: rk ? ordinal(rk.rank) : null, rankOf: rk ? String(rk.of) : null, sub, tier: tr,
      href: RANKINGS_OFF_KEYS.has(k) ? rankingsHref("off", k, abbr, qs) : OL_GRID_LINK[k] ? gridTileHref(OL_GRID_LINK[k], qs) : null };
  };
  return lineBlock({
    title: "O-line",
    headline: [
      { label: "Pass protection", rating: passProCell?.rating ?? null, rank: isNum(passProCell?.rank) ? ordinal(passProCell.rank) : null, of: passProCell ? String(passProCell.n) : null, title: "Ranks on pressure % allowed (PFR); the grid's own rating (50 = league average)" },
      { label: "Run blocking", rating: runBlockCell?.rating ?? null, rank: isNum(runBlockCell?.rank) ? ordinal(runBlockCell.rank) : null, of: runBlockCell ? String(runBlockCell.n) : null, title: "Ranks on yards before contact per carry (PFR); the grid's own rating (50 = league average)" },
    ],
    tiles: [
      olTile("Pressure % allowed", "pressPctAllowed", `${O.pfrPress ?? 0} pressures`),
      olTile("Hit % allowed", "hitPctAllowed", `${O.pfrHits ?? 0} hits`),
      olTile("Hurry % allowed", "hurryPctAllowed", `${O.pfrHurries ?? 0} hurries`),
      olTile("Sack % allowed", "sackPct", `${O.sacks ?? 0} sacks`),
      olTile("Stuffed %", "stuffPct", `${O.stuffed ?? 0} stuffed`),
      olTile("YBC/carry", "ybcCar", `${O.ybcCarries ?? 0} carries`, 2),
    ],
    foot: esc([OLINE_PASS_PROXY, OLINE_RUN_PROXY, pnote].filter(Boolean).join(" ")),
    strip,
  });
}

// ---- D224 increment G: the line blocks' per-game strips -------------------------------------------------------
// Adam: how a line run- and pass-blocks and how a defence stops the run and the pass "overall, and game to game if
// you want to click down into the details". The Week by week renderer (qb.js qbStrips), small: one bar per game over
// `series` (agg_team.js aggregateTeams' series.off/def rows, each week's figures on the tile's own rows and rule; the
// club pages pass their whole loaded timeline with inWin marking the window's weeks, as Week by week does), the window
// figure on the left and the league line. hit: each game is a .an-wb-hit[data-key], the club pages' own Week by week
// handler (isolate that game; click it again for the whole window); href (the This-week page): the club page the
// click opens with that game isolated (views/week.js wires it). A strip spec with pfrKey reads PFR: a played week
// whose series row has that flag false draws no bar and the strip says so once: after pfrThrough (the latest week with
// any PFR row, aggregateTeams' own) PFR has not charted the week yet; at or before it PFR placed no row for this club
// that week (a players-file gap, the week otherwise charted). PURE.
export function lineStripHtml(series, strips, { season, activeKey = null, hit = true, href = "", pfrThrough = null } = {}) {
  if (!series?.length || !strips?.length) return "";
  const n = series.length;
  const bw = n <= 8 ? 30 : n <= 14 ? 22 : n <= 20 ? 16 : 9, gap = n <= 8 ? 9 : n <= 14 ? 7 : n <= 20 ? 5 : 3;
  let svg = qbStrips(series, strips, { season, activeKey, hit, bw, gap, sh: 46, lw: 124, rw: 76 });
  const gapOf = (s) => !s.bye && strips.some((sp) => sp.pfrKey && s[sp.pfrKey] === false);
  const charted = (s) => !!pfrThrough && s.key <= pfrThrough; // PFR has published this week for some club
  // qbStrips' hover says "did not play" for a week with no figure; a played week without a PFR row says why instead,
  // and on the This-week page (href) the click line says where the click goes (its one <title> per game, in order).
  let i = 0;
  svg = svg.replace(/<title>([^<]*)<\/title>/g, (m, t) => {
    const s = series[i++];
    if (!s) return m;
    if (!s.bye) for (const sp of strips) if (sp.pfrKey && s[sp.pfrKey] === false) t = t.replace(`${esc(sp.label)}: did not play`, `${esc(sp.label)}: ${charted(s) ? "no PFR row placed for this club" : "no PFR charting yet"}`);
    if (href) t = t.replace("Click to show this week only", "Click to open the club page with this game alone");
    return `<title>${t}</title>`;
  });
  const gaps = series.filter(gapOf), what = strips.filter((sp) => sp.pfrKey).map((sp) => sp.label).join(" or ");
  const late = gaps.filter((s) => !charted(s)).map((s) => weekLabel(s.key, season)), unplaced = gaps.filter(charted).map((s) => weekLabel(s.key, season));
  const note = [late.length ? `No PFR charting yet for ${late.join(", ")} (PFR runs about a week behind), so no ${what} bar there.` : "",
    unplaced.length ? `No PFR row placed for this club in ${unplaced.join(", ")}, so no ${what} bar there.` : ""].filter(Boolean).join(" ");
  const how = href ? "click a game to open the club page with that game alone" : "click a game to show it alone; click it again for the whole window";
  return `<div class="an-line-strip"${href ? ` data-href="${esc(href)}"` : ""}><div class="an-line-strip-h">By game <span>${esc(how)}</span></div>`
    + `<div class="an-line-strip-svg">${svg}</div>${note ? `<div class="an-line-strip-note">${esc(note)}</div>` : ""}</div>`;
}
// One strip spec for lineStripHtml: k = the series key, tk = the tile's key (its window total, league line and tier),
// side "off"/"def"; rate = a 0-1 share printed as a percent, else a plain figure with `digits`; hover = words added to
// each game's hover figure.
export function lineStripSpec({ k, tk, label, side, T = {}, L = {}, cuts = null, wn = "", series = [], rate = true, digits = 1, floor = 0, pfrKey = null, hover = "" }) {
  const show = (v) => (rate ? `${(v * 100).toFixed(1)}%` : (+v).toFixed(digits));
  const fmt = (v) => show(v) + (hover ? ` (${hover})` : "");
  const vals = series.filter((s) => s.inWin !== false).map((s) => s[k]).filter(isNum);
  const span = Math.max(floor, ...vals, isNum(L[tk]) ? L[tk] : 0) * 1.15 || 1;
  return { k, label, signed: false, span, fmt, short: (v) => (rate ? String(Math.round(v * 100)) : String(Math.round(v))),
    total: T[tk], totalText: `${wn} ${isNum(T[tk]) ? show(T[tk]) : DASH}`, avg: L[tk], avgText: `lg ${isNum(L[tk]) ? show(L[tk]) : DASH}`,
    tier: (v) => teamTier(side, tk, v, cuts), pfrKey };
}
// The O-line block's strips: pressure % allowed (PFR, the club's QBs' rows) and stuffed % (play-by-play) by game.
export function olineStripHtml({ series = [], O = {}, L = {}, cuts = null, wn = "", season, activeKey = null, hit = true, href = "", pfrThrough = null } = {}) {
  const a = { side: "off", T: O, L, cuts, wn, series };
  return lineStripHtml(series, [
    lineStripSpec({ ...a, k: "prPct", tk: "pressPctAllowed", label: "Pressure % allowed", floor: 0.3, pfrKey: "pfr" }),
    lineStripSpec({ ...a, k: "stuffPct", tk: "stuffPct", label: "Stuffed %", floor: 0.15 }),
  ], { season, activeKey, hit, href, pfrThrough });
}

// qbZoneField speaks of one passer ("his", "every QB"); on a club's field the words become the club's and the league's.
export function clubZoneField(zones, mode, opts, side = "off") {
  const whose = side === "def" ? "the attempts it faced" : "the offense's";
  return qbZoneField(zones, mode, opts).replace(/of his zoned attempts/g, `of ${whose} zoned attempts`).replace(/every QB's/g, "the league's").replace(/every QB /g, "the league ");
}
export function clubZoneLegend(mode, side = "off") {
  if (mode === "att") return `<span class="an-zf-leg"><i class="heat" style="--heat:.15"></i><i class="heat" style="--heat:.5"></i><i class="heat" style="--heat:1"></i> more attempts · "lg" = share of every attempt in the league</span>`;
  // The legend sits outside the field's colour swap, so the defense's reads green (allows less) to red (allows more).
  const sw = (a, b) => `<i class="${a}" style="--d:1"></i><i class="${a}" style="--d:.4"></i><i class="few"></i><i class="${b}" style="--d:.4"></i><i class="${b}" style="--d:1"></i>`;
  return side === "def"
    ? `<span class="an-zf-leg">${sw("up", "down")} allows less → more than the league there · grey: under 3 attempts</span>`
    : `<span class="an-zf-leg">${sw("down", "up")} below → above the league there · grey: under 3 attempts</span>`;
}

// The plays behind a zone cell: week, opponent, down, passer, target (a link to his page), result, air, yards, EPA.
export function zonePlaysHtml(zones, zone, st, players, q, side = "off") {
  if (!zone) return `<div class="an-note">Click a zone to list the throws behind it.</div>`;
  const plays = [...(zones[zone]?.plays || [])].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const who = (id) => (id ? `<a href="#/player/${encodeURIComponent(id)}${q ? "?" + q : ""}">${esc(displayName(id, players))}</a>` : "");
  const rows = plays.map((p) => `<tr><td>${esc(weekLabel(p.key, st.season))}</td><td>${esc(side === "def" ? p.off : p.def)}</td>`
    + `<td>${p.down ? `${ord(p.down)} &amp; ${p.togo ?? ""}` : ""}</td><td>${who(p.passer)}</td><td>${who(p.target)}</td><td>${esc(p.result)}</td>`
    + `<td class="num">${isNum(p.air) ? p.air : ""}</td><td class="num">${p.yards}</td><td class="num">${signed(p.epa, 2)}</td></tr>`).join("");
  return `<div class="an-pl-plhead"><b>${esc(qbZoneName(zone))}</b> <span>${plays.length} attempt${plays.length === 1 ? "" : "s"}</span><button type="button" data-close title="Close">×</button></div>
    <div class="an-pl-pltable"><table><thead><tr><th>Wk</th><th>${side === "def" ? "Offense" : "Opp"}</th><th>Down</th><th>Passer</th><th>Target</th><th>Result</th><th class="num">Air</th><th class="num">Yds</th><th class="num">EPA</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Column sets for distList (D225a): tiny header + pixel width each. The club page's last column is the red-zone target
// share / inside-the-5 carry share; the defense page's lists (team_def.js) stop at the third.
export const TGT_COLS = [{ h: "Tgt", w: 30 }, { h: "Routes", w: 40 }, { h: "Snap %", w: 44 }, { h: "RZ share", w: 76 }, { h: "Depth", w: 56 }];
export const CAR_COLS = [{ h: "Car", w: 30 }, { h: "Ypc", w: 34 }, { h: "EPA", w: 44 }, { h: "Inside 5", w: 76 }];

// A horizontal distribution bar list. items: [{ gsis, name, pos, share, tier, main, cells, title }]; `max` scales the bars.
// `cols` ([{ h, w }]: a tiny header and a pixel width each) turns the detail into aligned columns right of the bar, one
// `cells` entry per column in every row, with the headers printed once above the first row (D225a).
export function distList(items, q, { max = 0.35, lg = null, lgLabel = "", cols = [] } = {}) {
  if (!items.length) return `<div class="an-note">Nobody in this window.</div>`;
  const top = Math.max(max, ...items.map((x) => x.share || 0));
  const lgMark = isNum(lg) ? `<i class="an-tm-lg" style="left:${Math.min(100, (lg / top) * 100).toFixed(1)}%" title="${esc(lgLabel)}"></i>` : "";
  const head = cols.length ? `<div class="an-tm-drow an-tm-dhead"><span></span><span></span><span></span><span></span>${cols.map((c) => `<span>${esc(c.h)}</span>`).join("")}</div>` : "";
  return `<div class="an-tm-dist"${cols.length ? ` style="--dcols:${cols.map((c) => c.w + "px").join(" ")}"` : ""}>${head}${items.map((x) => `<div class="an-tm-drow${x.tier ? " t-" + x.tier : ""}" title="${esc(x.title || "")}">`
    + `<a class="an-tm-dname" href="#/player/${encodeURIComponent(x.gsis)}${q ? "?" + q : ""}">${esc(x.name)}</a><span class="an-pospill" data-band="${BAND(x.pos)}">${esc(x.pos)}</span>`
    + `<span class="an-tm-track"><i class="an-tm-fill" style="width:${(((x.share || 0) / top) * 100).toFixed(1)}%"></i>${lgMark}</span>`
    + `<b class="an-tm-v">${x.main}</b>${(x.cells || []).map((c) => `<span class="an-tm-sub">${c}</span>`).join("")}</div>`).join("")}</div>`;
}

// "What's been lost" (D196 C, D199): the card is drawn by views/lost.js lostCardHtml; this page fetches its inputs
// (fillLost, below) and places it above the tiles.

// ---- #/teams: the picker -------------------------------------------------------------------------------------
export async function renderTeams(ctx, query) {
  const { root, isCurrent } = ctx;
  document.title = "Teams · NFL Analytics";
  let teams = [];
  try { teams = (await loadTeams()).teams || []; } catch { /* registry unreachable: the message below */ }
  if (!isCurrent()) return;
  const st = fromQuery(query), q = toQuery({ ...st, open: "" });
  const divs = new Map();
  for (const t of [...teams].sort((a, b) => String(a.division).localeCompare(String(b.division)) || a.abbr.localeCompare(b.abbr))) {
    if (!divs.has(t.division)) divs.set(t.division, []);
    divs.get(t.division).push(t);
  }
  root.innerHTML = teams.length ? `<section class="an-teams">
    <div class="an-head"><h1>Teams</h1><div class="an-sub">Pick a club for its offense page; its defense page sits beside it (Offense | Defense), and the league tables are <a href="#/rankings?side=off${q ? "&" + q : ""}">Offense rankings</a> and <a href="#/rankings?side=def${q ? "&" + q : ""}">Defense rankings</a>.</div></div>
    <div class="an-tm-grid">${[...divs].map(([d, list]) => `<div class="an-tm-div"><div class="an-dh">${esc(d)}</div>${list.map((t) =>
      `<div class="an-tm-pick">${teamPill(t.abbr, new Map([[t.abbr, t]]), q, "an-tm-pill")}<a href="#/team/${esc(t.abbr)}${q ? "?" + q : ""}">${esc(t.name)}</a></div>`).join("")}</div>`).join("")}</div>
  </section>` : `<div class="an-msg">The team list could not be loaded.</div>`;
}

// ---- #/team/:abbr: the offense ---------------------------------------------------------------------------------
const ui = { team: null, zoneMode: "att", zone: null, lost: { key: null, list: null, feed: null, cards: null } };

export async function renderTeam(ctx, params, query) {
  const { root, isCurrent } = ctx;
  const abbr = String(params.abbr || "").toUpperCase();
  const st = fromQuery(query);
  if (ui.team !== abbr) { ui.team = abbr; ui.zone = null; }
  const go = (n) => { const q = toQuery({ ...n, open: "" }); location.hash = `#/team/${encodeURIComponent(abbr)}${q ? "?" + q : ""}`; };
  if (!root.querySelector(".an-tm")) root.innerHTML = `<div class="an-msg">Loading ${esc(abbr)}…</div>`;
  let data, teams;
  try {
    [data, teams] = await Promise.all([
      loadFor(seasonsOf(st), { ...st, window: "season" }),
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
  const qs = toQuery({ ...st, open: "" });
  const t = teams.get(abbr);
  const pst = teamPageState(st);
  const win = aggregateTeams(data.blocks, data.players, pst, { playsFor: abbr });
  const full = aggregateTeams(data.blocks, data.players, { ...pst, window: "season", from: null, to: null });
  const row = win.rows.find((r) => r.team === abbr);
  if (!t && !row) {
    root.innerHTML = `<div class="an-msg"><div class="an-msg-title">No such team</div>No club "${esc(abbr)}" in these analytics files. <a href="#/teams${qs ? "?" + qs : ""}">All teams</a></div>`;
    return;
  }
  document.title = `${t?.name || abbr} · NFL Analytics`;
  const ref = teamReference(win.rows);
  const L = ref.lg.off, O = row?.off || {};
  const wn = windowName(st, win.weeks);
  const pnote = pfrNote(win.pfrThrough, win.latestKey, st.season);
  const activeKey = st.window === "range" && st.from && st.from === st.to ? st.from : null;
  // D198: the O-line block's headline chips are the grid's own passPro/runBlock ratings for this club (agg_grid.js
  // gridRows on the same window rows the tiles read, so the block always agrees with the Grid page); D205 needs the
  // same row for the club's own Grid row, above the tiles, so it is computed up here rather than just before olineHtml.
  // 🔵 fix round: `win` is built from this page's own whole-season load (below, for the week-by-week bars and zone
  // field), not the Grid page's own weeksNeeded()-gated week set (data.js loadFor(seasonsOf(st), st), what
  // views/grid.js itself calls) - with Last 3 and the Playoffs chip both on, those two week sets can differ, so
  // gridRow must come from the Grid's own load, never this page's wider one, or the two disagree. loadFor's own
  // caches (loadSeason's manifest/players, loadWeek's per-file cache) mean this costs no extra network round trip
  // when this page's own load already fetched the whole season, as it does.
  const gridLoad = await loadFor(seasonsOf(st), st);
  if (!isCurrent()) return;
  const gridRow = gridRows(aggregateTeams(gridLoad.blocks, gridLoad.players, pst)).find((r) => r.team === abbr);

  const tile = (label, val, k, lg, title = "") => {
    const tr = k ? teamTier("off", k, O[k], ref.cuts) : "";
    const soft = tr && SOFT_KEYS.includes(k) ? " t-soft" : "";
    const rk = k && isNum(O[k]) ? teamRank(win.rows, "off", k, abbr) : null;
    const tip = [title, rk ? `${ordinal(rk.rank)} of ${rk.of} clubs` : ""].filter(Boolean).join(" · ");
    const body = `<div class="an-tile${tr ? " t-" + tr : ""}${soft}"${tip ? ` title="${esc(tip)}"` : ""}><span>${label}</span><b>${val}</b>${lg && !String(lg).includes("an-na") ? `<em> · lg ${lg}</em>` : ""}</div>`;
    // D206: linked only when the key has a Rankings column.
    return RANKINGS_OFF_KEYS.has(k) ? `<a class="an-tile-link" href="${rankingsHref("off", k, abbr, qs)}">${body}</a>` : body;
  };
  const tiles = [
    tile("Plays/g", fix(O.playsG, 1), "playsG", fix(L.playsG, 1), "Plays per game: pass attempts, sacks, scrambles and designed runs (no penalties, kneels or spikes)"),
    tile("Pass rate", P(O.passRate), "passRate", P(L.passRate), "Dropbacks / plays, all situations (the neutral-script rate and pass rate over expectation are in Play calling below)"),
    tile("EPA/play", signed(O.epaPlay, 3), "epaPlay", signed(L.epaPlay, 3), "Expected points added per play"),
    tile("EPA/db", signed(O.epaDb, 3), "epaDb", signed(L.epaDb, 3), "EPA per dropback (sacks and scrambles included)"),
    tile("EPA/carry", signed(O.epaCar, 3), "epaCar", signed(L.epaCar, 3), "EPA per designed run"),
    tile("Success %", P(O.succPct, 1), "succPct", P(L.succPct, 1), "Share of plays that were successful (nflverse success)"),
    tile("aDOT", fix(O.adot, 1), "adot", fix(L.adot, 1), "Air yards per attempt"),
    tile("Comp %", P(O.cmpPct), "cmpPct", P(L.cmpPct), "Completions / attempts"),
    tile("Sack %", P(O.sackPct), "sackPct", P(L.sackPct), "Sacks allowed / dropbacks (lower is better)"),
    tile("Pressure %", P(O.pressPct), "pressPct", P(L.pressPct), `PFR: the club's QBs' pressures / their dropbacks${O.pfrWeeks ? ` over ${O.pfrWeeks} week${O.pfrWeeks === 1 ? "" : "s"}` : ""}${win.pfrThrough ? `, through ${weekLabel(win.pfrThrough, st.season)}` : ""} (lower is better)`),
    tile("PA %", P(O.paPct), "paPct", P(L.paPct), "FTN: play-action dropbacks / dropbacks charted"),
    tile("Explosive %", P(O.explPct), "explPct", P(L.explPct), "Runs of 10+ yards and completions of 20+ / plays"),
  ].join("");

  // D198: the O-line block, after the tiles and before Week by week (olineBlockHtml, shared with the This-week page).
  // Week by week over the whole loaded timeline, the window's weeks bright.
  const frow = full.rows.find((r) => r.team === abbr);
  const winKeys = new Set(win.weeks);
  const series = (frow?.series.off || []).map((s) => ({ ...s, inWin: winKeys.has(s.key), opp: s.opp || null }));
  // D224 increment G: the block's per-game strips over the same timeline, wired by the Week by week click below.
  const olineHtml = olineBlockHtml({ O, L, rows: win.rows, abbr, qs, cuts: ref.cuts, gridRow, pnote,
    strip: olineStripHtml({ series, O, L, cuts: ref.cuts, wn, season: st.season, activeKey, pfrThrough: full.pfrThrough }) });
  const maxPlays = Math.max(70, ...series.map((s) => s.plays || 0));
  const strips = [
    { k: "epaPlay", label: "EPA/play", signed: true, span: 0.4, fmt: (v) => signed(v, 3), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: O.epaPlay, totalText: `${wn} ${isNum(O.epaPlay) ? signed(O.epaPlay, 3) : "–"}`, avg: L.epaPlay, avgText: `lg ${isNum(L.epaPlay) ? signed(L.epaPlay, 3) : "–"}`, tier: (v) => teamTier("off", "epaPlay", v, ref.cuts) },
    { k: "passRate", label: "Pass rate", signed: false, span: 0.85, fmt: (v) => `${(v * 100).toFixed(1)}%`, short: (v) => String(Math.round(v * 100)), total: O.passRate, totalText: `${wn} ${isNum(O.passRate) ? (O.passRate * 100).toFixed(1) + "%" : "–"}`, avg: L.passRate, avgText: `lg ${isNum(L.passRate) ? Math.round(L.passRate * 100) + "%" : "–"}` },
    { k: "plays", label: "Plays", signed: false, span: maxPlays * 1.05, fmt: (v) => `${v} plays`, short: (v) => String(v), total: O.plays, totalText: `${wn} ${O.plays ?? 0}`, avg: L.playsG, avgText: `lg ${isNum(L.playsG) ? L.playsG.toFixed(1) : "–"}/g` },
  ];
  const weekly = series.length ? qbStrips(series, strips, { season: st.season, activeKey, hit: true, big: true, bw: 38, gap: 9, lw: 140, sh: 64 }) : `<div class="an-note">No weeks loaded.</div>`;

  const zones = teamZones(O, win.lgZones);
  const zoned = Object.values(zones).reduce((s, c) => s + c.n, 0);
  const zoneHtml = () => `<div class="an-pl-zhead"><div class="an-seg" data-zmode>${TEAM_ZONE_MODES.map((m) => `<button type="button" data-v="${m.k}" class="${ui.zoneMode === m.k ? "on" : ""}">${m.label}</button>`).join("")}</div>${clubZoneLegend(ui.zoneMode)}</div>
    <div class="an-pl-zbody">${clubZoneField(zones, ui.zoneMode, { selected: ui.zone })}<div class="an-pl-plays">${zonePlaysHtml(zones, ui.zone, st, data.players, qs)}</div></div>`;

  // Distributions.
  const tgts = teamTargets(data.blocks, data.players, pst, abbr).slice(0, 12);
  const cars = teamCarries(data.blocks, data.players, pst, abbr).slice(0, 8);
  // D219 figure 5 (columns since D225a): the last column of each row, red-zone target share (targets rows) or
  // inside-the-5 carry share (carries rows), with its own tooltip; "–" under the club's 3-play floor in his games.
  const shareFig = (tag, share, his, club, def) => {
    const t = isNum(share)
      ? `${def} = ${his} of ${club} (${(share * 100).toFixed(1)}%)`
      : `${def}: not shown, the club had ${club} such play${club === 1 ? "" : "s"} in his games (fewer than ${RZ_I5_FLOOR}); he had ${his}`;
    return `<span class="an-tm-rz" title="${esc(t)}">${isNum(share) ? `${Math.round(share * 100)}% (${his}/${club})` : "–"}</span>`;
  };
  const rzFig = (r) => shareFig("RZ", r.rzTgtShare, r.rzTgtN, r.rzAttN,
    `Red-zone target share: his targets inside the opponent's 20 / the club's pass attempts there in his games (a pass-interference target is his target, never a club attempt${pst.pi === false ? "; excluded here" : ""})`);
  const i5Fig = (r) => shareFig("I5", r.i5Share, r.i5Des, r.i5Runs,
    "Inside-the-5 carry share: his designed runs from the opponent's 5 or closer / the club's designed runs there in his games (scrambles on neither side)");
  const tgtItems = tgts.map((r) => ({ gsis: r.gsis, pos: r.pos, name: displayName(r.gsis, data.players), share: r.tgtShare, tier: r.tier,
    main: P(r.tgtShare), cells: [r.tgt, isNum(r.routes) ? Math.round(r.routes) : "–", isNum(r.snapPct) ? `${Math.round(r.snapPct * 100)}%` : "–", rzFig(r), depthBarHtml(r.depth, r.adot)],
    title: `${displayName(r.gsis, data.players)}: ${r.tgt} targets in ${r.g} game${r.g === 1 ? "" : "s"}, ${isNum(r.tgtShare) ? (r.tgtShare * 100).toFixed(1) + "%" : "–"} of the club's attempts in his games (${isNum(r.clubShare) ? Math.round(r.clubShare * 100) + "%" : "–"} of every club target in the window)${isNum(r.lgShare) ? `; ${r.pos} league average ${(r.lgShare * 100).toFixed(1)}%` : ""}${isNum(r.routes) ? `; ${Math.round(r.routes)} routes (heatradar)` : ""}${isNum(r.snapPct) ? `; ${Math.round(r.snapPct * 100)}% of snaps` : ""}` }));
  const carItems = cars.map((r) => ({ gsis: r.gsis, pos: r.pos, name: displayName(r.gsis, data.players), share: r.rushShare, tier: r.tier,
    main: P(r.rushShare), cells: [r.car, fix(r.ypc, 1), `<span class="${r.epaTier ? "t-" + r.epaTier : ""} an-tm-epa">${signed(r.epaCar, 2)}</span>`, i5Fig(r)],
    title: `${displayName(r.gsis, data.players)}: ${r.car} carries${r.scr ? ` (${r.scr} scrambles)` : ""}, ${r.yds} yards; ${isNum(r.rushShare) ? (r.rushShare * 100).toFixed(1) + "%" : "–"} of the club's designed runs in his games${isNum(r.lgShare) ? `; ${r.pos} league average ${(r.lgShare * 100).toFixed(1)}%` : ""}` }));

  const sub = `${seasonLabel(st)} · ${win.weeks.length ? (win.weeks.length === 1 ? weekLabel(win.weeks[0], st.season) : `${weekLabel(win.weeks[0], st.season)} to ${weekLabel(win.weeks[win.weeks.length - 1], st.season)}`) : "no games"}${st.window === "last3" ? " (each club's last 3 games)" : ""} · ${row?.g ?? 0} game${row?.g === 1 ? "" : "s"} · league reference: ${ref.text}${pnote ? " · " + pnote : ""}`;
  const pill = t ? teamPill(abbr, teams, qs, "an-pl-pill an-tm-headpill") : "";
  const lostKey = [abbr, st.season, st.pi, st.po].join("|");
  const lostHtml = () => (ui.lost.key === lostKey && ui.lost.feed ? lostCardHtml(ui.lost.list, { season: st.season, feedSeason: ui.lost.feed.season, abbr, q: qs, feedPlayers: ui.lost.feed.players, cards: ui.lost.cards, side: "off" }) : "");
  root.innerHTML = `<section class="an-pl an-tm">
    <div class="an-pl-head">
      ${backLink(`#/teams${qs ? "?" + qs : ""}`, "Teams")}${pill}<h1>${esc(t?.name || abbr)}</h1>${teamSideSeg(abbr, qs, "off")}
      <div class="an-pl-links"><a href="../#/team/${encodeURIComponent(abbr)}">Depth chart →</a></div>
    </div>
    <div class="an-pl-bar"><div class="an-filters"></div></div>
    <div class="an-sub an-pl-sub">${esc(sub)}</div>
    ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    ${row ? "" : `<div class="an-warn">No plays for ${esc(abbr)} in this window.</div>`}
    ${clubGridRowHtml(gridRow, "off")}
    <div data-lost>${lostHtml()}</div>
    <div class="an-pl-tiles an-tm-tiles">${tiles}</div>
    ${playCallingHtml({ O, L, rows: win.rows, abbr, qs })}
    ${drivesHtml({ O, L, rows: win.rows, abbr, qs, cuts: ref.cuts })}
    ${olineHtml}
    <div class="an-tm-row">
      <div class="an-card an-tm-weeks"><div class="an-dh">Week by week <span class="an-dsub">click a week to show it alone; click it again for the whole window</span></div><div class="an-pl-scroll">${weekly}</div></div>
      <div class="an-card an-tm-zones"><div class="an-dh">Pass attempts by zone <span class="an-dsub">${zoned} attempts with a depth and direction · each cell vs every attempt in the league</span></div><div data-zones>${zoneHtml()}</div></div>
    </div>
    <div class="an-tm-row">
      <div class="an-card an-tm-distc an-tm-distc-t"><div class="an-dh">Target Share <span class="an-dsub">his targets ÷ the club's pass attempts in his games</span></div>${distList(tgtItems, qs, { max: 0.3, cols: TGT_COLS })}</div>
      <div class="an-card an-tm-distc"><div class="an-dh">Carry Share <span class="an-dsub">his designed runs ÷ the club's in his games</span></div>${distList(carItems, qs, { max: 0.6, cols: CAR_COLS })}</div>
    </div>
    <p class="an-foot">Plays, pass rate, EPA, success, aDOT, completions, sacks, explosive plays, zones, targets and carries: nflverse play-by-play (defensive pass interference no-plays are left out of every team figure). Play action: FTN charting. Pressure %: PFR advanced stats, the club's quarterbacks' rows (a week behind). Routes: heatradar.app (charted). Snaps: nflverse snap counts. League reference: the plain mean over every club in the window; colours are the clubs' tiers.</p>
  </section>`;

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
  if (ui.lost.key !== lostKey) fillLost(root.querySelector("[data-lost]"), abbr, st, lostKey, isCurrent, lostHtml);
}

// The card needs the injury feed and BOTH seasons' blocks whatever the Include-previous switch says (a man out since
// week 1 has his BEFORE window last season). The feed is fetched once per page load and the week files are cached.
// This runs after the page is drawn; the absences LIST (and the feed) is remembered per club, season and the PI and
// playoff switches, and every later render rebuilds the card's markup from it with that render's query, so a window
// or week change never blanks the card. A failed feed (season null) is not remembered, so the next render asks again.
async function fillLost(box, abbr, st, key, isCurrent, draw) {
  if (!box) return;
  try {
    const feed = await loadStatusFeed();
    if (!isCurrent() || feed.season == null) return;
    let list = [], cards = null;
    if (+feed.season === +st.season && Object.values(feed.players || {}).some((e) => e?.team === abbr && isMissing(e))) {
      // The club's depth-chart cards (slot, Madden overall and rank) for the names list; {} when unreachable.
      const [d, c] = await Promise.all([loadFor([+feed.season, +feed.season - 1], { window: "season" }), loadClubCards(abbr)]);
      if (!isCurrent()) return;
      list = absences(d.blocks, d.players, { season: +feed.season, pi: st.pi, po: st.po }, abbr, feed.players);
      cards = c;
    }
    ui.lost = { key, list, feed, cards };
    if (box.isConnected) box.innerHTML = draw();
  } catch (e) {
    console.warn("What's been lost: the card could not be built", e);
  }
}

export const ordinal = (n) => { const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"; return `${n}${s}`; };
