/**
 * gpsTracker.js – pure functions behind the real-time GPS loop.
 *
 * ─────────────────────── WHY HEADING NEEDS CARE ───────────────────────
 * `GeolocationCoordinates.heading` is the GNSS course over ground (deg true).
 * The chip derives it from Doppler velocity, so it is:
 *   - null / NaN when stationary (browsers return NaN when speed == 0),
 *   - noisy below ~2 m/s (7 km/h) – at a red light it can spin randomly,
 *   - missing entirely on some desktop/Wi-Fi-located devices.
 *
 * Strategy (in priority order):
 *   1. GNSS heading, if present AND speed ≥ MIN_SPEED_FOR_HEADING.
 *   2. Bearing between the last "anchor" fix and this one, but only once we
 *      have moved ≥ MIN_DISPLACEMENT_M. Anything shorter is dominated by
 *      position noise (a ±5 m error over 10 m of travel is ±30° of heading).
 *   3. Otherwise HOLD the last good heading (don't spin the wind arrow at a
 *      traffic light).
 * Then smooth with a circular low-pass filter (see smoothHeading).
 */
import { haversine, initialBearing, normalize180, normalize360 } from './geo.js';

export const MIN_SPEED_FOR_HEADING = 2; // m/s
export const MIN_DISPLACEMENT_M = 15;
export const MAX_ACCEPTABLE_ACCURACY_M = 75;

/**
 * Exponential smoothing on a circle. Plain averaging breaks at north:
 * avg(359°, 1°) = 180°. Instead, step from the previous value toward the new
 * one along the SHORTEST signed arc:
 *     h' = h + α · normalize180(new − h)
 * α ≈ 0.5 at 1 Hz GPS gives ~1–2 s lag – smooth but still responsive in a bend.
 */
export function smoothHeading(prev, next, alpha = 0.5) {
  if (prev == null) return next;
  return normalize360(prev + alpha * normalize180(next - prev));
}

/**
 * One tick of the tracker. Pure: takes the previous state + a raw fix, returns
 * the next state. Easy to unit-test and to drive from a simulator.
 *
 * @param state  { anchor, heading, headingSource }
 * @param fix    { lat, lon, accuracy, speed (m/s|null), heading (deg|null), timestamp }
 */
export function trackerStep(state, fix) {
  const next = { ...state };
  const speedMs = Number.isFinite(fix.speed) ? fix.speed : null;

  let raw = null;
  let source = state.headingSource || 'none';

  if (Number.isFinite(fix.heading) && speedMs != null && speedMs >= MIN_SPEED_FOR_HEADING) {
    raw = fix.heading;
    source = 'gnss';
  } else if (state.anchor) {
    const d = haversine(state.anchor.lat, state.anchor.lon, fix.lat, fix.lon);
    // Require displacement larger than the reported position error too.
    if (d >= Math.max(MIN_DISPLACEMENT_M, (fix.accuracy || 0) * 0.8)) {
      raw = initialBearing(state.anchor.lat, state.anchor.lon, fix.lat, fix.lon);
      source = 'derived';
    }
  }

  if (raw != null) {
    next.heading = smoothHeading(state.heading, raw);
    next.headingSource = source;
    next.anchor = { lat: fix.lat, lon: fix.lon, t: fix.timestamp };
  } else if (!state.anchor) {
    next.anchor = { lat: fix.lat, lon: fix.lon, t: fix.timestamp };
  }

  // Ground speed: use GNSS speed if present; else displacement/time from anchor.
  let speedKmh = speedMs != null ? speedMs * 3.6 : null;
  if (speedKmh == null && state.anchor && fix.timestamp > state.anchor.t) {
    const d = haversine(state.anchor.lat, state.anchor.lon, fix.lat, fix.lon);
    speedKmh = (d / ((fix.timestamp - state.anchor.t) / 1000)) * 3.6;
  }

  next.position = {
    lat: fix.lat,
    lon: fix.lon,
    accuracy: fix.accuracy,
    speedKmh: speedKmh ?? 0,
    heading: next.heading ?? null,
    headingSource: next.headingSource || 'none',
    timestamp: fix.timestamp,
    reliable: (fix.accuracy ?? 0) <= MAX_ACCEPTABLE_ACCURACY_M,
    altitude: Number.isFinite(fix.altitude) ? fix.altitude : null,
  };
  return next;
}

/**
 * Route replay for desk testing. Returns a function t(seconds) → fake fix,
 * walking the OSRM geometry at the OSRM-predicted speed of each edge.
 */
export function createRouteSimulator(route) {
  const cumT = [0];
  for (let i = 0; i < route.segTime.length; i++) cumT.push(cumT[i] + route.segTime[i]);
  let idx = 0;
  return (tS) => {
    const t = Math.min(tS, cumT[cumT.length - 1]);
    while (idx < cumT.length - 2 && cumT[idx + 1] < t) idx++;
    const a = route.coords[idx];
    const b = route.coords[idx + 1];
    const dt = route.segTime[idx] || 1;
    const f = Math.min(1, Math.max(0, (t - cumT[idx]) / dt));
    return {
      lat: a.lat + (b.lat - a.lat) * f,
      lon: a.lon + (b.lon - a.lon) * f,
      accuracy: 5,
      speed: route.segDist[idx] / dt,
      heading: null, // force the derived-heading path, like a phone with weak GNSS course
      timestamp: Date.now(),
      done: t >= cumT[cumT.length - 1],
    };
  };
}
