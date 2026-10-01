// Receivers (#/receivers; the old Usage page, D193): the pass-catchers' leaderboard (D177's first priority, with fantasy
// in mind), WRs and TEs by default, backs on their chip; every filter, the sort, the minimum and the open row live in
// the hash. The table itself (column order Production, Opportunity, Efficiency, then the ancillary group) is table.js.
import { fromQuery, toQuery, seasonsOf, weekLabel, POSITIONS } from "../filters.js";
import { loadFor, loadTeams, loadStatusFeed } from "../data.js";
import { aggregateUsage, clubGames, usageReference, REF_POS, POOL_PER_GAME, POOL_FLOOR } from "../agg.js";
import { renderFilterBar } from "../filterbar.js";
import { renderTable, anchor, withRzFigures, viewFrom, withView, statusApplies, hlOf, withHl, scrollToHl, receiversWantsDeciding, withViewSort } from "../table.js";
import { decorateDeciding } from "../deciding.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// The column set (D224 F: view=deciding|standard|all; a legacy more=1 reads as All) rides beside the shared filters (table.js withView).
// D225b: hl (a player page's ranking link) keeps its highlight across the reader's own changes, which never re-scroll to it.
let hl = "";
let curView = "";
const go = (st) => { const view = st.view || curView; const q = withHl(withView(toQuery(st), view, { ...st, view }), hl); location.hash = `#/receivers${q ? "?" + q : ""}`; };

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

export async function renderUsage(ctx, query) {
  const { root, isCurrent } = ctx;
  const st = withViewSort({ ...fromQuery(query), view: viewFrom(query) }, query); // a Deciding address with no sort opens on DK/g
  hl = hlOf(query);
  curView = st.view;
  document.title = "Receivers · NFL Analytics";
  if (!root.querySelector(".an-usage")) root.innerHTML = `<div class="an-msg">Loading receivers…</div>`;
  let data, teams, statusFeed, payload = null;
  try {
    // Teams (for the player column's colour pill) and the D196 injury-status feed load alongside the analytics
    // data; both are decorative on failure (loadTeams already falls back, loadStatusFeed never throws), never
    // fatal to the leaderboard.
    [data, payload, statusFeed] = await Promise.all([loadFor(seasonsOf(st), st), loadTeams().catch(() => null), loadStatusFeed()]);
    teams = payload?.teams || [];
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
  // D224 A: red-zone rates and shares on the rows (the shares are blank under an opponent, down or quarter filter); the league reference rows carry them too so the share column has position tiers.
  withRzFigures(rows, data.blocks, data.players, st, "rec");
  const ref = usageReference(withRzFigures(aggregateUsage(data.blocks, data.players, { ...st, team: "", opp: "", pos: {} }).rows, data.blocks, data.players, { ...st, team: "", opp: "", pos: {} }, "rec"));
  const shownPos = [...REF_POS].filter((p) => rows.some((r) => r.pos === p));
  const refLine = `League reference and colour tiers, by position: players with ${POOL_PER_GAME}+ targets/game (min ${POOL_FLOOR}) in the window (${shownPos.map((p) => `${p}s ${ref.at(p).n}`).join(" · ") || "none"})`;
  const windowName = st.window === "last3" ? "Last 3" : st.window === "range" && weeks.length ? `${weekLabel(weeks[0], st.season)}–${weekLabel(weeks[weeks.length - 1], st.season)}` : "Season";
  const clubTeams = [...new Set(clubGames(data.blocks).map((g) => g.team))].sort();
  const teamsByAbbr = new Map(teams.map((t) => [t.abbr, t]));

  const posText = POSITIONS.filter((p) => st.pos[p] === "in").join(" · ") || "All positions";
  const exText = POSITIONS.filter((p) => st.pos[p] === "out");
  // Every row link (team pill, player page, depth chart) is built from this - it must not carry the currently
  // open row into the address a reader lands on (👁 fix round finding, D193-adjacent): matches qb.js/rushing.js's
  // own `qs`, which already excludes `open`.
  const qs = toQuery({ ...st, open: "" });
  root.innerHTML = `<section class="an-usage">
    <div class="an-head">
      <h1>Receivers</h1>
      <div class="an-sub">${esc(seasonLabel(st))} · ${esc(windowText(st, weeks))} · ${esc(posText)}${exText.length ? ` · excluding ${esc(exText.join(", "))}` : ""}${st.team ? ` · ${esc(st.team)}` : ""}${st.opp ? ` · vs ${esc(st.opp)}` : ""}</div>
      ${data.missing.length ? `<div class="an-warn">${esc(data.missing.join(", "))} files are not built yet; showing ${esc(seasonsOf(st).filter((s) => !data.missing.includes(s)).join(", "))} only.</div>` : ""}
    </div>
    <div class="an-sub an-ref">${esc(refLine)}</div>
    <div class="an-filters"></div>
    <div class="an-tablewrap"></div>
    <p class="an-foot">Targets, air yards, receptions, EPA and zones: nflverse play-by-play. Routes, route %, TPRR, YPRR: heatradar.app (charted; a week under 8 routes is not listed). Snaps: nflverse snap counts. Target share counts only the games he played. DK: DraftKings Classic points from the same play rows, a lost fumble included (no 2-point conversions or return touchdowns; a fumble lost on a kick or punt return is not in the rows).</p>
  </section>`;
  renderFilterBar(root.querySelector(".an-filters"), st, { keys: data.keys, teams: clubTeams }, go);
  // D196: badges are current-season only - statusApplies gates on the feed's own season against the window shown.
  const status = statusApplies(st, statusFeed.season) ? statusFeed.players : {};
  // D224 F: the Deciding set's last-3, this-week and status figures, only when that set is (or a sort needs it) on screen.
  if (receiversWantsDeciding(st)) { try { decorateDeciding(rows, "rec", { blocks: data.blocks, players: data.players, st, payload }); } catch (e) { console.warn("Deciding figures unavailable:", e); } }
  renderTable(root.querySelector(".an-tablewrap"), rows, st, qs, go, { ref, windowName, teams: teamsByAbbr, statusSeason: statusFeed.season, hl }, status);
  // Keep the clicked row where the reader clicked it rather than letting the re-render jump the page.
  if (anchor.id) {
    const tr = [...root.querySelectorAll("tr.an-row")].find((t) => t.dataset.id === anchor.id);
    if (tr) window.scrollBy(0, tr.getBoundingClientRect().top - anchor.top);
    anchor.id = null;
  }
  scrollToHl(root, hl, query);
}
