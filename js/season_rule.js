// PURE: the NFL league-year rule, the one copy shared by the server (server/lib/seasons.js re-exports it) and the
// analytics pages (public/analytics/js/filters.js). A season is named for the calendar year it starts in; the league
// year flips in March, so January and February belong to the previous season (D39: never a hard-coded year). Used
// only where no better source (ESPN's scoreboard, the seasons list) says which season it is.
export function seasonFromDate(d = new Date()) {
  const dt = new Date(d);
  return dt.getMonth() >= 2 ? dt.getFullYear() : dt.getFullYear() - 1; // Jan/Feb belong to the previous season
}
