// View lifecycle and fit-to-window scaling, shared by every page that draws a scaled field.
//
// WHY THIS MODULE EXISTS (🔵 delta review, 2026-09-13). The whole-team page and the matchup page had
// grown two near-identical copies of the same ~80 lines: measure the box, choose a horizontal spread,
// render, re-scale on resize, rebuild if the spread turns out wrong, and never quite tear any of it
// down. Two copies meant two of every bug, and the review found the worst one: nothing disposed a view's
// observers when the ROUTE changed, so navigating from a team page to the matchup left the team page's
// ResizeObserver alive on <main>. It fired on the next layout, its refit() measured the now-detached
// field, concluded the spread was wrong, and wrote the OLD team's field straight over the matchup's —
// taking a wrong-team click handler with it. On a zoom route the same orphan threw inside a timer.
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
const MAX_SPREAD = 1.8;         // a short chart must not stretch into a smear of white space
const RESPREAD_TOLERANCE = 0.04; // rebuild only when the ideal spread is >4% off what we drew
const MAX_REBUILDS = 2;         // bounded so a rebuild can never oscillate
const K_EPSILON = 0.002;        // ignore scale changes too small to see
// 👁 QA item 4: was 1400, which left ~300px of a 1700px window black on the right whenever the side view's
// scale was HEIGHT-bound (defence's four levels) rather than width-bound — the design canvas itself was
// simply narrower than the window, so no amount of scale-up could ever reach the right edge. Raising the
// canvas lets the same height-bound scale spread across more width instead of stopping short of it.
const FIT_DESIGN_WIDTH = 1650;  // the side views' fixed design canvas
const MAX_FILL_GROW = 1.9;      // fill mode: a two-card group must not balloon into a wall of headshots
const RESIZE_DEBOUNCE = 180;

// 👁 QA B4 — why the settle is a TIMER and not an observer.
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
// continuation, which cannot be cancelled any other way (🔵 review finding 2: a promise callback armed by
// a view that has since been torn down would otherwise still fire against its detached DOM).
function settle(fn, isDead) {
  const timers = SETTLE_DELAYS.map((ms) => setTimeout(() => { if (!isDead()) fn(); }, ms));
  document.fonts?.ready.then(() => { if (!isDead()) fn(); }).catch(() => {});
  return () => timers.forEach(clearTimeout);
}

// How much room a field actually has, measured rather than guessed, so a wrapped header or a second chip
// line is accounted for automatically instead of silently pushing the field off the bottom.
function availableBox(el, main, panel, backRow) {
  const cs = getComputedStyle(main);
  const width = Math.max(main.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)
    - (panel && !panel.hidden ? panel.offsetWidth + 12 : 0), 320);
  const height = Math.max(window.innerHeight - el.getBoundingClientRect().top
    - ((backRow?.offsetHeight ?? 26) + BOTTOM_RESERVE), 240);
  return { width, height };
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
// Returns a dispose function; also registers it, so the caller usually needs nothing further.
export function mountScaledField({ root, probe, build, onDraw, onScale, panel = null, observe = [] }) {
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
  let spread = 1;

  // The single guard every entry point starts with. `document.contains` is what makes an orphaned
  // callback harmless rather than destructive: a disposer that was somehow missed can no longer find its
  // element in the document, so it returns instead of rewriting whatever view is on screen now.
  const alive = () => !dead && el !== null && document.contains(el);

  const boxOf = (node) => availableBox(node, main, panel, backRow);

  // The spread that makes the canvas exactly fill the width once it is scaled to fit the height.
  const idealSpread = (node) => {
    const { width, height } = boxOf(node);
    const kH = height / probe.layoutHeight;
    const kW = width / probe.layoutWidth;
    return kW > kH ? Math.min(kW / kH, MAX_SPREAD) : 1;
  };

  const draw = () => {
    if (dead) return;
    const target = el ?? mountPoint;
    if (!document.contains(target)) return;
    const built = build(spread);
    layout = built.layout;
    target.outerHTML = built.html;
    el = root.querySelector(".field-outer");
    if (!el) return;
    scaleEl = el.querySelector(".field-scale");
    lastK = null;
    // A rebuild must not replay the field's entrance animation (styles.css's `field-in` fade/scale):
    // replacing the element restarts it, which flashed the whole chart dark a beat after it appeared.
    if (rebuilds) el.style.animation = "none";
    onDraw?.(el, layout);
  };

  const apply = () => {
    if (!alive()) return;
    const { width, height } = boxOf(el);
    const k = Math.min(width / layout.layoutWidth, height / layout.layoutHeight);
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

  const refit = () => {
    if (!alive()) return;
    if (rebuilds < MAX_REBUILDS) {
      const ideal = idealSpread(el);
      if (Math.abs(ideal - spread) / spread > RESPREAD_TOLERANCE) { rebuilds++; spread = ideal; draw(); }
    }
    apply();
  };

  // 🔵 review finding 3: the rebuild budget is spent by the cold-load settle, so without this a later
  // panel toggle or window resize could only ever re-scale an already-wrong canvas. A genuine user
  // action - resizing the window, opening or closing the panel - is a new layout question, so it gets a
  // fresh budget. Debounced, because a drag-resize fires continuously and rebuilding on every frame of
  // one would be gratuitous.
  let resizeTimer = null;
  const refitFresh = () => {
    if (dead) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (dead) return; rebuilds = 0; refit(); }, RESIZE_DEBOUNCE);
    apply(); // respond immediately at the current spread; the rebuild follows once the drag settles
  };

  spread = idealSpread(mountPoint);
  draw();
  apply();

  const stopSettle = settle(refit, () => dead);
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
//   fill     BOTH axes filled (👁 QA A1, the group view; 👁 QA 2026-09-15 item 1, the side views): the
//            content is laid out at a design width of `container / k` and scaled by that same k, so the
//            scaled width lands exactly on the container and the scaled height exactly on the available
//            height. Because the design width is derived from a height that was measured at a DIFFERENT
//            width, one pass is not enough — solveFit below iterates the pair to a fixed point.
//
// 👁 QA (2026-09-15, item 1) — why the side views moved from `default` to `fill`. The fixed canvas could
// only ever scale to `container / FIT_DESIGN_WIDTH`, so once D62's leaner cards made the content short,
// nothing could grow into the space they freed: PHI's offense and defense both ended ~190px above the
// bottom of the window with idle margins down each side. zoom.js's old note said fill mode made cards
// SMALLER for a unit with few levels; that was this function's fault, not the mode's — its single
// correction pass kept the first pass's design width even when it took a smaller scale, so the result
// both under-filled the height and letterboxed the width. Iterating fixes it for every level count.
export function fitToViewport(root, { fill = false, maxGrow = MAX_FILL_GROW } = {}) {
  const outer = root.querySelector(".fit-outer");
  const inner = outer?.querySelector(".fit-inner");
  if (!outer || !inner) return () => {};
  const backRow = root.querySelector(".back-row");
  inner.style.transformOrigin = "top left";
  let dead = false;

  const alive = () => !dead && document.contains(inner);
  // 👁 QA (2026-09-15, item 1): the `?? 26` was an allowance for a "back to team" link under the field.
  // D59 replaced every one of those with the nav strip ABOVE the page, so no view renders a .back-row any
  // more and that 26px was pure phantom reserve — a quarter of the gap QA measured at the bottom of the
  // side views. A view that does render one is still measured; nothing else is held back for it.
  // FLOW_BOTTOM_RESERVE replaces it with an honest margin: now that the fit actually consumes the height
  // it is given, whatever is left over is the visible gap under the last card, and a card pressed against
  // the window edge reads as cut off even when it is not.
  const availableHeight = () => Math.max(window.innerHeight - outer.getBoundingClientRect().top
    - ((backRow?.offsetHeight ?? 0) + FLOW_BOTTOM_RESERVE), 200);

  // This used to cache the last scale and skip the write when it had not moved (old review finding 9, which
  // was about reflow churn). That cache was never able to work here and actively broke the view: BOTH apply
  // functions below CLEAR the transform and the outer height before they measure - that is how they get an
  // unscaled natural height - so by the time commit runs, "nothing changed" is false on the element even
  // when the number is identical, and returning early left the page laid out at full size with no transform
  // at all. That is a scrolling page, which D58 forbids; BUF's defence (four levels, k≈0.88) rendered that
  // way on every ResizeObserver pass after the first. The write is unconditional now. It is also cheap: the
  // expensive part is the measuring reflow above, which happened either way, and writing the same values
  // back changes no layout, so nothing observing `outer` is woken by it. (The absolute-canvas fitter higher
  // up this file keeps its own early return - it measures the container without clearing anything first, so
  // there the fast path is real.)
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
    const k = Math.min(availW / FIT_DESIGN_WIDTH, naturalH ? availableHeight() / naturalH : 1);
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
    return { designW, k: Math.min(k, availH / h), h };
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
