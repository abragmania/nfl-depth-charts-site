// Usage: the pass-game usage leaderboard (D177's first priority, with fantasy in mind). Receivers, tight ends
// and running backs together by default; every filter, the sort, the minimum and the open row live in the hash.
import { fromQuery, toQuery, seasonsOf, weekLabel, POSITIONS } from "../filters.js";
import { loadFor, loadTeams } from "../data.js";
import { aggregateUsage, clubGames, usageReference, REF_POS, POOL_PER_GAME, POOL_FLOOR } from "../agg.js";
import { renderFilterBar } from "../filterbar.js";
import { renderTable, anchor } from "../table.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const go = (st) => { const q = toQuery(st); location.hash = `#/usage${q ? "?" + q : ""}`; };

// Same "picked season[ + previous season]" prefix as player.js's seasonLabel (D184).
export function seasonLabel(st) {
  return `${st.season}${st.with2025 ? " + " + (st.season - 1) : ""}`;
}

function windowText(st, weeks) {
  if (!weeks.length) return "no games";
  const span = weeks.length === 1 ? weekLabel(weeks[0], st.season) : `${weekLabel(weeks[0], st.season)} to ${weekLabel(weeks[weeks.length - 1], st.season)}`;
  if (st.window === "last3") return `each club's last 3 games (${span})`;
  return span;
}

function builtText(manifests) {
  const m = manifests.find((x) => x.season === Math.max(...manifests.map((y) => y.season))) || manifests[0];
  const ws = m?.weeks || [];
  if (!ws.length) return "";
  const last = ws.reduce((a, b) => (a.week > b.week ? a : b));
  const t = last.builtAt ? new Date(last.builtAt) : null;
  return `Through W${last.week}${t && !isNaN(t) ? ` · built ${t.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}`;
}

export async function renderUsage(ctx, query) {
  const { root, asof, isCurrent } = ctx;
  const st = fromQuery(query);
  document.title = "Usage · NFL Analytics";
  if (!root.querySelector(".an-usage")) root.innerHTML = `<div class="an-msg">Loading usage…</div>`;
  let data, teams;
  try {
    // Teams (for the player column's colour pill) load alongside the analytics data; a failure there is
    // decorative, not fatal, so it falls back to an empty list rather than blocking the leaderboard.
    [data, teams] = await Promise.all([loadFor(seasonsOf(st), st), loadTeams().then((j) => j.teams || []).catch(() => [])]);
  }
  catch (e) {
    if (!isCurrent()) return;
    const notBuilt = e.status === 404 || e.status === 503;
    root.innerHTML = notBuilt
      ? `<div class="an-msg"><div class="an-msg-title">No ${st.season} analytics yet</div>The analytics files for ${st.season} have not been compiled. They are built by the data refresh; this page fills in once the first week is in.</div>`
      : `<div class="an-msg an-msg-err">Could not load the analytics data: ${esc(e.message)}</div>`;
    return;
  }
  if (!isCurrent()) return;
  const { rows, weeks } = aggregateUsage(data.blocks, data.players, st);
  // League references and tier cuts always come from the whole league at every position (each row is judged
  // against his own position's pool), so a one-club, one-opponent or one-position view still has perspective.
  const ref = usageReference(aggregateUsage(data.blocks, data.players, { ...st, team: "", opp: "", pos: {} }).rows);
  const shownPos = [...REF_POS].filter((p) => rows.some((r) => r.pos === p));
  const refLine = `League reference and colour tiers, by position: players with ${POOL_PER_GAME}+ targets/game (min ${POOL_FLOOR}) in the window (${shownPos.map((p) => `${p}s ${ref.at(p).n}`).join(" · ") || "none"})`;
  const windowName = st.window === "last3" ? "Last 3" : st.window === "range" && weeks.length ? `${weekLabel(weeks[0], st.season)}–${weekLabel(weeks[weeks.length - 1], st.season)}` : "Season";
  const clubTeams = [...new Set(clubGames(data.blocks).map((g) => g.team))].sort();
  const teamsByAbbr = new Map(teams.map((t) => [t.abbr, t]));
  if (asof) { asof.textContent = builtText(data.manifests); asof.hidden = false; }

  const posText = POSITIONS.filter((p) => st.pos[p] === "in").join(" · ") || "All positions";
  const exText = POSITIONS.filter((p) => st.pos[p] === "out");
  const qs = toQuery(st);
  root.innerHTML = `<section class="an-usage">
    <div class="an-head">
      <h1>Pass-game usage</h1>
      <div class="an-sub">${esc(seasonLabel(st))} · ${esc(windowText(st, weeks))} · ${esc(posText)}${exText.length ? ` · excluding ${esc(exText.join(", "))}` : ""}${st.team ? ` · ${esc(st.team)}` : ""}${st.opp ? ` · vs ${esc(st.opp)}` : ""}</div>
      ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet; showing ${esc(seasonsOf(st).filter((s) => !data.missing.includes(s)).join(", "))} only.</div>` : ""}
    </div>
    <div class="an-sub an-ref">${esc(refLine)}</div>
    <div class="an-filters"></div>
    <div class="an-tablewrap"></div>
    <p class="an-foot">Targets, air yards, receptions, EPA and zones: nflverse play-by-play. Routes, route %, TPRR, YPRR: heatradar.app (charted; a week under 8 routes is not listed). Snaps: nflverse snap counts. Target share counts only the games he played.</p>
  </section>`;
  renderFilterBar(root.querySelector(".an-filters"), st, { keys: data.keys, teams: clubTeams }, go);
  renderTable(root.querySelector(".an-tablewrap"), rows, st, qs, go, { ref, windowName, teams: teamsByAbbr });
  // Keep the clicked row where the reader clicked it rather than letting the re-render jump the page.
  if (anchor.id) {
    const tr = [...root.querySelectorAll("tr.an-row")].find((t) => t.dataset.id === anchor.id);
    if (tr) window.scrollBy(0, tr.getBoundingClientRect().top - anchor.top);
    anchor.id = null;
  }
}
