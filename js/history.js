// Ten-season history block for the player panel (milestone 7; D11, D22, D30, D33, D34).
//   renderHistory(container, card, teamsMeta, { abbr })
// container = the panel's <div data-history>; card = the compiled player object; teamsMeta = the /api/teams
// envelope (or its teams array) for logos. `abbr` is the team on screen (falls back to the #/team/{abbr} route).
// Talks to GET /api/history/{abbr}/{playerKey} through api.js's getHistory() helper, so the published static
// copy (D67) reads the pre-rendered file instead. Styles are injected
// once from here (styles.css is owned by another step) under the .hist- prefix so the lead can lift them later.
import { getHistory, getTeams } from "./api.js";

const CSS = `
.hist { margin-top: 14px; font-size: 13px; }
.hist-posline { display:flex; align-items:baseline; gap:8px; margin: 0 0 8px; }
.hist-posline .hist-k { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted,#8a94a0); }
.hist-posline .hist-v { font-weight:600; }
.hist-posline.changed .hist-v { color:#ffd54a; }
.hist-table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
.hist-table th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted,#8a94a0); font-weight:600; padding:4px 6px; border-bottom:1px solid #2a323b; }
.hist-table td { padding:4px 6px; border-bottom:1px solid #1e242b; white-space:nowrap; vertical-align:middle; }
/* D151: the old STATS column is now SNAP % — one number per season, in the table's own tabular figures. */
.hist-table td.hist-snap { color:#c6ccd3; font-weight:600; }
.hist-table tr.empty td { color:#4d5761; }
.hist-table tr.hist-collapsed td { text-align:center; font-style:italic; padding:8px 6px; }
.hist-team { display:inline-flex; align-items:center; gap:4px; }
.hist-team img { width:20px; height:20px; object-fit:contain; }
.hist-team .hist-oldcode { font-size:10px; color:var(--muted,#8a94a0); }
.hist-teamleg { display:inline-flex; align-items:center; gap:6px; }
.hist-teamsep { color:var(--muted,#8a94a0); font-size:11px; }
/* PFF-inspired (Adam, 2026-09-11): "tables (matchup, panel history) with tier-coloured number cells
   rather than plain text" — colour, not a filled background, so the table stays easy to scan; values
   come from styles.css :root's shared --tier-* scale (this file's own <style> tag can still reference
   another file's custom properties — they're global once styles.css is loaded, see this file's header
   comment on why the stylesheet itself stays self-contained here). */
.hist-ovr { font-weight:700; }
.hist-ovr.tier-elite { color:var(--tier-elite,#34d399); }
.hist-ovr.tier-strong { color:var(--tier-strong,#22a06b); }
.hist-ovr.tier-avg { color:var(--tier-avg,#c9d15a); }
.hist-ovr.tier-weak { color:var(--tier-weak,#f2c14e); }
.hist-ovr.tier-flat { color:var(--tier-flat,#e0524d); }
.hist-ovr .hist-star { color:#6b7480; font-weight:400; font-size:11px; margin-left:1px; }
/* D87: "launch → now" on the current season's row — the arrow stays muted so the two ratings, each in its own
   tier colour, are what the eye lands on. */
.hist-ovrpair { display:inline-flex; align-items:baseline; gap:3px; }
.hist-arrow { color:var(--muted,#8a94a0); font-size:11px; font-weight:400; }
.hist-ovr.hist-now { font-size:12px; }
.hist-tag { display:inline-block; font-size:9.5px; text-transform:uppercase; letter-spacing:.06em; padding:1px 5px; border-radius:8px; margin-left:5px; background:#2a323b; color:#c6ccd3; }
.hist-tag.launch { background:#3a3320; color:#ffd54a; }
.hist-pos.changed { color:#ffd54a; font-weight:600; }
.hist-note { margin-top:6px; font-size:11px; color:var(--muted,#8a94a0); }
/* PFF-inspired (Adam, 2026-09-11): "a compact season-by-season strip (year -> OVR, tier-coloured, launch
   tagged) above the full history table" — a quick-scan row of chips before the detailed table below it. */
.hist-strip { display:flex; flex-wrap:wrap; gap:5px; margin:0 0 12px; }
.hist-strip-chip { display:flex; flex-direction:column; align-items:center; min-width:34px; padding:3px 6px 4px; border-radius:7px; background:#1a1f25; }
.hist-strip-yr { font-size:9px; color:var(--muted,#8a94a0); letter-spacing:.02em; }
.hist-strip-ovr { font-size:13px; font-weight:800; line-height:1.3; }
.hist-strip-l { font-size:8px; vertical-align:top; margin-left:1px; opacity:.85; }
.hist-strip-chip.tier-elite .hist-strip-ovr { color:var(--tier-elite,#34d399); }
.hist-strip-chip.tier-strong .hist-strip-ovr { color:var(--tier-strong,#22a06b); }
.hist-strip-chip.tier-avg .hist-strip-ovr { color:var(--tier-avg,#c9d15a); }
.hist-strip-chip.tier-weak .hist-strip-ovr { color:var(--tier-weak,#f2c14e); }
.hist-strip-chip.tier-flat .hist-strip-ovr { color:var(--tier-flat,#e0524d); }
.hist-state { padding:10px 0; color:var(--muted,#8a94a0); font-size:13px; }
.hist-state.error { color:#ff8a80; }
`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dash = "—";

function ensureStyle() {
  if (document.getElementById("hist-style")) return;
  const s = document.createElement("style"); s.id = "hist-style"; s.textContent = CSS; document.head.appendChild(s);
}

function teamList(teamsMeta) {
  if (Array.isArray(teamsMeta)) return teamsMeta;
  if (Array.isArray(teamsMeta?.teams)) return teamsMeta.teams;
  return [];
}
// The panel is handed one team's registry entry, but past seasons need every team's logo: fetch the registry once.
let registryPromise = null;
async function teamListAsync(teamsMeta) {
  const list = teamList(teamsMeta);
  if (list.length > 1) return list;
  registryPromise ??= getTeams().then((j) => teamList(j)).catch(() => []);
  const all = await registryPromise;
  return all.length ? all : list;
}

function abbrFromRoute() {
  const m = /#\/team\/([A-Za-z]{2,4})/.exec(location.hash || "");
  return m ? m[1].toUpperCase() : "";
}

// D151 (Adam, 2026-09-18): the table's last column is the man's share of his unit's snaps that season, not a
// stat line - "since we have stats at the far right of the chart and below, let's replace the stats column of
// that chart with snap % and then we can see the guy's snap % going back each season". The stat lines stay in
// the NFL SEASON STATS table underneath, which is untouched.
// The share itself is the server's (server/history/index.js seasonSnapShare): pooled out of his snaps and his
// team's snaps wherever the counts allow it, and the mean of the source's own per-game percentages where they
// do not. The title says which, because that distinction is Adam's own rule (D150).
// "source" is the one-game case: D150's last sentence says a single game's percentage is always the source's
// own figure, never one this app recomputes.
export const SNAP_METHOD_TITLE = {
  pooled: "pooled from snap counts",
  "source-mean": "average of the source's per-game percentages",
  source: "the source's own figure for the one game he played",
};
export function snapPctCell(r) {
  if (r?.snapPct == null) return `<td class="hist-snap">${dash}</td>`;
  const title = SNAP_METHOD_TITLE[r.snapPctMethod] ?? "";
  return `<td class="hist-snap"${title ? ` title="${esc(title)}"` : ""}>${esc(r.snapPct)}%</td>`;
}

// Same thresholds as cards.js/zoom.js/matchup.js/panel.js's own ratingTier() (each file keeps its own
// tiny copy rather than reaching into another builder's private helpers) — doubles as the PFF-inspired
// tier-colour class (styles.css :root's --tier-*).
function tierOf(v) {
  if (v == null) return "tier-flat";
  if (v >= 90) return "tier-elite";
  if (v >= 80) return "tier-strong";
  if (v >= 70) return "tier-avg";
  if (v >= 60) return "tier-weak";
  return "tier-flat";
}

// PFF-inspired (Adam, 2026-09-11): a quick-scan strip of year->OVR chips, newest first, above the full
// table — launch-only seasons get a small superscript "L" instead of the table's fuller "launch" tag.
// D87: the chip shows the LIVE rating when the row has one (r.ovrCurrent, the number on the card header
// right now), falling back to the launch number, so the strip, the table's right-hand number and the card
// all agree. A row whose live rating has moved off the launch capture is no longer "launch only" either,
// so it loses the superscript L.
function stripHtml(rows) {
  const chips = rows.filter((r) => (r.ovrCurrent ?? r.ovr) != null).map((r) => {
    const v = r.ovrCurrent ?? r.ovr;
    const yr = String(r.season).slice(-2);
    const launchOnly = r.ovrCurrent == null && r.ratingKind === "LAUNCH";
    const launch = launchOnly ? `<sup class="hist-strip-l" title="launch rating only">L</sup>` : "";
    return `<span class="hist-strip-chip ${tierOf(v)}" title="${esc(r.season)}: ${esc(v)} OVR${launchOnly ? " (launch)" : ""}">
      <span class="hist-strip-yr">'${esc(yr)}</span><span class="hist-strip-ovr">${esc(v)}${launch}</span>
    </span>`;
  });
  return chips.length ? `<div class="hist-strip">${chips.join("")}</div>` : "";
}

// D52: a season with a mid-season trade carries r.teams as an ordered [{abbr, fromWeek, toWeek}, ...] (server/
// history/index.js) - one small logo per team, in chronological order, joined by a thin "/" separator so a trade
// reads left-to-right the same way r.team's own "ATL/TB" string does. A single-team season is just one entry,
// same markup as before. r.teamRaw only ever differs from r.team for a single-team season (a real historical
// franchise-code divergence, e.g. an old "OAK" row under the current "LV") - it is never compared against a
// multi-team r.team string, which would always differ from a single old code for the wrong reason.
function rowHtml(r, teams) {
  const stints = r.teams?.length ? r.teams : r.team ? [{ abbr: r.team }] : [];
  const old = stints.length === 1 && r.teamRaw && r.teamRaw !== stints[0].abbr ? `<span class="hist-oldcode">${esc(r.teamRaw)}</span>` : "";
  const logos = stints.map((s) => {
    const t = teams.find((x) => x.abbr === s.abbr);
    return `<span class="hist-teamleg">${t?.logo ? `<img src="${esc(t.logo)}" alt="${esc(s.abbr)}">` : ""}${esc(s.abbr)}</span>`;
  }).join(`<span class="hist-teamsep">/</span>`);
  const teamHtml = stints.length ? `<span class="hist-team">${logos}${old}</span>` : dash;
  const star = r.ovr != null && r.matchConfidence !== "id" ? `<span class="hist-star" title="matched by ${esc(r.matchMethod)}, not by player id">*</span>` : "";
  // D87: a row carrying a live rating is not a "launch only" season — the launch tag (and the footnote that
  // explains it, in historyHtml below) is for seasons where the launch capture is the only rating that exists.
  const tag = r.ovr != null && r.ratingKind === "LAUNCH" && r.ovrCurrent == null ? `<span class="hist-tag launch" title="Only the launch rating exists for this season">launch</span>` : "";
  // D87: the season being played right now carries this year's Madden LAUNCH rating in r.ovr and, when the live
  // EA rating on the card has since moved off it, that live number in r.ovrCurrent - printed "99 → 97", launch
  // first then now. The server only ever sets r.ovrCurrent when it differs from r.ovr (server/history/index.js),
  // so an unchanged rating stays a single number and every completed season is untouched by this.
  // When this year's capture never listed the man there is no launch number to move off, and the live
  // rating is all he has — printed on its own, with no arrow and nothing to compare it against.
  const now = r.ovr != null && r.ovrCurrent != null && r.ovrCurrent !== r.ovr
    ? `<span class="hist-arrow">→</span><span class="hist-ovr hist-now ${tierOf(r.ovrCurrent)}">${r.ovrCurrent}</span>` : "";
  const ovrNum = `<span class="hist-ovr ${tierOf(r.ovr)}">${r.ovr}${star}</span>`;
  // D34: Adam names a season by its year, never by the Madden edition number.
  const ovr = r.ovr == null
    ? (r.ovrCurrent != null ? `<span class="hist-ovr ${tierOf(r.ovrCurrent)}" title="${esc(r.season)} rating ${esc(r.ovrCurrent)}">${r.ovrCurrent}</span>` : dash)
    : now ? `<span class="hist-ovrpair" title="${esc(r.season)} launch ${r.ovr}, now ${r.ovrCurrent}">${ovrNum}${now}</span>${tag}`
    : `${ovrNum}${tag}`;
  const empty = !r.team && r.ovr == null && r.ovrCurrent == null && !r.positionOfRecord;
  const pos = r.positionOfRecord ? `<span class="hist-pos ${r.positionChanged ? "changed" : ""}" title="position of record: ${esc(r.positionSource || "")}">${esc(r.positionOfRecord)}</span>` : dash;
  return `<tr class="${empty ? "empty" : ""}"><td>${r.season}</td><td>${teamHtml}</td><td>${pos}</td><td>${ovr}</td>${empty ? `<td class="hist-snap">${dash}</td>` : snapPctCell(r)}</tr>`;
}

export function historyHtml(data, teamsMeta) {
  const teams = teamList(teamsMeta);
  const rows = [...(data.seasons || [])].sort((a, b) => b.season - a.season); // newest first: reads down from the card's current rating
  const anyStar = rows.some((r) => r.ovr != null && r.matchConfidence !== "id");
  const anyLaunch = rows.some((r) => r.ovr != null && r.ratingKind === "LAUNCH" && r.ovrCurrent == null);
  const notes = [];
  if (anyStar) notes.push("* rating matched by name, not by player id");
  if (anyLaunch) notes.push("launch = only the launch rating exists for that season");
  // Seasons before the player's career started (rows sorted newest-first, so these trail at the end)
  // collapse into a single plain-English line instead of a stack of "— — — — —" rows.
  let shownCount = rows.length;
  const blank = (r) => !r.team && r.ovr == null && r.ovrCurrent == null && !r.positionOfRecord; // same test rowHtml uses
  while (shownCount > 0 && blank(rows[shownCount - 1])) shownCount--;
  const collapsedCount = rows.length - shownCount;
  const bodyRows = rows.slice(0, shownCount).map((r) => rowHtml(r, teams)).join("")
    + (collapsedCount ? `<tr class="empty hist-collapsed"><td colspan="5">No earlier seasons on file</td></tr>` : "");
  return `
  <div class="hist">
    <div class="hist-posline ${data.positionChanged ? "changed" : ""}"><span class="hist-k">Position</span><span class="hist-v">${esc(data.positionLine || dash)}</span></div>
    ${stripHtml(rows)}
    <table class="hist-table">
      <thead><tr><th>Season</th><th>Team</th><th>Pos</th><th>OVR</th><th>Snap %</th></tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
    ${notes.length ? `<div class="hist-note">${notes.map(esc).join(" · ")}</div>` : ""}
  </div>`;
}

export async function renderHistory(container, card, teamsMeta, { abbr = "" } = {}) {
  if (!container) return;
  ensureStyle();
  const team = (abbr || card?.teamAbbr || card?.team || abbrFromRoute() || "").toUpperCase();
  const key = card?.playerKey ?? card?.gsisId ?? card?.espnId ?? "";
  container.innerHTML = `<div class="hist-state">Loading season history…</div>`;
  const q = new URLSearchParams();
  for (const [k, v] of [["gsisId", card?.gsisId], ["espnId", card?.espnId], ["pfrId", card?.pfrId], ["eaId", card?.rating?.eaId], ["name", card?.name], ["college", card?.bio?.college], ["birthDate", card?.bio?.birthDate], ["position", card?.displayLabel ?? card?.position]]) if (v != null && v !== "") q.set(k, String(v));
  const token = (container.dataset.histToken = String(Date.now()) + Math.random());
  try {
    const { ok, status, body } = await getHistory(team, key, q);
    if (container.dataset.histToken !== token) return; // a newer render superseded this one
    if (status === 404 && body?.error?.code === "no_history") { container.innerHTML = `<div class="hist-state">No prior NFL seasons on record${body.currentSeason ? ` (rookie in ${esc(body.currentSeason)})` : ""}.</div>`; return; }
    if (!ok) throw new Error(body?.error?.message || `${status} /api/history`);
    const teams = await teamListAsync(teamsMeta);
    if (container.dataset.histToken !== token) return;
    container.innerHTML = historyHtml(body, teams);
  } catch (e) {
    if (container.dataset.histToken !== token) return;
    container.innerHTML = `<div class="hist-state error">Season history unavailable: ${esc(e.message)}</div>`;
  }
}
