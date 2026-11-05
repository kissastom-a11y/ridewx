/**
 * Voice-command understanding (pure – unit tested). Greek and English.
 *
 * Speech recognisers return slightly different text each time (accents or not,
 * "πάμε" vs "πάμε στο"), so we normalise first: lower-case, strip Greek accents
 * and diaeresis, drop punctuation. Then we match in priority order:
 *   1. safety/quick controls (stop, mute) – must never be mistaken for a place
 *   2. a saved place by name ("πάμε σπίτι", "take me to work", "γυμναστήριο")
 *   3. "go to <anything>"  → navigate (geocoded)
 *   4. questions (fuel, weather, wind, next turn, arrival, speed limit)
 *   5. toggles (traffic, night/day map), start, help
 */

export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents & diaeresis
    .replace(/ς/g, 'σ')
    .replace(/[.,!?;:«»"'()·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extra spoken names for the two built-in places.
const PLACE_SYNONYMS = {
  home: ['σπιτι', 'σπιτακι', 'home', 'house'],
  work: ['δουλεια', 'γραφειο', 'εργασια', 'σχολη', 'work', 'office', 'job'],
};

const NAV = /^(?:(?:πηγαινε|παμε|οδηγησε|πλοηγησε|δρομολογησε|βρεσ|βρες|δειξε|θελω να παω)(?: με| μασ| μου)?(?: (?:για|προσ|σε|στο|στη|στην|στον|στα|στισ|στουσ))?|(?:navigate|go|take me|drive|head|directions|route)(?: me)?(?: (?:to|towards|for))?) (.{2,})$/;

// JS \b only understands Latin letters – Greek needs explicit space/edge boundaries.
const W = (alts) => new RegExp(`(?:^|\\s)(?:${alts})(?:\\s|$)`);

const R = {
  stop: W('σταματα|σταματησε|τελοσ διαδρομησ|τερματισμοσ|stop|end ride|finish ride|cancel route'),
  mute: W('σιγαση|σωπα|ησυχια|κλεισε τη φωνη|mute|quiet|silence|shut up'),
  unmute: W('ανοιξε τη φωνη|μιλα|ενεργοποιησε τη φωνη|unmute|sound on|voice on'),
  fuel: /(βενζινη|καυσιμ|καταναλωσ|πετρελαι|λιτρα|καιω|fuel|petrol|gas|consumption|diesel|mileage)/,
  weather: /(καιροσ|καιρο|βροχη|θερμοκρασια|weather|rain|temperature|forecast)/,
  wind: /(αερασ|αερα|ανεμ|ριπ|πλευρικ|wind|gust|crosswind)/,
  next: /(στροφη|στριβω|επομενη|που παω|οδηγιεσ|next turn|where do i turn|next instruction|directions)/,
  eta: /(ποτε φτανω|ποτε θα φτασ|ποση ωρα|ποσο μενει|ποσο απεχ|αφιξη|when do i arrive|when will i arrive|\beta\b|how long|how far|arrival)/,
  limit: /(οριο|speed limit|\blimit\b)/,
  trafficOff: /(κρυψε|κλεισε|χωρισ|off|hide).*(κινηση|traffic)|(κινηση|traffic).*(off|κλεισε|κρυψε)/,
  trafficOn: /(κινηση|traffic)/,
  night: /(νυχτα|νυχτερι|σκοτειν|night|dark)/,
  day: /(μερα|ημερα|ημερησι|φωτειν|day mode|daytime|light mode)/,
  start: /^(ξεκινα|ξεκινησε|ξεκιναμε|εκκινηση|παμε|start|begin|let's go|lets go|go)$/,
  help: /(βοηθεια|τι μπορω|τι λεσ|help|what can)/,
};

/**
 * @param {string[]} alternatives  recogniser hypotheses, best first
 * @param {{places: Array<{id,name,lat}>}} ctx
 * @returns {{type: string, place?, query?, heard: string}}
 */
export function parseCommand(alternatives, { places = [] } = {}) {
  const list = (Array.isArray(alternatives) ? alternatives : [alternatives]).filter(Boolean);
  // Prefer a hypothesis that hits a saved place or a command over a free-text
  // "navigate to …" (which accepts anything, including a misheard word).
  const parsed = list.map((raw) => parseOne(raw, places));
  return parsed.find((r) => r.type !== 'unknown' && r.type !== 'navigate')
    || parsed.find((r) => r.type === 'navigate')
    || { type: 'unknown', heard: list[0] || '' };
}

function parseOne(raw, places) {
  const s = normalize(raw);
  const heard = raw;
  if (!s) return { type: 'unknown', heard };

  if (R.stop.test(s)) return { type: 'stop', heard };
  if (R.mute.test(s)) return { type: 'mute', heard };
  if (R.unmute.test(s)) return { type: 'unmute', heard };

  // Saved places, by their name or the built-in synonyms.
  const saved = places.filter((p) => p.lat != null);
  for (const p of saved) {
    const names = [normalize(p.name), ...(PLACE_SYNONYMS[p.id] || [])].filter((n) => n.length >= 3);
    if (names.some((n) => new RegExp(`(^|\\s)${n}(\\s|$)`).test(s))) return { type: 'place', place: p, heard };
  }
  // A built-in place that hasn't been set yet → tell the user.
  for (const [id, syn] of Object.entries(PLACE_SYNONYMS)) {
    if (syn.some((n) => new RegExp(`(^|\\s)${n}(\\s|$)`).test(s)) && (NAV.test(s) || s.split(' ').length <= 3)) {
      return { type: 'place_unset', placeId: id, heard };
    }
  }

  const nav = s.match(NAV);
  if (nav && !R.fuel.test(s) && !R.weather.test(s)) {
    // Use the ORIGINAL words (with accents) for geocoding: same number of words from the end.
    const words = nav[1].split(' ').length;
    const query = raw.trim().replace(/[.!?]+$/, '').split(/\s+/).slice(-words).join(' ');
    return { type: 'navigate', query, heard };
  }

  if (R.fuel.test(s)) return { type: 'fuel', heard };
  if (R.weather.test(s)) return { type: 'weather', heard };
  if (R.wind.test(s)) return { type: 'wind', heard };
  if (R.eta.test(s)) return { type: 'eta', heard };
  if (R.next.test(s)) return { type: 'next', heard };
  if (R.limit.test(s)) return { type: 'limit', heard };
  if (R.trafficOff.test(s)) return { type: 'traffic_off', heard };
  if (R.trafficOn.test(s)) return { type: 'traffic_on', heard };
  if (R.night.test(s)) return { type: 'night', heard };
  if (R.day.test(s)) return { type: 'day', heard };
  if (R.start.test(s)) return { type: 'start', heard };
  if (R.help.test(s)) return { type: 'help', heard };
  return { type: 'unknown', heard };
}
