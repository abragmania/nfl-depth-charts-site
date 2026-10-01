// The Receivers leaderboard table (the old Usage page, D193): sortable columns, a minimum-targets box, the depth charts' five rating-tier
// colours on the share and efficiency columns, a weekly target-share sparkline per row, and a row that
// expands in place (one at a time, its gsis kept in the hash as `open`) into the player's weekly share bars
// and his target-zone grid. Inline SVG only, no library.
//
// RULES FOR EVERY CHART IN THIS APP (Adam, 2026-09-24; later screens follow them too):
// 1. PERSPECTIVE: a rate is never drawn alone. Show the league average for the same window and positions
//    beside it (a dashed "lg avg 18%" line on bars, "· lg 18.4" beside a stat), so good or bad reads at a glance.
// 2. TOTALS: anything broken down by week also prints its window total. A share totals by weighting (his
//    targets / the club attempts over the window), never as a mean of the weekly percentages.
import { sortRows, tierFromCuts, tierNote, TIER_NAMES, USAGE_TIER_KEYS, MIN_POOL } from "./agg.js";
import { weekLabel, POSITIONS, seasonsOf } from "./filters.js";
import { rzI5Shares, RZ_I5_FLOOR } from "./agg_player.js";
// D196: the injury badge and red-name rule, kit.js's own copy (built the same round by the player-page builder,
// which owns kit.js/analytics_recut.css) - re-exported here so the Receivers/QB/Running backs tables draw the
// exact same badge, in the exact same CSS (.an-stchip/.an-st-*, already in analytics_recut.css), as the player
// pages, rather than keeping a second parallel implementation.
import { statusChip, statusNameClass } from "./views/kit.js";
export { statusChip, statusNameClass };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DASH = `<span class="an-na">–</span>`;
// D196: status is CURRENT-SEASON only - never drawn on a past-season table. `st` is the page's filter state
// (season, with2025); `feedSeason` is loadStatusFeed()'s own `season` (the season the depth-chart compile most
// recently built statuses for, or null when the feed could not be had). True when the feed's season is one of
// the seasons this window actually shows (seasonsOf: the picked season, plus season-1 under "include previous").
// Callers use this to decide what status MAP to pass into the table (the real map, or {} to draw nothing).
export function statusApplies(st, feedSeason) {
  return feedSeason != null && seasonsOf(st).includes(feedSeason);
}

// Copied two-line rule from public/js/landing.js's isLightWash (relative luminance of the team's primary
// colour decides light or dark ink for the team pill below): keep the two in step if that threshold ever
// changes, same as analytics.css already does for its copied colour tokens.
function luminance(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
const isLightWash = (primary) => (luminance(primary) ?? 0) > 0.40;

// The team abbreviation as a small pill in the team's own colours (primary background, readable ink).
// `teams` is the Map<abbr, {colourPrimary, colourSecondary}> from public/js/api.js's getTeams(), or empty
// if that load failed; an unknown abbr falls back to the neutral colours set on .an-teampill itself.
function teamPill(abbr, teams, q) {
  const t = teams?.get(abbr);
  const style = t ? ` style="--team-bg:${esc(t.colourPrimary)};--team-ink:${isLightWash(t.colourPrimary) ? "#14181d" : "#fff"}"` : "";
  return `<a class="an-teampill" href="#/team/${esc(abbr)}${q ? "?" + q : ""}"${style}>${esc(abbr)}</a>`;
}
const pct = (v, d = 1) => (v === null || v === undefined ? DASH : (v * 100).toFixed(d));
const fix = (v, d) => (v === null || v === undefined ? DASH : (+v).toFixed(d));
const signed = (v, d) => (v === null || v === undefined ? DASH : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d));
const int = (v) => (v === null || v === undefined ? DASH : String(Math.round(v)));

// Tier colours (Adam, 2026-09-24): POSITION-SPECIFIC. `cuts` is one position's map from agg.js's
// usageReference(...).at(pos).cuts (or the rushing block's): each metric cut at that position's reference-pool
// 90th, 70th, 40th and 15th percentiles over the window, so a back's 20% target share reads elite among backs.
// No cuts (or too small a pool league-wide as well) leaves the value uncoloured.
export const tierOf = (key, v, cuts) => tierFromCuts(v, cuts?.[key]?.cuts);
const TIER_KEYS = new Set(USAGE_TIER_KEYS);

// Columns. `bar` draws a magnitude bar behind the number (the share columns, scaled to `max`).
// Re-cut increment 7b (D193, Adam's answer 10: "Production, Opportunity, Efficiency, then the rest; the divide doesn't
// need to be so stark"): the table reads left to right as the player page reads top to bottom. Every column keeps its
// key, value, format, tooltip and sort; the old "Targets" and "Efficiency (opp)" headers are gone. The ancillary group
// at the right (anc: "pass", purple) is a lighter label and a faint tint, never tier-coloured and never barred.
// D191's opportunity columns (Opp, Opp/g, Opp %, per-opportunity efficiency) now sit there on this page.
// DraftKings tooltips, shared with the Running backs table (views/rushing.js).
const DK_RULE = "DraftKings Classic scoring from the play rows: 1 per catch, 0.1 per rushing or receiving yard, 6 per rushing or receiving TD, +3 at 100 rushing or 100 receiving yards in a game; 0.04 per passing yard, 4 per passing TD, −1 per interception, +3 at 300 passing yards; −1 per fumble lost. No 2-point conversions or return touchdowns. Blank under a down or quarter filter (the bonuses are whole-game).";
export const DK_TIPS = {
  dkG: `DraftKings points per game: his points over the window / the games he played in it. ${DK_RULE}`,
  dk: `DraftKings points over the window, scored game by game (a bonus counts per game, never per window). ${DK_RULE}`,
};
export const CATCH_TIP = "Catch %: receptions / targets, pass-interference targets left out (a PI target is never a catch or an incompletion)";
// D224 increment A: the red-zone figures as per-game rates and shares (Adam, 2026-09-30: nothing existing is removed, the
// raw counts sit behind More). The rates divide the table's own counts by his games in the window. The shares come from
// agg_player.js's rzI5Shares (the club and player pages' figure, never recomputed here), which ignores the opponent, down,
// quarter and home/away filters, so under any of them the share is blank rather than wrong.
const SHARE_NOTE = "Blank under an opponent, down, quarter or home/away filter (the share ignores them).";
export const RZ_TIPS = {
  rzTgtG: "Red-zone targets per game he played (targets inside the opponent's 20 / his games in the window)",
  rzTgtShare: `Red-zone target share: his red-zone targets / his club's red-zone pass attempts in his games. ${SHARE_NOTE}`,
  ezG: "End-zone targets per game he played (end-zone targets / his games in the window)",
  rzOppG: "Red-zone opportunities per game he played (carries + targets inside the opponent's 20 / his games in the window)",
  rzCarG: "Red-zone carries per game he played (carries inside the opponent's 20 / his games in the window)",
  i5Share: `Inside-the-5 carry share: his designed runs from the opponent's 5 or closer / his club's designed runs there in his games (scrambles on neither side). ${SHARE_NOTE}`,
};
export const sharesBlanked = (st) => Boolean(st?.opp || st?.downs?.length || st?.qtrs?.length || st?.ha);
const perGame = (n, g) => (g > 0 && Number.isFinite(n) ? n / g : null);
// Adds the red-zone figures to the aggregation's rows in place (and returns them). `kind` "rec" adds rzTgtG, rzTgtShare,
// ezG; "rb" adds rzOppG, rzCarG, i5Share. `st.team` narrows his games to that club, as the aggregation does.
export function withRzFigures(rows, blocks, players, st, kind, { blank = sharesBlanked(st) } = {}) {
  const sh = blank ? null : rzI5Shares(blocks, players, st, st.team || "");
  for (const r of rows) {
    const x = sh?.get(r.gsis);
    if (kind === "rec") { r.rzTgtG = perGame(r.rz, r.g); r.ezG = perGame(r.ez, r.g); r.rzTgtShare = x?.rzTgtShare ?? null; r.rzTgtN = x?.rzTgtN ?? null; r.rzAttN = x?.rzAttN ?? null; }
    else { r.rzOppG = perGame(r.rzOpp, r.g); r.rzCarG = perGame(r.rz, r.g); r.i5Share = x?.i5Share ?? null; r.i5Des = x?.i5Des ?? null; r.i5Runs = x?.i5Runs ?? null; }
  }
  return rows;
}
// The sample behind a share, for its cell (both tables): the small "(3/3)" beside the percent and a sentence for the
// cell's title, the club page's wording (views/team.js shareFig). Under the 3-play floor the cell is a dash and the
// title says why; a filter-blanked share (sharesBlanked) says nothing here, the column header already does.
export function shareSample(k, r, st) {
  const [his, club, what] = k === "rzTgtShare" ? [r.rzTgtN, r.rzAttN, "red-zone pass attempts"] : k === "i5Share" ? [r.i5Des, r.i5Runs, "designed runs from the 5 or closer"] : [];
  if (!what || !Number.isFinite(his) || !Number.isFinite(club)) return { count: "", title: "" };
  const share = r[k];
  if (Number.isFinite(share)) return { count: `${his}/${club}`, title: `his ${his} of the club's ${club} in his games` };
  if (sharesBlanked(st)) return { count: "", title: "" };
  return { count: "", title: `not shown, the club had ${club} such play${club === 1 ? "" : "s"} in his games (fewer than ${RZ_I5_FLOOR}); he had ${his}` };
}
export const shareCountHtml = (count) => (count ? `<small class="an-rzn" style="margin-left:3px;font-size:.72em;font-weight:400;opacity:.6">${count}</small>` : "");
// D224 increment D: the target-depth mix bar (four parts, shallow to deep: behind the line, short, intermediate, deep)
// and its hover, shared by the Receivers table and the club offense page's Target Share card. `depth` is agg.js's
// depthMix; a man with no depth-tagged target gets a dash. The percents are rounded one by one, so they can read 99 or 101.
export const DEPTH_PARTS = [["behind", "behind"], ["short", "short"], ["inter", "inter"], ["deep", "deep"]];
export const DEPTH_TIP = "Target-depth mix: his targets by air yards, behind the line (0 or less) / short (1-9) / intermediate (10-19) / deep (20+), left to right. Shares are of the targets that have a depth. Sorts by the deep share.";
export function depthTitle(depth, adot) {
  if (!depth?.n) return "No targets with a depth";
  return DEPTH_PARTS.map(([k, l]) => `${l} ${Math.round(depth.shares[k] * 100)}% (${depth[k]})`).join(" · ") + (Number.isFinite(adot) ? ` · aDOT ${adot.toFixed(1)}` : "");
}
export function depthBarHtml(depth, adot) {
  if (!depth?.n) return DASH;
  return `<span class="an-depth" title="${esc(depthTitle(depth, adot))}">${DEPTH_PARTS.map(([k]) => depth[k] ? `<i class="an-depth-${k}" style="flex-grow:${depth[k]}"></i>` : "").join("")}</span>`;
}
const COLS = [
  { k: "dkG", h: "DK/g", t: DK_TIPS.dkG, f: (v) => fix(v, 1), grp: "p" },
  { k: "dk", h: "DK", t: DK_TIPS.dk, f: (v) => fix(v, 1), grp: "p" },
  { k: "rec", h: "Rec", t: "Receptions", f: int, grp: "p" },
  { k: "yds", h: "Yds", t: "Receiving yards", f: int, grp: "p" },
  { k: "td", h: "TD", t: "Receiving touchdowns", f: int, grp: "p" },
  { k: "tgt", h: "Tgt", t: "Targets", f: int, grp: "o" },
  { k: "tgtShare", h: "Tgt %", t: "Target share: his targets / his club's pass attempts in his games", f: (v) => pct(v), grp: "o", bar: 0.4 },
  { k: "ayShare", h: "AY %", t: "Air-yards share: his air yards / his club's air yards in his games", f: (v) => pct(v), grp: "o", bar: 0.55 },
  { k: "wopr", h: "WOPR", t: "Weighted opportunity: 1.5 x target share + 0.7 x air-yards share", f: (v) => fix(v, 2), grp: "o", bar: 0.9 },
  { k: "rzTgtG", h: "RZ tgt/g", t: RZ_TIPS.rzTgtG, f: (v) => fix(v, 2), grp: "o" },
  { k: "rzTgtShare", h: "RZ tgt %", t: RZ_TIPS.rzTgtShare, f: (v) => pct(v), grp: "o", bar: 0.5 },
  { k: "ezG", h: "EZ/g", t: RZ_TIPS.ezG, f: (v) => fix(v, 2), grp: "o" },
  { k: "routePct", h: "Rt %", t: "Route participation: routes / club dropbacks", f: (v) => pct(v, 0), grp: "o", bar: 1 },
  { k: "snapPct", h: "Snap %", t: "Share of his club's offensive snaps (nflverse snap counts)", f: (v) => pct(v, 0), grp: "o", bar: 1 },
  { k: "yprr", h: "YPRR", t: "Receiving yards per route run", f: (v) => fix(v, 2), grp: "e" },
  { k: "epaTgt", h: "EPA/Tgt", t: "Expected points added per target", f: (v) => signed(v, 2), grp: "e" },
  { k: "catchPct", h: "Catch %", t: CATCH_TIP, f: (v) => pct(v), grp: "e" },
  { k: "opp", h: "Opp", t: "Opportunities: targets + carries (designed runs, a jet sweep or end-around included)", f: int, grp: "xp" },
  { k: "oppG", h: "Opp/g", t: "Opportunities (targets + carries) per game he played", f: (v) => fix(v, 1), grp: "xp" },
  { k: "oppShare", h: "Opp %", t: "Opportunity share: (his targets + his designed runs) / (his club's pass attempts + his club's designed runs) in his games (scrambles are on neither side)", f: (v) => pct(v), grp: "xp" },
  { k: "ydsOpp", h: "Yds/opp", t: "(Receiving yards + rushing yards) / opportunities (targets + carries)", f: (v) => fix(v, 1), grp: "xp" },
  { k: "epaOpp", h: "EPA/opp", t: "(EPA summed over his targets + EPA summed over his carries) / opportunities (targets + carries)", f: (v) => signed(v, 2), grp: "xp" },
  { k: "tdOpp", h: "TD/opp", t: "(Receiving touchdowns + rushing touchdowns) / opportunities (targets + carries)", f: (v) => (v === null || v === undefined ? DASH : pct(v) + "%"), grp: "xp" },
  { k: "ay", h: "AY", t: "Air yards on his targets", f: int, grp: "xp" },
  { k: "adot", h: "aDOT", t: "Average depth of target (air yards per target)", f: (v) => fix(v, 1), grp: "xp" },
  { k: "depthDeep", h: "Depth", t: DEPTH_TIP, f: (v) => pct(v), grp: "xp", depthBar: true },
  { k: "routes", h: "Routes", t: "Routes run (heatradar, charted; weeks under 8 routes are not listed)", f: int, grp: "xp" },
  { k: "tprr", h: "TPRR", t: "Targets per route run", f: (v) => fix(v, 2), grp: "xp" },
  { k: "rz", h: "RZ", t: "Red-zone targets (inside the 20), the window's total", f: int, grp: "xp" },
  { k: "ez", h: "EZ", t: "End-zone targets, the window's total", f: int, grp: "xp" },
];
// [key, label, ancillary tint or ""]. The ancillary label is lighter (CSS: .an-anc) and tinted pass or run.
const GROUPS = [["p", "Production", ""], ["o", "Opportunity", ""], ["e", "Efficiency", ""], ["xp", "Receiving detail", "pass"]];
// The group's cell and header classes: g-<key>, a hairline (gs) on the first column of each group, and for an
// ancillary group an-anc an-anc-<tint>. Shared with the Running backs table.
export function withGroups(cols, groups) {
  const anc = new Map(groups.map(([g, , a]) => [g, a]));
  cols.forEach((c, i) => {
    c.gs = i === 0 || cols[i - 1].grp !== c.grp;
    c.anc = anc.get(c.grp) || "";
    c.cls = `g-${c.grp}${c.gs ? " gs" : ""}${c.anc ? ` an-anc an-anc-${c.anc}` : ""}`;
  });
  return cols;
}
withGroups(COLS, GROUPS);
// The Receivers page's default sort (filters.js defaultState): the rank header sorts by it too.
const DEFAULT_SORT = "tgt";
// The group header row's cells for the columns shown (a group with none shown is skipped).
export const groupCells = (cols, groups) => groups.map(([g, l, a]) => [g, l, a, cols.filter((c) => c.grp === g).length]).filter((x) => x[3] > 0)
  .map(([g, l, a, n]) => `<th colspan="${n}" class="g-${g} gs${a ? ` an-anc an-anc-${a}` : ""}">${l}</th>`).join("");
// THE MORE TOGGLE (lead, 7b: no sideways scroll, no clipped columns): the ancillary groups are collapsed by default
// behind a small "More ▸" in the group-header row; one click shows them all ("◂ Less" hides them). The state travels
// in the query as more=1 (moreFrom / withMore below), so a link or the Back button keeps it. A sort on a hidden
// ancillary column (a shared link, say) reveals that column's group, except the page's own default sort key. Hiding
// the groups while sorted on one of their columns returns the sort to the page's default. Shared with rushing.js.
export const moreFrom = (query) => new URLSearchParams(String(query || "").replace(/^\?/, "")).get("more") === "1";
export function withMore(q, more) {
  const p = new URLSearchParams(String(q || ""));
  p.delete("more");
  if (more) p.set("more", "1");
  return p.toString();
}
// The ancillary groups open under this state: every one with more=1, else only the one holding the sort column.
export function openGroups(cols, st, defaultSort) {
  if (st.more) return new Set(cols.filter((c) => c.anc).map((c) => c.grp));
  const s = cols.find((c) => c.anc && c.k === st.sort && st.sort !== defaultSort);
  return new Set(s ? [s.grp] : []);
}
export const visibleCols = (cols, st, defaultSort) => { const open = openGroups(cols, st, defaultSort); return cols.filter((c) => !c.anc || open.has(c.grp)); };
// All ancillary groups showing: the toggle reads "◂ Less", else "More ▸".
export const allOpen = (cols, st, defaultSort) => openGroups(cols, st, defaultSort).size === new Set(cols.filter((c) => c.anc).map((c) => c.grp)).size;
// The state after a toggle click.
export function toggleMore(cols, st, defaultSort) {
  if (!allOpen(cols, st, defaultSort)) return { ...st, more: true };
  const onHidden = cols.some((c) => c.anc && c.k === st.sort);
  return { ...st, more: false, ...(onHidden ? { sort: defaultSort, dir: "desc" } : {}) };
}
// The toggle's header cell (it sits over the sparkline column, the group row's last cell).
// 👁 fix round (findings 1, 5): the toggle now sits at the LEFT end of the group-header row, over the rank/name
// columns, instead of the right (where it scrolled off-screen with the frame open, and read as part of whichever
// group header it happened to sit beside). colspan=2 spans exactly the rank and name columns, matching the
// an-stick cells below it so the toggle, rank and name line up as one block; the lead's CSS makes that block
// sticky (position:sticky; left:0) while the frame is in its .an-over scrolling state. This file only marks the
// an-stick class; the sticky rule itself is the lead's, reported separately (not in this builder's owned files).
export const moreCell = (open) => `<th colspan="2" class="an-more-cell an-stick"><button type="button" class="an-more" data-more aria-expanded="${open}" title="${open ? "Hide" : "Show"} the detail columns">${open ? "◂ Less" : "More ▸"}</button></th>`;

// ---- D224 increment F: the "Deciding" preset ------------------------------------------------------------------------
// The Receivers, Running backs and Quarterbacks tables open on about ten columns that answer the weekly question; the
// full set is one click away and nothing is removed. Three column sets, picked by a segment in the group-header row
// where the More / Less button sat: Deciding (the opening state), Standard (the columns the tables opened on before:
// everything outside the lighter ancillary groups) and All (the old More: every group). The Quarterbacks table had no
// More, so its Standard IS its full set and its control reads Deciding · All. The choice rides in the address as
// view=deciding|standard|all (a legacy more=1 reads as All) and the reader's last click is kept in localStorage, which a
// link with no view= opens on, like the games strip's fold (nfl.gamesFolded). A sort the shown set does not draw
// (a shared link, a tile link) PROMOTES the view, as a hidden ancillary group always opened for its sort: a sort on a
// column Standard has but Deciding lacks shows Standard, one on an ancillary column also opens that group, one on a
// Deciding-only column (the last-3 and this-week figures) shows Deciding whatever view= says. The page's own default
// sort never promotes. Pure and agg_week-free: the figures a Deciding column draws arrive on the rows (deciding.js).
export const VIEWS = ["deciding", "standard", "all"];
export const VIEW_LABEL = { deciding: "Deciding", standard: "Standard", all: "All" };
export const VIEW_TIPS = {
  deciding: "About ten columns for the weekly call: usage over the club's last 3 games and the season, this week's opponent and what that defense gives up to his position, red-zone share and status",
  standard: "The columns the table opened on before the Deciding set: production, opportunity and efficiency",
  all: "Every column, the detail groups included",
};
export const VIEW_STORE = "nfl.analyticsView";
const storage = () => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } };
export function storedView() { try { const v = storage()?.getItem(VIEW_STORE); return VIEWS.includes(v) ? v : ""; } catch { return ""; } }
export function storeView(v) { try { if (VIEWS.includes(v)) storage()?.setItem(VIEW_STORE, v); } catch { /* private window: the choice just is not remembered */ } }
// The chosen view from a hash query: view= wins, then a legacy more=1 (All), then the reader's stored choice, then
// Deciding. twoWay: a table with no Standard of its own (Quarterbacks) reads Standard as All.
export function viewFrom(query, { twoWay = false } = {}) {
  const p = new URLSearchParams(String(query || "").replace(/^\?/, ""));
  let v = p.get("view");
  if (!VIEWS.includes(v)) v = p.get("more") === "1" ? "all" : storedView() || "deciding";
  return twoWay && v === "standard" ? "all" : v;
}
// A page's own hash writes the view every time (so a shared link opens as seen), and the legacy more= never.
// st (optional): the page's state. A Deciding address whose sort is not DK/g names that sort, so a promoted sort (a tile link
// to Targets, say) survives an opened row or a flipped switch instead of falling back to DK/g on a reload.
export function withView(q, view, st = null) {
  const p = new URLSearchParams(String(q || ""));
  p.delete("more"); p.delete("view");
  if (VIEWS.includes(view)) p.set("view", view);
  if (view === "deciding" && st?.sort && st.sort !== DECIDING_SORT) p.set("sort", st.sort);
  return p.toString();
}
// The keys a view draws (before any sort promotion). cols: the table's full list, dec: its Deciding list.
export function viewKeys(cols, dec, view) {
  if (view === "deciding") return dec.map((c) => c.k);
  if (view === "standard") return cols.filter((c) => !c.anc).map((c) => c.k);
  return cols.map((c) => c.k);
}
// A Deciding table opens sorted on DK/g, high first, so the view always has a lit sorted column (the Standard and All
// default sorts are each page's own and unchanged). defaultSortFor: the sort a view opens on and the rank header returns to.
export const DECIDING_SORT = "dkG";
export const defaultSortFor = (view, pageDefault) => (view === "deciding" ? DECIDING_SORT : pageDefault);
// The state of a page opened on an address: a Deciding view whose address names no sort opens on DK/g.
export function withViewSort(st, query) {
  const named = new URLSearchParams(String(query || "").replace(/^\?/, "")).has("sort");
  return st.view === "deciding" && !named ? { ...st, sort: DECIDING_SORT, dir: "desc" } : st;
}
// Keys only the Deciding set draws (the last-3 and this-week columns): a sort on one needs Deciding.
export const decidingOnly = (cols, dec) => new Set(dec.filter((c) => !cols.some((x) => x.k === c.k)).map((c) => c.k));
// True when the page should compute the Deciding figures: the chosen view is Deciding, or the sort is on a Deciding-only column.
export const wantsDeciding = (cols, dec, st) => (VIEWS.includes(st.view) ? st.view : st.more ? "all" : "standard") === "deciding" || decidingOnly(cols, dec).has(st.sort);
// What the table draws for a state: { view (the effective one, after promotion), cols, groups }.
export function columnsFor(cols, dec, st, defaultSort, groups, decGroups, { twoWay = false } = {}) {
  let view = VIEWS.includes(st.view) ? st.view : st.more ? "all" : "standard";
  if (twoWay && view === "standard") view = "all";
  const sort = st.sort;
  if (decidingOnly(cols, dec).has(sort)) view = "deciding";
  else if (view === "deciding" && sort && sort !== DECIDING_SORT && !new Set(dec.map((c) => c.k)).has(sort) && cols.some((c) => c.k === sort)) view = "standard";
  if (view === "deciding") return { view, cols: dec, groups: decGroups };
  return { view, cols: visibleCols(cols, { ...st, more: view === "all" }, defaultSort), groups };
}
// The state after a click on a view button: a sort on a column the new view does not draw (that view's own default sort
// aside) returns to that view's default, as Less always did.
export function pickView(cols, dec, st, view, defaultSort) {
  const known = new Set([...cols, ...dec].map((c) => c.k));
  const shown = new Set(viewKeys(cols, dec, view));
  const own = defaultSortFor(view, defaultSort);
  const hidden = st.sort && st.sort !== own && known.has(st.sort) && !shown.has(st.sort);
  return { ...st, view, ...(hidden ? { sort: own, dir: "desc" } : {}) };
}
// The control: one segment in the group-header row's leading cell (over rank and name; span 3 where there is no sticky pair).
export const viewCell = (view, { views = VIEWS, span = 2, stick = true } = {}) =>
  `<th colspan="${span}" class="an-view-cell${stick ? " an-stick" : ""}"><span class="an-view" role="group" aria-label="Column set">${views.map((v) => `<button type="button" class="an-view-b" data-view="${v}" aria-pressed="${v === view}" title="${esc(VIEW_TIPS[v])}">${VIEW_LABEL[v]}</button>`).join("")}</span></th>`;
export const viewFocus = { v: "" };
// onPick(view) gets the clicked view (a click on the lit one does nothing); the choice is stored, and the next render
// puts the focus back on the button.
export function wireView(el, onPick) {
  el.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (b.getAttribute("aria-pressed") === "true") return;
    viewFocus.v = b.dataset.view; storeView(b.dataset.view); onPick(b.dataset.view);
  }));
  if (viewFocus.v) { el.querySelector(`[data-view="${viewFocus.v}"]`)?.focus(); viewFocus.v = ""; }
}
// (No Status column: the chip beside the name carries it, its hover has the label, injury and return date.)
// The columns that arrive pre-built on the rows (deciding.js): the opponent and the vs-usual cell. `html`
// names the row field holding the cell's markup (a dash when the row has none); `sortRow` is the field the column sorts on.
export const WK_COLS = {
  wkOpp: { k: "wkOpp", h: "Next", t: "This week's opponent (vs = home, @ = away), from the published schedule; a club on its bye reads Bye. Current season only. Sorts by club", html: "wkOppHtml" },
  wkVs: { k: "wkVs", h: "vs usual", t: "What that defense gives up to his position, DK points per game against what the same offenses' men of that position usually get (the allowed table's vs usual), with its rank among the 32 defenses; the same figure as the This-week strip. Colour is the defense's: green = it held the position under its norm (a tough matchup for him). Hover for the words. Sorts by the figure, softest first", html: "wkVsHtml", td: "an-vs1" },
};
export const L3_NOTE = "his club's last 3 games this season, the Last 3 window's rule (each club's three most recent games, a bye skipped), whatever the page's window";
// The games behind a last-3 figure (deciding.js gL3: the games he played of those three), for the cell's hover.
export const l3Title = (r) => (Number.isFinite(r.gL3) && r.gL3 > 0 ? `over ${r.gL3} of his club's last 3 games` : "he did not play in his club's last 3 games");
export const DEC_GROUPS = [["dp", "Production", ""], ["dw", "This week", ""], ["du", "Usage", ""], ["dr", "Red zone", ""]];
const decCol = (cols, k, over = {}) => ({ ...cols.find((c) => c.k === k), ...over });

// TOO WIDE (lead, 7b: the Running backs table with More open at a 1536 laptop, or a long name at 1401-1450px): only
// when the table is wider than its frame does the frame get .an-over (CSS: overflow-x:auto, header rows static so they
// do not overlap the body); a table that fits never scrolls and its headers stay sticky. Re-checked on every render and
// on a window resize. Shared with views/rushing.js.
const markOver = (sc) => sc.classList.toggle("an-over", sc.scrollWidth > sc.clientWidth + 1);
export function fitOpen(el) { el?.querySelectorAll?.(".an-tscroll").forEach(markOver); }
// A More / Less click re-renders the table (through the hash); the next render puts the focus back on the toggle.
export const moreFocus = { pending: false };
export function wireMore(el, onClick) {
  const b = el.querySelector("[data-more]");
  b?.addEventListener("click", (e) => { e.stopPropagation(); moreFocus.pending = true; onClick(); });
  if (moreFocus.pending) { moreFocus.pending = false; b?.focus(); }
}
if (typeof window !== "undefined") window.addEventListener("resize", () => document.querySelectorAll(".an-usage .an-tscroll, .an-rush .an-tscroll").forEach(markOver));

// The column order, grouped, for tests and the lead (every key the table draws, left to right).
export const RECEIVERS_ORDER = GROUPS.map(([g, l]) => [l, COLS.filter((c) => c.grp === g).map((c) => c.k)]);
// D224 F: the Deciding set, left to right (key order exported for the tests and BOARD_KEYS' mirror). Usage reads his club's
// last 3 games beside the page's window; the L3 columns are tier-coloured and barred by the base figure's own cuts.
const DEC_COLS = withGroups([
  decCol(COLS, "dkG", { grp: "dp" }),
  { ...WK_COLS.wkOpp, grp: "dw" },
  { ...WK_COLS.wkVs, grp: "dw" },
  { k: "snapL3", h: "Snap % L3", t: `Share of his club's offensive snaps over ${L3_NOTE}`, f: (v) => pct(v, 0), grp: "du", base: "snapPct", bar: 1 },
  { k: "routeL3", h: "Rt % L3", t: `Route participation (routes / club dropbacks) over ${L3_NOTE}`, f: (v) => pct(v, 0), grp: "du", base: "routePct", bar: 1 },
  { k: "tgtL3", h: "Tgt % L3", t: `Target share (his targets / his club's pass attempts in his games) over ${L3_NOTE}`, f: (v) => pct(v), grp: "du", base: "tgtShare", bar: 0.4 },
  decCol(COLS, "tgtShare", { grp: "du" }),
  decCol(COLS, "rzTgtShare", { grp: "dr" }),
], DEC_GROUPS);
export const RECEIVERS_DECIDING = DEC_COLS.map((c) => c.k);
export const receiversWantsDeciding = (st) => wantsDeciding(COLS, DEC_COLS, st);
const BAND = (pos) => (pos === "RB" || pos === "FB" ? "BACKFIELD" : pos);

// D182 (Adam, 2026-09-24): air yards are not relevant for a running back. When the position chips leave only
// RB visible, the AY, AY %, WOPR and aDOT columns are dropped from the table entirely; in a mixed view they
// stay (perspective for the WRs and TEs on the same page), but an RB's own row prints a dash in them rather
// than a real-but-misleading number. Exported (pure) so tests can check both without a DOM.
const AY_ONLY_KEYS = new Set(["ay", "ayShare", "wopr", "adot", "depthDeep"]);
export const rbOnlyMode = (pos) => Boolean(pos?.RB === "in" && !POSITIONS.some((p) => p !== "RB" && pos[p] === "in"));
const baseCols = (st) => (rbOnlyMode(st.pos) ? COLS.filter((c) => !AY_ONLY_KEYS.has(c.k)) : COLS);

// ---- inline SVG ----------------------------------------------------------------------------------------
export function sparkline(series, st) {
  const W = 84, H = 22, pad = 3;
  const vals = series.map((s) => s.v);
  const max = Math.max(0.35, ...vals.filter((v) => v !== null));
  const n = series.length;
  const x = (i) => (n <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1));
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  let d = "", pen = false;
  series.forEach((s, i) => {
    if (s.v === null) { pen = false; return; }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(s.v).toFixed(1)}`; pen = true;
  });
  const hit = series.map((s, i) => {
    const w = n <= 1 ? W : (W - 2 * pad) / (n - 1);
    const lab = `${weekLabel(s.key, st.season)}: ${s.v === null ? "did not play" : `${(s.v * 100).toFixed(1)}% (${s.tgt} tgt)`}`;
    return `<g class="an-sp-pt"><rect x="${(x(i) - w / 2).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" fill="transparent"><title>${esc(lab)}</title></rect>`
      + (s.v === null ? "" : `<circle cx="${x(i).toFixed(1)}" cy="${y(s.v).toFixed(1)}" r="${i === n - 1 ? 2.4 : 1.6}"/>`) + `</g>`;
  }).join("");
  const ref = 0.2 <= max ? `<line class="an-sp-ref" x1="0" x2="${W}" y1="${y(0.2).toFixed(1)}" y2="${y(0.2).toFixed(1)}"/>` : "";
  return `<svg class="an-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Weekly target share">${ref}<path d="${d}"/>${hit}</svg>`;
}

// Small multiples: one strip per measure, a bar per week, each strip on its own scale, value on top.
// Each strip carries its window total on the left ("Season 35.1%": shares are total targets / total club
// attempts, from the row, never a mean of the weekly bars) and a dashed league-average line with its label.
function weeklyBars(row, st, P, windowName) {
  const lg = P?.lg, cuts = P?.cuts;
  const strips = [["v", "Target share", 0.5, "tgtShare"], ["ay", "Air-yards share", 0.7, "ayShare"], ["snap", "Snap share", 1, "snapPct"]];
  const n = row.series.length, bw = 30, gap = 8, lw = 118, sh = 46, rw = 74;
  const W = lw + n * (bw + gap) + rw, H = strips.length * (sh + 14) + 16;
  let g = "";
  strips.forEach(([k, label, scale, tierKey], si) => {
    const top = si * (sh + 14) + 12;
    const tot = row[tierKey], avg = lg?.overall?.[tierKey];
    g += `<text class="an-wb-lab" x="0" y="${top + sh / 2 - 3}">${label}</text>`
      + `<text class="an-wb-tot t-${tierOf(tierKey, tot, cuts)}" x="0" y="${top + sh / 2 + 12}">${esc(windowName)} ${tot === null || tot === undefined ? "–" : (tot * 100).toFixed(1) + "%"}</text>`
      + `<line class="an-wb-base" x1="${lw - 4}" x2="${W - rw + 4}" y1="${top + sh}" y2="${top + sh}"/>`;
    let avgSvg = ""; // drawn after the bars so the line reads across them
    if (avg !== null && avg !== undefined) {
      const ay = (top + sh - Math.min(1, avg / scale) * (sh - 12)).toFixed(1);
      avgSvg = `<line class="an-wb-avg" x1="${lw - 4}" x2="${W - rw + 4}" y1="${ay}" y2="${ay}"/><text class="an-wb-avglab" x="${W - rw + 8}" y="${+ay + 3.5}">lg avg ${Math.round(avg * 100)}%</text>`;
    }
    row.series.forEach((s, i) => {
      const v = s[k], bx = lw + i * (bw + gap);
      if (v === null || v === undefined) { g += `<text class="an-wb-na" x="${bx + bw / 2}" y="${top + sh - 3}">–</text>`; return; }
      const h = Math.max(1.5, Math.min(1, v / scale) * (sh - 12));
      g += `<rect class="an-wb-bar t-${tierOf(tierKey, v, cuts)}" x="${bx}" y="${(top + sh - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="3"><title>${esc(`${weekLabel(s.key, st.season)} ${label}: ${(v * 100).toFixed(1)}%`)}</title></rect>`
        + `<text class="an-wb-val" x="${bx + bw / 2}" y="${(top + sh - h - 3).toFixed(1)}">${Math.round(v * 100)}</text>`;
    });
    g += avgSvg;
  });
  row.series.forEach((s, i) => { g += `<text class="an-wb-wk" x="${lw + i * (bw + gap) + bw / 2}" y="${H - 1}">${esc(weekLabel(s.key, st.season))}</text>`; });
  return `<svg class="an-wbars" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Weekly shares">${g}</svg>`;
}

// D179 zone lines: deep 20+, intermediate 10-19, short 1-9, behind the line 0 or less; left, middle, right.
function zoneGrid(row) {
  const bands = [["D", "Deep 20+"], ["I", "Inter 10–19"], ["S", "Short 1–9"], ["B", "Behind LOS"]];
  const dirs = [["L", "Left"], ["M", "Middle"], ["R", "Right"]];
  const z = row.zones || {};
  const total = Object.values(z).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(z));
  const cell = (b, d) => {
    const n = z[b + d] || 0;
    const share = total ? n / total : 0;
    return `<div class="an-zc" style="--heat:${(n / max).toFixed(3)}" title="${n} targets (${(share * 100).toFixed(0)}% of his zoned targets)"><b>${n || ""}</b>${n ? `<small>${(share * 100).toFixed(0)}%</small>` : ""}</div>`;
  };
  return `<div class="an-zone"><div class="an-zone-h"></div>${dirs.map(([, l]) => `<div class="an-zone-h">${l}</div>`).join("")}`
    + bands.map(([b, l]) => `<div class="an-zone-r${b === "B" ? " los" : ""}">${l}</div>${dirs.map(([d]) => cell(b, d)).join("")}`).join("")
    + `</div>${total ? "" : `<div class="an-note">No targets with a depth and direction in this window.</div>`}`;
}

function detailHtml(row, st, q, P, windowName) {
  const L = P?.lg?.overall || {}, cuts = P?.cuts;
  const t = (k, v) => tierOf(k, v, cuts);
  const tile = (label, val, tier = "", avg = "") => `<div class="an-tile${tier ? " t-" + tier : ""}"><span>${label}</span><b>${val}</b>${avg && !avg.includes("an-na") ? `<em title="League average: ${esc(P?.text || "his position, same window")}"> · lg ${avg}</em>` : ""}</div>`;
  const depth = `../#/team/${encodeURIComponent(row.team)}/player/${encodeURIComponent(row.gsis)}`;
  return `<div class="an-detail-in">
    <div class="an-dcol"><div class="an-dh">Week by week</div>${row.series.length ? weeklyBars(row, st, P, windowName) : `<div class="an-note">No weeks in this window.</div>`}</div>
    <div class="an-dcol"><div class="an-dh">Target zones <span class="an-dsub">${row.tgt} targets</span></div>${zoneGrid(row)}</div>
    <div class="an-dcol an-dtiles">
      ${tile("Tgt %", pct(row.tgtShare), t("tgtShare", row.tgtShare), pct(L.tgtShare))}${tile("AY %", pct(row.ayShare), t("ayShare", row.ayShare), pct(L.ayShare))}
      ${tile("WOPR", fix(row.wopr, 2), t("wopr", row.wopr), fix(L.wopr, 2))}${tile("aDOT", fix(row.adot, 1), "", fix(L.adot, 1))}
      ${tile("EPA/Tgt", signed(row.epaTgt, 2), t("epaTgt", row.epaTgt), signed(L.epaTgt, 2))}${tile("YPRR", fix(row.yprr, 2), t("yprr", row.yprr), fix(L.yprr, 2))}
      <div class="an-dlinks"><a href="#/player/${encodeURIComponent(row.gsis)}${q ? "?" + q : ""}">Player page →</a><a href="${depth}">Depth chart →</a></div>
    </div></div>`;
}

// The row the reader just clicked and where it sat on screen, so the re-render that follows can keep it there.
export const anchor = { id: null, top: null };

// D225b: a player page's ranking link carries `hl=<gsis>` (and `find=1`) into the Receivers, Running backs and
// Quarterbacks boards (filters.js rankHref). hlOf reads hl from the hash query and withHl puts it back into a page's
// own rebuilt query (a sort click or filter change keeps the highlight). scrollToHl centres his row ONLY on arrival from
// a tile: it needs find=1, and strips it from the address with replaceState (no hashchange, no history entry), so a
// re-render, a Back step or the reader's own changes never re-centre. The row class is the Rankings page's .an-row.is-hl.
export const hlOf = (query) => { const v = new URLSearchParams(String(query || "").replace(/^\?/, "")).get("hl") || ""; return /^[A-Za-z0-9_.:-]{1,40}$/.test(v) ? v : ""; };
export function withHl(q, hl) {
  const p = new URLSearchParams(String(q || ""));
  p.delete("hl");
  if (hl) p.set("hl", hl);
  return p.toString();
}
export function scrollToHl(root, hl, query) {
  if (!hl || new URLSearchParams(String(query || "").replace(/^\?/, "")).get("find") !== "1") return;
  [...root.querySelectorAll("tr.an-row")].find((t) => t.dataset.id === hl)?.scrollIntoView({ block: "center" });
  const [path, qs = ""] = location.hash.split("?");
  const p = new URLSearchParams(qs);
  if (!p.has("find")) return;
  p.delete("find");
  history.replaceState(null, "", location.pathname + location.search + path + (p.toString() ? "?" + p : ""));
}

// ---- table ---------------------------------------------------------------------------------------------
// The table's markup as a pure string (no DOM): everything renderTable needs to know to decide what to show,
// split out so tests can check column visibility and RB dashing without a document. `view`: { ref
// (agg.usageReference over the league-wide rows: each row's league reference and tier cuts come from
// ref.at(row.pos)), windowName ("Season", "Last 3", "W1–W2"), teams }.
// `status`: D196's injury-status players map (gsis -> status), already gated by season by the caller (statusApplies)
// - pass {} for a window that does not include the current season, or when the feed could not be had. Never
// fetched here: pure string builders take their data, never reach for it themselves.
export function tableHtml(allRows, st, query, view = {}, status = {}) {
  const rows = sortRows(allRows.filter((r) => r.tgt >= st.minTgt), st.sort, st.dir);
  const q = query || "";
  const teams = view.teams;
  // D182: RB-only views drop the air-yards columns entirely; a mixed view keeps them.
  // The More toggle: the ancillary groups show only when open (or holding the sort column).
  // D224 F: the chosen column set (Deciding, Standard or All), after any sort promotion.
  const sel = columnsFor(baseCols(st), DEC_COLS, st, DEFAULT_SORT, GROUPS, DEC_GROUPS);
  const cols = sel.cols;
  // Player, team and Pos now share one cell (c-name), so the fixed columns are rank/player/games, not four.
  const nCols = 3 + cols.length + 1;
  const th = (k, h, t, cls = "") => `<th class="${cls}${st.sort === k ? " sorted " + st.dir : ""}" data-sort="${k}" title="${esc(t)}">${h}</th>`;
  // The toggle (moreCell) now leads the row, spanning rank+name; a blank cell fills the G spot it used to skip,
  // and the trailing cell over the sparkline is blank in its place (findings 1, 5).
  const groupRow = `<tr class="an-grp">${viewCell(sel.view)}<th></th>${groupCells(cols, sel.groups)}<th class="c-spark"></th></tr>`;
  // The Tgt header says whether pass-interference targets are in the count (the "PI targets" switch below).
  const colTitle = (c) => (c.k === "tgt" || c.k === "opp" ? `${c.t} (${st.pi === false ? "excludes" : "includes"} pass-interference targets)` : c.t);
  // an-stick on rank/name (header and body below): the lead's CSS pins these two columns to the left edge while
  // the frame scrolls (finding 1), matching the moreCell block above them.
  const head = `<tr>${th("rank", "#", "Rank", "c-rank an-stick")}${th("name", "Player", "Player, team, position", "c-name an-stick")}${th("g", "G", "Games in the window")}${cols.map((c) => th(c.k, c.h, colTitle(c), c.cls)).join("")}<th class="c-spark" title="Weekly target share; hover a point for the week">Tgt % by week</th></tr>`;
  const cell = (c, r) => {
    // D182: a mixed table keeps the air-yards columns for perspective, but an RB's own numbers there are not
    // meaningful, so his cells show a dash instead of the real (but misleading) figure.
    if (c.html) return `<td class="num ${c.cls}${c.td ? " " + c.td : ""}">${r[c.html] || DASH}</td>`;
    const v = AY_ONLY_KEYS.has(c.k) && r.pos === "RB" ? null : r[c.k];
    const P = view.ref?.at(r.pos);
    const tk = c.base || c.k; // an L3 column is judged by its base figure's cuts
    // Only the aggregation's tier keys are coloured, and ancillary columns never are, whatever the aggregation tiers
    // (Opp, Opp/g, Opp %, TPRR here).
    const tier = c.anc || !TIER_KEYS.has(tk) ? "" : tierOf(tk, v, P?.cuts);
    const note = !c.anc && TIER_KEYS.has(tk) && v !== null && v !== undefined ? tierNote(P?.cuts?.[tk], r.pos) : "";
    const bar = c.bar && v !== null && v !== undefined ? `<i class="an-bar" style="width:${Math.min(100, (v / c.bar) * 100).toFixed(1)}%"></i>` : "";
    if (c.depthBar) {
      const ok = r.pos !== "RB";
      return `<td class="num ${c.cls} an-depth-td">${ok ? depthBarHtml(r.depth, r.adot) : DASH}</td>`;
    }
    const ss = shareSample(c.k, r, st), title = [note, ss.title, c.base ? l3Title(r) : ""].filter(Boolean).join(". ");
    return `<td class="num ${c.cls}${tier ? " t-" + tier : ""}${bar ? " has-bar" : ""}"${title ? ` title="${esc(title)}"` : ""}>${bar}<span>${c.f(v)}${shareCountHtml(ss.count)}</span></td>`;
  };
  const body = rows.map((r, i) => {
    const open = st.open === r.gsis;
    const depth = `../#/team/${encodeURIComponent(r.team)}/player/${encodeURIComponent(r.gsis)}`;
    const ps = status[r.gsis];
    const chip = statusChip(ps, { season: view.statusSeason }), nameCls = statusNameClass(ps);
    return `<tr class="an-row${open ? " open" : ""}${view.hl && r.gsis === view.hl ? " is-hl" : ""}" data-id="${esc(r.gsis)}" tabindex="0" aria-expanded="${open}">
      <td class="c-rank an-stick">${i + 1}</td>
      <td class="c-name an-stick"><a class="an-pname${nameCls ? " " + nameCls : ""}" href="#/player/${encodeURIComponent(r.gsis)}${q ? "?" + q : ""}" title="${esc(r.name)}">${esc(r.name)}</a>${teamPill(r.team, teams, q)}<span class="an-pospill" data-band="${BAND(r.pos)}">${esc(r.pos)}</span>${chip}<a class="an-dc" href="${depth}" title="Open his depth-chart card" aria-label="Depth chart">→</a></td>
      <td class="num">${r.g}</td>
      ${cols.map((c) => cell(c, r)).join("")}
      <td class="c-spark">${sparkline(r.series, st)}</td></tr>`
      + (open ? `<tr class="an-detail"><td colspan="${nCols}"><div class="an-detail-wrap">${detailHtml(r, st, q, view.ref?.at(r.pos), view.windowName || "Window")}</div></td></tr>` : "");
  }).join("");

  return `<div class="an-tbar">
      <label class="an-min">Min targets <input type="number" min="0" step="1" value="${st.minTgt}" data-min></label>
      <label class="an-switch" title="A defensive pass interference is a no-play in the play-by-play; on, it counts as a target for the receiver (never a pass attempt, catch or yards)"><input type="checkbox" data-pi${st.pi === false ? "" : " checked"}><span>${st.pi === false ? "excl. PI targets" : "PI targets"}</span></label>
      <span class="an-count">${rows.length} player${rows.length === 1 ? "" : "s"}</span>
      <span class="an-legend" title="The depth charts' rating colours on the share and efficiency columns, by position: each value against his own position's reference pool in this window (elite at its 90th percentile or above, then the 70th, 40th and 15th; low below). A position with under ${MIN_POOL} men in the pool uses the league-wide cuts for that column (hover the cell).">
        ${TIER_NAMES.map((t) => `<i class="t-${t}"></i>`).join("")}<span>elite → low by position</span></span>
      <span class="an-hint">Click a row to open it</span>
    </div>
    <div class="an-tscroll"><table class="an-table"><thead>${groupRow}${head}</thead><tbody>${body || `<tr><td colspan="${nCols}" class="an-empty">No players match these filters.</td></tr>`}</tbody></table></div>`;
}

// `onState(next)` receives a new filter state (sort, minimum, open row); `query` is the current hash query.
export function renderTable(el, allRows, st, query, onState, view = {}, status = {}) {
  el.innerHTML = tableHtml(allRows, st, query, view, status);
  fitOpen(el);
  wireView(el, (v) => onState(pickView(baseCols(st), DEC_COLS, st, v, DEFAULT_SORT)));

  el.querySelectorAll("th[data-sort]").forEach((h) => h.addEventListener("click", () => {
    const k = h.dataset.sort === "rank" ? defaultSortFor(columnsFor(baseCols(st), DEC_COLS, st, DEFAULT_SORT, GROUPS, DEC_GROUPS).view, DEFAULT_SORT) : h.dataset.sort;
    const textual = ["name", "pos", "wkOpp"].includes(k);
    const dir = st.sort === k ? (st.dir === "desc" ? "asc" : "desc") : textual ? "asc" : "desc";
    onState({ ...st, sort: k, dir });
  }));
  const min = el.querySelector("[data-min]");
  min?.addEventListener("change", () => { const v = Math.max(0, Math.floor(+min.value || 0)); onState({ ...st, minTgt: v }); });
  el.querySelector("[data-pi]")?.addEventListener("change", (e) => onState({ ...st, pi: e.target.checked, open: "" }));
  const toggle = (tr) => {
    const id = tr.dataset.id;
    anchor.id = id; anchor.top = tr.getBoundingClientRect().top;
    if (st.open === id) {
      // Animate the close, then drop it from the hash.
      const wrap = tr.nextElementSibling?.querySelector(".an-detail-wrap");
      if (wrap) { wrap.classList.add("closing"); setTimeout(() => onState({ ...st, open: "" }), 170); }
      else onState({ ...st, open: "" });
    } else onState({ ...st, open: id });
  };
  el.querySelectorAll("tr.an-row").forEach((tr) => {
    tr.addEventListener("click", (e) => { if (!e.target.closest("a")) toggle(tr); });
    tr.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !e.target.closest("a")) { e.preventDefault(); toggle(tr); } });
  });
}
