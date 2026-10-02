// D174 (Adam, 2026-09-24): the HOW TO READ page, route #/guide, as a LABELLED DIAGRAM (Adam, after two drafts:
// "have lines coming off of things explaining what they are, have the things be DISTINCTLY separate from each
// other"). One sample position group, drawn by cards.js's renderColumn exactly as the Team page draws a column,
// sits in the centre; five parts (Adam: the banner, the rail and the name explain themselves) each have a leader line running out to a label in the margin, left or right,
// labels in the same top-to-bottom order as their parts and no two lines crossing. A one-line status key sits below.
//
// Every explained part is the outermost thing on its row on the side its line leaves from (or leaves the card
// through its bottom edge, or along the seam under the banner), so no line runs across another part.
// planLeaders is the pure layout (measured boxes in, lines and label positions out); tests/guide.test.mjs drives it.
// GUIDE_CALLOUTS is also the claims table: each sentence names the Part 2 rulings it rests on, and the test checks
// every one is still live in PROJECT.md, so a retired ruling turns the suite red.
import { renderColumn, esc, fitNames } from "./cards.js";
import { layoutStyle } from "./field.js";
import { registerView } from "./viewfit.js";

// ---- the sample: a right tackle column on a made-up club -----------------------------------------------------
// The opening starter is on IR, so the first healthy man below him plays and takes line one with the green
// banner (he joined after Week 1, so he wears the ● mark); the starter drops to the bottom on the red rail.
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
  ],
};
export function sampleColumnHtml() {
  const style = layoutStyle({});
  return renderColumn({ slot: SAMPLE_SLOT, x: style.cardWidth / 2, top: 0, height: 0, width: style.cardWidth, style, unit: "OFF" }, "SMP", {});
}

// ---- the labelled parts ---------------------------------------------------------------------------------------------
// `sel` finds the part inside the sample column. `side` is the margin its label sits in. `exit` is how its line
// leaves the card: "side" straight out sideways (the part is the outermost thing on its row), "bottom" down out of
// the card's bottom edge (the part is on the bottom row), "seam" up into the gap under the banner and along it.
export const GUIDE_CALLOUTS = [
  { sel: ".prow-one .prow-num", side: "left", exit: "side", title: "Jersey number", rulings: [], text: "His jersey number." },
  { sel: ".prow-outrail .badge", side: "left", exit: "bottom", title: "Status", rulings: ["D25"], text: "Injury status; key below." },
  { sel: ".prow-one .signal-glyph", side: "right", exit: "seam", title: "Marks", rulings: ["D50", "D81"],
    text: "★ a star is out, ▲ up from the practice squad, ● joined after Week 1." },
  { sel: ".prow-one .snaps", side: "right", exit: "side", title: "Snap counts", rulings: ["D91", "D162"],
    text: "His snaps in the last 3 games, most recent first (0 = did not play)." },
  { sel: ".prow-outrail .prow-ovr", side: "right", exit: "side", title: "Madden rating", rulings: ["D1", "D22", "D43"],
    text: "His Madden rating; we use EA's latest weekly update. Greener is better." },
];

// One line: every status badge, one phrase each (D25's set, plus the PS badge and the NR rating).
export const STATUS_KEY = [
  ["Q", "questionable, may play"], ["D", "doubtful"], ["OUT", "out this week"], ["IR", "injured reserve"],
  ["PUP", "physically unable to perform list"], ["NFI", "non-football injury list"], ["SUSP", "suspended"],
  ["INACTIVE", "on the game-day inactive list"], ["PS", "up from the practice squad"], ["NR", "no Madden rating"],
];
export const STATUS_KEY_RULINGS = ["D25", "D26", "D60", "D81", "D105"];

export function guideHtml() {
  const labels = GUIDE_CALLOUTS.map((c, i) => `<div class="guide-label" data-part="${i}" data-side="${c.side}" data-rulings="${esc(c.rulings.join(" "))}"><b>${esc(c.title)}</b> ${esc(c.text)}</div>`).join("");
  const key = STATUS_KEY.map(([code, words]) => `<b>${esc(code)}</b> ${esc(words)}`).join(" · ");
  return `<div class="guide">
    <a class="guide-back" href="#/">← Back</a>
    <h1>How to read a depth chart</h1>
    <figure class="guide-fig">
      <div class="guide-stage field-scale">${sampleColumnHtml()}</div>
      <svg class="guide-leaders" aria-hidden="true"></svg>
      ${labels}
    </figure>
    <p class="guide-key" data-rulings="${STATUS_KEY_RULINGS.join(" ")}"><span class="guide-key-head">Status key:</span> ${key}. OUT, IR, PUP, NFI, SUSP and INACTIVE mean he will not play; Q and D are day-to-day.</p>
  </div>`;
}

// ---- the layout (pure) --------------------------------------------------------------------------------------------
// In: the card's box, the seam under the banner, and per part its box, side, exit and its label's height, all in
// the figure's own pixels. Out: per part a polyline (dot on the part first, label end last) and the label's box.
// Labels keep their parts' order down each side, at least MIN_GAP apart centre to centre and never touching; each
// line runs out to its own elbow column, and the elbow order on each side is the one whose lines cross nothing.
export const LEADER = { MIN_GAP: 70, CLEAR: 14, ELBOW_OUT: 24, ELBOW_STEP: 18, LABEL_OUT: 22, LABEL_W: 300, BOTTOM_DROP: 24 };
const cy = (r) => (r.t + r.b) / 2, cx = (r) => (r.l + r.r) / 2;

export function planLeaders({ card, seamY, parts }) {
  const L = LEADER;
  const out = parts.map((p) => {
    const left = p.side === "left";
    let dot, pre = [], y0;
    if (p.exit === "bottom") { dot = [cx(p.rect), p.rect.b + 2]; y0 = card.b + L.BOTTOM_DROP; pre = [[dot[0], y0]]; }
    else if (p.exit === "seam") { dot = [cx(p.rect), p.rect.t - 1]; y0 = seamY; pre = [[dot[0], y0]]; }
    else { dot = [left ? p.rect.l - 2 : p.rect.r + 2, cy(p.rect)]; y0 = dot[1]; }
    return { ...p, left, dot, pre, y0 };
  });
  for (const side of ["left", "right"]) {
    const group = out.filter((p) => p.side === side).sort((a, b) => a.y0 - b.y0);
    if (!group.length) continue;
    // labels: in part order, spread apart, then the whole stack centred on its parts
    const ly = [];
    group.forEach((p, k) => { ly[k] = k ? Math.max(p.y0, ly[k - 1] + Math.max(L.MIN_GAP, (group[k - 1].h + p.h) / 2 + L.CLEAR)) : p.y0; });
    const shift = group.reduce((s, p, k) => s + p.y0 - ly[k], 0) / group.length;
    group.forEach((p, k) => { p.ly = ly[k] + shift; });
    // elbows: try every order and keep the first whose lines cross nothing
    const edge = side === "left" ? card.l - L.ELBOW_OUT : card.r + L.ELBOW_OUT;
    const dir = side === "left" ? -1 : 1;
    const labelX = edge + dir * ((group.length - 1) * L.ELBOW_STEP + L.LABEL_OUT);
    let best = null;
    for (const order of permutations(group.map((_, k) => k))) {
      const lines = group.map((p, k) => pathOf(p, edge + dir * order[k] * L.ELBOW_STEP, labelX));
      const n = crossings(lines);
      if (!best || n < best.n) best = { n, lines };
      if (!n) break;
    }
    group.forEach((p, k) => {
      p.points = best.lines[k];
      p.label = { l: side === "left" ? labelX - L.LABEL_W : labelX, t: p.ly - p.h / 2, w: L.LABEL_W, h: p.h };
    });
  }
  return out.map((p) => ({ points: p.points, label: p.label, side: p.side }));
}
function pathOf(p, x, labelX) {
  return [p.dot, ...p.pre, [x, p.y0], [x, p.ly], [labelX, p.ly]];
}
function* permutations(a) {
  if (a.length <= 1) { yield a; return; }
  for (let i = 0; i < a.length; i++) for (const rest of permutations([...a.slice(0, i), ...a.slice(i + 1)])) yield [a[i], ...rest];
}
const segs = (pts) => pts.slice(1).map((q, i) => [pts[i], q]).filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]);
// Axis-aligned segments only (every leg is horizontal or vertical): a crossing is a vertical leg passing through a
// horizontal one, or two legs lying on top of each other.
function segsCross([a1, a2], [b1, b2]) {
  const ah = a1[1] === a2[1], bh = b1[1] === b2[1];
  const inside = (v, p, q) => v > Math.min(p, q) + 0.5 && v < Math.max(p, q) - 0.5;
  const overlap = (p1, p2, q1, q2) => Math.min(Math.max(p1, p2), Math.max(q1, q2)) - Math.max(Math.min(p1, p2), Math.min(q1, q2)) > 0.5;
  if (ah && !bh) return inside(b1[0], a1[0], a2[0]) && inside(a1[1], b1[1], b2[1]);
  if (!ah && bh) return inside(a1[0], b1[0], b2[0]) && inside(b1[1], a1[1], a2[1]);
  if (ah && bh) return Math.abs(a1[1] - b1[1]) < 1 && overlap(a1[0], a2[0], b1[0], b2[0]);
  return Math.abs(a1[0] - b1[0]) < 1 && overlap(a1[1], a2[1], b1[1], b2[1]);
}
export function crossings(lines) {
  let n = 0;
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++)
    for (const s of segs(lines[i])) for (const t of segs(lines[j])) if (segsCross(s, t)) n++;
  return n;
}

// ---- drawing ----------------------------------------------------------------------------------------------------------
const SVGNS = "http://www.w3.org/2000/svg";
function drawLeaders(fig) {
  const fr = fig.getBoundingClientRect();
  if (!fr.width) return;
  const rel = (el) => { const r = el.getBoundingClientRect(); return { l: r.left - fr.left, r: r.right - fr.left, t: r.top - fr.top, b: r.bottom - fr.top }; };
  const col = fig.querySelector(".guide-stage .column");
  const banner = col.querySelector(".prow-one .card-banner"), line = col.querySelector(".prow-one .prow-line");
  const labelEls = [...fig.querySelectorAll(".guide-label")];
  labelEls.forEach((el) => { el.style.width = `${LEADER.LABEL_W}px`; });
  const parts = GUIDE_CALLOUTS.map((c, i) => ({ side: c.side, exit: c.exit, rect: rel(col.querySelector(c.sel)), h: labelEls[i].offsetHeight }));
  const plan = planLeaders({ card: rel(col), seamY: (rel(banner).b + rel(line).t) / 2, parts });
  // Room for labels that reach above or below the card: the figure grows its own padding, then draws again.
  const top = Math.min(...plan.map((p) => p.label.t)), bottom = Math.max(...plan.map((p) => p.label.t + p.label.h));
  const padT = parseFloat(fig.style.paddingTop) || 0, padB = parseFloat(fig.style.paddingBottom) || 0;
  if (top < 12 || bottom > fr.height - 12) {
    fig.style.paddingTop = `${padT + Math.max(0, 12 - top)}px`;
    fig.style.paddingBottom = `${padB + Math.max(0, bottom - fr.height + 12)}px`;
    return requestAnimationFrame(() => drawLeaders(fig));
  }
  plan.forEach((p, i) => Object.assign(labelEls[i].style, { left: `${p.label.l}px`, top: `${p.label.t}px` }));
  const svg = fig.querySelector(".guide-leaders");
  svg.setAttribute("width", fr.width); svg.setAttribute("height", fr.height);
  const el = (tag, attrs) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  svg.replaceChildren(...plan.flatMap((p) => [
    el("polyline", { points: p.points.map((q) => q.join(",")).join(" "), class: "guide-leader" }),
    el("circle", { cx: p.points[0][0], cy: p.points[0][1], r: 3, class: "guide-dot" }),
  ]));
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
  const draw = () => drawLeaders(fig);
  fitNames(root);
  draw();
  document.fonts?.ready.then(() => { fitNames(root); draw(); }); // names are fitted again once the real font is in, as on the field
  const onClick = (e) => {
    if (e.target.closest(".guide-back")) { e.preventDefault(); if (from && history.length > 1) history.back(); else location.hash = "#/"; return; }
    if (e.target.closest(".guide-stage a")) e.preventDefault(); // the sample rows link to a made-up club
  };
  root.addEventListener("click", onClick);
  let lastW = 0;
  const ro = new ResizeObserver(() => { const w = fig.getBoundingClientRect().width; if (w !== lastW) { lastW = w; draw(); } });
  ro.observe(fig);
  registerView(() => { ro.disconnect(); root.removeEventListener("click", onClick); });
}
