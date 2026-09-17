// D59 (Adam, 2026-09-14): "never stuck on a page." Every team-context page (whole-team, offense/defense
// side view, position-group view, matchup) now renders the SAME navigation strip directly under the app
// bar: a link back to all teams, the team switcher, and Team/Offense/Defense/Matchup pills with the
// current page lit. One module, one markup, one wiring function, so a route can never drift from another
// route's idea of "how do I get to Offense from here" — team.js, zoom.js and matchup.js all call this
// instead of each carrying its own copy of the switcher/pills/breadcrumb (which is what D59 replaces).
import { esc } from "./cards.js";

function switcherOptionsHtml(teams, abbr) {
  return teams.slice().sort((a, b) => a.abbr.localeCompare(b.abbr))
    .map((t) => `<option value="${esc(t.abbr)}" ${t.abbr === abbr ? "selected" : ""}>${esc(t.abbr)} — ${esc(t.name)}</option>`)
    .join("");
}

// opts:
//   teams          full team list, for the switcher's options
//   abbr           the team this page is about (team A on the matchup page)
//   page           "team" | "off" | "def" | "group" | "matchup" — which pill lights and how the switcher
//                  routes (see wireNav)
//   unit           "OFF" | "DEF" — only meaningful on a group page, decides whether the Offense or Defense
//                  pill lights (a group belongs to one side, D59: "the Offense or Defense pill is lit")
//   bandLabel      group page only — the band's display label ("OL"), shown as a trailing crumb
//   bandSlug       group page only — the band's route segment (lower-cased band code), for the switcher
//   opponentAbbr   matchup page only — team B, for the "A team page · B team page" links
//   primary/secondary  the team's colours, so the strip is tinted like the rest of the page's chrome
// The D50 one-line injury summary does NOT render here: it already shows once, as the red chip in the
// team header.
export function navStripHtml({ teams, abbr, page, unit, bandLabel, bandSlug, opponentAbbr, primary, secondary }) {
  const A = esc(abbr);
  const offLit = page === "off" || (page === "group" && unit === "OFF");
  const defLit = page === "def" || (page === "group" && unit === "DEF");
  const pill = (label, href, lit) => `<a class="zoom-pill nav-pill${lit ? " active" : ""}" href="${href}">${label}</a>`;
  const pills = `<span class="nav-strip-pills">
    ${pill("Team", `#/team/${A}`, page === "team")}
    ${pill("Offense", `#/team/${A}/off`, offLit)}
    ${pill("Defense", `#/team/${A}/def`, defLit)}
    ${pill("Matchup", `#/matchup/${A}`, page === "matchup")}
  </span>`;
  // A group page's crumb links nowhere (D59 spec) — it names the band you are already looking at.
  const crumb = page === "group" && bandLabel
    ? `<span class="nav-strip-crumb"><span class="crumb-sep">›</span> ${esc(bandLabel)}</span>` : "";
  const matchLinks = page === "matchup" && opponentAbbr
    ? `<span class="nav-strip-matchlinks"><a href="#/team/${A}">${A} team page</a> · <a href="#/team/${esc(opponentAbbr)}">${esc(opponentAbbr)} team page</a></span>`
    : "";
  const colourStyle = primary ? ` style="--team-primary:${primary};--team-secondary:${secondary || primary}"` : "";
  return `<div class="nav-strip" data-page="${esc(page)}" data-band="${esc(bandSlug || "")}"${colourStyle}>
    <a class="nav-strip-all" href="#/">All teams</a>
    <select class="team-switcher nav-switcher" aria-label="Switch team">${switcherOptionsHtml(teams, abbr)}</select>
    ${pills}${crumb}${matchLinks}
  </div>`;
}

// Binds the switcher to the EQUIVALENT route for whatever page this strip is on (D59): picking a new team
// from Offense goes to that team's Offense, from a group page to the same band, from the matchup to the
// new team's matchup, otherwise to its whole-team page. Reads the page/band the strip was built with off
// its own data attributes, so the caller doesn't have to pass that context a second time.
export function wireNav(root) {
  const strip = root.querySelector(".nav-strip");
  const switcher = strip?.querySelector(".nav-switcher");
  if (!strip || !switcher) return;
  const page = strip.dataset.page;
  const band = strip.dataset.band;
  switcher.addEventListener("change", (e) => {
    const next = e.target.value;
    if (page === "off") location.hash = `#/team/${next}/off`;
    else if (page === "def") location.hash = `#/team/${next}/def`;
    else if (page === "group" && band) location.hash = `#/team/${next}/group/${band}`;
    else if (page === "matchup") location.hash = `#/matchup/${next}`;
    else location.hash = `#/team/${next}`;
  });
}
