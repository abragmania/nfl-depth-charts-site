// The quarterback player page, #/player/:gsis when the man is a QB (D182: QBs are their own thing, no blocking;
// main.js routes here). NO QBR (D177). Adam (2026-09-24): passing vs running must be obvious, so Passing is the
// dominant block (about 63% of the width: tiles, week by week, the zone field with its plays, splits) and Rushing is
// its own block beside it, led by three headline figures that light up for runners and sit grey for pocket passers;
// the Madden passing attributes sit under Rushing. Every figure comes from agg_qb.js (pure); this file only draws
// and wires clicks. Interactivity (D177): a weekly column sets the window to that week and back; a zone cell lists
// the plays behind it; the header links to his depth-chart card (new tab), his team page and back to Quarterbacks.
import { fromQuery, seasonsOf, weekLabel } from "../filters.js";
import { loadFor, loadTeams, displayName } from "../data.js";
import { isStatic } from "../../../js/api.js";
import { clubGames } from "../agg.js";
import { aggregateQb, qbReference, qbTier, qbZones, qbSplits, SPLITS, QB_MADDEN_ATTRS } from "../agg_qb.js";
import { median, ratingTier, maddenEdition, iterationLabel } from "../agg_player.js";
import { renderFilterBar } from "../filterbar.js";
import { ratingBars } from "../charts/hbars.js";
import { esc, NA, isNum, pct, fix, signed, int, teamPill, qbStrips, qbZoneField, qbZoneLegend, qbZoneName, QB_ZONE_MODES, rushHeadline, qbQuery, minDbOf, pfrNote } from "./qb.js";

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
function windowName(st, weeks) {
  if (st.window === "last3") return "Last 3";
  if (st.window === "range" && weeks.length) return weeks.length === 1 ? weekLabel(weeks[0], st.season) : `${weekLabel(weeks[0], st.season)}–${weekLabel(weeks[weeks.length - 1], st.season)}`;
  return st.with2025 ? "25+26" : "Season";
}

// Page-local view state that does not belong in the link: the zone measure, the open zone, screens in the splits.
const ui = { gsis: null, zoneMode: "cmpPct", zone: null, noScreens: false };

export async function renderQbPlayer(ctx, params, query) {
  const { root, isCurrent } = ctx;
  const gsis = params.gsis;
  const st = fromQuery(query);
  const minDb = minDbOf(query);
  if (ui.gsis !== gsis) { ui.gsis = gsis; ui.zone = null; }
  const go = (n) => { const q = qbQuery({ ...n, open: "" }, minDb); location.hash = `#/player/${encodeURIComponent(gsis)}${q ? "?" + q : ""}`; };
  if (!root.querySelector(".an-qbp")) root.innerHTML = `<div class="an-msg">Loading quarterback…</div>`;
  let data, teams, madden;
  try {
    [data, teams, madden] = await Promise.all([
      loadFor(seasonsOf(st), { ...st, window: "season" }),
      loadTeams().then((j) => new Map((j.teams || []).map((t) => [t.abbr, t]))).catch(() => new Map()),
      loadMadden(st.season),
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
  const win = aggregateQb(data.blocks, data.players, pst, { playsFor: gsis });
  const full = aggregateQb(data.blocks, data.players, { ...pst, window: "season", from: null, to: null });
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
  const series = (frow?.series || full.weeks.map((key) => ({ key }))).map((s) => {
    const t = meta.teams?.[s.key];
    const g = t ? games.get(`${s.key}|${t}`) : null;
    return { ...s, opp: g?.opp || null, home: g ? g.home : null, inWin: winKeys.has(s.key) };
  });

  const tile = (label, val, k, lg, title = "") => {
    const t = k ? qbTier(k, r?.[k], cuts) : "";
    return `<div class="an-tile${t ? " t-" + t : ""}"${title ? ` title="${esc(title)}"` : ""}><span>${label}</span><b>${val}</b>${lg && !String(lg).includes("an-na") ? `<em> · lg ${lg}</em>` : ""}</div>`;
  };
  const R = r || {};
  const P = (v, d = 1) => (isNum(v) ? pct(v, d) + "%" : NA);
  const tiles = [
    tile("Dropbacks", int(R.db ?? 0), "", fix(L.db, 0), "Pass attempts + sacks + scrambles"),
    tile("Att", int(R.att ?? 0), "", fix(L.att, 0), "Pass attempts"),
    tile("Cmp %", P(R.cmpPct), "cmpPct", P(L.cmpPct), "Completions / attempts"),
    tile("Yds", int(R.yds ?? 0), "", fix(L.yds, 0), "Passing yards"),
    tile("TD", int(R.td ?? 0), "", fix(L.td, 1), "Passing touchdowns"),
    tile("INT", int(R.int ?? 0), "", fix(L.int, 1), "Interceptions"),
    tile("aDOT", fix(R.adot, 1), "", fix(L.adot, 1), "Air yards per attempt"),
    tile("EPA/db", signed(R.epaDb, 2), "epaDb", signed(L.epaDb, 2), "Expected points added per dropback (sacks and scrambles included)"),
    tile("Success %", P(R.succPct, 0), "succPct", P(L.succPct, 0), "Share of his dropbacks that were successful plays"),
    tile("CPOE", signed(R.cpoe, 1), "cpoe", signed(L.cpoe, 1), "Completion % over expected (play-by-play), mean over his attempts"),
    tile("Sack %", P(R.sackPct), "sackPct", P(L.sackPct), "Sacks / dropbacks (lower is better)"),
    tile("Pressure %", P(R.pressPct, 0), "pressPct", P(L.pressPct, 0), `PFR pressures / PFR dropbacks${R.pfrWeeks ? ` over ${R.pfrWeeks} week${R.pfrWeeks === 1 ? "" : "s"}` : ""}${pnote ? ". " + pnote : ""}`),
    tile("PA %", P(R.paPct, 0), "", P(L.paPct, 0), "FTN: share of his dropbacks with play action"),
    tile("TTT", isNum(R.ttt) ? R.ttt.toFixed(2) + "s" : NA, "", isNum(L.ttt) ? L.ttt.toFixed(2) + "s" : "", "NGS: average time to throw"),
    tile("xComp %", P(R.xcomp), "", P(L.xcomp), "NGS: expected completion %"),
  ].join("");

  // Week by week: EPA/db and CPOE with a zero line; aDOT on a baseline.
  const maxAdot = Math.max(12, ...series.map((s) => (isNum(s.adot) ? s.adot : 0)));
  const strips = [
    { k: "epaDb", label: "EPA/dropback", signed: true, span: 0.6, fmt: (v) => signed(v, 2), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: R.epaDb, totalText: `${wn} ${isNum(R.epaDb) ? signed(R.epaDb, 2) : "–"}`, avg: L.epaDb, avgText: `lg ${isNum(L.epaDb) ? signed(L.epaDb, 2) : "–"}`, tier: (v) => qbTier("epaDb", v, cuts) },
    { k: "cpoe", label: "CPOE", signed: true, span: 15, fmt: (v) => signed(v, 1), short: (v) => signed(v, 0), total: R.cpoe, totalText: `${wn} ${isNum(R.cpoe) ? signed(R.cpoe, 1) : "–"}`, avg: L.cpoe, avgText: `lg ${isNum(L.cpoe) ? signed(L.cpoe, 1) : "–"}`, tier: (v) => qbTier("cpoe", v, cuts) },
    { k: "adot", label: "aDOT", signed: false, span: maxAdot * 1.05, fmt: (v) => v.toFixed(1), short: (v) => v.toFixed(1), total: R.adot, totalText: `${wn} ${isNum(R.adot) ? R.adot.toFixed(1) : "–"}`, avg: L.adot, avgText: `lg ${isNum(L.adot) ? L.adot.toFixed(1) : "–"}` },
  ];
  const weekly = series.length ? qbStrips(series, strips, { season: st.season, activeKey, hit: true, big: true, bw: 38, gap: 9, lw: 140, sh: 72 }) : `<div class="an-note">No weeks loaded.</div>`;

  // The zone field (larger), its measure switch and the plays behind a clicked cell.
  const zones = qbZones(r?.zones, win.lgZones);
  const zoned = Object.values(zones).reduce((s, c) => s + c.n, 0);
  const zoneHtml = () => `<div class="an-pl-zhead"><div class="an-seg" data-zmode>${QB_ZONE_MODES.map((m) => `<button type="button" data-v="${m.k}" class="${ui.zoneMode === m.k ? "on" : ""}">${m.label}</button>`).join("")}</div>${qbZoneLegend(ui.zoneMode)}</div>
    <div class="an-pl-zbody">${qbZoneField(zones, ui.zoneMode, { selected: ui.zone })}<div class="an-pl-plays">${playsHtml(zones, ui.zone, st, data.players)}</div></div>`;

  // Rushing: headline figures, the counts, and carries by week.
  const maxCar = Math.max(4, ...series.map((s) => (isNum(s.car) ? s.car : 0)));
  const maxRy = Math.max(20, ...series.map((s) => (isNum(s.ryds) ? s.ryds : 0)));
  const rushStrips = [
    { k: "car", label: "Carries", signed: false, span: maxCar * 1.05, fmt: (v) => `${v} carries`, short: (v) => String(v), total: R.rushAtt, totalText: `${wn} ${R.rushAtt ?? 0}`, avg: L.rushAttG, avgText: `lg ${isNum(L.rushAttG) ? L.rushAttG.toFixed(1) : "–"}/g` },
    { k: "ryds", label: "Rush yards", signed: false, span: maxRy * 1.05, fmt: (v) => `${v} yds`, short: (v) => String(v), total: R.rushYds, totalText: `${wn} ${R.rushYds ?? 0}`, avg: L.rushYdsG, avgText: `lg ${isNum(L.rushYdsG) ? L.rushYdsG.toFixed(0) : "–"}/g` },
  ];
  const rt = (label, val, k, lg, title) => { const t = k ? qbTier(k, R[k], cuts) : ""; return `<div class="an-tile${t ? " t-" + t : ""}" title="${esc(title)}"><span>${label}</span><b>${val}</b>${lg && !String(lg).includes("an-na") ? `<em> · lg ${lg}</em>` : ""}</div>`; };
  const rushHtml = `<div class="an-qb-rush an-qbp-rush"><div class="an-qb-blockh">Rushing <span class="an-dsub">designed runs + scrambles · ${esc(wn)}</span></div>
    ${rushHeadline(R, ref)}
    <div class="an-pl-tiles an-qbp-rtiles">
      ${rt("Carries", int(R.rushAtt ?? 0), "", fix(L.rushAtt, 1), "Designed runs + scrambles")}${rt("Yards", int(R.rushYds ?? 0), "", fix(L.rushYds, 0), "Rushing yards")}
      ${rt("TD", int(R.rushTd ?? 0), "", fix(L.rushTd, 1), "Rushing touchdowns")}${rt("EPA/carry", signed(R.rushEpa, 2), "rushEpa", signed(L.rushEpa, 2), "Expected points added per carry (designed runs and scrambles)")}
      ${rt("Scrambles", `${int(R.scr ?? 0)}<small> · ${int(R.scrYds ?? 0)} yds</small>`, "", fix(L.scr, 1), "Scrambles (dropbacks he ran from) and their yards")}${rt("Designed", `${int(R.des ?? 0)}<small> · ${int(R.desYds ?? 0)} yds</small>`, "", fix(L.des, 1), "Designed runs (kneels included) and their yards")}
    </div>
    <div class="an-pl-scroll">${series.length ? qbStrips(series, rushStrips, { season: st.season, activeKey, hit: true, bw: 34, gap: 7, sh: 40, lw: 108, rw: 62 }) : ""}</div></div>`;

  const maddenHtml = `<div class="an-card an-qbp-madden"><div class="an-dh">Madden · passing ${mq.title ? `<span class="an-dsub">${esc(mq.title)}</span>` : ""}</div>
    ${mq.status === "absent" ? `<div class="an-note">Madden ratings not on file.</div>`
      : mq.status === "unrated" ? `<div class="an-note">No ${esc(maddenEdition(st.season))} rating on file for him.</div>`
      : ratingBars(mq.bars, "QB") + `<div class="an-note">EA's passing attributes; the tick is the QB median (${mq.peers} rated).</div>`}</div>`;

  const sub = `${st.season}${st.with2025 ? " + 2025" : ""} · ${win.weeks.length ? (win.weeks.length === 1 ? weekLabel(win.weeks[0], st.season) : `${weekLabel(win.weeks[0], st.season)} to ${weekLabel(win.weeks[win.weeks.length - 1], st.season)}`) : "no games"}${st.window === "last3" ? " (each club's last 3 games)" : ""} · league reference: ${ref.text}${pnote ? " · " + pnote : ""}`;
  const ovr = isNum(mq.ovr) ? `<span class="an-pl-ovr t-${ratingTier(mq.ovr)}" title="${esc(mq.title)} overall"><b>${mq.ovr}</b><small>OVR</small></span>` : "";
  const depth = `../#/team/${encodeURIComponent(team)}/player/${encodeURIComponent(gsis)}`;

  root.innerHTML = `<section class="an-pl an-qbp">
    <div class="an-pl-head">
      <h1>${esc(name)}</h1>${team ? teamPill(team, teams, qs, "an-pl-pill") : ""}<span class="an-pospill" data-band="QB">QB</span>${ovr}
      <div class="an-pl-links"><a href="${depth}" target="_blank" rel="noopener">Depth chart ↗</a>${team ? `<a href="#/team/${esc(team)}${qs ? "?" + qs : ""}">Team page →</a>` : ""}<a href="#/qb${qs ? "?" + qs : ""}">Quarterbacks ←</a></div>
    </div>
    <div class="an-pl-bar"><div class="an-filters"></div></div>
    <div class="an-sub an-pl-sub">${esc(sub)}</div>
    ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    ${r ? "" : `<div class="an-warn">No dropbacks or carries for him in this window.</div>`}
    <div class="an-qbp-split">
      <div class="an-qb-pass an-qbp-pass">
        <div class="an-qb-blockh">Passing <span class="an-dsub">${R.db ?? 0} dropbacks · ${R.att ?? 0} attempts · ${esc(wn)}</span></div>
        <div class="an-pl-tiles an-qbp-tiles">${tiles}</div>
        <div class="an-qbp-row">
          <div class="an-card an-qbp-weeks"><div class="an-dh">Week by week <span class="an-dsub">click a week to show it alone; click it again for the whole window</span></div><div class="an-pl-scroll">${weekly}</div></div>
          <div class="an-card an-qbp-zones"><div class="an-dh">Attempts by zone <span class="an-dsub">${zoned} attempts with a depth and direction · each cell vs every QB there</span></div><div data-zones>${zoneHtml()}</div></div>
          <div class="an-card an-qbp-splitsc"><div class="an-dh">Splits <span class="an-dsub">his dropbacks vs every QB's, same window</span>
            <label class="an-switch an-qbp-scr" title="Leave FTN-charted screen passes out of every split"><input type="checkbox" data-screens${ui.noScreens ? " checked" : ""}><span>Exclude screens</span></label></div><div data-splits></div></div>
        </div>
      </div>
      <div class="an-qbp-side">${rushHtml}${maddenHtml}</div>
    </div>
    <p class="an-foot">Dropbacks, attempts, completions, yards, TD, INT, aDOT, EPA, success, CPOE, sacks, scrambles, designed runs and zones: nflverse play-by-play. Play action, screens, blitz % and the blitz split: FTN charting. Pressure %: PFR advanced stats (a week behind). Pressured vs clean: the 2025 participation file (per-play pressure; none exists for 2026 yet). Time to throw and expected completion: Next Gen Stats. Passing attributes: EA Madden ratings. Zone references pool every QB attempt in the window. No QBR.</p>
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
      return `<tr class="an-qbp-sgap"><th>Pressured / clean</th><td colspan="6" class="an-note">${st.with2025 ? "No per-play pressure for him in the 2025 weeks of this window." : "Per-play pressure exists only in the 2025 participation file: switch on Include 2025. (PFR gives 2026 weekly totals only: see Pressure %.)"}</td></tr>`;
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
