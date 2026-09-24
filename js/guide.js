// D174 (Adam, 2026-09-24): the HOW TO READ page, route #/guide. Simplified the same day (Adam: "show a sample
// player group, show that one is the Madden rating, the numbers are the snap counts, jersey number, etc. NOT the
// whole page"; then: "fewer lines overlapping things ... stop complicating this"). ONE sample position group, drawn
// by cards.js's renderColumn exactly as the Team page draws a column, from made-up players. Each explained part
// wears a thin outline in its own colour, and the explanation beside it sits in a box of the same colour: the
// reader matches by colour, with no numbers and no arrows. A one-line status key sits underneath.
//
// GUIDE_CALLOUTS is also the claims table: each sentence names the Part 2 rulings it rests on, and
// tests/guide.test.mjs checks every one is still live in PROJECT.md, so a retired ruling turns the suite red.
import { renderColumn, esc, fitNames } from "./cards.js";
import { layoutStyle } from "./field.js";
import { registerView } from "./viewfit.js";

// ---- the sample: a right tackle column on a made-up club -----------------------------------------------------
// The opening starter is on IR, so the first healthy man below him plays and takes line one with the green
// banner (he joined after Week 1, so he also wears the ● mark); the starter drops to the bottom on the red rail.
const snaps = (...pcts) => pcts.map((pct, i) => ({ week: 4 - i, opponent: ["DAL", "NYG", "PHI"][i], pct, ...(pct === 0 ? { absent: true } : {}) }));
function man(key, name, number, ovr, extra = {}) {
  const [first, ...rest] = name.split(" ");
  return { playerKey: `sample-${key}`, name, first, last: rest.join(" "), number, position: "RT", role: "BACKUP", coStarter: false,
    openingStarter: false, status: null, signals: [], snapHistory: [], alsoListedAt: [], weekOneNote: null,
    rating: ovr == null ? null : { current: ovr, launch: ovr, maddenPos: "RT" }, ...extra };
}
export const SAMPLE_SLOT = {
  slotId: "sample-rt", label: "RT", band: "OL", labelSource: null,
  injury: { level: "critical", outStarter: { name: "Byron Castile", ovr: 86 }, fillIn: { name: "Theo Munro", ovr: 72 } },
  players: [
    man("castile", "Byron Castile", 72, 86, { role: "STARTER_OUT", openingStarter: true, status: { code: "IR", label: "Injured Reserve", detail: "Knee", returnDate: "2026-10-18T12:00:00Z" } }),
    man("munro", "Theo Munro", 79, 72, { role: "ACTIVE", signals: ["NEW_ARRIVAL"], snapHistory: snaps(100, 100, 0) }),
    man("bell", "Ike Bell", 63, 64, { status: { code: "Q", label: "Questionable", detail: "Ankle" }, snapHistory: snaps(4, 0, 9) }),
    man("pratt", "Jon Pratt", 68, 58, { snapHistory: snaps(0, 2, 0) }),
  ],
};
export function sampleColumnHtml() {
  const style = layoutStyle({});
  return renderColumn({ slot: SAMPLE_SLOT, x: style.cardWidth / 2, top: 0, height: 0, width: style.cardWidth, style, unit: "OFF" }, "SMP", {});
}

// ---- the explained parts, top to bottom of the card ----------------------------------------------------------------
// `row` counts the player rows top to bottom; `sel` is the part inside that row (or inside the column when there is
// no row). `color` is the outline on the card and the box beside it; no two parts share one.
export const GUIDE_CALLOUTS = [
  { row: 0, sel: ".card-banner", hug: -1, color: "#86efac", title: "Filling in", rulings: ["D56", "D104", "D166"],
    text: "The starter here is out, so this man is playing." },
  { row: 0, sel: ".prow-num", color: "#60a5fa", title: "Jersey number", rulings: [], text: "His jersey number." },
  { row: 0, sel: ".prow-name", color: "#e5e7eb", title: "Name", rulings: [], text: "His name." },
  { row: 0, sel: ".signal-glyph", color: "#c084fc", title: "Marks", rulings: ["D50", "D81"],
    text: "★ a star is out, ▲ up from the practice squad, ● joined after Week 1." },
  { row: 0, sel: ".prow-ovr", color: "#a3e635", title: "Madden rating", rulings: ["D1", "D22", "D43"],
    text: "His Madden rating; we use EA's latest weekly update. Greener is better." },
  { row: 1, sel: ".snaps", color: "#fb923c", title: "Snap counts", rulings: ["D91", "D162"],
    text: "His snaps in the last 3 games, most recent first (0 = did not play)." },
  { row: 1, sel: ".badge", color: "#facc15", title: "Status", rulings: ["D25"], text: "Injury status; key below." },
  { sel: ".prow-outrail", color: "#f87171", title: "Out starter", rulings: ["D104", "D44"],
    text: "The out starter, shown at the bottom with when he is due back." },
];

// One line: every status badge, one phrase each (D25's set, plus the PS badge and the NR rating).
export const STATUS_KEY = [
  ["Q", "questionable, may play"], ["D", "doubtful"], ["OUT", "out this week"], ["IR", "injured reserve"],
  ["PUP", "physically unable to perform list"], ["NFI", "non-football injury list"], ["SUSP", "suspended"],
  ["INACTIVE", "on the game-day inactive list"], ["PS", "up from the practice squad"], ["NR", "no Madden rating"],
];
export const STATUS_KEY_RULINGS = ["D25", "D26", "D60", "D81", "D105"];

export function guideHtml() {
  const boxes = GUIDE_CALLOUTS.map((c, i) => `<li class="guide-box" data-part="${i}" style="--c:${c.color}" data-rulings="${esc(c.rulings.join(" "))}"><b>${esc(c.title)}</b><span>${esc(c.text)}</span></li>`).join("");
  const outlines = GUIDE_CALLOUTS.map((c, i) => `<span class="guide-outline" data-part="${i}" style="--c:${c.color}" hidden></span>`).join("");
  const key = STATUS_KEY.map(([code, words]) => `<b>${esc(code)}</b> ${esc(words)}`).join(" · ");
  return `<div class="guide">
    <a class="guide-back" href="#/">← Back</a>
    <h1>How to read a depth chart</h1>
    <p class="guide-lede">A sample position group, drawn exactly as the field draws it. Each coloured outline matches the box of the same colour.</p>
    <div class="guide-plate">
      <figure class="guide-fig">
        <div class="guide-stage field-scale">${sampleColumnHtml()}</div>
        <div class="guide-outlines" aria-hidden="true">${outlines}</div>
      </figure>
      <ul class="guide-boxes">${boxes}</ul>
    </div>
    <p class="guide-key" data-rulings="${STATUS_KEY_RULINGS.join(" ")}"><span class="guide-key-head">Status key:</span> ${key}. OUT, IR, PUP, NFI, SUSP and INACTIVE mean he will not play; Q and D are day-to-day.</p>
  </div>`;
}

// ---- drawing the outlines -------------------------------------------------------------------------------------
// Each outline is drawn on its part's own box (a part may set its own `hug` to sit a little inside or outside it), so neighbours keep the gap the card already leaves between them and no two
// outlines ever touch or nest.
const HUG = 0;
function targetOf(stage, c) {
  let scope = stage.querySelector(".column");
  if (scope && c.row != null) scope = [...scope.querySelectorAll(".prow:not(.prow-more)")][c.row] || null;
  if (!scope) return null;
  return c.sel ? scope.querySelector(c.sel) : scope;
}
function placeOutlines(fig) {
  const stage = fig.querySelector(".guide-stage");
  const fr = fig.getBoundingClientRect();
  if (!fr.width) return;
  GUIDE_CALLOUTS.forEach((c, i) => {
    const o = fig.querySelector(`.guide-outline[data-part="${i}"]`);
    const r = targetOf(stage, c)?.getBoundingClientRect();
    const hug = c.hug ?? HUG;
    o.hidden = !r || !r.width;
    if (o.hidden) return;
    Object.assign(o.style, { left: `${r.left - fr.left - hug}px`, top: `${r.top - fr.top - hug}px`, width: `${r.width + 2 * hug}px`, height: `${r.height + 2 * hug}px` });
  });
}

// Back goes to the page the reader came from inside the app, else to the landing page.
let arrivedFrom = null;
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", (e) => { try { arrivedFrom = new URL(e.oldURL).hash || null; } catch { arrivedFrom = null; } });
}

export async function renderGuide(root, search) {
  if (search) search.hidden = true;
  document.title = "How to read · NFL Depth Charts";
  const from = arrivedFrom && !arrivedFrom.startsWith("#/guide") ? arrivedFrom : null;
  root.innerHTML = guideHtml();
  const fig = root.querySelector(".guide-fig");
  const place = () => placeOutlines(fig);
  fitNames(root);
  place();
  document.fonts?.ready.then(() => { fitNames(root); place(); }); // names are fitted again once the real font is in, as on the field
  const onClick = (e) => {
    if (e.target.closest(".guide-back")) { e.preventDefault(); if (from && history.length > 1) history.back(); else location.hash = "#/"; return; }
    if (e.target.closest(".guide-stage a")) e.preventDefault(); // the sample rows link to a made-up club
  };
  root.addEventListener("click", onClick);
  const ro = new ResizeObserver(place);
  ro.observe(fig);
  registerView(() => { ro.disconnect(); root.removeEventListener("click", onClick); });
}
