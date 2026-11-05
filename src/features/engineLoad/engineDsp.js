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

export function loadFactor(loadDb) {
  return Math.min(2.2, Math.max(0.6, 0.8 + 0.07 * loadDb));
}

/** Combines floor tracking, smoothing, 3-state classification and fuel integration. */
export class EngineLoadMonitor {
  constructor({ ratedL100, idleLph, correction = 1 }) {
    this.ratedL100 = ratedL100;
    this.idleLph = idleLph;
    this.correction = correction;
    this.floors = new Map(); // bucket → { floor, n }
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
      f = { floor: best ? best[1].floor : x, n: 0 };
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
  step(frame, speedKmh, dtS) {
    const v = speedKmh ?? 0;
    const bucket = speedKmh == null ? -1 : Math.floor(v / SPEED_BUCKET);
    const f = this._floorFor(bucket, frame.powerDb);
    const raw = Math.max(0, frame.powerDb - f.floor);
    this.loadDb += SMOOTH * (raw - this.loadDb);
    const calibrating = f.n < WARMUP_FRAMES;
    if (!calibrating) this.state = this._classify(this.loadDb);

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
