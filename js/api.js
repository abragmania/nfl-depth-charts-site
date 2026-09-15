// The one place the front end talks to the server. Owns the error contract: {error:{code,message}}.
//
// D67 static mode: the same front end runs two ways. On Adam's PC it talks to the local server's /api
// routes exactly as before. In the published copy (GitHub Pages, no server at all) tools/publish.mjs has
// written every one of those responses out as a flat file under dist/api/, and flipped index.html's
// <meta name="nfl-static"> to "1". When that flag is set, every request below is rewritten to the matching
// file path by staticPathFor() and fetched as a plain GET. The paths are RELATIVE on purpose: the published
// site lives under https://abragmania.github.io/nfl-depth-charts-site/, so a leading "/" would escape the
// sub-path and 404. Nothing else in the app knows or cares which mode it is in.
let teamsCache = null;

// Same sanitiser server/api/history.js uses for its own cache file names, so a playerKey that is not
// filename-safe (e.g. "name:DEN:liljordan-humphrey") maps to the identical file on both sides.
export const staticFileKey = (s) => String(s ?? "").replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80);

// Pure: an /api URL (with or without a query string) -> the published file that holds that response,
// or null for a route the publish step does not pre-render (POST /api/refresh, /api/health). Exported so
// tools/publish.mjs writes its files at exactly the paths the browser will ask for, and so the mapping is
// testable without a DOM (tests/publish.test.mjs).
export function staticPathFor(url) {
  const parts = String(url ?? "").split("?")[0].replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts[0] !== "api") return null;
  const seg = (i) => { try { return decodeURIComponent(parts[i]); } catch { return parts[i]; } };
  if (parts.length === 2 && parts[1] === "teams") return "api/teams.json";
  if (parts.length === 3 && parts[1] === "team") return `api/team/${staticFileKey(seg(2)).toUpperCase()}.json`;
  if (parts.length === 4 && parts[1] === "history") return `api/history/${staticFileKey(seg(2)).toUpperCase()}/${staticFileKey(seg(3))}.json`;
  if (parts.length === 3 && parts[1] === "player") return `api/player/${staticFileKey(seg(2))}.json`;
  if (parts.length === 3 && parts[1] === "refresh" && parts[2] === "status") return "api/refresh/status.json";
  return null;
}

// Cached because it can never change within a page load, and because this module is also imported by
// Node (tools/publish.mjs) where there is no document at all.
let staticMode = null;
export function isStatic() {
  if (staticMode === null) {
    staticMode = typeof document !== "undefined"
      && document.querySelector('meta[name="nfl-static"]')?.getAttribute("content") === "1";
  }
  return staticMode;
}

// The single rewrite point. In live mode the URL is untouched; in static mode a known /api route becomes
// its published file and anything else (there is nothing else on the read path) is left alone.
export function resolveUrl(url) {
  return isStatic() ? (staticPathFor(url) ?? url) : url;
}

export async function getJson(url) {
  const r = await fetch(resolveUrl(url), { headers: { accept: "application/json" } });
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON body; handled below */ }
  if (!r.ok) throw new Error(body?.error?.message || `${r.status} ${url}`);
  return body;
}

export async function getTeams() {
  return (teamsCache ??= await getJson("/api/teams"));
}

// GET /api/history/{abbr}/{playerKey} for public/js/history.js. Returns the raw {ok, status, body} triple
// rather than throwing, because the caller has to tell a real failure apart from the deliberate
// 404 no_history ("no prior NFL seasons on record"), which is a normal answer, not an error.
// In static mode a pre-rendered file can itself carry an error body — publish.mjs writes the handler's
// 404 no_history response to disk with its status in `httpStatus`, so a rookie reads the same on the
// published site as he does locally.
export async function getHistory(abbr, playerKey, params = {}) {
  const q = new URLSearchParams(params).toString();
  const url = `/api/history/${encodeURIComponent(abbr)}/${encodeURIComponent(playerKey)}${q ? `?${q}` : ""}`;
  let r;
  try { r = await fetch(resolveUrl(url), { headers: { accept: "application/json" } }); }
  catch (e) { throw new Error(e.message || "network error"); }
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON body (a Pages 404 page, say) */ }
  const status = body?.httpStatus ?? r.status;
  return { ok: r.ok && !body?.error, status, body };
}

// GET /api/player/{espnId} for public/js/panel.js. Throws on failure; the panel renders the message.
export async function getPlayer(espnId) {
  const url = `/api/player/${encodeURIComponent(espnId)}`;
  const r = await fetch(resolveUrl(url), { headers: { accept: "application/json" } });
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON body */ }
  if (!r.ok) {
    // On the published site a missing file means this player's stats were not in the snapshot — say so
    // plainly instead of showing a bare 404, which would read like a bug.
    if (isStatic() && r.status === 404) throw new Error("season stats are not part of this published snapshot");
    throw new Error(body?.error?.message || `${r.status} ${url}`);
  }
  return body;
}

// Per-team response cache, keyed by abbr (holds the in-flight/settled Promise, so two callers racing
// for the same team share one fetch). Integration task 2 (2026-09-11): "Refresh now" must be able to
// force a re-fetch, hence invalidateTeam() below — there was no cache to invalidate before this, so
// this adds one rather than leaving the helper with nothing to do.
const teamCache = new Map();

// GET /api/team/{abbr} — now live for all 32 teams. Contract: fall back to the bundled fixture only
// when the server itself says the team isn't compiled yet — 503, or 404 with error.code
// "not_compiled" — never on a generic network failure or an unrelated 404 (👁 review, 2026-09-11:
// the earlier broad fallback was a temporary shim for while the endpoint didn't exist at all; now
// that it's live, masking a real failure behind sample data would hide genuine bugs).
export async function getTeam(abbr) {
  const A = String(abbr || "").toUpperCase();
  if (teamCache.has(A)) return teamCache.get(A);
  const p = fetchTeam(A).catch((e) => { teamCache.delete(A); throw e; });
  teamCache.set(A, p);
  return p;
}

async function fetchTeam(A) {
  const r = await fetch(resolveUrl(`/api/team/${A}`), { headers: { accept: "application/json" } });
  if (r.ok) return { data: await r.json(), fromFixture: false };
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON body */ }
  if (r.status === 503 || (r.status === 404 && body?.error?.code === "not_compiled")) return await loadTeamFixture(A);
  throw new Error(body?.error?.message || `${r.status} /api/team/${A}`);
}

// Drops a team's cached response so the next getTeam() call re-fetches it — used after "Refresh now"
// completes (team.js) so the just-refreshed team doesn't keep showing its pre-refresh snapshot.
export function invalidateTeam(abbr) {
  teamCache.delete(String(abbr || "").toUpperCase());
}

async function loadTeamFixture(abbr) {
  const r = await fetch(`fixtures/team_${abbr}.json`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`no compiled data and no fixture for ${abbr} (${r.status})`);
  return { data: await r.json(), fromFixture: true };
}
