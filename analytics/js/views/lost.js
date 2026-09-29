// "What's been lost" (D196 C, reworded by D199): the card a club's page draws from absences()'s list
// (agg_absence.js). PURE: markup only, no fetch, no DOM. Moved out of views/team.js (2026-09-26) so the team page and
// the defense sub-page can both draw it.
//
// Drawn only when the injury feed's season is the season on screen (the statuses are this season's) and something is
// left to draw; otherwise "". Two parts:
// - THE FULL BLOCK, one per man absences() marks `full` (a charted out starter with a fill-in, or a top-three share of
//   the club's targets or carries this season; a quarterback first by attempts): his status, games missed, depth-chart
//   slot, Madden rank and return line; the shares he held over his BEFORE window; and, when the club has played since,
//   who took the work, each as before -> since in words ("MarShawn Lloyd (fill-in) carries 12% → 61%"), and the
//   club's runs and passes per game before and since.
// - THE NAMES LIST, everyone else listed, split Offense then Defense, each side by Madden overall (highest first): one
//   line per man, his position pill, his name (red when out), the status chip and injury, "missed n" when the feed
//   counts it, "<slot> · <ovr> OVR, <rank> of <count> <pos>" from his depth-chart card, and the return line.
// The RETURN LINE, first that applies: ESPN's return date ("return Oct 5"); the curated line the status feed merged in
// from data/static/absence_returns.json ("out for the season", "back W9 (suspended 8 games)", "eligible from W5
// (reserve/PUP)"); the league's floor for a man on reserve/PUP with no curated line ("eligible from W5
// (reserve/PUP)": he misses at least the first four games); otherwise "no return date on file". Only for a man who
// will not play (a doubtful man gets none).
//
// opts: { season (on screen), feedSeason, abbr, q (the page's query, for player links), feedPlayers (the feed's
// players map: each man's full feed entry drives the chip, missed and the return line, so the hover carries ESPN's
// note as on every other page; absences()'s own copy of the status is the fallback), cards (loadClubCards()'s map,
// gsis -> { slot, ovr, posRank, posCount, maddenPos, role }; missing is fine), side ("both" by default; "off" leaves
// the Defense names out, "def" draws only the Defense names, for the defense sub-page) }.
import { esc, isNum } from "./qb.js";
import { statusChip, statusNameClass, shortDate } from "./kit.js";

const BAND = (pos) => (pos === "RB" || pos === "FB" ? "BACKFIELD" : pos);
const SKILL_BANDS = new Set(["QB", "BACKFIELD", "WR", "TE"]);

export const LOST_TIP = "Before: his last 4 games played for the club, a game he left early skipped, last season's when he has none this season; since: the club's games after his last one; every share is of the club's total in those games, shown before → since. Each man's depth-chart slot, Madden overall and rank at his Madden position come from the depth chart.";

// The injury after the kit's short chip (which prints the code only): the first part of ESPN's detail, lowered
// ("Knee - ACL (Leg) - Surgery" -> "knee"); the chip's hover carries the whole detail.
export function lostInjury(detail) {
  return String(detail || "").split(/\s+\(|\s+-\s+/)[0].trim().toLowerCase();
}

// When he is back, as { text, title } (the header's precedence), or null for a man who may still play.
export function returnLine(s, season = null) {
  if (!s || !s.willNotPlay || s.scratch) return null;
  const src = [s.returnNote, s.returnSource ? `source: ${s.returnSource}` : ""].filter(Boolean).join(" — ");
  if (s.returnDate) {
    // ESPN marks a season-ending injury with a stand-in date past the Super Bowl (Feb 15 of the next year was seen);
    // a date after the regular season's last Sunday reads as out for the season rather than "return Feb 15, 2027".
    if (season != null && /^\d{4}-\d{2}-\d{2}/.test(s.returnDate) && s.returnDate > `${+season + 1}-01-12`) return { text: "out for the season", title: `ESPN's return date ${s.returnDate}` };
    return { text: `return ${shortDate(s.returnDate, season)}`, title: "ESPN's return date" };
  }
  const wk = s.returnWeek;
  if (wk === "season") return { text: "out for the season", title: src };
  if (Number.isInteger(wk)) {
    const g = Number.isInteger(s.returnGames) && s.returnGames > 0 ? ` ${s.returnGames} game${s.returnGames === 1 ? "" : "s"}` : "";
    if (s.returnKind === "SUSP") return { text: `back W${wk} (suspended${g})`, title: src };
    if (s.returnKind === "PUP") return { text: `eligible from W${wk} (reserve/PUP)`, title: src };
    return { text: `eligible from W${wk} (IR)`, title: src };
  }
  if (String(s.code || "").toUpperCase() === "PUP") return { text: "eligible from W5 (reserve/PUP)", title: "The league's floor: a man on reserve/PUP misses at least his club's first four games" };
  return { text: "no return date on file", title: "" };
}

// "EDGE2 · 98 OVR, 2 of 183 EDGE" from his depth-chart card; the parts it has; "" with no card.
export function cardLine(c) {
  if (!c) return "";
  const rank = isNum(c.posRank) && isNum(c.posCount) ? `${c.posRank} of ${c.posCount}${c.maddenPos ? " " + c.maddenPos : ""}` : "";
  const rating = [isNum(c.ovr) ? `${c.ovr} OVR` : "", rank].filter(Boolean).join(", ");
  return [c.slot || "", rating].filter(Boolean).join(" · ");
}

const whole = (v) => `${Math.round(v * 100)}%`;
const perG = (v) => (isNum(v) ? String(Math.round(v)) : "–");
const weekText = (season, week) => `${season} W${week}`;

export function lostCardHtml(list, { season, feedSeason, abbr = "", q = "", feedPlayers = null, cards = null, side = "both" } = {}) {
  if (feedSeason == null || +feedSeason !== +season || !list?.length) return "";
  const qq = q ? "?" + q : "";
  const who = (id, name, cls = "") => `<a${cls ? ` class="${cls}"` : ""} href="#/player/${encodeURIComponent(id)}${qq}">${esc(name)}</a>`;
  const statusOf = (r) => feedPlayers?.[r.gsis] ?? r.status ?? {};
  const statusBits = (r) => {
    const s = statusOf(r);
    const inj = lostInjury(s.detail);
    const ret = returnLine(s, feedSeason);
    return {
      html: statusChip(s) + (inj ? ` <span class="an-tm-lostinj">${esc(inj)}</span>` : ""),
      missed: isNum(s.missed) && s.missed > 0 ? `missed ${s.missed}` : "",
      nameCls: statusNameClass(s),
      card: cardLine(r.gsis ? cards?.[r.gsis] : null),
      ret: ret ? `<span class="an-tm-lostret"${ret.title ? ` title="${esc(ret.title)}"` : ""}>${esc(ret.text)}</span>` : "",
    };
  };
  const isFull = (r) => (typeof r.full === "boolean" ? r.full : !r.nameOnly);
  const sideOf = (r) => (r.side === "def" ? "def" : "off");
  const full = side === "def" ? [] : list.filter(isFull);
  const names = list.filter((r) => !isFull(r) && (side === "both" || sideOf(r) === side));
  if (!full.length && !names.length) return "";

  const man = (r) => {
    const st = statusBits(r);
    const head = `<div class="an-tm-losthead">${who(r.gsis, r.name, `an-tm-lostname${st.nameCls ? " " + st.nameCls : ""}`)}`
      + `<span class="an-pospill" data-band="${esc(BAND(r.pos))}">${esc(r.pos)}</span>`
      + `<span class="an-tm-loststat">${st.html}</span>`
      + (st.missed ? `<span class="an-tm-lostmiss">${esc(st.missed)}</span>` : "")
      + (st.card ? `<span class="an-tm-lostcard">${esc(st.card)}</span>` : "")
      + st.ret + `</div>`;
    if (r.noData) return `<div class="an-tm-lostman">${head}<div class="an-tm-lostbefore">no data: no games for the club to measure him on</div></div>`;
    const b = r.before || {};
    const held = [[b.attShare, "attempts"], [b.tgtShare, "targets"], [b.carShare, "carries"], [b.rzShare, "RZ looks"], [b.ayShare, "air yards"], [b.snapShare, "snaps"]]
      .filter(([v]) => isNum(v) && Math.round(v * 100) > 0).map(([v, w]) => `${whole(v)} ${w}`);
    const n = b.games || 0;
    let over = r.priorSeason ? `over last season's last ${n === 1 ? "game" : n}` : n === 1 ? "over his last game" : `over his last ${n}`;
    if (r.priorSeason) {
      // His last game for the club: the feed's lastPlayed when it has one, else the last game absences() found.
      const lp = statusOf(r).lastPlayed;
      const m = /^(\d{4})-(\d{2})$/.exec(String(r.lastGame || ""));
      const last = lp && lp.season != null && lp.week != null && isNum(+lp.season) && isNum(+lp.week) ? weekText(+lp.season, +lp.week) : m ? weekText(+m[1], +m[2]) : "";
      if (last) over += ` (last played ${last})`;
    }
    const before = `<div class="an-tm-lostbefore">${held.length ? `held ${held.join(", ")} ${over}` : `held no measurable share ${over}`}</div>`;
    let since = "";
    if (r.sinceGames > 0) {
      // The fill-in first whether or not his share rose, then everyone else who rose; each by the share that rose most.
      const rows = [...(r.fillIn ? [r.fillIn] : []), ...(r.absorbed || []).filter((a) => a.gsis !== r.fillIn?.gsis)].slice(0, 4);
      const took = rows.map((a) => {
        const k = [["tgtShare", "targets"], ["carShare", "carries"], ["attShare", "attempts"]].find(([key]) => isNum(a[key]?.change) && a[key].change === a.change);
        const x = k ? a[k[0]] : null;
        const fig = x && isNum(x.before) && isNum(x.since) ? ` ${k[1]} ${whole(x.before)} → ${whole(x.since)}` : "";
        return `<span class="an-tm-lostitem">${who(a.gsis, a.name)}${a.fillIn ? ` <span class="an-tm-lostfill" title="the depth chart's fill-in">(fill-in)</span>` : ""}${fig}</span>`;
      });
      const c = r.club || {};
      const club = `<span class="an-tm-lostitem">club ${perG(c.before?.runG)} → ${perG(c.since?.runG)} runs/g, ${perG(c.before?.passG)} → ${perG(c.since?.passG)} passes/g</span>`;
      const one = r.sinceGames === 1;
      since = `<div class="an-tm-lostsince${one ? " is-one" : ""}"${one ? ` title="One game since: too few to read much into"` : ""}>since (${r.sinceGames} game${one ? "" : "s"}): ${[...took, club].join(" · ")}</div>`;
    }
    const foot = r.leftEarly ? `<div class="an-tm-lostfoot">left the last one early; that game is not counted</div>` : "";
    return `<div class="an-tm-lostman">${head}${before}${since}${foot}</div>`;
  };
  // A names-list man links to his own analytics page by gsis (the status feed only carries men with one); the
  // depth-chart fallbacks (his card by playerKey, else the club's chart) are kept for a row without one.
  const nameLine = (r) => {
    const st = statusBits(r);
    const cls = `an-tm-lostname${st.nameCls ? " " + st.nameCls : ""}`;
    const nameLink = r.gsis
      ? who(r.gsis, r.name, cls)
      : r.playerKey
        ? `<a class="${cls}" href="../#/team/${encodeURIComponent(abbr)}/player/${encodeURIComponent(r.playerKey)}" title="on the depth chart">${esc(r.name)}</a>`
        : `<a class="${cls}" href="../#/team/${encodeURIComponent(abbr)}" title="on the depth chart">${esc(r.name)}</a>`;
    const band = BAND(r.pos);
    return `<span class="an-tm-lostline"><span class="an-pospill" data-band="${esc(SKILL_BANDS.has(band) ? band : "OTHER")}">${esc(r.pos)}</span> ${nameLink} <span class="an-tm-loststat">${st.html}</span>`
      + (st.missed ? ` · ${esc(st.missed)}` : "")
      + (st.card ? ` · <span class="an-tm-lostcard">${esc(st.card)}</span>` : "")
      + (st.ret ? ` · ${st.ret}` : "") + `</span>`;
  };
  const ovr = (r) => { const v = r.gsis ? cards?.[r.gsis]?.ovr : null; return isNum(v) ? v : -1; };
  const groups = [["off", "Offense"], ["def", "Defense"]].map(([sd, label]) => {
    const men = names.filter((r) => sideOf(r) === sd).sort((a, b) => ovr(b) - ovr(a));
    return men.length ? `<div class="an-tm-lostgroup"><span class="an-tm-lostside">${label}:</span>${men.map(nameLine).join("")}</div>` : "";
  }).join("");
  return `<div class="an-card an-tm-lost"><div class="an-dh" title="${esc(LOST_TIP)}">What's been lost <span class="an-dsub">${side === "def" ? "who is missing, how much he is, and when he is back" : "who is missing, the share of the work he held before, who has taken it since, and when he is back"}</span></div>`
    + (full.length ? `<div class="an-tm-lostmen">${full.map(man).join("")}</div>` : "")
    + (names.length ? `<div class="an-tm-lostnames">${groups}</div>` : "")
    + `</div>`;
}
