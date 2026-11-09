/**
 * Network side of the bike app – all free, no keys:
 *   routing   : FOSSGIS OSRM bicycle profile (routing.openstreetmap.de), the one
 *               openstreetmap.org uses; falls back to the OSRM demo (car) server.
 *   elevation : Open-Meteo elevation API (Copernicus 90 m DEM) – services/elevation.js
 *   weather   : Open-Meteo hourly forecast along the route at each point's ETA,
 *               plus `current` for live riding (temperature, humidity, surface
 *               pressure, wind 10 m, gusts).
 */
import { fetchElevations } from '../services/elevation.js';
import { haversine } from '../lib/geo.js';
import { buildProfile, resampleTrack } from '../lib/elevationProfile.js';

const BIKE_OSRM = 'https://routing.openstreetmap.de/routed-bike';
const CAR_OSRM = import.meta.env?.VITE_OSRM_URL || 'https://router.project-osrm.org';

async function osrm(base, pts, signal) {
  const c = pts.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const url = `${base}/route/v1/driving/${c}?overview=full&geometries=geojson&annotations=distance,duration`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Routing HTTP ${res.status}`);
  const j = await res.json();
  if (j.code !== 'Ok' || !j.routes?.length) throw new Error(`Routing: ${j.message || j.code}`);
  const r = j.routes[0];
  return {
    coords: r.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    segDist: r.legs.flatMap((l) => l.annotation.distance),
    segTime: r.legs.flatMap((l) => l.annotation.duration),
    distanceM: r.distance,
    durationS: r.duration,
  };
}

/** Route through [from, ...via, to]. */
export async function fetchBikeRoute(points, { signal } = {}) {
  try {
    return { ...(await osrm(BIKE_OSRM, points, signal)), source: 'bike' };
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return { ...(await osrm(CAR_OSRM, points, signal)), source: 'car' };
  }
}

/** Route → evenly spaced points with cumulative distance, smoothed elevation, grade, bearing. */
export async function buildRouteProfile(route, { signal } = {}) {
  const pts = [];
  let d = 0;
  route.coords.forEach((p, i) => {
    if (i > 0) d += route.segDist[i - 1] ?? haversine(route.coords[i - 1].lat, route.coords[i - 1].lon, p.lat, p.lon);
    pts.push({ lat: p.lat, lon: p.lon, distM: d });
  });
  const step = Math.max(40, d / 1200); // ≥ 40 m, at most ~1200 DEM samples
  const even = resampleTrack(pts, step);
  const elev = await fetchElevations(even, { signal });
  if (elev.every((e) => e == null)) throw new Error('Δεν βρέθηκαν υψόμετρα (Open-Meteo elevation)');
  return buildProfile(even.map((p, i) => ({ ...p, elev: elev[i] })));
}

const HOURLY = 'temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,weather_code';

function interp(h, tUnix) {
  const t = h.time;
  let i = t.findIndex((x) => x > tUnix) - 1;
  if (i < 0) i = tUnix < t[0] ? 0 : t.length - 2;
  i = Math.max(0, Math.min(i, t.length - 2));
  const f = Math.max(0, Math.min(1, (tUnix - t[i]) / (t[i + 1] - t[i])));
  const lin = (k) => {
    const a = h[k][i];
    const b = h[k][i + 1];
    return a == null ? b : b == null ? a : a + (b - a) * f;
  };
  // wind direction as a vector (350° & 010° → 000°, not 180°)
  const rad = (j) => (h.wind_direction_10m[j] * Math.PI) / 180;
  const u = (1 - f) * h.wind_speed_10m[i] * Math.sin(rad(i)) + f * h.wind_speed_10m[i + 1] * Math.sin(rad(i + 1));
  const v = (1 - f) * h.wind_speed_10m[i] * Math.cos(rad(i)) + f * h.wind_speed_10m[i + 1] * Math.cos(rad(i + 1));
  return {
    temperature: lin('temperature_2m'),
    humidity: lin('relative_humidity_2m'),
    pressure: lin('surface_pressure'),
    windSpeed: lin('wind_speed_10m'),
    windGusts: lin('wind_gusts_10m'),
    windDirection: ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360,
    precipitation: lin('precipitation'),
    weatherCode: h.weather_code[f < 0.5 ? i : i + 1],
  };
}

/**
 * Forecast at points every `everyM` along the profile, each at its own ETA.
 * etaAt(distM) → unix seconds.  Returns [{distM, ...weather}].
 */
export async function fetchRouteWeather(profile, etaAt, { signal, everyM = 2000 } = {}) {
  const total = profile[profile.length - 1].distM;
  const n = Math.max(2, Math.ceil(total / everyM) + 1);
  const samples = Array.from({ length: n }, (_, k) => {
    const d = (total * k) / (n - 1);
    const p = profile.reduce((best, x) => (Math.abs(x.distM - d) < Math.abs(best.distM - d) ? x : best), profile[0]);
    return { distM: d, lat: p.lat, lon: p.lon, eta: etaAt(d) };
  });
  const ymd = (s) => new Date(s * 1000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    latitude: samples.map((s) => s.lat.toFixed(4)).join(','),
    longitude: samples.map((s) => s.lon.toFixed(4)).join(','),
    hourly: HOURLY,
    timezone: 'GMT',
    timeformat: 'unixtime',
    wind_speed_unit: 'kmh',
    start_date: ymd(Math.min(...samples.map((s) => s.eta))),
    end_date: ymd(Math.max(...samples.map((s) => s.eta)) + 3600),
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  let j = await res.json();
  if (!Array.isArray(j)) j = [j];
  return samples.map((s, k) => ({ distM: s.distM, eta: s.eta, gridElev: j[k].elevation ?? null, ...interp(j[k].hourly, s.eta) }));
}

/** Weather at an along-route distance from the sampled list (linear, wind as vector). */
export function weatherAlong(list, distM) {
  if (!list?.length) return null;
  if (distM <= list[0].distM) return list[0];
  const last = list[list.length - 1];
  if (distM >= last.distM) return last;
  let i = 0;
  while (list[i + 1].distM < distM) i++;
  const a = list[i];
  const b = list[i + 1];
  const f = (distM - a.distM) / (b.distM - a.distM || 1);
  const L = (k) => a[k] + (b[k] - a[k]) * f;
  const r = (x) => (x * Math.PI) / 180;
  const u = (1 - f) * a.windSpeed * Math.sin(r(a.windDirection)) + f * b.windSpeed * Math.sin(r(b.windDirection));
  const v = (1 - f) * a.windSpeed * Math.cos(r(a.windDirection)) + f * b.windSpeed * Math.cos(r(b.windDirection));
  return {
    ...a,
    distM,
    temperature: L('temperature'),
    humidity: L('humidity'),
    pressure: L('pressure'),
    windSpeed: L('windSpeed'),
    windGusts: L('windGusts'),
    windDirection: ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360,
  };
}

/** Live conditions at the rider (Open-Meteo `current`, 15-min model value). */
export async function fetchCurrentConditions(lat, lon, { signal } = {}) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'kmh',
    timezone: 'GMT',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const { current: c, elevation } = await res.json();
  return {
    temperature: c.temperature_2m,
    humidity: c.relative_humidity_2m,
    pressure: c.surface_pressure,
    windSpeed: c.wind_speed_10m,
    windDirection: c.wind_direction_10m,
    windGusts: c.wind_gusts_10m,
    gridElev: elevation ?? null,
    fetchedAt: Date.now(),
    lat,
    lon,
  };
}
