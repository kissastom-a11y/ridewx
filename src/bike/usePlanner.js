/**
 * Planning pipeline:  places → bike route → DEM profile → forecast at each point's ETA.
 * The (cheap) pacing maths is NOT done here – BikeApp recomputes it from these
 * inputs whenever the rider changes a setting, without refetching anything.
 */
import { useCallback, useRef, useState } from 'react';
import { geocode } from '../services/geocode.js';
import { fetchBikeRoute, buildRouteProfile, fetchRouteWeather } from './services.js';

const here = () => new Promise((res, rej) => {
  if (!navigator.geolocation) return rej(new Error('Δεν υποστηρίζεται GPS'));
  navigator.geolocation.getCurrentPosition(
    (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude, label: 'Η θέση μου' }),
    (e) => rej(new Error(e.code === 1 ? 'Δεν δόθηκε άδεια τοποθεσίας' : e.message)),
    { enableHighAccuracy: true, timeout: 15000 },
  );
});

async function resolve(v, near, signal) {
  if (v && typeof v === 'object') {
    if (v.isMe) return here();
    if (v.lat != null) return { lat: v.lat, lon: v.lon, label: v.label || v.name };
  }
  const s = String(v || '').trim();
  if (!s) return null;
  return geocode(s, { signal, near });
}

export function usePlanner() {
  const [state, setState] = useState({ status: 'idle', error: null, step: null });
  const [data, setData] = useState(null); // { stops, route, profile, weather, departUnix }
  const ctrl = useRef(null);

  const plan = useCallback(async ({ from, via = [], to, departUnix, targetS }) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const { signal } = c;
    try {
      setState({ status: 'loading', error: null, step: 'Αναζήτηση σημείων…' });
      const stops = [];
      for (const v of [from, ...via, to]) {
        const p = await resolve(v, stops[stops.length - 1] || null, signal);
        if (p) stops.push(p);
      }
      if (stops.length < 2) throw new Error('Δώσε αφετηρία και προορισμό');
      setState((s) => ({ ...s, step: 'Διαδρομή ποδηλάτου…' }));
      const route = await fetchBikeRoute(stops, { signal });
      setState((s) => ({ ...s, step: 'Υψομετρικό (DEM)…' }));
      const profile = await buildRouteProfile(route, { signal });
      setState((s) => ({ ...s, step: 'Καιρός κατά μήκος…' }));
      const total = profile[profile.length - 1].distM;
      const etaAt = (d) => departUnix + (targetS * d) / total;
      let weather = null;
      let wxError = null;
      try { weather = await fetchRouteWeather(profile, etaAt, { signal }); } catch (e) { if (e.name === 'AbortError') throw e; wxError = e.message; }
      setData({ stops, route, profile, weather, departUnix, wxError, at: Date.now() });
      setState({ status: 'ok', error: null, step: null });
    } catch (e) {
      if (e.name === 'AbortError') return;
      setState({ status: 'error', error: e.message, step: null });
    }
  }, []);

  return { ...state, data, plan, setData };
}
