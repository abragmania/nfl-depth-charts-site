// Teams: the club picker (#/teams, 32 team pills by division) and the team page (#/team/:abbr, the OFFENSE; the
// defense lives on the Defense leaderboard's expanded row in v1, D179). Tiles carry the league reference among the
// clubs and are tier-coloured among them (D177 perspective); the week-by-week bars carry the window's figure and the
// league line (D181 totals); the pass zone field compares each cell with every attempt in the league; the target and
// carry distributions list the club's pass catchers and ball carriers, each a way into his player page (D177
// interactivity). Every figure comes from agg_team.js (pure); this file draws and wires clicks.
import { backLink } from "../router.js";
import { fromQuery, toQuery, seasonsOf, weekLabel } from "../filters.js";
import { loadFor, loadTeams, loadStatusFeed, displayName } from "../data.js";
import { aggregateTeams, teamReference, teamTier, teamRank, teamZones, teamTargets, teamCarries } from "../agg_team.js";
import { absences, isMissing } from "../agg_absence.js";
import { renderFilterBar } from "../filterbar.js";
import { esc, NA, isNum, pct, fix, signed, int, teamPill, qbStrips, qbZoneField, qbZoneName, QB_ZONE_MODES, pfrNote, seasonLabel } from "./qb.js";
import { windowName } from "./qbplayer.js";
import { statusChip, statusNameClass } from "./kit.js";

const P = (v, d = 1) => (isNum(v) ? pct(v, d) + "%" : NA);
const BAND = (pos) => (pos === "RB" || pos === "FB" ? "BACKFIELD" : pos);
export const TEAM_ZONE_MODES = QB_ZONE_MODES.filter((m) => ["att", "cmpPct", "ydsAtt", "epaAtt"].includes(m.k));
const ord = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n === 4 ? "4th" : "");

// The page ignores the position chips, team and opponent (one club; its reference is every club in the window).
export const teamPageState = (st) => ({ ...st, team: "", opp: "", ha: "", downs: [], qtrs: [], pos: {} });

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

// A horizontal distribution bar list. items: [{ gsis, name, pos, share, tier, main, sub, title }]; `max` scales the bars.
export function distList(items, q, { max = 0.35, lg = null, lgLabel = "" } = {}) {
  if (!items.length) return `<div class="an-note">Nobody in this window.</div>`;
  const top = Math.max(max, ...items.map((x) => x.share || 0));
  const lgMark = isNum(lg) ? `<i class="an-tm-lg" style="left:${Math.min(100, (lg / top) * 100).toFixed(1)}%" title="${esc(lgLabel)}"></i>` : "";
  return `<div class="an-tm-dist">${items.map((x) => `<div class="an-tm-drow${x.tier ? " t-" + x.tier : ""}" title="${esc(x.title || "")}">`
    + `<a class="an-tm-dname" href="#/player/${encodeURIComponent(x.gsis)}${q ? "?" + q : ""}">${esc(x.name)}</a><span class="an-pospill" data-band="${BAND(x.pos)}">${esc(x.pos)}</span>`
    + `<span class="an-tm-track"><i class="an-tm-fill" style="width:${(((x.share || 0) / top) * 100).toFixed(1)}%"></i>${lgMark}</span>`
    + `<b class="an-tm-v">${x.main}</b><span class="an-tm-sub">${x.sub}</span></div>`).join("")}</div>`;
}

// ---- "What's been lost" (D196 C) -------------------------------------------------------------------------------
// PURE: the card above the tiles from absences()'s list (agg_absence.js). Drawn only when the injury feed's season is
// the season on screen (the statuses are this season's) and the club has at least one listed man; otherwise "".
// Skill men first (absences() already orders them), each with his status, games missed, the shares he held over his
// BEFORE window and, when the club has played since, who has absorbed them (the depth chart's fill-in first) and the
// club's passes and runs per game before and since. Linemen and defenders are names only, each a link to the club's
// depth chart. opts: { season (on screen), feedSeason, abbr, q (the page's query, for player links), feedPlayers (the
// feed's players map: the chip and the played-this-season test read each man's full feed entry, so the hover carries
// ESPN's note as on every other page; absences()'s own copy of the status is the fallback) }.
export const LOST_TIP = "Before: his last 4 games played for the club, a game he left early skipped, last season's when he has none this season; since: the club's games after his last one; every share is of the club's total in those games, and \"pts\" are percentage points of that share.";
// The injury after the kit's short chip (which prints the code only): the first part of ESPN's detail, lowered
// ("Knee - ACL (Leg) - Surgery" -> "knee"); the chip's hover carries the whole detail.
export function lostInjury(detail) {
  return String(detail || "").split(/\s+\(|\s+-\s+/)[0].trim().toLowerCase();
}
const whole = (v) => `${Math.round(v * 100)}%`;
const perG = (v) => (isNum(v) ? String(Math.round(v)) : "–");
export function lostCardHtml(list, { season, feedSeason, abbr = "", q = "", feedPlayers = null } = {}) {
  if (feedSeason == null || +feedSeason !== +season || !list?.length) return "";
  const qq = q ? "?" + q : "";
  const who = (id, name, cls = "") => `<a${cls ? ` class="${cls}"` : ""} href="#/player/${encodeURIComponent(id)}${qq}">${esc(name)}</a>`;
  const statusBits = (r) => {
    const fe = feedPlayers?.[r.gsis] ?? null;
    const s = fe ?? r.status ?? {};
    const lp = s.lastPlayed;
    const notYet = fe && typeof fe.playedThisSeason === "boolean" ? !fe.playedThisSeason : !lp || +lp.season !== +feedSeason;
    const missed = notYet ? "hasn't played this season" : isNum(s.missed) && s.missed > 0 ? `missed ${s.missed}` : "";
    const inj = lostInjury(s.detail);
    return { html: statusChip(s) + (inj ? ` <span class="an-tm-lostinj">${esc(inj)}</span>` : ""), missed, nameCls: statusNameClass(s) };
  };
  const skill = list.filter((r) => !r.nameOnly), names = list.filter((r) => r.nameOnly);
  const man = (r) => {
    const st = statusBits(r);
    const head = `<div class="an-tm-losthead">${who(r.gsis, r.name, `an-tm-lostname${st.nameCls ? " " + st.nameCls : ""}`)}`
      + `<span class="an-pospill" data-band="${esc(BAND(r.pos))}">${esc(r.pos)}</span>`
      + `<span class="an-tm-loststat">${st.html}</span>`
      + (st.missed ? `<span class="an-tm-lostmiss">${esc(st.missed)}</span>` : "") + `</div>`;
    if (r.noData) return `<div class="an-tm-lostman">${head}<div class="an-tm-lostbefore">no data: no games for the club to measure him on</div></div>`;
    const b = r.before || {};
    const held = [[b.attShare, "attempts"], [b.tgtShare, "targets"], [b.carShare, "carries"], [b.rzShare, "RZ looks"], [b.ayShare, "air yards"], [b.snapShare, "snaps"]]
      .filter(([v]) => isNum(v) && Math.round(v * 100) > 0).map(([v, w]) => `${whole(v)} ${w}`);
    const n = b.games || 0;
    const over = r.priorSeason ? `over last season's last ${n === 1 ? "game" : n}` : n === 1 ? "over his last game" : `over his last ${n}`;
    const before = `<div class="an-tm-lostbefore">${held.length ? `held ${held.join(", ")} ${over}` : `held no measurable share ${over}`}</div>`;
    let since = "";
    if (r.sinceGames > 0) {
      // The fill-in first whether or not his share rose, then everyone else who rose; each named by his largest rise.
      const rows = [...(r.fillIn ? [r.fillIn] : []), ...(r.absorbed || []).filter((a) => a.gsis !== r.fillIn?.gsis)].slice(0, 4);
      let lastWord = "";
      const took = rows.map((a) => {
        const k = [["tgtShare", "targets"], ["carShare", "carries"], ["attShare", "attempts"]].find(([key]) => isNum(a[key]?.change) && a[key].change === a.change);
        const n = isNum(a.change) ? Math.round(a.change * 100) : null;
        const pts = n === null ? "" : `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;
        const word = k ? k[1] : "";
        // The unit on every name; the metric word only when it differs from the name before's.
        const unit = pts ? ` pt${Math.abs(n) === 1 ? "" : "s"}${word && word !== lastWord ? " " + word : ""}` : "";
        if (word) lastWord = word;
        return `<span class="an-tm-lostitem">${who(a.gsis, a.name)}${a.fillIn ? `<span class="an-tm-lostfill" title="the depth chart's fill-in">fill-in</span>` : ""}${pts ? ` ${pts}${unit}` : ""}</span>`;
      });
      const c = r.club || {};
      const club = `<span class="an-tm-lostitem">club passes/g ${perG(c.before?.passG)} → ${perG(c.since?.passG)}, runs/g ${perG(c.before?.runG)} → ${perG(c.since?.runG)}</span>`;
      const one = r.sinceGames === 1;
      since = `<div class="an-tm-lostsince${one ? " is-one" : ""}"${one ? ` title="One game since: too few to read much into"` : ""}>since (${r.sinceGames} game${one ? "" : "s"}): ${[...took, club].join(" · ")}</div>`;
    }
    const foot = r.leftEarly ? `<div class="an-tm-lostfoot">left the last one early; that game is not counted</div>` : "";
    return `<div class="an-tm-lostman">${head}${before}${since}${foot}</div>`;
  };
  const nameLine = (r) => {
    const st = statusBits(r);
    return `<span class="an-tm-lostline"><span class="an-tm-lostpos">${esc(r.pos)}</span> <a class="an-tm-lostname${st.nameCls ? " " + st.nameCls : ""}" href="../#/team/${encodeURIComponent(abbr)}" target="_blank" rel="noopener" title="on the depth chart">${esc(r.name)}</a> <span class="an-tm-loststat">${st.html}</span>${st.missed ? ` · ${esc(st.missed)}` : ""}</span>`;
  };
  return `<div class="an-card an-tm-lost"><div class="an-dh" title="${esc(LOST_TIP)}">What's been lost <span class="an-dsub">who is missing, the share of the work he held before, and who has taken it since</span></div>`
    + (skill.length ? `<div class="an-tm-lostmen">${skill.map(man).join("")}</div>` : "")
    // Names-only men split by side (absences()'s `side`: "def" for a defender, "off" for everyone else), offense first,
    // a side with nobody left out.
    + (names.length ? `<div class="an-tm-lostnames">${[["off", "Offense:"], ["def", "Defense:"]].map(([sd, label]) => {
      const men = names.filter((r) => (r.side === "def" ? "def" : "off") === sd);
      return men.length ? `<span class="an-tm-lostside">${label}</span>${men.map(nameLine).join("")}` : "";
    }).join("")}</div>` : "")
    + `</div>`;
}

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
    <div class="an-head"><h1>Teams</h1><div class="an-sub">Pick a club for its offense: tiles against the league, week by week, the pass zone field, and who gets the targets and carries. Its defense is on the <a href="#/defense${q ? "?" + q : ""}">Defense</a> page.</div></div>
    <div class="an-tm-grid">${[...divs].map(([d, list]) => `<div class="an-tm-div"><div class="an-dh">${esc(d)}</div>${list.map((t) =>
      `<div class="an-tm-pick">${teamPill(t.abbr, new Map([[t.abbr, t]]), q, "an-tm-pill")}<a href="#/team/${esc(t.abbr)}${q ? "?" + q : ""}">${esc(t.name)}</a></div>`).join("")}</div>`).join("")}</div>
  </section>` : `<div class="an-msg">The team list could not be loaded.</div>`;
}

// ---- #/team/:abbr: the offense ---------------------------------------------------------------------------------
const ui = { team: null, zoneMode: "att", zone: null, lost: { key: null, list: null, feed: null } };

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

  const tile = (label, val, k, lg, title = "") => {
    const tr = k ? teamTier("off", k, O[k], ref.cuts) : "";
    const rk = k && isNum(O[k]) ? teamRank(win.rows, "off", k, abbr) : null;
    const tip = [title, rk ? `${ordinal(rk.rank)} of ${rk.of} clubs` : ""].filter(Boolean).join(" · ");
    return `<div class="an-tile${tr ? " t-" + tr : ""}"${tip ? ` title="${esc(tip)}"` : ""}><span>${label}</span><b>${val}</b>${lg && !String(lg).includes("an-na") ? `<em> · lg ${lg}</em>` : ""}</div>`;
  };
  const tiles = [
    tile("Plays/g", fix(O.playsG, 1), "playsG", fix(L.playsG, 1), "Plays per game: pass attempts, sacks, scrambles and designed runs (no penalties, kneels or spikes)"),
    tile("Pass rate", P(O.passRate), "passRate", P(L.passRate), "Dropbacks / plays (all situations: the ledger carries no score, so no neutral-situation rate)"),
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

  // Week by week over the whole loaded timeline, the window's weeks bright.
  const frow = full.rows.find((r) => r.team === abbr);
  const winKeys = new Set(win.weeks);
  const series = (frow?.series.off || []).map((s) => ({ ...s, inWin: winKeys.has(s.key), opp: s.opp || null }));
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
  const tgtItems = tgts.map((r) => ({ gsis: r.gsis, pos: r.pos, name: displayName(r.gsis, data.players), share: r.tgtShare, tier: r.tier,
    main: P(r.tgtShare), sub: `${r.tgt} tgt${isNum(r.routes) ? ` · ${r.routes} rts` : ""}${isNum(r.snapPct) ? ` · ${Math.round(r.snapPct * 100)}% snaps` : ""}`,
    title: `${displayName(r.gsis, data.players)}: ${r.tgt} targets in ${r.g} game${r.g === 1 ? "" : "s"}, ${isNum(r.tgtShare) ? (r.tgtShare * 100).toFixed(1) + "%" : "–"} of the club's attempts in his games (${isNum(r.clubShare) ? Math.round(r.clubShare * 100) + "%" : "–"} of every club target in the window)${isNum(r.lgShare) ? `; ${r.pos} league average ${(r.lgShare * 100).toFixed(1)}%` : ""}${isNum(r.routes) ? `; ${r.routes} routes (heatradar)` : ""}${isNum(r.snapPct) ? `; ${Math.round(r.snapPct * 100)}% of snaps` : ""}` }));
  const carItems = cars.map((r) => ({ gsis: r.gsis, pos: r.pos, name: displayName(r.gsis, data.players), share: r.rushShare, tier: r.tier,
    main: P(r.rushShare), sub: `${r.car} car · ${fix(r.ypc, 1)} ypc · <span class="${r.epaTier ? "t-" + r.epaTier : ""} an-tm-epa">${signed(r.epaCar, 2)}</span> EPA`,
    title: `${displayName(r.gsis, data.players)}: ${r.car} carries${r.scr ? ` (${r.scr} scrambles)` : ""}, ${r.yds} yards; ${isNum(r.rushShare) ? (r.rushShare * 100).toFixed(1) + "%" : "–"} of the club's designed runs in his games${isNum(r.lgShare) ? `; ${r.pos} league average ${(r.lgShare * 100).toFixed(1)}%` : ""}` }));

  const sub = `${seasonLabel(st)} · ${win.weeks.length ? (win.weeks.length === 1 ? weekLabel(win.weeks[0], st.season) : `${weekLabel(win.weeks[0], st.season)} to ${weekLabel(win.weeks[win.weeks.length - 1], st.season)}`) : "no games"}${st.window === "last3" ? " (each club's last 3 games)" : ""} · ${row?.g ?? 0} game${row?.g === 1 ? "" : "s"} · league reference: ${ref.text}${pnote ? " · " + pnote : ""}`;
  const pill = t ? teamPill(abbr, teams, qs, "an-pl-pill an-tm-headpill") : "";
  const lostKey = [abbr, st.season, st.pi, st.po].join("|");
  const lostHtml = () => (ui.lost.key === lostKey && ui.lost.feed ? lostCardHtml(ui.lost.list, { season: st.season, feedSeason: ui.lost.feed.season, abbr, q: qs, feedPlayers: ui.lost.feed.players }) : "");
  root.innerHTML = `<section class="an-pl an-tm">
    <div class="an-pl-head">
      ${backLink(`#/teams${qs ? "?" + qs : ""}`, "Teams")}${pill}<h1>${esc(t?.name || abbr)}</h1><span class="an-tm-side">Offense</span>
      <div class="an-pl-links"><a href="../#/team/${encodeURIComponent(abbr)}" target="_blank" rel="noopener">Depth chart ↗</a><a href="#/defense?${new URLSearchParams([...new URLSearchParams(qs), ["open", abbr]]).toString()}">Defense →</a></div>
    </div>
    <div class="an-pl-bar"><div class="an-filters"></div></div>
    <div class="an-sub an-pl-sub">${esc(sub)}</div>
    ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    ${row ? "" : `<div class="an-warn">No plays for ${esc(abbr)} in this window.</div>`}
    <div data-lost>${lostHtml()}</div>
    <div class="an-pl-tiles an-tm-tiles">${tiles}</div>
    <div class="an-tm-row">
      <div class="an-card an-tm-weeks"><div class="an-dh">Week by week <span class="an-dsub">click a week to show it alone; click it again for the whole window</span></div><div class="an-pl-scroll">${weekly}</div></div>
      <div class="an-card an-tm-zones"><div class="an-dh">Pass attempts by zone <span class="an-dsub">${zoned} attempts with a depth and direction · each cell vs every attempt in the league</span></div><div data-zones>${zoneHtml()}</div></div>
    </div>
    <div class="an-tm-row">
      <div class="an-card an-tm-distc"><div class="an-dh">Target distribution <span class="an-dsub">target share (his targets / the club's attempts in his games), coloured by his position's tiers</span></div>${distList(tgtItems, qs, { max: 0.3 })}</div>
      <div class="an-card an-tm-distc"><div class="an-dh">Carry distribution <span class="an-dsub">rush share (his designed runs / the club's in his games), coloured by his position's tiers</span></div>${distList(carItems, qs, { max: 0.6 })}</div>
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
    let list = [];
    if (+feed.season === +st.season && Object.values(feed.players || {}).some((e) => e?.team === abbr && isMissing(e))) {
      const d = await loadFor([+feed.season, +feed.season - 1], { window: "season" });
      if (!isCurrent()) return;
      list = absences(d.blocks, d.players, { season: +feed.season, pi: st.pi, po: st.po }, abbr, feed.players);
    }
    ui.lost = { key, list, feed };
    if (box.isConnected) box.innerHTML = draw();
  } catch (e) {
    console.warn("What's been lost: the card could not be built", e);
  }
}

export const ordinal = (n) => { const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"; return `${n}${s}`; };
