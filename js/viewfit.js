// View lifecycle and fit-to-window scaling, shared by every page that draws a scaled field.
//
// WHY THIS MODULE EXISTS: without one shared teardown, a view's ResizeObserver can outlive its route.
// Navigating from a team page to the matchup would leave the team page's ResizeObserver alive on <main>;
// it fires on the next layout, its refit() measures the now-detached field, concludes the spread is wrong,
// and writes the OLD team's field straight over the matchup's — taking a wrong-team click handler with it.
// On a zoom route the same kind of orphan throws inside a timer.
//
// So there is now exactly one implementation, one set of named constants, and one registry:
//   registerView(dispose) / disposeCurrentView() - main.js's router guard disposes the outgoing view
//     before the incoming one renders, and every renderer that replaces root.innerHTML disposes too
//     (disposeCurrentView is idempotent, so the belt and the braces cost nothing).
//   mountScaledField(...)  - the measure/spread/draw/rescale/rebuild loop, with a `dead` flag that every
//     async continuation checks and a `document.contains` guard that makes an orphan a no-op even if a
//     callback somehow outlives its disposer.
//   fitToViewport(...)     - the flow-layout equivalent for the side and group views.

// ---- view registry ----------------------------------------------------------------------------

let disposeView = null;

// Registers the teardown for whatever view has just rendered. Each call replaces the previous one, so a
// renderer that re-mounts itself (a refresh, a team switch) cannot stack disposers.
export function registerView(dispose) {
  disposeView = typeof dispose === "function" ? dispose : null;
}

// Tears down the current view. Idempotent: the registry is cleared before the disposer runs, so calling
// it twice - which happens by design, once from the router guard and once from the renderer itself - is
// harmless, and a disposer that throws cannot leave a stale entry behind.
export function disposeCurrentView() {
  const d = disposeView;
  disposeView = null;
  try { d?.(); } catch { /* a teardown must never break a navigation */ }
}

// ---- shared geometry constants ----------------------------------------------------------------

const BOTTOM_RESERVE = 14;      // breathing room under the absolute-canvas field (team, matchup)
const FLOW_BOTTOM_RESERVE = 28; // the same for the flow-layout fit (side, group), which now fills the height
// D114 shake fix (Adam, 2026-09-16): "on the matchup screen it's permanently shaking uncontrollably." The
// height budget below is arithmetic on measured pixels, so a Math.ceil'd scaled height (apply() rounds the
// canvas UP to the next pixel) could land exactly one fractional pixel past the window even when every
// other input was correct - enough by itself to raise a scrollbar and start the feedback loop this margin
// exists to prevent. Only added when a caller actually reserves something below the field (reserveBelow >
// 0, i.e. matchup.js today) - the team and side pages have no strip below the field to round against, and
// must not move by even these two pixels, so they never pay for a guard they don't need.
const SAFETY_MARGIN = 2;
const MAX_SPREAD = 1.8;         // a short chart must not stretch into a smear of white space
const RESPREAD_TOLERANCE = 0.04; // rebuild only when the ideal spread is >4% off what we drew
const MAX_REBUILDS = 2;         // bounded so a rebuild can never oscillate
const K_EPSILON = 0.002;        // ignore scale changes too small to see
// 1650, not a narrower value: a narrower design canvas leaves black space on the right whenever the side
// view's scale is HEIGHT-bound (defence's four levels) rather than width-bound, since the canvas itself is
// then too narrow for the window and no amount of scale-up can reach the right edge.
const FIT_DESIGN_WIDTH = 1650;  // the side views' fixed design canvas
const MAX_FILL_GROW = 1.9;      // fill mode: a two-card group must not balloon into a wall of headshots
const RESIZE_DEBOUNCE = 180;

// Why the settle is a TIMER and not an observer.
//
// The available height is `window - fieldTop - backRow`, so it changes whenever anything ABOVE the field
// changes height. On a cold load that happens twice: the header's controls wrap to a second line and the
// legend wraps to three or four, both in the fallback font, and both collapse when the real font lands.
// A ResizeObserver on those elements is the obvious fix and it does not work: RO callbacks are driven by
// the frame loop, which a background or hidden tab throttles to a standstill - as does a headless
// capture, which is where this was caught. requestAnimationFrame has the same problem. Timers keep
// running in both, so the layout is simply re-measured a few times over the first second; the callers
// bail out when nothing has moved, so the extra calls cost nothing.
const SETTLE_DELAYS = [0, 80, 250, 700];

// Runs `fn` on the settle schedule. `isDead()` is checked before every call INCLUDING the fonts.ready
// continuation, which cannot be cancelled any other way: a promise callback armed by a view that has since
// been torn down would otherwise still fire against its detached DOM.
function settle(fn, isDead) {
  const timers = SETTLE_DELAYS.map((ms) => setTimeout(() => { if (!isDead()) fn(); }, ms));
  document.fonts?.ready.then(() => { if (!isDead()) fn(); }).catch(() => {});
  return () => timers.forEach(clearTimeout);
}

// The one rule every fit mode in this file has to obey: a canvas must never render wider than the
// viewport (a real symptom was JAX's right "LINE OF SCRIMMAGE" caption cut off at the edge). Jacksonville
// plays a 4-3 with all four linemen on the LINE row, so its compiled chart has no EDGE row and the canvas
// is one
// defensive row shorter than a normal team's - which can make the scale needed to reach the bottom of the
// window (the height fit) LARGER than the scale needed to reach the right edge (the width fit). The
// applied scale must never be that height fit alone: it is always the smaller of the two, with whatever
// height goes unused left as air below the field. Pulled out as its own pure function so the invariant is
// tested directly, once, rather than only indirectly through a fake DOM.
export function capToWidthFit(widthFit, heightFit) {
  return Math.min(widthFit, heightFit);
}

// The height-budget arithmetic, pulled out as its own pure function so it can be unit tested directly
// (D114 — the matchup page could otherwise shake uncontrollably). The plain budget is
// `innerHeight - fieldTop - (backRow + BOTTOM_RESERVE)`, which only ever knows about a `.back-row` UNDER
// the field. matchup.js's D113 bottom half-banner is a real sibling INSIDE `.field-outer`'s own wrapper
// (`.matchup-field-wrap`) that this budget never heard of, so the wrap rendered ~33px taller than the
// window on every load: a vertical scrollbar appeared, `main` narrowed, the ResizeObserver refit at the
// narrower width, which (being the same height budget) also shrank the field - narrow enough that the
// page fit again, the scrollbar vanished, `main` widened back, and refit grew the field right back into
// overflow. Forever. `reserveBelow` is the fix: whatever trails the field INSIDE its own wrapper - for
// matchup.js, the bottom banner's rendered height plus the wrapper's own border/margin below it - passed
// in already measured off the live DOM (see matchup.js's reserveBelow) rather than guessed here, so a
// future CSS change to the banner is picked up automatically instead of silently drifting out of date
// again. It is 0 for the team and side pages, which have no such wrapper, so a zero reserveBelow also
// skips SAFETY_MARGIN (see its own comment) and their numbers are exactly what they were before D114.
export function heightBudget(innerHeight, fieldTop, backRowHeight, reserveBelow = 0) {
  const extra = reserveBelow > 0 ? reserveBelow + SAFETY_MARGIN : 0;
  return Math.max(innerHeight - fieldTop - (backRowHeight + BOTTOM_RESERVE + extra), 240);
}

// ---- D134: the too-short-window cascade --------------------------------------------------------

// D134 (Adam, 2026-09-17): the field must never be scaled so small that a BACKUP row's name stops being
// readable. "Readable" is about 9 CSS px of type, and the two row families print that name at different
// sizes, so each gets its own floor rather than one number that is wrong for one of them:
//   team / matchup  styles.css `.column-compact .prow-name` is 12.5px -> 9 / 12.5   = 0.72
//   offense/defense styles.css `.prow-name` (a backup row draws the base size) 11px -> 9 / 11 = 0.818
const READABLE_NAME_PX = 9;
export const MIN_READABLE_SCALE = READABLE_NAME_PX / 12.5;
export const SIDE_MIN_READABLE_SCALE = READABLE_NAME_PX / 11;
// Once a step has been taken it is only given back when the window is comfortably big enough for the step
// below it, so a window dragged across the threshold cannot flip the page back and forth on every frame.
export const FIT_HYSTERESIS = 1.05;
// ...and a narrow band the other way up: a window sitting exactly on the floor would otherwise fold its
// header on one cold load and not the next, decided by which measurement won by a pixel. Much narrower than
// the hysteresis on purpose — a real laptop (1536x864) measures 1.4 percent under and does need its step.
export const FIT_STEP_MARGIN = 1.02;
const STEP_RANK = { none: 0, header: 1, depth: 2, scroll: 3 };

// The whole cascade decision, as arithmetic on measured numbers: which of D134's steps this window needs,
// what scale it lands on, and whether the page ends up scrolling. Pure, so it is unit-tested directly
// rather than only through a browser.
//   width/height  the measured box, with the page's chrome at its FULL (uncompacted) size
//   headerGain    the height step (1) frees by folding that chrome away
//   full/reduced  the natural (unspread) canvas at the full and reduced depth caps
//   steps         which steps this page offers at all (the side pages offer only the floor)
//   current       the step in force now, for the hysteresis above
// The scale is `min(width fit, height fit)` on the UNSPREAD canvas, which is exactly what mountScaledField
// ends up applying: the spread is chosen to make the canvas fill the width at the height fit, so a
// height-bound page lands on the height fit and a width-bound one on the width fit either way.
export function chooseFitStep({ width, height, headerGain = 0, full, reduced = null, floor = 0, steps = {}, current = "none" }) {
  const scaleAt = (h, p) => capToWidthFit(width / p.layoutWidth, h / p.layoutHeight);
  const useHeader = !!steps.header;
  const useDepth = !!(steps.depth && reduced);
  const compactHeight = height + (useHeader ? headerGain : 0);
  const candidates = [{ step: "none", scale: scaleAt(height, full) }];
  if (useHeader) candidates.push({ step: "header", scale: scaleAt(compactHeight, full) });
  if (useDepth) candidates.push({ step: "depth", scale: scaleAt(compactHeight, reduced) });
  for (const c of candidates) {
    const need = STEP_RANK[c.step] < (STEP_RANK[current] ?? 0) ? floor * FIT_HYSTERESIS : floor / FIT_STEP_MARGIN;
    if (!(floor > 0) || c.scale >= need) return { ...c, scrolls: false };
  }
  // The floor. The scale stops falling and the PAGE scrolls instead — but never past the width fit, which
  // is the one invariant every mode in this file obeys (capToWidthFit: no canvas wider than the window,
  // ever, so a floor can never raise a horizontal scrollbar).
  const probe = useDepth ? reduced : full;
  const h = useHeader ? compactHeight : height;
  const scale = capToWidthFit(width / probe.layoutWidth, Math.max(h / probe.layoutHeight, floor));
  return { step: "scroll", scale, scrolls: probe.layoutHeight * scale > h + 0.5 };
}

// How much room a field actually has, measured rather than guessed, so a wrapped header or a second chip
// line is accounted for automatically instead of silently pushing the field off the bottom.
// D134: the `?? 26` is an allowance for a "back to team" link under the field that D59 removed from every
// page, so on a window too short to draw the field readably the compact step stops reserving 26px for an
// element that is not there. A full-size window keeps the allowance, and therefore its exact scale.
function availableBox(el, main, panel, backRow, reserveBelow, compact = false) {
  const cs = getComputedStyle(main);
  const width = Math.max(main.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)
    - (panel && !panel.hidden ? panel.offsetWidth + 12 : 0), 320);
  const extra = typeof reserveBelow === "function" ? (reserveBelow() || 0) : (reserveBelow || 0);
  // ...all but a few pixels of it: apply() rounds the scaled canvas UP to the next pixel, and a budget spent
  // to the last one turns that rounding into a scrollbar, which narrows the page and starts the feedback
  // loop D114 exists to prevent (SAFETY_MARGIN's own reason, a size larger).
  const backRowH = backRow?.offsetHeight ?? (compact ? 8 : 26);
  const height = heightBudget(window.innerHeight, el.getBoundingClientRect().top, backRowH, extra);
  return { width, height };
}

// D134: an expanded column may run down over empty turf, but it must not cover another card. Measured on
// the live boxes rather than predicted from the layout, because the expansion is a CSS class toggle the
// layout engine never hears about.
function expansionOverlaps(el) {
  const columns = [...el.querySelectorAll(".column")];
  for (const extra of el.querySelectorAll(".depth-extra.is-open")) {
    const col = extra.closest(".column");
    const stack = col?.querySelector(".column-stack");
    if (!stack) continue;
    const r = stack.getBoundingClientRect();
    for (const other of columns) {
      if (other === col) continue;
      const o = other.getBoundingClientRect();
      if (o.left < r.right - 1 && o.right > r.left + 1 && o.top < r.bottom - 1 && o.bottom > r.top + 1) return true;
    }
  }
  return false;
}

// ---- the scaled-field mount --------------------------------------------------------------------

// Mounts a scaled field into an already-present (empty) `.field-outer` and keeps it fitted.
//
// TWO things are chosen from the measured box, not one: the horizontal SPREAD (how wide a canvas
// field.js should build, 👁 QA item 3) and the SCALE that canvas is then drawn at. Only the scale can be
// changed cheaply afterwards, so a bad first measurement used to be permanent: on a cold load the height
// reads ~85px short, the spread is computed too wide to compensate, and when the real font lands all the
// rescale can do is shrink the over-wide canvas - the dead band QA measured (B4). The mount is therefore
// allowed to REBUILD at a corrected spread, bounded by MAX_REBUILDS.
//
// opts:
//   root      the view's root element (the back row and any extra observed elements are found under it)
//   probe     the natural, unspread layout - used only for the spread arithmetic
//   build(spread) -> { layout, html }   pure; `html` must be a complete `.field-outer` element
//   onDraw(el, layout)                  called after every (re)draw: wire clicks, fit names
//   onScale(el, layout, k)              optional; called whenever the scale actually changes
//   panel     optional `.player-panel` to cap to the field's height
//   observe   extra elements whose height changes should trigger a refit (header, legend, breadcrumb)
//   fillHeight  D72: also hand the builder a MIN HEIGHT when the canvas is width-bound, so it can spend
//             the leftover height instead of leaving a black band under the last row. The two levers are
//             mutually exclusive by construction — a canvas is either too tall for its box (spread it
//             wider) or too wide for it (fill it taller) — so enabling this never fights the spread.
//   reserveBelow  D114: a number, or a zero-arg function returning one, for whatever trails the field
//             INSIDE its own wrapper and would otherwise go uncounted by the height budget (matchup.js's
//             bottom half-banner). A function is re-invoked on every measurement rather than read once, so
//             it stays correct even if the reserved element's own height can change. Defaults to 0, which
//             is exact for the team and side pages - they have no such wrapper.
// Returns a dispose function; also registers it, so the caller usually needs nothing further.
//   cascade   D134: the three-step answer to a window too short to draw the field readably —
//             { floor, reduced, setCompact(on), setDepth(on) }. `floor` is this page's own
//             MIN_READABLE_SCALE (0 or absent switches the whole cascade off), `reduced` the natural canvas
//             at the reduced depth cap, and the two setters are the page's own chrome/markup hooks; a page
//             that offers neither still gets the floor and the scrolling state (the side pages).
export function mountScaledField({ root, probe, build, onDraw, onScale, panel = null, observe = [], fillHeight = false, reserveBelow = 0, cascade = null }) {
  const mountPoint = root.querySelector(".field-outer");
  if (!mountPoint) return () => {};
  const main = mountPoint.closest("main") ?? document.body;
  const backRow = root.querySelector(".back-row");

  let dead = false;
  let el = null;
  let scaleEl = null;
  let layout = null;
  let lastK = null;
  let rebuilds = 0;
  let draws = 0;
  let spread = 1;
  let minHeight = 0;
  // D134 cascade state: which step is in force, what folding the chrome away was actually worth, whether
  // the page is in the floor-and-scroll state, and whether an expanded column has forced full depth back.
  const floor = cascade?.floor || 0;
  const steps = { header: !!cascade?.setCompact, depth: !!(cascade?.setDepth && cascade?.reduced) };
  let step = "none";
  // D134: the cascade is held back until the chrome has settled. A cold load measures the header before its
  // stylesheet and font are in, reads the budget short, and folds a window that fits — and folding it back
  // spends the rebuild budget, which moved a 2560x1300 render that must not move at all.
  let cascadeReady = false;
  let headerGain = 0;
  let scrolls = false;
  let depthOn = false;
  let expandedFullDepth = false;

  // The single guard every entry point starts with. `document.contains` is what makes an orphaned
  // callback harmless rather than destructive: a disposer that was somehow missed can no longer find its
  // element in the document, so it returns instead of rewriting whatever view is on screen now.
  const alive = () => !dead && el !== null && document.contains(el);

  const boxOf = (node) => availableBox(node, main, panel, backRow, reserveBelow, step !== "none");
  // D134: the reduced state draws a different canvas, so the spread arithmetic has to measure against the
  // canvas actually being drawn rather than the full-depth probe it started from.
  const activeProbe = () => (depthOn ? cascade.reduced : probe);

  // The spread that makes the canvas exactly fill the width once it is scaled to fit the height.
  const idealSpread = (node) => {
    const { width, height } = boxOf(node);
    const p = activeProbe();
    // D134: in the floor state the canvas is drawn at the floor, not at the height fit, so the spread has
    // to fill the width at THAT scale or the field would be left narrow with black turf down both sides.
    const kH = scrolls ? Math.max(height / p.layoutHeight, floor) : height / p.layoutHeight;
    const kW = width / p.layoutWidth;
    return kW > kH ? Math.min(kW / kH, MAX_SPREAD) : 1;
  };

  // D72, the other way round: when the canvas is WIDER than the box's aspect, the scale is pinned by the
  // width (k = kW) and the height the canvas would need in order to reach the bottom of the window at
  // that scale is simply box height / kW. Handed to the builder as a minimum, it becomes extra air
  // between the rows. Zero when the canvas is already tall enough — then idealSpread has the job instead.
  const idealMinHeight = (node) => {
    if (!fillHeight) return 0;
    const { width, height } = boxOf(node);
    const kW = width / activeProbe().layoutWidth;
    return kW > 0 ? height / kW : 0;
  };

  // Puts one step of the cascade in force. Only the page knows how to fold its own chrome away or to draw
  // a shallower column, so this only flips the flags and calls the page's hooks; the caller redraws when
  // the depth changed, since that is the one step whose markup is different.
  const applyStep = (next) => {
    if (next === step) return false;
    step = next;
    const wantDepth = steps.depth && (step === "depth" || step === "scroll") && !expandedFullDepth;
    cascade.setCompact?.(step !== "none");
    const redraw = wantDepth !== depthOn;
    depthOn = wantDepth;
    cascade.setDepth?.(wantDepth);
    return redraw;
  };

  // Decides the step from the measured box. `fresh` (a real resize, or the first mount) first puts the
  // chrome back to full size so the decision is made on honest numbers and the gain is re-learned; an
  // ordinary refit reuses what folding it away was worth last time instead of flickering it open again.
  // Returns { changed, redraw }: `changed` when the page is in a different state than it was (so the field
  // has to be re-measured), `redraw` when that state also draws different markup (the depth step). A window
  // that needs nothing returns neither, and the mount then behaves exactly as it did before this ruling.
  // `memoryless` drops the hysteresis for the cold-load passes: it exists to stop a window being DRAGGED
  // across the threshold from flipping back and forth, and a page that is still settling has no history
  // worth protecting — without this, a decision made before the stylesheet had landed stayed locked in.
  const chooseStep = (fresh, memoryless = false) => {
    if (!floor || !el && !mountPoint) return { changed: false, redraw: false };
    const was = step;
    const wasScrolling = scrolls;
    let redraw = false;
    if (fresh && step !== "none") { redraw = applyStep("none") || redraw; headerGain = 0; }
    const node = el ?? mountPoint;
    const box = boxOf(node);
    const expandedHeight = step === "none" ? box.height : box.height - headerGain;
    const ask = (current) => chooseFitStep({
      width: box.width, height: expandedHeight, headerGain, full: probe, reduced: cascade?.reduced || null,
      floor, steps, current: memoryless ? "none" : current,
    });
    let decision = ask(step);
    // What folding the header away is worth is MEASURED, not remembered, on every fresh decision: it is
    // folded once, measured for real, and the decision then made on that number. Remembering it across
    // loads is what let one cold load decide on a stale zero and take a step further down the cascade than
    // the same window took on the load before it.
    if (decision.step !== "none" && steps.header && fresh && step === "none") {
      redraw = applyStep("header") || redraw;
      headerGain = Math.max(boxOf(node).height - box.height, 0);
      decision = ask("header");
    }
    redraw = applyStep(decision.step) || redraw;
    scrolls = decision.scrolls;
    return { changed: redraw || step !== was || scrolls !== wasScrolling, redraw };
  };

  const draw = () => {
    if (dead) return;
    const target = el ?? mountPoint;
    if (!document.contains(target)) return;
    const built = build(spread, minHeight);
    layout = built.layout;
    target.outerHTML = built.html;
    el = root.querySelector(".field-outer");
    if (!el) return;
    scaleEl = el.querySelector(".field-scale");
    lastK = null;
    // A rebuild must not replay the field's entrance animation (styles.css's `field-in` fade/scale):
    // replacing the element restarts it, which flashed the whole chart dark a beat after it appeared.
    // Counted per DRAW, not per spread rebuild (D134): a cascade step redraws too, and an entrance
    // animation started late is held at its opening frame in a headless capture — an empty field.
    if (draws++) el.style.animation = "none";
    // D134: the "+N more" chips expand their own column in place; an expansion that would cover another
    // card instead drops the depth cap and takes the floor-and-scroll state, where every row is drawn.
    if (steps.depth) el.addEventListener("click", onExpandClick);
    onDraw?.(el, layout);
  };

  const apply = () => {
    if (!alive()) return;
    const { width, height } = boxOf(el);
    const heightFit = height / layout.layoutHeight;
    // D134: in the floor state the scale stops falling and the page scrolls instead. Never above the width
    // fit — capToWidthFit is what guarantees no canvas is ever wider than the window (and so no horizontal
    // scrollbar); outside that state this is exactly the arithmetic it always was.
    const k = capToWidthFit(width / layout.layoutWidth, scrolls ? Math.max(heightFit, floor) : heightFit);
    // apply() resizes .field-outer, which wakes the ResizeObserver that called it - bailing out on a
    // scale that hasn't meaningfully moved breaks that feedback loop instead of ping-ponging forever.
    if (lastK !== null && Math.abs(k - lastK) < K_EPSILON) return;
    lastK = k;
    scaleEl.style.transform = `scale(${k})`;
    scaleEl.style.transformOrigin = "top left";
    // The bordered box hugs the scaled canvas and centres in whatever width is left over.
    el.style.flex = "0 0 auto";
    el.style.width = `${Math.ceil(layout.layoutWidth * k)}px`;
    el.style.height = `${Math.ceil(layout.layoutHeight * k)}px`;
    el.style.marginInline = "auto";
    // The detail panel is a long document (bio, ten seasons, a game log) and is the one thing left that
    // could push the page into a scrollbar. Capping it to the field's own height, with its own internal
    // scroll (panel.css), keeps the PAGE fixed while the panel stays fully readable.
    if (panel) panel.style.maxHeight = `${Math.ceil(layout.layoutHeight * k)}px`;
    onScale?.(el, layout, k);
  };

  // Rebuilds the canvas at the spread the CURRENT box asks for, with a fresh rebuild budget. Used whenever
  // the page changes state under the cascade — the old spread was chosen for a different amount of room.
  const redrawAtIdealSpread = () => {
    if (!alive()) return;
    rebuilds = 0;
    spread = idealSpread(el);
    minHeight = idealMinHeight(el);
    draw();
  };

  // The click that expands a column. The overlap is measured after the browser has laid the extra rows
  // out, hence the timer; a collision drops the depth cap for good until the next resize.
  const onExpandClick = (e) => {
    if (!e.target.closest(".depth-more")) return;
    setTimeout(() => {
      if (!alive() || expandedFullDepth || !expansionOverlaps(el)) return;
      expandedFullDepth = true;
      step = "none"; // force applyStep to run the transition rather than short-circuit on an equal step
      applyStep("scroll");
      scrolls = true;
      spread = idealSpread(el);
      draw();
      apply();
    }, 0);
  };

  const refit = (fresh = false, memoryless = false) => {
    if (!alive()) return;
    // D114/D134: a step change is redrawn at the EXACT ideal spread rather than left inside the rebuild
    // tolerance, so the page lands on one number whatever order the settle passes and the step happened in
    // — two renders of the same window have to come out identical.
    if (cascadeReady && chooseStep(fresh, memoryless).changed) redrawAtIdealSpread();
    if (rebuilds < MAX_REBUILDS) {
      const ideal = idealSpread(el);
      const idealMin = idealMinHeight(el);
      const spreadOff = Math.abs(ideal - spread) / spread > RESPREAD_TOLERANCE;
      // The same tolerance on the height lever, measured against the height it is trying to reach so a
      // canvas that is already the right size is not rebuilt over a pixel.
      const minOff = fillHeight && Math.abs(idealMin - minHeight) > Math.max(idealMin, 1) * RESPREAD_TOLERANCE;
      if (spreadOff || minOff) { rebuilds++; spread = ideal; minHeight = idealMin; draw(); }
    }
    apply();
  };

  // The rebuild budget is spent by the cold-load settle, so without this a later panel toggle or window
  // resize could only ever re-scale an already-wrong canvas. A genuine user
  // action - resizing the window, opening or closing the panel - is a new layout question, so it gets a
  // fresh budget. Debounced, because a drag-resize fires continuously and rebuilding on every frame of
  // one would be gratuitous.
  let resizeTimer = null;
  const refitFresh = () => {
    if (dead) return;
    clearTimeout(resizeTimer);
    // D134: a real resize is a new question about the whole cascade too, so the step is re-decided from an
    // un-folded header (`refit(true)`) rather than from whatever the last window needed.
    resizeTimer = setTimeout(() => { if (dead) return; rebuilds = 0; expandedFullDepth = false; refit(true); }, RESIZE_DEBOUNCE);
    apply(); // respond immediately at the current spread; the rebuild follows once the drag settles
  };

  spread = idealSpread(mountPoint);
  minHeight = idealMinHeight(mountPoint);
  draw();
  apply();

  // D134: the settle passes re-decide the STEP from an un-folded header too (`refit(true)`), so a state a
  // mis-measured frame chose is never inherited — a page cannot stay compact on a window that fits.
  const stopSettle = settle(() => refit(true, true), () => dead);
  // ...and the cascade itself opens once the real font has landed (or a beat later, whichever comes first,
  // since fonts.ready never resolves in some capture environments), with one refit to act on it.
  // ...and it touches the page only when a step actually changes: on a window that needs no step this adds
  // no measurement, no rebuild and no redraw, which is what keeps a big window's render exactly as it is.
  const cascadeOpen = () => {
    if (dead || cascadeReady || !alive()) return;
    cascadeReady = true;
    if (chooseStep(true, true).changed) refit(true, true);
  };
  const cascadeTimer = floor ? setTimeout(cascadeOpen, SETTLE_DELAYS[2]) : null;
  if (floor) document.fonts?.ready.then(cascadeOpen).catch(() => {});
  // One last pass, after every settle pass has run, for a page that DID take a step: its spread was chosen
  // somewhere in the middle of folding the header away, and the rebuild tolerance would leave it there. A
  // page at step "none" is not touched at all, so a window that needs nothing renders exactly as it did.
  const finalTimer = floor ? setTimeout(() => {
    if (dead || !alive() || step === "none") return;
    redrawAtIdealSpread();
    apply();
  }, SETTLE_DELAYS[SETTLE_DELAYS.length - 1] + 60) : null;
  window.addEventListener("resize", refitFresh);
  let ro = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => refit());
    ro.observe(main);
    if (panel) ro.observe(panel);
    for (const node of observe) if (node) ro.observe(node);
  }
  // The player panel opens on a hash change WITHOUT re-rendering the field under it (main.js's
  // openPlayerPanel, deliberately). Nothing above catches that: the panel is `hidden` (display:none, so a
  // ResizeObserver has no box to report) until it opens, and .field-outer is a fixed-width box nothing
  // else resizes. A timer, not requestAnimationFrame - see the settle comment for why.
  let mo = null;
  if (panel && typeof MutationObserver !== "undefined") {
    mo = new MutationObserver(() => setTimeout(() => { if (!dead) { rebuilds = 0; refit(); } }, 0));
    mo.observe(panel, { attributes: true, attributeFilter: ["hidden", "style", "class"], childList: true });
  }

  const dispose = () => {
    dead = true;
    clearTimeout(resizeTimer);
    clearTimeout(cascadeTimer);
    clearTimeout(finalTimer);
    stopSettle();
    window.removeEventListener("resize", refitFresh);
    ro?.disconnect();
    mo?.disconnect();
  };
  registerView(dispose);
  return dispose;
}

// ---- flow-layout fit (side and group views) ----------------------------------------------------

// The side and group views are ordinary flow layouts rather than an absolutely-positioned canvas, so
// instead of a coordinate system they get a design width and one CSS transform. Two modes:
//   default  a fixed FIT_DESIGN_WIDTH canvas scaled to whichever axis runs out first
//   fill     BOTH axes filled (the group view and the side views): the content is laid out at a design
//            width of `container / k` and scaled by that same k, so the scaled width lands exactly on the
//            container and the scaled height exactly on the available height. Because the design width is
//            derived from a height that was measured at a DIFFERENT width, one pass is not enough —
//            solveFit below iterates the pair to a fixed point.
//
// Why the side views use `fill` rather than `default`: the fixed canvas can only ever scale to
// `container / FIT_DESIGN_WIDTH`, so once D62's leaner cards made the content short, nothing could grow
// into the space they freed — a unit with few levels would end well above the bottom of the window with
// idle margins down each side. A single, non-iterated correction pass would keep the first pass's design
// width even when it took a smaller scale, both under-filling the height and letterboxing the width;
// iterating fixes it for every level count.
export function fitToViewport(root, { fill = false, maxGrow = MAX_FILL_GROW } = {}) {
  const outer = root.querySelector(".fit-outer");
  const inner = outer?.querySelector(".fit-inner");
  if (!outer || !inner) return () => {};
  const backRow = root.querySelector(".back-row");
  inner.style.transformOrigin = "top left";
  let dead = false;

  const alive = () => !dead && document.contains(inner);
  // No `?? 26` fallback here: that used to be an allowance for a "back to team" link under the field, but
  // D59 replaced every one of those with the nav strip ABOVE the page, so no view renders a .back-row any
  // more. A view that does render one is still measured; nothing else is held back for it.
  // FLOW_BOTTOM_RESERVE replaces it with an honest margin: now that the fit actually consumes the height
  // it is given, whatever is left over is the visible gap under the last card, and a card pressed against
  // the window edge reads as cut off even when it is not.
  const availableHeight = () => Math.max(window.innerHeight - outer.getBoundingClientRect().top
    - ((backRow?.offsetHeight ?? 0) + FLOW_BOTTOM_RESERVE), 200);

  // The write below is unconditional — no cache-and-skip-if-unmoved shortcut. BOTH apply functions below
  // CLEAR the transform and the outer height before they measure (that is how they get an unscaled natural
  // height), so "nothing changed" would be false on the element even when the number is identical, and
  // skipping the write would leave the page laid out at full size with no transform at all — a scrolling
  // page, which D58 forbids. It is also cheap: the expensive part is the measuring reflow above, which
  // happens either way, and writing the same values back changes no layout, so nothing observing `outer`
  // is woken by it. (The absolute-canvas fitter higher up this file keeps its own early return — it
  // measures the container without clearing anything first, so there the fast path is real.)
  const commit = (designW, k, naturalH) => {
    inner.style.width = `${designW}px`;
    inner.style.transform = `scale(${k})`;
    inner.style.marginLeft = `${Math.max((outer.clientWidth - designW * k) / 2, 0)}px`;
    outer.style.height = `${Math.ceil(naturalH * k)}px`;
  };

  const applyDesign = () => {
    if (!alive()) return;
    inner.style.transform = "none";
    outer.style.height = "";
    inner.style.width = `${FIT_DESIGN_WIDTH}px`;
    const naturalH = inner.scrollHeight;
    const availW = outer.clientWidth || FIT_DESIGN_WIDTH;
    const k = capToWidthFit(availW / FIT_DESIGN_WIDTH, naturalH ? availableHeight() / naturalH : 1);
    commit(FIT_DESIGN_WIDTH, k, naturalH);
  };

  // Solves for the scale k at which a canvas of width `availW / k` is exactly `availH / k` tall — i.e. the
  // one scale that fills both axes at once. k and the design width depend on each other through the
  // content's own reflow (a narrower canvas is a taller canvas), so it is iterated to a fixed point rather
  // than computed. Three passes is plenty in practice; the loop stops as soon as k stops moving, and the
  // final `Math.min` is the guarantee that matters — whatever the loop converged on, the committed scale
  // can never make the content taller than the box it has to fit in (D58: no scrolling, ever).
  const MIN_FIT_SCALE = 0.4;
  const solveFit = (availW, availH) => {
    let k = 1;
    let designW = availW;
    let h = 1;
    for (let pass = 0; pass < 3; pass++) {
      designW = availW / k;
      inner.style.width = `${designW}px`;
      h = inner.scrollHeight || 1;
      const next = Math.min(Math.max(availH / h, MIN_FIT_SCALE), maxGrow);
      const settled = Math.abs(next - k) < 0.005;
      k = next;
      if (settled) break;
    }
    designW = availW / k;
    inner.style.width = `${designW}px`;
    h = inner.scrollHeight || h;
    // Same invariant as the two canvas modes above, spelled out the same way: the committed scale is the
    // smaller of the width fit and the height fit. Width fit is `availW / designW` rather than a bare 1 -
    // designW is defined as availW/k every pass, so on paper that ratio is always k already, but writing it
    // out keeps this mode honest against the same rule instead of a bespoke one that happens to agree.
    return { designW, k: capToWidthFit(availW / designW, availH / h), h };
  };

  const applyFill = () => {
    if (!alive()) return;
    inner.style.transform = "none";
    outer.style.height = "";
    const availW = outer.clientWidth || FIT_DESIGN_WIDTH;
    const { designW, k, h } = solveFit(availW, availableHeight());
    commit(designW, k, h);
  };

  const apply = fill ? applyFill : applyDesign;
  apply();
  const onResize = () => apply();
  window.addEventListener("resize", onResize);
  const stopSettle = settle(() => apply(), () => dead);
  let ro = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => apply());
    for (const el of [root.querySelector(".nav-strip"), root.querySelector(".teamhead")]) if (el) ro.observe(el);
  }
  const dispose = () => { dead = true; window.removeEventListener("resize", onResize); stopSettle(); ro?.disconnect(); };
  registerView(dispose);
  return dispose;
}
