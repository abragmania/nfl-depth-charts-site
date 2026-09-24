// The pass-catcher player page, #/player/:gsis (D182: a view built for HIS position). WR, TE and RB (FB too) get
// usage, week by week, target zones, efficiency, blocking (Madden's ratings, the only per-player blocking source,
// D182) and, for backs, rushing; 2025 adds a true route view (nflverse participation labels). QBs and anyone else
// get a "coming next" stub. The filter bar keeps season, Include 2025, window and the PI-targets switch; team,
// opponent and the position chips do not apply to one man and are hidden. Every figure comes from
// agg_player.js (pure); this file only draws and wires clicks.
// Interactivity (D177): a weekly bar sets the window to that week and back; a zone cell lists the plays behind it;
// the header links to his depth-chart card (new tab), his team page and back to Usage.
import { fromQuery, toQuery, seasonsOf, weekLabel } from "../filters.js";
import { loadFor, loadTeams, displayName } from "../data.js";
import { isStatic } from "../../../js/api.js";
import { playerView, maddenBlocking, maddenEdition } from "../agg_player.js";
import { renderFilterBar } from "../filterbar.js";
import { tierOf } from "../table.js";
import { weeklyStrips } from "../charts/bars.js";
import { zoneField, zoneLegend, ZONE_MODES, zoneName } from "../charts/zonefield.js";
import { ratingBars, routeList } from "../charts/hbars.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NA = `<span class="an-na">–</span>`;
const isNum = (v) => v !== null && v !== undefined && Number.isFinite(v);
const pct = (v, d = 1) => (isNum(v) ? (v * 100).toFixed(d) + "%" : NA);
const fix = (v, d) => (isNum(v) ? v.toFixed(d) : NA);
const signed = (v, d) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) : NA);
const int = (v) => (isNum(v) ? String(Math.round(v)) : NA);
const BAND = (pos) => (pos === "RB" || pos === "FB" ? "BACKFIELD" : pos);

// Madden ratings for a season (D182), from the data builder's madden.json. Never fails: absent or unreadable
// resolves to null and the blocking block says so.
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

// Team pill in the club's colours: the same rule as table.js's teamPill (copied: that one is private to the table).
function luminance(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function teamPill(abbr, teams, q) {
  const t = teams.get(abbr);
  const style = t ? ` style="--team-bg:${esc(t.colourPrimary)};--team-ink:${(luminance(t.colourPrimary) ?? 0) > 0.40 ? "#14181d" : "#fff"}"` : "";
  return `<a class="an-teampill an-pl-pill" href="#/team/${esc(abbr)}${q ? "?" + q : ""}"${style} title="Team page">${esc(abbr)}</a>`;
}

const tile = (label, val, { tier = "", lg = null, title = "" } = {}) =>
  `<div class="an-tile${tier ? " t-" + tier : ""}"${title ? ` title="${esc(title)}"` : ""}><span>${label}</span><b>${val}</b>${lg !== null && !String(lg).includes("an-na") ? `<em> · lg ${lg}</em>` : ""}</div>`;

function windowName(st, weeks) {
  if (st.window === "last3") return "Last 3";
  if (st.window === "range" && weeks.length) return weeks.length === 1 ? weekLabel(weeks[0], st.season) : `${weekLabel(weeks[0], st.season)}–${weekLabel(weeks[weeks.length - 1], st.season)}`;
  return st.with2025 ? "25+26" : "Season";
}

// Page-local view state that does not belong in the link: the zone measure and the open zone.
const ui = { gsis: null, zoneMode: "tgt", zone: null };

// D182 (Adam, 2026-09-24): air yards, aDOT and WOPR are not relevant for a running back; his usage strip leads
// with involvement instead. WR and TE keep the full order. Exported (pure, no DOM) so tests can check the
// omission and order directly.
export const RB_USAGE_ORDER = ["snapPct", "routes", "routePct", "tgt", "tgtShare", "tprr", "yprr", "rz", "ez"];
export const CATCHER_USAGE_ORDER = ["tgt", "tgtShare", "ayShare", "wopr", "adot", "rz", "ez", "routes", "routePct", "tprr", "yprr", "snapPct"];
export const usageOrderFor = (pos) => (pos === "RB" ? RB_USAGE_ORDER : CATCHER_USAGE_ORDER);

// Same ruling: the RB week-by-week block drops the air-yards-share bars (his carries and rush share already
// show in the rushing block below); WR and TE keep all three weekly strips.
export const RB_WEEKLY_KEYS = ["v", "snap"];
export const CATCHER_WEEKLY_KEYS = ["v", "ay", "snap"];
export const weeklyKeysFor = (pos) => (pos === "RB" ? RB_WEEKLY_KEYS : CATCHER_WEEKLY_KEYS);

export async function renderPlayer(ctx, params, query) {
  const { root, isCurrent } = ctx;
  const gsis = params.gsis;
  const st = fromQuery(query);
  if (ui.gsis !== gsis) { ui.gsis = gsis; ui.zone = null; }
  const go = (n) => { const q = toQuery({ ...n, open: "" }); location.hash = `#/player/${encodeURIComponent(gsis)}${q ? "?" + q : ""}`; };
  if (!root.querySelector(".an-pl")) root.innerHTML = `<div class="an-msg">Loading player…</div>`;
  let data, teams, madden;
  try {
    // The page draws the whole timeline, so every week of the season(s) is loaded whatever the window.
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
  const v = playerView(data.blocks, data.players, st, gsis);
  const qs = toQuery({ ...st, open: "" });
  const back = `<a href="#/usage${qs ? "?" + qs : ""}">Back to Usage</a>`;
  if (!v) {
    document.title = "Player · NFL Analytics";
    root.innerHTML = `<div class="an-msg"><div class="an-msg-title">No such player</div>No player with id ${esc(gsis)} appears in the ${esc(seasonsOf(st).join(" + "))} analytics files. ${back}</div>`;
    return;
  }
  const name = displayName(gsis, data.players);
  document.title = `${name} · NFL Analytics`;
  const block = maddenBlocking(madden, gsis, v.pos, st.season);
  const head = headerHtml(v, name, block, teams, qs);
  if (v.kind !== "catcher") {
    root.innerHTML = `<section class="an-pl">${head}<div class="an-msg"><div class="an-msg-title">${v.kind === "qb" ? "Quarterback page" : `${esc(v.pos || "This position")} page`}: coming next</div>
      ${v.kind === "qb" ? "EPA per dropback, CPOE, success rate, aDOT, pressure and play-action splits, with the zone chart." : "Blocking-first views for linemen and the rest follow the pass catchers."} ${back}</div></section>`;
    return;
  }

  const wn = windowName(st, v.weeks);
  const L = v.lg.overall;
  const r = v.row || {};
  const activeKey = st.window === "range" && st.from && st.from === st.to ? st.from : null;
  const sub = `${st.season}${st.with2025 ? " + 2025" : ""} · ${v.weeks.length ? (v.weeks.length === 1 ? weekLabel(v.weeks[0], st.season) : `${weekLabel(v.weeks[0], st.season)} to ${weekLabel(v.weeks[v.weeks.length - 1], st.season)}`) : "no games"}${st.window === "last3" ? " (his club's last 3 games)" : ""} · league reference: ${v.pos}s with ${st.minTgt}+ targets in the same window (${v.lg.n})`;

  // 2. Usage strip. RB leads with involvement and drops the air-yards tiles (D182); WR/TE keep the full set.
  const usageTiles = {
    tgt: tile("Targets", int(r.tgt ?? 0), { lg: fix(L.tgt, 1), title: `Targets (${st.pi === false ? "excludes" : "includes"} pass-interference targets)` }),
    tgtShare: tile("Tgt %", pct(r.tgtShare), { tier: tierOf("tgtShare", r.tgtShare), lg: pct(L.tgtShare), title: "His targets / his club's pass attempts in his games" }),
    ayShare: tile("AY %", pct(r.ayShare), { tier: tierOf("ayShare", r.ayShare), lg: pct(L.ayShare), title: "His air yards / his club's air yards in his games" }),
    wopr: tile("WOPR", fix(r.wopr, 2), { tier: tierOf("wopr", r.wopr), lg: fix(L.wopr, 2), title: "1.5 x target share + 0.7 x air-yards share" }),
    adot: tile("aDOT", fix(r.adot, 1), { lg: fix(L.adot, 1), title: "Air yards per target" }),
    rz: tile("RZ tgt", int(r.rz ?? 0), { lg: fix(L.rz, 1), title: "Red-zone targets (inside the 20)" }),
    ez: tile("EZ tgt", int(r.ez ?? 0), { lg: fix(L.ez, 1), title: "End-zone targets" }),
    routes: tile("Routes", int(r.routes), { lg: fix(L.routes, 0), title: "Routes run (heatradar, charted)" }),
    routePct: tile("Rt %", pct(r.routePct, 0), { tier: tierOf("routePct", r.routePct), lg: pct(L.routePct, 0), title: "Routes / club dropbacks" }),
    tprr: tile("TPRR", fix(r.tprr, 2), { tier: tierOf("tprr", r.tprr), lg: fix(L.tprr, 2), title: "Targets per route run" }),
    yprr: tile("YPRR", fix(r.yprr, 2), { tier: tierOf("yprr", r.yprr), lg: fix(L.yprr, 2), title: "Receiving yards per route run" }),
    snapPct: tile("Snap %", pct(r.snapPct, 0), { tier: tierOf("snapPct", r.snapPct), lg: pct(L.snapPct, 0), title: "Share of his club's offensive snaps" }),
  };
  const usage = usageOrderFor(v.pos).map((k) => usageTiles[k]).join("");

  // 3. Week by week. RB drops the air-yards-share strip (D182); his carries and rush share already show below.
  const shareStrip = (k, label, totKey, fixedScale) => {
    const tot = r[totKey], avg = L[totKey];
    const maxV = Math.max(0, ...v.series.map((s) => s[k] ?? 0));
    return { k, label, scale: Math.max(fixedScale, maxV * 1.05), fmt: (x) => `${(x * 100).toFixed(1)}%`, short: (x) => String(Math.round(x * 100)),
      total: tot, totalText: `${wn} ${isNum(tot) ? (tot * 100).toFixed(1) + "%" : "–"}`, avg, avgText: `lg avg ${isNum(avg) ? Math.round(avg * 100) + "%" : "–"}`, tier: (x) => tierOf(totKey, x) };
  };
  const weeklyStripDefs = {
    v: () => shareStrip("v", "Target share", "tgtShare", 0.4),
    ay: () => shareStrip("ay", "Air-yards share", "ayShare", 0.5),
    snap: () => shareStrip("snap", "Snap share", "snapPct", 1),
  };
  const weekly = v.series.length ? weeklyStrips(v.series, weeklyKeysFor(v.pos).map((k) => weeklyStripDefs[k]()), { season: st.season, activeKey }) : `<div class="an-note">No weeks loaded.</div>`;

  // 4. Target zones.
  const zoneHtml = () => `<div class="an-pl-zhead"><div class="an-seg" data-zmode>${ZONE_MODES.map((m) => `<button type="button" data-v="${m.k}" class="${ui.zoneMode === m.k ? "on" : ""}">${m.label}</button>`).join("")}</div>${zoneLegend(ui.zoneMode)}</div>
    <div class="an-pl-zbody">${zoneField(v.zones, ui.zoneMode, { selected: ui.zone })}<div class="an-pl-plays">${playsHtml(v, ui.zone, st)}</div></div>`;

  // 5. Efficiency.
  const E = v.eff, LE = v.lgEff;
  const ngsTile = (k, ...a) => (isNum(E[k]) || isNum(LE[k]) ? tile(...a) : "");
  const eff = [
    tile("EPA/tgt", signed(E.epaTgt, 2), { tier: tierOf("epaTgt", E.epaTgt), lg: signed(LE.epaTgt, 2), title: "Expected points added per target" }),
    tile("Success %", pct(E.succPct, 0), { lg: pct(LE.succPct, 0), title: "Share of his targets that were successful plays (nflverse success)" }),
    tile("Catch %", pct(E.catchPct, 0), { lg: pct(LE.catchPct, 0), title: "Catches / targets (a pass-interference target is neither)" }),
    tile("YAC/rec", fix(E.yacRec, 1), { lg: fix(LE.yacRec, 1), title: "Yards after the catch per reception" }),
    ngsTile("sep", "Separation", fix(E.sep, 1), { lg: fix(LE.sep, 1), title: "NGS: yards from the nearest defender at the catch or incompletion (weeks NGS lists him, weighted by targets)" }),
    ngsTile("cushion", "Cushion", fix(E.cushion, 1), { lg: fix(LE.cushion, 1), title: "NGS: yards off the defender at the snap" }),
    ngsTile("yacOE", "YAC over exp", signed(E.yacOE, 1), { lg: signed(LE.yacOE, 1), title: "NGS: YAC per catch above the tracking model's expectation" }),
  ].join("");

  // 6. Rushing (backs).
  let rushHtml = "";
  if (v.rush) {
    const R = v.rush, RL = R.lg;
    const maxCar = Math.max(1, ...v.series.map((s) => s.car ?? 0));
    const maxSh = Math.max(0.6, ...v.series.map((s) => s.rushShare ?? 0));
    const strips = [
      { k: "car", label: "Carries", scale: maxCar * 1.05, fmt: (x) => `${x} carries`, short: (x) => String(x), total: R.car, totalText: `${wn} ${R.car}`, avg: RL.carG, avgText: `lg avg ${isNum(RL.carG) ? RL.carG.toFixed(1) : "–"}/g` },
      { k: "rushShare", label: "Rush share", scale: maxSh * 1.05, fmt: (x) => `${(x * 100).toFixed(1)}% of club runs`, short: (x) => String(Math.round(x * 100)), total: R.rushShare, totalText: `${wn} ${isNum(R.rushShare) ? (R.rushShare * 100).toFixed(1) + "%" : "–"}`, avg: RL.rushShare, avgText: `lg avg ${isNum(RL.rushShare) ? Math.round(RL.rushShare * 100) + "%" : "–"}` },
    ];
    rushHtml = `<div class="an-card an-pl-rush"><div class="an-dh">Rushing <span class="an-dsub">league reference: ${esc(v.pos)}s with 5+ carries (${R.n})</span></div>
      <div class="an-pl-tiles an-pl-tiles-4">${[
        tile("Carries", int(R.car), { lg: fix(RL.car, 0) }), tile("Yards", int(R.yds)), tile("YPC", fix(R.ypc, 1), { lg: fix(RL.ypc, 1) }),
        tile("Success %", pct(R.succPct, 0), { lg: pct(RL.succPct, 0) }), tile("EPA/carry", signed(R.epaCar, 2), { lg: signed(RL.epaCar, 2) }),
        tile("RYOE/att", signed(R.ryoeAtt, 2), { lg: signed(RL.ryoeAtt, 2), title: "NGS rush yards over expected per carry (weeks NGS lists him)" }),
        tile("RZ carries", int(R.rz)), tile("Rush share", pct(R.rushShare), { lg: pct(RL.rushShare), title: "His carries / his club's designed runs in his games" }),
      ].join("")}</div>
      <div class="an-pl-scroll">${weeklyStrips(v.series, strips, { season: st.season, activeKey, sh: 50 })}</div></div>`;
  }

  // 7. Blocking.
  const blockHtml = `<div class="an-card an-pl-block"><div class="an-dh">Blocking ${block.title ? `<span class="an-dsub">${esc(block.title)}</span>` : ""}</div>
    ${block.status === "absent" ? `<div class="an-note">Madden ratings not on file.</div>`
      : block.status === "unrated" ? `<div class="an-note">No ${esc(maddenEdition(st.season))} rating on file for him.</div>`
      : ratingBars(block.bars, block.pos) + `<div class="an-note">EA's blocking attributes; the tick is the ${esc(block.pos)} median (${block.peers} rated). No free per-player blocking stat exists this season (D182).</div>`}</div>`;

  // 8. Routes (2025).
  const routesHtml = st.with2025 && v.routes && v.routes.length ? `<div class="an-card an-pl-routes" data-band="${BAND(v.pos)}"><div class="an-dh">Routes · 2025 <span class="an-dsub">${v.routes.reduce((s, x) => s + x.n, 0)} targets with a route label (nflverse participation)</span></div>${routeList(v.routes)}</div>` : "";

  root.innerHTML = `<section class="an-pl">
    ${head}
    <div class="an-pl-bar"><div class="an-filters"></div>
      <label class="an-switch" title="A defensive pass interference is a no-play in the play-by-play; on, it counts as a target for the receiver (never a pass attempt, catch or yards)"><input type="checkbox" data-pi${st.pi === false ? "" : " checked"}><span>${st.pi === false ? "excl. PI targets" : "PI targets"}</span></label></div>
    <div class="an-sub an-pl-sub">${esc(sub)}</div>
    ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    <div class="an-pl-tiles an-pl-usage">${usage}</div>
    <div class="an-pl-row">
      <div class="an-card an-pl-weeks"><div class="an-dh">Week by week <span class="an-dsub">click a week to show it alone; click it again for the whole window</span></div><div class="an-pl-scroll">${weekly}</div></div>
      <div class="an-card an-pl-zones"><div class="an-dh">Target zones <span class="an-dsub">${v.zoned} targets with a depth and direction · ${esc(wn)}</span></div><div data-zones>${zoneHtml()}</div></div>
      <div class="an-card an-pl-eff"><div class="an-dh">Efficiency</div><div class="an-pl-tiles an-pl-tiles-4">${eff}</div></div>
      ${rushHtml}
      ${blockHtml}
      ${routesHtml}
    </div>
    <p class="an-foot">Targets, air yards, zones, EPA, success, YAC and carries: nflverse play-by-play. Routes, Rt %, TPRR, YPRR: heatradar.app (charted). Snaps: nflverse snap counts. Separation, cushion, YAC over expected, rush yards over expected: Next Gen Stats. Zone and route references pool every target to his position in the window. Blocking: EA Madden ratings.</p>
  </section>`;

  renderFilterBar(root.querySelector(".an-filters"), st, { keys: data.keys, teams: [] }, go);
  root.querySelector("[data-pi]")?.addEventListener("change", (e) => go({ ...st, pi: e.target.checked }));
  // A weekly column sets the window to that week; the same week again goes back to the whole season.
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
}

function headerHtml(v, name, block, teams, qs) {
  const ovr = block.status === "ok" && isNum(block.ovr) ? `<span class="an-pl-ovr t-${block.ovr >= 90 ? "elite" : block.ovr >= 80 ? "strong" : block.ovr >= 70 ? "avg" : block.ovr >= 60 ? "weak" : "flat"}" title="${esc(block.title)} overall"><b>${block.ovr}</b><small>OVR</small></span>` : "";
  const depth = `../#/team/${encodeURIComponent(v.team)}/player/${encodeURIComponent(v.gsis)}`;
  return `<div class="an-pl-head">
    <h1>${esc(name)}</h1>${v.team ? teamPill(v.team, teams, qs) : ""}<span class="an-pospill" data-band="${BAND(v.pos)}">${esc(v.pos)}</span>${ovr}
    <div class="an-pl-links"><a href="${depth}" target="_blank" rel="noopener">Depth chart ↗</a>${v.team ? `<a href="#/team/${esc(v.team)}${qs ? "?" + qs : ""}">Team page →</a>` : ""}<a href="#/usage${qs ? "?" + qs : ""}">Usage ←</a></div>
  </div>`;
}

const ord = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n === 4 ? "4th" : "");
function playsHtml(v, zone, st) {
  if (!zone) return `<div class="an-note">Click a zone to list the plays behind it.</div>`;
  const plays = v.zones[zone]?.plays || [];
  const rows = plays.map((p) => `<tr class="res-${esc(p.result.toLowerCase())}"><td>${esc(weekLabel(p.key, st.season))}</td><td>${esc(p.opp || "")}</td>`
    + `<td>${p.down ? `${ord(p.down)} &amp; ${p.togo ?? ""}` : ""}${isNum(p.yl) ? ` <small>${p.yl <= 50 ? "opp" : "own"} ${p.yl <= 50 ? p.yl : 100 - p.yl}</small>` : ""}</td>`
    + `<td>${esc(p.result)}</td><td class="num">${p.yards}</td><td class="num">${signed(p.epa, 2)}</td></tr>`).join("");
  return `<div class="an-pl-plhead"><b>${esc(zoneName(zone))}</b> <span>${plays.length} target${plays.length === 1 ? "" : "s"}</span><button type="button" data-close title="Close">×</button></div>
    <div class="an-pl-pltable"><table><thead><tr><th>Wk</th><th>Opp</th><th>Down</th><th>Result</th><th class="num">Yds</th><th class="num">EPA</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
