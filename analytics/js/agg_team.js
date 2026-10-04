// PURE (no DOM, no fetch): team figures for the team page (#/team/:abbr, the offense) and the defense leaderboard
// (#/defense; D179: defense is team-only in v1). One pass over the play rows builds every club's OFFENSE (its own
// plays, keyed by posteam) and DEFENSE (the plays it faced, keyed by defteam), so a defense's "allowed" figure is
// exactly its opponents' offensive figure on those plays. Every figure has one source (D178):
//   play-by-play (nflverse): plays, dropbacks, pass rate, EPA, success, aDOT, completions, sacks, explosive plays, zones;
//   FTN charting (on the play rows): play action (offense), blitz (defense: 1+ blitzers);
//   PFR advanced stats (about a week behind the games): pressure %.
//
// Definitions (a club's "games" are its club-games in the window; the week window is judged per club, so "last 3"
// is each club's own last three games, on offense and on defense):
//   play         = a pass attempt, a sack, a scramble or a designed run. A defensive-pass-interference no-play the
//                  ledger kept (pi=1) is a receiver's target only and is in no team figure (as on the QB views).
//   dropback     = a pass attempt, a sack or a scramble. Pass rate = dropbacks / plays, all situations (the
//                  neutral-script rate is neutralPassRate below).
//   EPA/play, Success %  = over plays carrying the figure; EPA/dropback over dropbacks; EPA/carry over designed runs.
//   YPC (defense, D192)  = rushing yards allowed / designed runs faced (a scramble is not a designed run; summed
//                  over the window, not a mean of per-game averages). Lower is better.
//   Run succ %, Run expl % (defense, D192) = success % and explosive-run % (10+ yards) over designed runs faced
//                  only (a scramble is not a designed run), same accounting as the whole-play versions above.
//                  Lower is better for both (fewer successful/explosive runs allowed).
//   aDOT         = air yards / attempts with air yards. Comp % = completions / attempts. Sack % = sacks / dropbacks.
//   Explosive %  = plays gaining 10+ yards on the ground (designed runs and scrambles) or 20+ on a completed pass,
//                  over plays.
//   PA %         = FTN: play-action dropbacks / dropbacks FTN charted. Blitz % = FTN: dropbacks faced with 1+
//                  blitzers / dropbacks faced FTN charted.
//   Pressure % (offense, allowed) = the club's QBs' PFR pressures / the club's play-by-play dropbacks, both over the
//                  weeks PFR lists any of its QBs (pfr.pass is keyed by QB; his club that week comes from the players
//                  file). D231: never PFR's derived dropbacks, which are null for a passer never pressured. pfrDb is
//                  that play-by-play denominator.
//   Pressure % (defense) = the QB SIDE: the opposing QBs' PFR pressures / the dropbacks this defense faced
//                  (play-by-play) in the weeks PFR lists its opponent's QBs, one pressure per dropback at most.
//   Pressures/g (defense) = the club's defenders' PFR pressures summed (pfr.def is keyed by defender gsis; his club
//                  that week comes from players.json teams[week]) / the club's games in the window. A throw two men
//                  pressured counts twice here, by design: it is a volume figure, not a rate, so it never conflicts
//                  with Pressure % above (Adam's pairing, 2026-09-24, resolving D178: two figures, no double-count
//                  tooltip). A defender the players file cannot place is in `unmapped`.
// Team grid additions (D195; additive, no existing figure changes):
//   Rush yds/g   = rushing yards on designed runs / the club's games (offense gained, defense allowed).
//   Stuffed %    = designed runs gaining 0 or less / designed runs (offense suffered, defense forced).
//   Pressure % allowed / Hits % (PFR) = the club's QBs' PFR pressures (hits) / the Pressure % denominator on offense; on
//                  defense the opposing QBs' rows (the Press % rule), so pressPctAllowed always equals pressPct. Sack %
//                  stays the play-by-play sackPct above (D178: one source per figure).
//   Coverage (defense, PFR charting) = the club's CB and safety rows (COVER_POS by players.json position) summed:
//                  covTgt, covCmp, covYds, covTd, covInt; covYdsTgt = covYds / covTgt; covCmpPct = covCmp / covTgt;
//                  covRating = the NFL passer
//                  rating on those sums with covTgt as attempts (null with no targets).
//   YBC/carry (PFR advanced rushing) = Σ yards before contact / Σ PFR carries over the club's rushers' rows (offense)
//                  or its opponents' rushers' rows (defense), quarterbacks left out (PFR's carries include their
//                  scrambles and kneels, which are not designed runs); null while the week files' rush block is empty.
// Line-block additions (D198; additive, no existing figure changes). PFR's pressures = hurries + hits + sacked.
//   Hurry % allowed (hurryPctAllowed, both sides; pfrHurries the count) = PFR hurries on the same QB rows as
//                  Pressure % (offense: its own QBs; defense: the opposing QBs) / the Pressure % denominator (D231).
//   Hurries/g, Hits/g (defense) = the club's defenders' PFR hurries (hits) summed / games, the Pressures/g rule
//                  (a week counts only when the defense faced a dropback that week); counts in pfrHurriesDef, pfrHitsDef.
//   Sacks/g (sacksG, both sides) = play-by-play sacks / games (D178: never PFR's sack columns).
//   Run stop % (runStopPct, defense) = 1 − Run succ %: designed runs faced that were unsuccessful / designed runs faced
//                  carrying a success value; null when Run succ % is null.
//   defTargets / defCarries: the men a defense faced (teamTargets / teamCarries with opp = the defense), see below.
// Play calling (D219 figure 1; additive, no existing figure changes). xpass = nflverse's expected pass rate for the
// play (0 to 1), sd = the score differential from the offense's side, both on the play rows since increment A.
//   PROE (proe)  = dropback rate minus mean xpass, both over the plays that CARRY an xpass (a play without one is in
//                  neither), in PERCENTAGE POINTS (×100, signed: +3.5 = passing 3.5 points more than expected).
//                  proeN = how many plays that is. Splits, each over its own plays with an xpass: proeEarly (down 1
//                  or 2), proeNeutral (neutral script: score within 7 either way, |sd| <= 7, in quarters 1-3; a play
//                  without an sd is not neutral), proeRz (yardline_100 <= 20), proeI5 (yardline_100 <= 5); each with
//                  its own count (proeEarlyN, ...).
//   Neutral pass rate (neutralPassRate) = dropbacks / plays in neutral script (every neutral play, xpass or not);
//                  neutralPlays the count.
//   On DEFENSE these are what the defense FACED (its opponents' PROE against it). Style, not quality: neither way
//   is better, so none of these keys is in OFF_TIER/DEF_TIER (uncoloured); the league mean and rank still show, rank
//   1 = the most pass-happy over expectation (teamRank's high-first default for an untiered key).
// Pace and shape (D219 figures 2 and 3; additive). secs = seconds to the offense's next snap in the drive (increment
// A: empty on a drive's last snap and across a quarter); noHuddle and shotgun = the play-by-play's flags (shotgun
// counts pistol, D219 call (iii)); motion = FTN's charting (a row FTN did not chart carries no value, the PA % rule);
// pers = nflverse's offense_personnel text ("1 RB, 1 TE, 3 WR"), published after a season, so empty for the current one.
//   Neutral sec/play (neutralSecs) = mean secs over neutral-script plays (the PROE neutral rule) that carry a secs
//                  value; neutralSecsN the count. Rank 1 = the FASTEST (fewest seconds; RANK_LOW_FIRST below).
//   Neutral plays/g (neutralPlaysG) = neutral-script plays / games; null when no play in the window carries an sd.
//   No-huddle % (noHuddlePct) = plays with noHuddle / plays carrying the flag; noHuddle, noHuddleN the counts.
//   Shotgun % (shotgunPct) = plays with shotgun / plays carrying the flag; shotgun, shotgunN.
//   Motion % (motionPct) = FTN-charted plays with motion / FTN-charted plays (every play type, not only dropbacks).
//   11 personnel % (pers11Pct) = plays whose personnel is 1 RB, 1 TE and 3 WR (isPers11; linemen and extra QBs
//                  ignored) / plays carrying a personnel value; pers11, persN.
//   A season compiled before D219 (no such columns) gives null for all six, never NaN. On DEFENSE all are what it
//   FACED. Style, not quality: none is in OFF_TIER/DEF_TIER (uncoloured); most-first rank except seconds.
// Drives (D219 figure 7; additive). The week file's `drives` block (increment A: one row per offensive drive, in
// driveCols order game_id, posteam, drive, result, pts, rz, plays; kneel-only drives already left out by the compile).
// A club's "drive games" (driveG) are its games in the window whose week carries a drives block; a window with none
// (a season compiled before D219) gives null figures, never NaN.
//   Points/drive (ptsDrive) = Σ drive pts / drives. pts = the points the offense actually scored on its own snaps
//                  (D219 call (ii), the default: 6 plus the try, a field goal 3, a defensive score against it 0).
//   Drives/g (drivesG) = drives / driveG. Red-zone trips/g (rzTripsG) = drives with rz / driveG. Volume, uncoloured.
//   Red-zone TD % (rzTdPct) = red-zone drives whose result is "Touchdown" / red-zone drives (a field goal is a trip,
//                  not a touchdown).
//   3rd-down % (thirdPct) = down-3 play rows converted / down-3 play rows, over rows that carry the firstDown column;
//                  pass-interference rows are left out on both sides (teamPlay drops them). Converted = td or
//                  firstDown; a first down a foul gave the offense counts (D219 call (v), the default) unless
//                  THIRD_DOWN_PENALTY_FD below is flipped. Penalty no-plays have no row, so this reads a little under
//                  NFL.com's figure.
//   On DEFENSE all five are what it FACED (its opponents' drives and third downs against it); points/drive, RZ TD %
//   and 3rd-down % are higher-is-better on offense and lower-is-better on defense.
// LEAGUE REFERENCE (Adam's perspective rule, D177): the plain mean over the clubs in the window (32 in a full week;
// fewer on a week with byes), and colour tiers at the clubs' 90/70/40/15th percentiles (agg.js; under 8 clubs,
// uncoloured). Lower-is-better keys are cut on the negated value; neutral keys (pass rate, aDOT, blitz %) are not
// coloured. Zone references are POOLED over every attempt in the window.
import { colIndex, clubGames, percentileCuts, tierFromCuts, MIN_POOL, aggregateUsage, usageReference, rushEvent } from "./agg.js";
import { gamesInWindow } from "./filters.js";
import { ZONE_KEYS, qbZones } from "./agg_qb.js";
import { aggregateRush, rushReference, rushTier } from "./agg_rush.js";
import { rzI5Shares } from "./agg_player.js";

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
const ratio = (a, b) => (b > 0 ? a / b : null);
const finite = (x) => x !== null && x !== undefined && Number.isFinite(+x);
const mean = (vals) => { const v = vals.filter(finite).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export const EXPL_RUN = 10, EXPL_PASS = 20;
// Coverage defenders (D195): players.json positions counted as cornerbacks and safeties.
export const COVER_POS = (() => {
  const s = new Set(["CB", "SAF", "S", "FS", "SS", "DB"]);
  s.add = s.delete = s.clear = () => { throw new TypeError("COVER_POS is read-only"); };
  return Object.freeze(s);
})();
// The NFL passer rating on (completions, attempts, yards, TDs, interceptions): four parts each clipped to 0-2.375,
// summed, / 6 × 100 (0 to 158.3). null with no attempts.
export function passerRating(cmp, att, yds, td, int) {
  if (!(att > 0)) return null;
  const c = (x) => Math.min(2.375, Math.max(0, x));
  return ((c((cmp / att - 0.3) * 5) + c((yds / att - 3) * 0.25) + c((td / att) * 20) + c(2.375 - (int / att) * 25)) / 6) * 100;
}

// D231: the play-by-play dropbacks (the D178 dropback, a.wk's db) over the given week keys, the club-weeks PFR
// covers for a side. PFR's own dropbacks are never a rate's denominator: the compile derives them as pressures /
// pressure rate, so a passer never pressured has none, and a trick-play passer has no row; a week PFR has not
// published is in neither the count nor this sum.
const wkDb = (a, keys) => { let n = 0; for (const k of keys) n += a.wk.get(k)?.db || 0; return n; };

// One play row as a team play, or null (a pi row, or a type the ledger uses for nothing else).
export function teamPlay(r, C) {
  const type = r[C.type];
  if (truthy(r[C.pi]) || !["pass", "sack", "scramble", "run"].includes(type)) return null;
  const yards = num(r[C.yards]) ?? 0, att = type === "pass", complete = att && truthy(r[C.complete]);
  const db = type !== "run", bl = num(r[C.blitzers]);
  return {
    type, db, att, complete, yards, air: att ? num(r[C.air]) : null, epa: num(r[C.epa]), succ: num(r[C.success]),
    td: truthy(r[C.td]) && !truthy(r[C.int]), int: att && truthy(r[C.int]),
    pa: db && r[C.pa] !== null && r[C.pa] !== undefined ? truthy(r[C.pa]) : null,
    blitz: db && bl !== null ? bl >= 1 : null,
    expl: type === "run" || type === "scramble" ? yards >= EXPL_RUN : complete && yards >= EXPL_PASS,
    band: r[C.band], dir: r[C.dir],
    // D219 play calling: the expectation and the situation (null where the row has no such column or value).
    xpass: num(r[C.xpass]), sd: num(r[C.sd]), qtr: num(r[C.qtr]), down: num(r[C.down]), yl: num(r[C.yardline_100]),
    // D219 drives: the first-down flag (null where the rows have no such column) and the distance to go.
    fd: C.firstDown === undefined || r[C.firstDown] === null || r[C.firstDown] === undefined ? null : truthy(r[C.firstDown]), togo: num(r[C.ydstogo]),
    // D219 pace and shape: null where the row has no such column or value (a flag's null is "not charted").
    secs: num(r[C.secs]), noHuddle: flagOf(r[C.noHuddle]), shotgun: flagOf(r[C.shotgun]), motion: flagOf(r[C.motion]),
    pers11: typeof r[C.pers] === "string" && r[C.pers].trim() ? isPers11(r[C.pers]) : null,
  };
}
// A 0/1 flag, or null when the row carries none (a missing column or an uncharted play).
const flagOf = (v) => (v === null || v === undefined || v === "" ? null : truthy(v));

// D219 figure 3: nflverse's offense_personnel text ("1 RB, 1 TE, 3 WR", "6 OL, 1 RB, 1 TE, 2 WR") as { RB, TE, WR, ... }
// counts, or null for an empty or unreadable value. A position the text leaves out counts 0.
export function parsePersonnel(s) {
  if (typeof s !== "string" || !s.trim()) return null;
  const out = {};
  for (const part of s.split(",")) {
    if (!part.trim()) continue;
    const m = part.trim().match(/^(\d+)\s+([A-Z]+)$/i);
    if (!m) return null;
    out[m[2].toUpperCase()] = (out[m[2].toUpperCase()] || 0) + +m[1];
  }
  return out;
}
// 11 personnel: one back, one tight end and three receivers, whatever the linemen and quarterbacks.
export function isPers11(s) {
  const p = parsePersonnel(s);
  return !!p && (p.RB || 0) === 1 && (p.TE || 0) === 1 && (p.WR || 0) === 3;
}

// D219 call (v), Adam's open call on a third down converted by a foul: true (the default) counts it, the offense kept
// the ball, which is what the ledger's firstDown flag already says; false keeps only a first down the play's own
// yards reached (or a touchdown), close to nflverse's third_down_converted. If this flips, compile.js's
// THIRD_DOWN_NOTE audit must count the same way (and leave pass-interference rows out, as this page does).
export const THIRD_DOWN_PENALTY_FD = true;
export function thirdDownConverted(e, countPenalty = THIRD_DOWN_PENALTY_FD) {
  if (e.td) return true;
  if (!e.fd) return false;
  return countPenalty || (e.togo !== null && e.yards >= e.togo);
}

// D219: the PROE splits (key, the play's filter). "neutral" is also the neutral pass rate's filter.
const isNeutral = (e) => e.sd !== null && Math.abs(e.sd) <= 7 && e.qtr !== null && e.qtr >= 1 && e.qtr <= 3;
export const PROE_SPLITS = Object.freeze([
  ["proe", () => true],
  ["proeEarly", (e) => e.down === 1 || e.down === 2],
  ["proeNeutral", isNeutral],
  ["proeRz", (e) => e.yl !== null && e.yl <= 20],
  ["proeI5", (e) => e.yl !== null && e.yl <= 5],
]);

const emptyCell = () => ({ n: 0, cmp: 0, yds: 0, td: 0, int: 0, epa: 0, epaN: 0 });
function addCell(c, e) { c.n++; if (e.complete) { c.cmp++; c.yds += e.yards; } if (e.td) c.td++; if (e.int) c.int++; if (e.epa !== null) { c.epa += e.epa; c.epaN++; } }
const newSide = () => ({ games: new Set(), plays: 0, epa: 0, epaN: 0, succ: 0, succN: 0, db: 0, dbEpa: 0, dbEpaN: 0, runs: 0, runEpa: 0, runEpaN: 0, runYds: 0,
  runSucc: 0, runSuccN: 0, runExpl: 0,
  att: 0, cmp: 0, yds: 0, air: 0, airN: 0, sacks: 0, pa: 0, paN: 0, bl: 0, blN: 0, expl: 0,
  zones: Object.fromEntries(ZONE_KEYS.map((k) => [k, emptyCell()])), wk: new Map(),
  pfrPress: 0, pfrWeeks: new Set(), qbPress: 0, qbWeeks: new Set(),
  // Grid additions (D195): stuffed designed runs; PFR QB hits on the same QB rows as pressure; PFR coverage
  // charting (defense); PFR yards before contact.
  runStuff: 0, pfrHits: 0, qbHits: 0,
  covTgt: 0, covCmp: 0, covYds: 0, covTd: 0, covInt: 0, covWeeks: new Set(), ybc: 0, ybcCar: 0, ybcWeeks: new Set(),
  // Line-block additions (D198): PFR hurries on the QB rows (offense own, defense the opposing QBs'), and the
  // defenders' own hurries and hits summed (the pressuresG rule).
  pfrHurries: 0, qbHurries: 0, defHurries: 0, defHits: 0,
  // D219 play calling: per PROE split { n plays with an xpass, db dropbacks among them, x sum of their xpass }, and
  // the neutral-script plays and dropbacks (xpass or not).
  pe: Object.fromEntries(PROE_SPLITS.map(([k]) => [k, { n: 0, db: 0, x: 0 }])), nPlays: 0, nDb: 0,
  // D219 drives: drives, their points, red-zone drives and red-zone touchdowns, the weeks carrying a drives block;
  // down-3 rows (with a firstDown column) and the converted ones.
  drN: 0, drPts: 0, drRz: 0, drRzTd: 0, drWeeks: new Set(), third: 0, thirdConv: 0,
  // D219 pace and shape: plays carrying an sd; neutral plays' secs sum and count; each flag's hits and carriers.
  sdN: 0, nSecs: 0, nSecsN: 0, nh: 0, nhN: 0, sg: 0, sgN: 0, mo: 0, moN: 0, p11: 0, pN: 0,
  // D224 increment G, the line blocks' per-game strips: week key -> that week's PFR pressure sums on the same QB rows
  // as Pressure % ({ press }; offense its own QBs, defense the opposing QBs) and the coverage sums ({ tgt, cmp, yds,
  // td, int }, defense). A week absent from the map had no PFR row for the club (PFR runs about a week behind).
  pfrWk: new Map(), qbWk: new Map(), covWk: new Map() });

function addPlay(a, key, e, playRec) {
  a.plays++;
  if (isNeutral(e)) { a.nPlays++; if (e.db) a.nDb++; if (e.secs !== null) { a.nSecs += e.secs; a.nSecsN++; } }
  if (e.sd !== null) a.sdN++;
  if (e.noHuddle !== null) { a.nhN++; if (e.noHuddle) a.nh++; }
  if (e.shotgun !== null) { a.sgN++; if (e.shotgun) a.sg++; }
  if (e.motion !== null) { a.moN++; if (e.motion) a.mo++; }
  if (e.pers11 !== null) { a.pN++; if (e.pers11) a.p11++; }
  if (e.xpass !== null) for (const [k, ok] of PROE_SPLITS) if (ok(e)) { const c = a.pe[k]; c.n++; c.x += e.xpass; if (e.db) c.db++; }
  if (e.down === 3 && e.fd !== null) { a.third++; if (thirdDownConverted(e)) a.thirdConv++; }
  const w = a.wk.get(key) || { plays: 0, db: 0, epa: 0, epaN: 0, runs: 0, dbEpa: 0, dbEpaN: 0, runEpa: 0, runEpaN: 0 };
  w.plays++; if (e.db) w.db++;
  if (e.epa !== null) { a.epa += e.epa; a.epaN++; w.epa += e.epa; w.epaN++; }
  a.wk.set(key, w);
  if (e.succ !== null) { a.succ += e.succ; a.succN++; }
  if (e.db) {
    a.db++;
    if (e.epa !== null) { a.dbEpa += e.epa; a.dbEpaN++; w.dbEpa += e.epa; w.dbEpaN++; }
    if (e.pa !== null) { a.paN++; if (e.pa) a.pa++; }
    if (e.blitz !== null) { a.blN++; if (e.blitz) a.bl++; }
  } else {
    a.runs++; a.runYds += e.yards; w.runs++;
    if (e.yards <= 0) { a.runStuff++; w.stuff = (w.stuff || 0) + 1; } // w.stuff: D224 increment G, the per-game stuffed %
    if (e.epa !== null) { a.runEpa += e.epa; a.runEpaN++; w.runEpa += e.epa; w.runEpaN++; }
    if (e.succ !== null) { a.runSucc += e.succ; a.runSuccN++; }
    if (e.expl) a.runExpl++;
  }
  if (e.type === "sack") a.sacks++;
  if (e.expl) a.expl++;
  if (e.att) {
    a.att++;
    if (e.complete) { a.cmp++; a.yds += e.yards; }
    if (e.air !== null) { a.air += e.air; a.airN++; }
    const zk = e.band && e.dir ? e.band + e.dir : null;
    if (zk && a.zones[zk]) { addCell(a.zones[zk], e); if (playRec) (a.zones[zk].plays ||= []).push(playRec); }
  }
}

// { plays, playsG, passRate, epaPlay, ... } for one side of one club.
function sideRates(a, g) {
  const pDb = wkDb(a, a.pfrWeeks); // D231: the PFR rates' denominator, play-by-play dropbacks in the PFR weeks
  return {
    g, plays: a.plays, playsG: ratio(a.plays, g), db: a.db, dbG: ratio(a.db, g), runs: a.runs, runsG: ratio(a.runs, g), att: a.att, cmp: a.cmp, sacks: a.sacks,
    passRate: ratio(a.db, a.plays), epaPlay: ratio(a.epa, a.epaN), epaDb: ratio(a.dbEpa, a.dbEpaN), epaCar: ratio(a.runEpa, a.runEpaN), ypc: ratio(a.runYds, a.runs),
    succPct: ratio(a.succ, a.succN), adot: ratio(a.air, a.airN), cmpPct: ratio(a.cmp, a.att), sackPct: ratio(a.sacks, a.db),
    paPct: ratio(a.pa, a.paN), blitzPct: ratio(a.bl, a.blN), explPct: ratio(a.expl, a.plays), expl: a.expl,
    runSuccPct: ratio(a.runSucc, a.runSuccN), runExplPct: ratio(a.runExpl, a.runs),
    pressPct: ratio(a.pfrPress, pDb), pfrPress: a.pfrPress, pfrDb: pDb, pfrWeeks: a.pfrWeeks.size,
    zones: a.zones,
    // Grid additions (D195), additive.
    rushYds: a.runYds, rushYdsG: ratio(a.runYds, g), stuffed: a.runStuff, stuffPct: ratio(a.runStuff, a.runs),
    pressPctAllowed: ratio(a.pfrPress, pDb), hitPctAllowed: ratio(a.pfrHits, pDb), pfrHits: a.pfrHits,
    ybc: a.ybc, ybcCarries: a.ybcCar, ybcCar: ratio(a.ybc, a.ybcCar), ybcWeeks: a.ybcWeeks.size,
    // Line-block additions (D198), additive. sacksG is play-by-play (D178), never PFR's sack columns.
    sacksG: ratio(a.sacks, g), hurryPctAllowed: ratio(a.pfrHurries, pDb), pfrHurries: a.pfrHurries,
    // D219 play calling, additive: PROE in percentage points and its splits, each with its play count; neutral pass rate.
    ...Object.fromEntries(PROE_SPLITS.flatMap(([k]) => { const c = a.pe[k]; return [[k, c.n > 0 ? ((c.db - c.x) / c.n) * 100 : null], [k + "N", c.n]]; })),
    neutralPassRate: ratio(a.nDb, a.nPlays), neutralPlays: a.nPlays,
    // D219 drives, additive: null (never NaN) with no drives block or no down-3 rows carrying firstDown.
    drives: a.drN, drivePts: a.drPts, driveG: a.drWeeks.size, ptsDrive: ratio(a.drPts, a.drN), drivesG: ratio(a.drN, a.drWeeks.size),
    rzTrips: a.drRz, rzTripsG: ratio(a.drRz, a.drWeeks.size), rzTd: a.drRzTd, rzTdPct: ratio(a.drRzTd, a.drRz),
    third: a.third, thirdConv: a.thirdConv, thirdPct: ratio(a.thirdConv, a.third),
    // D219 pace and shape, additive: null (never NaN) where no play carries the column.
    neutralSecs: ratio(a.nSecs, a.nSecsN), neutralSecsN: a.nSecsN, neutralPlaysG: a.sdN > 0 ? ratio(a.nPlays, g) : null,
    noHuddlePct: ratio(a.nh, a.nhN), noHuddle: a.nh, noHuddleN: a.nhN, shotgunPct: ratio(a.sg, a.sgN), shotgun: a.sg, shotgunN: a.sgN,
    motionPct: ratio(a.mo, a.moN), motion: a.mo, motionN: a.moN, pers11Pct: ratio(a.p11, a.pN), pers11: a.p11, persN: a.pN,
  };
}

// Every club's offense and defense in the window. Returns { rows: [{ team, g, off, def, series: { off, def } }],
// weeks (window week keys, sorted), lgZones (pooled over every attempt), pfrThrough (latest window week with any PFR
// row), latestKey, unmapped ([{ key, gsis }] PFR defender rows the players file cannot place, and { key, gsis,
// src: "pass" } passing rows the same) }.
// `opts.playsFor`: a club whose zone cells (both sides) also keep the play list.
export function aggregateTeams(blocks, players, st, opts = {}) {
  const games = clubGames(blocks);
  const inWin = gamesInWindow(games, st);
  const info = new Map(games.map((g) => [`${g.key}|${g.team}`, g]));
  const off = new Map(), def = new Map();
  const S = (m, t) => { if (!m.has(t)) m.set(t, newSide()); return m.get(t); };
  const lgZones = Object.fromEntries(ZONE_KEYS.map((k) => [k, emptyCell()]));
  const unmapped = [];
  let pfrThrough = null;

  for (const b of blocks) {
    const C = colIndex(b.cols);
    for (const r of b.plays || []) {
      const pt = r[C.posteam], dt = r[C.defteam];
      if (!pt || !dt) continue;
      const e = teamPlay(r, C);
      if (!e) continue;
      const okOff = inWin.has(`${b.key}|${pt}`), okDef = inWin.has(`${b.key}|${dt}`);
      if (!okOff && !okDef) continue;
      const rec = opts.playsFor && (opts.playsFor === pt || opts.playsFor === dt) && e.att
        ? { key: b.key, off: pt, def: dt, down: num(r[C.down]), togo: num(r[C.ydstogo]), yl: num(r[C.yardline_100]), passer: r[C.passer] || null,
          target: r[C.target] || null, result: e.int ? "INT" : e.complete ? (e.td ? "TD" : "Comp") : "Inc", air: e.air, yards: e.complete ? e.yards : 0, epa: e.epa }
        : null;
      if (okOff) { const a = S(off, pt); a.games.add(b.key); addPlay(a, b.key, e, opts.playsFor === pt ? rec : null); }
      if (okDef) { const a = S(def, dt); a.games.add(b.key); addPlay(a, b.key, e, opts.playsFor === dt ? rec : null); }
      if (okOff && e.att && e.band && e.dir && lgZones[e.band + e.dir]) addCell(lgZones[e.band + e.dir], e);
    }
  }
  // D219 drives: the offense from its own drives, the defense (its opponent that game) from the drives it faced.
  for (const b of blocks) {
    if (!b.drives?.length || !b.driveCols) continue;
    const D = colIndex(b.driveCols);
    for (const r of b.drives) {
      const pt = r[D.posteam];
      if (!pt) continue;
      const opp = info.get(`${b.key}|${pt}`)?.opp;
      const pts = num(r[D.pts]) ?? 0, rz = truthy(r[D.rz]), td = r[D.result] === "Touchdown";
      const add = (a) => { a.drN++; a.drPts += pts; a.drWeeks.add(b.key); if (rz) { a.drRz++; if (td) a.drRzTd++; } };
      if (inWin.has(`${b.key}|${pt}`)) add(S(off, pt));
      if (opp && inWin.has(`${b.key}|${opp}`)) add(S(def, opp));
    }
  }
  // PFR: the offense's QB rows, and the defense's defender rows (plus the QB-side check for the defense).
  for (const b of blocks) {
    let any = false;
    for (const [id, p] of Object.entries(b.pfr?.pass || {})) {
      // D231: a row counts when PFR charted his pressures, even 0. PFR keeps a never-pressured passer's row (pressures
      // 0), but the compile's dropbacks (pressures / pressure rate) are null for him, and the old rule dropped the row
      // on that null; the row now marks the club-week as covered and adds 0, the rates dividing by the play-by-play
      // dropbacks. A passer the players file cannot place that week is listed in `unmapped` (src "pass").
      const team = players?.[id]?.teams?.[b.key];
      if (!team) { unmapped.push({ key: b.key, gsis: id, src: "pass" }); continue; }
      if (num(p?.pressures) === null) continue;
      // 🔵 (D224 increment G): the window is judged per club, as the play loop's okOff/okDef do. Under Last 3 a QB's
      // game can be inside his opponent's last 3 and outside his own club's (an uneven bye), so the offense sums need
      // the QB's club in the window and the defense sums the opponent's; a row is skipped only when neither is.
      const opp = info.get(`${b.key}|${team}`)?.opp;
      const okOff = inWin.has(`${b.key}|${team}`), okDef = !!opp && inWin.has(`${b.key}|${opp}`);
      if (!okOff && !okDef) continue;
      any = true;
      if (okOff) {
        const a = S(off, team); a.pfrPress += num(p.pressures) ?? 0; a.pfrWeeks.add(b.key);
        a.pfrHits += num(p.hits) ?? 0; a.pfrHurries += num(p.hurries) ?? 0;
        addWk(a.pfrWk, b.key, { press: num(p.pressures) ?? 0 });
      }
      if (okDef) {
        const d = S(def, opp); d.qbPress += num(p.pressures) ?? 0; d.qbWeeks.add(b.key);
        d.qbHits += num(p.hits) ?? 0; d.qbHurries += num(p.hurries) ?? 0;
        addWk(d.qbWk, b.key, { press: num(p.pressures) ?? 0 });
      }
    }
    const defKeys = new Map(); // team -> pressures this week
    const defHH = new Map(); // team -> { hu, hi } the defenders' hurries and hits this week (D198; the same rule)
    for (const [id, p] of Object.entries(b.pfr?.def || {})) {
      const team = players?.[id]?.teams?.[b.key];
      if (!team) { unmapped.push({ key: b.key, gsis: id }); continue; }
      if (!inWin.has(`${b.key}|${team}`)) continue;
      defKeys.set(team, (defKeys.get(team) || 0) + (num(p?.pressures) ?? 0));
      const hh = defHH.get(team) || { hu: 0, hi: 0 };
      hh.hu += num(p?.hurries) ?? 0; hh.hi += num(p?.hits) ?? 0; defHH.set(team, hh);
      // Coverage (D195): the club's CBs and safeties only, by players.json position; a row with no targets adds nothing.
      const tgt = num(p?.covTgt);
      if (COVER_POS.has(String(players?.[id]?.pos || "").toUpperCase()) && tgt !== null && tgt > 0) {
        const d = S(def, team);
        d.covTgt += tgt; d.covCmp += num(p.covCmp) ?? 0; d.covYds += num(p.covYds) ?? 0; d.covTd += num(p.covTd) ?? 0; d.covInt += num(p.covInt) ?? 0;
        d.covWeeks.add(b.key);
        addWk(d.covWk, b.key, { tgt, cmp: num(p.covCmp) ?? 0, yds: num(p.covYds) ?? 0, td: num(p.covTd) ?? 0, int: num(p.covInt) ?? 0 });
      }
    }
    // Yards before contact (D195, PFR advanced rushing; the block is {} until the refresh fetches the file): the
    // offense over its own rushers' rows, the defense over its opponents' rushers' rows (the QB-side pattern above).
    // Quarterbacks are left out: PFR's carries count their scrambles and kneels, which are not designed runs.
    for (const [id, p] of Object.entries(b.pfr?.rush || {})) {
      const team = players?.[id]?.teams?.[b.key], car = num(p?.carries), ybc = num(p?.ybc);
      if (String(players?.[id]?.pos || "").toUpperCase() === "QB") continue;
      if (!team || car === null || car <= 0 || ybc === null) continue;
      // The same per-club window rule as the QB rows above (🔵, D224 increment G).
      const opp = info.get(`${b.key}|${team}`)?.opp;
      if (inWin.has(`${b.key}|${team}`)) { const a = S(off, team); a.ybc += ybc; a.ybcCar += car; a.ybcWeeks.add(b.key); }
      if (opp && inWin.has(`${b.key}|${opp}`)) { const d = S(def, opp); d.ybc += ybc; d.ybcCar += car; d.ybcWeeks.add(b.key); }
    }
    for (const [team, pr] of defKeys) {
      const d = S(def, team), faced = d.wk.get(b.key)?.db || 0;
      if (!faced) continue;
      d.pfrPress += pr; d.pfrWeeks.add(b.key); any = true;
      const hh = defHH.get(team); d.defHurries += hh?.hu ?? 0; d.defHits += hh?.hi ?? 0;
    }
    const inWinKey = [...inWin].some((gk) => gk.startsWith(b.key + "|"));
    if (any && inWinKey && (!pfrThrough || b.key > pfrThrough)) pfrThrough = b.key;
  }

  const weeks = [...new Set([...inWin].map((gk) => gk.split("|")[0]))].sort();
  const teams = [...new Set([...off.keys(), ...def.keys()])].sort();
  const rows = teams.map((team) => {
    const o = off.get(team) || newSide(), d = def.get(team) || newSide();
    const g = [...inWin].filter((gk) => gk.endsWith("|" + team)).length;
    const series = (a, side) => weeks.map((key) => {
      const gm = info.get(`${key}|${team}`);
      if (!gm || !inWin.has(`${key}|${team}`)) return { key, bye: true, plays: null, db: null, passRate: null, epaPlay: null, epaDb: null, epaCar: null, runs: null };
      const w = a.wk.get(key) || { plays: 0, db: 0, epa: 0, epaN: 0, runs: 0, dbEpa: 0, dbEpaN: 0, runEpa: 0, runEpaN: 0 };
      return { key, opp: gm.opp, home: gm.home, side, plays: w.plays, db: w.db, runs: w.runs, passRate: ratio(w.db, w.plays),
        epaPlay: ratio(w.epa, w.epaN), epaDb: ratio(w.dbEpa, w.dbEpaN), epaCar: ratio(w.runEpa, w.runEpaN),
        ...lineWeek(a, side, key, w) };
    });
    // The defense's Pressure % is the QB side; Pressures/g is the defenders' own sum, per game (D178 pairing). D231:
    // the QB side's denominator is the dropbacks this defense faced (play-by-play) in the weeks PFR lists its opponent.
    const qDb = wkDb(d, d.qbWeeks);
    const dr = { ...sideRates(d, g), pressPct: ratio(d.qbPress, qDb), pfrDb: qDb, pfrWeeks: d.qbWeeks.size, pressuresG: ratio(d.pfrPress, g), pfrPressDef: d.pfrPress, pfrWeeksDef: d.pfrWeeks.size,
      // Grid additions (D195): pressure and hits from the opposing QBs' rows (the Press % rule), and coverage.
      pressPctAllowed: ratio(d.qbPress, qDb), hitPctAllowed: ratio(d.qbHits, qDb), pfrHits: d.qbHits,
      covTgt: d.covTgt, covCmp: d.covCmp, covYds: d.covYds, covTd: d.covTd, covInt: d.covInt, covWeeks: d.covWeeks.size,
      covYdsTgt: ratio(d.covYds, d.covTgt), covCmpPct: ratio(d.covCmp, d.covTgt), covRating: passerRating(d.covCmp, d.covTgt, d.covYds, d.covTd, d.covInt) };
    // Line-block additions (D198): hurries on the opposing QBs' rows (the Press % rule); the defenders' hurries and
    // hits per game (the pressuresG rule); run stop % = designed runs faced that failed / those carrying a success value.
    const rsp = ratio(d.runSucc, d.runSuccN);
    Object.assign(dr, { hurryPctAllowed: ratio(d.qbHurries, qDb), pfrHurries: d.qbHurries,
      hurriesG: ratio(d.defHurries, g), hitsG: ratio(d.defHits, g), pfrHurriesDef: d.defHurries, pfrHitsDef: d.defHits,
      runStopPct: rsp === null ? null : 1 - rsp });
    return { team, g, off: sideRates(o, g), def: dr, series: { off: series(o, "off"), def: series(d, "def") } };
  });
  return { rows, weeks, lgZones, pfrThrough, latestKey: weeks[weeks.length - 1] || null, unmapped };
}

// D224 increment G: one week's figures for the line blocks' per-game strips, each on the window figure's own rows and
// rule, so the weeks' numerators and denominators sum to the tile's figure over the weeks charted:
//   prPct  = PFR pressures on the Pressure % QB rows that week (offense: pressPctAllowed, its own QBs; defense:
//            pressPct, the opposing QBs against it) / the play-by-play dropbacks that week (D231, the tile's
//            denominator); prN, prDb the two; pfr = false (prPct, prN, prDb null) when PFR has no such row for the
//            club that week yet.
//   stuffPct = designed runs gaining 0 or less / designed runs that week (play-by-play, the Stuffed % rule); stuffed.
//   covRating (defense) = the NFL passer rating on that week's CB and safety coverage rows (the covRating rule);
//            covTgt, covCmp, covYds, covTd, covInt the sums; cov = false (covRating null) with no such row that week.
function lineWeek(a, side, key, w) {
  const p = (side === "def" ? a.qbWk : a.pfrWk).get(key) || null, c = side === "def" ? a.covWk.get(key) || null : null;
  const out = { pfr: !!p, prN: p ? p.press : null, prDb: p ? w.db : null, prPct: p ? ratio(p.press, w.db) : null,
    stuffed: w.stuff || 0, stuffPct: ratio(w.stuff || 0, w.runs) };
  if (side === "def") Object.assign(out, { cov: !!c, covTgt: c ? c.tgt : null, covCmp: c ? c.cmp : null, covYds: c ? c.yds : null, covTd: c ? c.td : null, covInt: c ? c.int : null,
    covRating: c ? passerRating(c.cmp, c.tgt, c.yds, c.td, c.int) : null });
  return out;
}
function addWk(m, key, add) {
  const cur = m.get(key) || Object.fromEntries(Object.keys(add).map((k) => [k, 0]));
  for (const [k, v] of Object.entries(add)) cur[k] += v;
  m.set(key, cur);
}

// ---- the league reference among clubs ------------------------------------------------------------------------
export const TEAM_LG_KEYS = ["plays", "playsG", "dbG", "runsG", "passRate", "epaPlay", "epaDb", "epaCar", "succPct", "adot", "cmpPct", "sackPct", "pressPct", "pressuresG", "paPct", "blitzPct", "explPct", "ypc", "runSuccPct", "runExplPct",
  "rushYdsG", "stuffPct", "pressPctAllowed", "hitPctAllowed", "ybcCar", "covYdsTgt", "covCmpPct", "covRating",
  "hurryPctAllowed", "hurriesG", "hitsG", "sacksG", "runStopPct",
  // D219 play calling: uncoloured (not in OFF_TIER/DEF_TIER), league mean and rank only.
  "proe", "proeEarly", "proeNeutral", "proeRz", "proeI5", "neutralPassRate",
  // D219 drives: points/drive, RZ TD % and 3rd-down % tiered below; drives/g and RZ trips/g are volume, uncoloured.
  "ptsDrive", "drivesG", "rzTripsG", "rzTdPct", "thirdPct",
  // D219 pace and shape: uncoloured, league mean and rank only.
  "neutralSecs", "neutralPlaysG", "noHuddlePct", "shotgunPct", "motionPct", "pers11Pct"];
// Untiered keys ranked LOWEST first (teamRank, and the Rankings table's first click): the fastest offense has the
// fewest seconds between snaps.
export const RANK_LOW_FIRST = new Set(["neutralSecs"]);
// Direction: 1 = higher is better, -1 = lower is better. The grid additions (D195): on offense more rushing yards,
// YPC and yards before contact are better, and fewer stuffed runs, pressures and hits allowed; on defense the
// reverse for the run figures, more stuffed runs forced and more pressure and hits forced, and a lower passer
// rating and fewer yards per target allowed in coverage.
export const OFF_TIER = { epaPlay: 1, epaDb: 1, epaCar: 1, succPct: 1, cmpPct: 1, explPct: 1, sackPct: -1, pressPct: -1,
  rushYdsG: 1, ypc: 1, ybcCar: 1, stuffPct: -1, pressPctAllowed: -1, hitPctAllowed: -1,
  // D198: the O-line block and the Offense table's rushing tiles.
  hurryPctAllowed: -1, runSuccPct: 1, runExplPct: 1, sacksG: -1,
  // D203: more plays per game is better on offense (muted, see SOFT_KEYS below).
  playsG: 1,
  // D219 drives: scoring more per drive, finishing red-zone trips and converting third downs are better.
  ptsDrive: 1, rzTdPct: 1, thirdPct: 1 };
export const DEF_TIER = { epaPlay: -1, epaDb: -1, epaCar: -1, succPct: -1, cmpPct: -1, explPct: -1, sackPct: 1, pressPct: 1, pressuresG: 1, ypc: -1, runSuccPct: -1, runExplPct: -1,
  rushYdsG: -1, ybcCar: -1, stuffPct: 1, pressPctAllowed: 1, hitPctAllowed: 1, covRating: -1, covYdsTgt: -1, covCmpPct: -1,
  // D198: the D-line block.
  hurryPctAllowed: 1, hurriesG: 1, hitsG: 1, sacksG: 1, runStopPct: 1,
  // D203: more plays FACED per game is worse on defense (muted, see SOFT_KEYS below).
  playsG: -1,
  // D219 drives: fewer points per drive, red-zone touchdowns and third-down conversions allowed are better.
  ptsDrive: -1, rzTdPct: -1, thirdPct: -1 };
const dirOf = (side) => (side === "def" ? DEF_TIER : OFF_TIER);
// D203 (Adam, 2026-09-27): keys that ARE tiered (a real lean exists) but should read as a lean, not a verdict - the
// UI (a tile or table cell) adds a `t-soft` class alongside its `t-<tier>` class; analytics.css's `.t-soft.t-<tier>`
// rule then halves the colour's strength by mixing it toward the ink colour. One mechanism, so a new soft figure
// never needs a new set of muted colours - just add its key here.
export const SOFT_KEYS = ["playsG"];

// { n (clubs), lg: { off: {k: mean}, def: {k: mean} }, cuts: { off: {k: {cuts, n}}, def } , text }.
export function teamReference(rows) {
  const out = { n: rows.length, lg: {}, cuts: {}, text: `every club in the window (${rows.length})` };
  for (const side of ["off", "def"]) {
    out.lg[side] = Object.fromEntries(TEAM_LG_KEYS.map((k) => [k, mean(rows.map((r) => r[side][k]))]));
    out.cuts[side] = {};
    for (const [k, sgn] of Object.entries(dirOf(side))) {
      const v = rows.map((r) => r[side][k]).filter(finite).map((x) => sgn * x);
      out.cuts[side][k] = v.length >= MIN_POOL ? { cuts: percentileCuts(v), n: v.length } : { cuts: null, n: v.length };
    }
  }
  return out;
}
// A club's tier on one key ("" for a neutral key, a missing value or too few clubs).
export function teamTier(side, k, v, cuts) {
  const sgn = dirOf(side)[k];
  if (!sgn || !finite(v)) return "";
  return tierFromCuts(sgn * v, cuts?.[side]?.[k]?.cuts);
}
// A club's rank among the clubs with a value, 1 = best ("" direction keys rank high-first, RANK_LOW_FIRST low-first).
export function teamRank(rows, side, k, team) {
  const sgn = dirOf(side)[k] || (RANK_LOW_FIRST.has(k) ? -1 : 1);
  const list = rows.filter((r) => finite(r[side][k])).sort((a, b) => sgn * (b[side][k] - a[side][k]));
  const i = list.findIndex((r) => r.team === team);
  return i < 0 ? null : { rank: i + 1, of: list.length };
}
// A side's zone cells with the league's pooled cells, for the zone field (agg_qb.js's shape).
export const teamZones = (side, lgZones) => qbZones(side?.zones, lgZones);

// ---- the team page's distributions ---------------------------------------------------------------------------
// Pass catchers: agg.js's usage rows for the club (his games with that club, every position), each with his tier on
// target share at his position (agg.js's reference pool and cuts over the whole league, the same window) and his
// share of the club's targets in the window (`clubShare`: targets / every target the club threw, pi included when
// the switch counts them). Sorted by targets.
const rzPick = (x, kind) => (kind === "rz"
  ? { rzTgtN: x?.rzTgtN ?? 0, rzAttN: x?.rzAttN ?? 0, rzTgtShare: x?.rzTgtShare ?? null }
  : { i5Des: x?.i5Des ?? 0, i5Runs: x?.i5Runs ?? 0, i5Share: x?.i5Share ?? null });
export function teamTargets(blocks, players, st, team) {
  const base = { ...st, opp: "", ha: "", downs: [], qtrs: [], pos: {} };
  const rows = aggregateUsage(blocks, players, { ...base, team }).rows.filter((r) => r.tgt > 0);
  const ref = usageReference(aggregateUsage(blocks, players, { ...base, team: "" }).rows);
  const total = rows.reduce((s, r) => s + r.tgt, 0);
  // D219 figure 5: rzTgtN, rzAttN, rzTgtShare (null under agg_player.js's 3-play floor) over his games for this club.
  const rz = rzI5Shares(blocks, players, base, team);
  return rows.map((r) => ({ ...r, ...rzPick(rz.get(r.gsis), "rz"), clubShare: ratio(r.tgt, total), tier: tierFromCuts(r.tgtShare, ref.at(r.pos).cuts?.tgtShare?.cuts), lgShare: ref.at(r.pos).lg?.overall?.tgtShare ?? null }))
    .sort((a, b) => b.tgt - a.tgt || String(a.name).localeCompare(String(b.name)));
}
// Ball carriers: agg_rush.js's rows for the club, tier on rush share at his position; `clubShare` = his carries /
// every carry the club logged (scrambles included). Sorted by carries.
export function teamCarries(blocks, players, st, team) {
  const base = { ...st, opp: "", ha: "", downs: [], qtrs: [], pos: {} };
  const rows = aggregateRush(blocks, players, { ...base, team }).rows.filter((r) => r.car > 0);
  const ref = rushReference(aggregateRush(blocks, players, { ...base, team: "" }).rows);
  const total = rows.reduce((s, r) => s + r.car, 0);
  // D219 figure 5: i5Des, i5Runs, i5Share (null under the 3-play floor) over his games for this club.
  const rz = rzI5Shares(blocks, players, base, team);
  return rows.map((r) => { const P = ref.at(r.pos); return { ...r, ...rzPick(rz.get(r.gsis), "i5"), clubShare: ratio(r.car, total), tier: rushTier("rushShare", r.rushShare, P.cuts), epaTier: rushTier("epaCar", r.epaCar, P.cuts), lgShare: P.lg?.rushShare ?? null }; })
    .sort((a, b) => b.car - a.car || String(a.name).localeCompare(String(b.name)));
}

// ---- the defense page's distributions (D198) ----------------------------------------------------------------------
// The men a DEFENSE faced: teamTargets / teamCarries with team "" and opp = the defense. Each row is agg.js's (agg_rush.js's)
// row for that man over his games against this defense, with the same tier and lgShare as the team page's rows, and
// clubShare = his targets (carries) / every target (carry) the defense faced in the window. Sorted by volume.
// The returned array also carries (as properties):
//   byPos   = { WR: 0.55, TE: 0.25, RB: 0.2, ... } this defense's share of the targets (carries) it faced, by the man's
//             players-file position ("?" when the file has none), largest first; {} when it faced none;
//   lgByPos = the same per position, the plain mean over every defense that faced one in the window (a defense that
//             faced no man at a position counts 0 there), largest first; lgN = how many defenses that is.
// Window: season and range windows are week ranges, the same for every club. Under "last 3" (each club's own last
// three games) the offenses' windows would not line up with the defense's, so the defense's own last three games
// are used: the state becomes the week range from its third-last game to its last (one game a week, so that range
// holds exactly those games). The league line reads every defense over its own last three, the aggregateTeams rule.
function defWindowState(blocks, st, team) {
  if (st.window !== "last3") return st;
  const keys = [...gamesInWindow(clubGames(blocks), st)].filter((gk) => gk.endsWith("|" + team)).map((gk) => gk.split("|")[0]).sort();
  return keys.length ? { ...st, window: "range", from: keys[0], to: keys[keys.length - 1] } : null;
}
const posKey = (players, id) => String(players?.[id]?.pos || "").toUpperCase() || "?";
// { byDef: Map(defteam -> Map(pos -> n)) } over every defense's own window: targets (kind "tgt", the pass-interference
// switch as agg.js) or carries (kind "car", agg.js's rushEvent: designed runs and scrambles).
function facedByPos(blocks, players, st, kind) {
  const inWin = gamesInWindow(clubGames(blocks), st);
  const byDef = new Map();
  for (const b of blocks) {
    const C = colIndex(b.cols);
    for (const r of b.plays || []) {
      const dt = r[C.defteam];
      if (!dt || !r[C.posteam] || !inWin.has(`${b.key}|${dt}`)) continue;
      let id = null;
      if (kind === "tgt") { if (r[C.type] === "pass" && r[C.target] && !(truthy(r[C.pi]) && st.pi === false)) id = r[C.target]; }
      else id = rushEvent(r, C)?.id ?? null;
      if (!id) continue;
      if (!byDef.has(dt)) byDef.set(dt, new Map());
      const m = byDef.get(dt), p = posKey(players, id);
      m.set(p, (m.get(p) || 0) + 1);
    }
  }
  return byDef;
}
const sharesOf = (m) => {
  const tot = [...(m?.values() || [])].reduce((s, n) => s + n, 0);
  return tot > 0 ? Object.fromEntries([...m].map(([p, n]) => [p, n / tot]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) : {};
};
function posSummary(byDef, team) {
  const per = [...byDef.values()].map(sharesOf).filter((s) => Object.keys(s).length);
  const pos = [...new Set(per.flatMap((s) => Object.keys(s)))];
  const lgByPos = Object.fromEntries(pos.map((p) => [p, per.reduce((s, x) => s + (x[p] || 0), 0) / per.length]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  return { byPos: sharesOf(byDef.get(team)), lgByPos, lgN: per.length };
}
export function defTargets(blocks, players, st, team) {
  const base = { ...st, opp: "", ha: "", downs: [], qtrs: [], pos: {} };
  const ws = defWindowState(blocks, base, team);
  const rows = ws ? aggregateUsage(blocks, players, { ...ws, team: "", opp: team }).rows.filter((r) => r.tgt > 0) : [];
  const ref = usageReference(aggregateUsage(blocks, players, { ...base, team: "" }).rows);
  const total = rows.reduce((s, r) => s + r.tgt, 0);
  const out = rows.map((r) => ({ ...r, clubShare: ratio(r.tgt, total), tier: tierFromCuts(r.tgtShare, ref.at(r.pos).cuts?.tgtShare?.cuts), lgShare: ref.at(r.pos).lg?.overall?.tgtShare ?? null }))
    .sort((a, b) => b.tgt - a.tgt || String(a.name).localeCompare(String(b.name)));
  return Object.assign(out, posSummary(facedByPos(blocks, players, base, "tgt"), team));
}
export function defCarries(blocks, players, st, team) {
  const base = { ...st, opp: "", ha: "", downs: [], qtrs: [], pos: {} };
  const ws = defWindowState(blocks, base, team);
  const rows = ws ? aggregateRush(blocks, players, { ...ws, team: "", opp: team }).rows.filter((r) => r.car > 0) : [];
  const ref = rushReference(aggregateRush(blocks, players, { ...base, team: "" }).rows);
  const total = rows.reduce((s, r) => s + r.car, 0);
  const out = rows.map((r) => { const P = ref.at(r.pos); return { ...r, clubShare: ratio(r.car, total), tier: rushTier("rushShare", r.rushShare, P.cuts), epaTier: rushTier("epaCar", r.epaCar, P.cuts), lgShare: P.lg?.rushShare ?? null }; })
    .sort((a, b) => b.car - a.car || String(a.name).localeCompare(String(b.name)));
  return Object.assign(out, posSummary(facedByPos(blocks, players, base, "car"), team));
}

// Sort the defense rows on one side's key; nulls last whichever direction; ties by team.
export function sortTeamRows(rows, side, key, dir = "asc") {
  const s = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "team") return s * a.team.localeCompare(b.team);
    const x = a[side][key], y = b[side][key];
    if (!finite(x)) return !finite(y) ? a.team.localeCompare(b.team) : 1;
    if (!finite(y)) return -1;
    return s * (x - y) || a.team.localeCompare(b.team);
  });
}
