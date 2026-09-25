// PURE (no DOM, no fetch): "What's been lost" (D196 C, Adam 2026-09-25: "I want to be able to see what's been lost
// for that team"). For one club: the men the injury feed says will not play, the shares of the club's work they held
// before they went out, and who has been taking that work since. Every figure comes from the play rows and snap
// table already loaded (D178: the play-by-play is canonical for targets, carries, air yards and red-zone looks; the
// snap table for snaps). The injury feed only says WHO is missing; it never supplies a figure here.
//
// Inputs: `blocks`, `players` and `st` as in agg.js. st.season is REQUIRED for this view: the page passes the
// feed's season (the newest season in the blocks is only a fallback). st.pi false skips pass-interference rows as
// agg.js does; st.po true lets playoff weeks in. The page must load the PREVIOUS season's blocks too: the feed's
// lastPlayed covers this season only, so a man out since week 1 (and a hurt man's usual snap share, below) can only
// come from those blocks. `status`: the feed's map { [gsis]: { team, pos, code, label, scratch, willNotPlay, detail,
// returnDate, fillIn, lastPlayed: { season, week, opp, snapPct (a whole number 0-100) }, missed } }. Only `team`,
// `code`, `scratch`, `willNotPlay`, `fillIn` and `lastPlayed` steer the logic; the rest is copied through for the
// page (copied, so the caller's feed object is never frozen).
//
// WHO IS MISSING: status.team is the club, and willNotPlay is set or code is "D" (doubtful), and he is not a coach's-
// decision scratch (status.scratch set, or "coach's decision" in label/detail). A man is listed only when he mattered
// over his BEFORE window: at least 5 percent of the club's targets, designed runs or red-zone looks, or at least 25
// percent snap share; a skill man whose feed entry names a fill-in is listed whatever his shares (lead's call: a
// charted out starter never drops off, even with no blocks to measure him). Positions outside QB/RB/FB/WR/TE (linemen, defenders, specialists) come back as `nameOnly`
// (the page links them to the depth chart) and are listed on the 25 percent snap bar alone, measured on their own
// side: defensive snaps for a defender, offensive snaps for everyone else (lead's ruling, 2026-09-25).
//
// A GAME HE PLAYED for the club (club-games are the club's offensive games in the blocks, regular season unless
// st.po): he appears on one of its plays (passer, target, rusher) or took a snap for it on his side (the snap row's
// club is his club that week in the players file).
// BEFORE = his last 4 games played for the club in ONE season, walking back from his most recent game played and
// skipping any game whose snap share was under half his usual. Usual = the median of his snap shares over his games
// played that season; with fewer than 2 of them this season, the median over his previous-season games for the club
// when those are loaded (so a star hurt on his third snap of week 1 has that game skipped). Skipped games are listed in
// `leftEarlyGames` and are in neither window; `leftEarly` (the page's footnote) is set only when the skipped game is
// his LAST game played, the one he probably got hurt in. A game with no snap row is never skipped. If BEFORE comes out
// empty this season (out since week 1, or hurt in his only game), it comes from the previous season's games for the
// club when those blocks are loaded (`priorSeason`); a man new to the club has none.
// If BEFORE is still empty (`noData`), every share is null and he is listed only when the feed's lastPlayed says he
// played this season or last with snapPct 25 or more (lead's ruling; snapPct / 100), or names a fill-in, so depth men
// on injured reserve stay off.
// SINCE = the club's games this season after his last game played (a left-early game counts as his last game played;
// a man out since week 1 has every game this season). Byes are not club-games, so they are never counted;
// sinceGames 0 and 1 are both valid (the page shows BEFORE only for 0 and greys 1).
//
// SHARES over a set of club-games G (each over the CLUB's totals in G, never over his own games only):
//   attShare  = his pass attempts / the club's pass attempts in G (so a missing quarterback and his backup show)
//   tgtShare  = his targets / the club's pass attempts in G (a PI target counts for him but is no pass attempt,
//               agg.js's rule)
//   carShare  = his designed runs / the club's designed runs in G (agg_rush.js's rush share; the club's designed
//               runs are every run row, agg.js's teamRuns, and a scramble sits on neither side). `car` counts every carry (rushEvent: designed runs and a passer's scrambles).
//   rzShare   = his red-zone looks / the club's red-zone looks in G; a look is a target or a designed run on a play
//               with the red-zone flag; the club's looks are its red-zone pass attempts plus its red-zone run rows.
//   ayShare   = his air yards on targets / the club's air yards on pass attempts in G.
//   oppShare  = (targets + designed runs) / (pass attempts + designed runs) in G (D191's Opp %).
//   snapShare = the MEAN of his weekly snap percentages over the games in G that have a snap row for him (the snap
//               table holds percentages, not counts, so this is agg.js's snapPct rule, not a total over a total).
// Every ratio is null on a zero denominator. Club per-game rates: passG = pass attempts / games, runG = designed runs
// / games, over BEFORE and over SINCE.
// ABSORBED: every teammate (a man with a pass attempt, target or designed run for the club in BEFORE or SINCE, the
// missing man left out) whose attempt, target or carry share rose 3 points or more from BEFORE to SINCE; sorted with
// the depth chart's fill-in (status.fillIn: a gsis, an object with one, or a name) first when he is in the list, then
// by the largest of his rises. `fillIn` on the
// missing man carries the fill-in's before/since shares whether or not he rose.
import { clubGames, colIndex, rushEvent } from "./agg.js";
import { gamesInWindow, splitKey } from "./filters.js";

export const SKILL_POS = new Set(["QB", "RB", "FB", "WR", "TE"]);
export const DEF_POS = new Set(["DE", "DT", "NT", "DL", "EDGE", "LB", "ILB", "OLB", "MLB", "CB", "NB", "DB", "S", "FS", "SS", "SAF"]);
export const SHARE_MIN = 0.05, SNAP_MIN = 0.25, ABSORB_MIN = 0.03, BEFORE_N = 4;
const EPS = 1e-9;

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v);
const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
const ratio = (a, b) => (b > 0 ? a / b : null);
const median = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const COACH = /coach'?s\s+decision/i;

// ---- the club index: per club-game totals and per-man counts, built once per call ------------------------------
function clubIndex(blocks, players, st, team) {
  const s = st || {};
  const seasons = blocks.map((b) => b.season ?? splitKey(b.key).season);
  const season = s.season ?? (seasons.length ? Math.max(...seasons) : null);
  const win = gamesInWindow(clubGames(blocks), { window: "season", po: !!s.po });
  const games = [...win].filter((gk) => gk.endsWith(`|${team}`)).map((gk) => gk.split("|")[0]).sort()
    .map((key) => ({ key, gk: `${key}|${team}`, season: splitKey(key).season }));
  const gset = new Set(games.map((g) => g.gk));
  const per = new Map(games.map((g) => [g.gk, { att: 0, air: 0, runs: 0, rz: 0, men: new Map(), snaps: new Map() }]));
  const man = (G, id) => { if (!G.men.has(id)) G.men.set(id, { att: 0, tgt: 0, air: 0, des: 0, car: 0, rz: 0 }); return G.men.get(id); };
  for (const b of blocks) {
    const C = colIndex(b.cols);
    const gk = `${b.key}|${team}`;
    if (!gset.has(gk)) continue;
    const G = per.get(gk);
    for (const r of b.plays || []) {
      if (r[C.posteam] !== team) continue;
      const pi = truthy(r[C.pi]);
      if (pi && s.pi === false) continue;
      for (const col of ["passer", "target", "rusher"]) if (r[C[col]]) man(G, r[C[col]]);
      const rz = truthy(r[C.redzone]);
      // The club's designed runs are every run row (agg.js's teamRuns); rushEvent credits the man's own carries.
      if (r[C.type] === "run") { G.runs++; if (rz) G.rz++; }
      const ev = rushEvent(r, C);
      if (ev) {
        const m = man(G, ev.id); m.car++;
        if (ev.designed) { m.des++; if (rz) m.rz++; }
      }
      if (r[C.type] !== "pass") continue;
      const air = num(r[C.air]) ?? 0;
      if (!pi) { G.att++; G.air += air; if (rz) G.rz++; if (r[C.passer]) man(G, r[C.passer]).att++; }
      const id = r[C.target];
      if (!id) continue;
      const m = man(G, id); m.tgt++; m.air += air; if (rz) m.rz++;
    }
    for (const [id, x] of Object.entries(b.snaps || {})) {
      if (players?.[id]?.teams?.[b.key] !== team) continue;
      const off = num(x?.off), def = num(x?.def);
      G.snaps.set(id, { off: off !== null && off > 0 ? off / 100 : null, def: def !== null && def > 0 ? def / 100 : null });
    }
  }
  return { team, season, games, per };
}

const sideOf = (pos) => (DEF_POS.has(pos) ? "def" : "off");
const posOf = (players, status, id) => String(players?.[id]?.pos || status?.[id]?.pos || "").toUpperCase();
const snapOf = (G, id, side) => G.snaps.get(id)?.[side] ?? null;
const playedIn = (G, id, side) => snapOf(G, id, side) !== null || (side === "off" && G.men.has(id));

// His BEFORE and SINCE windows for the club (see the header).
function windows(idx, id, side) {
  const byGk = idx.per;
  const played = (season) => idx.games.filter((g) => g.season === season && playedIn(byGk.get(g.gk), id, side));
  const leftEarlyGames = [];
  const snapsIn = (pool) => pool.map((g) => snapOf(byGk.get(g.gk), id, side)).filter((x) => x !== null);
  const walk = (pool, usual) => {
    const got = [];
    for (let i = pool.length - 1; i >= 0 && got.length < BEFORE_N; i--) {
      const sn = snapOf(byGk.get(pool[i].gk), id, side);
      if (sn !== null && usual !== null && sn < usual / 2) leftEarlyGames.unshift(pool[i].key);
      else got.unshift(pool[i]);
    }
    return got;
  };
  const cur = played(idx.season);
  const priorLoaded = idx.games.some((g) => g.season === idx.season - 1);
  const prior = priorLoaded ? played(idx.season - 1) : [];
  // His usual: the median of this season's snap shares; under 2 of them, last season's for the club when loaded.
  const curSn = snapsIn(cur), priorUsual = median(snapsIn(prior));
  const usual = curSn.length >= 2 || priorUsual === null ? median(curSn) : priorUsual;
  let last = cur.length ? cur[cur.length - 1] : null;
  let before = walk(cur, usual), priorSeason = false;
  // Out since week 1 (or hurt in his only game this season): the previous season's games for the club, when loaded.
  if (!before.length && priorLoaded) {
    before = walk(prior, priorUsual);
    priorSeason = before.length > 0;
    if (!last && prior.length) last = prior[prior.length - 1];
  }
  const since = idx.games.filter((g) => g.season === idx.season && (!last || last.season !== idx.season || g.key > last.key));
  // Footnoted only when the low game is his LAST game played (the one he probably got hurt in).
  // A prior-season low game (a week 17 or 18 rest game) is still skipped from BEFORE but never footnoted.
  const leftEarly = !!last && last.season === idx.season && leftEarlyGames.includes(last.key);
  return { before, since, last, priorSeason, leftEarly, leftEarlyGames, noData: before.length === 0 };
}

// One man's shares over a set of club-games (the header's definitions).
function shares(idx, id, games, side = "off") {
  let att = 0, air = 0, runs = 0, rz = 0, mAtt = 0, tgt = 0, mAir = 0, des = 0, car = 0, mRz = 0;
  const snaps = [];
  for (const g of games) {
    const G = idx.per.get(g.gk);
    att += G.att; air += G.air; runs += G.runs; rz += G.rz;
    const m = G.men.get(id);
    if (m) { mAtt += m.att; tgt += m.tgt; mAir += m.air; des += m.des; car += m.car; mRz += m.rz; }
    const sn = snapOf(G, id, side);
    if (sn !== null) snaps.push(sn);
  }
  return {
    games: games.length, att: mAtt, attShare: ratio(mAtt, att), tgt, tgtShare: ratio(tgt, att), car, des, carG: ratio(car, games.length), carShare: ratio(des, runs),
    rz: mRz, rzShare: ratio(mRz, rz), air: mAir, ayShare: ratio(mAir, air), oppShare: ratio(tgt + des, att + runs),
    snapShare: snaps.length ? snaps.reduce((a, b) => a + b, 0) / snaps.length : null,
  };
}

function clubRates(idx, games) {
  let att = 0, runs = 0;
  for (const g of games) { const G = idx.per.get(g.gk); att += G.att; runs += G.runs; }
  return { games: games.length, pass: att, runs, passG: ratio(att, games.length), runG: ratio(runs, games.length) };
}

const delta = (a, b) => (a === null || b === null ? null : b - a);
function changeRecord(idx, players, id, w, fillIn) {
  const b = shares(idx, id, w.before), s = shares(idx, id, w.since);
  const tgt = { before: b.tgtShare, since: s.tgtShare, change: delta(b.tgtShare, s.tgtShare) };
  const car = { before: b.carShare, since: s.carShare, change: delta(b.carShare, s.carShare) };
  const att = { before: b.attShare, since: s.attShare, change: delta(b.attShare, s.attShare) };
  const ch = [tgt.change, car.change, att.change].filter((x) => x !== null);
  return { gsis: id, name: players?.[id]?.name || id, pos: String(players?.[id]?.pos || "").toUpperCase(),
    fillIn: id === fillIn, tgtShare: tgt, carShare: car, attShare: att, change: ch.length ? Math.max(...ch) : null };
}

// status.fillIn as a gsis: a gsis string, an object carrying gsis/id, or a name matched among the club's men.
function fillInId(idx, players, f) {
  if (!f) return null;
  const v = typeof f === "object" ? f.gsis || f.id || f.name : f;
  if (!v) return null;
  if (players?.[v]) return v;
  const want = String(v).toLowerCase();
  for (const G of idx.per.values()) for (const id of [...G.men.keys(), ...G.snaps.keys()]) if (String(players?.[id]?.name || "").toLowerCase() === want) return id;
  return null;
}

const isCoachScratch = (e) => !!e.scratch || COACH.test(String(e.label || "")) || COACH.test(String(e.detail || ""));
export const isMissing = (e) => !!e && !isCoachScratch(e) && (!!e.willNotPlay || String(e.code || "").toUpperCase() === "D");

// The fallback for a man with no BEFORE data: the feed says he played this season or last, on 25 percent or more.
function lastPlayedCounts(e, season) {
  const lp = e?.lastPlayed;
  if (!lp || num(lp.season) === null) return false;
  const sn = num(lp.snapPct) === null ? null : num(lp.snapPct) / 100; // the feed's snapPct is a whole number 0-100
  return (num(lp.season) === season || num(lp.season) === season - 1) && sn !== null && sn >= SNAP_MIN - EPS;
}

export function absences(blocks, players, st, team, status) {
  const idx = clubIndex(blocks || [], players, st, team);
  const out = [];
  for (const [id, e] of Object.entries(status || {})) {
    if (e?.team !== team || !isMissing(e)) continue;
    const pos = posOf(players, status, id);
    const nameOnly = !SKILL_POS.has(pos);
    const side = nameOnly ? sideOf(pos) : "off";
    const w = windows(idx, id, side);
    const before = shares(idx, id, w.before, side);
    // A skill man the depth chart has a fill-in for is always listed (lead's call): a charted out starter never drops off.
    const charted = !nameOnly && !!e.fillIn;
    if (charted) { /* listed */ }
    else if (w.noData) { if (!lastPlayedCounts(e, idx.season)) continue; }
    else if (nameOnly ? !(before.snapShare >= SNAP_MIN - EPS)
      : !([before.tgtShare, before.carShare, before.rzShare].some((x) => x !== null && x >= SHARE_MIN - EPS) || before.snapShare >= SNAP_MIN - EPS)) continue;
    const base = {
      gsis: id, name: players?.[id]?.name || e.name || id, pos, nameOnly, side,
      status: { code: e.code ?? null, label: e.label ?? null, detail: e.detail ?? null, returnDate: e.returnDate ?? null,
        willNotPlay: !!e.willNotPlay, lastPlayed: e.lastPlayed ? { ...e.lastPlayed } : null, missed: e.missed && typeof e.missed === "object" ? structuredClone(e.missed) : e.missed ?? null },
      priorSeason: w.priorSeason, noData: w.noData, leftEarly: w.leftEarly, leftEarlyGames: w.leftEarlyGames,
      lastGame: w.last ? w.last.key : null, beforeGames: w.before.map((g) => g.key), sinceKeys: w.since.map((g) => g.key),
      sinceGames: w.since.length,
    };
    if (nameOnly) { out.push({ ...base, snapShare: w.noData ? null : before.snapShare }); continue; }
    const nul = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "games" ? v : w.noData ? null : v]));
    const fid = fillInId(idx, players, e.fillIn);
    let absorbed = [], fillIn = null;
    if (!w.noData && w.since.length) {
      const ids = new Set();
      for (const g of [...w.before, ...w.since]) for (const [m, c] of idx.per.get(g.gk).men) if (c.tgt || c.des || c.att) ids.add(m);
      ids.delete(id);
      absorbed = [...ids].map((m) => changeRecord(idx, players, m, w, fid))
        .filter((r) => [r.tgtShare.change, r.carShare.change, r.attShare.change].some((x) => x !== null && x >= ABSORB_MIN - EPS))
        .sort((a, b) => (b.fillIn - a.fillIn) || (b.change - a.change) || a.name.localeCompare(b.name));
      if (fid && fid !== id) fillIn = changeRecord(idx, players, fid, w, fid);
    }
    out.push({ ...base, before: nul(before), club: { before: clubRates(idx, w.before), since: clubRates(idx, w.since) },
      fillInId: fid, fillIn, absorbed });
  }
  // Skill men first, by their BEFORE opportunity share; then no-data men; then names-only men by snap share.
  const rank = (r) => (r.nameOnly ? 2 : r.noData ? 1 : 0);
  const val = (r) => (r.nameOnly ? r.snapShare : r.before?.oppShare) ?? -1;
  out.sort((a, b) => rank(a) - rank(b) || val(b) - val(a) || a.name.localeCompare(b.name));
  return deepFreeze(out);
}

// One teammate's figures with the missing man (over the missing man's BEFORE games) and without him (his SINCE
// games): target share, carries (count, per club-game, designed-run share), snap share, as defined above. For the
// line on the rising man's page ("Without X (2 games): target share 31%, 22% with him").
export function withWithout(blocks, players, st, team, gsis, other) {
  const idx = clubIndex(blocks || [], players, st, team);
  const pos = String(players?.[gsis]?.pos || "").toUpperCase();
  const w = windows(idx, gsis, SKILL_POS.has(pos) || !pos ? "off" : sideOf(pos));
  const pick = (x) => ({ games: x.games, att: x.att, attShare: x.attShare, tgt: x.tgt, tgtShare: x.tgtShare, car: x.car, carG: x.carG, carShare: x.carShare, snapShare: x.snapShare });
  const empty = (n) => ({ games: n, att: null, attShare: null, tgt: null, tgtShare: null, car: null, carG: null, carShare: null, snapShare: null });
  return deepFreeze({
    gsis, other, name: players?.[other]?.name || other, pos: String(players?.[other]?.pos || "").toUpperCase(),
    missingName: players?.[gsis]?.name || gsis, priorSeason: w.priorSeason, noData: w.noData,
    with: w.noData ? empty(0) : pick(shares(idx, other, w.before)),
    without: pick(shares(idx, other, w.since)),
    beforeGames: w.before.map((g) => g.key), sinceKeys: w.since.map((g) => g.key), sinceGames: w.since.length,
  });
}
