// Hash router. Routes: #/  |  #/team/KC  |  #/team/KC/player/{id}
const routes = [];

export function on(pattern, handler) {
  routes.push({ parts: pattern.split("/").filter(Boolean), handler });
}

export function parse(hash) {
  const segs = (hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean);
  for (const r of routes) {
    if (r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    r.parts.forEach((p, i) => {
      if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(segs[i]);
      else if (p !== segs[i]) ok = false;
    });
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

export function start(notFound) {
  const go = () => {
    const m = parse(location.hash);
    if (m) m.handler(m.params); else notFound();
  };
  window.addEventListener("hashchange", go);
  go(); // hashchange does not fire on first load; run once explicitly
}
