// The one copy of which crest file a club's logo uses (Adam, 2026-11-11: club logos in place of the coloured chips).
// The dark-background file (logoDark) is the default; the faint crests (CAR, NYJ, BAL) vanish on a dark page, so they
// sit on a light circle (styles.css .club-plate, analytics.css for the analytics name cell) and use the light-background
// file there. Paths go through cards.js's assetUrl so the public static site resolves them too.
import { assetUrl } from "./cards.js?v=b92308e039";

export const PLATED = new Set(["CAR", "NYJ", "BAL"]);
export const isPlated = (abbr) => PLATED.has(abbr);

// `t`: the club object from getTeams(); `plated`: draw the light-background file. "" when the club has no crest.
export function crestSrc(t, plated = false) {
  if (!t) return "";
  return assetUrl((plated ? t.logo : t.logoDark) || t.logo || t.logoDark || "");
}
