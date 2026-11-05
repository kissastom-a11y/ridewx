/**
 * Instant heading from the phone's magnetometer (like maps apps), ~15 updates/s.
 *
 * Sources:
 *   iOS Safari   : DeviceOrientationEvent.webkitCompassHeading – degrees MAGNETIC,
 *                  clockwise from north. Needs DeviceOrientationEvent.requestPermission()
 *                  called from a tap → use requestCompassPermission() in a click handler.
 *   Android/Chrome: 'deviceorientationabsolute' – alpha is counter-clockwise from north,
 *                  so heading = 360 − alpha.
 * Both report where the TOP of the phone points; we add the screen rotation so
 * landscape mounts work too.
 *
 * Magnetic → true: true = magnetic + declination (east positive). Greece ≈ +5°;
 * GPS course and Open-Meteo wind are TRUE, so we convert here once.
 * (Declination changes slowly, ~0.1°/year – a constant is fine for one country.)
 *
 * Smoothing: circular EMA (see gpsTracker.smoothHeading) with α=0.35 – removes
 * magnetometer jitter while keeping ~100 ms response.
 */
import { useEffect, useRef, useState } from 'react';
import { smoothHeading } from '../lib/gpsTracker.js';
import { normalize360 } from '../lib/geo.js';

export const DECLINATION_DEG = 5;
const MIN_INTERVAL_MS = 66; // ≈15 Hz React updates

export async function requestCompassPermission() {
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    try { return (await DOE.requestPermission()) === 'granted'; } catch { return false; }
  }
  return true; // Android / desktop: no prompt needed
}

export function useCompass(enabled = true) {
  const [heading, setHeading] = useState(null);
  const smooth = useRef(null);
  const last = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const screenAngle = () => (screen.orientation?.angle ?? window.orientation ?? 0);

    const handle = (e) => {
      let mag = null;
      if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
        mag = e.webkitCompassHeading; // iOS – already compensated for screen-up orientation
      } else if (e.absolute && typeof e.alpha === 'number') {
        mag = 360 - e.alpha;
      } else {
        return;
      }
      const h = normalize360(mag + screenAngle() + DECLINATION_DEG);
      smooth.current = smoothHeading(smooth.current, h, 0.35);
      const now = performance.now();
      if (now - last.current >= MIN_INTERVAL_MS) {
        last.current = now;
        setHeading(smooth.current);
      }
    };

    const evt = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(evt, handle, true);
    return () => window.removeEventListener(evt, handle, true);
  }, [enabled]);

  return heading;
}

/**
 * Which heading to trust:
 *   moving ≥ 15 km/h with a GNSS course → GPS (direction of TRAVEL; immune to how
 *       the phone sits in the mount and to magnetic disturbance from the engine/frame)
 *   otherwise → compass (instant, works standing still)
 *   no compass → whatever GPS/derived heading we have
 */
export function fuseHeading(position, compass) {
  const gpsOk = position && position.heading != null && (position.headingSource === 'gnss' || position.headingSource === 'derived') && position.speedKmh >= 15;
  if (gpsOk) return { heading: position.heading, source: 'gps' };
  if (compass != null) return { heading: compass, source: 'compass' };
  if (position?.heading != null) return { heading: position.heading, source: position.headingSource };
  return { heading: null, source: 'none' };
}
