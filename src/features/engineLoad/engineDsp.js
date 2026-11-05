/**
 * engineDsp.js – Feature 4: acoustic engine-load & fuel estimation (pure, testable).
 *
 * ───────────────────────── WHAT WE CAN AND CAN'T MEASURE ─────────────────────────
 * A phone microphone hears engine + intake + exhaust + wind + tyres. It cannot
 * measure fuel flow. What it CAN detect reliably is a CHANGE in engine acoustic
 * energy at a given road speed: opening the throttle raises cylinder pressure,
 * and intake/exhaust noise rises with it (several dB from cruise to WOT).
 *
 * ───────────────────────── THE KEY TRICK: SPEED-BINNED NOISE FLOOR ─────────────────────────
 * Everything gets louder with speed (wind ∝ V², tyre roar), so raw loudness
 * mostly measures speed, not load. We therefore keep a separate "cruise floor"
 * for each 10 km/h speed bucket and measure load as dB ABOVE that floor:
 *
 *     loadDb = bandPowerDb − floor[speedBucket]
 *
 * The floor is an asymmetric tracker – it drops quickly to quiet moments and
 * rises very slowly – so it settles on the sound of light-throttle cruising at
 * that speed. Accelerating or climbing at the same speed then shows up as
 * positive loadDb.
 *
 * ───────────────────────── FUEL MODEL ─────────────────────────
 *     L/100km (instant) = rated × f(loadDb) × correction
 *     f(loadDb)         = clamp(0.8 + 0.07·loadDb, 0.6, 2.2)
 * `rated` = the vehicle's typical mixed consumption (user setting).
 * `correction` is learned from real fill-ups (full tank → full tank):
 *     correction ← correction × (litresActual / litresEstimated)   (blended 50 %)
 * After 2–3 fill-ups the trip estimate converges on your real consumption;
 * the acoustic part only redistributes it toward hard-throttle moments.
 * When stopped (< 3 km/h) we integrate idle burn in L/h instead.
 *
 * ───────────────────────── LEARNING + INTERFERENCE GATE ─────────────────────────
 * For the first ~60 s we learn what YOUR engine sounds like in this mount:
 *   - its level, and how STEADY its level is frame-to-frame (level jumps)
 *   - how much energy sits in the 1–4 kHz "voice/music" band relative to the
 *     engine band (hiRatio)
 * Afterwards each 100 ms frame is checked against that profile:
 *   - flux far above normal  → something changing fast: speech syllables, music
 *     notes/beats, wind gusts, a horn → interference
 *   - RHYTHM in the 1–4 kHz band: music notes/beats and speech syllables make the
 *     band's level JUMP several dB, several times per second. An engine – even
 *     while revving – changes smoothly, and a throttle blip is a single step.
 *     (Tested: checking the LEVEL of 1–4 kHz instead wrongly flagged wide-open
 *     throttle as music, because a working engine gets brighter too.)
 * A frame is "suspicious" if either test fires; interference is declared when
 * ≥ 3 of the last 15 frames (1.5 s) are suspicious, which a single throttle
 * step or gear change can't reach.
 * While interference is present the load reading is FROZEN (no false red from
 * the radio) and resumes 1 s after it clears. Engine acceleration is slow
 * compared with 100 ms frames (harmonics move < 1 FFT bin per frame), so it
 * doesn't trip the flux test.
 */

export const DEFAULTS = {
  car: { label: 'Car', hpHz: 70, bandLo: 80, bandHi: 500, ratedL100: 7.5, idleLph: 0.8 },
  moto: { label: 'Motorcycle', hpHz: 90, bandLo: 100, bandHi: 1000, ratedL100: 4.5, idleLph: 0.35 },
};

export const LOAD_THRESHOLDS = { orange: 3.5, red: 8.5, hysteresis: 1 }; // dB above cruise floor

const SPEED_BUCKET = 10; // km/h
const FLOOR_DOWN = 0.3; // per frame, fast toward quieter
const FLOOR_UP = 0.004; // per frame, slow toward louder (~25 s at 10 Hz)
const FLOOR_WARMUP = 0.1; // per frame while a new speed bucket is being learned
const SMOOTH = 0.2; // EMA for loadDb (~0.5 s at 10 Hz)
const WARMUP_FRAMES = 50; // ~5 s of audio before we trust a bucket

/**
 * Band power from AnalyserNode.getFloatFrequencyData() (dBFS per bin).
 * Convert each bin to linear power, sum over [lo, hi] Hz, back to dB.
 * (Averaging dB values directly would under-weight the loud harmonics.)
 * Also returns the spectral centroid Σf·P/ΣP – it rises with engine RPM.
 */
export function analyzeFrame(dbBins, binHz, lo, hi) {
  const i0 = Math.max(1, Math.floor(lo / binHz));
  const i1 = Math.min(dbBins.length - 1, Math.ceil(hi / binHz));
  let p = 0;
  let fp = 0;
  for (let i = i0; i <= i1; i++) {
    const db = dbBins[i];
    if (!Number.isFinite(db)) continue;
    const lin = 10 ** (db / 10);
    p += lin;
    fp += lin * i * binHz;
  }
  return { powerDb: p > 0 ? 10 * Math.log10(p) : -120, centroidHz: p > 0 ? fp / p : 0 };
}

/**
 * Spectral flux: mean absolute dB change per bin between consecutive frames,
 * over [i0, i1]. Bins are floored at −100 dB so silence ↔ silence counts as 0.
 */
export function spectralFlux(prev, cur, i0, i1) {
  if (!prev) return 0;
  let sum = 0;
  let n = 0;
  for (let i = i0; i <= i1; i++) {
    const a = Number.isFinite(prev[i]) ? Math.max(prev[i], -100) : -100;
    const b = Number.isFinite(cur[i]) ? Math.max(cur[i], -100) : -100;
    sum += Math.abs(b - a);
    n++;
  }
  return n ? sum / n : 0;
}

const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : 0;
};
const meanStd = (arr) => {
  const m = arr.reduce((s, x) => s + x, 0) / Math.max(arr.length, 1);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(arr.length, 1);
  return [m, Math.sqrt(v)];
};

/** Collects frames during the learning minute and produces the engine profile. */
export class ProfileLearner {
  constructor(frames) {
    this.target = frames;
    this.power = [];
    this.flux = [];
    this.hiJump = [];
    this.lastHi = null;
    this.centroid = [];
  }
  add(f) {
    this.power.push(f.powerDb);
    this.flux.push(f.flux);
    if (this.lastHi != null) this.hiJump.push(Math.abs(f.hiDb - this.lastHi));
    this.lastHi = f.hiDb;
    this.centroid.push(f.centroidHz);
  }
  get progress() { return Math.min(1, this.power.length / this.target); }
  get done() { return this.power.length >= this.target; }
  /** Robust stats: drop the noisiest 10 % (a door slam, a word) before computing spread. */
  finish() {
    const trim = (a) => [...a].sort((x, y) => x - y).slice(0, Math.max(1, Math.floor(a.length * 0.9)));
    const [fluxMean, fluxStd] = meanStd(trim(this.flux));
    const [jumpMean, jumpStd] = meanStd(trim(this.hiJump.length ? this.hiJump : [0]));
    return {
      levelDb: median(this.power),
      fluxMean,
      fluxStd: Math.max(fluxStd, 0.4),
      jumpMean,
      jumpStd: Math.max(jumpStd, 0.5),
      centroidHz: median(this.centroid),
      learnedAt: Date.now(),
    };
  }
}

/** Per-frame interference test: ≥ 3 suspicious frames in the last 15 (1.5 s) → interference; holds 1 s. */
export class InterferenceGate {
  constructor(profile) {
    this.p = profile;
    this.hist = [];
    this.lastHi = null;
    this.hold = 0;
    this.voiceVotes = 0;
  }
  step(f) {
    const jump = this.lastHi == null ? 0 : Math.abs(f.hiDb - this.lastHi);
    this.lastHi = f.hiDb;
    const jumpThr = Math.max(4, this.p.jumpMean + 4 * this.p.jumpStd);
    const rhythm = jump > jumpThr;
    const fluxy = f.flux > 3 && (f.flux - this.p.fluxMean) / this.p.fluxStd > 4; // engine-band level jump
    this.hist.push(rhythm ? 'v' : fluxy ? 'n' : '');
    if (this.hist.length > 15) this.hist.shift();
    const flagged = this.hist.filter(Boolean);
    if (flagged.length >= 3) {
      this.hold = 10;
      this.voiceVotes = flagged.filter((x) => x === 'v').length >= flagged.length / 2 ? 1 : 0;
    } else if (this.hold > 0) this.hold--;
    return { interfering: this.hold > 0, reason: this.voiceVotes ? 'voice' : 'noise' };
  }
}

export function loadFactor(loadDb) {
  return Math.min(2.2, Math.max(0.6, 0.8 + 0.07 * loadDb));
}

/** Combines floor tracking, smoothing, 3-state classification and fuel integration. */
export class EngineLoadMonitor {
  constructor({ ratedL100, idleLph, correction = 1, profile = null }) {
    this.ratedL100 = ratedL100;
    this.idleLph = idleLph;
    this.correction = correction;
    this.floors = new Map(); // bucket → { floor, n }
    this.profileLevel = profile?.levelDb ?? null;
    this.loadDb = 0;
    this.state = 'green';
    this.tripLitres = 0;
    this.tripKm = 0;
  }

  _floorFor(bucket, x) {
    let f = this.floors.get(bucket);
    if (!f) {
      // New speed bucket: start from the nearest known bucket, else from this sample.
      let best = null;
      for (const [b, v] of this.floors) if (best == null || Math.abs(b - bucket) < Math.abs(best[0] - bucket)) best = [b, v];
      f = { floor: best ? best[1].floor : (this.profileLevel ?? x), n: 0 };
      this.floors.set(bucket, f);
    }
    // During a bucket's warm-up we learn its level quickly in both directions;
    // afterwards the floor only creeps up, so sustained throttle isn't absorbed.
    const up = f.n < WARMUP_FRAMES ? FLOOR_WARMUP : FLOOR_UP;
    f.floor += (x < f.floor ? FLOOR_DOWN : up) * (x - f.floor);
    f.n++;
    return f;
  }

  _classify(l) {
    const { orange, red, hysteresis: h } = LOAD_THRESHOLDS;
    const s = this.state;
    if (s === 'red') return l < red - h ? (l < orange - h ? 'green' : 'orange') : 'red';
    if (s === 'orange') return l >= red ? 'red' : l < orange - h ? 'green' : 'orange';
    return l >= red ? 'red' : l >= orange ? 'orange' : 'green';
  }

  /**
   * @param frame     { powerDb, centroidHz }
   * @param speedKmh  GPS ground speed, or null if unknown
   * @param dtS       seconds since the previous frame
   */
  step(frame, speedKmh, dtS, interfering = false) {
    const v = speedKmh ?? 0;
    const bucket = speedKmh == null ? -1 : Math.floor(v / SPEED_BUCKET);
    let calibrating = false;
    if (!interfering) {
      // Only clean frames teach the floor and move the reading.
      const f = this._floorFor(bucket, frame.powerDb);
      const raw = Math.max(0, frame.powerDb - f.floor);
      this.loadDb += SMOOTH * (raw - this.loadDb);
      calibrating = f.n < WARMUP_FRAMES;
      if (!calibrating) this.state = this._classify(this.loadDb);
    } else {
      calibrating = (this.floors.get(bucket)?.n ?? 0) < WARMUP_FRAMES;
    }

    const fac = loadFactor(calibrating ? 0 : this.loadDb) * this.correction;
    let instL100 = null;
    let instLph = null;
    if (speedKmh != null && v >= 3) {
      instL100 = this.ratedL100 * fac;
      const km = (v * dtS) / 3600;
      this.tripKm += km;
      this.tripLitres += (instL100 / 100) * km;
    } else if (speedKmh != null) {
      instLph = this.idleLph * fac;
      this.tripLitres += (instLph * dtS) / 3600;
    }

    return {
      state: this.state,
      calibrating,
      interfering,
      loadDb: this.loadDb,
      powerDb: frame.powerDb,
      centroidHz: frame.centroidHz,
      instL100,
      instLph,
      tripLitres: this.tripLitres,
      tripKm: this.tripKm,
      avgL100: this.tripKm > 0.5 ? (this.tripLitres / this.tripKm) * 100 : null,
    };
  }
}

/** Fill-up calibration: blend 50 % toward the observed ratio, bounded to a sane range. */
export function updateCorrection(correction, litresActual, litresEstimated) {
  if (!(litresActual > 0) || !(litresEstimated > 0.5)) return correction;
  const target = correction * (litresActual / litresEstimated);
  return Math.min(3, Math.max(0.33, correction + 0.5 * (target - correction)));
}
