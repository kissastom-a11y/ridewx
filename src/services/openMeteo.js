/**
 * Open-Meteo (free, no key, non-commercial use; commercial needs their paid plan).
 *
 * Two entry points:
 *   fetchRouteForecast(waypoints)  – Feature 1: weather at each waypoint AT ITS ETA
 *   fetchCurrentWind(lat, lon)     – Feature 2: live wind at the rider's position
 */
const BASE = 'https://api.open-meteo.com/v1/forecast';

const HOURLY = [
  'temperature_2m',
  'precipitation',
  'weather_code',
  'visibility',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
].join(',');

const BATCH = 40; // Open-Meteo accepts comma-separated multi-location queries; keep URLs sane.

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Interpolate the hourly series at an arbitrary unix time.
 * Scalars: linear between the two bracketing hours.
 * Wind direction: interpolated as a VECTOR (u, v) – naive linear interpolation
 * of 350° and 010° would give 180°, i.e. exactly the wrong way round.
 * Weather code: categorical, so take the nearest hour.
 */
export function interpolateHourly(hourly, tUnix) {
  const t = hourly.time;
  let i = t.findIndex((x) => x > tUnix) - 1;
  if (i < 0) i = tUnix < t[0] ? 0 : t.length - 2;
  i = Math.max(0, Math.min(i, t.length - 2));
  const f = Math.max(0, Math.min(1, (tUnix - t[i]) / (t[i + 1] - t[i])));

  const lin = (k) => {
    const a = hourly[k][i];
    const b = hourly[k][i + 1];
    if (a == null) return b;
    if (b == null) return a;
    return a + (b - a) * f;
  };

  const dirAt = (j) => (hourly.wind_direction_10m[j] * Math.PI) / 180;
  const sa = hourly.wind_speed_10m[i];
  const sb = hourly.wind_speed_10m[i + 1];
  const u = (1 - f) * sa * Math.sin(dirAt(i)) + f * sb * Math.sin(dirAt(i + 1));
  const v = (1 - f) * sa * Math.cos(dirAt(i)) + f * sb * Math.cos(dirAt(i + 1));
  const direction = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;

  return {
    temperature: lin('temperature_2m'),
    precipitation: lin('precipitation'), // mm in the preceding hour ≈ mm/h rate
    visibility: lin('visibility'), // metres
    windSpeed: lin('wind_speed_10m'), // km/h
    windGusts: lin('wind_gusts_10m'), // km/h
    windDirection: direction, // deg FROM, true
    weatherCode: hourly.weather_code[f < 0.5 ? i : i + 1],
  };
}

/**
 * @param {{lat,lon,etaUnix:number}[]} waypoints  etaUnix = absolute ETA (s)
 * @returns {Promise<object[]>} weather sample per waypoint (same order)
 */
export async function fetchRouteForecast(waypoints, { signal } = {}) {
  const results = [];
  for (let s = 0; s < waypoints.length; s += BATCH) {
    const batch = waypoints.slice(s, s + BATCH);
    const etas = batch.map((w) => w.etaUnix * 1000);
    // Request just the calendar days the trip spans (+1 so the interpolation
    // always has a following hour). Forecast horizon is 16 days.
    const start = ymd(Math.min(...etas));
    const end = ymd(Math.max(...etas) + 3600e3);

    const params = new URLSearchParams({
      latitude: batch.map((w) => w.lat.toFixed(4)).join(','),
      longitude: batch.map((w) => w.lon.toFixed(4)).join(','),
      hourly: HOURLY,
      timezone: 'GMT',
      timeformat: 'unixtime',
      start_date: start,
      end_date: end,
      wind_speed_unit: 'kmh',
    });

    const res = await fetch(`${BASE}?${params}`, { signal });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    let json = await res.json();
    if (!Array.isArray(json)) json = [json]; // single location returns an object

    json.forEach((loc, k) => results.push(interpolateHourly(loc.hourly, batch[k].etaUnix)));
  }
  return results;
}

/** Live wind for Feature 2. Open-Meteo `current` is a 15-minute model value. */
export async function fetchCurrentWind(lat, lon, { signal } = {}) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m',
    wind_speed_unit: 'kmh',
    timezone: 'GMT',
  });
  const res = await fetch(`${BASE}?${params}`, { signal });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const { current } = await res.json();
  return {
    speed: current.wind_speed_10m,
    direction: current.wind_direction_10m,
    gusts: current.wind_gusts_10m,
    temperature: current.temperature_2m,
    time: current.time,
  };
}
