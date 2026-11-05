/**
 * Speed limits from OpenStreetMap `maxspeed`.
 *
 * Greek legal defaults (ΚΟΚ) for when a road has no explicit sign mapped:
 *   inside towns 50 · outside towns 90 · expressway (trunk) 110 · motorway 130
 * We only apply the defaults where the road type alone decides it
 * (motorway, trunk, living street); otherwise "unknown" is more honest than a guess.
 */
import { fastDist } from '../lib/track.js';
import { initialBearing, normalize180 } from '../lib/geo.js';

const ZONE = { 'gr:urban': 50, 'gr:rural': 90, 'gr:trunk': 110, 'gr:motorway': 130, 'gr:living_street': 20, walk: 10 };
const ROAD_DEFAULT = { motorway: 130, trunk: 110, living_street: 20 };

/** maxspeed tag (+ highway type) → { kmh, explicit } or null */
export function parseMaxspeed(tag, highway) {
  if (tag) {
    const t = String(tag).trim().toLowerCase();
    if (ZONE[t]) return { kmh: ZONE[t], explicit: true };
    const m = t.match(/^(\d+)\s*(mph)?/);
    if (m) return { kmh: m[2] ? Math.round(+m[1] * 1.609) : +m[1], explicit: true };
    if (t === 'none' || t === 'signals' || t === 'variable') return null;
  }
  if (ROAD_DEFAULT[highway]) return { kmh: ROAD_DEFAULT[highway], explicit: false };
  return null;
}

/** Limit at an along-route distance from route ranges [{from, to, kmh, explicit}] */
export function speedLimitAt(ranges, d) {
  if (!ranges?.length || d == null) return null;
  const hits = ranges.filter((r) => d >= r.from - 20 && d <= r.to + 20);
  if (!hits.length) return null;
  const pool = hits.some((h) => h.explicit) ? hits.filter((h) => h.explicit) : hits;
  // Prefer the longest matching stretch: the road you're actually on, not a short parallel slip road.
  return pool.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
}

const ROADS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';

/**
 * Live lookup around the rider (no route, or off the route). Picks the road
 * segment nearest to you whose direction matches your heading (either way along
 * the road), so the cross street at a junction doesn't win.
 */
export async function fetchLiveLimit(lat, lon, heading, { signal } = {}) {
  const q = `[out:json][timeout:10];way(around:25,${lat.toFixed(5)},${lon.toFixed(5)})[highway~"^(${ROADS})$"];out tags geom;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', body: `data=${encodeURIComponent(q)}`, signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const { elements = [] } = await res.json();
  let best = null;
  for (const w of elements) {
    const g = w.geometry || [];
    for (let i = 0; i < g.length - 1; i++) {
      const mid = { lat: (g[i].lat + g[i + 1].lat) / 2, lon: (g[i].lon + g[i + 1].lon) / 2 };
      let score = fastDist(lat, lon, mid.lat, mid.lon);
      if (heading != null) {
        const b = initialBearing(g[i].lat, g[i].lon, g[i + 1].lat, g[i + 1].lon);
        const diff = Math.abs(normalize180(b - heading));
        const along = Math.min(diff, 180 - diff); // two-way road: either direction counts
        if (along > 35) score += 200; // a crossing road – heavily penalised
      }
      if (!best || score < best.score) best = { score, way: w };
    }
  }
  if (!best) return null;
  const t = best.way.tags || {};
  const p = parseMaxspeed(t.maxspeed, t.highway);
  return p ? { ...p, name: t.name || t.ref || '' } : null;
}
