/**
 * Search-as-you-type for places (addresses, shops, businesses, areas).
 *
 * Provider choice:
 *   1. TomTom Search (fuzzy + typeahead) when the user has a free TomTom key
 *      (the same key as live traffic). Best coverage of businesses/POIs, typo-
 *      tolerant, Greek & English. Free tier: 2,500 requests/day, 5 per second.
 *   2. Photon (komoot, OpenStreetMap data) – free, no key, built for autocomplete.
 *      Fair use only, so we debounce and cache.
 * Results are biased toward the rider's current position.
 */
import { readJSON } from '../lib/storage.js';
import { lang } from '../lib/i18n.js';

const cache = new Map();

const iconFor = (kind = '') => {
  const k = kind.toLowerCase();
  if (/fuel|petrol|gas_station|charging/.test(k)) return '⛽';
  if (/restaurant|food|cafe|coffee|bar|pub|fast_food|bakery/.test(k)) return '🍽️';
  if (/hotel|motel|hostel|guest/.test(k)) return '🏨';
  if (/hospital|clinic|pharmacy|doctor|dentist/.test(k)) return '🏥';
  if (/school|college|university|education/.test(k)) return '🏫';
  if (/shop|supermarket|mall|store|market/.test(k)) return '🛒';
  if (/airport|aerodrome/.test(k)) return '✈️';
  if (/port|ferry|harbour|marina/.test(k)) return '⛴️';
  if (/station|bus|metro|railway|tram/.test(k)) return '🚉';
  if (/parking/.test(k)) return '🅿️';
  if (/beach/.test(k)) return '🏖️';
  if (/park|forest|nature|mountain|peak/.test(k)) return '🌲';
  if (/museum|monument|attraction|historic|archaeolog|tourism/.test(k)) return '🏛️';
  if (/city|town|village|municipality|suburb|neighbourhood|geography|locality|state|country/.test(k)) return '🏙️';
  if (/street|road|address|house|point address|cross street/.test(k)) return '📍';
  return '📍';
};

async function tomtom(q, near, key, signal) {
  const params = new URLSearchParams({
    key, typeahead: 'true', limit: '7', language: lang() === 'el' ? 'el-GR' : 'en-GB', minFuzzyLevel: '1', maxFuzzyLevel: '2',
  });
  if (near) { params.set('lat', near.lat.toFixed(4)); params.set('lon', near.lon.toFixed(4)); }
  const res = await fetch(`https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?${params}`, { signal });
  if (!res.ok) throw new Error(`TomTom search ${res.status}`);
  const { results = [] } = await res.json();
  return results.map((r) => {
    const a = r.address || {};
    const isPoi = r.type === 'POI' && r.poi?.name;
    const kind = isPoi ? (r.poi.categories || []).join(' ') : r.type;
    return {
      name: isPoi ? r.poi.name : (a.streetName ? `${a.streetName}${a.streetNumber ? ' ' + a.streetNumber : ''}` : a.municipality || a.freeformAddress),
      sub: isPoi ? a.freeformAddress : [a.municipalitySubdivision, a.municipality, a.countrySubdivision].filter(Boolean).join(', '),
      lat: r.position.lat,
      lon: r.position.lon,
      icon: iconFor(kind),
      distM: r.dist ?? null,
      source: 'tomtom',
    };
  });
}

async function photon(q, near, signal) {
  const params = new URLSearchParams({ q, limit: '7' });
  if (lang() === 'en') params.set('lang', 'en'); // 'default' keeps local (Greek) names
  if (near) { params.set('lat', near.lat.toFixed(4)); params.set('lon', near.lon.toFixed(4)); }
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const { features = [] } = await res.json();
  return features.map((f) => {
    const p = f.properties || {};
    const street = p.street ? `${p.street}${p.housenumber ? ' ' + p.housenumber : ''}` : '';
    const name = p.name || street || p.city || p.county;
    return {
      name,
      sub: [p.name ? street : '', p.district || p.locality, p.city, p.state].filter((x) => x && x !== name).join(', '),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      icon: iconFor(`${p.osm_key} ${p.osm_value} ${p.type}`),
      source: 'photon',
    };
  }).filter((r) => r.name);
}

/** @returns {Promise<Array<{name, sub, lat, lon, icon, source}>>} */
export async function searchPlaces(query, { near = null, signal } = {}) {
  const q = query.trim();
  const key = readJSON('ridewx.tomtomKey', '');
  if (q.length < (key ? 3 : 2)) return [];
  const ck = `${key ? 't' : 'p'}|${lang()}|${q.toLowerCase()}|${near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : ''}`;
  if (cache.has(ck)) return cache.get(ck);
  let out = [];
  if (key) {
    try { out = await tomtom(q, near, key, signal); } catch (e) { if (e.name === 'AbortError') throw e; }
  }
  if (!out.length) out = await photon(q, near, signal);
  // Drop near-duplicates (same name within ~50 m).
  const dedup = [];
  for (const r of out) if (!dedup.some((d) => d.name === r.name && Math.abs(d.lat - r.lat) < 5e-4 && Math.abs(d.lon - r.lon) < 5e-4)) dedup.push(r);
  cache.set(ck, dedup);
  return dedup;
}
