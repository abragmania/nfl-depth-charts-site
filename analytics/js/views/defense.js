// Defense: the team defence leaderboard (#/defense). D179: defence is team-only in v1, so one row per club, and the
// expanded row is the defence page: the zone field FACED (what opponents complete, gain and add there against the
// league) and the weekly EPA/play allowed with the league line (D181 totals). Tiers are among the clubs, lower
// allowed = better where that applies (agg_team.js DEF_TIER). Every figure comes from agg_team.js (pure).
import { fromQuery, toQuery, seasonsOf, weekLabel } from "../filters.js";
import { loadFor, loadTeams } from "../data.js";
import { aggregateTeams, teamReference, teamTier, teamZones, sortTeamRows, DEF_TIER } from "../agg_team.js";
import { TIER_NAMES } from "../agg.js";
import { renderFilterBar } from "../filterbar.js";
import { esc, NA, isNum, pct, fix, signed, teamPill, qbStrips, pfrNote, seasonLabel } from "./qb.js";
import { windowName } from "./qbplayer.js";
import { teamPageState, clubZoneField, clubZoneLegend, zonePlaysHtml, TEAM_ZONE_MODES } from "./team.js";

const P = (v, d = 1) => (isNum(v) ? pct(v, d) : NA);
export const DEF_COLS = [
  { k: "playsG", h: "Plays/g", t: "Plays faced per game: pass attempts, sacks, scrambles and designed runs", f: (v) => fix(v, 1), grp: "v" },
  { k: "epaPlay", h: "EPA/play", t: "EPA per play allowed (lower is better)", f: (v) => signed(v, 3), grp: "e" },
  { k: "epaDb", h: "EPA/db", t: "EPA per dropback allowed (sacks and scrambles included; lower is better)", f: (v) => signed(v, 3), grp: "e" },
  { k: "epaCar", h: "EPA/car", t: "EPA per designed run allowed (lower is better)", f: (v) => signed(v, 3), grp: "e" },
  { k: "succPct", h: "Succ %", t: "Share of plays faced that were successful for the offence (lower is better)", f: (v) => P(v, 1), grp: "e" },
  { k: "sackPct", h: "Sack %", t: "Sacks / dropbacks faced", f: (v) => P(v, 1), grp: "r" },
  { k: "pressPct", h: "Press %", t: "PFR: the opposing quarterbacks' pressured dropbacks / their dropbacks against this defence (a week behind; hover a cell for the defender sum)", f: (v) => P(v, 1), grp: "r" },
  { k: "blitzPct", h: "Blitz %", t: "FTN: dropbacks faced with 1+ blitzers / dropbacks faced charted", f: (v) => P(v, 0), grp: "r" },
  { k: "cmpPct", h: "Cmp %", t: "Completion % allowed (lower is better)", f: (v) => P(v, 1), grp: "c" },
  { k: "adot", h: "aDOT", t: "Air yards per attempt faced", f: (v) => fix(v, 1), grp: "c" },
  { k: "explPct", h: "Expl %", t: "Explosive plays allowed: runs of 10+ yards and completions of 20+ / plays faced (lower is better)", f: (v) => P(v, 1), grp: "c" },
];
const GROUPS = [["v", "Volume"], ["e", "EPA allowed"], ["r", "Pass rush"], ["c", "Coverage"]];
DEF_COLS.forEach((c, i) => { c.gs = i === 0 || DEF_COLS[i - 1].grp !== c.grp; });
const SORTABLE = new Set([...DEF_COLS.map((c) => c.k), "team", "g"]);
// First click on a column sorts best-first: ascending where lower allowed is better.
export const bestDir = (k) => (DEF_TIER[k] === -1 || k === "team" ? "asc" : "desc");
export const defSort = (query, st) => {
  const has = new URLSearchParams(String(query || "").replace(/^\?/, "")).has("sort");
  return has && SORTABLE.has(st.sort) ? { sort: st.sort, dir: st.dir } : { sort: "epaPlay", dir: "asc" };
};

// Weekly EPA/play allowed as a tiny bar strip for the table (red above zero, green below: allowed is bad).
function defSpark(series) {
  const W = 92, H = 22, n = series.length, bw = n ? Math.max(2, Math.min(9, (W - 2) / n - 2)) : 0;
  const mid = H / 2, span = 0.5;
  return `<svg class="an-def-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="EPA per play allowed by week"><line x1="0" x2="${W}" y1="${mid}" y2="${mid}"/>`
    + series.map((s, i) => {
      const x = 1 + i * (bw + 2);
      const lab = `${weekLabel(s.key)}${s.opp ? ` vs ${s.opp}` : ""}: ${isNum(s.epaPlay) ? signed(s.epaPlay, 3) + " EPA/play allowed" : "bye"}`;
      if (!isNum(s.epaPlay)) return `<rect x="${x}" y="0" width="${bw}" height="${H}" fill="transparent"><title>${esc(lab)}</title></rect>`;
      const h = Math.max(1, Math.min(1, Math.abs(s.epaPlay) / span) * (mid - 1));
      return `<rect class="${s.epaPlay > 0 ? "bad" : "good"}" x="${x}" y="${(s.epaPlay > 0 ? mid - h : mid).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="1"><title>${esc(lab)}</title></rect>`;
    }).join("") + `</svg>`;
}

// The pressure tooltip: the QB-side figure shown, the defender sum beside it (the lead's ruling, 2026-09-24, D178 flag).
export const pressTip = (D) => `Opposing QBs' PFR pressures / their dropbacks over ${D.pfrWeeks} week${D.pfrWeeks === 1 ? "" : "s"}. Defender pressures summed (double counts shared pressures): ${isNum(D.pressPctDef) ? (D.pressPctDef * 100).toFixed(1) + "%" : "–"}`;

const ui = { zoneMode: "cmpPct", zone: null, team: null };

function detailHtml(r, st, q, ref, wn, lgZones, players) {
  const D = r.def, L = ref.lg.def;
  const maxPlays = Math.max(70, ...r.series.def.map((s) => s.plays || 0));
  const strips = [
    { k: "epaPlay", label: "EPA/play allowed", signed: true, span: 0.4, fmt: (v) => signed(v, 3), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: D.epaPlay, totalText: `${wn} ${isNum(D.epaPlay) ? signed(D.epaPlay, 3) : "–"}`, avg: L.epaPlay, avgText: `lg ${isNum(L.epaPlay) ? signed(L.epaPlay, 3) : "–"}`, tier: (v) => teamTier("def", "epaPlay", v, ref.cuts) },
    { k: "plays", label: "Plays faced", signed: false, span: maxPlays * 1.05, fmt: (v) => `${v} plays`, short: (v) => String(v), total: D.plays, totalText: `${wn} ${D.plays}`, avg: L.playsG, avgText: `lg ${isNum(L.playsG) ? L.playsG.toFixed(1) : "–"}/g` },
  ];
  const zones = teamZones(D, lgZones);
  const tile = (label, val, k, lg, title = "") => {
    const t = k ? teamTier("def", k, D[k], ref.cuts) : "";
    return `<div class="an-tile${t ? " t-" + t : ""}"${title ? ` title="${esc(title)}"` : ""}><span>${label}</span><b>${val}</b>${lg && !String(lg).includes("an-na") ? `<em> · lg ${lg}</em>` : ""}</div>`;
  };
  const PP = (v, d = 1) => (isNum(v) ? pct(v, d) + "%" : NA);
  return `<div class="an-detail-in an-def-din">
    <div class="an-dcol an-def-w"><div class="an-dh">Week by week <span class="an-dsub">${D.plays} plays faced in ${D.g} game${D.g === 1 ? "" : "s"}</span></div>${qbStrips(r.series.def.map((s) => ({ ...s, dnp: false })), strips, { season: st.season, bw: 28, gap: 7, sh: 50, lw: 128, rw: 70 })}</div>
    <div class="an-dcol"><div class="an-dh">Zone field faced <span class="an-dsub">what opponents do there vs the league</span></div>
      <div data-zones>${zoneBlock(zones, st, players, q)}</div></div>
    <div class="an-dcol"><div class="an-dh">Pass rush</div><div class="an-dtiles">
      ${tile("Sack %", PP(D.sackPct), "sackPct", PP(L.sackPct), "Sacks / dropbacks faced")}
      ${tile("Press %", PP(D.pressPct), "pressPct", PP(L.pressPct), pressTip(D))}
      ${tile("Blitz %", PP(D.blitzPct, 0), "", PP(L.blitzPct, 0), "FTN: 1+ blitzers")}
      ${tile("Expl %", PP(D.explPct), "explPct", PP(L.explPct), "Runs of 10+ and completions of 20+ allowed / plays faced")}
      <div class="an-dlinks"><a href="#/team/${encodeURIComponent(r.team)}${q ? "?" + q : ""}">Offense →</a><a href="../#/team/${encodeURIComponent(r.team)}" target="_blank" rel="noopener">Depth chart ↗</a></div>
    </div></div></div>`;
}
function zoneBlock(zones, st, players, q) {
  return `<div class="an-pl-zhead"><div class="an-seg" data-zmode>${TEAM_ZONE_MODES.map((m) => `<button type="button" data-v="${m.k}" class="${ui.zoneMode === m.k ? "on" : ""}">${m.label}</button>`).join("")}</div>${clubZoneLegend(ui.zoneMode, "def")}</div>
    <div class="an-pl-zbody an-zf-inv">${clubZoneField(zones, ui.zoneMode, { selected: ui.zone, small: true }, "def")}${ui.zone ? `<div class="an-pl-plays an-def-plays">${zonePlaysHtml(zones, ui.zone, st, players, q, "def")}</div>` : ""}</div>`;
}

export const defAnchor = { id: null, top: null };

// PURE (no DOM): the table's markup. view: { ref, teams, windowName, lgZones, players, sort, dir }.
export function defTableHtml(rows, st, query, view) {
  const { ref, sort, dir } = view;
  const list = sortTeamRows(rows, "def", sort, dir);
  const q = query || "", nCols = 3 + DEF_COLS.length + 1;
  const th = (k, h, t, cls = "") => `<th class="${cls}${sort === k ? " sorted " + dir : ""}" data-sort="${k}" title="${esc(t)}">${h}</th>`;
  const groupRow = `<tr class="an-grp"><th colspan="3"></th>${GROUPS.map(([g, l]) => `<th colspan="${DEF_COLS.filter((c) => c.grp === g).length}" class="g-${g} gs">${l}</th>`).join("")}<th></th></tr>`;
  const head = `<tr>${th("rank", "#", "Rank")}${th("team", "Defense", "Club", "c-name")}${th("g", "G", "Games in the window")}${DEF_COLS.map((c) => th(c.k, c.h, c.t, "g-" + c.grp + (c.gs ? " gs" : ""))).join("")}<th class="c-spark" title="EPA per play allowed by week: red above zero (bad), green below">EPA/play by week</th></tr>`;
  const body = list.map((r, i) => {
    const open = st.open === r.team;
    const cells = DEF_COLS.map((c) => {
      const v = r.def[c.k], t = teamTier("def", c.k, v, ref.cuts);
      const title = c.k === "pressPct" && isNum(v) ? pressTip(r.def) : "";
      return `<td class="num g-${c.grp}${c.gs ? " gs" : ""}${t ? " t-" + t : ""}"${title ? ` title="${esc(title)}"` : ""}><span>${c.f(v)}</span></td>`;
    }).join("");
    return `<tr class="an-row${open ? " open" : ""}" data-id="${esc(r.team)}" tabindex="0" aria-expanded="${open}">
      <td class="c-rank">${i + 1}</td>
      <td class="c-name">${teamPill(r.team, view.teams, q)}<span class="an-def-name">${esc(view.teams?.get(r.team)?.nickname || view.teams?.get(r.team)?.name || r.team)}</span></td>
      <td class="num">${r.g}</td>${cells}<td class="c-spark">${defSpark(r.series.def)}</td></tr>`
      + (open ? `<tr class="an-detail"><td colspan="${nCols}"><div class="an-detail-wrap">${detailHtml(r, st, q, ref, view.windowName, view.lgZones, view.players)}</div></td></tr>` : "");
  }).join("");
  return `<div class="an-tbar">
      <span class="an-count">${list.length} defense${list.length === 1 ? "" : "s"}</span>
      <span class="an-legend" title="Each value against every club's in this window: elite at the clubs' 90th percentile or better, then the 70th, 40th and 15th; low below. Lower allowed is better for EPA, success, completion % and explosive plays; higher is better for sack % and pressure %. Plays/g, blitz % and aDOT are not coloured.">
        ${TIER_NAMES.map((t) => `<i class="t-${t}"></i>`).join("")}<span>elite → low among the clubs</span></span>
      <span class="an-hint">Click a row to open the defense</span>
    </div>
    <div class="an-tscroll"><table class="an-table an-def-table"><thead>${groupRow}${head}</thead><tbody>${body || `<tr><td colspan="${nCols}" class="an-empty">No games in this window.</td></tr>`}</tbody></table></div>`;
}

export async function renderDefense(ctx, query) {
  const { root, asof, isCurrent } = ctx;
  const st = fromQuery(query);
  const { sort, dir } = defSort(query, st);
  document.title = "Defense · NFL Analytics";
  const go = (n) => { const q = toQuery(n); location.hash = `#/defense${q ? "?" + q : ""}`; };
  if (!root.querySelector(".an-def")) root.innerHTML = `<div class="an-msg">Loading defenses…</div>`;
  let data, teams;
  try {
    [data, teams] = await Promise.all([
      loadFor(seasonsOf(st), st),
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
  if (ui.team !== st.open) { ui.team = st.open; ui.zone = null; }
  const pst = teamPageState(st);
  const agg = aggregateTeams(data.blocks, data.players, pst, { playsFor: st.open || null });
  const ref = teamReference(agg.rows);
  const wn = windowName(st, agg.weeks);
  const pnote = pfrNote(agg.pfrThrough, agg.latestKey, st.season);
  if (asof) {
    const m = data.manifests.find((x) => x.season === st.season) || data.manifests[0];
    const last = (m?.weeks || []).reduce((a, b) => (!a || b.week > a.week ? b : a), null);
    asof.textContent = last ? `Through W${last.week}` : ""; asof.hidden = !last;
  }
  const qs = toQuery({ ...st, open: "" });
  const span = agg.weeks.length ? (agg.weeks.length === 1 ? weekLabel(agg.weeks[0], st.season) : `${weekLabel(agg.weeks[0], st.season)} to ${weekLabel(agg.weeks[agg.weeks.length - 1], st.season)}`) : "no games";
  root.innerHTML = `<section class="an-def an-pl">
    <div class="an-head">
      <h1>Defense</h1>
      <div class="an-sub">${esc(seasonLabel(st))} · ${esc(span)}${st.window === "last3" ? " (each club's last 3 games)" : ""} · league reference: ${esc(ref.text)}${pnote ? " · " + esc(pnote) : ""}</div>
      ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet.</div>` : ""}
    </div>
    <div class="an-filters"></div>
    <div class="an-tablewrap"></div>
    <p class="an-foot">Plays faced, EPA, success, sacks, completions, aDOT, explosive plays and the zone field: nflverse play-by-play (defensive pass interference no-plays are left out). Blitz: FTN charting. Pressure: PFR advanced stats, the opposing quarterbacks' pressured dropbacks against each defence; the tooltip adds the club's defenders' pressures summed, which double counts a throw two men pressured${agg.unmapped.length ? ` (${agg.unmapped.length} defender-week row${agg.unmapped.length === 1 ? "" : "s"} could not be placed on a club)` : ""}. Zone references pool every attempt in the window.</p>
  </section>`;
  renderFilterBar(root.querySelector(".an-filters"), st, { keys: data.keys, teams: [] }, go);
  const el = root.querySelector(".an-tablewrap");
  el.innerHTML = defTableHtml(agg.rows, st, qs, { ref, teams, windowName: wn, lgZones: agg.lgZones, players: data.players, sort, dir });
  el.querySelectorAll("th[data-sort]").forEach((h) => h.addEventListener("click", () => {
    const k = h.dataset.sort === "rank" ? "epaPlay" : h.dataset.sort;
    const d = sort === k ? (dir === "desc" ? "asc" : "desc") : bestDir(k);
    go({ ...st, sort: k, dir: d });
  }));
  const toggle = (tr) => {
    const id = tr.dataset.id;
    defAnchor.id = id; defAnchor.top = tr.getBoundingClientRect().top;
    const keep = { ...st, sort, dir };
    if (st.open === id) {
      const wrap = tr.nextElementSibling?.querySelector(".an-detail-wrap");
      if (wrap) { wrap.classList.add("closing"); setTimeout(() => go({ ...keep, open: "" }), 170); } else go({ ...keep, open: "" });
    } else go({ ...keep, open: id });
  };
  el.querySelectorAll("tr.an-row").forEach((tr) => {
    tr.addEventListener("click", (e) => { if (!e.target.closest("a")) toggle(tr); });
    tr.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !e.target.closest("a")) { e.preventDefault(); toggle(tr); } });
  });
  // The open row's zone field: its measure switch and the plays behind a cell repaint in place.
  const zbox = el.querySelector("[data-zones]");
  const openRow = agg.rows.find((r) => r.team === st.open);
  if (zbox && openRow) {
    const zones = teamZones(openRow.def, agg.lgZones);
    const repaint = () => { zbox.innerHTML = zoneBlock(zones, st, data.players, qs); wire(); };
    const wire = () => {
      zbox.querySelectorAll("[data-zmode] button").forEach((b) => b.addEventListener("click", () => { ui.zoneMode = b.dataset.v; repaint(); }));
      zbox.querySelectorAll("[data-zone]").forEach((c) => c.addEventListener("click", () => { ui.zone = ui.zone === c.dataset.zone ? null : c.dataset.zone; repaint(); }));
      zbox.querySelector("[data-close]")?.addEventListener("click", () => { ui.zone = null; repaint(); });
    };
    wire();
  }
  if (defAnchor.id) {
    const tr = [...root.querySelectorAll("tr.an-row")].find((t) => t.dataset.id === defAnchor.id);
    if (tr) window.scrollBy(0, tr.getBoundingClientRect().top - defAnchor.top);
    defAnchor.id = null;
  } else if (st.open) {
    root.querySelector("tr.an-row.open")?.scrollIntoView({ block: "center" });
  }
}

