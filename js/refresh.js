// window.NFLRefresh — the manual "Refresh now" control (step 8) plus D53's auto-refresh-on-open.
// See the step-8 integration note for the exact <script> tag and header-button markup.
// Talks to server/api/refresh.js: POST /api/refresh to start a cycle, GET /api/refresh/status to poll it.
//
// D67 static mode: the published copy has no server to refresh from, so everything in here that starts a
// cycle turns into a no-op, the Refresh now button is hidden, and the header chip says when the snapshot
// was published instead of how old the data is. isStatic() is api.js's single source of truth for the mode
// (the <meta name="nfl-static"> flag publish.mjs injects); resolveUrl() maps /api/refresh/status onto the
// published api/refresh/status.json.
import { isStatic, resolveUrl } from "./api.js";

const POLL_MS = 5000;
const STALE_HOURS = 36; // matches server/api/refresh.js's isStale() and PROJECT.md Part 4's "ambers past 36h"

// D53: "the app refreshes itself when opened if the data is older than 6 hours" - but never more than once
// per page load (this flag) and never more than once per hour even across reloads (the localStorage
// timestamp below), so hammering F5 or leaving a tab open can't spin up cycle after cycle.
let autoRefreshAttemptedThisLoad = false;
const AUTO_REFRESH_STORAGE_KEY = "nfl:autoRefreshLastAttempt";
const AUTO_REFRESH_MIN_GAP_MS = 60 * 60e3;

// localStorage can throw (private browsing, quota, disabled storage) - never let that crash startup.
// A read failure just means "no record of a recent attempt", which is the safe default.
function readLastAutoRefreshAttempt() {
  try { return Number(localStorage.getItem(AUTO_REFRESH_STORAGE_KEY)) || 0; }
  catch { return 0; }
}
function writeLastAutoRefreshAttempt(ts) {
  try { localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(ts)); }
  catch { /* can't persist - the per-page-load flag above still prevents a second attempt this load */ }
}

// A small non-blocking toast in the corner, built with inline styles (this file may not touch
// public/css/*.css - owned by the Polish agent this session). Reused across calls: one element, its text
// and visibility swapped rather than creating a new node per toast.
let autoRefreshToastEl = null;
function showAutoRefreshToast(text) {
  if (!autoRefreshToastEl) {
    autoRefreshToastEl = document.createElement("div");
    autoRefreshToastEl.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:9999;font-size:12px;"
      + "color:rgba(255,255,255,.85);background:rgba(0,0,0,.75);padding:6px 14px;border-radius:20px;"
      + "box-shadow:0 2px 8px rgba(0,0,0,.4);transition:opacity .3s;pointer-events:none;";
    document.body.appendChild(autoRefreshToastEl);
  }
  autoRefreshToastEl.textContent = text;
  autoRefreshToastEl.style.opacity = "1";
  autoRefreshToastEl.hidden = false;
}
function hideAutoRefreshToast(delayMs = 2500) {
  const el = autoRefreshToastEl;
  if (!el) return;
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => { el.hidden = true; }, 300); }, delayMs);
}

async function getJson(url, opts) {
  let r;
  try { r = await fetch(resolveUrl(url), { headers: { accept: "application/json" }, ...opts }); }
  catch (e) { return { ok: false, status: 0, body: null, networkError: e }; }
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON body */ }
  return { ok: r.ok, status: r.status, body };
}

function setSpinning(buttonEl, on) {
  if (!buttonEl) return;
  if (buttonEl.dataset.origLabel === undefined) buttonEl.dataset.origLabel = buttonEl.textContent;
  buttonEl.disabled = on;
  buttonEl.classList.toggle("is-spinning", on);
  buttonEl.textContent = on ? "Refreshing…" : buttonEl.dataset.origLabel;
}

// Polls GET /api/refresh/status every 5s until running is false, then returns the final status (or null if
// every poll failed, e.g. the server was unreachable throughout). Callable on its own — no argument
// required — or with a tick callback (trigger() below uses this to know when to stop spinning).
export async function poll(onEachStatus) {
  for (;;) {
    const { ok, body } = await getJson("/api/refresh/status");
    const status = ok ? body : null;
    if (onEachStatus) onEachStatus(status);
    if (!status || !status.running) return status;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

// POSTs /api/refresh, disables buttonEl with a spinner label, polls until the run finishes, then dispatches
// "nfl:data-refreshed" on window so any page (team.js, landing.js) can reload without this file importing them.
// D65: the plain button is never forced - the server decides per source what is actually due, so clicking it
// twenty times does not re-ping the club sites. force:true (a deliberate "fetch everything now") is passed
// through as ?force=1 and makes the server ignore the cadence for that one run.
export async function trigger(buttonEl, { force = false } = {}) {
  if (isStatic()) return; // D67: nothing to refresh - the published copy is a snapshot, and the button is hidden
  setSpinning(buttonEl, true);
  try {
    const { ok, status, body, networkError } = await getJson(`/api/refresh${force ? "?force=1" : ""}`, { method: "POST" });
    if (networkError) throw new Error("could not reach the server");
    if (!ok && status !== 409) throw new Error(body?.error?.message || `refresh failed to start (${status})`);
    // A 409 means one is already running (e.g. the scheduled task fired moments ago) - fall through and
    // poll that run instead of treating it as a failure.
    await poll();
    window.dispatchEvent(new CustomEvent("nfl:data-refreshed"));
  } catch (e) {
    console.error("NFLRefresh.trigger failed:", e);
    if (buttonEl) buttonEl.title = e.message;
  } finally {
    setSpinning(buttonEl, false);
  }
}

function newestSuccess(sources) {
  const times = Object.values(sources || {}).map((s) => Date.parse(s?.lastSuccessAt ?? "")).filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function hasRecentError(sources) {
  return Object.values(sources || {}).some((s) => s?.lastError);
}

// D65: the two halves of the data now age at completely different rates, so one "data as of <time>" is a lie -
// after an injury-only cycle it would read as though the depth charts had just been refreshed too. The chip says
// what each half actually is: the NFL week the football data is from, and the clock time the injury feeds were
// last read. Kept to one short line (about the width of the old text, which the header is sized for); the full
// timestamps go in the tooltip.
const shortTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function cadenceChipText(cadence) {
  const football = cadence?.classes?.weekly;
  const injuries = cadence?.classes?.injury;
  if (!football?.at && !injuries?.at) return null;
  const parts = [];
  const week = football?.week ?? cadence?.week;
  if (football?.at) parts.push(`football: ${Number.isInteger(week) ? `wk ${week}` : new Date(football.at).toLocaleDateString()}`);
  if (injuries?.at) parts.push(`injuries: ${shortTime(injuries.at)}`);
  return parts.join(" · ");
}

// The same two facts spelled out in full for the tooltip.
function cadenceLines(cadence) {
  const out = [];
  const football = cadence?.classes?.weekly;
  const injuries = cadence?.classes?.injury;
  if (football?.at) out.push(`Football data: week ${football.week ?? cadence?.week ?? "?"} (fetched ${new Date(football.at).toLocaleString()})`);
  if (injuries?.at) out.push(`Injuries: ${new Date(injuries.at).toLocaleString()}`);
  return out;
}

// Fills el with "data as of <time>", amber past 36h, red if any source group's last attempt errored.
// There is no red chip class in public/css/styles.css yet (only .asof-chip.amber) and this file may not
// touch that stylesheet (owned by another builder this session), so the red state is applied as an inline
// style rather than a class - flagged in the step-8 integration note as worth promoting to real CSS later.
export async function renderStatus(el) {
  if (!el) return;
  const { ok, body } = await getJson("/api/refresh/status");
  if (isStatic()) return renderPublishedStatus(el, ok ? body : null);
  if (!ok || !body) { el.textContent = "data as of —"; el.classList.remove("amber"); el.style.background = ""; el.style.color = ""; return; }
  const asOf = newestSuccess(body.sources);
  const stale = body.stale ?? true;
  const errored = hasRecentError(body.sources);
  // D65 chip when the server knows the cadence; the old single timestamp is the fallback for a cache that has
  // never been through a post-D65 cycle.
  el.textContent = cadenceChipText(body.cadence) ?? `data as of ${asOf ? new Date(asOf).toLocaleString() : "—"}`;
  el.classList.toggle("amber", stale && !errored);
  el.style.background = errored ? "#5a1414" : "";
  el.style.color = errored ? "#ffb3b3" : "";
  const lines = cadenceLines(body.cadence);
  const headline = errored ? "At least one data source failed on the last refresh."
    : (stale ? "Data is more than 36 hours old." : "");
  el.title = [headline, ...lines].filter(Boolean).join("\n");
}

// D53: called once at startup (public/js/main.js, after the router starts). Starts a refresh cycle only
// if nothing is already running and the data looks stale, using the same "newest completed cycle, else
// newest per-source success" logic renderStatus/newestSuccess already use elsewhere in this file. Reuses
// poll() and dispatches the same "nfl:data-refreshed" event as the manual trigger() so every open view
// re-renders identically regardless of which path started the cycle.
// D65 keeps this 6-hour trigger exactly as it was: the question "should this page ask for a refresh at all"
// is still answered here, but WHAT that refresh fetches is now the server's decision, per source. So opening
// the app after six hours reads the injury feeds and leaves the football sources alone until the NFL week
// has moved on.
export async function autoRefreshIfStale({ maxAgeHours = 6 } = {}) {
  if (isStatic()) return; // D67: the published copy never contacts a football source
  if (autoRefreshAttemptedThisLoad) return; // never more than once per page load
  autoRefreshAttemptedThisLoad = true;

  const lastAttempt = readLastAutoRefreshAttempt();
  if (lastAttempt && Date.now() - lastAttempt < AUTO_REFRESH_MIN_GAP_MS) return; // never more than once/hour

  const { ok, body } = await getJson("/api/refresh/status");
  if (!ok || !body) return; // server unreachable - nothing to trigger, and no point recording an attempt
  if (body.running) return; // a scheduled run, a manual click, or another tab already started one

  const newest = body.lastRun?.finishedAt ?? newestSuccess(body.sources);
  const ageHours = newest ? (Date.now() - Date.parse(newest)) / 3_600_000 : Infinity;
  if (Number.isFinite(ageHours) && ageHours <= maxAgeHours) return; // fresh enough - nothing to do

  writeLastAutoRefreshAttempt(Date.now());
  try {
    showAutoRefreshToast("Refreshing data…");
    const { ok: postOk, status, networkError } = await getJson("/api/refresh", { method: "POST" });
    if (networkError) throw new Error("could not reach the server");
    // 409 = a run started between our status check and this POST (another tab, the scheduled task, a
    // manual click) - not a failure, just poll that run instead, exactly like trigger() does.
    if (!postOk && status !== 409) throw new Error(`auto-refresh failed to start (${status})`);
    await poll();
    showAutoRefreshToast("Data updated");
    window.dispatchEvent(new CustomEvent("nfl:data-refreshed"));
    hideAutoRefreshToast();
  } catch (e) {
    console.error("NFLRefresh.autoRefreshIfStale failed:", e);
    if (autoRefreshToastEl) autoRefreshToastEl.hidden = true; // fail silent per spec - no error toast
  }
}

// D67: the published chip. "data as of" would be misleading on a copy that can never update itself - what a
// visitor needs to know is when the snapshot was taken. The full football-week / injury-clock detail still
// goes in the tooltip, so the same two facts are one hover away.
function renderPublishedStatus(el, body) {
  const at = body?.published ?? body?.lastRun?.finishedAt ?? null;
  el.textContent = at ? `published ${new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "published snapshot";
  // The header chip ships hidden (index.html) because the live app shows the same fact in the team header.
  // On the published copy it is the only place that says how old the whole snapshot is, so show it.
  el.hidden = false;
  el.classList.remove("amber");
  el.style.background = ""; el.style.color = "";
  el.title = [at ? `Published ${new Date(at).toLocaleString()}` : "", ...cadenceLines(body?.cadence), "This is a published copy; it updates only when a new snapshot is published."].filter(Boolean).join("\n");
}

// The Refresh now button is markup owned by public/js/team.js and re-created on every team render, so the
// published copy hides it with one stylesheet rule rather than reaching into that file's DOM after the fact.
function hideRefreshControls() {
  if (typeof document === "undefined" || document.getElementById("nfl-static-style")) return;
  const s = document.createElement("style");
  s.id = "nfl-static-style";
  s.textContent = ".refresh-btn{display:none !important;}";
  (document.head || document.documentElement).appendChild(s);
}
if (isStatic()) hideRefreshControls();

window.NFLRefresh = { trigger, poll, renderStatus, autoRefreshIfStale, isStatic };
