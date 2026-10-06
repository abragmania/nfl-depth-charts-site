// PURE (no DOM, no imports): D234, the ONE list of team-measure names. The same measure carries the same name on the
// Grid (agg_grid.js, views/grid.js), the Rankings tables (views/offense.js, views/defense.js) and the club pages
// (views/team.js, views/team_def.js), and a new tile, column or cell takes its name from here rather than spelling its own.
//
// Keyed by the aggregation's data key (agg_team.js). `name` is the base name, the more spelled-out form wherever the
// surfaces used to differ. `short` (optional) is a one-column fallback for a table header that does not fit; the full
// name then goes in the header's title. `inGroup` (optional) is a short form allowed only where the table's group header
// already says what the word would (Rankings' Rushing group says "Rush", so "Yds/g" there).
//
// The side word is a rule, not a name: withSide() adds it where a page chooses to show it. An offense's page adds
// "allowed" for what is done to it (Pressure % allowed, Hit % allowed, Hurry % allowed, Sack % allowed); a defense's adds
// "allowed" for what it gives up (EPA/play allowed, YPC allowed, Explosive % allowed, YBC/carry allowed) and "forced" for
// stuffed runs (Stuffed % forced); a Rankings table under the Offense | Defense switch prints the base name alone.
const deepFreeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

export const NAMES = deepFreeze({
  epaPlay: { name: "EPA/play" },
  epaDb: { name: "EPA/dropback" },
  epaCar: { name: "EPA/carry" },
  ypc: { name: "YPC" },
  rushYdsG: { name: "Rush yds/g", inGroup: "Yds/g" },
  succPct: { name: "Success %" },
  runSuccPct: { name: "Run success %" },
  explPct: { name: "Explosive %" },
  runExplPct: { name: "Explosive run %" },
  cmpPct: { name: "Comp %" },
  covCmpPct: { name: "Comp %" },
  sackPct: { name: "Sack %" },
  pressPct: { name: "Pressure %" },
  pressPctAllowed: { name: "Pressure %" },
  hitPctAllowed: { name: "Hit %" },
  hurryPctAllowed: { name: "Hurry %" },
  stuffPct: { name: "Stuffed %" },
  ybcCar: { name: "YBC/carry" },
  runStopPct: { name: "Run-stop %" },
  covRating: { name: "Rating allowed" },
  covYdsTgt: { name: "Yds/target" },
  playsG: { name: "Plays/g" },
  passRate: { name: "Pass rate" },
  adot: { name: "aDOT" },
  paPct: { name: "PA %" },
  blitzPct: { name: "Blitz %" },
  pressuresG: { name: "Pressures/g" },
  ptsDrive: { name: "Points/drive" },
  rzTdPct: { name: "Red-zone TD %" },
  thirdPct: { name: "3rd-down %" },
  neutralSecs: { name: "Neutral sec/play" },
});

export const SIDE_WORDS = Object.freeze(["", "allowed", "forced"]);

// The base name for a data key, with the side word added when one is given ("allowed" or "forced"). An unknown key
// throws, so a typo cannot print a blank label.
export function nameOf(k, side = "") {
  const e = NAMES[k];
  if (!e) throw new Error(`names.js: no name for "${k}"`);
  if (!SIDE_WORDS.includes(side || "")) throw new Error(`names.js: unknown side word "${side}"`);
  return side ? `${e.name} ${side}` : e.name;
}

// A table header's text: the short form when `inGroup` is asked for and the key has one, or `short` when the page found
// the full name does not fit (the full name then belongs in the header's title); otherwise the base name.
export function headerOf(k, { inGroup = false, short = false } = {}) {
  const e = NAMES[k];
  if (!e) throw new Error(`names.js: no name for "${k}"`);
  if (short && e.short) return e.short;
  if (inGroup && e.inGroup) return e.inGroup;
  return e.name;
}
