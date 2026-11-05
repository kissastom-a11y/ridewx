/**
 * Real-time position stream.
 *
 * ─────────────────────── THE TRACKING LOOP ───────────────────────
 * navigator.geolocation.watchPosition() is push-based: the OS delivers a new
 * fix whenever the GNSS chip produces one (typically 1 Hz on phones). Each
 * callback runs trackerStep() (pure, in lib/gpsTracker.js) which:
 *     raw fix → validate accuracy → derive/smooth heading → speed → position
 * The resulting `position` is React state, so every consumer (camera
 * proximity, crosswind, map marker) re-evaluates exactly once per fix –
 * there is no polling timer competing with the GPS.
 *
 * Options chosen:
 *   enableHighAccuracy: true  – use GNSS, not Wi-Fi/cell triangulation
 *   maximumAge: 1000          – accept a cached fix ≤1 s old (smooths jitter in callbacks)
 *   timeout: 15000            – surface an error if no fix in 15 s (tunnels)
 *
 * Simulation mode replays an OSRM route at `speedFactor`× real time through the
 * same trackerStep(), so everything downstream is exercised identically.
 */
import { useEffect, useRef, useState } from 'react';
import { trackerStep, createRouteSimulator } from '../lib/gpsTracker.js';

export function useGeolocation({ enabled, simulateRoute = null, speedFactor = 10 }) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const stateRef = useRef({});

  useEffect(() => {
    if (!enabled) return undefined;
    stateRef.current = {};
    setError(null);

    const ingest = (fix) => {
      stateRef.current = trackerStep(stateRef.current, fix);
      setPosition(stateRef.current.position);
    };

    // ── Simulation ──
    if (simulateRoute) {
      const sim = createRouteSimulator(simulateRoute);
      let t = 0;
      const id = setInterval(() => {
        t += speedFactor; // 1 real second = speedFactor simulated seconds
        const fix = sim(t);
        ingest(fix);
        if (fix.done) clearInterval(id);
      }, 1000);
      return () => clearInterval(id);
    }

    // ── Real GPS ──
    if (!('geolocation' in navigator)) {
      setError('Geolocation not supported');
      return undefined;
    }
    const watchId = navigator.geolocation.watchPosition(
      (p) =>
        ingest({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
          speed: p.coords.speed, // m/s or null
          heading: p.coords.heading, // deg true, null/NaN when stationary
          altitude: p.coords.altitude, // metres (GNSS), may be null
          timestamp: p.timestamp,
        }),
      (e) => setError(e.code === 1 ? 'Location permission denied' : e.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled, simulateRoute, speedFactor]);

  return { position, error };
}
