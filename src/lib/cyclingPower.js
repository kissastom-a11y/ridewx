/**
 * cyclingPower.js – road-cycling power model, pacing solver and live estimator.
 * Pure functions, no React – unit-tested in tests/cycling.test.js.
 *
 * ───────────────────────── THE POWER BALANCE ─────────────────────────
 * At the crank the rider delivers P. After drivetrain losses (η ≈ 0.97–0.98)
 * the wheel pushes the bike with F_prop = η·P / v. It works against:
 *
 *   F_aero = ½ · ρ · CdA · Va · (v + H)        apparent wind, axial part
 *   F_roll = Crr · m · g · cos θ               tyres on the road
 *   F_grav = m · g · sin θ                     the slope (θ = atan(grade))
 *   F_acc  = (m + I/r²) · a                    speeding up / slowing down
 *
 *   H  = headwind component at rider height (+ against, − tail)
 *   X  = crosswind component, Va = √((v+H)² + X²)
 *   ρ  = air density from temperature, pressure and humidity
 *
 * so  P = (F_aero + F_roll + F_grav + F_acc) · v / η.
 *
 * Going DOWNHILL F_grav is negative: the slope pushes you. Above the speed
 * where the slope alone balances aero + rolling the rider can't add much
 * (spin-out / tuck), so the model stops pedalling above `maxPedalKmh` and
 * brakes above `maxDescentKmh`. Kinetic energy is carried between pieces,
 * so a descent "fires" you into the next short rise exactly like on the road.
 *
 * ───────────────────────── WIND AT RIDER HEIGHT ─────────────────────────
 * Forecast wind is at 10 m. Near the ground it is slower (log wind profile):
 *     U(z) = U10 · ln(z/z0) / ln(10/z0)
 * z0 = surface roughness: open sea/coast 0.01 m, farmland 0.05 m, suburbs
 * with trees/walls 0.3 m. At z ≈ 1.2 m on farmland the rider gets ~60 % of U10.
 */

export const G = 9.80665;

/** Air density (kg/m³) – moist air: dry-air + water-vapour partial pressures. */
export function airDensity({ tempC = 15, pressureHpa = 1013.25, humidity = 50 } = {}) {
  const T = tempC + 273.15;
  const es = 6.1078 * 10 ** ((7.5 * tempC) / (tempC + 237.3)); // saturation vapour pressure, hPa (Tetens)
  const pv = (Math.max(0, Math.min(100, humidity)) / 100) * es * 100; // Pa
  const pd = pressureHpa * 100 - pv;
  return pd / (287.058 * T) + pv / (461.495 * T);
}

/** Pressure at altitude from pressure at a reference altitude (barometric formula, standard lapse). */
export function pressureAtAltitude(refHpa, refAltM, altM) {
  const k = (h) => (1 - 2.25577e-5 * h) ** 5.25588;
  return (refHpa * k(altM)) / k(refAltM);
}

/** Riding positions: CdA ≈ body surface area × k. Calibrated so 178 cm / 75 kg on the hoods ≈ 0.33 m². */
export const POSITIONS = {
  tops: { label: 'Όρθιος / πάνω λαβές', k: 0.2 },
  hoods: { label: 'Χειρολαβές (hoods)', k: 0.172 },
  drops: { label: 'Κάτω λαβές (drops)', k: 0.155 },
  aero: { label: 'Aero (πήχεις στο τιμόνι)', k: 0.145 },
};

/** Du Bois body surface area (m²). */
export const bodySurfaceArea = (heightCm, massKg) => 0.007184 * heightCm ** 0.725 * massKg ** 0.425;

export function estimateCdA({ heightCm, massKg, position = 'hoods', aeroFactor = 1 }) {
  return bodySurfaceArea(heightCm, massKg) * (POSITIONS[position]?.k ?? POSITIONS.hoods.k) * aeroFactor;
}

/** Wind exposure presets (roughness length z0, metres). */
export const EXPOSURE = {
  open: { label: 'Ανοιχτό / παραλιακό', z0: 0.01 },
  rural: { label: 'Αγροτικό / χωράφια', z0: 0.05 },
  suburban: { label: 'Προάστιο / δέντρα / τοίχοι', z0: 0.3 },
};

export function windAtRiderHeight(u10, z0 = 0.05, z = 1.2) {
  return (u10 * Math.log(z / z0)) / Math.log(10 / z0);
}

/**
 * Head/cross components (m/s) of a wind blowing FROM `windFromDeg` for a rider
 * travelling on `courseDeg` (both degrees true). + head = against, + cross = from right.
 */
export function windComponentsMs(speedMs, windFromDeg, courseDeg) {
  const th = ((windFromDeg - courseDeg) * Math.PI) / 180;
  return { head: speedMs * Math.cos(th), cross: speedMs * Math.sin(th) };
}

/** Resistive forces (N) at ground speed v (m/s). */
export function forces(v, { grade = 0, mass, cda, crr, rho, head = 0, cross = 0, accel = 0, inertiaKg = 1 }) {
  const th = Math.atan(grade);
  const vl = v + head;
  const va = Math.hypot(vl, cross);
  const aero = 0.5 * rho * cda * va * vl;
  const roll = crr * mass * G * Math.cos(th);
  const grav = mass * G * Math.sin(th);
  const acc = (mass + inertiaKg) * accel;
  return { aero, roll, grav, acc, total: aero + roll + grav + acc };
}

/** Crank power (W) needed to hold speed v (m/s) – can be negative (you'd have to brake). */
export function powerAt(v, ctx) {
  const f = forces(v, ctx);
  const wheel = f.total * v;
  return { power: wheel / (ctx.eta ?? 0.975), wheel, ...f };
}

/** Steady speed (m/s) for a crank power P on one piece of road (no acceleration). */
export function steadySpeed(P, ctx, vMax = 30) {
  const eta = ctx.eta ?? 0.975;
  const f = (v) => forces(v, ctx).total * v - eta * P;
  let lo = 0.1;
  let hi = vMax;
  if (f(hi) < 0) return hi;
  if (f(lo) > 0) return lo; // can't even crawl (wall) – caller will see a very long time
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (f(m) > 0) hi = m; else lo = m;
  }
  return (lo + hi) / 2;
}

/**
 * Full rider/bike/conditions setup → the constants every piece shares.
 * settings: { riderKg, heightCm, ftp, bikeKg, kitKg, position, aeroFactor, cdaOverride,
 *             crr, eta, exposure, maxPedalKmh, maxDescentKmh }
 */
export function systemFrom(settings) {
  const mass = settings.riderKg + settings.bikeKg + (settings.kitKg ?? 0);
  const cda = settings.cdaOverride > 0
    ? settings.cdaOverride
    : estimateCdA({ heightCm: settings.heightCm, massKg: settings.riderKg, position: settings.position, aeroFactor: settings.aeroFactor ?? 1 });
  return {
    mass,
    cda,
    crr: settings.crr ?? 0.0045,
    eta: settings.eta ?? 0.975,
    inertiaKg: 1.1, // two road wheels: I/r² ≈ 0.5–0.6 kg each
    z0: EXPOSURE[settings.exposure]?.z0 ?? 0.05,
    maxPedal: (settings.maxPedalKmh ?? 55) / 3.6,
    maxDescent: (settings.maxDescentKmh ?? 65) / 3.6,
    ftp: settings.ftp,
  };
}

/** Surface pressure from the weather model, moved from the model's grid height to the road's height. */
export function localPressure(w, elevM) {
  const p = w?.pressure ?? 1013.25;
  return w?.gridElev != null && elevM != null ? pressureAtAltitude(p, w.gridElev, elevM) : p;
}

/**
 * Build the per-piece conditions the simulator needs.
 * profile: [{distM, elev, grade, bearing}] at even spacing (from elevationProfile.js)
 * wx(distM) → { windSpeed (km/h @10 m), windDirection (deg FROM), temperature, pressure (hPa @ ground), humidity }
 */
export function buildPieces(profile, wx, sys) {
  const pieces = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    const ds = b.distM - a.distM;
    if (ds <= 0) continue;
    const mid = (a.distM + b.distM) / 2;
    const w = wx(mid);
    const u = windAtRiderHeight((w.windSpeed ?? 0) / 3.6, sys.z0);
    const { head, cross } = windComponentsMs(u, w.windDirection ?? 0, a.bearing ?? 0);
    pieces.push({
      d0: a.distM,
      ds,
      grade: a.grade ?? 0,
      elev: a.elev,
      bearing: a.bearing,
      head,
      cross,
      rho: airDensity({ tempC: w.temperature ?? 15, pressureHpa: localPressure(w, a.elev), humidity: w.humidity ?? 60 }),
    });
  }
  return pieces;
}

/**
 * Ride the pieces with a power strategy, integrating speed with kinetic energy
 * every ≤ 5 m:   v₂² = v₁² + 2·a·Δs,  a = (η·P/v − F_resist) / (m + I/r²).
 *
 * powerFn(piece, index, v) → crank watts the rider aims for there.
 * Returns time, average/normalised power, work and per-piece results.
 */
export function simulate(pieces, powerFn, sys, { v0 = 2, stepM = 5 } = {}) {
  let v = v0;
  let t = 0;
  let work = 0;
  const per = [];
  const series = []; // [dt, P] for NP
  for (let i = 0; i < pieces.length; i++) {
    const pc = pieces[i];
    const n = Math.max(1, Math.ceil(pc.ds / stepM));
    const ds = pc.ds / n;
    let pt = 0;
    let pw = 0;
    const ctx = { grade: pc.grade, mass: sys.mass, cda: sys.cda, crr: sys.crr, rho: pc.rho, head: pc.head, cross: pc.cross };
    for (let k = 0; k < n; k++) {
      let P = Math.max(0, powerFn(pc, i, v));
      if (v >= sys.maxPedal) P = 0; // spun out / tucked
      const vEff = Math.max(v, 1.5); // a standing start can't put infinite force through the tyre
      const Fp = Math.min((sys.eta * P) / vEff, 600);
      const R = forces(v, ctx).total;
      const a = (Fp - R) / (sys.mass + sys.inertiaKg);
      let v2 = Math.sqrt(Math.max(0.25, v * v + 2 * a * ds));
      if (v2 > sys.maxDescent) v2 = sys.maxDescent; // brakes / corners
      const dt = ds / ((v + v2) / 2);
      t += dt;
      pt += dt;
      work += P * dt;
      pw += P * dt;
      series.push([dt, P]);
      v = v2;
    }
    per.push({ d0: pc.d0, ds: pc.ds, t: pt, v: pc.ds / pt, power: pw / pt, grade: pc.grade, head: pc.head });
  }
  return { time: t, avgPower: work / t, np: normalizedPower(series), work, vEnd: v, per };
}

/** Normalised Power: 30 s rolling mean, 4th power mean, 4th root (Coggan). */
export function normalizedPower(series) {
  // resample to 1 s
  const ps = [];
  let carry = 0;
  let acc = 0;
  for (const [dt, P] of series) {
    let left = dt;
    while (left > 0) {
      const take = Math.min(left, 1 - carry);
      acc += P * take;
      carry += take;
      left -= take;
      if (carry >= 1 - 1e-9) { ps.push(acc); acc = 0; carry = 0; }
    }
  }
  if (carry > 0.5) ps.push(acc / carry);
  if (ps.length < 30) return ps.length ? ps.reduce((s, x) => s + x, 0) / ps.length : 0;
  let sum = 0;
  for (let i = 0; i < 30; i++) sum += ps[i];
  let s4 = 0;
  let n = 0;
  for (let i = 29; i < ps.length; i++) {
    if (i > 29) sum += ps[i] - ps[i - 30];
    s4 += (sum / 30) ** 4;
    n++;
  }
  return (s4 / n) ** 0.25;
}

/** Bisection on a scalar so simulate(...).time hits `targetS`. Returns { x, sim, feasible }. */
function solveFor(targetS, run, lo = 0, hi = 2000) {
  let simHi = run(hi);
  if (simHi.time > targetS) return { x: hi, sim: simHi, feasible: false };
  let sim = null;
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    sim = run(m);
    if (sim.time > targetS) lo = m; else { hi = m; simHi = sim; }
    if (hi - lo < 0.2) break;
  }
  return { x: hi, sim: simHi, feasible: true };
}

/** Same watts everywhere. */
export function constantPlan(pieces, sys, targetS, opts) {
  const r = solveFor(targetS, (P) => simulate(pieces, () => P, sys, opts));
  return { kind: 'constant', base: r.x, feasible: r.feasible, ...r.sim, powerAt: () => r.x };
}

/**
 * "Smart" (variable) pacing: push harder where you're slow (climbs, headwind),
 * ease off where the road gives speed for free (descents, tailwind). Time
 * spent is what counts, and you spend more of it where you're slow, so a watt
 * there buys more seconds. The target for each piece:
 *
 *   P_i = P_base · (R_i / R_flat)^β        clamped to [0, maxClimbPct·FTP]
 *
 *   R_i    = resistance on that piece at the plan's average speed
 *   R_flat = resistance on flat, still air at the same speed
 *   β      = how aggressively to vary (0 = constant, 0.3 typical, 0.5 strong)
 *
 * The solver then finds P_base so the whole ride lands on the target time.
 * Result: same arrival time with lower average AND normalised power than a
 * flat-power ride on a hilly/windy course (checked in tests).
 */
export function smartPlan(pieces, sys, targetS, { beta = 0.3, maxPct = 1.15, ...opts } = {}) {
  const total = pieces.reduce((s, p) => s + p.ds, 0);
  const vRef = Math.max(3, total / targetS);
  const rhoAvg = pieces.reduce((s, p) => s + p.rho * p.ds, 0) / total;
  const flat = forces(vRef, { grade: 0, mass: sys.mass, cda: sys.cda, crr: sys.crr, rho: rhoAvg }).total;
  const factor = pieces.map((p) => {
    const R = forces(vRef, { grade: p.grade, mass: sys.mass, cda: sys.cda, crr: sys.crr, rho: p.rho, head: p.head, cross: p.cross }).total;
    return Math.max(0.02, R / flat) ** beta;
  });
  const cap = (sys.ftp || 250) * maxPct;
  const fn = (base) => (pc, i) => Math.min(cap, base * factor[i]);
  const r = solveFor(targetS, (base) => simulate(pieces, fn(base), sys, opts));
  const f = fn(r.x);
  return { kind: 'smart', base: r.x, feasible: r.feasible, factor, ...r.sim, powerAt: (i) => f(pieces[i], i) };
}

/** Coggan power zones from %FTP. */
export function powerZone(pct) {
  if (pct < 0.56) return { z: 1, label: 'Z1 Ανάκαμψη', color: '#64748b' };
  if (pct < 0.76) return { z: 2, label: 'Z2 Αντοχή', color: '#22c55e' };
  if (pct < 0.91) return { z: 3, label: 'Z3 Tempo', color: '#84cc16' };
  if (pct < 1.06) return { z: 4, label: 'Z4 Κατώφλι', color: '#eab308' };
  if (pct < 1.21) return { z: 5, label: 'Z5 VO2max', color: '#f97316' };
  return { z: 6, label: 'Z6 Αναερόβιο', color: '#ef4444' };
}

/**
 * How long can this intensity be held? Rough power-duration curve relative to
 * FTP (≈ 60 min power): P(t)/FTP ≈ (t/3600)^−0.07 for 5–120 min.
 * Returns the expected sustainable minutes for a given %FTP (NP based).
 */
export function sustainableMinutes(pctFtp) {
  if (pctFtp <= 0.75) return Infinity;
  return 60 * pctFtp ** (-1 / 0.07);
}

/**
 * Live estimator – one GPS tick. Pure: (state, input) → state.
 * input: { t (ms), speedMs, grade, head, cross, rho, sys }
 * Speed is smoothed (EMA) before differentiating for acceleration, otherwise
 * GPS speed noise (±0.3 m/s) turns into ±200 W spikes.
 */
export function liveStep(state, { t, speedMs, grade, head, cross, rho, sys }) {
  const s = { ...state };
  const v = Math.max(0, speedMs ?? 0);
  s.v = state.v == null ? v : state.v + 0.5 * (v - state.v);
  let accel = 0;
  if (state.t != null && t > state.t) {
    const dt = (t - state.t) / 1000;
    const a = (s.v - state.v) / dt;
    s.a = state.a == null ? a : state.a + 0.4 * (a - state.a);
    accel = Math.max(-3, Math.min(3, s.a));
  }
  s.t = t;
  const p = s.v < 0.8 ? { power: 0 } : powerAt(s.v, { grade, mass: sys.mass, cda: sys.cda, crr: sys.crr, rho, head, cross, accel, inertiaKg: sys.inertiaKg, eta: sys.eta });
  s.raw = p.power;
  s.power = Math.max(0, p.power); // negative = coasting/braking → 0 at the pedals
  s.parts = p;
  s.hist = [...(state.hist || []), { t, p: s.power }].filter((x) => t - x.t <= 30000);
  const avg = (ms) => {
    const xs = s.hist.filter((x) => t - x.t <= ms);
    return xs.length ? xs.reduce((a, x) => a + x.p, 0) / xs.length : s.power;
  };
  s.p3 = avg(3000);
  s.p10 = avg(10000);
  s.p30 = avg(30000);
  return s;
}
