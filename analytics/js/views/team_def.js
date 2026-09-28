// A club's defense sub-page (#/team/:abbr/defense, D198): as rich as its offense page (team.js) - tiles against the
// league, the D-line block, week by week (allowed), the pass zone field as coverage, who the defense gives its
// targets and carries to, and What's been lost for its defenders. Every figure comes from agg_team.js (pure); this
// file draws and wires clicks, the same convention team.js and defense.js already follow. Loading, the filter bar,
// the win/full aggregation and the header are copied from team.js rather than shared beyond teamSideSeg/teamPageState/
// distList/the zone helpers (team.js's own render loop is entangled with its "lost" module state and its offense-only
// tiles, so pulling more of it out would cost more than the duplication it would save).
import { backLink } from "../router.js";
import { fromQuery, toQuery, seasonsOf, weekLabel } from "../filters.js";
import { loadFor, loadTeams, loadStatusFeed, loadClubCards, displayName } from "../data.js";
import { aggregateTeams, teamReference, teamTier, teamRank, teamZones, defTargets, defCarries, SOFT_KEYS } from "../agg_team.js";
import { gridRows } from "../agg_grid.js";
import { absences, isMissing } from "../agg_absence.js";
import { renderFilterBar } from "../filterbar.js";
import { esc, NA, isNum, pct, fix, signed, int, teamPill, qbStrips, pfrNote, seasonLabel } from "./qb.js";
import { windowName } from "./qbplayer.js";
import { lostCardHtml } from "./lost.js";
import { lineBlock } from "./kit.js";
import { teamPageState, teamSideSeg, clubZoneField, clubZoneLegend, zonePlaysHtml, TEAM_ZONE_MODES, distList, ordinal, clubGridRowHtml, RANKINGS_DEF_KEYS, rankingsHref, gridTileHref } from "./team.js";

const P = (v, d = 1) => (isNum(v) ? pct(v, d) + "%" : NA);

// D198: the D-line block's proxy note. Unlike the O-line block's, the defense's pass-rush and run-stuff figures are
// already team totals (every defender's pressures, hits, hurries and sacks are counted, not attributed to a QB or a
// back), so there is no proxy caveat to print here - only the PFR-lag caption when it applies.

// D198: the by-position share line under a "who they give it to" distribution, e.g. "WR 52% (lg 55) · TE 21% (lg 19)
// · RB 27% (lg 26)" (byPos/lgByPos: agg_team.js defTargets()/defCarries()'s own properties, largest share first).
// PURE.
// D199 review: this builds raw text only - the page wraps the whole line in esc() at render (team_def.js's own
// "by-position share: ${esc(...)}"), so escaping here too was double-escaping. One escape point, at render.
export function byPosLine(byPos, lgByPos) {
  const entries = Object.entries(byPos || {});
  if (!entries.length) return "";
  return entries.map(([pos, v]) => `${pos} ${Math.round(v * 100)}% (lg ${Math.round((lgByPos?.[pos] ?? 0) * 100)})`).join(" · ");
}

// PURE: the twelve headline tiles (all "allowed"), tier-coloured against the league (DEF_TIER, via teamTier/
// teamRank). D/L: the club's and the league's def-side figures (row.def, ref.lg.def); ref: teamReference(); win:
// aggregateTeams()'s window result (teamRank ranks among win.rows); abbr: the club whose rank is looked up; qs: the
// page's current filter query (D206 - a tile links to Rankings sorted by its own column, carrying it).
export function defTilesHtml(D, L, ref, win, abbr, qs = "") {
  // linkKey (D206, defaults to k): aDOT and Blitz % pass k="" to stay uncoloured/unranked (neutral figures), but
  // both still have a Rankings column, so their link needs the real key even though their tier lookup does not.
  const tile = (label, val, k, lg, title = "", linkKey = k) => {
    const tr = k ? teamTier("def", k, D[k], ref.cuts) : "";
    const soft = tr && SOFT_KEYS.includes(k) ? " t-soft" : "";
    const rk = k && isNum(D[k]) ? teamRank(win.rows, "def", k, abbr) : null;
    const tip = [title, rk ? `${ordinal(rk.rank)} of ${rk.of} clubs` : ""].filter(Boolean).join(" · ");
    const body = `<div class="an-tile${tr ? " t-" + tr : ""}${soft}"${tip ? ` title="${esc(tip)}"` : ""}><span>${label}</span><b>${val}</b>${lg && !String(lg).includes("an-na") ? `<em> · lg ${lg}</em>` : ""}</div>`;
    return RANKINGS_DEF_KEYS.has(linkKey) ? `<a class="an-tile-link" href="${rankingsHref("def", linkKey, abbr, qs)}">${body}</a>` : body;
  };
  return [
    tile("Plays/g", fix(D.playsG, 1), "playsG", fix(L.playsG, 1), "Plays faced per game: pass attempts, sacks, scrambles and designed runs"),
    tile("EPA/play", signed(D.epaPlay, 3), "epaPlay", signed(L.epaPlay, 3), "Expected points added per play allowed"),
    tile("EPA/db", signed(D.epaDb, 3), "epaDb", signed(L.epaDb, 3), "EPA per dropback allowed (sacks and scrambles included)"),
    tile("EPA/carry", signed(D.epaCar, 3), "epaCar", signed(L.epaCar, 3), "EPA per designed run allowed"),
    tile("Success %", P(D.succPct, 1), "succPct", P(L.succPct, 1), "Share of plays faced that were successful for the offense (lower is better)"),
    tile("Explosive %", P(D.explPct, 1), "explPct", P(L.explPct, 1), "Runs of 10+ yards and completions of 20+ allowed / plays faced"),
    tile("Comp %", P(D.cmpPct), "cmpPct", P(L.cmpPct), "Completions allowed / attempts"),
    tile("aDOT", fix(D.adot, 1), "", fix(L.adot, 1), "Air yards per attempt faced (neutral: not coloured)", "adot"),
    tile("Sack %", P(D.sackPct), "sackPct", P(L.sackPct), "Sacks / dropbacks faced"),
    tile("Press %", P(D.pressPct), "pressPct", P(L.pressPct), `PFR: the opposing quarterbacks' pressured dropbacks / their dropbacks against this defense${D.pfrWeeks ? ` over ${D.pfrWeeks} week${D.pfrWeeks === 1 ? "" : "s"}` : ""}`),
    tile("Blitz %", P(D.blitzPct, 0), "", P(L.blitzPct, 0), "FTN: dropbacks faced with 1+ blitzers / dropbacks charted", "blitzPct"),
    tile("YPC", fix(D.ypc, 1), "ypc", fix(L.ypc, 1), "Yards per designed run allowed"),
  ].join("");
}

// PURE: the foot links row - the club's Offense page, its row on the Defense rankings table (#/rankings?side=def,
// the old #/defense leaderboard's successor), the Grid, and the depth chart's own defense-context route (main app:
// #/team/:abbr/def, public/js/nav.js's isDefenseContext).
export function defLinksHtml(abbr, qs) {
  const A = encodeURIComponent(abbr), q = qs ? "?" + qs : "";
  return `<div class="an-dlinks"><a href="#/team/${A}${q}">Offense page →</a>` +
    `<a href="#/rankings?${new URLSearchParams([["side", "def"], ...new URLSearchParams(qs), ["open", abbr]]).toString()}">Defense rankings →</a>` +
    `<a href="#/grid${q}">Grid →</a>` +
    `<a href="../#/team/${A}/def">Depth chart →</a></div>`;
}

const ui = { team: null, zoneMode: "cmpPct", zone: null, lost: { key: null, list: null, feed: null, cards: null } };

export async function renderTeamDefense(ctx, params, query) {
  const { root, isCurrent } = ctx;
  const abbr = String(params.abbr || "").toUpperCase();
  const st = fromQuery(query);
  if (ui.team !== abbr) { ui.team = abbr; ui.zone = null; }
  const go = (n) => { const q = toQuery({ ...n, open: "" }); location.hash = `#/team/${encodeURIComponent(abbr)}/defense${q ? "?" + q : ""}`; };
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
  document.title = `${t?.name || abbr} defense · NFL Analytics`;
  const ref = teamReference(win.rows);
  const L = ref.lg.def, D = row?.def || {};
  const wn = windowName(st, win.weeks);
  const pnote = pfrNote(win.pfrThrough, win.latestKey, st.season);
  const activeKey = st.window === "range" && st.from && st.from === st.to ? st.from : null;
  // D205: this club's own Grid row (above the tiles) and the D-line block's headline chips both read the same
  // gridRows() row, so it is computed once, up here.
  // 🔵 fix round: `win` is built from this page's own whole-season load (below, for the week-by-week bars and zone
  // field), not the Grid page's own weeksNeeded()-gated week set (data.js loadFor(seasonsOf(st), st), what
  // views/grid.js itself calls) - with Last 3 and the Playoffs chip both on, those two week sets can differ, so
  // gridRow must come from the Grid's own load, never this page's wider one, or the two disagree. loadFor's own
  // caches (loadSeason's manifest/players, loadWeek's per-file cache) mean this costs no extra network round trip
  // when this page's own load already fetched the whole season, as it does.
  const gridLoad = await loadFor(seasonsOf(st), st);
  if (!isCurrent()) return;
  const gridRow = gridRows(aggregateTeams(gridLoad.blocks, gridLoad.players, pst)).find((r) => r.team === abbr);

  const tiles = defTilesHtml(D, L, ref, win, abbr, qs);

  // D198: the D-line block. Unlike the O-line block's proxy figures, every defender's own pressures, hits, hurries
  // and sacks are counted directly, so there is no proxy caveat - only the PFR-lag caption when PFR lags the window.
  const passRushCell = gridRow?.cells?.passPro?.def || null;
  const runStuffCell = gridRow?.cells?.runBlock?.def || null;
  // D206 fix round: hit/hurry % have no Defense table column (D-line-only figures) - Grid's own Pass rush column
  // instead; stuffed % forced, run-stop % and YBC/carry allowed have no column either - Grid's own Run stuff column.
  const DL_GRID_LINK = { hitPctAllowed: "passProDef", hurryPctAllowed: "passProDef", stuffPct: "runBlockDef", runStopPct: "runBlockDef", ybcCar: "runBlockDef" };
  const dlTile = (label, k, sub, digits = null) => {
    const v = D[k], lgv = L[k];
    const tr = teamTier("def", k, v, ref.cuts);
    const rk = isNum(v) ? teamRank(win.rows, "def", k, abbr) : null;
    const fmt = (x) => (digits === null ? P(x) : fix(x, digits));
    // D199 review: match the headline chips' "12th of 32" wording (no "clubs") rather than the tile's own "22nd of
    // 32 clubs". D206: linked to Rankings when the key has a column there, else to the Grid's own category column -
    // never a dead end.
    return { label, value: isNum(v) ? fmt(v) : NA, lg: isNum(lgv) ? fmt(lgv) : null,
      rank: rk ? ordinal(rk.rank) : null, rankOf: rk ? String(rk.of) : null, sub, tier: tr,
      href: RANKINGS_DEF_KEYS.has(k) ? rankingsHref("def", k, abbr, qs) : DL_GRID_LINK[k] ? gridTileHref(DL_GRID_LINK[k], qs) : null };
  };
  const dlineHtml = lineBlock({
    title: "D-line",
    headline: [
      { label: "Pass rush", rating: passRushCell?.rating ?? null, rank: isNum(passRushCell?.rank) ? ordinal(passRushCell.rank) : null, of: passRushCell ? String(passRushCell.n) : null, title: "Ranks on pressure % (PFR); the grid's own rating (50 = league average)" },
      { label: "Run stuff", rating: runStuffCell?.rating ?? null, rank: isNum(runStuffCell?.rank) ? ordinal(runStuffCell.rank) : null, of: runStuffCell ? String(runStuffCell.n) : null, title: "Ranks on stuffed % forced (play-by-play); the grid's own rating (50 = league average)" },
    ],
    tiles: [
      dlTile("Press %", "pressPct", `${isNum(D.pressuresG) ? D.pressuresG.toFixed(1) : "–"}/g pressures`),
      dlTile("Hit %", "hitPctAllowed", `${isNum(D.hitsG) ? D.hitsG.toFixed(1) : "–"}/g hits`),
      dlTile("Hurry %", "hurryPctAllowed", `${isNum(D.hurriesG) ? D.hurriesG.toFixed(1) : "–"}/g hurries`),
      dlTile("Sack %", "sackPct", `${isNum(D.sacksG) ? D.sacksG.toFixed(1) : "–"}/g sacks`),
      dlTile("Stuffed % forced", "stuffPct", `${D.stuffed ?? 0} stuffed`),
      dlTile("Run-stop %", "runStopPct", ""),
      dlTile("YBC/carry allowed", "ybcCar", `${D.ybcCarries ?? 0} carries`, 2),
    ],
    foot: pnote ? esc(pnote) : "",
  });

  // Week by week over the whole loaded timeline, the window's weeks bright (defense.js's colours: allowed EPA above
  // zero is bad, so an-def-w swaps the up/down fills).
  const frow = full.rows.find((r) => r.team === abbr);
  const winKeys = new Set(win.weeks);
  const series = (frow?.series.def || []).map((s) => ({ ...s, inWin: winKeys.has(s.key), opp: s.opp || null }));
  const maxPlays = Math.max(70, ...series.map((s) => s.plays || 0));
  const strips = [
    { k: "epaPlay", label: "EPA/play allowed", signed: true, span: 0.4, fmt: (v) => signed(v, 3), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: D.epaPlay, totalText: `${wn} ${isNum(D.epaPlay) ? signed(D.epaPlay, 3) : "–"}`, avg: L.epaPlay, avgText: `lg ${isNum(L.epaPlay) ? signed(L.epaPlay, 3) : "–"}`, tier: (v) => teamTier("def", "epaPlay", v, ref.cuts) },
    { k: "epaDb", label: "EPA/dropback allowed", signed: true, span: 0.6, fmt: (v) => signed(v, 3), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: D.epaDb, totalText: `${wn} ${isNum(D.epaDb) ? signed(D.epaDb, 3) : "–"}`, avg: L.epaDb, avgText: `lg ${isNum(L.epaDb) ? signed(L.epaDb, 3) : "–"}`, tier: (v) => teamTier("def", "epaDb", v, ref.cuts) },
    { k: "epaCar", label: "EPA/carry allowed", signed: true, span: 0.6, fmt: (v) => signed(v, 3), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: D.epaCar, totalText: `${wn} ${isNum(D.epaCar) ? signed(D.epaCar, 3) : "–"}`, avg: L.epaCar, avgText: `lg ${isNum(L.epaCar) ? signed(L.epaCar, 3) : "–"}`, tier: (v) => teamTier("def", "epaCar", v, ref.cuts) },
    { k: "db", label: "Dropbacks faced", signed: false, span: maxPlays * 1.05, fmt: (v) => `${v} dropbacks`, short: (v) => String(v), total: D.db, totalText: `${wn} ${D.db}`, avg: L.dbG, avgText: `lg ${isNum(L.dbG) ? L.dbG.toFixed(1) : "–"}/g` },
    { k: "runs", label: "Runs faced", signed: false, span: maxPlays * 1.05, fmt: (v) => `${v} runs`, short: (v) => String(v), total: D.runs, totalText: `${wn} ${D.runs}`, avg: L.runsG, avgText: `lg ${isNum(L.runsG) ? L.runsG.toFixed(1) : "–"}/g` },
  ];
  const weekly = series.length ? qbStrips(series, strips, { season: st.season, activeKey, hit: true, big: true, bw: 38, gap: 9, lw: 140, sh: 64 }) : `<div class="an-note">No weeks loaded.</div>`;

  // Coverage: the zone field FACED (what opponents complete, gain and add there vs the league), the colour-swap
  // wrapper defense.js uses (.an-zf-inv: a cell above the league there is bad for the defense), beside the coverage
  // tiles (covRating, covYdsTgt, covCmpPct, covTgt).
  const zones = teamZones(D, win.lgZones);
  const zoned = Object.values(zones).reduce((s, c) => s + c.n, 0);
  const covTile = (label, val, k, lg, title = "") => {
    const tr = k ? teamTier("def", k, D[k], ref.cuts) : "";
    const body = `<div class="an-tile${tr ? " t-" + tr : ""}"${title ? ` title="${esc(title)}"` : ""}><span>${label}</span><b>${val}</b>${lg && !String(lg).includes("an-na") ? `<em> · lg ${lg}</em>` : ""}</div>`;
    // D206 fix round: none of the coverage figures has a Rankings column, so every coverage tile - including
    // Targets covered, a count rather than a rate - links to the Grid's own Coverage column instead. Never a dead end.
    return `<a class="an-tile-link" href="${gridTileHref("coverageDef", qs)}">${body}</a>`;
  };
  // The coverage tiles sit beside the zone field, inside the same card (Adam's D198 ask: "beside"), as a 2x2 grid
  // (D199 review: the old far-edge column made the card wider than the offense page's zone card and pushed it out
  // of the "Week by week" row at 1536px). The throws list drops into the same column, under the tiles, when a zone
  // is clicked - see .an-tm-covwrap in analytics.css.
  const covTiles = `<div class="an-tm-covtiles">${[
    covTile("Rating allowed", fix(D.covRating, 1), "covRating", fix(L.covRating, 1), "PFR coverage charting: the NFL passer rating on throws at this club's cornerbacks and safeties"),
    covTile("Yds/target", fix(D.covYdsTgt, 1), "covYdsTgt", fix(L.covYdsTgt, 1), "PFR coverage charting: yards allowed per covered target"),
    covTile("Cmp % allowed", P(D.covCmpPct), "covCmpPct", P(L.covCmpPct), "PFR coverage charting: completions / covered targets"),
    covTile("Targets covered", int(D.covTgt), "", int(L.covTgt), "PFR coverage charting: covered targets in the window"),
  ].join("")}</div>`;
  const zoneHtml = () => `<div class="an-pl-zhead"><div class="an-seg" data-zmode>${TEAM_ZONE_MODES.map((m) => `<button type="button" data-v="${m.k}" class="${ui.zoneMode === m.k ? "on" : ""}">${m.label}</button>`).join("")}</div>${clubZoneLegend(ui.zoneMode, "def")}</div>
    <div class="an-pl-zbody an-zf-inv">${clubZoneField(zones, ui.zoneMode, { selected: ui.zone }, "def")}<div class="an-tm-covwrap">${covTiles}<div class="an-pl-plays">${zonePlaysHtml(zones, ui.zone, st, data.players, qs, "def")}</div></div></div>`;

  // "Who they give it to": the men this defense has faced (agg_team.js defTargets/defCarries), top 12/8 by volume,
  // with the by-position share line read off the arrays' own byPos/lgByPos properties BEFORE slicing them away.
  const tgtsAll = defTargets(data.blocks, data.players, pst, abbr);
  const tgtByPos = byPosLine(tgtsAll.byPos, tgtsAll.lgByPos);
  const tgts = tgtsAll.slice(0, 12);
  const carsAll = defCarries(data.blocks, data.players, pst, abbr);
  const carByPos = byPosLine(carsAll.byPos, carsAll.lgByPos);
  const cars = carsAll.slice(0, 8);
  const tgtItems = tgts.map((r) => ({ gsis: r.gsis, pos: r.pos, name: displayName(r.gsis, data.players), share: r.tgtShare, tier: r.tier,
    main: P(r.tgtShare), sub: `${r.tgt} tgt${isNum(r.routes) ? ` · ${r.routes} rts` : ""}${isNum(r.snapPct) ? ` · ${Math.round(r.snapPct * 100)}% snaps` : ""}`,
    title: `${displayName(r.gsis, data.players)}: ${r.tgt} targets in ${r.g} game${r.g === 1 ? "" : "s"} against ${abbr}, ${isNum(r.tgtShare) ? (r.tgtShare * 100).toFixed(1) + "%" : "–"} of his own club's attempts in those games (${isNum(r.clubShare) ? Math.round(r.clubShare * 100) + "%" : "–"} of every target this defense faced)${isNum(r.lgShare) ? `; ${r.pos} league average ${(r.lgShare * 100).toFixed(1)}%` : ""}` }));
  const carItems = cars.map((r) => ({ gsis: r.gsis, pos: r.pos, name: displayName(r.gsis, data.players), share: r.rushShare, tier: r.tier,
    main: P(r.rushShare), sub: `${r.car} car · ${fix(r.ypc, 1)} ypc · <span class="${r.epaTier ? "t-" + r.epaTier : ""} an-tm-epa">${signed(r.epaCar, 2)}</span> EPA`,
    title: `${displayName(r.gsis, data.players)}: ${r.car} carries${r.scr ? ` (${r.scr} scrambles)` : ""}, ${r.yds} yards against ${abbr}; ${isNum(r.rushShare) ? (r.rushShare * 100).toFixed(1) + "%" : "–"} of his own club's designed runs in those games${isNum(r.lgShare) ? `; ${r.pos} league average ${(r.lgShare * 100).toFixed(1)}%` : ""}` }));

  const sub = `${seasonLabel(st)} · ${win.weeks.length ? (win.weeks.length === 1 ? weekLabel(win.weeks[0], st.season) : `${weekLabel(win.weeks[0], st.season)} to ${weekLabel(win.weeks[win.weeks.length - 1], st.season)}`) : "no games"}${st.window === "last3" ? " (each club's last 3 games)" : ""} · ${row?.g ?? 0} game${row?.g === 1 ? "" : "s"} · league reference: ${ref.text}${pnote ? " · " + pnote : ""}`;
  const pill = t ? teamPill(abbr, teams, qs, "an-pl-pill an-tm-headpill") : "";
  const lostKey = [abbr, st.season, st.pi, st.po].join("|");
  const lostHtml = () => (ui.lost.key === lostKey && ui.lost.feed ? lostCardHtml(ui.lost.list, { season: st.season, feedSeason: ui.lost.feed.season, abbr, q: qs, feedPlayers: ui.lost.feed.players, cards: ui.lost.cards, side: "def" }) : "");
  root.innerHTML = `<section class="an-pl an-tm">
    <div class="an-pl-head">
      ${backLink(`#/teams${qs ? "?" + qs : ""}`, "Teams")}${pill}<h1>${esc(t?.name || abbr)}</h1>${teamSideSeg(abbr, qs, "def")}
      <div class="an-pl-links"><a href="../#/team/${encodeURIComponent(abbr)}/def">Depth chart →</a></div>
    </div>
    <div class="an-pl-bar"><div class="an-filters"></div></div>
    <div class="an-sub an-pl-sub">${esc(sub)}</div>
    ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    ${row ? "" : `<div class="an-warn">No plays faced by ${esc(abbr)} in this window.</div>`}
    ${clubGridRowHtml(gridRow, "def")}
    <div data-lost>${lostHtml()}</div>
    <div class="an-pl-tiles an-tm-tiles">${tiles}</div>
    ${dlineHtml}
    <div class="an-tm-row">
      <div class="an-card an-tm-weeks an-def-w"><div class="an-dh">Week by week <span class="an-dsub">click a week to show it alone; click it again for the whole window</span></div><div class="an-pl-scroll">${weekly}</div></div>
      <div class="an-card an-tm-zones"><div class="an-dh">Coverage <span class="an-dsub">${zoned} attempts with a depth and direction · each cell vs every attempt in the league; tiles: PFR coverage charting, the club's cornerbacks and safeties</span></div><div data-zones>${zoneHtml()}</div></div>
    </div>
    <div class="an-tm-row">
      <div class="an-card an-tm-distc"><div class="an-dh">Who they give it to: targets <span class="an-dsub">by-position share: ${esc(tgtByPos || "no targets faced")}</span></div>${distList(tgtItems, qs, { max: 0.3 })}</div>
      <div class="an-card an-tm-distc"><div class="an-dh">Who they give it to: carries <span class="an-dsub">by-position share: ${esc(carByPos || "no carries faced")}</span></div>${distList(carItems, qs, { max: 0.6 })}</div>
    </div>
    ${defLinksHtml(abbr, qs)}
    <p class="an-foot">Plays, EPA, success, aDOT, completions, sacks, explosive plays and zones: nflverse play-by-play. Blitz: FTN charting. Pressure, hits, hurries, coverage and yards before contact: PFR advanced stats, about a week behind the games. Routes: heatradar.app (charted). League reference: the plain mean over every club in the window; colours are the clubs' tiers.</p>
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

// The same fetch team.js's fillLost runs (the injury feed plus both seasons' blocks, cached per club/season/PI/
// playoff switches so a window or week change never blanks the card); duplicated rather than imported because it
// closes over this file's own `ui` module state, not team.js's.
async function fillLost(box, abbr, st, key, isCurrent, draw) {
  if (!box) return;
  try {
    const feed = await loadStatusFeed();
    if (!isCurrent() || feed.season == null) return;
    let list = [], cards = null;
    if (+feed.season === +st.season && Object.values(feed.players || {}).some((e) => e?.team === abbr && isMissing(e))) {
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
