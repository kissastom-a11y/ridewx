/**
 * Live fuel integration, once per GPS fix.
 *
 * Inputs per fix:
 *   speed (GPS) · acceleration = Δspeed/Δt, smoothed over ~2 s (GPS speed is noisy)
 *   grade  = route elevation profile at your position, or GPS altitude change off-route
 *   headwind = live wind resolved along your heading · temperature & altitude → air density
 *   engine load = microphone (or vibration while the mic is paused by music/voices)
 *   engine on/off at a standstill = vibration
 * Integrates litres and km, and splits the fuel into where it went:
 *   rolling · air (incl. wind) · climbing · accelerating · idling
 */
import { useEffect, useRef, useState } from 'react';
import { fuelRate, gradeAt } from './fuelModel.js';

const EMPTY = { tripL: 0, tripKm: 0, parts: { roll: 0, aero: 0, grade: 0, accel: 0, idle: 0 } };

export function useFuel({ riding, position, vehicle, correction = 1, progress, profile, headwindKmh, tempC, engineSnap, vib }) {
  const [out, setOut] = useState(null);
  const st = useRef({ ...EMPTY, last: null, accel: 0, alt: null, grade: 0 });

  useEffect(() => {
    if (riding) st.current = { ...EMPTY, parts: { ...EMPTY.parts }, last: null, accel: 0, alt: null, grade: 0 };
  }, [riding]);

  useEffect(() => {
    if (!riding || !position || !vehicle) return;
    const s = st.current;
    const t = position.timestamp || Date.now();
    const v = position.speedKmh || 0;
    const dt = s.last ? Math.min(5, Math.max(0, (t - s.last.t) / 1000)) : 0;

    // Acceleration (m/s²), smoothed.
    if (s.last && dt > 0.2) {
      const a = (v - s.last.v) / 3.6 / dt;
      s.accel += 0.35 * (Math.max(-6, Math.min(6, a)) - s.accel);
    }
    // Grade: route profile if we're on it, else GPS altitude trend.
    let grade = 0;
    if (progress != null && profile?.length) grade = gradeAt(profile, progress);
    else if (position.altitude != null && s.last?.alt != null && dt > 0.2 && v > 10) {
      const run = (v / 3.6) * dt;
      const g = (position.altitude - s.last.alt) / run;
      s.grade += 0.15 * (Math.max(-0.12, Math.min(0.12, g)) - s.grade);
      grade = s.grade;
    }
    const altitude = position.altitude ?? null;

    // Engine load: mic first; vibration when the mic is held (music/voices) or not running.
    let loadDb = null;
    let loadSrc = 'physics';
    if (engineSnap && engineSnap.phase === 'on' && !engineSnap.calibrating && !engineSnap.interfering) {
      loadDb = engineSnap.loadDb; loadSrc = 'sound';
    } else if (vib?.available) {
      loadDb = vib.loadDb; loadSrc = 'vibration';
    }
    const engineOn = vib?.available ? vib.engineOn : true;

    const r = fuelRate(vehicle, { speedKmh: v, accelMs2: s.accel, grade, headwindKmh: headwindKmh || 0, tempC, altitudeM: altitude, engineOn, loadDb });
    const lph = r.lph * correction;

    if (dt > 0) {
      const litres = (lph * dt) / 3600;
      s.tripL += litres;
      s.tripKm += (v * dt) / 3600;
      // Where did this fuel go? Idle share first, the rest split by power demand.
      const idleL = v < 3 || r.overrun ? litres : Math.min(litres, (vehicle.idleLph * correction * dt) / 3600);
      s.parts.idle += idleL;
      const rest = litres - idleL;
      const sum = r.parts.roll + r.parts.aero + r.parts.grade + r.parts.accel;
      if (rest > 0 && sum > 0) for (const k of ['roll', 'aero', 'grade', 'accel']) s.parts[k] += (rest * r.parts[k]) / sum;
    }
    s.last = { t, v, alt: position.altitude };

    setOut({
      lph,
      l100: r.l100 != null ? r.l100 * correction : null,
      overrun: r.overrun,
      tripL: s.tripL,
      tripKm: s.tripKm,
      avgL100: s.tripKm > 0.3 ? (s.tripL / s.tripKm) * 100 : null,
      parts: { ...s.parts },
      inputs: { grade, accel: s.accel, headwindKmh: headwindKmh || 0, loadSrc, engineOn },
    });
  }, [riding, position]); // eslint-disable-line react-hooks/exhaustive-deps

  return out;
}
