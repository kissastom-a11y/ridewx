/**
 * Microphone → DSP → learning / gating → EngineLoadMonitor, 10 frames/s.
 *
 *   mic ─▶ HIGH-PASS (≈70–90 Hz, Q 0.707)  removes wind buffeting & road rumble
 *        ├─▶ BAND-PASS (engine band) ─▶ AnalyserNode "engine"  → load level, centroid, flux
 *        └─▶ AnalyserNode "wide" (after high-pass only)        → 1–4 kHz voice/music energy
 *
 * Nothing is connected to the speakers, nothing is recorded or uploaded – each
 * frame is reduced to a few numbers and discarded.
 *
 * iPhone fix: Safari only lets an AudioContext run if it is created/resumed
 * synchronously inside the tap. So start() creates and resumes it BEFORE
 * awaiting the microphone permission.
 *
 * Firing frequency (4-stroke) = RPM / 60 × cylinders / 2
 *   e.g. 4-cyl car at 2500 rpm ≈ 83 Hz; parallel twin at 6000 rpm = 100 Hz.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeFrame, EngineLoadMonitor, ProfileLearner, InterferenceGate } from './engineDsp.js';
import { readJSON } from '../../lib/storage.js';

const FRAME_MS = 100;
export const LEARN_SECONDS = () => readJSON('ridewx.debug.learnS', 60);

export function useEngineAudio({ speedKmh, settings, profile, onProfile, onTripUpdate }) {
  const [snap, setSnap] = useState(null);
  const [status, setStatus] = useState('off'); // off | starting | learning | on | error
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
    setSnap(null);
  }, [onTripUpdate]);

  /** Must be called directly from a tap handler. relearn=true forces a new learning minute. */
  const start = useCallback((relearn = false) => {
    setError(null);
    setStatus('starting');
    // 1) Audio context NOW, inside the gesture (iOS).
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume().catch(() => {});

    // 2) Then ask for the microphone.
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    }).then((stream) => {
      ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(stream);

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = settings.hpHz;
      hp.Q.value = Math.SQRT1_2; // Butterworth

      // Band-pass: centre = geometric mean of the edges, Q = centre / bandwidth.
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      const centre = Math.sqrt(settings.bandLo * settings.bandHi);
      bp.frequency.value = centre;
      bp.Q.value = centre / (settings.bandHi - settings.bandLo);

      const anE = ctx.createAnalyser();
      anE.fftSize = 4096;
      anE.smoothingTimeConstant = 0.3;
      const anW = ctx.createAnalyser();
      anW.fftSize = 2048;
      anW.smoothingTimeConstant = 0.3;
      src.connect(hp);
      hp.connect(bp).connect(anE);
      hp.connect(anW);

      const binE = ctx.sampleRate / anE.fftSize;
      const binW = ctx.sampleRate / anW.fftSize;
      const e = new Float32Array(anE.frequencyBinCount);
      let prevE = null;
      const w = new Float32Array(anW.frequencyBinCount);

      const learnFrames = Math.round((LEARN_SECONDS() * 1000) / FRAME_MS);
      let learner = relearn || !profile ? new ProfileLearner(learnFrames) : null;
      let gate = learner ? null : new InterferenceGate(profile);
      const monitor = new EngineLoadMonitor({ ...settings, profile: learner ? null : profile });
      let last = performance.now();
      let tick = 0;
      let silentFrames = 0;

      const timer = setInterval(() => {
        const now = performance.now();
        const dt = (now - last) / 1000;
        last = now;
        anE.getFloatFrequencyData(e);
        anW.getFloatFrequencyData(w);

        const base = analyzeFrame(e, binE, settings.bandLo, settings.bandHi);
        // Engine-band "flux" = level jump since the last frame (dB). Per-bin flux
        // was tried and rejected: a revving engine sweeps its harmonics across
        // bins and looked like noise. Band level stays smooth while revving.
        const flux = prevE == null ? 0 : Math.abs(base.powerDb - prevE);
        prevE = base.powerDb;
        const hi = analyzeFrame(w, binW, 1000, 4000).powerDb;
        const wide = analyzeFrame(w, binW, 60, 8000).powerDb; // overall mic level for the meter
        const frame = { ...base, flux, hiDb: hi };
        silentFrames = wide < -95 ? silentFrames + 1 : 0;

        let s;
        if (learner) {
          learner.add(frame);
          s = monitor.step(frame, speedRef.current, dt, false);
          s = { ...s, phase: 'learning', progress: learner.progress };
          if (learner.done) {
            const p = learner.finish();
            onProfile?.(p);
            gate = new InterferenceGate(p);
            learner = null;
            setStatus('on');
          }
        } else {
          const g = gate.step(frame);
          s = { ...monitor.step(frame, speedRef.current, dt, g.interfering), phase: 'on', interferenceReason: g.reason };
        }
        s.micDb = wide;
        s.silent = silentFrames > 30;
        if (++tick % 2 === 0) setSnap(s); // UI at 5 Hz
        if (tick % 100 === 0) onTripUpdate?.(monitor.tripLitres);
      }, FRAME_MS);

      rt.current = { stream, ctx, timer, monitor };
      setStatus(learner ? 'learning' : 'on');
    }).catch((err) => {
      ctx.close().catch(() => {});
      setStatus('error');
      setError(err.name === 'NotAllowedError' ? 'Microphone permission denied – allow it for this site in your browser settings.' : err.message);
    });
  }, [settings, profile, onProfile, onTripUpdate]);

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return { snap, status, error, start, stop };
}
