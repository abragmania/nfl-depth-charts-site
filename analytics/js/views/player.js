// The running-back and receiver player page, #/player/:gsis (D182: a view built for HIS position; D193 re-cut,
// increment 7a). RB and FB read as a back, WR and TE as a receiver; both draw the kit's five layers
// (views/kit.js): (1) a HEADLINE row, each tile with its league figure, his rank in his position's reference pool
// and its tier colour; (2) the FANTASY band - DraftKings points per week with two share lines, a vertical game log
// (one row per game, season totals, a grand total when the window spans two seasons) and the Opportunity tiles;
// (3) a RUSHING (gold) and a RECEIVING (purple) block side by side, the existing week-by-week strips, target zones
// and plays table inside them; (4) a VARIANCE strip, his rate beside the league's; (5) the Madden blocking foot.
// QBs and anyone else get a "coming next" stub. The filter bar keeps season, Include previous, window and the
// PI-targets switch; team, opponent and the position chips do not apply to one man and are hidden. Every figure
// comes from agg_player.js (pure: playerView and its `recut` layers); this file only picks, formats, draws and
// wires clicks.
// Interactivity (D177): a weekly bar (the fantasy chart's too) sets the window to that week and back; a zone cell
// lists the plays behind it; the header has a Back button (router.js backLink: the page he came from, else his
// position's section, D188) and links to his depth-chart card (new tab) and his team page.
import { fromQuery, toQuery, seasonsOf, weekLabel, splitKey } from "../filters.js";
import { backLink } from "../router.js";
import { loadFor, loadTeams, displayName } from "../data.js";
import { isStatic } from "../../../js/api.js";
import { playerView, maddenBlocking, maddenEdition } from "../agg_player.js";
import { renderFilterBar } from "../filterbar.js";
import { tierOf } from "../table.js";
import { tierNote } from "../agg.js";
import { rushTier } from "../agg_rush.js";
import { weeklyStrips } from "../charts/bars.js";
import { zoneField, zoneLegend, ZONE_MODES, zoneName } from "../charts/zonefield.js";
import { ratingBars, routeList } from "../charts/hbars.js";
import { headlineRow, fantasyBand, phaseBlock, varianceStrip, maddenFoot, playerHead } from "./kit.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NA = `<span class="an-na">–</span>`;
const isNum = (v) => v !== null && v !== undefined && Number.isFinite(v);
const signed = (v, d) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) : NA);
const BAND = (pos) => (pos === "RB" || pos === "FB" ? "BACKFIELD" : pos);
// Plain-text formatters for the kit (it escapes everything it is given, so no HTML here): a missing figure is "–".
const DASH = "–";
const tInt = (v) => (isNum(v) ? String(Math.round(v)) : DASH);
const tFix = (v, d) => (isNum(v) ? v.toFixed(d) : DASH);
const tPct = (v, d = 1) => (isNum(v) ? (v * 100).toFixed(d) + "%" : DASH);
const tSigned = (v, d) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) : DASH);
const ratio = (a, b) => (b > 0 ? a / b : null);
const isBackPos = (pos) => pos === "RB" || pos === "FB";

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

export function windowName(st, weeks) {
  if (st.window === "last3") return "Last 3";
  if (st.window === "range" && weeks.length) return weeks.length === 1 ? weekLabel(weeks[0], st.season) : `${weekLabel(weeks[0], st.season)}–${weekLabel(weeks[weeks.length - 1], st.season)}`;
  return st.with2025 ? `${String(st.season - 1).slice(-2)}+${String(st.season).slice(-2)}` : "Season";
}

// The "picked season[ + previous season]" prefix that opens every sub-header (D184: derived from st.season, not
// hard-coded to any real year, so a historical pick like 2023 reads "2023 + 2022").
export function seasonLabel(st) {
  return `${st.season}${st.with2025 ? " + " + (st.season - 1) : ""}`;
}

// D188 cold open (no page to go back to): his position's section. D193 renamed Usage to Receivers and Rushing to
// Running backs; the old #/usage and #/rushing routes still work, only the wording and target moved.
export function backFallback(pos) {
  const p = String(pos || "").toUpperCase();
  if (isBackPos(p)) return { href: "#/rbs", name: "Running backs" };
  if (p === "QB") return { href: "#/qb", name: "Quarterbacks" };
  return { href: "#/receivers", name: "Receivers" };
}

// Page-local view state that does not belong in the link: the zone measure and the open zone.
// pastOpen: the game log's previous-season weeks unfolded (👁 fix round; folded to its totals row by default).
// layout: the measured fits (fantasy chart width, log beside or under it, the strips' widths), keyed by the page's
// link and width so a redraw (a zone click, the log toggle) lands right first time.
const ui = { gsis: null, zoneMode: "tgt", zone: null, pastOpen: false, layout: null };

// D182 (Adam, 2026-09-24): the RB week-by-week block drops the air-yards-share strip (his carries and rush share
// show in the rushing block); WR and TE keep all three weekly strips. They now sit in the receiving block's body.
export const RB_WEEKLY_KEYS = ["v", "snap"];
export const CATCHER_WEEKLY_KEYS = ["v", "ay", "snap"];
export const weeklyKeysFor = (pos) => (pos === "RB" ? RB_WEEKLY_KEYS : CATCHER_WEEKLY_KEYS);
// D191: a back's rushing block keeps its Carries, Opportunities and Rush share strips (now in the block's body).
export const RB_RUSH_STRIP_KEYS = ["car", "oppN", "rushShare"];

// ---- the re-cut's tile and column orders (D193, PROJECT.md Part 4 A; exported so tests pin them) ----------------
// D193: no fantasy tile in the headline (DK lives in the fantasy band's header). D182 still holds: a back's tiles
// carry no AY %, WOPR or aDOT.
export const RB_HEADLINE_ORDER = ["scrimYds", "totTd", "ydsOpp", "epaOpp", "ypc"];
export const REC_HEADLINE_ORDER = ["rec", "yds", "td", "yprr", "epaTgt"];
export const RB_OPP_ORDER = ["oppG", "oppShare", "car", "tgt", "rzOpp", "snapPct"];
export const REC_OPP_ORDER = ["tgtG", "tgtShare", "ayShare", "wopr", "rz", "routePct"];
// The game log (one row per game, D193 fourth draft). The back's opponent column reads "vs" so it never shares a
// header with Opp (opportunities, D191's name for targets + carries on every table).
export const RB_LOG_COLUMNS = [
  ["wk", "Wk"], ["vs", "vs"], ["snap", "Snap %"], ["oppN", "Opp"], ["car", "Car"], ["rushYds", "Rush yds"], ["rushTd", "Rush TD"],
  ["tgt", "Tgt"], ["rec", "Rec"], ["recYds", "Rec yds"], ["recTd", "Rec TD"], ["tgtPct", "Tgt %"], ["dk", "DK"],
];
export const REC_LOG_COLUMNS = [
  ["wk", "Wk"], ["vs", "Opp"], ["snap", "Snap %"], ["routes", "Routes"], ["tgt", "Tgt"], ["tgtPct", "Tgt %"], ["ayPct", "AY %"],
  ["rec", "Rec"], ["recYds", "Yds"], ["recTd", "TD"], ["yprr", "YPRR"], ["dk", "DK"],
];
export const logColumnsFor = (kind) => (kind === "back" ? RB_LOG_COLUMNS : REC_LOG_COLUMNS);
// Heat tint per column (D193 fourth draft: the opportunity, share and DK cells), against his position pool's per-game
// or share cuts (recut.cuts). None of these is lower-is-better.
const LOG_HEAT = { back: { snap: "snapPct", oppN: "oppG", car: "carG", tgtPct: "tgtShare", dk: "dkG" }, receiver: { snap: "snapPct", tgtPct: "tgtShare", ayPct: "ayShare", dk: "dkG" } };
// The two share lines on the chart, and which log column matches each line's colour.
export const SHARE_LINES = { back: ["Opp share", "Target share"], receiver: ["Target share", "Air-yards share"] };
const LOG_KIND = { back: { tgtPct: "share2", dk: "dk" }, receiver: { tgtPct: "share1", ayPct: "share2", dk: "dk" } };
// Phase blocks: front tiles, then the side column.
// YPC is in the headline, so the rushing front does not repeat it.
export const RB_RUSH_FRONT = ["yds", "td", "epaCar", "ryoeAtt"];
export const RB_RUSH_SIDE = ["succPct", "explPct", "long", "eff", "rz"];
export const RB_REC_FRONT = ["rec", "yds", "yprr", "epaTgt"];
export const RB_REC_SIDE = ["catchPct", "yacRec", "yacOE", "tprr", "routes", "ez", "td", "succPct", "rz", "sep", "cushion"];
export const REC_REC_FRONT = ["catchPct", "ydsTgt", "yacRec", "succPct"];
export const REC_REC_SIDE = ["sep", "cushion", "routes", "ay", "opp", "oppG", "oppShare", "ydsOpp", "epaOpp"];
export const REC_RUSH_FRONT = ["car", "yds", "td"];
export const REC_RUSH_SIDE = ["ypc", "epaCar"];
export const RB_VARIANCE_ORDER = ["rzOppTdRate", "in10TdRate", "yds20Share", "ybcCar", "flRate", "dkTdShare"];
export const REC_VARIANCE_ORDER = ["tdTgt", "rzTdRate", "cpoeTgt", "yacOE", "dropPer100", "flRate", "dkTdShare"];

// ---- pure helpers (no DOM; tested) ------------------------------------------------------------------------------
export const ordinal = (n) => {
  const m100 = n % 100, m10 = n % 10;
  return n + (m100 >= 11 && m100 <= 13 ? "th" : m10 === 1 ? "st" : m10 === 2 ? "nd" : m10 === 3 ? "rd" : "th");
};
// His competition rank (1, 2, 2, 4) on `key` inside his position's reference pool (recut.pool), higher first,
// compared at the displayed precision (`digits`) so men who print the same figure share a rank. `n` counts only the
// pool rows with a real figure for that key. rank is null with a reason: "outside" (he is not in the pool, under
// its 2-a-game floor) or "nofig" (in the pool, no figure for this key).
export function rankIn(pool, key, gsis, digits = 2) {
  const round = (x) => Math.round(x * 10 ** digits) / 10 ** digits;
  const have = (pool || []).filter((r) => isNum(r[key]));
  const me = (pool || []).find((r) => r.gsis === gsis);
  if (!me) return { rank: null, n: have.length, reason: "outside" };
  if (!isNum(me[key])) return { rank: null, n: have.length, reason: "nofig" };
  const v = round(me[key]);
  return { rank: 1 + have.filter((r) => round(r[key]) > v).length, n: have.length, reason: null };
}
// "4th" and "68 RBs", or "50 WRs with a figure" when some of the pool have none for that key.
export function rankText(rk, pos, poolN) {
  if (!rk?.rank) return { rank: null, rankOf: null };
  return { rank: ordinal(rk.rank), rankOf: `${rk.n} ${pos}s${rk.n < poolN ? " with a figure" : ""}` };
}
const UNRANKED = { outside: "unranked: he is outside the pool (under its 2-a-game floor)", nofig: "unranked: he is in the pool but has no figure for this" };

// The game log's and chart's rows, from the row's own series weeks inside the window (never from fantasy.games:
// a week whose only play was a lost fumble costs him the point but is not one of his games, 🔵 on increment 3).
// A club bye reads BYE, a club game he did not play reads DNP. DK per game from fantasy.games matched on the week
// (0 when he played and scored nothing). Two seasons in the window: a season header, the season's rows and a
// season total each, then a grand total; one season: the rows and one total. Season DK totals sum every scoring
// game of that season and the grand total is the window's dk, so the log's totals always match the header's.
export function gameLogRows(v, st, kind = v?.recut?.kind) {
  const R = v.recut || {};
  const cols = logColumnsFor(kind);
  const heatKeys = LOG_HEAT[kind] || {};
  const games = new Map((R.fantasy?.games || []).map((g) => [String(g.gk).split("|")[0], g]));
  // His own window: a week his club played outside it (Last 3 across clubs with different byes) is left out; a bye
  // week inside the league's window stays.
  const weeks = (v.series || []).filter((s) => s.inWin && s.inMyWin !== false);
  const seasons = [...new Set(weeks.map((s) => splitKey(s.key).season))];
  const multi = seasons.length > 1;
  const out = [];
  const weekRow = (s) => {
    const season = splitKey(s.key).season;
    const wk = weekLabel(s.key, st.season);
    const played = !s.dnp && (s.v !== null || s.snap !== null || (s.car !== null && s.car !== undefined));
    const note = s.dnp ? "dnp" : played ? null : "bye";
    const g = games.get(s.key);
    const line = g?.line || {};
    const pts = played ? g?.pts ?? 0 : null;
    const oppShare = played ? ratio((s.tgt || 0) + (s.car || 0), (s.att || 0) + (s.runs || 0)) : null;
    const f = {
      wk, vs: s.opp ? (s.home === false ? "@" : "") + s.opp : "", snap: s.snap, oppN: s.oppN, car: s.car, rushYds: line.rushYds ?? 0, rushTd: line.rushTd ?? 0,
      tgt: s.tgt ?? 0, rec: line.rec ?? 0, recYds: line.recYds ?? 0, recTd: line.recTd ?? 0, tgtPct: s.v, ayPct: s.ay, routes: s.routes,
      yprr: isNum(s.routes) && s.routes > 0 ? (line.recYds ?? 0) / s.routes : null, dk: pts,
    };
    const heat = {};
    for (const c of Object.keys(heatKeys)) if (isNum(f[c])) heat[c] = f[c];
    return { type: "week", key: s.key, wk, opp: f.vs, season, pts, note, shares: kind === "back" ? [oppShare, s.v] : [s.v, s.ay],
      cells: cols.map(([k]) => fmtLog(k, f[k])), heat, _f: f, _played: played };
  };
  // Totals: counts summed; Snap % the mean over the games he played (the app's snap rule); Tgt % total over total
  // (D181); AY % his air yards (the week's share x the club's air) over the club's air, likewise; YPRR = yards in
  // charted weeks / routes.
  const totalRow = (label, list, dk) => {
    const P = list.filter((r) => r._played);
    const sum = (k) => P.reduce((s, r) => s + (isNum(r._f[k]) ? r._f[k] : 0), 0);
    const snaps = P.map((r) => r._f.snap).filter(isNum);
    const wOf = (r) => weeks.find((w) => w.key === r.key) || {};
    const att = P.reduce((s, r) => s + (wOf(r).att || 0), 0);
    const clubAy = P.reduce((s, r) => s + (wOf(r).clubAy || 0), 0);
    const myAy = P.reduce((s, r) => s + (isNum(wOf(r).ay) ? wOf(r).ay * (wOf(r).clubAy || 0) : 0), 0);
    const charted = P.filter((r) => isNum(r._f.routes));
    const routes = charted.reduce((s, r) => s + r._f.routes, 0);
    const f = {
      wk: label, vs: `${P.length} g`, snap: snaps.length ? snaps.reduce((a, b) => a + b, 0) / snaps.length : null, oppN: sum("oppN"), car: sum("car"),
      rushYds: sum("rushYds"), rushTd: sum("rushTd"), tgt: sum("tgt"), rec: sum("rec"), recYds: sum("recYds"), recTd: sum("recTd"),
      tgtPct: ratio(sum("tgt"), att), ayPct: ratio(myAy, clubAy), routes: charted.length ? routes : null,
      yprr: routes > 0 ? charted.reduce((s, r) => s + (r._f.recYds || 0), 0) / routes : null, dk,
    };
    return { type: "total", cells: cols.map(([k]) => fmtLog(k, f[k])) };
  };
  const dkSeason = (season) => (R.fantasy?.games || []).filter((g) => splitKey(String(g.gk).split("|")[0]).season === season).reduce((s, g) => s + (g.pts || 0), 0);
  const all = [];
  for (const season of seasons) {
    const list = weeks.filter((s) => splitKey(s.key).season === season).map(weekRow);
    if (multi) out.push({ type: "season", label: String(season) });
    out.push(...list);
    all.push(...list);
    if (multi) out.push(totalRow(`${season}`, list, dkSeason(season)));
  }
  if (all.length) out.push(totalRow("Total", all, R.fantasy?.dk ?? all.reduce((s, r) => s + (r.pts || 0), 0)));
  // The private working fields stay off what the kit sees.
  return out.map((r) => { if (r.type !== "week") return r; const { _f, _played, ...rest } = r; return rest; });
}
function fmtLog(k, x) {
  if (k === "wk" || k === "vs") return x ?? "";
  if (k === "snap" || k === "tgtPct" || k === "ayPct") return isNum(x) ? Math.round(x * 100) + "%" : DASH;
  if (k === "yprr") return tFix(x, 2);
  if (k === "dk") return tFix(x, 1);
  return tInt(x);
}
export function logColumns(kind, cuts) {
  const heat = LOG_HEAT[kind] || {}, kinds = LOG_KIND[kind] || {};
  return logColumnsFor(kind).map(([key, label], i) => ({ key, label, align: i < 2 ? "left" : "right", kind: kinds[key], cuts: heat[key] ? cuts?.[heat[key]]?.cuts || null : null }));
}

// ---- the page ------------------------------------------------------------------------------------------------
export async function renderPlayer(ctx, params, query) {
  const { root, isCurrent } = ctx;
  const gsis = params.gsis;
  const st = fromQuery(query);
  if (ui.gsis !== gsis) { ui.gsis = gsis; ui.zone = null; ui.pastOpen = false; }
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
  if (!v) {
    const fb = backFallback("");
    document.title = "Player · NFL Analytics";
    root.innerHTML = `<div class="an-msg"><div class="an-msg-title">No such player</div>No player with id ${esc(gsis)} appears in the ${esc(seasonsOf(st).join(" + "))} analytics files. <a href="${fb.href}${qs ? "?" + qs : ""}">Back to ${fb.name}</a></div>`;
    return;
  }
  const name = displayName(gsis, data.players);
  document.title = `${name} · NFL Analytics`;
  const block = maddenBlocking(madden, gsis, v.pos, st.season);
  const head = headerHtml(v, name, block, teams, qs);
  if (v.kind !== "catcher") {
    const fb = backFallback(v.pos);
    const back = `<a href="${fb.href}${qs ? "?" + qs : ""}">Back to ${fb.name}</a>`;
    root.innerHTML = `<section class="an-pl">${head}<div class="an-msg"><div class="an-msg-title">${v.kind === "qb" ? "Quarterback page" : `${esc(v.pos || "This position")} page`}: coming next</div>
      ${v.kind === "qb" ? "EPA per dropback, CPOE, success rate, aDOT, pressure and play-action splits, with the zone chart." : "Blocking-first views for linemen and the rest follow the pass catchers."} ${back}</div></section>`;
    return;
  }

  const wn = windowName(st, v.weeks);
  const activeKey = st.window === "range" && st.from && st.from === st.to ? st.from : null;
  const sub = `${seasonLabel(st)} · ${v.weeks.length ? (v.weeks.length === 1 ? weekLabel(v.weeks[0], st.season) : `${weekLabel(v.weeks[0], st.season)} to ${weekLabel(v.weeks[v.weeks.length - 1], st.season)}`) : "no games"}${st.window === "last3" ? " (his club's last 3 games)" : ""} · league reference: ${v.recut.opportunityRefText}`;
  // The band's chart fits the page column (the kit caps each week's column, so it never stretches): the root's
  // content width (its gutters taken off, capped at the D190 column) less the band's own padding and border.
  const cs = typeof getComputedStyle === "function" ? getComputedStyle(root) : null;
  const gutters = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
  const bandW = Math.max(600, Math.min((root.clientWidth || 1400) - gutters, 1760) - 32);
  const layoutKey = `${gsis}|${toQuery({ ...st, open: "" })}|${root.clientWidth}|${ui.pastOpen}`;
  const draw = (lay) => {
    const bodyHtml = pageBody(v, st, { wn, activeKey, block, bandW, pastOpen: ui.pastOpen, ...lay });
    root.innerHTML = `<section class="an-pl an-pl-rc">
    ${head}
    <div class="an-pl-bar"><div class="an-filters"></div>
      <label class="an-switch" title="A defensive pass interference is a no-play in the play-by-play; on, it counts as a target for the receiver (never a pass attempt, catch or yards)"><input type="checkbox" data-pi${st.pi === false ? "" : " checked"}><span>${st.pi === false ? "excl. PI targets" : "PI targets"}</span></label></div>
    <div class="an-sub an-pl-sub">${esc(sub)}</div>
    ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    ${bodyHtml}
    <p class="an-foot">Targets, air yards, zones, EPA, success, YAC, carries, red-zone and goal-line looks, fumbles and DraftKings points (DK Classic scoring from the play rows: no 2-point conversions or return TDs, D194): nflverse play-by-play. Routes, Rt %, TPRR, YPRR: heatradar.app (charted). Snaps: nflverse snap counts. Separation, cushion, YAC over expected, rush yards over expected, NGS efficiency: Next Gen Stats. Yards before contact, drops: Pro Football Reference charting. Ranks and league figures: his position's reference pool in the window. Zone and route references pool every target to his position in the window. Blocking: EA Madden ratings.</p>
  </section>`;
  };
  // Drawn once at the last measured fits (or the defaults), then measured and, when a fit moved, drawn once more.
  let lay = ui.layout?.key === layoutKey ? ui.layout.lay : {};
  draw(lay);
  const measured = measureLayout(root, v, bandW);
  if (JSON.stringify(measured) !== JSON.stringify(lay)) { lay = measured; draw(lay); }
  ui.layout = { key: layoutKey, lay };

  renderFilterBar(root.querySelector(".an-filters"), st, { keys: data.keys, teams: [] }, go);
  root.querySelector("[data-gl-toggle]")?.addEventListener("click", () => { ui.pastOpen = !ui.pastOpen; renderPlayer(ctx, params, query); });
  root.querySelector("[data-pi]")?.addEventListener("change", (e) => go({ ...st, pi: e.target.checked }));
  // A weekly column (the fantasy chart's too) sets the window to that week; the same week again goes back.
  root.querySelectorAll(".an-wb-hit[data-key]").forEach((h) => h.addEventListener("click", () => {
    const k = h.dataset.key;
    go(k === activeKey ? { ...st, window: "season", from: null, to: null } : { ...st, window: "range", from: k, to: k });
  }));
  const zbox = root.querySelector("[data-zones]");
  if (!zbox) return;
  const wireZones = () => {
    zbox.querySelectorAll("[data-zmode] button").forEach((b) => b.addEventListener("click", () => { ui.zoneMode = b.dataset.v; zbox.innerHTML = zoneHtml(v, st, wn); wireZones(); }));
    zbox.querySelectorAll("[data-zone]").forEach((c) => c.addEventListener("click", () => { ui.zone = ui.zone === c.dataset.zone ? null : c.dataset.zone; zbox.innerHTML = zoneHtml(v, st, wn); wireZones(); }));
    zbox.querySelector("[data-close]")?.addEventListener("click", () => { ui.zone = null; zbox.innerHTML = zoneHtml(v, st, wn); wireZones(); });
  };
  wireZones();
}

const zoneHtml = (v, st, wn) => `<div class="an-pl-zhead"><div class="an-seg" data-zmode>${ZONE_MODES.map((m) => `<button type="button" data-v="${m.k}" class="${ui.zoneMode === m.k ? "on" : ""}">${m.label}</button>`).join("")}</div>${zoneLegend(ui.zoneMode)}</div>
    <div class="an-pl-zbody">${zoneField(v.zones, ui.zoneMode, { selected: ui.zone })}<div class="an-pl-plays">${playsHtml(v, ui.zone, st)}</div></div>`;

// Everything under the sub-header, as one HTML string (pure given the view; the page only adds the wiring).
// Layout fits (👁 fix round; all optional, measured by the page - pageBody itself never touches the DOM): chartW, the
// fantasy chart's width budget (default bandW); stack, the game log under the chart instead of beside it; recFit and
// rushFit, the widths the receiving and rushing week strips spread across (default: their natural width); zoneMin,
// the zone field plus its plays list's 260px minimum, so the zones wrap under the strips rather than squeeze; pastOpen,
// the log's previous-season weeks unfolded.
export function pageBody(v, st, { wn = windowName(st, v.weeks || []), activeKey = null, block = { status: "absent" }, bandW = 1400, chartW = null, stack = false, recFit = null, rushFit = null, zoneMin = null, pastOpen = false } = {}) {
  const R = v.recut;
  const back = R.kind === "back";
  const pos = v.pos;
  const cuts = R.cuts || {};
  const pool = R.pool || [];
  const poolTxt = R.opportunityRefText;
  const refNote = `Colour and league figure: ${poolTxt}`;
  const r = v.row || {};
  const rr = R.rushRow || null;
  const E = v.eff || {}, LE = v.lgEff || {};
  const L = v.lg?.overall || {};
  const H = R.headline || {}, HL = R.headlineLg || {};
  // A coloured value's tier, plus the pool fallback note when his position was too small to set the cuts.
  const tierFor = (k, val, c = cuts) => (k === "eff" ? rushTier(k, val, c) : tierOf(k, val, c));
  const note = (k, val, c = cuts) => (isNum(val) ? tierNote(c?.[k], pos) : "");
  const tip = (...parts) => parts.filter(Boolean).join(". ");
  // A side item or a sub-line prints no league figure, so its league figure goes into the tooltip.
  const lgTip = (x) => (x && x !== DASH ? `League: ${x}` : "");

  // (1) HEADLINE: each tile with the pool's league figure, his rank in the pool and the pool's tier colour.
  const HEAD_DIGITS = { scrimYds: 0, totTd: 0, ydsOpp: 1, epaOpp: 2, ypc: 1, rec: 0, yds: 0, td: 0, yprr: 2, epaTgt: 2 };
  const hl = (k, label, value, lg, def, sub = null, subLg = "") => {
    const val = k === "ypc" ? rr?.ypc ?? null : H[k];
    const rk = rankIn(pool, k, v.gsis, HEAD_DIGITS[k]);
    return { label, value, lg, ...rankText(rk, pos, pool.length), sub, tier: tierFor(k, val),
      title: tip(def, refNote + (rk.rank ? "; rank: his place among them at the shown precision" : `; ${UNRANKED[rk.reason]}`), subLg, note(k, val)) };
  };
  const headTiles = back ? {
    scrimYds: hl("scrimYds", "Scrimmage yds", tInt(H.scrimYds), tFix(HL.scrimYds, 0), "Rushing yards + receiving yards (nflverse play-by-play)", rr || r.rushYds !== undefined ? `${tInt(rr?.yds ?? r.rushYds)} rush · ${tInt(rr?.recYds ?? r.yds)} rec` : null),
    totTd: hl("totTd", "Total TD", tInt(H.totTd), tFix(HL.totTd, 1), "Rushing touchdowns + receiving touchdowns (nflverse play-by-play)", `${tInt(rr?.td ?? r.rushTd)} rush · ${tInt(rr?.recTd ?? r.td)} rec`),
    ydsOpp: hl("ydsOpp", "Yds / opp", tFix(H.ydsOpp, 1), tFix(HL.ydsOpp, 1), "(Rushing yards + receiving yards) / opportunities (carries + targets); nflverse play-by-play"),
    epaOpp: hl("epaOpp", "EPA / opp", tSigned(H.epaOpp, 2), tSigned(HL.epaOpp, 2), "(EPA over his carries + EPA over his targets) / opportunities; nflverse play-by-play"),
    ypc: hl("ypc", "YPC", tFix(rr?.ypc, 1), tFix(R.rushRef?.lg?.ypc, 1), "Rushing yards per carry (nflverse play-by-play)"),
  } : {
    rec: hl("rec", "Receptions", tInt(H.rec), tFix(HL.rec, 1), "Catches (nflverse play-by-play)", `${tInt(r.tgt)} targets`, lgTip(tFix(L.tgt, 1)) && `Targets under it, ${lgTip(tFix(L.tgt, 1))}`),
    yds: hl("yds", "Receiving yds", tInt(H.yds), tFix(HL.yds, 0), "Receiving yards (nflverse play-by-play); per game under it", `${tFix(H.ydsG, 1)} per game`),
    td: hl("td", "Receiving TD", tInt(H.td), tFix(HL.td, 1), "Receiving touchdowns (nflverse play-by-play)"),
    yprr: hl("yprr", "YPRR", tFix(H.yprr, 2), tFix(HL.yprr, 2), "Receiving yards per route run (routes: heatradar.app, charted)"),
    epaTgt: hl("epaTgt", "EPA / target", tSigned(H.epaTgt, 2), tSigned(HL.epaTgt, 2), "Expected points added per target (nflverse play-by-play)"),
  };
  const headline = headlineRow((back ? RB_HEADLINE_ORDER : REC_HEADLINE_ORDER).map((k) => headTiles[k]));

  // (2) FANTASY band: DK per week, the pool's DK per game as the league line, two share lines, the game log, then
  // the Opportunity tiles.
  const O = R.opportunity || {}, OL = R.opportunityLg || {};
  const ot = (k, label, value, lg, def, extra = {}) => ({ label, value, lg, tier: extra.plain ? null : tierFor(k, O[k]), title: tip(def, refNote, lgTip(extra.subLg) && `The figure under it, ${lgTip(extra.subLg)}`, extra.plain ? "" : note(k, O[k])), sub: extra.sub ?? null,
    share: !!extra.share, bar: extra.share ? O[k] : null, lgBar: extra.share ? OL[k] : null });
  const oppTiles = back ? {
    oppG: ot("oppG", "Opp / g", tFix(O.oppG, 1), tFix(OL.oppG, 1), "Opportunities (carries + targets) per game he played; nflverse play-by-play", { sub: `${tInt(rr?.opp ?? v.opps?.opp)} in all`, subLg: tFix(R.rushRef?.lg?.opp, 0) }),
    oppShare: ot("oppShare", "Opp %", tPct(O.oppShare), tPct(OL.oppShare), "(His targets + his designed runs) / (his club's pass attempts + designed runs) in his games; scrambles on neither side", { share: true }),
    car: ot("car", "Carries", tInt(O.car), tFix(OL.car, 0), "Carries (nflverse play-by-play); rush share under it: his carries / his club's designed runs in his games", { plain: true, sub: `rush share ${tPct(O.rushShare)}`, subLg: tPct(OL.rushShare) }),
    tgt: ot("tgt", "Targets", tInt(O.tgt), tFix(OL.tgt, 0), `Targets (${st.pi === false ? "excludes" : "includes"} pass-interference targets); target share under it: his targets / his club's pass attempts in his games`, { plain: true, sub: `target share ${tPct(O.tgtShare)}`, subLg: tPct(OL.tgtShare) }),
    rzOpp: ot("rzOpp", "RZ opp", tInt(O.rzOpp), tFix(OL.rzOpp, 1), "Red-zone opportunities: carries + targets inside the opponent's 20; goal-line carries (inside the 5) under it; nflverse play-by-play", { plain: true, sub: `${tInt(O.gl)} goal-line carries`, subLg: tFix(OL.gl, 1) }),
    snapPct: ot("snapPct", "Snap %", tPct(O.snapPct, 0), tPct(OL.snapPct, 0), "Share of his club's offensive snaps, mean of his games (nflverse snap counts); route % under it: routes / club dropbacks (heatradar.app)", { share: true, sub: `route % ${tPct(O.routePct, 0)}`, subLg: tPct(OL.routePct, 0) }),
  } : {
    tgtG: ot("tgtG", "Targets / g", tFix(O.tgtG, 1), tFix(OL.tgtG, 1), `Targets per game he played (${st.pi === false ? "excludes" : "includes"} pass-interference targets)`, { plain: true, sub: `${tInt(r.tgt)} in all`, subLg: tFix(L.tgt, 1) }),
    tgtShare: ot("tgtShare", "Tgt %", tPct(O.tgtShare), tPct(OL.tgtShare), "His targets / his club's pass attempts in his games (nflverse play-by-play); targets per route run under it (routes: heatradar.app)", { share: true, sub: `TPRR ${tFix(O.tprr, 2)}`, subLg: tFix(OL.tprr, 2) }),
    ayShare: ot("ayShare", "AY %", tPct(O.ayShare), tPct(OL.ayShare), "His air yards / his club's air yards in his games; aDOT (air yards per target) under it; nflverse play-by-play", { share: true, sub: `aDOT ${tFix(O.adot, 1)}`, subLg: tFix(OL.adot, 1) }),
    wopr: ot("wopr", "WOPR", tFix(O.wopr, 2), tFix(OL.wopr, 2), "1.5 x target share + 0.7 x air-yards share (nflverse play-by-play)"),
    rz: ot("rz", "RZ targets", tInt(O.rz), tFix(OL.rz, 1), "Red-zone targets (inside the opponent's 20); end-zone targets under it; nflverse play-by-play", { plain: true, sub: `${tInt(O.ez)} end-zone`, subLg: tFix(OL.ez, 1) }),
    routePct: ot("routePct", "Route %", tPct(O.routePct, 0), tPct(OL.routePct, 0), "Routes / club dropbacks (heatradar.app, charted); snap % under it (nflverse snap counts)", { share: true, sub: `snap % ${tPct(O.snapPct, 0)}`, subLg: tPct(OL.snapPct, 0) }),
  };
  const logRows = gameLogRows(v, st, R.kind);
  const dk = R.fantasy?.dk, dkG = R.fantasy?.dkG;
  const dkRank = rankText(rankIn(pool, "dkG", v.gsis, 1), pos, pool.length);
  // The chart's scale covers his best week and the league line, so the line never pins to the top.
  const maxPts = Math.max(0, isNum(HL.dkG) ? HL.dkG : 0, ...logRows.filter((x) => x.type === "week").map((x) => x.pts || 0));
  const band = fantasyBand({
    title: "Fantasy · DraftKings",
    sub: `${tFix(dkG, 1)} per game · ${tFix(dk, 1)} in the window${dkRank.rank ? ` · ${dkRank.rank} of ${dkRank.rankOf}` : ""} · lg ${tFix(HL.dkG, 1)}/g`,
    rows: logRows, columns: logColumns(R.kind, cuts), shareLabels: SHARE_LINES[R.kind],
    total: `${wn} ${tFix(dk, 1)}`, avg: isNum(HL.dkG) ? HL.dkG : null, avgText: `lg ${tFix(HL.dkG, 1)}/g`, scale: maxPts, width: chartW || bandW,
    current: st.season, pastOpen, stack,
    tiles: (back ? RB_OPP_ORDER : REC_OPP_ORDER).map((k) => oppTiles[k]),
  });

  // (3) the RUSHING and RECEIVING blocks. Figures already on the page before the re-cut keep their source and value
  // (a back's rushing figures from playerView's rush block, his receiving figures from his Receivers row and the
  // efficiency set); new ones come from his Running backs row.
  const weekly = weeklyHtml(v, st, wn, activeKey, recFit);
  const zones = `<div class="an-pl-rczones"${zoneMin ? ` style="min-width:min(100%, ${zoneMin}px)"` : ""}><div class="an-dh">Target zones <span class="an-dsub">${v.zoned} targets with a depth and direction · ${esc(wn)}</span></div><div data-zones>${zoneHtml(v, st, wn)}</div></div>`;
  const routesHtml = st.with2025 && v.routes && v.routes.length ? `<div class="an-pl-rcroutes" data-band="${BAND(pos)}"><div class="an-dh">Routes · ${st.season - 1} <span class="an-dsub">${v.routes.reduce((s, x) => s + x.n, 0)} targets with a route label (nflverse participation)</span></div>${routeList(v.routes)}</div>` : "";
  // The routes list (Include previous season) rides in the same row, so it sits beside the zones when they fit.
  const recBody = `<div class="an-pl-row">${weekly}${zones}${routesHtml}</div>`;
  const usageNote = (k, val) => note(k, val, v.cuts);
  const recItems = {
    rec: { label: "Receptions", value: tInt(r.rec), title: "Catches (nflverse play-by-play)" },
    yds: { label: "Rec yards", value: tInt(r.yds), title: "Receiving yards (nflverse play-by-play)" },
    yprr: { label: "YPRR", value: tFix(r.yprr, 2), lg: tFix(L.yprr, 2), tier: tierOf("yprr", r.yprr, v.cuts), title: tip("Receiving yards per route run (routes: heatradar.app, charted)", `League figure and colour: ${v.refText}`, usageNote("yprr", r.yprr)) },
    epaTgt: { label: "EPA / target", value: tSigned(E.epaTgt, 2), lg: tSigned(LE.epaTgt, 2), tier: tierOf("epaTgt", E.epaTgt, v.cuts), title: tip("Expected points added per target (nflverse play-by-play)", `League figure and colour: ${v.refText}`, usageNote("epaTgt", E.epaTgt)) },
    catchPct: { label: "Catch %", value: tPct(E.catchPct, 0), lg: tPct(LE.catchPct, 0), title: "Catches / targets (a pass-interference target is neither); nflverse play-by-play" },
    ydsTgt: { label: "Yds / target", value: tFix(r.ydsTgt, 1), lg: tFix(meanKey(pool, "ydsTgt"), 1), title: tip("Receiving yards / targets (nflverse play-by-play)", `League figure: ${poolTxt}`) },
    yacRec: { label: "YAC / catch", value: tFix(E.yacRec, 1), lg: tFix(LE.yacRec, 1), title: "Yards after the catch per reception (nflverse play-by-play)" },
    succPct: { label: back ? "Rec success %" : "Success %", value: tPct(E.succPct, 0), lg: tPct(LE.succPct, 0), title: "Share of his targets that were successful plays (nflverse success)" },
    yacOE: { label: "YAC over exp", value: tSigned(E.yacOE, 1), lg: tSigned(LE.yacOE, 1), title: "NGS: YAC per catch above the tracking model's expectation" },
    tprr: { label: "TPRR", value: tFix(r.tprr, 2), lg: tFix(L.tprr, 2), title: "Targets per route run (routes: heatradar.app, charted)" },
    routes: { label: "Routes", value: tInt(r.routes), lg: tFix(L.routes, 0), title: "Routes run (heatradar.app, charted)" },
    ez: { label: "EZ targets", value: tInt(r.ez), lg: tFix(L.ez, 1), title: "End-zone targets (nflverse play-by-play)" },
    td: { label: "Rec TD", value: tInt(r.td), title: "Receiving touchdowns (nflverse play-by-play)" },
    rz: { label: "RZ targets", value: tInt(r.rz), lg: tFix(L.rz, 1), title: "Red-zone targets, inside the opponent's 20 (nflverse play-by-play)" },
    sep: { label: "Separation", value: tFix(E.sep, 1), lg: tFix(LE.sep, 1), title: "NGS: yards from the nearest defender at the catch or incompletion (weeks NGS lists him, weighted by targets)" },
    cushion: { label: "Cushion", value: tFix(E.cushion, 1), lg: tFix(LE.cushion, 1), title: "NGS: yards off the defender at the snap" },
    ay: { label: "Air yards", value: tInt(r.ay), title: "Air yards on his targets (nflverse play-by-play)" },
    opp: { label: "Opp", value: tInt(v.opps?.opp), lg: tFix(L.opp, 1), title: `Opportunities: targets + carries (${st.pi === false ? "excludes" : "includes"} pass-interference targets); nflverse play-by-play` },
    oppG: { label: "Opp / g", value: tFix(v.opps?.oppG, 1), lg: tFix(L.oppG, 1), title: "Opportunities (targets + carries) per game he played; nflverse play-by-play" },
    oppShare: { label: "Opp %", value: tPct(v.opps?.oppShare), lg: tPct(L.oppShare), title: "(His targets + his designed runs) / (his club's pass attempts + designed runs) in his games; scrambles are on neither side; nflverse play-by-play" },
    ydsOpp: { label: "Yds / opp", value: tFix(v.opps?.ydsOpp, 1), lg: tFix(L.ydsOpp, 1), title: "(Receiving yards + rushing yards) / opportunities; nflverse play-by-play" },
    epaOpp: { label: "EPA / opp", value: tSigned(v.opps?.epaOpp, 2), lg: tSigned(L.epaOpp, 2), title: "(EPA over his targets + EPA over his carries) / opportunities; nflverse play-by-play" },
  };
  // NGS figures are shown only when NGS has him or the pool (as the efficiency tiles always did).
  const ngsHidden = (k) => ["sep", "cushion", "yacOE"].includes(k) && !isNum(E[k]) && !isNum(LE[k]);
  const pickItems = (keys, items) => keys.filter((k) => !ngsHidden(k)).map((k) => items[k]);
  // A side item prints label and value only, so its league figure moves into its tooltip (and off the item).
  const sideItems = (keys, items) => pickItems(keys, items).map(({ lg, ...it }) => ({ ...it, title: tip(it.title, lgTip(lg) && `${lgTip(lg)} (${v.refText})`) }));
  const receiving = phaseBlock({
    title: "Receiving", tint: "pass",
    front: pickItems(back ? RB_REC_FRONT : REC_REC_FRONT, recItems),
    side: sideItems(back ? RB_REC_SIDE : REC_REC_SIDE, recItems),
    body: recBody,
  });
  let rushing;
  if (back) {
    const X = v.rush || {}, XL = X.lg || {};
    const rt = (k, val) => ({ tier: tierFor(k, val, X.cuts), note: note(k, val, X.cuts) });
    const rushRef = `League figure and colour: ${X.refText || poolTxt}`;
    const RL = R.rushRef?.lg || {};
    const items = {
      yds: { label: "Rush yards", value: tInt(X.yds), lg: tFix(RL.yds, 0), title: tip("Rushing yards on designed runs (nflverse play-by-play)", `League figure: ${poolTxt}`) },
      td: { label: "Rush TD", value: tInt(X.td), lg: tFix(RL.td, 1), title: tip("Rushing touchdowns (nflverse play-by-play)", `League figure: ${poolTxt}`) },
      epaCar: { label: "EPA / carry", value: tSigned(X.epaCar, 2), lg: tSigned(XL.epaCar, 2), tier: rt("epaCar", X.epaCar).tier, title: tip("Expected points added per carry (nflverse play-by-play)", rushRef, rt("epaCar", X.epaCar).note) },
      ryoeAtt: { label: "RYOE / att", value: tSigned(X.ryoeAtt, 2), lg: tSigned(XL.ryoeAtt, 2), tier: rt("ryoeAtt", X.ryoeAtt).tier, title: tip("NGS rush yards over expected per carry (weeks NGS lists him)", rushRef, rt("ryoeAtt", X.ryoeAtt).note) },
      succPct: { label: "Success %", value: tPct(X.succPct, 0), tier: rt("succPct", X.succPct).tier, title: tip("Share of his carries that were successful plays (nflverse success)", `League ${tPct(XL.succPct, 0)}`, rushRef) },
      explPct: { label: "Explosive %", value: tPct(rr?.explPct, 1), tier: tierFor("explPct", rr?.explPct), title: tip("Share of his carries gaining 10+ yards (nflverse play-by-play)", `League ${tPct(RL.explPct, 1)}; colour: ${poolTxt}`) },
      long: { label: "Long", value: tInt(rr?.long), title: tip("His longest carry in the window (nflverse play-by-play)", `League mean ${tFix(RL.long, 0)}`) },
      eff: { label: "NGS efficiency", value: tFix(rr?.eff, 2), tier: tierFor("eff", rr?.eff), title: tip("NGS: yards travelled per rushing yard gained, lower is more north-south", `League ${tFix(RL.eff, 2)}; colour: ${poolTxt}`) },
      rz: { label: "RZ carries", value: tInt(X.rz), title: "Carries inside the opponent's 20 (nflverse play-by-play)" },
    };
    rushing = phaseBlock({ title: "Rushing", tint: "rush", front: RB_RUSH_FRONT.map((k) => items[k]), side: RB_RUSH_SIDE.map((k) => items[k]), body: rushStripsHtml(v, st, wn, activeKey, rushFit) });
  } else if (rr && rr.car > 0) {
    // A receiver's rushing pool (WRs or TEs with 2+ carries a game) is nearly empty: no league figure, no colour.
    const items = {
      car: { label: "Carries", value: tInt(rr.car), title: "Carries: designed runs, a jet sweep or end-around included (nflverse play-by-play); no league figure for a receiver" },
      yds: { label: "Rush yards", value: tInt(rr.yds), title: "Rushing yards (nflverse play-by-play)" },
      td: { label: "Rush TD", value: tInt(rr.td), title: "Rushing touchdowns (nflverse play-by-play)" },
      ypc: { label: "YPC", value: tFix(rr.ypc, 1), title: "Yards per carry (nflverse play-by-play)" },
      epaCar: { label: "EPA / carry", value: tSigned(rr.epaCar, 2), title: "Expected points added per carry (nflverse play-by-play)" },
    };
    rushing = phaseBlock({ title: "Rushing", tint: "rush", front: REC_RUSH_FRONT.map((k) => items[k]), side: REC_RUSH_SIDE.map((k) => items[k]) });
  } else {
    // 👁 fix round: a receiver with no carries gets no rushing block at all (the plan: it appears only when he has
    // carries).
    rushing = "";
  }
  const phases = `<div class="an-pl-phases${back ? "" : " an-pl-phases-rec"}">${back ? rushing + receiving : receiving + rushing}</div>`;

  // (4) VARIANCE: his rate beside the pool's pooled rate, a neutral above/below marker.
  const VR = R.variance || {}, VL = R.varianceLg || {};
  const fum = back ? rr?.fum : r.fum, fl = back ? rr?.fl : r.fl;
  const varDefs = {
    rzOppTdRate: ["TD rate, red-zone opp", (x) => tPct(x, 1), "Touchdowns / red-zone opportunities (carries + targets inside the 20)"],
    in10TdRate: ["TD rate, carries inside 10", (x) => tPct(x, 1), "Rushing touchdowns / carries inside the opponent's 10"],
    yds20Share: ["Rush yds from 20+ runs", (x) => tPct(x, 1), "Share of his rushing yards gained on carries of 20+ yards"],
    ybcCar: ["Yds before contact / car", (x) => tFix(x, 2), "Yards before contact per carry, Pro Football Reference charting (weeks PFR lists him)"],
    flRate: ["Fumbles lost", (x) => tPct(x, 0), "Fumbles lost / fumbles (his as the ball carrier; return fumbles are not in the play rows)"],
    dkTdShare: ["TD share of DK points", (x) => tPct(x, 0), "Touchdown points (6 per rushing or receiving TD) / his DraftKings points; the league figure is the pool's plain mean"],
    tdTgt: ["TD rate per target", (x) => tPct(x, 1), "Receiving touchdowns / targets"],
    rzTdRate: ["TD rate, red-zone targets", (x) => tPct(x, 1), "Receiving touchdowns / red-zone targets"],
    cpoeTgt: ["Catch % over expected", (x) => (isNum(x) ? tSigned(x, 1) + "%" : DASH), "nflverse's per-throw catch probability: catches minus expected catches per target, averaged over his targets that carry one"],
    yacOE: ["YAC over expected", (x) => tSigned(x, 1), "NGS: YAC per catch above the tracking model's expectation; league: the pool's NGS mean"],
    dropPer100: ["Drops per 100 targets", (x) => tFix(x, 1), "Pro Football Reference charted drops per 100 targets in the weeks PFR lists him"],
  };
  const optional = new Set(["ybcCar", "dropPer100"]); // PFR: shown only when present
  const varItems = (back ? RB_VARIANCE_ORDER : REC_VARIANCE_ORDER).filter((k) => !(optional.has(k) && !isNum(VR[k]))).map((k) => {
    const [label, f, def] = varDefs[k];
    const me = VR[k], lg = VL[k];
    // The marker follows the printed figures: equal at the shown precision reads as no marker.
    const dir = isNum(me) && isNum(lg) && f(me) !== f(lg) ? (me > lg ? "up" : "down") : null;
    const shown = k === "flRate" ? `${tInt(fl ?? 0)} of ${tInt(fum ?? 0)}` : f(me);
    return { label, me: shown, lg: f(lg), dir, title: tip(def, `League: ${poolTxt}, pooled (the pool's total over its total)`, "Above or below only, never good or bad") };
  });
  const variance = `<div class="an-pl-rcvar"><div class="an-dh">Variance <span class="an-dsub">his rate beside the league's; ▲ above, ▼ below, never good or bad</span></div>${varianceStrip(varItems)}</div>`;

  // (5) Madden foot: the blocking block, unchanged.
  const blockHtml = `<div class="an-card an-pl-block"><div class="an-dh">Blocking ${block.title ? `<span class="an-dsub">${esc(block.title)}</span>` : ""}</div>
    ${block.status === "absent" ? `<div class="an-note">Madden ratings not on file.</div>`
      : block.status === "unrated" ? `<div class="an-note">No ${esc(maddenEdition(st.season))} rating on file for him.</div>`
      : ratingBars(block.bars, block.pos) + `<div class="an-note">EA's blocking attributes; the tick is the ${esc(block.pos)} median (${block.peers} rated). No free per-player blocking stat exists this season (D182).</div>`}</div>`;

  return `${headline}${band}${phases}${variance}${maddenFoot(`<div class="an-pl-row">${blockHtml}</div>`)}`;
}
const meanKey = (rows, k) => { const x = (rows || []).map((r) => r[k]).filter(isNum); return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null; };

// The receiving block's week-by-week strips (target share, air-yards share for WR/TE, snap share), unchanged.
function weeklyHtml(v, st, wn, activeKey, fit = null) {
  const r = v.row || {}, L = v.lg?.overall || {};
  const shareStrip = (k, label, totKey, fixedScale) => {
    const tot = r[totKey], avg = L[totKey];
    const maxV = Math.max(0, ...v.series.map((s) => s[k] ?? 0));
    return { k, label, scale: Math.max(fixedScale, maxV * 1.05), fmt: (x) => `${(x * 100).toFixed(1)}%`, short: (x) => String(Math.round(x * 100)),
      total: tot, totalText: `${wn} ${isNum(tot) ? (tot * 100).toFixed(1) + "%" : "–"}`, avg, avgText: `lg avg ${isNum(avg) ? Math.round(avg * 100) + "%" : "–"}`, tier: (x) => tierOf(totKey, x, v.cuts) };
  };
  const defs = {
    v: () => shareStrip("v", "Target share", "tgtShare", 0.4),
    ay: () => shareStrip("ay", "Air-yards share", "ayShare", 0.5),
    snap: () => shareStrip("snap", "Snap share", "snapPct", 1),
  };
  const inner = v.series.length ? weeklyStrips(v.series, weeklyKeysFor(v.pos).map((k) => defs[k]()), { season: st.season, activeKey, fit }) : `<div class="an-note">No weeks loaded.</div>`;
  return `<div class="an-pl-rcweeks"><div class="an-dh">Week by week <span class="an-dsub">click a week to show it alone; click it again for the whole window</span></div><div class="an-pl-scroll">${inner}</div></div>`;
}

// The rushing block's strips for a back (Carries, Opportunities, Rush share), unchanged.
function rushStripsHtml(v, st, wn, activeKey, fit = null) {
  const R = v.rush || {}, RL = R.lg || {}, O = v.opps || {};
  const maxCar = Math.max(1, ...v.series.map((s) => s.car ?? 0));
  const maxSh = Math.max(0.6, ...v.series.map((s) => s.rushShare ?? 0));
  const maxOpp = Math.max(1, ...v.series.map((s) => s.oppN ?? 0));
  const stripDefs = {
    oppN: { k: "oppN", label: "Opportunities", scale: maxOpp * 1.05, fmt: (x) => `${x} opportunities (targets + carries)`, short: (x) => String(x), total: O.opp, totalText: `${wn} ${isNum(O.opp) ? O.opp : "–"}`, avg: RL.oppG, avgText: `lg avg ${isNum(RL.oppG) ? RL.oppG.toFixed(1) : "–"}/g` },
    car: { k: "car", label: "Carries", scale: maxCar * 1.05, fmt: (x) => `${x} carries`, short: (x) => String(x), total: R.car, totalText: `${wn} ${R.car}`, avg: RL.carG, avgText: `lg avg ${isNum(RL.carG) ? RL.carG.toFixed(1) : "–"}/g` },
    rushShare: { k: "rushShare", label: "Rush share", scale: maxSh * 1.05, fmt: (x) => `${(x * 100).toFixed(1)}% of club runs`, short: (x) => String(Math.round(x * 100)), total: R.rushShare, totalText: `${wn} ${isNum(R.rushShare) ? (R.rushShare * 100).toFixed(1) + "%" : "–"}`, avg: RL.rushShare, avgText: `lg avg ${isNum(RL.rushShare) ? Math.round(RL.rushShare * 100) + "%" : "–"}` },
  };
  return `<div class="an-pl-scroll an-pl-rcrush">${weeklyStrips(v.series, RB_RUSH_STRIP_KEYS.map((k) => stripDefs[k]), { season: st.season, activeKey, sh: 50, fit })}</div>`;
}

// The page's fits, measured off the drawn page (👁 fix round). The game log sits beside the chart when the chart
// keeps at least 44px a week beside it (room for a "25-W10" label), else under it. The receiving strips take the
// body's width left of the zone field (its plays list at its 260px minimum) when that keeps 44px a week, else the
// body's full width with the zones under them; a back's rushing strips take the rushing body's full width; a width
// under 44px a week leaves the strips at their natural size (they scroll). weeklyStrips' label and league-label
// columns are 150 + 86px.
export function layoutFrom({ bandW, logW, chartWeeks, recBodyW, zoneW, rushBodyW, weeks }) {
  const out = {};
  if (logW > 0 && chartWeeks > 0) {
    const beside = bandW - logW - 28;
    if (beside >= 242 + chartWeeks * 44) out.chartW = Math.floor(beside);
    else out.stack = true;
  }
  if (recBodyW > 0 && weeks > 0) {
    const left = recBodyW - (zoneW > 0 ? zoneW + 14 + 260 : 0) - 12;
    const room = (w) => w >= 236 + weeks * 44;
    if (zoneW > 0 && room(left)) out.recFit = Math.floor(left);
    else if (room(recBodyW)) out.recFit = Math.floor(recBodyW);
    if (zoneW > 0) out.zoneMin = Math.ceil(zoneW + 14 + 260);
  }
  if (rushBodyW > 0 && weeks > 0 && rushBodyW >= 236 + weeks * 44) out.rushFit = Math.floor(rushBodyW);
  return out;
}
function measureLayout(root, v, bandW) {
  const w = (sel, prop = "clientWidth") => root.querySelector(sel)?.[prop] || 0;
  const band = root.querySelector(".an-rc-fanband");
  return layoutFrom({
    bandW, logW: w(".an-rc-fanband .an-rc-gl", "offsetWidth"), chartWeeks: band ? band.querySelectorAll(".an-rc-fanchart .an-wb-hit").length : 0,
    recBodyW: w(".an-rc-phase-pass .an-rc-phasebody"), zoneW: w(".an-pl-rczones .an-pl-zbody > :first-child", "offsetWidth"),
    rushBodyW: v.recut?.kind === "back" ? w(".an-rc-phase-rush .an-rc-phasebody") : 0, weeks: (v.series || []).length,
  });
}

function headerHtml(v, name, block, teams, qs) {
  const ovr = block.status === "ok" && isNum(block.ovr) ? `<span class="an-pl-ovr t-${block.ovr >= 90 ? "elite" : block.ovr >= 80 ? "strong" : block.ovr >= 70 ? "avg" : block.ovr >= 60 ? "weak" : "flat"}" title="${esc(block.title)} overall"><b>${block.ovr}</b><small>OVR</small></span>` : "";
  const depth = `../#/team/${encodeURIComponent(v.team)}/player/${encodeURIComponent(v.gsis)}`;
  const fb = backFallback(v.pos);
  // The kit's header: his headshot left of the name, a quiet wash and a rule in his club's colour.
  return playerHead({
    lead: backLink(`${fb.href}${qs ? "?" + qs : ""}`, fb.name), name, espnId: v.espnId, colour: teams.get(v.team)?.colourPrimary,
    pills: `${v.team ? teamPill(v.team, teams, qs) : ""}<span class="an-pospill" data-band="${BAND(v.pos)}">${esc(v.pos)}</span>${ovr}`,
    links: `<div class="an-pl-links"><a href="${depth}" target="_blank" rel="noopener">Depth chart ↗</a>${v.team ? `<a href="#/team/${esc(v.team)}${qs ? "?" + qs : ""}">Team page →</a>` : ""}</div>`,
  });
}

const ord = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : n === 4 ? "4th" : "");
export function playsHtml(v, zone, st) {
  if (!zone) return `<div class="an-note">Click a zone to list the plays behind it.</div>`;
  const plays = v.zones[zone]?.plays || [];
  const rows = plays.map((p) => `<tr class="res-${esc(p.result.toLowerCase())}"><td>${esc(weekLabel(p.key, st.season))}</td><td>${esc(p.opp || "")}</td>`
    + `<td>${p.down ? `${ord(p.down)} &amp; ${p.togo ?? ""}` : ""}${isNum(p.yl) ? ` <small>${p.yl <= 50 ? "opp" : "own"} ${p.yl <= 50 ? p.yl : 100 - p.yl}</small>` : ""}</td>`
    + `<td>${esc(p.result)}</td><td class="num">${p.yards}</td><td class="num">${signed(p.epa, 2)}</td></tr>`).join("");
  return `<div class="an-pl-plhead"><b>${esc(zoneName(zone))}</b> <span>${plays.length} target${plays.length === 1 ? "" : "s"}</span><button type="button" data-close title="Close">×</button></div>
    <div class="an-pl-pltable"><table><thead><tr><th>Wk</th><th>Opp</th><th>Down</th><th>Result</th><th class="num">Yds</th><th class="num">EPA</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
