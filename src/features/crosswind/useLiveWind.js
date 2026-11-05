/**
 * Live wind for the rider's current position.
 * Re-fetches only when it would actually change: moved > 5 km (model grid is
 * ~1–2 km for ICON-D2/AROME, but wind fields are smooth) or > 10 min elapsed
 * (Open-Meteo `current` updates every 15 min). That's ≈ 6–12 requests/hour –
 * well inside the free limit (10 000/day).
 */
import { useEffect, useRef, useState } from 'react';
import { fetchCurrentWind } from '../../services/openMeteo.js';
import { haversine } from '../../lib/geo.js';

const REFETCH_DISTANCE_M = 5000;
const REFETCH_MS = 10 * 60 * 1000;

export function useLiveWind(position) {
  const [wind, setWind] = useState(null);
  const last = useRef(null); // { lat, lon, t }
  const inFlight = useRef(false);

  useEffect(() => {
    if (!position || inFlight.current) return;
    const now = Date.now();
    const l = last.current;
    const stale = !l || now - l.t > REFETCH_MS || haversine(l.lat, l.lon, position.lat, position.lon) > REFETCH_DISTANCE_M;
    if (!stale) return;

    inFlight.current = true;
    last.current = { lat: position.lat, lon: position.lon, t: now };
    fetchCurrentWind(position.lat, position.lon)
      .then(setWind)
      .catch(() => { last.current = null; }) // retry on the next fix
      .finally(() => { inFlight.current = false; });
  }, [position]);

  return wind;
}
