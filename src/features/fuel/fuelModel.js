/**
 * fuelModel.js – physics-based fuel consumption (pure, unit-tested).
 *
 * ───────────────────────── 1. ROAD-LOAD POWER ─────────────────────────
 * The power at the wheels needed to move the vehicle right now:
 *
 *   F_roll  = m·g·Crr·cos θ                      rolling resistance
 *   F_aero  = ½·ρ·CdA·v_air·|v_air|              aerodynamic drag, v_air = v + headwind
 *   F_grade = m·g·sin θ                          climbing (negative downhill)
 *   F_acc   = k_rot·m·a                          accelerating (k_rot ≈ 1.05 for spinning parts)
 *   P_wheel = (F_roll + F_aero + F_grade + F_acc) · v
 *
 * θ comes from the route's elevation profile (or GPS altitude off-route),
 * a from the change in GPS speed, headwind from live Open-Meteo wind resolved
 * along your heading (the same aviation-style maths as the crosswind arrows),
 * and ρ (air density) from temperature and altitude – thin, warm air = less drag:
 *   ρ = 1.225 · (288.15 / T[K]) · exp(−h / 8434 m)
 *
 * ───────────────────────── 2. POWER → FUEL (Willans line) ─────────────────────────
 * Engine fuel use is well approximated by a straight line in output power:
 *   fuel [L/h] = idle [L/h] + (P_wheel/η_drivetrain + P_accessories) · 3.6 / (η_engine · LHV)
 * LHV (energy per litre): petrol ≈ 32.3 MJ/L, diesel ≈ 35.9 MJ/L.
 * η_engine (marginal efficiency): car petrol ~0.30, diesel ~0.36, motorcycle ~0.27.
 *
 * Overrun: when P_wheel < 0 (coasting down a hill / decelerating in gear) modern
 * injection cuts fuel completely above ~20 km/h → 0 L/h; below that, idle.
 *
 * ───────────────────────── 3. WHAT THE SENSORS ADD ─────────────────────────
 *   - Engine sound / vibration at heavy load (wide-open throttle) → mixture
 *     enrichment: up to +20 % on top of the physics.
 *   - Vibration at a standstill → engine idling vs. switched off (start-stop):
 *     idle fuel only counts if the engine is actually running.
 *   - Fill-ups → a personal correction factor (tyres, load, your engine).
 *
 * Sanity check (unit tests): compact petrol car 90 km/h flat ≈ 5.4 L/100,
 * 130 km/h ≈ 8 L/100; naked motorcycle 90 km/h ≈ 3.8 L/100.
 */

export const G = 9.81;
export const LHV_MJ_PER_L = { petrol: 32.3, diesel: 35.9 };

export function airDensity(tempC = 15, altitudeM = 0) {
  return 1.225 * (288.15 / (tempC + 273.15)) * Math.exp(-(altitudeM || 0) / 8434);
}

/**
 * @param v  {{massKg, CdA, Crr, fuel, etaEngine, etaDrive, accKw, idleLph}}  vehicle
 * @param s  {{speedKmh, accelMs2, grade, headwindKmh, tempC, altitudeM, engineOn, loadDb}}  state
 * @returns {{ lph, l100, powerKw, parts: {roll, aero, grade, accel} (kW, ≥0 parts only), overrun }}
 */
export function fuelRate(v, s) {
  const speed = Math.max(0, (s.speedKmh || 0) / 3.6);
  const theta = Math.atan(s.grade || 0);
  const rho = airDensity(s.tempC ?? 15, s.altitudeM ?? 0);
  const vAir = speed + (s.headwindKmh || 0) / 3.6;

  const fRoll = v.massKg * G * v.Crr * Math.cos(theta);
  const fAero = 0.5 * rho * v.CdA * vAir * Math.abs(vAir);
  const fGrade = v.massKg * G * Math.sin(theta);
  const fAcc = 1.05 * v.massKg * (s.accelMs2 || 0);
  const pWheel = (fRoll + fAero + fGrade + fAcc) * speed; // W

  const kw = (f) => (f * speed) / 1000;
  const parts = { roll: kw(fRoll), aero: Math.max(0, kw(fAero)), grade: Math.max(0, kw(fGrade)), accel: Math.max(0, kw(fAcc)) };

  const running = s.engineOn !== false;
  let lph;
  let overrun = false;
  if (speed < 0.8) {
    lph = running ? v.idleLph : 0; // stopped: idling, or engine off (start-stop)
  } else if (pWheel <= 0) {
    overrun = true;
    lph = s.speedKmh > 20 ? 0 : v.idleLph; // fuel cut-off on overrun
  } else {
    const pEngineKw = pWheel / 1000 / v.etaDrive + v.accKw;
    lph = v.idleLph + (pEngineKw * 3.6) / (v.etaEngine * LHV_MJ_PER_L[v.fuel]);
    // Heavy load heard/felt → rich mixture: +0 % below 6 dB over cruise, rising to +20 %.
    if (s.loadDb != null) lph *= 1 + Math.min(0.2, Math.max(0, s.loadDb - 6) * 0.033);
  }
  const l100 = s.speedKmh >= 3 ? (lph / s.speedKmh) * 100 : null;
  return { lph, l100, powerKw: pWheel / 1000, parts, overrun };
}

/** Grade (rise/run) at an along-route distance from a ~1 km elevation profile. */
export function gradeAt(profile, d, halfM = 500) {
  const pts = (profile || []).filter((p) => p.elev != null);
  if (pts.length < 2 || d == null) return 0;
  const elevAt = (x) => {
    if (x <= pts[0].distM) return pts[0].elev;
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i].distM) {
        const f = (x - pts[i - 1].distM) / (pts[i].distM - pts[i - 1].distM || 1);
        return pts[i - 1].elev + f * (pts[i].elev - pts[i - 1].elev);
      }
    }
    return pts[pts.length - 1].elev;
  };
  const g = (elevAt(d + halfM) - elevAt(d - halfM)) / (2 * halfM);
  return Math.max(-0.15, Math.min(0.15, g)); // clamp DEM noise to ±15 %
}

/** Fill-up calibration: move halfway toward the observed ratio, bounded. */
export function updateCorrection(correction, litresActual, litresEstimated) {
  if (!(litresActual > 0) || !(litresEstimated > 0.5)) return correction;
  const target = correction * (litresActual / litresEstimated);
  return Math.min(2, Math.max(0.5, correction + 0.5 * (target - correction)));
}
