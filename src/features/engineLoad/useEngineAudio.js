/**
 * Microphone → DSP chain → EngineLoadMonitor, 10 frames/s.
 *
 *   mic ─▶ HIGH-PASS (≈70–90 Hz, Q 0.707)   removes wind buffeting & road rumble below the engine
 *       ─▶ BAND-PASS (≈80–500 Hz car / 100–1000 Hz moto)   keeps firing frequency + low harmonics,
 *                                                         drops tyre roar (~1 kHz) and hiss
 *       ─▶ AnalyserNode (FFT 4096 → ~11.7 Hz bins at 48 kHz)
 *
 * The graph is NOT connected to ctx.destination – nothing is played back and
 * nothing is recorded or uploaded; each frame is reduced to two numbers and discarded.
 *
 * Firing frequency (4-stroke) = RPM / 60 × cylinders / 2
 *   e.g. 4-cyl car at 2500 rpm ≈ 83 Hz; parallel twin bike at 6000 rpm = 100 Hz.
 *
 * Browser processing MUST be off: AGC would normalise away exactly the loudness
 * changes we measure, and noise suppression would treat the engine as noise.
 * We use setInterval rather than requestAnimationFrame so analysis continues
 * when the map is redrawing or the display dims.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeFrame, EngineLoadMonitor } from './engineDsp.js';

const FRAME_MS = 100;

export function useEngineAudio({ speedKmh, settings, onTripUpdate }) {
  const [snap, setSnap] = useState(null);
  const [status, setStatus] = useState('off'); // off | starting | on | error
  const [error, setError] = useState(null);
  const rt = useRef({});
  const speedRef = useRef(speedKmh);
  speedRef.current = speedKmh;

  const stop = useCallback(() => {
    const r = rt.current;
    clearInterval(r.timer);
    r.stream?.getTracks().forEach((t) => t.stop());
    r.ctx?.close().catch(() => {});
    if (r.monitor) onTripUpdate?.(r.monitor.tripLitres);
    rt.current = {};
    setStatus('off');
  }, [onTripUpdate]);

  /** Call from a tap handler (browsers require a user gesture for mic + AudioContext). */
  const start = useCallback(async () => {
    try {
      setStatus('starting');
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();

      const src = ctx.createMediaStreamSource(stream);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = settings.hpHz;
      hp.Q.value = Math.SQRT1_2; // Butterworth – flat passband, no resonance bump

      // Band-pass: centre = geometric mean of the edges, Q = centre / bandwidth.
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      const centre = Math.sqrt(settings.bandLo * settings.bandHi);
      bp.frequency.value = centre;
      bp.Q.value = centre / (settings.bandHi - settings.bandLo);

      const an = ctx.createAnalyser();
      an.fftSize = 4096;
      an.smoothingTimeConstant = 0.4;
      src.connect(hp).connect(bp).connect(an);

      const bins = new Float32Array(an.frequencyBinCount);
      const binHz = ctx.sampleRate / an.fftSize;
      const monitor = new EngineLoadMonitor(settings);
      let last = performance.now();
      let tick = 0;

      const timer = setInterval(() => {
        const now = performance.now();
        const dt = (now - last) / 1000;
        last = now;
        an.getFloatFrequencyData(bins);
        const s = monitor.step(analyzeFrame(bins, binHz, settings.bandLo, settings.bandHi), speedRef.current, dt);
        if (++tick % 2 === 0) setSnap(s); // UI at 5 Hz is plenty
        if (tick % 100 === 0) onTripUpdate?.(monitor.tripLitres); // persist every ~10 s
      }, FRAME_MS);

      rt.current = { stream, ctx, timer, monitor };
      setStatus('on');
    } catch (e) {
      setStatus('error');
      setError(e.name === 'NotAllowedError' ? 'Microphone permission denied' : e.message);
    }
  }, [settings, onTripUpdate]);

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return { snap, status, error, start, stop };
}
