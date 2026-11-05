/**
 * Feature 1 pipeline:
 *   geocode → OSRM route → resample every ~12 km → ETA per waypoint
 *   → Open-Meteo at (lat, lon, ETA) → hazard per waypoint → per-segment colours
 */
import { useCallback, useRef, useState } from 'react';
import { geocode } from '../../services/geocode.js';
import { fetchRoute } from '../../services/osrm.js';
import { fetchRouteForecast } from '../../services/openMeteo.js';
import { sampleRoute } from '../../lib/geo.js';
import { analyzeWind } from '../../lib/wind.js';
import { classifyHazard } from './hazard.js';

export const WAYPOINT_INTERVAL_M = 12000; // spec: 10–15 km

export function useRouteWeather() {
  const [state, setState] = useState({ status: 'idle', error: null, route: null, waypoints: [], segments: [] });
  const abortRef = useRef(null);

  const plan = useCallback(async ({ from, to, startTime }) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const { signal } = ctrl;

    try {
      setState((s) => ({ ...s, status: 'routing', error: null }));
      // Nominatim policy: sequential, not parallel.
      const origin = await geocode(from, { signal });
      const destination = await geocode(to, { signal });
      const route = await fetchRoute(origin, destination, { signal });

      const startUnix = Math.floor(new Date(startTime).getTime() / 1000);
      const wps = sampleRoute(route.coords, route.segDist, route.segTime, WAYPOINT_INTERVAL_M).map((w) => ({
        ...w,
        etaUnix: startUnix + Math.round(w.etaS),
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

      setState({ status: 'ready', error: null, route: { ...route, origin, destination, startUnix }, waypoints, segments });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, []);

  return { ...state, plan };
}
