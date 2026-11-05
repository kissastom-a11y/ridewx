/**
 * Current speed limit:
 *   on the planned route → from the route's OpenStreetMap limits (no extra requests)
 *   no route / off route → live lookup around you, refreshed every ~250 m or 30 s
 * Speeding warning (Greek voice) when speed > limit + max(3, 5 %): once when it
 * starts, again every 45 s if it continues, and immediately on a new lower limit.
 */
import { useEffect, useRef, useState } from 'react';
import { speedLimitAt, fetchLiveLimit } from '../../services/speedLimit.js';
import { haversine } from '../../lib/geo.js';
import { say, GR } from '../../lib/voice.js';

export function useSpeedLimit({ riding, position, heading, progress, ranges, muted }) {
  const [live, setLive] = useState(null);
  const last = useRef(null);
  const busy = useRef(false);
  const warned = useRef({ limit: null, t: 0 });

  const routeLimit = progress != null ? speedLimitAt(ranges, progress) : null;

  // Live lookup when the route can't tell us.
  useEffect(() => {
    if (!riding || !position || routeLimit || busy.current) return;
    const l = last.current;
    const due = !l || Date.now() - l.t > 30000 || haversine(l.lat, l.lon, position.lat, position.lon) > 250;
    if (!due || position.speedKmh < 5) return;
    busy.current = true;
    last.current = { lat: position.lat, lon: position.lon, t: Date.now() };
    fetchLiveLimit(position.lat, position.lon, heading)
      .then(setLive)
      .catch(() => {})
      .finally(() => { busy.current = false; });
  }, [riding, position, heading, routeLimit]);

  const limit = routeLimit || live;
  const speed = position?.speedKmh ?? 0;
  const over = !!limit && speed > limit.kmh + Math.max(3, limit.kmh * 0.05);

  useEffect(() => {
    if (!riding || !over || muted) return;
    const w = warned.current;
    const now = Date.now();
    if (w.limit !== limit.kmh || now - w.t > 45000) {
      warned.current = { limit: limit.kmh, t: now };
      say(GR.speeding(limit.kmh), { urgent: true });
    }
  }, [riding, over, limit?.kmh, muted]); // eslint-disable-line react-hooks/exhaustive-deps

  return { limit, speed, over };
}
