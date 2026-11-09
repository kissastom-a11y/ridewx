/**
 * GPS for the bike app. Same trackerStep() pipeline as RideWX, but the
 * simulator runs on a SIMULATED clock (timestamps advance by speedFactor × 1 s)
 * so acceleration and elapsed time are physically right at 5× or 10×.
 */
import { useEffect, useRef, useState } from 'react';
import { trackerStep, createRouteSimulator } from '../lib/gpsTracker.js';

export function useBikeGps({ enabled, simRoute = null, speedFactor = 10 }) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const st = useRef({});

  useEffect(() => {
    if (!enabled) return undefined;
    st.current = {};
    setError(null);
    const ingest = (fix) => {
      st.current = trackerStep(st.current, fix);
      setPosition({ ...st.current.position, sim: !!simRoute, done: !!fix.done });
    };
    if (simRoute) {
      const sim = createRouteSimulator(simRoute);
      const t0 = Date.now();
      let t = 0;
      const id = setInterval(() => {
        t += speedFactor;
        const fix = sim(t);
        ingest({ ...fix, timestamp: t0 + t * 1000 });
        if (fix.done) clearInterval(id);
      }, 1000);
      return () => clearInterval(id);
    }
    if (!('geolocation' in navigator)) { setError('Δεν υποστηρίζεται GPS'); return undefined; }
    const w = navigator.geolocation.watchPosition(
      (p) => ingest({
        lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy,
        speed: p.coords.speed, heading: p.coords.heading, altitude: p.coords.altitude, timestamp: p.timestamp,
      }),
      (e) => setError(e.code === 1 ? 'Δεν δόθηκε άδεια τοποθεσίας' : e.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(w);
  }, [enabled, simRoute, speedFactor]);

  return { position, error };
}
