// Team grid (#/grid, TEAMS group): D195's 32-row, ranked grid. Stub for increment 2 (the app bar and routes) - the
// real page (32 rows, an Offense band and a Defense band, ranks and figures) lands in increment 8 once the Plan
// Agent's re-cut is scoped and built; this file exists now only so the tab has somewhere to go.
export async function renderGrid(ctx) {
  const { root, asof } = ctx;
  document.title = "Grid · NFL Analytics";
  if (asof) asof.hidden = true;
  root.innerHTML = `<div class="an-msg">Team grid: coming in this build.</div>`;
}
