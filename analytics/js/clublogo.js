// The one copy of the club chip's markup (Adam, 2026-11-11: club logos in place of the coloured abbreviation chips).
// The crest is the dark-background variant (logoDark), loaded through cards.js's assetUrl so it resolves on the public
// static site too. The abbreviation stays in the page as visually hidden text (sort, search, copy) and as the image's
// alt and title; a crest that fails to load falls back to today's coloured chip (never a broken image or a blank).
import { isPlated, crestSrc } from "../../js/clublogo.js?v=b92308e039";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function luminance(hex) {
  const raw = String(hex || "").trim().replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

// `t`: the club object from getTeams() (or undefined for an unknown abbr). Returns the <a> for the club.
export function clubChip(abbr, t, href, { cls = "", title = "" } = {}) {
  const style = t ? ` style="--team-bg:${esc(t.colourPrimary)};--team-ink:${(luminance(t.colourPrimary) ?? 0) > 0.40 ? "#14181d" : "#fff"}"` : "";
  // The faint crests sit on a light circle in a name cell (analytics.css), so they use the light-background file there.
  const plated = /\ban-nameclub\b/.test(cls) && isPlated(abbr);
  const src = crestSrc(t, plated);
  const ttl = ` title="${esc(title ? `${abbr} · ${title}` : abbr)}"`;
  const base = `an-teampill${cls ? " " + cls : ""}`;
  const club = ` data-club="${esc(abbr)}"`;
  if (!src) return `<a class="${base}" href="${esc(href)}"${style}${ttl}>${esc(abbr)}</a>`;
  // In a player's name cell (an-nameclub) the abbreviation is printed beside the name (clubAbbr), so no hidden copy.
  const hidden = /\ban-nameclub\b/.test(cls) ? "" : `<span class="an-pilltxt">${esc(abbr)}</span>`;
  return `<a class="${base} an-logo" href="${esc(href)}"${club}${style}${ttl}><img src="${esc(src)}" alt="${esc(abbr)}" loading="lazy" onerror="this.parentNode.classList.remove('an-logo');this.remove()">${hidden}</a>`;
}

// The abbreviation as plain printed text (one font and colour for every club), after a player's name.
export const clubAbbr = (abbr) => `<span class="an-clubabbr">${esc(abbr)}</span>`;
