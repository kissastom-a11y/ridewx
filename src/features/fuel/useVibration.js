/**
 * Engine vibration from the phone's accelerometer (DeviceMotionEvent).
 *
 * What browsers give us: acceleration samples at ~60 Hz (iOS/Android). Engine
 * firing frequencies (25–300 Hz) are above the 30 Hz Nyquist limit, so we can't
 * read RPM – but the vibration INTENSITY still arrives (aliased into the band we
 * can see), and that's what we use:
 *
 *   1. Remove gravity / slow motion: per-axis high-pass (subtract a 0.2 s moving mean).
 *   2. RMS of the 3-axis magnitude over the last second  → "how much is it shaking".
 *   3. Engine ON/OFF at a standstill: RMS above the phone's own noise floor
 *      (≈0.01–0.02 m/s²) → idling; flat → engine off (start-stop / parked).
 *   4. Load channel: dB above a per-speed-band floor (same trick as the
 *      microphone: road roughness grows with speed, so compare like with like).
 *      Used as a back-up when the microphone is paused by music or voices.
 *
 * iOS needs DeviceMotionEvent.requestPermission() from a tap – call
 * requestMotionPermission() in the Start-ride handler.
 */
import { useEffect, useRef, useState } from 'react';

export const ENGINE_ON_RMS = 0.035; // m/s² – above typical phone sensor noise

export async function requestMotionPermission() {
  const DME = window.DeviceMotionEvent;
  if (DME && typeof DME.requestPermission === 'function') {
    try { return (await DME.requestPermission()) === 'granted'; } catch { return false; }
  }
  return true;
}

/** Pure helper (tested): RMS of high-passed 3-axis samples. */
export function vibrationRms(samples, hpWindow = 12) {
  if (samples.length < hpWindow + 2) return null;
  let sum = 0;
  let n = 0;
  for (let i = hpWindow; i < samples.length; i++) {
    const m = [0, 0, 0];
    for (let k = i - hpWindow; k < i; k++) for (let a = 0; a < 3; a++) m[a] += samples[k][a] / hpWindow;
    const dx = samples[i][0] - m[0];
    const dy = samples[i][1] - m[1];
    const dz = samples[i][2] - m[2];
    sum += dx * dx + dy * dy + dz * dz;
    n++;
  }
  return Math.sqrt(sum / n);
}

export function useVibration(enabled, speedKmh) {
  const [vib, setVib] = useState(null);
  const buf = useRef([]);
  const floors = useRef(new Map());
  const speedRef = useRef(speedKmh);
  speedRef.current = speedKmh;

  useEffect(() => {
    if (!enabled || !('DeviceMotionEvent' in window)) return undefined;
    let got = false;
    const onMotion = (e) => {
      const a = e.acceleration?.x != null ? e.acceleration : e.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      got = true;
      buf.current.push([a.x, a.y, a.z]);
      if (buf.current.length > 90) buf.current.shift(); // ~1.5 s at 60 Hz
    };
    window.addEventListener('devicemotion', onMotion);

    const timer = setInterval(() => {
      if (!got) { setVib({ available: false }); return; }
      const rms = vibrationRms(buf.current);
      if (rms == null) return;
      const db = 20 * Math.log10(Math.max(rms, 1e-4));
      // Per-speed-band floor (fast down, slow up) → load in dB above "normal shaking".
      const bucket = Math.floor((speedRef.current || 0) / 10);
      let f = floors.current.get(bucket);
      if (f == null) f = db;
      f += (db < f ? 0.3 : 0.01) * (db - f);
      floors.current.set(bucket, f);
      setVib({
        available: true,
        rms,
        db,
        loadDb: Math.max(0, db - f),
        engineOn: rms >= ENGINE_ON_RMS,
      });
    }, 500);

    return () => {
      window.removeEventListener('devicemotion', onMotion);
      clearInterval(timer);
      buf.current = [];
    };
  }, [enabled]);

  return vib;
}
