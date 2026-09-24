// Hash router for the analytics app. A route is a path plus an optional query that carries the filter state
// (filters.js): #/usage?pos=WR,-RB&window=last3. Handlers receive (params, query).
const routes = [];

export function on(pattern, handler) {
  routes.push({ parts: pattern.split("/").filter(Boolean), handler });
}

export function split(hash) {
  const raw = String(hash || "#/").replace(/^#\/?/, "");
  const i = raw.indexOf("?");
  return { path: i < 0 ? raw : raw.slice(0, i), query: i < 0 ? "" : raw.slice(i + 1) };
}

export function parse(hash) {
  const { path, query } = split(hash);
  const segs = path.split("/").filter(Boolean);
  for (const r of routes) {
    if (r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    r.parts.forEach((p, i) => {
      if (p.startsWith(":")) { try { params[p.slice(1)] = decodeURIComponent(segs[i]); } catch { params[p.slice(1)] = segs[i]; } }
      else if (p !== segs[i]) ok = false;
    });
    if (ok) return { handler: r.handler, params, query, path };
  }
  return null;
}

export function start(fallback) {
  const go = () => {
    const m = parse(location.hash);
    if (m) m.handler(m.params, m.query, m.path); else fallback();
  };
  window.addEventListener("hashchange", go);
  go();
}
