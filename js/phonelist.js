// D138 step 1 (Adam, 2026-09-17, for "people I share the link with"): "I would like this to auto-properly
// appear on phones." An upright phone — and a tablet held upright — gets NO field: it gets this vertical
// list of the same columns, by position group, with an Offense/Defense toggle. A sideways phone keeps the
// field (step 5 gives it drag-to-pan).
//
// THE ONE RULE THIS FILE LIVES BY: it renders no card markup of its own. Every player row on this page is
// cards.js's renderColumn output, drawn from field.js's computeLayout columns at the reduced depth cap
// ({ maxDepthRows: 1, depthChip: true }) — the same renderer, the same rows, the same badges, banners,
// rating tiers and tooltips the desktop pages draw. If a ruling changes a card, it changes here too,
// because there is nothing here to change. What this file does own is the PAGE: the group headings, the
// pinned toggle, the "not on chart" disclosure and the column-pill popover.
//
// Nothing here goes through the canvas transform: the list is real CSS type at real CSS sizes (phone.css),
// and the field's scaled canvas and this list never appear on the same page.
import { computeLayout, levelGroups } from "./field.js";
import { renderColumn, renderTray, esc, fitNames, wireDepthToggles, espnSchemeOf, PHONE_HEADSHOT_MIN_RATING } from "./cards.js";
import { registerView, decideViewMode } from "./viewfit.js";
import { wireNav } from "./nav.js";

// The one set of drawing options this page asks computeLayout and renderColumn for (D138's plan): the
// line-one men plus ONE backup, the rest behind an expanding "+N more" chip. Exported so the tests can
// prove the list draws the SAME string renderColumn draws, rather than a look-alike.
export const PHONE_LAYOUT_OPTS = { maxDepthRows: 1, depthChip: true };
// D138(4): a headshot only for a man rated 90 or more; everyone else gets no photo and no initials disc,
// and the width goes to his name. 32px is the photo's own CSS size on this page (44px row, 6px of air).
const PHONE_HEADSHOT = { size: 32, minRating: PHONE_HEADSHOT_MIN_RATING };
const RESIZE_DEBOUNCE = 180;

// A column's place in the list is exactly its place on the field: the level groups in reading order, and
// left to right inside each one (so the pass catchers read WR1, WR · Slot, TE, WR2, and the line LT to RT).
// A stacked column (TE2 under TE1) shares its leader's x and follows it.
function columnsOf(layout, unit, bands) {
  return layout.columns
    .filter((c) => c.unit === unit && bands.includes(c.band))
    .sort((a, b) => a.x - b.x || (a.yOffset ?? 0) - (b.yOffset ?? 0));
}

function sectionsHtml(layout, unit, teamAbbr, opts) {
  return levelGroups(unit).map((group) => {
    const cols = columnsOf(layout, unit, group.bands);
    if (!cols.length) return ""; // a band nobody charts (a 4-3's EDGE row) prints no heading either
    return `<section class="phone-group">
      <h2 class="phone-group-head">${esc(group.label)}</h2>
      <div class="phone-cols">${cols.map((c) => renderColumn(c, teamAbbr, opts)).join("")}</div>
    </section>`;
  }).join("");
}

// D68: the "not on chart" trays are one collapsed disclosure at the foot of the unit rather than a strip
// under each band — on a phone they are the least important thing on the page, but they must still be
// reachable. The strips themselves are cards.js's renderTray, unchanged.
function trayHtml(layout, unit, teamAbbr) {
  const trays = layout.trays.filter((t) => t.unit === unit);
  const n = trays.reduce((sum, t) => sum + (t.entries?.length || 0), 0);
  if (!n) return "";
  return `<details class="phone-tray">
    <summary>not on chart (${n})</summary>
    <div class="phone-tray-body">${trays.map((t) => renderTray(t, teamAbbr)).join("")}</div>
  </details>`;
}

// The options renderColumn is handed on this page: exactly the Team page's own (D70's coloured pills,
// D91's snap tooltips, D137's ESPN formation for the placement verdict), plus D138(4)'s photo rule.
// Exported so a test can render a column through renderColumn with the SAME options the list uses and
// compare the two strings — which is what proves this file defines no card markup of its own.
export function columnOpts(view) {
  const map = new Map();
  for (const unit of ["OFF", "DEF"]) for (const s of view.units?.[unit] || []) map.set(s.slotId, s.label);
  return { slotLookup: (slotId) => map.get(slotId), scheme: view.scheme, espnScheme: espnSchemeOf(view), headshot: PHONE_HEADSHOT };
}

// The list's BODY for one unit — the group sections and the "not on chart" disclosure — as a pure function
// of the compiled view. renderPhoneList below calls exactly this; nothing else builds the list's markup.
export function phoneListBody(view, unit, teamAbbr, { layout = null, opts = null } = {}) {
  const lay = layout || computeLayout(view, PHONE_LAYOUT_OPTS);
  const colOpts = opts || columnOpts(view);
  return `${sectionsHtml(lay, unit, teamAbbr, colOpts)}${trayHtml(lay, unit, teamAbbr)}`;
}

const unitLabel = (unit) => (unit === "OFF" ? "Offense" : "Defense");

// The pinned segmented control. Two real buttons, 44px tall, with the pressed state on the button itself so
// it reads without colour alone.
function toggleHtml(unit) {
  const btn = (u) => `<button type="button" class="phone-seg${u === unit ? " is-on" : ""}" data-unit="${u}" aria-pressed="${u === unit}">${unitLabel(u)}</button>`;
  return `<div class="phone-toggle" role="group" aria-label="Offense or defense">${btn("OFF")}${btn("DEF")}</div>`;
}

// renderPhoneList(root, opts) — draws the whole team page as the list and keeps it there until the window
// stops being a list window.
//   view/team/teams/abbr   the same objects team.js's field page is built from
//   chrome                 { nav, header, legend } — markup team.js already owns (the nav strip, the club
//                          header with its Refresh button and as-of chip, the Legend key), passed in as
//                          strings rather than imported, so this module and team.js do not import each other
//   rerender               re-runs team.js's own renderTeam, which re-decides the mode (viewfit.js)
export function renderPhoneList(root, { view, team, abbr, chrome, rerender }) {
  // One layout and one set of options for both units, computed once: the toggle only re-prints.
  const layout = computeLayout(view, PHONE_LAYOUT_OPTS);
  const opts = columnOpts(view);

  let unit = "OFF";
  const bodyHtml = () => phoneListBody(view, unit, abbr, { layout, opts });

  root.innerHTML = `
    <div class="phone-list" style="--team-primary:${esc(team.colourPrimary)};--team-secondary:${esc(team.colourSecondary)}">
      ${chrome.nav}
      <div class="phone-head">${chrome.header}${chrome.legend}</div>
      ${toggleHtml(unit)}
      <div class="phone-body">${bodyHtml()}</div>
      <aside class="player-panel" hidden></aside>
    </div>`;
  // The club header is drawn in its own compact state, the same classes the small-screen field page uses
  // (D134 step 1), so the two never explain the same header differently.
  root.querySelector(".teamhead")?.classList.add("teamhead-compact");
  root.querySelector(".legend-banner")?.classList.add("legend-collapsed");

  const body = root.querySelector(".phone-body");
  const draw = () => {
    body.innerHTML = bodyHtml();
    fitNames(body);
  };
  fitNames(body);

  // The toggle. Redrawing the body is cheap (one innerHTML of the unit that is now showing) and keeps the
  // page's own scroll position, which a full re-render would throw away.
  root.querySelector(".phone-toggle")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".phone-seg");
    if (!btn || btn.dataset.unit === unit) return;
    unit = btn.dataset.unit;
    for (const b of root.querySelectorAll(".phone-seg")) {
      const on = b.dataset.unit === unit;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    draw();
    window.scrollTo(0, 0);
  });

  wireDepthToggles(body); // the "+N more" chips expand their column in place, as on every other page
  wireNav(root);          // D59: the same strip, the same switcher, on this page too
  const unwirePill = wireColumnPills(root);

  // D138: the mode is decided by MEASURING the window, on a debounced fresh pass — never inside a
  // ResizeObserver, and never from a user-agent string. A window that has stopped being a list window
  // (a phone turned sideways) re-renders the page, which hands it back to the field.
  let timer = null;
  const onResize = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (decideViewMode() !== "list") rerender(); }, RESIZE_DEBOUNCE);
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  const dispose = () => {
    clearTimeout(timer);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    unwirePill();
  };
  registerView(dispose);
  return dispose;
}

// B4 (hover-only information): the column pill carries a `reason` in its title — why this column is
// numbered WR2, which men qualify for the slot column (D86/D92/D93). A phone has no hover, so a tap on the
// pill opens that sentence as a popover instead of following the pill's link; the link itself survives as
// the popover's own "See every player" line, so the group page is still reachable. The player-specific
// tooltips (the ESPN placement, the fill-in reason) are step 2's job, in the player sheet.
function wireColumnPills(root) {
  const close = () => { for (const el of root.querySelectorAll(".phone-pop")) el.remove(); };
  const onClick = (e) => {
    const pill = e.target.closest(".column-label");
    if (!pill || !root.contains(pill)) { close(); return; }
    // The pill's title is the column's reason sentence plus, for the desktop reader, the provenance of its
    // label ("source: espn") and the injury-heat line. The provenance is an internal word, so the popover
    // drops it and shows only what a reader asked: why this column is numbered or named what it is.
    const text = (pill.getAttribute("title") || "").split(" · ").filter((part) => !/^source: /.test(part)).join(" · ");
    // A tap NEVER silently leaves the list — a pill with nothing to explain still opens the popover, which
    // is where the link to that position group lives. Leaving the page stays the reader's own choice.
    e.preventDefault();
    const open = pill.nextElementSibling?.classList.contains("phone-pop");
    close();
    if (open) return;
    const pop = document.createElement("div");
    pop.className = "phone-pop";
    pop.innerHTML = `${text ? `<span class="phone-pop-text">${esc(text)}</span>` : ""}<a class="phone-pop-link" href="${esc(pill.getAttribute("href"))}">See every player at this position</a>`;
    pill.after(pop);
  };
  root.addEventListener("click", onClick);
  return () => { close(); root.removeEventListener("click", onClick); };
}
