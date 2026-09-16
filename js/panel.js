// Renders the 440px player detail panel into the <aside class="player-panel"> that team.js already creates
// as a hidden sibling of the field (D21: everything besides name/number/position/rating/status/headshot
// lives here, behind the click). Two exports: openPanel(asideEl, card, teamView, teamMeta) fills and shows
// the aside for one player; closePanel(asideEl) hides and clears it.
//
// Step-6 review (2026-09-11), finding 2: both functions are pure, idempotent DOM operations on the aside
// element the caller passes in. This module never touches the field/columns/trays and never re-renders
// anything outside the aside — opening or closing the panel must not trigger a field re-render. The lead's
// integration note (see this builder's final report) tells team.js to call these two functions directly on
// a route change between a team's player sub-route and its team-only route, not to re-run renderTeam().
//
// Finding 1: the route (`#/team/ABBR/player/{playerKey}`) carries the depth-chart playerKey (usually the
// gsis id), never the ESPN id — resolving that key to a card is team.js's job (it already has the in-memory
// TeamView). openPanel's contract, unchanged from the original spec, is that it receives the resolved
// `card` object directly. A small number of real players (2 of 1,639 at last count) have no ESPN id on
// file: when `card.espnId` is null this panel renders everything it already knows from `card` and never
// calls the network or shows an error.
//
// Finding 6: rating, status, and roster designation are already computed on the compiled card and are
// NEVER refetched here — only bio (draft round, full season/college stats) comes from the network, via
// GET /api/player/{espnId} (server/api/player.js).
import { esc, snapHistoryHtml } from "./cards.js";
import { renderHistory } from "./history.js";
import { getPlayer, getHistory } from "./api.js";

const dash = "—";
const STATUS_CLASS = {
  Q: "badge-q", D: "badge-d", OUT: "badge-out", IR: "badge-out", PUP: "badge-out", NFI: "badge-out",
  SUSP: "badge-susp", EXEMPT: "badge-susp", INACTIVE: "badge-inactive",
};

// --- small render helpers (deliberately not imported from cards.js beyond esc(): those are internal,
// unexported helpers there, and duplicating a handful of one-line functions here keeps this module
// self-contained per finding 2 without reaching into another builder's file for private implementation
// details) --------------------------------------------------------------------------------------------
function initials(card) {
  const a = (card.first || card.name || "?").trim()[0] || "?";
  const b = (card.last || "").trim()[0] || "";
  return (a + b).toUpperCase();
}

function headshotHtml(card, size) {
  const ini = esc(initials(card));
  const fallback = `this.replaceWith(Object.assign(document.createElement('div'),{className:'panel-headshot-fallback',textContent:'${ini}',style:'width:${size}px;height:${size}px;font-size:${Math.round(size * 0.32)}px'}))`;
  if (!card.headshot) return `<div class="panel-headshot-fallback" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.32)}px">${ini}</div>`;
  return `<img class="panel-headshot" src="${esc(card.headshot)}" alt="" width="${size}" height="${size}" loading="lazy" onerror="${fallback}">`;
}

function statusBadge(status) {
  if (!status) return "";
  const cls = STATUS_CLASS[status.code] || "badge-out";
  return `<span class="badge ${cls}">${esc(status.code)}</span>`;
}

function heightFromInches(h) {
  if (h == null) return null;
  const n = Number(h);
  if (!Number.isFinite(n)) return null;
  return `${Math.floor(n / 12)}'${n % 12}"`;
}

// D43's same tier thresholds, duplicated here exactly like cards.js/zoom.js/matchup.js already do (each
// file owns its own copy rather than reaching into another builder's private helpers — see this file's
// header comment) — now doubling as the PFF-inspired tier-COLOUR class (styles.css :root's --tier-*).
function ratingTier(v) {
  if (v == null) return "tier-flat";
  if (v >= 90) return "tier-elite";
  if (v >= 80) return "tier-strong";
  if (v >= 70) return "tier-avg";
  if (v >= 60) return "tier-weak";
  return "tier-flat";
}

// PFF-inspired (Adam, 2026-09-11): "a big rating number in a colour-scaled box, with '#4 of 119 at RB'
// directly under it and the launch rating as a small delta" — replaces the old flat team-colour bar.
// D34: season years only, never a Madden edition number.
// 🔵 review follow-up (2026-09-15, D91 item 1): the grade box is where Adam's rating pill lives on this
// view, so the last-three-games snap trio belongs right beside the big number, same as it already sits
// beside every rating pill on the field/side/group views (cards.js's snapHistoryHtml, reused here rather
// than duplicated). This panel is only ever handed the resolved `card` (see openPanel's contract in this
// file's header) and never which side of the ball he's on — team.js's caller (public/js/main.js's
// openPlayerPanel) passes just the card and the whole TeamView, with no unit alongside it, and the
// compiled card itself carries no unit of its own (server/compile/chart.js's makeCard never stamps one on
// it) — so this calls snapHistoryHtml with no `unit` in opts, which cards.js's own D91-item-2 fix (see that
// file) now renders as "81% of snaps" rather than guessing "offensive".
function gradeBoxHtml(rating, season, card) {
  if (!rating || rating.current == null) return "";
  const tier = ratingTier(rating.current);
  const rank = rating.posRank && rating.posCount ? `#${esc(rating.posRank)} of ${esc(rating.posCount)} ${esc(rating.maddenPos || "")}` : esc(season ?? "");
  let delta = "";
  if (rating.launch != null && rating.launch !== rating.current) {
    const diff = rating.current - rating.launch;
    delta = `<div class="panel-grade-delta">launch ${esc(rating.launch)} (${diff >= 0 ? "+" : ""}${diff})</div>`;
  }
  const snaps = snapHistoryHtml(card, {});
  return `<div class="panel-grade ${tier}">
    <div class="panel-grade-num">${esc(rating.current)}</div>
    <div class="panel-grade-rank">${rank}</div>
    ${delta}
    ${snaps}
  </div>`;
}

// Finding 7: the round number only ever comes from the ESPN core-athlete draft object (server/api/player.js
// reads draftRaw.round/year/selection directly) — never parsed out of any bio "displayDraft" string. The
// compiled card's own `bio.draft` (from the roster fetch) has no round yet, so the initial render below
// shows what the card already has and fillDraftRound() upgrades it in place once /api/player responds.
// 🎨 Polish (2026-09-11, round 2, item 11): "Drafted 2020, Rd 2, #53 (Philadelphia Eagles)" overflowed the
// 12.5px bio-row cell and truncated to "Drafted 2020, Rd …" — nothing past the round survived. Shortened
// to "2020 · R2 #53" (round as "R2", no team name — the cell already sits inside that team's own panel)
// so the pick number that used to get cut off is now the part most likely to actually fit.
function draftLine(draft) {
  if (!draft || draft.year == null) return null;
  const round = draft.round != null ? ` · R${esc(draft.round)}` : "";
  const pick = draft.pick != null ? ` #${esc(draft.pick)}` : "";
  return `${esc(draft.year)}${round}${pick}`.trim();
}

function bioRowHtml(card) {
  const b = card.bio || {};
  const height = heightFromInches(b.height) ?? dash;
  const weight = b.weight != null ? `${esc(b.weight)} lbs` : dash;
  const age = b.age != null ? `${esc(b.age)} yo` : dash;
  // An International Player Pathway man never attended a college, so the compile leaves b.college null (it is a
  // matching field) and states the fact in b.collegeNote. A dash would read as "we don't know" — this is known.
  const college = b.college || (b.collegeNote === "international" ? "No college (international)" : dash);
  const expNum = Number(b.exp);
  const exp = b.exp == null ? dash : Number.isFinite(expNum) ? `${expNum} yr${expNum === 1 ? "" : "s"}` : esc(b.exp); // "R" for rookies on some sources
  const draft = draftLine(b.draft) || dash;
  // 🎨 Polish (2026-09-11, round 2, item 11): the "Drafted " prefix cost 8 of this narrow grid cell's
  // characters for no real information (the whole row is obviously bio data) — dropping it is what
  // finally lets "2020 · R2 #53" fit without the ellipsis eating the pick number.
  // D115 (Adam, 2026-09-16): a seventh cell, spanning the grid's full width as its own row, for the games/
  // starts chip below (gamesChipData/patchGamesChip). The draft cell above already reads "—" for the many
  // undrafted men on file, which looked like a free slot, but that dash is a real answer ("undrafted") for
  // a drafted player it instead shows his round/pick — overwriting it would destroy that data, so this adds
  // a cell rather than repurposing one. History hasn't resolved yet when this first renders (see openPanel),
  // so it starts on the same dash placeholder every other unknown cell uses and is patched in place once the
  // /api/history fetch lands.
  return `<div class="panel-bio-row">
    <span>${esc(height)}</span><span>${weight}</span><span>${age}</span>
    <span>${esc(college)}</span><span>${exp}</span><span data-bio-draft title="Draft">${draft}</span>
    <span class="panel-bio-games" data-games title="Regular-season games on file">${dash}</span>
  </div>`;
}

// PFF-inspired (Adam, 2026-09-11): "snap-share as a thin bar when snap data exists" — guarded on
// card.snapShare being a real number: the compiled schema already carries this field (nflverse snap
// counts, per PROJECT.md) but every live team file has it as `null` today (not populated by the compile
// step yet), so this renders nothing until that lands — never a fake/zero bar.
function snapShareHtml(card) {
  const v = card.snapShare;
  if (v == null || !Number.isFinite(Number(v))) return "";
  const pct = Math.max(0, Math.min(100, Math.round(Number(v) <= 1 ? Number(v) * 100 : Number(v))));
  return `<div class="panel-snaps">
    <span class="panel-snaps-label">Snap share</span>
    <span class="panel-snaps-bar"><span class="panel-snaps-fill" style="width:${pct}%"></span></span>
    <span class="panel-snaps-pct">${pct}%</span>
  </div>`;
}

function statusBlockHtml(card) {
  const s = card.status;
  const parts = [`<div class="panel-status-head">${statusBadge(s)}<span class="panel-roster-desig">${esc(card.rosterDesignation || "")}</span></div>`];
  const comment = s?.longComment || s?.shortComment;
  if (comment) parts.push(`<div class="panel-status-comment">${esc(comment)}</div>`);
  if (s?.returnDate) parts.push(`<div class="panel-status-return">Expected return: ${esc(s.returnDate)}</div>`);
  return `<div class="panel-status">${parts.join("")}</div>`;
}

// --- D30 stat-line families ---------------------------------------------------------------------------
// Column definitions as [header, category name, ESPN stat `name`] triples, matching the `name` keys
// server/api/player.js keys every season's `stats` object by (see that file's own comment on why `name`,
// never `label`, is the safe key). category "__missing" marks a D30 column ESPN's per-athlete stats API
// does not expose at all (confirmed live 2026-09-11: no tacklesForLoss/quarterbackHits field anywhere in
// the "defensive" category, and no starts/snap-count category for offensive linemen) — shown as "—" with
// an explanatory note rather than silently substituting a different, mislabeled stat.
const STAT_FAMILIES = {
  QB: [["CMP", "passing", "completions"], ["ATT", "passing", "passingAttempts"], ["YDS", "passing", "passingYards"],
       ["TD", "passing", "passingTouchdowns"], ["INT", "passing", "interceptions"], ["RTG", "passing", "QBRating"]],
  RB: [["ATT", "rushing", "rushingAttempts"], ["YDS", "rushing", "rushingYards"], ["AVG", "rushing", "yardsPerRushAttempt"],
       ["TD", "rushing", "rushingTouchdowns"], ["REC", "receiving", "receptions"], ["REC YDS", "receiving", "receivingYards"]],
  WR_TE: [["TGT", "receiving", "receivingTargets"], ["REC", "receiving", "receptions"], ["YDS", "receiving", "receivingYards"],
          ["TD", "receiving", "receivingTouchdowns"]],
  DL_EDGE: [["TKL", "defensive", "totalTackles"], ["SACK", "defensive", "sacks"],
            ["TFL", "__missing", "tacklesForLoss"], ["QB HITS", "__missing", "quarterbackHits"]],
  LB: [["TKL", "defensive", "totalTackles"], ["SACK", "defensive", "sacks"], ["INT", "defensive", "interceptions"], ["PD", "defensive", "passesDefended"]],
  DB: [["TKL", "defensive", "totalTackles"], ["INT", "defensive", "interceptions"], ["PD", "defensive", "passesDefended"], ["FF", "defensive", "fumblesForced"]],
  OL: [], // no ESPN category at all for this family — seasonsTableHtml falls back to a Season/Team/GP-only table
};

function stripOrdinal(s) { return String(s || "").replace(/\d+$/, ""); }

// Position family is chosen from, in order: the card's Madden position (most canonical, independent of
// scheme/display quirks), then `position`, then `displayLabel` (spec's own fallback order). Known gap:
// a plain "OLB" is ambiguous between a 3-4 edge rusher (D14, wants the DL_EDGE line) and a true 4-3
// off-ball backer, and neither `position` nor `displayLabel` carries scheme context here — this defaults
// ambiguous OLBs to the LB family (tkl/sacks/INT/PD), which still surfaces sack production, just not
// TFL/QB hits (ESPN doesn't expose those at all regardless, see STAT_FAMILIES above).
function statFamily(card) {
  const raw = stripOrdinal(card.rating?.maddenPos || card.position || card.displayLabel || "").toUpperCase();
  if (raw === "QB") return "QB";
  if (raw === "RB" || raw === "HB" || raw === "FB") return "RB";
  if (raw === "WR" || raw === "TE") return "WR_TE";
  if (["LT", "LG", "C", "RG", "RT", "OL", "OT", "G"].includes(raw)) return "OL";
  if (["DT", "DE", "NT", "EDGE", "LE", "RE", "LOLB", "ROLB"].includes(raw)) return "DL_EDGE";
  if (["LB", "MLB", "OLB", "ILB"].includes(raw)) return "LB";
  if (["CB", "S", "FS", "SS", "DB"].includes(raw)) return "DB";
  return null;
}

function statValue(season, cat, name) {
  if (cat === "__missing") return null;
  return season.stats?.[cat]?.[name]?.value ?? null;
}

function seasonsTableHtml(family, seasons, collegeFallback) {
  const rows = (seasons || []).slice(0, 10); // D33: ten seasons max
  if (!rows.length) return `<div class="panel-stats-empty">No ${collegeFallback ? "college" : "NFL"} season stats on file.</div>`;
  const cols = STAT_FAMILIES[family] || [];
  if (!cols.length) {
    const body = rows.map((s) => `<tr><td>${esc(s.season)}</td><td>${esc(s.teamAbbr || dash)}</td><td>${esc(s.games ?? dash)}</td></tr>`).join("");
    return `<table class="panel-stats-table"><thead><tr><th>Season</th><th>Team</th><th>GP</th></tr></thead><tbody>${body}</tbody></table>
      <div class="panel-stats-note">ESPN's per-player stats feed does not report starts or snap counts for this position.</div>`;
  }
  const head = `<th>Season</th><th>Team</th>${cols.map(([h]) => `<th>${esc(h)}</th>`).join("")}`;
  const body = rows.map((s) => {
    const cells = cols.map(([, cat, name]) => `<td>${esc(statValue(s, cat, name) ?? dash)}</td>`).join("");
    return `<tr><td>${esc(s.season)}</td><td>${esc(s.teamAbbr || dash)}</td>${cells}</tr>`;
  }).join("");
  const note = cols.some(([, cat]) => cat === "__missing")
    ? `<div class="panel-stats-note">ESPN's per-player stats feed does not report tackles-for-loss or QB hits.</div>` : "";
  return `<table class="panel-stats-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${note}`;
}

// --- network -------------------------------------------------------------------------------------------
// api.js owns the URL, the error contract and (D67) the live-vs-published rewrite; this is just the name
// the rest of this file already calls.
const fetchPlayer = (espnId) => getPlayer(espnId);

// --- D115: season-stats fetch failure classification ----------------------------------------------------
// "This player has no ESPN stats" is a normal answer, not a bug — the coverage audit already knows ~160
// players (mostly offensive linemen) have no ESPN stats page at all. It reaches getPlayer()'s throw two
// different ways depending which mode api.js is running in, and both need to render the same muted line
// instead of the red error box:
//   - live server: server/api/player.js's 404 handler (added alongside this fix) answers with this exact
//     message when the ESPN bio/stats fetch itself 404s.
//   - published static site (D67): api.js's getPlayer() (~line 88) turns a missing pre-rendered player
//     file into this exact message when isStatic() && the fetch 404s.
// Matched on the exact strings rather than a generic "contains 404" check so a real 404 elsewhere (a
// malformed URL, a broken proxy) still reads as a genuine error, not a shrug.
const NO_STATS_MESSAGES = new Set([
  "no ESPN season stats on file for this player",
  "season stats are not part of this published snapshot",
]);

// One muted line, worded for the family: the OL family (D30's STAT_FAMILIES) never has an ESPN stats
// category at all (see STAT_FAMILIES's own "OL: []" comment above), so its wording says that outright
// instead of implying this one lineman is somehow unusual.
function noStatsMessage(family) {
  return family === "OL" ? "ESPN keeps no season stats for linemen." : "No ESPN season stats for this player.";
}

// Real failures (network error, 5xx, malformed JSON) still get the red error box, but as one short line —
// Adam's screenshot (2026-09-16, Cowboys LG T.J. Bass) showed the full ESPN URL printed in red, which reads
// like a crash even when it's just this one player missing a page. Strips any bare URL out of the message;
// what's left (a status code, "network down", etc.) is still useful without dragging ESPN's internal
// endpoint onto the screen.
function shortErrorMessage(err) {
  const msg = String(err?.message ?? "").replace(/https?:\/\/\S+/g, "").trim();
  return `Couldn't load season stats${msg ? `: ${msg}` : ""}`;
}

// Pure classifier so the fetch/render code below (and the tests) share one place that decides muted-note
// vs. red-error — exported for tests/panel.test.mjs, which has no DOM available to exercise the real
// openPanel() catch handler through.
export function classifyStatsError(err, family) {
  const message = String(err?.message ?? "");
  if (NO_STATS_MESSAGES.has(message)) return { muted: true, text: noStatsMessage(family) };
  return { muted: false, text: shortErrorMessage(err) };
}

// --- close/back behaviour (finding 2) -------------------------------------------------------------------
// HashChangeEvent.oldURL/newURL are computed by the browser itself, so this is race-free regardless of
// what order other modules' own hashchange listeners run in — no dependency on team.js's own routing code.
let lastOldHash = null;
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", (e) => {
    try { lastOldHash = new URL(e.oldURL).hash; } catch { lastOldHash = null; }
  });
}

// D75: a player panel can now open in place on the whole-team page OR either side page (offense/defense,
// since D72 put those on the same field-plus-aside shell as team.js's teamBodyHtml) — closing it must
// return to WHICHEVER of those three the panel was opened from, not always the whole-team page. This used
// to compare the pre-navigation hash only against `#/team/{abbr}`, so opening a panel from the defense
// page (`#/team/{abbr}/def`) never matched, cameFromTeamRoute came back false, and closing always dropped
// back to the whole-team page even though the defense page was what was actually on screen underneath.
function isTeamContextHash(hash, abbr) {
  return hash === `#/team/${abbr}` || hash === `#/team/${abbr}/off` || hash === `#/team/${abbr}/def`;
}

function navigateAwayFromPlayer(asideEl) {
  const abbr = asideEl.dataset.teamAbbr || "";
  // originHash is the page the panel actually opened from (whole-team, offense or defense) when that's
  // known; a direct link or an unrecognized origin still falls back to the whole-team page, same as before.
  const origin = asideEl.dataset.originHash || `#/team/${abbr}`;
  if (asideEl.dataset.cameFromTeamRoute === "true" && history.length > 1) history.back();
  else location.hash = origin;
}

// Escape and the close button both call this; wired once per aside element (a fresh <aside> is created
// each time team.js re-renders a team page, so "once" means once per team-page render, not once ever).
function wireCloseHandlersOnce(asideEl) {
  if (asideEl.dataset.panelWired === "true") return;
  asideEl.dataset.panelWired = "true";
  asideEl.addEventListener("click", (e) => {
    if (e.target.closest(".panel-close")) navigateAwayFromPlayer(asideEl);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !asideEl.hidden) navigateAwayFromPlayer(asideEl);
  });
}

function fillDraftRound(asideEl, apiDraft) {
  if (!apiDraft || apiDraft.round == null) return;
  const el = asideEl.querySelector("[data-bio-draft]");
  if (el) el.textContent = draftLine(apiDraft);
}

// --- D115: game-experience chip -----------------------------------------------------------------------
// Pure summarizer over the /api/history/{abbr}/{playerKey} `seasons` rows (server/history/index.js's
// buildHistory: nine completed seasons plus D87's current-season row, each already carrying `games` and
// `starts`, null when unknown). Exported for tests/panel.test.mjs, which has no DOM to drive the real fetch
// through. A row with both fields null (no data on file for that year, e.g. before he entered the league)
// is skipped entirely — it contributes to neither the totals nor the "on file" season span. Games sums
// over every row that has a games number; starts only ever appears in the chip text when at least one row
// actually carries a starts number (`anyStarts`) — otherwise the honest answer is "we don't know starts",
// not "0 starts".
export function gamesChipData(seasons) {
  const rows = Array.isArray(seasons) ? seasons : [];
  let games = 0, starts = 0, anyStarts = false, minSeason = null, maxSeason = null;
  for (const r of rows) {
    if (!r || (r.games == null && r.starts == null)) continue;
    if (r.games != null) games += Number(r.games) || 0;
    if (r.starts != null) { anyStarts = true; starts += Number(r.starts) || 0; }
    const s = Number(r.season);
    if (Number.isFinite(s)) {
      minSeason = minSeason == null ? s : Math.min(minSeason, s);
      maxSeason = maxSeason == null ? s : Math.max(maxSeason, s);
    }
  }
  const text = anyStarts ? `${games} games · ${starts} starts` : `${games} games`;
  const span = minSeason == null ? "" : minSeason === maxSeason ? `, ${minSeason}` : `, ${minSeason}–${maxSeason}`;
  return { text, title: `Regular-season games on file${span}` };
}

// history.js owns the /api/history fetch for the position/season table it renders into `[data-history]`,
// but it renders straight into that container and hands nothing back to its caller — and this builder's
// file list doesn't include history.js — so this calls api.js's getHistory() a second time for the same
// player rather than reaching into that file for its parsed response. Mirrors history.js's own query-param
// and team/key fallback logic exactly (see that file's renderHistory) so both calls resolve the same player.
// Returns [] (not a throw) for the deliberate "no prior NFL seasons on record" 404 — a rookie's honest chip
// is "0 games", not an error.
async function fetchGamesSeasons(card, abbr) {
  const team = String(abbr || card?.teamAbbr || card?.team || "").toUpperCase();
  const key = card?.playerKey ?? card?.gsisId ?? card?.espnId ?? "";
  if (!team || !key) return [];
  const q = new URLSearchParams();
  for (const [k, v] of [["gsisId", card?.gsisId], ["espnId", card?.espnId], ["pfrId", card?.pfrId], ["eaId", card?.rating?.eaId], ["name", card?.name], ["college", card?.bio?.college], ["birthDate", card?.bio?.birthDate], ["position", card?.displayLabel ?? card?.position]])
    if (v != null && v !== "") q.set(k, String(v));
  const { ok, status, body } = await getHistory(team, key, q);
  if (status === 404 && body?.error?.code === "no_history") return [];
  if (!ok) throw new Error(body?.error?.message || `${status} /api/history`);
  return body?.seasons || [];
}

// Patches the placeholder dash in place once the history fetch resolves — same pattern as fillDraftRound
// above and as history.js's own strip/table (the header can render before any network response lands).
function patchGamesChip(asideEl, data) {
  const el = asideEl.querySelector("[data-games]");
  if (!el) return; // the aside moved on to a different player/team while this fetch was in flight
  el.textContent = data.text;
  el.title = data.title;
}

function renderStats(asideEl, data, family) {
  const box = asideEl.querySelector("[data-stats]");
  if (!box) return; // the aside moved on to a different player/team while this fetch was in flight
  const useCollege = (!data.seasons || data.seasons.length === 0) && Array.isArray(data.collegeSeasons) && data.collegeSeasons.length > 0;
  const seasons = useCollege ? data.collegeSeasons : data.seasons || [];
  const staleNote = data.stale
    ? `<div class="panel-stats-note">Showing cached data from ${esc(new Date(data.fetchedAt).toLocaleString())} — live refresh failed.</div>` : "";
  const heading = `<div class="panel-stats-heading">${useCollege ? "College" : "NFL"} season stats</div>`;
  box.innerHTML = staleNote + heading + seasonsTableHtml(family, seasons, useCollege);
}

// --- public API ------------------------------------------------------------------------------------------
function panelShellHtml(card, season, teamMeta) {
  const wordmark = teamMeta?.wordmarkUrl ? `<img class="panel-wordmark" src="${esc(teamMeta.wordmarkUrl)}" alt="${esc(teamMeta.abbr || "")}">` : "";
  return `<div class="panel-inner" style="--team-primary:${esc(teamMeta?.colourPrimary || "#333")};--team-secondary:${esc(teamMeta?.colourSecondary || "#777")}">
    <button type="button" class="panel-close" aria-label="Close player panel">&times;</button>
    <div class="panel-head">
      <span class="panel-headshot-backdrop">${headshotHtml(card, 88)}</span>
      ${gradeBoxHtml(card.rating, season, card)}
      <div class="panel-head-main">
        <div class="panel-name">${esc(card.name)} <span class="panel-number">#${esc(card.number ?? dash)}</span></div>
        <div class="panel-label">${esc(card.displayLabel || card.position || "")}</div>
        ${wordmark}
      </div>
    </div>
    ${bioRowHtml(card)}
    ${snapShareHtml(card)}
    ${statusBlockHtml(card)}
    <div class="panel-position-line" data-history>history loading…</div>
    <div class="panel-stats" data-stats>${card.espnId ? `<div class="panel-loading">Loading season stats…</div>` : ""}</div>
  </div>`;
}

// openPanel(asideEl, card, teamView, teamMeta): fills and shows the aside for one player. `card` is the
// already-resolved PlayerCard from the in-memory TeamView (team.js's job — see file header); `teamView` is
// the whole compiled TeamView (used here only for its `season`); `teamMeta` is the team registry entry
// (colours/wordmark/abbr). Safe to call repeatedly on the same aside for a different player — any
// still-in-flight fetch from a previous call is ignored when it resolves (the generation counter below).
export function openPanel(asideEl, card, teamView, teamMeta) {
  if (!asideEl || !card) return;
  const myGen = (asideEl._panelGen = (asideEl._panelGen || 0) + 1);

  wireCloseHandlersOnce(asideEl);
  const abbr = teamMeta?.abbr || teamView?.abbr || "";
  asideEl.dataset.teamAbbr = abbr;
  const fromTeamContext = isTeamContextHash(lastOldHash, abbr);
  asideEl.dataset.cameFromTeamRoute = String(fromTeamContext);
  asideEl.dataset.originHash = fromTeamContext ? lastOldHash : `#/team/${abbr}`;

  asideEl.hidden = false;
  asideEl.innerHTML = panelShellHtml(card, teamView?.season, teamMeta);
  { const h = asideEl.querySelector("[data-history]"); if (h) renderHistory(h, card, teamMeta, { abbr: teamView?.abbr ?? teamMeta?.abbr }); }

  // D115: independent of the ESPN-bio fetch below (gated on card.espnId) — games/starts come from
  // gsis/pfr/name matching against nflverse history, not from ESPN, so this runs even for the small number
  // of players with no ESPN id on file.
  fetchGamesSeasons(card, abbr)
    .then((seasons) => { if (asideEl._panelGen === myGen) patchGamesChip(asideEl, gamesChipData(seasons)); })
    .catch(() => {}); // leave the dash placeholder; a real failure already surfaces via the history block above

  if (!card.espnId) return; // finding 1: no ESPN id on file -> card-only panel, no fetch, no error state

  const family = statFamily(card);
  fetchPlayer(card.espnId)
    .then((data) => {
      if (asideEl._panelGen !== myGen) return; // superseded by a later openPanel() call
      renderStats(asideEl, data, family);
      fillDraftRound(asideEl, data.bio?.draft);
    })
    .catch((err) => {
      if (asideEl._panelGen !== myGen) return;
      const box = asideEl.querySelector("[data-stats]");
      if (!box) return;
      const { muted, text } = classifyStatsError(err, family);
      box.innerHTML = `<div class="${muted ? "panel-stats-note" : "panel-error"}">${esc(text)}</div>`;
    });
}

// closePanel(asideEl): hides and clears the aside. Purely a DOM operation — never navigates, never touches
// the field. Safe to call on an already-closed aside.
export function closePanel(asideEl) {
  if (!asideEl) return;
  asideEl._panelGen = (asideEl._panelGen || 0) + 1; // cancel any in-flight fetch's effect
  asideEl.hidden = true;
  asideEl.innerHTML = "";
}
