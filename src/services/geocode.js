/**
 * Free geocoding via OSM Nominatim. Usage policy: max 1 request/second, no
 * autocomplete-on-keystroke, cache results. We only geocode on form submit.
 * Accepts raw "lat, lon" input too, which skips the network entirely.
 */
const cache = new Map();

export async function geocode(query, { signal } = {}) {
  const q = query.trim();
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return { lat: +m[1], lon: +m[2], label: q };
  if (cache.has(q)) return cache.get(q);

  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal, headers: { 'Accept-Language': navigator.language || 'en' } });
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  const [hit] = await res.json();
  if (!hit) throw new Error(`Place not found: "${q}"`);
  const out = { lat: +hit.lat, lon: +hit.lon, label: hit.display_name };
  cache.set(q, out);
  return out;
}
