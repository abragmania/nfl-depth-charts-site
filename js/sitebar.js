// D209 part (1): ONE SITE, TWO SECTIONS. One shared header strip — the site brand plus "Depth Charts" /
// "Analytics" tabs, the current one lit — painted the same way on every page of both apps, so the two apps
// can never draw two different ideas of "how do I get to the other section" (this replaces the old pair of
// new-tab links: public/index.html's .topbar-analytics "Analytics ↗" and public/analytics/index.html's
// .an-topbar-depth "Depth chart ↗"). Both apps stay separate code; this module is the only thing they share.
// The depth-chart page loads this directly (a <script type="module"> in public/index.html); the analytics
// page loads it as a side effect from public/analytics/js/main.js, the same pattern public/js/main.js already
// uses for public/js/refresh.js.
export function siteBarHtml(active) {
  // active: "depth" | "analytics". Hrefs are relative to whichever page loads this module: the analytics
  // page (one directory down from the site root) reaches the depth-chart app with "../", the depth-chart
  // page reaches analytics with "./analytics/". This is a real page navigation (a different HTML document),
  // in the SAME tab — not a hash route, so no router wiring is needed here.
  const depthHref = active === "analytics" ? "../" : "./";
  const analyticsHref = active === "analytics" ? "./" : "./analytics/";
  const tab = (label, href, on) => `<a class="sitebar-tab${on ? " on" : ""}" href="${href}">${label}</a>`;
  return `<a class="sitebar-brand" href="${depthHref}">NFL DEPTH CHARTS</a>
  <nav class="sitebar-tabs" aria-label="Site section">
    ${tab("Depth Charts", depthHref, active === "depth")}
    ${tab("Analytics", analyticsHref, active === "analytics")}
  </nav>`;
}

// Side effect: paint into #sitebar wherever this module is loaded. Which section is "active" is read off the
// page itself (the mount point's data-section attribute set in each app's index.html) rather than passed in,
// so both apps can load this module the same inert way (a plain <script src> / side-effect import) with no
// call site to keep in sync.
const mount = typeof document !== "undefined" ? document.getElementById("sitebar") : null;
if (mount) mount.innerHTML = siteBarHtml(mount.dataset.section === "analytics" ? "analytics" : "depth");
