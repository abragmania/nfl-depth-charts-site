// Quarterbacks: the QB leaderboard (#/qb). D177: QBs are judged on EPA per dropback, CPOE, success rate, aDOT,
// pressure and play-action, NGS time to throw and expected completion; NO QBR. D182: QBs are their own thing.
// Adam (2026-09-24): passing versus running must be obvious. The Rush column group (carries per game, rush yards
// per game, scramble rate, TD) is tier-coloured among QBs with weak and low left grey, so runners light up and
// pocket passers sit quiet; the expanded row gives passing the dominant block and rushing its own block beside it.
// Every figure comes from agg_qb.js (pure); this file draws, sorts and wires clicks. The chart helpers below
// (signed weekly strips, the QB zone field, the team pill) are shared with the QB player page (qbplayer.js).
import { fromQuery, toQuery, seasonsOf, weekLabel, splitKey } from "../filters.js";
import { loadFor, loadTeams, displayName } from "../data.js";
import { clubGames } from "../agg.js";
import { aggregateQb, qbReference, qbTier, qbZones, sortQbRows, QB_MIN_DB } from "../agg_qb.js";
import { renderFilterBar } from "../filterbar.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const NA = `<span class="an-na">–</span>`;
export const isNum = (v) => v !== null && v !== undefined && Number.isFinite(+v);
export const pct = (v, d = 1) => (isNum(v) ? (v * 100).toFixed(d) : NA);
export const fix = (v, d) => (isNum(v) ? (+v).toFixed(d) : NA);
export const signed = (v, d) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) : NA);
export const int = (v) => (isNum(v) ? String(Math.round(v)) : NA);

// Team pill in the club's colours: the same rule as table.js's teamPill (copied, as player.js does: that one is private).
function luminance(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
export function teamPill(abbr, teams, q, cls = "") {
  const t = teams?.get(abbr);
  const style = t ? ` style="--team-bg:${esc(t.colourPrimary)};--team-ink:${(luminance(t.colourPrimary) ?? 0) > 0.40 ? "#14181d" : "#fff"}"` : "";
  return `<a class="an-teampill${cls ? " " + cls : ""}" href="#/team/${esc(abbr)}${q ? "?" + q : ""}"${style} title="Team page">${esc(abbr)}</a>`;
}

// ---- weekly strips with a zero line ---------------------------------------------------------------------
// bars.js's weeklyStrips draws rates from zero up; EPA and CPOE go negative, so the QB views draw their own: a
// `signed` strip puts zero in the middle (bars up green, down red), an unsigned one sits on a baseline. Each strip
// prints its window figure on the left (D181 totals) and a dashed league line (D177 perspective).
// strips: [{ k, label, signed, span, fmt(v), short(v), total, totalText, avg, avgText, tier?(v) }]
// series: [{ key, opp?, home?, inWin?, [k]: value|null }]
export function qbStrips(series, strips, { season, bw = 30, gap = 8, sh = 52, lw = 128, rw = 82, activeKey = null, hit = false, big = false } = {}) {
  const n = series.length, top0 = 18, withOpp = series.some((s) => s.opp !== undefined);
  const W = lw + n * (bw + gap) + rw, H = top0 + strips.length * (sh + 16) + (withOpp ? 30 : 16);
  const x = (i) => lw + i * (bw + gap);
  let g = "";
  if (n && splitKey(series[0].key).season !== splitKey(series[n - 1].key).season) {
    for (let i = 1; i < n; i++) if (splitKey(series[i].key).season !== splitKey(series[i - 1].key).season) {
      const dx = x(i) - gap / 2;
      g += `<line class="an-wb-div" x1="${dx}" x2="${dx}" y1="2" y2="${H - 2}"/><text class="an-wb-season" x="${x(i)}" y="11">${splitKey(series[i].key).season}</text><text class="an-wb-season" x="${lw}" y="11">${splitKey(series[0].key).season}</text>`;
    }
  }
  strips.forEach((sp, si) => {
    const top = top0 + si * (sh + 16);
    const mid = sp.signed ? top + sh / 2 : top + sh;
    const half = sp.signed ? sh / 2 - 9 : sh - 14;
    const y = (v) => mid - Math.max(sp.signed ? -1 : 0, Math.min(1, v / sp.span)) * half;
    const totTier = sp.tier ? sp.tier(sp.total) : "";
    g += `<text class="an-wb-lab" x="0" y="${top + sh / 2 - 4}">${esc(sp.label)}</text>`
      + `<text class="an-wb-tot${totTier ? " t-" + totTier : ""}" x="0" y="${top + sh / 2 + 13}">${esc(sp.totalText)}</text>`
      + `<line class="an-wb-base${sp.signed ? " zero" : ""}" x1="${lw - 5}" x2="${W - rw + 5}" y1="${mid}" y2="${mid}"/>`;
    series.forEach((s, i) => {
      const v = s[sp.k], bx = x(i), dim = s.inWin === false ? " dim" : "";
      // His club played that week but he has no rows in it (no dropback or carry): a muted "DNP" mark, no bar.
      if (s.dnp) { g += `<text class="an-wb-dnp${dim}" x="${bx + bw / 2}" y="${mid - 4}">DNP</text>`; return; }
      if (!isNum(v)) { g += `<text class="an-wb-na${dim}" x="${bx + bw / 2}" y="${mid - 4}">–</text>`; return; }
      const yv = y(v), h = Math.max(1.5, Math.abs(mid - yv));
      const cls = sp.signed ? (v >= 0 ? " up" : " down") : " plain";
      const ty = v >= 0 || !sp.signed ? Math.min(yv, mid - 1.5) - 4 : Math.max(yv, mid + 1.5) + 11;
      g += `<rect class="an-wb-bar an-qb-bar${cls}${dim}" x="${bx}" y="${(v >= 0 || !sp.signed ? mid - h : mid).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="3"/>`
        + `<text class="an-wb-val${dim}" x="${bx + bw / 2}" y="${ty.toFixed(1)}">${esc(sp.short(v))}</text>`;
    });
    if (isNum(sp.avg)) {
      const ay = y(sp.avg).toFixed(1);
      g += `<line class="an-wb-avg" x1="${lw - 5}" x2="${W - rw + 5}" y1="${ay}" y2="${ay}"/><text class="an-wb-avglab" x="${W - rw + 9}" y="${+ay + 3.5}">${esc(sp.avgText)}</text>`;
    }
  });
  series.forEach((s, i) => {
    const bx = x(i), dim = s.inWin === false ? " dim" : "";
    const tip = [`${weekLabel(s.key, season)}${s.opp ? (s.home === false ? " at " : " vs ") + s.opp : withOpp ? " · no game" : ""}`,
      ...strips.map((sp) => `${sp.label}: ${isNum(s[sp.k]) ? sp.fmt(s[sp.k]) : "did not play"}`),
      ...(hit ? [s.key === activeKey ? "Click to go back to the whole window" : "Click to show this week only"] : [])].join("\n");
    g += `<text class="an-wb-wk${dim}${s.key === activeKey ? " on" : ""}" x="${bx + bw / 2}" y="${H - (withOpp ? 16 : 3)}">${esc(weekLabel(s.key, season))}</text>`
      + (withOpp ? `<text class="an-wb-opp${dim}" x="${bx + bw / 2}" y="${H - 3}">${s.opp ? (s.home === false ? "@" : "") + esc(s.opp) : "bye"}</text>` : "")
      + `<rect class="${hit ? "an-wb-hit" : "an-qb-tip"}${s.key === activeKey ? " on" : ""}"${hit ? ` data-key="${esc(s.key)}"` : ""} x="${bx - gap / 2}" y="${top0 - 6}" width="${bw + gap}" height="${H - top0 - 2}" rx="4"><title>${esc(tip)}</title></rect>`;
  });
  return `<svg class="an-wbars${big ? " an-wbars-lg" : ""}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Week by week">${g}</svg>`;
}

// ---- the QB zone field ------------------------------------------------------------------------------------
// D179's 4 x 3 grid of his attempts (deep 20+, intermediate 10-19, short 1-9, behind the line; left, middle,
// right). One grid, his figure against every QB's pooled figure in the same cell (D177 perspective): Attempts is
// shaded by his volume with his share vs the league's share; the rate modes colour a cell by his figure minus the
// league's there (green above, red below; grey under ZONE_MIN attempts). Cells with attempts are buttons
// (data-zone) that open the plays behind them.
export const ZONE_MIN = 3;
const pct0 = (v) => `${Math.round(v * 100)}%`;
export const QB_ZONE_MODES = [
  { k: "att", label: "Attempts" },
  { k: "cmpPct", label: "Comp %", fmt: pct0, span: 0.25 },
  { k: "ydsAtt", label: "Yds/att", fmt: (v) => v.toFixed(1), span: 4 },
  { k: "tdint", label: "TD-INT", fmt: (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + (Math.abs(v) * 100).toFixed(1) + "%", span: 0.08 },
  { k: "epaAtt", label: "EPA/att", fmt: (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2), span: 0.6 },
];
const BANDS = [["D", "Deep", "20+"], ["I", "Inter", "10–19"], ["S", "Short", "1–9"], ["B", "Behind", "LOS"]];
const DIRS = [["L", "Left"], ["M", "Middle"], ["R", "Right"]];
export const qbZoneName = (z) => `${Object.fromEntries(BANDS.map(([b, n, r]) => [b, `${n} ${r}`]))[z[0]]} · ${Object.fromEntries(DIRS)[z[1]]}`;
export function qbZoneDiff(c, mode) {
  const m = QB_ZONE_MODES.find((x) => x.k === mode);
  if (!m?.span || !c || c.n < ZONE_MIN || !isNum(c[mode]) || !isNum(c.lg?.[mode])) return null;
  return Math.max(-1, Math.min(1, (c[mode] - c.lg[mode]) / m.span));
}
export function qbZoneField(zones, mode = "att", { selected = null, small = false } = {}) {
  const m = QB_ZONE_MODES.find((x) => x.k === mode) || QB_ZONE_MODES[0];
  const max = Math.max(1, ...Object.values(zones).map((c) => c.n));
  const p = (v) => (isNum(v) ? pct0(v) : "–");
  const cell = (b, d) => {
    const z = b + d, c = zones[z] || { n: 0, lg: {} }, sel = selected === z ? " sel" : "";
    if (m.k === "att") {
      const tip = `${qbZoneName(z)}: ${c.n} attempts, ${p(c.share)} of his zoned attempts; ${p(c.lg?.share)} of every QB's`;
      return `<button type="button" class="an-zf-c heat${sel}" data-zone="${z}" style="--heat:${(c.n / max).toFixed(3)}"${c.n ? "" : " disabled"} title="${esc(tip)}"><b>${c.n || ""}</b><small>${c.n ? p(c.share) : ""}<em> · lg ${p(c.lg?.share)}</em></small></button>`;
    }
    const diff = qbZoneDiff(c, m.k), cls = diff === null ? "few" : diff >= 0 ? "up" : "down";
    let main, sub;
    if (m.k === "tdint") {
      main = c.n ? `${c.td}-${c.int}` : "";
      sub = c.n ? `${c.n} att<em>${isNum(c.lg?.tdint) ? ` · lg ${m.fmt(c.lg.tdint)}` : ""}</em>` : "";
    } else {
      main = isNum(c[m.k]) ? m.fmt(c[m.k]) : c.n ? "–" : "";
      sub = c.n ? `${c.n} att<em>${isNum(c.lg?.[m.k]) ? ` · lg ${m.fmt(c.lg[m.k])}` : ""}</em>` : "";
    }
    const mine = m.k === "tdint" ? `${c.td} TD, ${c.int} INT (${isNum(c.tdint) ? m.fmt(c.tdint) : "–"} of attempts)` : isNum(c[m.k]) ? m.fmt(c[m.k]) : "–";
    const tip = `${qbZoneName(z)}: ${m.label} ${mine} on ${c.n} attempts; every QB ${isNum(c.lg?.[m.k]) ? m.fmt(c.lg[m.k]) : "–"}${c.n && c.n < ZONE_MIN ? " (too few attempts to judge)" : ""}`;
    return `<button type="button" class="an-zf-c ${cls}${sel}" data-zone="${z}" style="--d:${Math.abs(diff ?? 0).toFixed(3)}"${c.n ? "" : " disabled"} title="${esc(tip)}"><b>${main}</b><small>${sub}</small></button>`;
  };
  return `<div class="an-zf${small ? " an-zf-sm" : ""}"><div></div>${DIRS.map(([, l]) => `<div class="an-zf-h">${l}</div>`).join("")}`
    + BANDS.map(([b, n, r]) => `<div class="an-zf-r${b === "B" ? " los" : ""}"><span>${n}</span><small>${r}</small></div>${DIRS.map(([d]) => cell(b, d)).join("")}`).join("") + `</div>`;
}
export function qbZoneLegend(mode) {
  if (mode === "att") return `<span class="an-zf-leg"><i class="heat" style="--heat:.15"></i><i class="heat" style="--heat:.5"></i><i class="heat" style="--heat:1"></i> more of his attempts · "lg" = share of every QB's attempts</span>`;
  return `<span class="an-zf-leg"><i class="down" style="--d:1"></i><i class="down" style="--d:.4"></i><i class="few"></i><i class="up" style="--d:.4"></i><i class="up" style="--d:1"></i> below → above every QB there · grey: under ${ZONE_MIN} attempts</span>`;
}

// ---- the leaderboard ------------------------------------------------------------------------------------
const COLS = [
  { k: "db", h: "Db", t: "Dropbacks: pass attempts + sacks + scrambles", f: int, grp: "v" },
  { k: "att", h: "Att", t: "Pass attempts", f: int, grp: "v" },
  { k: "cmpPct", h: "Cmp %", t: "Completions / attempts", f: (v) => pct(v), grp: "p" },
  { k: "yds", h: "Yds", t: "Passing yards", f: int, grp: "p" },
  { k: "td", h: "TD", t: "Passing touchdowns", f: int, grp: "p" },
  { k: "int", h: "INT", t: "Interceptions", f: int, grp: "p" },
  { k: "adot", h: "aDOT", t: "Average depth of target: air yards per attempt", f: (v) => fix(v, 1), grp: "p" },
  { k: "epaDb", h: "EPA/db", t: "Expected points added per dropback (sacks and scrambles included)", f: (v) => signed(v, 2), grp: "e" },
  { k: "succPct", h: "Succ %", t: "Share of his dropbacks that were successful plays (nflverse success)", f: (v) => pct(v, 0), grp: "e" },
  { k: "cpoe", h: "CPOE", t: "Completion % over expected (play-by-play), mean over his attempts", f: (v) => signed(v, 1), grp: "e" },
  { k: "sackPct", h: "Sack %", t: "Sacks / dropbacks", f: (v) => pct(v), grp: "x" },
  { k: "pressPct", h: "Press %", t: "PFR: pressures / dropbacks over the weeks PFR lists him (PFR runs about a week behind)", f: (v) => pct(v, 0), grp: "x" },
  { k: "paPct", h: "PA %", t: "FTN: share of his dropbacks with play action", f: (v) => pct(v, 0), grp: "x" },
  { k: "blitzPct", h: "Blitz %", t: "FTN: share of his dropbacks with 1+ blitzers", f: (v) => pct(v, 0), grp: "x" },
  { k: "ttt", h: "TTT", t: "NGS: average time to throw, seconds (weighted by his dropbacks each week)", f: (v) => fix(v, 2), grp: "n" },
  { k: "xcomp", h: "xComp %", t: "NGS: expected completion % (weighted by his attempts each week)", f: (v) => pct(v), grp: "n" },
  { k: "rushAttG", h: "Car/g", t: "Carries per game: designed runs + scrambles", f: (v) => fix(v, 1), grp: "r" },
  { k: "rushYdsG", h: "Yds/g", t: "Rushing yards per game (designed runs + scrambles)", f: (v) => fix(v, 1), grp: "r" },
  { k: "scrPct", h: "Scr %", t: "Scramble rate: scrambles / dropbacks", f: (v) => pct(v), grp: "r" },
  { k: "rushTd", h: "TD", t: "Rushing touchdowns", f: int, grp: "r" },
];
const GROUPS = [["v", "Volume"], ["p", "Passing"], ["e", "Efficiency"], ["x", "Pressure · looks"], ["n", "NGS"], ["r", "Rush"]];
COLS.forEach((c, i) => { c.gs = i === 0 || COLS[i - 1].grp !== c.grp; });
const TIERED = new Set(["cmpPct", "epaDb", "succPct", "cpoe", "sackPct", "pressPct", "rushAttG", "rushYdsG", "scrPct"]);
const DEFAULT_SORT = "epaDb";

// Weekly EPA/db: a zero line, a point per week (hover for the week's figure and dropbacks).
function epaSpark(series, st) {
  const W = 84, H = 22, pad = 3, span = 0.6, n = series.length;
  const x = (i) => (n <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1));
  const y = (v) => H / 2 - Math.max(-1, Math.min(1, v / span)) * (H / 2 - pad);
  let d = "", pen = false;
  series.forEach((s, i) => { if (!isNum(s.epaDb)) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(s.epaDb).toFixed(1)}`; pen = true; });
  const pts = series.map((s, i) => {
    const w = n <= 1 ? W : (W - 2 * pad) / (n - 1);
    const lab = `${weekLabel(s.key, st.season)}: ${isNum(s.epaDb) ? `${signed(s.epaDb, 2)} EPA/db (${s.db} dropbacks)` : "did not play"}`;
    return `<g class="an-sp-pt"><rect x="${(x(i) - w / 2).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" fill="transparent"><title>${esc(lab)}</title></rect>`
      + (isNum(s.epaDb) ? `<circle class="${s.epaDb >= 0 ? "up" : "down"}" cx="${x(i).toFixed(1)}" cy="${y(s.epaDb).toFixed(1)}" r="${i === n - 1 ? 2.4 : 1.8}"/>` : "") + `</g>`;
  }).join("");
  return `<svg class="an-spark an-qb-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Weekly EPA per dropback"><line class="an-sp-ref" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/><path d="${d}"/>${pts}</svg>`;
}

// The rushing block's headline: carries per game, rush EPA per game, scramble rate, each against the QB league line
// and tier-coloured among QBs (weak and low stay grey). Shared with the player page.
export function rushHeadline(r, ref) {
  const L = ref?.lg || {}, cuts = ref?.cuts;
  const big = (label, val, k, lg, title) => { const t = qbTier(k, r[k], cuts); return `<div class="an-qb-rh${t ? " t-" + t : ""}" title="${esc(title)}"><b>${val}</b><span>${label}</span><em>lg ${lg}</em></div>`; };
  return `<div class="an-qb-rhs">${big("carries / game", fix(r.rushAttG, 1), "rushAttG", fix(L.rushAttG, 1), "Designed runs + scrambles per game he played")}`
    + big("rush EPA / game", signed(r.rushEpaG, 2), "rushEpaG", signed(L.rushEpaG, 2), "Expected points added on his designed runs and scrambles, per game")
    + big("scramble rate", pct(r.scrPct) + (isNum(r.scrPct) ? "%" : ""), "scrPct", pct(L.scrPct) + (isNum(L.scrPct) ? "%" : ""), "Scrambles / dropbacks") + `</div>`;
}

function detailHtml(r, st, q, ref, wn, lgZones) {
  const L = ref.lg, cuts = ref.cuts;
  const tile = (label, val, k, lg, title = "") => { const t = k ? qbTier(k, r[k], cuts) : ""; return `<div class="an-tile${t ? " t-" + t : ""}"${title ? ` title="${esc(title)}"` : ""}><span>${label}</span><b>${val}</b>${lg && !lg.includes("an-na") ? `<em> · lg ${lg}</em>` : ""}</div>`; };
  const strips = [
    { k: "epaDb", label: "EPA/dropback", signed: true, span: 0.6, fmt: (v) => signed(v, 2), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: r.epaDb, totalText: `${wn} ${isNum(r.epaDb) ? signed(r.epaDb, 2) : "–"}`, avg: L.epaDb, avgText: `lg ${isNum(L.epaDb) ? signed(L.epaDb, 2) : "–"}`, tier: (v) => qbTier("epaDb", v, cuts) },
    { k: "cpoe", label: "CPOE", signed: true, span: 15, fmt: (v) => signed(v, 1), short: (v) => signed(v, 0), total: r.cpoe, totalText: `${wn} ${isNum(r.cpoe) ? signed(r.cpoe, 1) : "–"}`, avg: L.cpoe, avgText: `lg ${isNum(L.cpoe) ? signed(L.cpoe, 1) : "–"}`, tier: (v) => qbTier("cpoe", v, cuts) },
  ];
  const zones = qbZones(r.zones, lgZones);
  const zn = Object.values(zones).reduce((s, c) => s + c.n, 0);
  const depth = `../#/team/${encodeURIComponent(r.team)}/player/${encodeURIComponent(r.gsis)}`;
  return `<div class="an-detail-in an-qb-din">
    <div class="an-qb-pass">
      <div class="an-qb-blockh">Passing <span class="an-dsub">${r.db} dropbacks · ${r.att} attempts</span></div>
      <div class="an-qb-passrow">
        <div class="an-dcol"><div class="an-dh">Week by week</div>${r.series.length ? qbStrips(r.series, strips, { season: st.season, bw: 24, gap: 7, sh: 48, lw: 104, rw: 60 }) : `<div class="an-note">No weeks in this window.</div>`}</div>
        <div class="an-dcol"><div class="an-dh">Completion % by zone <span class="an-dsub">${zn} attempts · vs every QB</span></div>${qbZoneField(zones, "cmpPct", { small: true })}</div>
        <div class="an-dcol an-dtiles">
          ${tile("EPA/db", signed(r.epaDb, 2), "epaDb", signed(L.epaDb, 2))}${tile("CPOE", signed(r.cpoe, 1), "cpoe", signed(L.cpoe, 1))}
          ${tile("Cmp %", pct(r.cmpPct), "cmpPct", pct(L.cmpPct))}${tile("aDOT", fix(r.adot, 1), "", fix(L.adot, 1))}
          ${tile("Sack %", pct(r.sackPct), "sackPct", pct(L.sackPct))}${tile("Press %", pct(r.pressPct, 0), "pressPct", pct(L.pressPct, 0), "PFR pressures / dropbacks")}
        </div>
      </div>
    </div>
    <div class="an-qb-rush">
      <div class="an-qb-blockh">Rushing <span class="an-dsub">${r.rushAtt} carries · ${r.rushYds} yds · ${r.rushTd} TD</span></div>
      ${rushHeadline(r, ref)}
      <div class="an-note">${r.des} designed run${r.des === 1 ? "" : "s"} (${r.desYds} yds) · ${r.scr} scramble${r.scr === 1 ? "" : "s"} (${r.scrYds} yds) · EPA/carry ${isNum(r.rushEpa) ? signed(r.rushEpa, 2) : "–"}</div>
      <div class="an-dlinks"><a href="#/player/${encodeURIComponent(r.gsis)}${q ? "?" + q : ""}">Player page →</a><a href="${depth}" target="_blank" rel="noopener">Depth chart ↗</a></div>
    </div></div>`;
}

export const qbAnchor = { id: null, top: null };

// PURE (no DOM): the table's markup. view: { ref (qbReference), windowName, teams, lgZones, minDb, pfrNote }.
export function qbTableHtml(allRows, st, query, view = {}) {
  const sortKey = COLS.some((c) => c.k === st.sort) || ["name", "g"].includes(st.sort) ? st.sort : DEFAULT_SORT;
  const minDb = view.minDb ?? QB_MIN_DB;
  const rows = sortQbRows(allRows.filter((r) => r.db >= minDb), sortKey, st.dir);
  const q = query || "", ref = view.ref;
  const nCols = 3 + COLS.length + 1;
  const th = (k, h, t, cls = "") => `<th class="${cls}${sortKey === k ? " sorted " + st.dir : ""}" data-sort="${k}" title="${esc(t)}">${h}</th>`;
  const groupRow = `<tr class="an-grp"><th colspan="3"></th>${GROUPS.map(([g, l]) => `<th colspan="${COLS.filter((c) => c.grp === g).length}" class="g-${g} gs">${l}</th>`).join("")}<th></th></tr>`;
  const head = `<tr>${th("rank", "#", "Rank", "c-rank")}${th("name", "Player", "Player and team", "c-name")}${th("g", "G", "Games in the window")}${COLS.map((c) => th(c.k, c.h, c.t, "g-" + c.grp + (c.gs ? " gs" : ""))).join("")}<th class="c-spark" title="Weekly EPA per dropback; hover a point for the week">EPA/db by week</th></tr>`;
  const cell = (c, r) => {
    const v = r[c.k];
    const tier = TIERED.has(c.k) ? qbTier(c.k, v, ref?.cuts) : "";
    let title = "";
    if (c.k === "pressPct" && isNum(v)) title = `PFR: ${r.pfrWeeks} week${r.pfrWeeks === 1 ? "" : "s"}, ${r.pfrDb} dropbacks`;
    if (c.k === "rushAttG" || c.k === "rushYdsG") title = `${r.rushAtt} carries (${r.des} designed, ${r.scr} scrambles), ${r.rushYds} yds in ${r.g} games`;
    return `<td class="num g-${c.grp}${c.gs ? " gs" : ""}${tier ? " t-" + tier : ""}"${title ? ` title="${esc(title)}"` : ""}><span>${c.f(v)}</span></td>`;
  };
  const body = rows.map((r, i) => {
    const open = st.open === r.gsis;
    const depth = `../#/team/${encodeURIComponent(r.team)}/player/${encodeURIComponent(r.gsis)}`;
    return `<tr class="an-row${open ? " open" : ""}" data-id="${esc(r.gsis)}" tabindex="0" aria-expanded="${open}">
      <td class="c-rank">${i + 1}</td>
      <td class="c-name"><a class="an-pname" href="#/player/${encodeURIComponent(r.gsis)}${q ? "?" + q : ""}">${esc(r.name)}</a>${teamPill(r.team, view.teams, q)}<a class="an-dc" href="${depth}" target="_blank" rel="noopener" title="Open his depth-chart card in a new tab" aria-label="Depth chart">↗</a></td>
      <td class="num">${r.g}</td>
      ${COLS.map((c) => cell(c, r)).join("")}
      <td class="c-spark">${epaSpark(r.series, st)}</td></tr>`
      + (open ? `<tr class="an-detail"><td colspan="${nCols}"><div class="an-detail-wrap">${detailHtml(r, st, q, ref, view.windowName || "Window", view.lgZones)}</div></td></tr>` : "");
  }).join("");
  return `<div class="an-tbar">
      <label class="an-min">Min dropbacks <input type="number" min="0" step="1" value="${minDb}" data-min></label>
      <span class="an-count">${rows.length} quarterback${rows.length === 1 ? "" : "s"}</span>
      <span class="an-legend" title="The depth charts' rating colours, among QBs: each value against the QB reference pool in this window (elite at its 90th percentile or above, then the 70th, 40th and 15th; low below). Sack % and Press %: lower is better. Rush columns colour only the runners (weak and low stay grey).">
        <i class="t-elite"></i><i class="t-strong"></i><i class="t-avg"></i><i class="t-weak"></i><i class="t-flat"></i><span>elite → low among QBs</span></span>
      <span class="an-hint">Click a row to open it</span>
    </div>
    <div class="an-tscroll"><table class="an-table an-qb-table"><thead>${groupRow}${head}</thead><tbody>${body || `<tr><td colspan="${nCols}" class="an-empty">No quarterbacks match these filters.</td></tr>`}</tbody></table></div>`;
}

// Pass-interference no-plays are in no QB figure, so the receivers' PI switch is not on the QB pages.
// The page's own hash: filters.toQuery plus `mindb` (the minimum dropbacks box, default 20), kept out of the shared
// state so the Usage page's Min targets is untouched.
export const minDbOf = (query) => { const v = new URLSearchParams(String(query || "").replace(/^\?/, "")).get("mindb"); return v !== null && Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : QB_MIN_DB; };
export function qbQuery(st, minDb) {
  const q = new URLSearchParams(toQuery(st));
  if (minDb !== QB_MIN_DB) q.set("mindb", minDb);
  return q.toString();
}

// Same "picked season[ + previous season]" prefix as player.js's seasonLabel (D184).
export function seasonLabel(st) {
  return `${st.season}${st.with2025 ? " + " + (st.season - 1) : ""}`;
}

function windowText(st, weeks) {
  if (!weeks.length) return "no games";
  const span = weeks.length === 1 ? weekLabel(weeks[0], st.season) : `${weekLabel(weeks[0], st.season)} to ${weekLabel(weeks[weeks.length - 1], st.season)}`;
  return st.window === "last3" ? `each club's last 3 games (${span})` : span;
}
export function pfrNote(pfrThrough, latestKey, season) {
  if (!latestKey) return "";
  if (!pfrThrough) return "PFR pressure not yet published for this window";
  return pfrThrough < latestKey ? `Pressure % through ${weekLabel(pfrThrough, season)} (PFR runs about a week behind)` : "";
}

export async function renderQb(ctx, query) {
  const { root, asof, isCurrent } = ctx;
  const st = fromQuery(query);
  const minDb = minDbOf(query);
  document.title = "Quarterbacks · NFL Analytics";
  const go = (n, md = minDb) => { const q = qbQuery(n, md); location.hash = `#/qb${q ? "?" + q : ""}`; };
  if (!root.querySelector(".an-qb")) root.innerHTML = `<div class="an-msg">Loading quarterbacks…</div>`;
  let data, teams;
  try {
    [data, teams] = await Promise.all([loadFor(seasonsOf(st), st), loadTeams().then((j) => j.teams || []).catch(() => [])]);
  } catch (e) {
    if (!isCurrent()) return;
    const notBuilt = e.status === 404 || e.status === 503;
    root.innerHTML = notBuilt
      ? `<div class="an-msg"><div class="an-msg-title">No ${st.season} analytics yet</div>The analytics files for ${st.season} have not been compiled yet.</div>`
      : `<div class="an-msg an-msg-err">Could not load the analytics data: ${esc(e.message)}</div>`;
    return;
  }
  if (!isCurrent()) return;
  const agg = aggregateQb(data.blocks, data.players, st);
  // The league reference always comes from the whole league (no team or opponent), the same window.
  const lgAgg = st.team || st.opp ? aggregateQb(data.blocks, data.players, { ...st, team: "", opp: "" }) : agg;
  const ref = qbReference(lgAgg.rows);
  for (const r of agg.rows) r.name = displayName(r.gsis, data.players);
  const windowName = st.window === "last3" ? "Last 3" : st.window === "range" && agg.weeks.length ? `${weekLabel(agg.weeks[0], st.season)}–${weekLabel(agg.weeks[agg.weeks.length - 1], st.season)}` : "Season";
  const clubTeams = [...new Set(clubGames(data.blocks).map((g) => g.team))].sort();
  const teamsByAbbr = new Map(teams.map((t) => [t.abbr, t]));
  if (asof) {
    const m = data.manifests.find((x) => x.season === st.season) || data.manifests[0];
    const last = (m?.weeks || []).reduce((a, b) => (!a || b.week > a.week ? b : a), null);
    asof.textContent = last ? `Through W${last.week}` : ""; asof.hidden = !last;
  }
  const pnote = pfrNote(lgAgg.pfrThrough, lgAgg.latestKey, st.season);
  const qs = qbQuery({ ...st, open: "" }, minDb);
  root.innerHTML = `<section class="an-qb">
    <div class="an-head">
      <h1>Quarterbacks</h1>
      <div class="an-sub">${esc(seasonLabel(st))} · ${esc(windowText(st, agg.weeks))}${st.team ? ` · ${esc(st.team)}` : ""}${st.opp ? ` · vs ${esc(st.opp)}` : ""}</div>
      ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    </div>
    <div class="an-sub an-ref">League reference and colour tiers: ${esc(ref.text)}${pnote ? ` · ${esc(pnote)}` : ""}</div>
    <div class="an-filters"></div>
    <div class="an-tablewrap"></div>
    <p class="an-foot">Dropbacks, attempts, completions, yards, TD, INT, aDOT, EPA, success, CPOE, sacks, scrambles and designed runs: nflverse play-by-play. Play action and blitz %: FTN charting. Pressure %: PFR advanced stats (a week behind). Time to throw and expected completion: Next Gen Stats. No QBR.</p>
  </section>`;
  renderFilterBar(root.querySelector(".an-filters"), st, { keys: data.keys, teams: clubTeams }, (n) => go(n));
  const el = root.querySelector(".an-tablewrap");
  el.innerHTML = qbTableHtml(agg.rows, st, qs, { ref, windowName, teams: teamsByAbbr, lgZones: lgAgg.lgZones, minDb });
  el.querySelectorAll("th[data-sort]").forEach((h) => h.addEventListener("click", () => {
    const k = h.dataset.sort === "rank" ? DEFAULT_SORT : h.dataset.sort;
    const cur = COLS.some((c) => c.k === st.sort) || ["name", "g"].includes(st.sort) ? st.sort : DEFAULT_SORT;
    const dir = cur === k ? (st.dir === "desc" ? "asc" : "desc") : k === "name" ? "asc" : "desc";
    go({ ...st, sort: k, dir });
  }));
  const min = el.querySelector("[data-min]");
  min?.addEventListener("change", () => go(st, Math.max(0, Math.floor(+min.value || 0))));
  const toggle = (tr) => {
    const id = tr.dataset.id;
    qbAnchor.id = id; qbAnchor.top = tr.getBoundingClientRect().top;
    if (st.open === id) {
      const wrap = tr.nextElementSibling?.querySelector(".an-detail-wrap");
      if (wrap) { wrap.classList.add("closing"); setTimeout(() => go({ ...st, open: "" }), 170); } else go({ ...st, open: "" });
    } else go({ ...st, open: id });
  };
  el.querySelectorAll("tr.an-row").forEach((tr) => {
    tr.addEventListener("click", (e) => { if (!e.target.closest("a")) toggle(tr); });
    tr.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !e.target.closest("a")) { e.preventDefault(); toggle(tr); } });
  });
  if (qbAnchor.id) {
    const tr = [...root.querySelectorAll("tr.an-row")].find((t) => t.dataset.id === qbAnchor.id);
    if (tr) window.scrollBy(0, tr.getBoundingClientRect().top - qbAnchor.top);
    qbAnchor.id = null;
  }
}
