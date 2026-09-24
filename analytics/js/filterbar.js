// The filter bar every analytics page carries. It only reads a state and hands back a new one (onChange);
// the page turns that into the hash, so every filter combination is a link (filters.js).
import { POSITIONS, cyclePos, weekLabel, defaultState, prevAvailable, splitKey, REG_SEASON_WEEKS } from "./filters.js";
import { loadSeasons } from "./data.js";

// D184: the seasons list for the picker, fetched once and cached. `ctx.seasons` can override it (tests, or a
// caller that already has the list); otherwise the bar paints with what it has (falls back to the picked
// season alone) and repaints itself once the fetch resolves.
let seasonsCache = null;
let seasonsPending = false;
function seasonsFor(el, st, ctx, onChange) {
  if (ctx.seasons) return ctx.seasons;
  if (seasonsCache) return seasonsCache;
  if (!seasonsPending) {
    seasonsPending = true;
    loadSeasons().then((list) => {
      seasonsPending = false;
      seasonsCache = list && list.length ? list : [st.season];
      if (el.isConnected) renderFilterBar(el, st, ctx, onChange);
    });
  }
  return [st.season];
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (st) => ({ ...st, pos: { ...st.pos }, downs: [...st.downs], qtrs: [...st.qtrs] });
const seg = (name, items, cur) => `<div class="an-seg" data-seg="${name}">${items.map(([v, label, title]) =>
  `<button type="button" data-v="${esc(v)}" class="${String(v) === String(cur) ? "on" : ""}"${title ? ` title="${esc(title)}"` : ""}>${label}</button>`).join("")}</div>`;
const group = (label, html, cls = "") => `<div class="an-fgroup ${cls}"><span class="an-flabel">${label}</span>${html}</div>`;

// `ctx`: { keys (every week key loaded for the season set), teams (abbrs) }.
export function renderFilterBar(el, st, ctx, onChange) {
  const allKeys = ctx.keys || [];
  // Playoffs chip (Adam, 2026-09-24): off by default, weeks 19+ dropped from the slider's own domain too, not just
  // the aggregation (filters.gamesInWindow does that half); shown only when the loaded weeks actually reach one.
  const hasPlayoffs = allKeys.some((k) => splitKey(k).week > REG_SEASON_WEEKS);
  const keys = st.po ? allKeys : allKeys.filter((k) => splitKey(k).week <= REG_SEASON_WEEKS);
  const seasons = [...seasonsFor(el, st, ctx, onChange)].sort((a, b) => b - a); // newest first
  const showPrev = prevAvailable(st.season, seasons);
  // Week range: a two-handle slider (two range inputs over one track) with the chosen span printed beside it.
  const idx = (k, dflt) => { const i = keys.indexOf(k); return i < 0 ? dflt : i; };
  const lo = idx(st.from, 0), hi = idx(st.to, Math.max(0, keys.length - 1)), last = Math.max(0, keys.length - 1);
  const pctAt = (i) => (last ? (i / last) * 100 : 0);
  const rangeHtml = () => `<div class="an-range" style="--lo:${pctAt(lo)}%;--hi:${pctAt(hi)}%">
      <div class="an-range-track"></div>
      <input type="range" min="0" max="${last}" step="1" value="${lo}" data-r="from" aria-label="From week"${last ? "" : " disabled"}>
      <input type="range" min="0" max="${last}" step="1" value="${hi}" data-r="to" aria-label="To week"${last ? "" : " disabled"}>
    </div><span class="an-range-lab">${esc(weekLabel(keys[lo] || "", st.season))} – ${esc(weekLabel(keys[hi] || "", st.season))}</span>`;
  const teamOpts = (sel, blank) => `<option value="">${blank}</option>` + (ctx.teams || []).map((t) => `<option${t === sel ? " selected" : ""}>${esc(t)}</option>`).join("");
  const posChip = (p) => {
    const v = st.pos[p] || "";
    const title = v === "in" ? `${p} included; click to exclude` : v === "out" ? `${p} excluded; click to clear` : `${p}: click to include`;
    return `<button type="button" class="an-pos ${v}" data-band="${p === "RB" || p === "FB" ? "BACKFIELD" : p}" data-pos="${p}" title="${title}">${v === "out" ? "−" : ""}${p}</button>`;
  };
  // Reset shows only when a filter (not the sort, the minimum or the open row) differs from the default.
  const filtersOnly = (s) => JSON.stringify({ ...s, open: "", sort: "", dir: "", minTgt: 0 });
  const isDefault = filtersOnly(st) === filtersOnly(defaultState(seasons));

  el.innerHTML = `<div class="an-fbar">
    ${group("Season", seg("season", seasons.map((s) => [s, String(s)]), st.season)
      + (showPrev ? `<label class="an-switch" title="Add ${st.season - 1}'s weeks to every figure"><input type="checkbox" data-k="with2025"${st.with2025 ? " checked" : ""}><span>Include ${st.season - 1}</span></label>` : ""))}
    ${group("Window", seg("window", [["season", "Season"], ["last3", "Last 3", "Each club's last three games"], ["range", "Weeks"]], st.window)
      + (hasPlayoffs ? `<label class="an-switch" title="Add weeks 19+ (the postseason) to this window"><input type="checkbox" data-k="po"${st.po ? " checked" : ""}><span>Playoffs</span></label>` : "")
      + (st.window === "range" ? rangeHtml() : ""))}
    ${group("Position", `<div class="an-poses">${POSITIONS.map(posChip).join("")}</div>`)}
    ${group("Team", `<select data-k="team" aria-label="Team">${teamOpts(st.team, "All")}</select>`)}
    ${group("Opp", `<select data-k="opp" aria-label="Opponent">${teamOpts(st.opp, "Any")}</select>`)}
    ${isDefault ? "" : `<button type="button" class="an-reset" data-reset title="Back to the default view">Reset</button>`}
  </div>`;

  const fire = (mut) => { const n = clone(st); mut(n); n.open = ""; onChange(n); };
  el.querySelectorAll("[data-seg] button").forEach((b) => b.addEventListener("click", () => {
    const name = b.parentElement.dataset.seg;
    fire((n) => {
      if (name === "season") {
        // D184: switching season invalidates any picked week range (it belongs to the old season), and the
        // Include-previous switch is dropped if the new season's season-1 is not on the list.
        n.season = +b.dataset.v;
        n.from = null; n.to = null;
        if (n.with2025 && !prevAvailable(n.season, seasons)) n.with2025 = false;
      } else {
        n[name] = b.dataset.v;
        if (name === "window" && n.window === "range") { n.from = n.from || keys[0] || null; n.to = n.to || keys[keys.length - 1] || null; }
      }
    });
  }));
  el.querySelectorAll("[data-pos]").forEach((b) => b.addEventListener("click", () => fire((n) => { n.pos = cyclePos(n.pos, b.dataset.pos); })));
  el.querySelectorAll("select[data-k]").forEach((s) => s.addEventListener("change", () => fire((n) => {
    n[s.dataset.k] = s.value;
    if (n.from && n.to && n.from > n.to) [n.from, n.to] = [n.to, n.from];
  })));
  // Slider: the label and the lit track follow the handles live; the view re-renders when a handle is let go.
  const rng = el.querySelector(".an-range");
  if (rng) {
    const [a, b] = rng.querySelectorAll("input");
    const lab = el.querySelector(".an-range-lab");
    const cur = () => [Math.min(+a.value, +b.value), Math.max(+a.value, +b.value)];
    const paint = () => { const [i, j] = cur(); rng.style.setProperty("--lo", pctAt(i) + "%"); rng.style.setProperty("--hi", pctAt(j) + "%");
      lab.textContent = `${weekLabel(keys[i], st.season)} – ${weekLabel(keys[j], st.season)}`; };
    [a, b].forEach((inp) => {
      inp.addEventListener("input", paint);
      inp.addEventListener("change", () => { const [i, j] = cur(); fire((n) => { n.from = keys[i]; n.to = keys[j]; }); });
    });
  }
  el.querySelector('input[data-k="with2025"]')?.addEventListener("change", (e) => fire((n) => { n.with2025 = e.target.checked; }));
  el.querySelector('input[data-k="po"]')?.addEventListener("change", (e) => fire((n) => { n.po = e.target.checked; }));
  el.querySelector("[data-reset]")?.addEventListener("click", () => onChange({ ...defaultState(seasons), minTgt: st.minTgt, sort: st.sort, dir: st.dir }));
}
