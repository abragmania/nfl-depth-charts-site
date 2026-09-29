// Rankings (#/rankings, D208): ONE page, an Offense | Defense switch on top, the old Offense and Defense league
// tables (views/offense.js, views/defense.js) unchanged beneath it - this file does not redraw either table, it
// wraps whichever renderOffense/renderDefense already draws and adds the switch and the `hl` highlight. The old
// #/offense and #/defense addresses keep working: main.js aliases them to #/rankings via legacyHash below, and
// router.js's pageKey folds all three paths to the same "rankings" page for the Back button.
//
// Every view is a link (D177): the switch is `side=off|def` in the hash query (off is the default, so a plain
// #/rankings and #/rankings?side=off are the same address); `hl=<club abbr>` highlights that club's row (a Grid
// cell or a club tile's Rankings link, D206) and scrolls it into view. Both are read straight off the raw query
// string rather than through filters.js's fromQuery/toQuery, since neither is part of that shared filter state -
// offense.js and defense.js's own `go()` still write plain #/offense/#/defense links for every OTHER filter, sort
// and row-open change, and those round-trip straight back through the same alias, so nothing else here needs to
// know about them.
import { renderOffense, offTableHtml } from "./offense.js";
import { renderDefense, defTableHtml } from "./defense.js";

const ABBR_RE = /^[A-Z]{2,3}$/;

function rawQuery(query) {
  return new URLSearchParams(String(query || "").replace(/^\?/, ""));
}

// PURE: which side a #/rankings query asks for. Anything but an explicit "def" is the default, Offense.
export function sideOf(query) {
  return rawQuery(query).get("side") === "def" ? "def" : "off";
}

// PURE: the validated club abbr to highlight, or "" (same shape as filters.js's own team/opp validation).
export function hlOf(query) {
  const v = String(rawQuery(query).get("hl") || "").toUpperCase();
  return ABBR_RE.test(v) ? v : "";
}

// PURE: the redirect target for the old bare #/offense and #/defense addresses - side is added (or, for the
// default Offense side, left off so the address matches what rankSideSeg itself would have written) and every
// other query key rides along unchanged. main.js calls this from a plain location.replace, the same pattern its
// own unmatched-route fallback uses, so the old address never gets its own entry in browser history.
export function legacyHash(side, query) {
  const params = rawQuery(query);
  if (side === "def") params.set("side", "def"); else params.delete("side");
  const qs = params.toString();
  return `#/rankings${qs ? "?" + qs : ""}`;
}

// PURE: the Offense | Defense segmented control, styled like views/team.js's teamSideSeg (an-tm-seg/an-tm-segbtn,
// already in analytics.css - no new CSS needed for the switch itself). Every other filter key rides along
// unchanged; `hl` is kept across a side switch (the reader is still looking for the same club).
export function rankSideSeg(query, side) {
  const params = rawQuery(query);
  const off = side !== "def";
  const hrefFor = (s) => {
    const p = new URLSearchParams(params);
    if (s === "def") p.set("side", "def"); else p.delete("side");
    const qs = p.toString();
    return `#/rankings${qs ? "?" + qs : ""}`;
  };
  return `<div class="an-tm-seg" role="tablist">` +
    `<a class="an-tm-segbtn${off ? " on" : ""}" href="${hrefFor("off")}" aria-current="${off}">Offense</a>` +
    `<a class="an-tm-segbtn${off ? "" : " on"}" href="${hrefFor("def")}" aria-current="${!off}">Defense</a>` +
    `</div>`;
}

export async function renderRankings(ctx, query) {
  const { root, isCurrent } = ctx;
  const side = sideOf(query);
  const hl = hlOf(query);
  // hl is threaded into the table itself (offTableHtml/defTableHtml's own `view.hl`, so the row's "is-hl" class
  // is part of that pure, tested markup) rather than patched on afterwards from here.
  if (side === "def") await renderDefense(ctx, query, { hl }); else await renderOffense(ctx, query, { hl });
  if (!isCurrent()) return;
  document.title = "Rankings · NFL Analytics";
  const h1 = root.querySelector(".an-head h1");
  if (h1) h1.insertAdjacentHTML("afterend", rankSideSeg(query, side));
  if (hl) root.querySelector(`tr.an-row[data-id="${hl}"]`)?.scrollIntoView({ block: "center" });
}

// Re-exported so a rankings-focused test can reach the underlying pure table functions without a second import
// path; both are unchanged, still exported from their own files too.
export { offTableHtml, defTableHtml };
