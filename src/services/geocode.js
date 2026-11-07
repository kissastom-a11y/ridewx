/**
 * Turn typed text into a place when the user presses Go without picking a
 * suggestion. Order: raw "lat, lon" → the same search as the dropdown
 * (TomTom / Photon, biased to where you are) → OSM Nominatim as last resort.
 */
import { searchPlaces } from './placeSearch.js';

const cache = new Map();

export async function geocode(query, { signal, near = null } = {}) {
  const q = query.trim();
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return { lat: +m[1], lon: +m[2], label: q };
  if (cache.has(q)) return cache.get(q);

  try {
    const [best] = await searchPlaces(q, { near, signal });
    if (best) {
      const out = { lat: best.lat, lon: best.lon, label: [best.name, best.sub].filter(Boolean).join(', ') };
      cache.set(q, out);
      return out;
    }
  } catch (e) {
    if (e.name === 'AbortError') throw e;
  }

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal, headers: { 'Accept-Language': navigator.language || 'en' } });
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  const [hit] = await res.json();
  if (!hit) throw new Error(`Place not found: "${q}"`);
  const out = { lat: +hit.lat, lon: +hit.lon, label: hit.display_name };
  cache.set(q, out);
  return out;
}
