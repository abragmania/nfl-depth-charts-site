// D173: the small inline icons on the matchup page's game line - a stadium or a dome for the venue, and one
// weather mark beside the forecast. Line drawings on a 24-unit grid in currentColor, so they take the text's
// own colour and size (the CSS sets 16px); decorative only (aria-hidden), because the words beside every icon
// already say what it means - "as long as the info is there, that's what really counts" (Adam, D173).
const svg = (body, cls = "") =>
  `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

const CLOUD = '<path d="M17.5 19H8a5 5 0 1 1 1.1-9.88A6 6 0 0 1 20.6 11.2 4 4 0 0 1 17.5 19z"/>';
const CLOUD_HIGH = '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.88A6 6 0 0 1 20.6 7.2 4 4 0 0 1 17.5 15z"/>';

export const ICONS = {
  // an open bowl: the rim, the stands falling away to the field, the field itself
  stadium: svg('<ellipse cx="12" cy="8.5" rx="9" ry="3.5"/><path d="M3 8.5v6c0 1.93 4.03 3.5 9 3.5s9-1.57 9-3.5v-6"/><ellipse cx="12" cy="8.5" rx="4.5" ry="1.4"/>'),
  // a roof on the ground: the arc, its ribs, the base line
  dome: svg('<path d="M3 18a9 9 0 0 1 18 0"/><path d="M2 18h20"/><path d="M12 9v9"/><path d="M8 10.2 9.5 18"/><path d="M16 10.2 14.5 18"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'),
  partly: svg('<circle cx="8" cy="8" r="3"/><path d="M8 2v1.2M2 8h1.2M3.8 3.8l.9.9M12.2 3.8l-.9.9"/><path d="M17.5 20H9.5a4 4 0 1 1 .9-7.9 5 5 0 0 1 9.6 1.6A3.2 3.2 0 0 1 17.5 20z"/>'),
  cloud: svg(CLOUD),
  rain: svg(`${CLOUD_HIGH}<path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>`),
  snow: svg(`${CLOUD_HIGH}<path d="M8 19h.01M12 18h.01M16 19h.01M10 21.5h.01M14 21.5h.01"/>`),
  storm: svg(`${CLOUD_HIGH}<path d="M12.5 15l-2 3.5h3l-2 3.5"/>`),
  fog: svg('<path d="M6 8a6 6 0 0 1 12 0"/><path d="M3 12h18M5 16h14M8 20h8"/>'),
  wind: svg('<path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h15a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 16h7"/>'),
};

// Open-Meteo's one-word summary (server/refresh/fetchers.js wmoSummary) -> its icon. A clear or partly cloudy
// NIGHT game draws the moon instead of a sun that is not up.
export function weatherIconKey(summary, isDay = true) {
  switch (summary) {
    case "Clear": return isDay === false ? "moon" : "sun";
    case "Partly cloudy": return isDay === false ? "moon" : "partly";
    case "Cloudy": return "cloud";
    case "Fog": return "fog";
    case "Drizzle": case "Rain": case "Showers": return "rain";
    case "Snow": return "snow";
    case "Thunderstorm": return "storm";
    default: return null;
  }
}

// ESPN's free-text forecast ("Intermittent clouds", "Mostly sunny", "Thunderstorms") -> the nearest icon, for the
// fallback line when Open-Meteo has nothing for the game.
export function espnIconKey(text) {
  const s = String(text ?? "").toLowerCase();
  if (!s) return null;
  if (/thunder|t-storm|storm/.test(s)) return "storm";
  if (/snow|flurr|sleet|ice/.test(s)) return "snow";
  if (/rain|shower|drizzle/.test(s)) return "rain";
  if (/fog|haze|mist/.test(s)) return "fog";
  if (/wind/.test(s)) return "wind";
  if (/partly|intermittent|mostly sunny|mostly clear|hazy sun/.test(s)) return "partly";
  if (/cloud|overcast|dreary/.test(s)) return "cloud";
  if (/sun|clear/.test(s)) return "sun";
  return null;
}

export const icon = (key) => (key && ICONS[key]) || "";
