// D46 matchup view: one team's OFFENSE facing another team's DEFENSE across a line of scrimmage.
//
// 👁 QA item 1 (2026-09-13), which supersedes this file's original card-based layout: the matchup must fit
// one 1700x900 screen. Two complete units of photo cards stacked vertically never could — it ran to ~1790px
// and needed scrolling to see the defense at all. It is now built on exactly the same compact overview the
// whole-team page uses: field.js's computeLayout plus cards.js's renderColumn, fed a SYNTHETIC TeamView
// whose OFF unit is team A's and whose DEF unit is team B's. That is the whole implementation — the line
// of scrimmage, the level stripes, the TE block under its own TIGHT ENDS label (QA item 7), the facing
// order (offense reading bottom-up toward the ball, defense reading down from it, QA item 8) and the
// fit-the-window scaling all come from the shared engine rather than from a parallel one here that had to
// be kept in step with it by hand.
//
// Route #/matchup/:a/:b renders A-offense-over-B-defense; #/matchup/:a alone resolves B from A's
// header.nextOpponent (this week's schedule) and redirects, or shows a picker on a bye week.
import { getTeams, getTeam } from "./api.js";
import { esc, renderColumn, renderTray, fitNames } from "./cards.js";
import { computeLayout, renderFieldSvg, renderLevelLabels, FIELD_VARIANT, SECONDARY_ONE_ROW } from "./field.js";
import { mountScaledField, disposeCurrentView } from "./viewfit.js";
import { navStripHtml, wireNav } from "./nav.js";
import { isLightWash } from "./landing.js";
import { legendHtml } from "./team.js"; // D111: one legend, drawn on both pages (see matchupLegendHtml)

const dash = "\u2014";
const record = (r) => (r ? `${r.wins}-${r.losses}${r.ties ? "-" + r.ties : ""}` : dash);

// The two teams' slot labels, so a card's "also listed at" chip resolves against whichever unit it came
// from (cards.js's alsoListedChips takes one lookup per column).
// 🔵 review finding 7: slot ids are `${unit}-${band}-${n}`, so BOTH teams have an "OFF-WR-1" and a
// "DEF-DL-1". Indexing all four half-views meant whichever team was walked last silently won every
// lookup, and an "also listed at" chip could name the wrong team's slot. Only the two halves actually
// drawn on this field are indexed, and they cannot collide with each other.
function slotLookupFor(viewA, viewB) {
  const map = new Map();
  for (const sl of viewA?.units?.OFF || []) map.set(sl.slotId, sl.label);
  for (const sl of viewB?.units?.DEF || []) map.set(sl.slotId, sl.label);
  return (slotId) => map.get(slotId);
}

// A TeamView shaped exactly as computeLayout expects, assembled from two real ones. Only the OFF half of
// A and the DEF half of B are taken, which is the whole point of the view; `scheme` comes from B because
// it is B's front that gets drawn.
function facingView(viewA, viewB) {
  return {
    scheme: viewB.scheme,
    units: { OFF: viewA.units?.OFF || [], DEF: viewB.units?.DEF || [] },
    unlisted: { OFF: viewA.unlisted?.OFF || {}, DEF: viewB.unlisted?.DEF || {} },
  };
}

// One quiet summary line per team, from view.heat.summary (same string team.js's own header chip uses).
function heatSummaryHtml(view) {
  const summary = view?.heat?.summary;
  const text = typeof summary === "string" ? summary
    : Array.isArray(summary) ? summary.map((x) => (typeof x === "string" ? x : x?.text)).filter(Boolean).join(" \u00b7 ")
    : "";
  return text ? `<div class="matchup-team-heat">${esc(text)}</div>` : "";
}

// Same URL rule team.js's fieldHtml uses for its single watermark (D95/D98 part 1): prefer the dark
// crest, fall back to the plain logo, and make a bare "img/logos/..." path root-relative so it resolves
// against the document rather than against styles.css's own /css/ location.
function watermarkUrl(team) {
  let u = team.logoDark || team.logo || "";
  if (u && !/^https?:\/\//.test(u) && !u.startsWith("/")) u = "/" + u;
  return u;
}

// D98 part 2: one crest per half, each sized to ~74% of that half's own height (70-80% asked for) and
// centred within it, reading the split straight off the layout this same field already computed (the
// line of scrimmage sits at layout.losY, not always exactly the canvas midpoint once margins are in) so
// neither crest can ever cross into the other half or overlap the line of scrimmage.
function halfWatermarkHtml(layout, team, half) {
  const url = watermarkUrl(team);
  if (!url) return "";
  const span = half === "def" ? layout.losY : layout.layoutHeight - layout.losY;
  const center = half === "def" ? layout.losY / 2 : layout.losY + span / 2;
  const topPct = (center / layout.layoutHeight) * 100;
  const heightPct = ((span * 0.74) / layout.layoutHeight) * 100;
  return `<div class="matchup-watermark-crest" style="--wm-url:url('${esc(url)}');top:${topPct}%;height:${heightPct}%"></div>`;
}

// Each column is tinted with the colours of the team it actually belongs to, so a glance at any row says
// whose players those are without reading the header — the one thing a single shared field wash cannot do
// when two teams are on it.
function fieldHtml(viewA, viewB, teamA, teamB, spread) {
  const view = facingView(viewA, viewB);
  const layout = computeLayout(view, { spread });
  const slotLookup = slotLookupFor(viewA, viewB);
  const colour = (t) => `--team-primary:${t.colourPrimary};--team-secondary:${t.colourSecondary}`;
  const columnsHtml = layout.columns.map((c) => {
    const team = c.unit === "OFF" ? teamA : teamB;
    return renderColumn(c, team.abbr, { slotLookup, scheme: view.scheme, colourStyle: colour(team) });
  }).join("");
  const traysHtml = layout.trays.map((t) => renderTray(t, (t.unit === "OFF" ? teamA : teamB).abbr)).join("");
  // D98 part 2: B defends (top half), A is on offense (bottom half) — see facingView above.
  const watermarkHtml = `<div class="field-watermark">${halfWatermarkHtml(layout, teamB, "def")}${halfWatermarkHtml(layout, teamA, "off")}</div>`;
  // D99: the field surface tints each half with its own club. --team-primary/--team-secondary (from
  // colour(teamB)) already carry the defending club for the header pill and column tints (D98 part 2);
  // --team-a-primary/--team-a-secondary add the offensive club's colours for styles.css's
  // .matchup-field .field-scale rule, and --los-pct gives it the real seam position off the same
  // layout.losY the cards and yard lines already use, so the blend always lines up with the actual line
  // of scrimmage rather than a hardcoded 50/50 split.
  const losPct = ((layout.losY / layout.layoutHeight) * 100).toFixed(2);
  return {
    layout,
    html: `<div class="field-outer matchup-field" data-field-variant="${FIELD_VARIANT}" style="${colour(teamB)};--team-a-primary:${teamA.colourPrimary};--team-a-secondary:${teamA.colourSecondary};--los-pct:${losPct}%">
      <div class="field-scale" style="width:${layout.layoutWidth}px;height:${layout.layoutHeight}px">
        ${watermarkHtml}
        ${renderFieldSvg(layout.layoutHeight, layout.losY, layout.layoutWidth)}
        <div class="field-layer">${columnsHtml}${traysHtml}</div>
        <div class="level-layer">${renderLevelLabels(layout.levels, layout.layoutWidth)}</div>
      </div>
    </div>`,
  };
}

function logoPlate(team, extraClass) {
  return `<img class="matchup-logo${extraClass ? " " + extraClass : ""}" src="${esc(team.logoDark)}" alt="${esc(team.abbr)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'matchup-logo matchup-logo-fallback',textContent:'${esc(team.abbr)}'}))">`;
}

// ---- header / breadcrumb ----

// D111 (Adam, 2026-09-16): "same on the matchup page (its two-club header: put the legend on the centre
// block or under it, not taller)." The key is the same six items the team page prints, in the same words —
// the two pages must never explain the same cards differently — sitting under the opponent picker inside
// the centre block. That block is the SHORT one: the header's height is set by the two club panels, whose
// 60px crest and three text lines run ~30 units taller than the title plus its controls, so the legend goes
// into slack that already existed and .matchup-head does not grow (styles.css's `.matchup-vs.has-legend`,
// which also tightens the block's own gap to pay for the extra line). With SECONDARY_ONE_ROW false the
// centre block is exactly what it was before the ruling and no legend is printed here at all.
// The markup is team.js's own legendHtml, imported rather than copied: the two pages draw the same cards, so
// a reworded key must reword on both at once or the copies drift the way four of them once did over
// OUT_STATUS_CODES.
const matchupLegendHtml = () => (SECONDARY_ONE_ROW ? legendHtml("legend-matchup") : "");

function headerHtml(teamA, teamB, viewA, viewB, teams) {
  const recA = viewA?.header?.record ?? teamA.record;
  const recB = viewB?.header?.record ?? teamB.record;
  // 👁 QA (2026-09-15, item 7): a club whose primary is pale (New Orleans' gold) gets dark ink on its
  // panel, exactly as its landing tile does - same function, same threshold, so the two can never disagree.
  const inkA = isLightWash(teamA.colourPrimary) ? " matchup-team-light" : "";
  const inkB = isLightWash(teamB.colourPrimary) ? " matchup-team-light" : "";
  return `<div class="matchup-head">
    <div class="matchup-team matchup-team-a${inkA}" style="--team-primary:${teamA.colourPrimary};--team-secondary:${teamA.colourSecondary}">
      ${logoPlate(teamA)}
      <div class="matchup-team-info">
        <div class="matchup-team-name">${esc(teamA.name)}</div>
        <div class="matchup-team-sub">Record ${record(recA)}</div>
        ${heatSummaryHtml(viewA)}
      </div>
    </div>
    <div class="matchup-vs${SECONDARY_ONE_ROW ? " has-legend" : ""}">
      <div class="matchup-title">${esc(teamA.abbr)} <span class="matchup-title-unit">offense</span> vs ${esc(teamB.abbr)} <span class="matchup-title-unit">defense</span></div>
      <div class="matchup-vs-controls">
        ${opponentPickerHtml(teams, teamA, teamB)}
        <a class="matchup-swap" href="#/matchup/${esc(teamB.abbr)}/${esc(teamA.abbr)}" title="Swap: ${esc(teamB.abbr)} offense vs ${esc(teamA.abbr)} defense">⇄ Swap sides</a>
      </div>
      ${matchupLegendHtml()}
    </div>
    <div class="matchup-team matchup-team-b${inkB}" style="--team-primary:${teamB.colourPrimary};--team-secondary:${teamB.colourSecondary}">
      <div class="matchup-team-info matchup-team-info-right">
        <div class="matchup-team-name">${esc(teamB.name)}</div>
        <div class="matchup-team-sub">Record ${record(recB)}</div>
        ${heatSummaryHtml(viewB)}
      </div>
      ${logoPlate(teamB)}
    </div>
  </div>`;
}

// D100: the same "all 31 other clubs, alphabetised" option list backs both the bye-week picker (which has
// no B yet) and the header's opponent dropdown (which always has one) — one place builds it so the two
// pickers can never drift into different sort orders or a different label format.
function opponentOptionsHtml(teams, aAbbr, selectedAbbr) {
  return teams.slice()
    .filter((t) => t.abbr !== aAbbr)
    .sort((a, b) => a.abbr.localeCompare(b.abbr))
    .map((t) => `<option value="${esc(t.abbr)}" ${t.abbr === selectedAbbr ? "selected" : ""}>${esc(t.abbr)} — ${esc(t.name)}</option>`)
    .join("");
}

// D100 (Adam, 2026-09-16): the opponent is always changeable from the header, not just on a bye week.
// Sits beside the title and the Swap sides button in the centre block (D58: the header must not grow
// taller, so this shares the swap button's row rather than adding one of its own). Defaults to A's
// scheduled opponent; when the current B isn't that team, a muted note names the scheduled one so the
// default stays visible even while looking at a hand-picked matchup.
function opponentPickerHtml(teams, teamA, teamB) {
  const nextOppAbbr = teamA.nextOpponent?.abbr;
  const notScheduled = nextOppAbbr && nextOppAbbr !== teamB.abbr;
  const note = notScheduled
    ? `<span class="matchup-opp-note">not this week's opponent (next: ${esc(nextOppAbbr)})</span>` : "";
  return `<span class="matchup-opp-picker">
    <label for="matchup-opp-select">Opponent</label>
    <select id="matchup-opp-select" aria-label="Change opponent">${opponentOptionsHtml(teams, teamA.abbr, teamB.abbr)}</select>
    ${note}
  </span>`;
}

function wireOpponentPicker(root, A) {
  const select = root.querySelector("#matchup-opp-select");
  if (!select) return;
  select.addEventListener("change", (e) => {
    const b = e.target.value;
    if (b) location.hash = `#/matchup/${A}/${b}`;
  });
}

function notFoundHtml(abbr) {
  return `<div class="notfound">No such team "${esc(abbr)}". <a class="back" href="#/">Back to all teams</a></div>`;
}

function errorHtml(e) {
  return `<div class="notfound">Couldn't load that matchup: ${esc(e.message)} <a class="back" href="#/">Back to all teams</a></div>`;
}

// A-has-no-game-this-week (bye) picker: A is fixed, pick any opponent to build the matchup by hand.
function byePickerHtml(teamA, teams) {
  const opts = opponentOptionsHtml(teams, teamA.abbr, null);
  return `<div class="matchup-picker">
    <h1>${esc(teamA.name)} matchup</h1>
    <p class="matchup-picker-note">${esc(teamA.abbr)} has no game on this week's schedule (bye). Pick an opponent to build a matchup anyway.</p>
    <form id="matchup-picker-form" class="matchup-picker-form">
      <span class="matchup-picker-fixed">${esc(teamA.abbr)} offense vs</span>
      <select id="matchup-picker-b" aria-label="Opponent team">${opts}</select>
      <span class="matchup-picker-fixed">defense</span>
      <button type="submit">Go</button>
    </form>
  </div>`;
}

function wireByePicker(root, A) {
  const form = root.querySelector("#matchup-picker-form");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const b = root.querySelector("#matchup-picker-b").value;
    if (b) location.hash = `#/matchup/${A}/${b}`;
  });
}

// ---- entry point ----

export async function renderMatchup(root, search, aAbbr, bAbbr) {
  search.hidden = true;
  disposeCurrentView(); // the outgoing view's observers must not outlive its DOM (🔵 review 1)
  const A = (aAbbr || "").toUpperCase();
  const { teams } = await getTeams();
  const teamA = teams.find((t) => t.abbr === A);
  if (!teamA) {
    document.title = "NFL Depth Charts";
    root.innerHTML = notFoundHtml(aAbbr);
    return;
  }

  if (!bAbbr) {
    const opp = teamA.nextOpponent;
    if (opp && opp.abbr) {
      location.hash = `#/matchup/${A}/${opp.abbr}`; // hashchange re-invokes this route with :b resolved
      return;
    }
    document.title = `${teamA.name} Matchup — NFL Depth Charts`;
    // D59 follow-up (Adam, 2026-09-14): the bye-week picker is a team-context page too — it gets the same
    // strip (Matchup pill lit, no opponent links since there's no team B yet) instead of its old lone
    // "Back to team" link, so picking a bye-week matchup doesn't strand you any differently than any other
    // route does.
    root.innerHTML = `
      ${navStripHtml({ teams, abbr: A, page: "matchup", primary: teamA.colourPrimary, secondary: teamA.colourSecondary })}
      ${byePickerHtml(teamA, teams)}`;
    wireByePicker(root, A);
    wireNav(root);
    return;
  }

  const B = bAbbr.toUpperCase();
  const teamB = teams.find((t) => t.abbr === B);
  if (!teamB) {
    document.title = "NFL Depth Charts";
    root.innerHTML = notFoundHtml(bAbbr);
    return;
  }

  document.title = `${A} offense vs ${B} defense — NFL Depth Charts`;

  let viewA, viewB;
  try {
    [{ data: viewA }, { data: viewB }] = await Promise.all([getTeam(A), getTeam(B)]);
  } catch (e) {
    root.innerHTML = errorHtml(e);
    return;
  }

  // Mounted empty first so mountField-style measuring can pick the horizontal spread from the real box
  // before the field is built (same two-phase approach as team.js — see its mountField comment).
  // D59: the shared nav strip replaces this view’s old breadcrumb — team A’s switcher, the Matchup pill
  // lit, and the "A team page · B team page" links the old breadcrumb carried, folded into the strip.
  root.innerHTML = `
    <div class="matchup">
      ${navStripHtml({ teams, abbr: A, page: "matchup", opponentAbbr: B, primary: teamA.colourPrimary, secondary: teamA.colourSecondary })}
      ${headerHtml(teamA, teamB, viewA, viewB, teams)}
      <div class="team-body"><div class="field-outer matchup-field" data-field-variant="${FIELD_VARIANT}"></div></div>
    </div>`;
  wireNav(root); // D59: switcher routes to the newly picked team’s matchup
  wireOpponentPicker(root, A); // D100: header opponent dropdown routes to #/matchup/A/B
  mountMatchupField(root, viewA, viewB, teamA, teamB);
}

// The team-page mount with two teams' worth of specifics: which colours each column takes, and which
// team's page a click should open. Everything else - measure, spread, draw, rescale, rebuild, settle,
// dispose - is viewfit.js's mountScaledField, shared with team.js (🔵 delta review: this used to be a
// second copy of that logic, and the copy that lacked a teardown).
function mountMatchupField(root, viewA, viewB, teamA, teamB) {
  return mountScaledField({
    root,
    probe: computeLayout(facingView(viewA, viewB)),
    build: (spread) => fieldHtml(viewA, viewB, teamA, teamB, spread),
    observe: [root.querySelector(".nav-strip"), root.querySelector(".matchup-head")],
    onDraw: (el) => { fitNames(el); wireMatchupClicks(el, teamA, teamB); },
    onScale: (el) => fitNames(el),
  });
}

// A card click opens that player's panel on HIS OWN team's page, which differs by half of the field here.
function wireMatchupClicks(el, teamA, teamB) {
  el.addEventListener("click", (e) => {
    const hit = e.target.closest("[data-player-key]");
    if (!hit) return;
    e.preventDefault();
    // 🔵 review finding 4: a tray chip lives in `.tray`, NOT in a `.column`, so asking for the closest
    // column returned null for every unlisted player and the `? :` sent all of them to team B's page.
    // The tray carries its own data-unit (cards.js's renderTray), which is checked first.
    const tray = hit.closest(".tray");
    const unit = tray ? tray.dataset.unit : hit.closest(".column")?.dataset.slotId?.split("-")[0];
    const abbr = unit === "OFF" ? teamA.abbr : teamB.abbr;
    location.hash = `#/team/${encodeURIComponent(abbr)}/player/${encodeURIComponent(hit.dataset.playerKey)}`;
  });
}
