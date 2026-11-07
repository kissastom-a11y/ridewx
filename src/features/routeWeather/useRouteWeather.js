/**
 * Feature 1 pipeline:
 *   geocode → OSRM route → resample every ~12 km → ETA per waypoint
 *   → Open-Meteo at (lat, lon, ETA) → hazard per waypoint → per-segment colours
 */
import { t } from '../../lib/i18n.js';
import { useCallback, useRef, useState } from 'react';
import { geocode } from '../../services/geocode.js';
import { fetchRoute, classRanges } from '../../services/osrm.js';
import { fetchRoadInfo } from '../../services/roadInfo.js';
import { buildTrack, locateOnTrack } from '../../lib/track.js';
import { isActionable } from '../guidance/guidance.js';
import { fetchRouteForecast } from '../../services/openMeteo.js';
import { fetchTrafficSummary } from '../../services/tomtom.js';
import { fetchElevations, exposureAt } from '../../services/elevation.js';
import { sampleRoute } from '../../lib/geo.js';
import { analyzeWind } from '../../lib/wind.js';
import { classifyHazard } from './hazard.js';

export const WAYPOINT_INTERVAL_M = 12000; // spec: 10–15 km

/** A place can be typed text (geocoded) or an already-known {lat, lon, label}. */
const resolve = (x, signal, near) => (typeof x === 'string' ? geocode(x, { signal, near }) : Promise.resolve(x));

export function useRouteWeather() {
  const [state, setState] = useState({ status: 'idle', error: null, route: null, waypoints: [], segments: [], profile: [] });
  const abortRef = useRef(null);

  const plan = useCallback(async ({ from, to, startTime, trafficKey, avoidTolls = false }) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const { signal } = ctrl;

    try {
      setState((s) => ({ ...s, status: 'routing', error: null }));
      // Nominatim policy: sequential, not parallel.
      const origin = await resolve(from, signal);
      const destination = await resolve(to, signal, typeof origin === 'object' ? origin : null);
      // Avoid tolls if asked. If no toll-free route exists, fall back and say so.
      let route;
      let avoidFailed = false;
      try {
        route = await fetchRoute(origin, destination, { signal, exclude: avoidTolls ? ['toll'] : [] });
      } catch (e) {
        if (!avoidTolls || e.name === 'AbortError') throw e;
        route = await fetchRoute(origin, destination, { signal });
        avoidFailed = true;
      }
      route.avoidTolls = avoidTolls;
      route.avoidFailed = avoidFailed;

      // Dense track (≈100 m) for matching things to the route, + toll/tunnel ranges from OSRM classes.
      const track = buildTrack(route);
      const classes = classRanges(route.intersections, (la, lo) => locateOnTrack(track, la, lo), route.distanceM);
      route.tollKm = classes.toll.reduce((s, [a, b]) => s + (b - a), 0) / 1000;
      // Voice-guidance maneuvers placed along the route (metres from start).
      route.guide = (route.maneuvers || []).filter(isActionable).map((m) => ({
        ...m,
        distM: m.type === 'arrive' ? route.distanceM : locateOnTrack(track, m.lat, m.lon)?.distM,
      })).filter((m) => m.distM != null).sort((a, b) => a.distM - b.distM);

      // Live traffic (optional): TomTom's traffic-aware time vs OSRM's free-flow
      // time gives a slow-down factor; we stretch every waypoint ETA by it so the
      // weather is fetched for when you'll REALLY be there.
      let traffic = null;
      if (trafficKey) {
        const ts = await fetchTrafficSummary(trafficKey, origin, destination, { signal, avoidTolls });
        if (ts) traffic = { ...ts, factor: Math.min(3, Math.max(1, ts.travelS / Math.max(ts.noTrafficS, 1))) };
      }
      const etaFactor = traffic?.factor ?? 1;
      if (traffic) route.durationS = Math.round(route.durationS * etaFactor);

      const startUnix = Math.floor(new Date(startTime).getTime() / 1000);
      const wps = sampleRoute(route.coords, route.segDist, route.segTime, WAYPOINT_INTERVAL_M).map((w) => ({
        ...w,
        etaUnix: startUnix + Math.round(w.etaS * etaFactor),
      }));

      setState((s) => ({ ...s, status: 'weather', route: { ...route, origin, destination } }));
      // Elevation profile (~1 km spacing, ≤ 400 points) fetched in parallel with the weather.
      const profStep = Math.max(1000, route.distanceM / 400);
      const profPts = sampleRoute(route.coords, route.segDist, route.segTime, profStep);
      const [weather, elevs] = await Promise.all([
        fetchRouteForecast(wps, { signal }),
        fetchElevations(profPts, { signal }),
      ]);
      const profile = profPts.map((p, i) => ({ lat: p.lat, lon: p.lon, distM: p.distM, elev: elevs[i] }));

      const waypoints = wps.map((w, i) => {
        const wx = weather[i];
        // Terrain exposure boosts wind on ridges/passes (see services/elevation.js).
        const exposure = exposureAt(profile, w.distM);
        const k = exposure.factor;
        const hazard = classifyHazard({ ...wx, windGusts: wx.windGusts * k });
        if (exposure.exposed && wx.windGusts * k >= 30) {
          hazard.reasons.push(t('Exposed high ground (+{v}% wind)', { v: Math.round((k - 1) * 100) }));
          hazard.level = Math.max(hazard.level, 1);
        }
        // Route-level crosswind estimate using the ROAD bearing at that point
        // (live heading replaces this while riding – see Feature 2).
        const wind = analyzeWind({ speed: wx.windSpeed * k, direction: wx.windDirection, gusts: wx.windGusts * k }, w.bearing, 90);
        return { ...w, weather: wx, hazard, wind, exposure };
      });

      // Exposed crests anywhere on the route (not only at the 12 km weather points):
      // local maxima of Δh along the 1 km profile, with the nearest point's wind boosted.
      const ex = profile.map((p) => exposureAt(profile, p.distM));
      const spots = [];
      for (let i = 1; i < profile.length - 1; i++) {
        if (!ex[i].exposed || ex[i].dh < ex[i - 1].dh || ex[i].dh < ex[i + 1].dh) continue;
        const near = waypoints.reduce((a, w) => (Math.abs(w.distM - profile[i].distM) < Math.abs(a.distM - profile[i].distM) ? w : a), waypoints[0]);
        if (spots.some((sp) => Math.abs(sp.distM - profile[i].distM) < 3000)) continue;
        spots.push({
          ...profile[i],
          factor: ex[i].factor,
          dh: ex[i].dh,
          wind: Math.round(near.weather.windSpeed * ex[i].factor),
          gusts: Math.round(near.weather.windGusts * ex[i].factor),
        });
      }

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

      setState({ status: 'ready', error: null, route: { ...route, origin, destination, startUnix, traffic }, waypoints, segments, profile, spots, track, classes,
        roadInfo: { status: 'loading', unpaved: [], tunnels: classes.tunnel.map(([a, b]) => ({ from: a, to: b, lengthM: b - a, name: '' })), cameras: [] } });

      // Road details from OpenStreetMap arrive a little later – don't hold up the weather.
      fetchRoadInfo(track, { signal })
        .then((info) => setState((s) => (s.track === track ? {
          ...s,
          roadInfo: { status: 'ready', ...info, tunnels: info.tunnels.length ? info.tunnels : s.roadInfo.tunnels },
        } : s)))
        .catch((e) => {
          if (e.name === 'AbortError') return;
          setState((s) => (s.track === track ? { ...s, roadInfo: { ...s.roadInfo, status: 'error' } } : s));
        });
      return { origin, destination, durationS: route.durationS, distanceM: route.distanceM };
    } catch (err) {
      if (err.name === 'AbortError') return null;
      setState((s) => ({ ...s, status: 'error', error: err.message }));
      return null;
    }
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: 'idle', error: null, route: null, waypoints: [], segments: [], profile: [], spots: [], track: null, classes: null, roadInfo: null });
  }, []);

  return { ...state, plan, clear };
}
