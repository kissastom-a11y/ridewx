/**
 * Feature 1 pipeline:
 *   geocode → OSRM route → resample every ~12 km → ETA per waypoint
 *   → Open-Meteo at (lat, lon, ETA) → hazard per waypoint → per-segment colours
 */
import { useCallback, useRef, useState } from 'react';
import { geocode } from '../../services/geocode.js';
import { fetchRoute } from '../../services/osrm.js';
import { fetchRouteForecast } from '../../services/openMeteo.js';
import { fetchTrafficSummary } from '../../services/tomtom.js';
import { sampleRoute } from '../../lib/geo.js';
import { analyzeWind } from '../../lib/wind.js';
import { classifyHazard } from './hazard.js';

export const WAYPOINT_INTERVAL_M = 12000; // spec: 10–15 km

/** A place can be typed text (geocoded) or an already-known {lat, lon, label}. */
const resolve = (x, signal) => (typeof x === 'string' ? geocode(x, { signal }) : Promise.resolve(x));

export function useRouteWeather() {
  const [state, setState] = useState({ status: 'idle', error: null, route: null, waypoints: [], segments: [] });
  const abortRef = useRef(null);

  const plan = useCallback(async ({ from, to, startTime, trafficKey }) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const { signal } = ctrl;

    try {
      setState((s) => ({ ...s, status: 'routing', error: null }));
      // Nominatim policy: sequential, not parallel.
      const origin = await resolve(from, signal);
      const destination = await resolve(to, signal);
      const route = await fetchRoute(origin, destination, { signal });

      // Live traffic (optional): TomTom's traffic-aware time vs OSRM's free-flow
      // time gives a slow-down factor; we stretch every waypoint ETA by it so the
      // weather is fetched for when you'll REALLY be there.
      let traffic = null;
      if (trafficKey) {
        const t = await fetchTrafficSummary(trafficKey, origin, destination, { signal });
        if (t) traffic = { ...t, factor: Math.min(3, Math.max(1, t.travelS / Math.max(t.noTrafficS, 1))) };
      }
      const etaFactor = traffic?.factor ?? 1;
      if (traffic) route.durationS = Math.round(route.durationS * etaFactor);

      const startUnix = Math.floor(new Date(startTime).getTime() / 1000);
      const wps = sampleRoute(route.coords, route.segDist, route.segTime, WAYPOINT_INTERVAL_M).map((w) => ({
        ...w,
        etaUnix: startUnix + Math.round(w.etaS * etaFactor),
      }));

      setState((s) => ({ ...s, status: 'weather', route: { ...route, origin, destination } }));
      const weather = await fetchRouteForecast(wps, { signal });

      const waypoints = wps.map((w, i) => {
        const wx = weather[i];
        const hazard = classifyHazard(wx);
        // Route-level crosswind estimate using the ROAD bearing at that point
        // (live GPS heading replaces this while riding – see Feature 2).
        const wind = analyzeWind({ speed: wx.windSpeed, direction: wx.windDirection, gusts: wx.windGusts }, w.bearing, 90);
        return { ...w, weather: wx, hazard, wind };
      });

      // Build coloured polyline segments between consecutive waypoints using
      // the REAL geometry slice, not a straight line. Each segment takes the
      // worse hazard of its two ends (conservative).
      const segments = [];
      for (let i = 0; i < waypoints.length - 1; i++) {
        const a = waypoints[i];
        const b = waypoints[i + 1];
        const pts = [a, ...route.coords.slice(a.geomIndex + 1, b.geomIndex + 1), b];
        segments.push({ points: pts, level: Math.max(a.hazard.level, b.hazard.level) });
      }

      setState({ status: 'ready', error: null, route: { ...route, origin, destination, startUnix, traffic }, waypoints, segments });
      return { origin, destination };
    } catch (err) {
      if (err.name === 'AbortError') return null;
      setState((s) => ({ ...s, status: 'error', error: err.message }));
      return null;
    }
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: 'idle', error: null, route: null, waypoints: [], segments: [] });
  }, []);

  return { ...state, plan, clear };
}
