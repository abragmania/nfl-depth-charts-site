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
// D192 (Adam, 2026-09-24): the headline "how good are they" measure, EPA/play allowed, leads the table with a bar
// (signed, centred on zero — a defence can be above or below the league); the rest split into pass and run defence.
const EPA_BAR_SPAN = 0.4;
export const DEF_COLS = [
  { k: "epaPlay", h: "EPA/play", t: "EPA per play allowed (lower is better)", f: (v) => signed(v, 3), grp: "ov", bar: EPA_BAR_SPAN, signed: true },
  { k: "succPct", h: "Succ %", t: "Share of plays faced that were successful for the offence (lower is better)", f: (v) => P(v, 1), grp: "ov" },
  { k: "explPct", h: "Expl %", t: "Explosive plays allowed: runs of 10+ yards and completions of 20+ / plays faced (lower is better)", f: (v) => P(v, 1), grp: "ov" },
  { k: "playsG", h: "Plays/g", t: "Plays faced per game: pass attempts, sacks, scrambles and designed runs", f: (v) => fix(v, 1), grp: "ov" },
  { k: "epaDb", h: "EPA/db", t: "EPA per dropback allowed (sacks and scrambles included; lower is better)", f: (v) => signed(v, 3), grp: "pd" },
  { k: "cmpPct", h: "Cmp %", t: "Completion % allowed (lower is better)", f: (v) => P(v, 1), grp: "pd" },
  { k: "adot", h: "aDOT", t: "Air yards per attempt faced", f: (v) => fix(v, 1), grp: "pd" },
  { k: "sackPct", h: "Sack %", t: "Sacks / dropbacks faced", f: (v) => P(v, 1), grp: "pd" },
  { k: "pressPct", h: "Press %", t: "PFR: the opposing quarterbacks' pressured dropbacks / their dropbacks against this defence, one pressure per throw at most (a week behind)", f: (v) => P(v, 1), grp: "pd" },
  { k: "pressuresG", h: "Press/g", t: "PFR: the club's defenders' pressures summed / games in the window — a throw two men pressured counts twice here (a week behind)", f: (v) => fix(v, 1), grp: "pd" },
  { k: "blitzPct", h: "Blitz %", t: "FTN: dropbacks faced with 1+ blitzers / dropbacks faced charted", f: (v) => P(v, 0), grp: "pd" },
  { k: "epaCar", h: "EPA/car", t: "EPA per designed run allowed (lower is better)", f: (v) => signed(v, 3), grp: "rd" },
  { k: "ypc", h: "YPC", t: "Yards per designed run allowed (lower is better)", f: (v) => fix(v, 1), grp: "rd" },
];
const GROUPS = [["ov", "Overall"], ["pd", "Pass defense"], ["rd", "Run defense"]];
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

// Two pressure figures, no conflict (Adam's pairing, 2026-09-24, D178): Press % is the QB side, one pressure per
// throw at most; Pressures/g is the defenders' own sum per game, so a throw two men pressured counts twice there.
export const pressPctTip = (D) => `Opposing quarterbacks' PFR pressures / their dropbacks against this defence, one pressure per throw at most, over ${D.pfrWeeks} week${D.pfrWeeks === 1 ? "" : "s"}.`;
export const pressGTip = (D) => `The club's defenders' PFR pressures summed / games in the window, over ${D.pfrWeeksDef} week${D.pfrWeeksDef === 1 ? "" : "s"} — a throw two men pressured counts twice here.`;

const ui = { zoneMode: "cmpPct", zone: null, team: null };

function detailHtml(r, st, q, ref, wn, lgZones, players) {
  const D = r.def, L = ref.lg.def;
  const maxDb = Math.max(45, ...r.series.def.map((s) => s.db || 0));
  const maxRuns = Math.max(25, ...r.series.def.map((s) => s.runs || 0));
  const strips = [
    { k: "epaPlay", label: "EPA/play allowed", signed: true, span: 0.4, fmt: (v) => signed(v, 3), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: D.epaPlay, totalText: `${wn} ${isNum(D.epaPlay) ? signed(D.epaPlay, 3) : "–"}`, avg: L.epaPlay, avgText: `lg ${isNum(L.epaPlay) ? signed(L.epaPlay, 3) : "–"}`, tier: (v) => teamTier("def", "epaPlay", v, ref.cuts) },
    { k: "epaDb", label: "EPA/dropback allowed", signed: true, span: 0.6, fmt: (v) => signed(v, 3), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: D.epaDb, totalText: `${wn} ${isNum(D.epaDb) ? signed(D.epaDb, 3) : "–"}`, avg: L.epaDb, avgText: `lg ${isNum(L.epaDb) ? signed(L.epaDb, 3) : "–"}`, tier: (v) => teamTier("def", "epaDb", v, ref.cuts) },
    { k: "epaCar", label: "EPA/carry allowed", signed: true, span: 0.6, fmt: (v) => signed(v, 3), short: (v) => signed(v, 2).replace(/^([+−])0/, "$1"), total: D.epaCar, totalText: `${wn} ${isNum(D.epaCar) ? signed(D.epaCar, 3) : "–"}`, avg: L.epaCar, avgText: `lg ${isNum(L.epaCar) ? signed(L.epaCar, 3) : "–"}`, tier: (v) => teamTier("def", "epaCar", v, ref.cuts) },
    { k: "db", label: "Dropbacks faced", signed: false, span: maxDb * 1.05, fmt: (v) => `${v} dropbacks`, short: (v) => String(v), total: D.db, totalText: `${wn} ${D.db}`, avg: L.dbG, avgText: `lg ${isNum(L.dbG) ? L.dbG.toFixed(1) : "–"}/g` },
    { k: "runs", label: "Runs faced", signed: false, span: maxRuns * 1.05, fmt: (v) => `${v} runs`, short: (v) => String(v), total: D.runs, totalText: `${wn} ${D.runs}`, avg: L.runsG, avgText: `lg ${isNum(L.runsG) ? L.runsG.toFixed(1) : "–"}/g` },
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
    <div class="an-dcol an-def-rush">
      <div class="an-dblk"><div class="an-dh">Pass rush</div><div class="an-dtiles">
        ${tile("Sack %", PP(D.sackPct), "sackPct", PP(L.sackPct), "Sacks / dropbacks faced")}
        ${tile("Press %", PP(D.pressPct), "pressPct", PP(L.pressPct), pressPctTip(D))}
        ${tile("Press/g", isNum(D.pressuresG) ? D.pressuresG.toFixed(1) : NA, "pressuresG", isNum(L.pressuresG) ? L.pressuresG.toFixed(1) : NA, pressGTip(D))}
        ${tile("Blitz %", PP(D.blitzPct, 0), "", PP(L.blitzPct, 0), "FTN: 1+ blitzers")}
        ${tile("Expl %", PP(D.explPct), "explPct", PP(L.explPct), "Runs of 10+ and completions of 20+ allowed / plays faced")}
      </div></div>
      <div class="an-dblk"><div class="an-dh">Run defense</div><div class="an-dtiles">
        ${tile("EPA/car", signed(D.epaCar, 3), "epaCar", signed(L.epaCar, 3), "EPA per designed run allowed")}
        ${tile("YPC", isNum(D.ypc) ? D.ypc.toFixed(1) : NA, "ypc", isNum(L.ypc) ? L.ypc.toFixed(1) : NA, "Yards per designed run allowed")}
        ${tile("Run succ %", PP(D.runSuccPct), "runSuccPct", PP(L.runSuccPct), "Share of designed runs faced that were successful for the offence")}
        ${tile("Expl run %", PP(D.runExplPct), "runExplPct", PP(L.runExplPct), "Designed runs of 10+ yards allowed / designed runs faced")}
      </div></div>
      <div class="an-dlinks"><a href="#/team/${encodeURIComponent(r.team)}${q ? "?" + q : ""}">Offense →</a><a href="../#/team/${encodeURIComponent(r.team)}" target="_blank" rel="noopener">Depth chart ↗</a></div>
    </div></div>`;
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
      const title = c.k === "pressPct" && isNum(v) ? pressPctTip(r.def) : c.k === "pressuresG" && isNum(v) ? pressGTip(r.def) : "";
      let bar = "";
      if (c.bar && isNum(v)) {
        if (c.signed) {
          // Each half is inset 3px from its outer edge, same as every other .an-bar's left:3px/max-width:calc(100% - 6px);
          // the fraction of that inset half-width comes from the value's share of the span.
          const ratio = Math.min(1, Math.abs(v) / c.bar).toFixed(4);
          const w = `calc((50% - 3px) * ${ratio})`;
          const left = v >= 0 ? "50%" : `calc(50% - (50% - 3px) * ${ratio})`;
          bar = `<i class="an-bar an-bar-ctr" style="left:${left};width:${w}"></i>`;
        } else {
          bar = `<i class="an-bar" style="width:${Math.min(100, (v / c.bar) * 100).toFixed(1)}%"></i>`;
        }
      }
      return `<td class="num g-${c.grp}${c.gs ? " gs" : ""}${t ? " t-" + t : ""}${bar ? " has-bar" : ""}${c.signed ? " c-signed" : ""}"${title ? ` title="${esc(title)}"` : ""}>${bar}<span>${c.f(v)}</span></td>`;
    }).join("");
    return `<tr class="an-row${open ? " open" : ""}" data-id="${esc(r.team)}" tabindex="0" aria-expanded="${open}">
      <td class="c-rank">${i + 1}</td>
      <td class="c-name">${teamPill(r.team, view.teams, q)}<span class="an-def-name">${esc(view.teams?.get(r.team)?.nickname || view.teams?.get(r.team)?.name || r.team)}</span></td>
      <td class="num">${r.g}</td>${cells}<td class="c-spark">${defSpark(r.series.def)}</td></tr>`
      + (open ? `<tr class="an-detail"><td colspan="${nCols}"><div class="an-detail-wrap">${detailHtml(r, st, q, ref, view.windowName, view.lgZones, view.players)}</div></td></tr>` : "");
  }).join("");
  return `<div class="an-tbar">
      <span class="an-count">${list.length} defense${list.length === 1 ? "" : "s"}</span>
      <span class="an-legend" title="Each value against every club's in this window: elite at the clubs' 90th percentile or better, then the 70th, 40th and 15th; low below. Lower allowed is better for EPA, success, completion %, explosive plays and YPC; higher is better for sack %, pressure % and pressures/g. Plays/g, blitz % and aDOT are not coloured.">
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
    <p class="an-foot">Plays faced, EPA, success, sacks, completions, aDOT, explosive plays and the zone field: nflverse play-by-play (defensive pass interference no-plays are left out). Blitz: FTN charting. Pressure %: PFR advanced stats, the opposing quarterbacks' pressured dropbacks against each defence, one pressure per throw at most. Pressures/g: the club's defenders' PFR pressures summed, divided by games in the window — a throw two men pressured counts twice there${agg.unmapped.length ? ` (${agg.unmapped.length} defender-week row${agg.unmapped.length === 1 ? "" : "s"} could not be placed on a club)` : ""}. Zone references pool every attempt in the window.</p>
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

