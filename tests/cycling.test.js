import { describe, it, expect } from 'vitest';
import {
  airDensity, estimateCdA, windAtRiderHeight, windComponentsMs, powerAt, steadySpeed, systemFrom,
  buildPieces, simulate, constantPlan, smartPlan, normalizedPower, liveStep, pressureAtAltitude, sustainableMinutes,
} from '../src/lib/cyclingPower.js';
import { buildProfile, ascentDescent, findSections, profileAt, resampleTrack } from '../src/lib/elevationProfile.js';

const SET = { riderKg: 62, heightCm: 163, ftp: 190, bikeKg: 7.2, kitKg: 1.5, position: 'hoods', aeroFactor: 0.96, crr: 0.0045, eta: 0.975, exposure: 'rural', maxPedalKmh: 55, maxDescentKmh: 65 };
const sys = systemFrom(SET);
const still = () => ({ windSpeed: 0, windDirection: 0, temperature: 15, pressure: 1013, humidity: 60 });

// straight line heading south with a given elevation function
function line(lenM, elevFn, step = 50) {
  const pts = [];
  for (let d = 0; d <= lenM; d += step) pts.push({ lat: 38 - d / 111195, lon: 24, distM: d, elev: elevFn(d) });
  return buildProfile(pts);
}

describe('air & aero', () => {
  it('ISA sea level dry air ≈ 1.225', () => {
    expect(airDensity({ tempC: 15, pressureHpa: 1013.25, humidity: 0 })).toBeCloseTo(1.225, 3);
  });
  it('humid air is lighter', () => {
    expect(airDensity({ tempC: 30, humidity: 90 })).toBeLessThan(airDensity({ tempC: 30, humidity: 0 }));
  });
  it('pressure drops ~12 hPa per 100 m near sea level', () => {
    expect(1013 - pressureAtAltitude(1013, 0, 100)).toBeCloseTo(12, 0);
  });
  it('CdA: 178 cm / 75 kg on the hoods ≈ 0.33 m²', () => {
    expect(estimateCdA({ heightCm: 178, massKg: 75, position: 'hoods' })).toBeCloseTo(0.33, 2);
  });
  it('log wind profile: farmland rider gets ~60 % of the 10 m wind', () => {
    expect(windAtRiderHeight(10, 0.05) / 10).toBeCloseTo(0.6, 1);
  });
  it('wind components: northerly on a southbound road is a pure tailwind', () => {
    const c = windComponentsMs(5, 0, 180);
    expect(c.head).toBeCloseTo(-5, 6);
    expect(c.cross).toBeCloseTo(0, 6);
  });
});

describe('power model', () => {
  it('textbook check: 75 kg system, CdA 0.32, 40 km/h flat ≈ 300 W', () => {
    const p = powerAt(40 / 3.6, { grade: 0, mass: 83, cda: 0.32, crr: 0.004, rho: 1.225, eta: 0.975 }).power;
    expect(p).toBeGreaterThan(280);
    expect(p).toBeLessThan(330);
  });
  it('steadySpeed inverts powerAt', () => {
    const ctx = { grade: 0.05, mass: 71, cda: 0.28, crr: 0.0045, rho: 1.2, eta: 0.975 };
    const v = steadySpeed(200, ctx);
    expect(powerAt(v, ctx).power).toBeCloseTo(200, 1);
  });
  it('headwind costs, tailwind gives', () => {
    const base = { grade: 0, mass: 71, cda: 0.28, crr: 0.0045, rho: 1.2, eta: 0.975 };
    const v0 = steadySpeed(150, base);
    expect(steadySpeed(150, { ...base, head: 3 })).toBeLessThan(v0);
    expect(steadySpeed(150, { ...base, head: -3 })).toBeGreaterThan(v0);
  });
});

describe('elevation profile', () => {
  it('constant 4 % ramp is recovered through smoothing', () => {
    const p = line(3000, (d) => 0.04 * d);
    expect(profileAt(p, 1500, 'grade')).toBeCloseTo(0.04, 3);
  });
  it('DEM noise ±2 m is not counted as climbing', () => {
    const p = line(5000, (d) => 50 + (Math.round(d / 50) % 2 ? 2 : -2));
    expect(ascentDescent(p).up).toBeLessThan(5);
  });
  it('finds a 1 km 6 % climb', () => {
    const p = line(4000, (d) => (d < 1500 ? 0 : d < 2500 ? (d - 1500) * 0.06 : 60));
    const [c] = findSections(p);
    expect(c.length).toBeGreaterThan(800);
    expect(c.gain).toBeGreaterThan(50);
  });
  it('resampleTrack spacing', () => {
    const r = resampleTrack([{ lat: 0, lon: 0, distM: 0 }, { lat: 0, lon: 0.01, distM: 1000 }], 100);
    expect(r.length).toBe(11);
  });
});

describe('pacing solver', () => {
  const hilly = line(18000, (d) => 30 * Math.sin(d / 1500) + 0.004 * d);
  const pieces = buildPieces(hilly, still, sys);

  it('constant plan hits the target time', () => {
    const plan = constantPlan(pieces, sys, 40 * 60);
    expect(plan.time).toBeCloseTo(2400, -1);
    expect(plan.base).toBeGreaterThan(60);
  });
  it('smart pacing: same time with lower average and normalised power', () => {
    const c = constantPlan(pieces, sys, 2400);
    const s = smartPlan(pieces, sys, 2400);
    expect(s.time).toBeCloseTo(2400, -1);
    expect(s.avgPower).toBeLessThan(c.avgPower);
    expect(s.np).toBeLessThan(c.np + 1);
  });
  it('descent carries momentum (kinetic energy) – coasting still moves', () => {
    const down = buildPieces(line(2000, (d) => 100 - 0.05 * d), still, sys);
    const r = simulate(down, () => 0, sys, { v0: 5 });
    expect(r.vEnd * 3.6).toBeGreaterThan(40);
  });
  it('flags an impossible target', () => {
    expect(constantPlan(pieces, sys, 10 * 60).feasible).toBe(false);
  });
  it('NP of a steady effort equals the effort', () => {
    expect(normalizedPower(Array(300).fill([1, 200]))).toBeCloseTo(200, 6);
  });
  it('sustainable minutes: FTP ≈ 60 min', () => {
    expect(sustainableMinutes(1)).toBeCloseTo(60, 6);
    expect(sustainableMinutes(1.05)).toBeLessThan(60);
  });
});

describe('live estimator', () => {
  it('steady 30 km/h on the flat gives the model power', () => {
    let s = {};
    for (let i = 0; i < 10; i++) s = liveStep(s, { t: i * 1000, speedMs: 30 / 3.6, grade: 0, head: 0, cross: 0, rho: 1.2, sys });
    const ref = powerAt(30 / 3.6, { grade: 0, mass: sys.mass, cda: sys.cda, crr: sys.crr, rho: 1.2, eta: sys.eta }).power;
    expect(s.p3).toBeCloseTo(ref, 0);
  });
  it('coasting downhill reads 0 W, not negative', () => {
    let s = {};
    for (let i = 0; i < 5; i++) s = liveStep(s, { t: i * 1000, speedMs: 12, grade: -0.06, head: 0, cross: 0, rho: 1.2, sys });
    expect(s.power).toBe(0);
  });
});
