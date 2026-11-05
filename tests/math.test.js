import { describe, it, expect } from 'vitest';
import { haversine, initialBearing, normalize180, sampleRoute } from '../src/lib/geo.js';
import { relativeWindAngle, windComponents, apparentWind, clockPosition, crosswindSeverity, dragFactor, analyzeWind } from '../src/lib/wind.js';
import { indexCameras, proximityStep } from '../src/features/cameras/cameraEngine.js';
import { trackerStep, smoothHeading } from '../src/lib/gpsTracker.js';
import { interpolateHourly } from '../src/services/openMeteo.js';

describe('geo', () => {
  it('haversine: 1° of latitude ≈ 111.2 km', () => {
    expect(haversine(38, 23, 39, 23)).toBeCloseTo(111195, -2);
  });
  it('haversine: Athens Syntagma → Piraeus ≈ 8.5 km', () => {
    expect(haversine(37.9755, 23.7348, 37.9420, 23.6465) / 1000).toBeCloseTo(8.5, 0);
  });
  it('bearing: due east / north', () => {
    expect(initialBearing(0, 0, 0, 1)).toBeCloseTo(90, 5);
    expect(initialBearing(38, 23, 39, 23)).toBeCloseTo(0, 5);
  });
  it('normalize180 wraps', () => {
    expect(normalize180(-340)).toBe(20);
    expect(normalize180(190)).toBe(-170);
    expect(normalize180(180)).toBe(180);
  });
  it('sampleRoute spaces waypoints and interpolates ETA', () => {
    // straight 50 km route north in 10 edges of 5 km / 200 s each (90 km/h)
    const coords = Array.from({ length: 11 }, (_, i) => ({ lat: 38 + (i * 5000) / 111195, lon: 23 }));
    const wps = sampleRoute(coords, Array(10).fill(5000), Array(10).fill(200), 12000);
    expect(wps.map((w) => w.distM)).toEqual([0, 12000, 24000, 36000, 48000]);
    expect(wps[1].etaS).toBeCloseTo(480, 5); // 12 km at 25 m/s
  });
});

describe('wind', () => {
  it('relative angle across north', () => {
    expect(relativeWindAngle(10, 350)).toBe(20); // slightly right of nose
    expect(relativeWindAngle(270, 0)).toBe(-90); // westerly, heading north → from left
  });
  it('components: pure crosswind from right', () => {
    const c = windComponents(30, 90);
    expect(c.headwind).toBeCloseTo(0, 6);
    expect(c.crosswind).toBeCloseTo(30, 6);
  });
  it('components: runway-chart check 30 kt @ 30° → 26 head / 15 cross', () => {
    const c = windComponents(30, 30);
    expect(c.headwind).toBeCloseTo(25.98, 2);
    expect(c.crosswind).toBeCloseTo(15, 6);
  });
  it('apparent wind: 30 cross at 90 km/h swings toward the nose, lateral unchanged', () => {
    const a = apparentWind(30, 90, 90);
    expect(a.speed).toBeCloseTo(Math.hypot(30, 90), 6);
    expect(a.angle).toBeCloseTo(18.43, 2);
  });
  it('clock positions', () => {
    expect(clockPosition(0)).toBe(12);
    expect(clockPosition(90)).toBe(3);
    expect(clockPosition(-90)).toBe(9);
    expect(clockPosition(180)).toBe(6);
  });
  it('severity bands', () => {
    expect(crosswindSeverity(15, 18, 15, 18)).toBe('green');
    expect(crosswindSeverity(25, 30, 25, 30)).toBe('orange');
    expect(crosswindSeverity(45, 50, 45, 50)).toBe('red');
    expect(crosswindSeverity(22, 22, 25, 55)).toBe('red'); // gusty
  });
  it('drag: 30 km/h headwind at 90 → +78 %', () => {
    expect(dragFactor(90, 30)).toBeCloseTo(1.778, 3);
  });
  it('analyzeWind end to end', () => {
    const a = analyzeWind({ speed: 40, direction: 0, gusts: 55 }, 90, 100); // northerly, heading east
    expect(a.relAngle).toBe(-90);
    expect(a.side).toBe('left');
    expect(a.severity).toBe('red');
  });
});

describe('camera engine', () => {
  const gj = { features: [
    { geometry: { type: 'Point', coordinates: [23.0, 38.0] }, properties: { id: 'A', type: 'speed_camera', direction: 0 } },
  ] };
  const idx = indexCameras(gj);
  const at = (metresSouth, heading = 0) => ({ lat: 38 - metresSouth / 111195, lon: 23, heading });

  it('alerts once inside 500 m, not before, then passes and re-arms', () => {
    const mem = new Map();
    expect(proximityStep(idx, mem, at(700)).newAlerts).toHaveLength(0);
    expect(proximityStep(idx, mem, at(480)).newAlerts).toHaveLength(1);
    expect(proximityStep(idx, mem, at(470)).newAlerts).toHaveLength(0); // no repeat
    expect(proximityStep(idx, mem, at(520)).active).toHaveLength(1); // jitter back out – still active (hysteresis)
    proximityStep(idx, mem, at(0));
    expect(proximityStep(idx, mem, at(-100)).active).toHaveLength(0); // passed
    proximityStep(idx, mem, at(-900)); // > 800 m → re-arm
    expect(mem.size).toBe(0);
  });
  it('ignores opposite-direction traffic and cameras behind', () => {
    expect(proximityStep(idx, new Map(), at(300, 180)).newAlerts).toHaveLength(0); // heading south, cam enforces north
    expect(proximityStep(idx, new Map(), at(-300, 0)).newAlerts).toHaveLength(0); // already past it
  });
});

describe('gps tracker', () => {
  it('circular smoothing across north', () => {
    expect(smoothHeading(350, 10, 0.5)).toBeCloseTo(0, 6);
  });
  it('derives heading from displacement when GNSS heading is missing, holds it when stopped', () => {
    let s = trackerStep({}, { lat: 38, lon: 23, accuracy: 5, speed: null, heading: null, timestamp: 0 });
    s = trackerStep(s, { lat: 38, lon: 23 + 30 / 87700, accuracy: 5, speed: null, heading: null, timestamp: 2000 });
    expect(s.position.heading).toBeCloseTo(90, 0);
    expect(s.position.headingSource).toBe('derived');
    s = trackerStep(s, { lat: 38, lon: 23 + 31 / 87700, accuracy: 5, speed: 0, heading: NaN, timestamp: 3000 });
    expect(s.position.heading).toBeCloseTo(90, 0); // held
  });
});

describe('open-meteo interpolation', () => {
  it('interpolates wind direction as a vector across north', () => {
    const h = {
      time: [0, 3600],
      temperature_2m: [10, 20], precipitation: [0, 2], visibility: [10000, 10000],
      wind_speed_10m: [20, 20], wind_gusts_10m: [30, 30], wind_direction_10m: [350, 10], weather_code: [0, 61],
    };
    const r = interpolateHourly(h, 1800);
    expect(r.temperature).toBe(15);
    expect(Math.min(r.windDirection, 360 - r.windDirection)).toBeLessThan(0.001); // ≈ 0°, not 180°
  });
});

import { analyzeFrame, EngineLoadMonitor, updateCorrection, loadFactor } from '../src/features/engineLoad/engineDsp.js';

describe('engine load DSP', () => {
  it('band power sums linear power, not dB', () => {
    const bins = new Float32Array(100).fill(-Infinity);
    bins[10] = -20; bins[11] = -20; // two equal bins → +3 dB over one
    expect(analyzeFrame(bins, 10, 50, 500).powerDb).toBeCloseTo(-20 + 10 * Math.log10(2), 5);
  });
  it('steady cruise → green; +10 dB at the same speed → red; louder only because faster → not red', () => {
    const m = new EngineLoadMonitor({ ratedL100: 7, idleLph: 0.8 });
    let s;
    for (let i = 0; i < 100; i++) s = m.step({ powerDb: -40 + (i % 2) * 0.5, centroidHz: 150 }, 60, 0.1);
    expect(s.state).toBe('green');
    for (let i = 0; i < 30; i++) s = m.step({ powerDb: -30, centroidHz: 200 }, 60, 0.1);
    expect(s.state).toBe('red');
    expect(s.instL100).toBeGreaterThan(7);
    const m2 = new EngineLoadMonitor({ ratedL100: 7, idleLph: 0.8 });
    for (let i = 0; i < 100; i++) m2.step({ powerDb: -40, centroidHz: 150 }, 50, 0.1);
    for (let i = 0; i < 100; i++) s = m2.step({ powerDb: -34, centroidHz: 150 }, 120, 0.1); // new speed bucket, steady
    expect(s.state).toBe('green');
  });
  it('trip integration: 60 km/h for 1 h at cruise ≈ 60 km', () => {
    const m = new EngineLoadMonitor({ ratedL100: 6, idleLph: 0.8 });
    let s;
    for (let i = 0; i < 3600; i++) s = m.step({ powerDb: -40, centroidHz: 150 }, 60, 1);
    expect(s.tripKm).toBeCloseTo(60, 3);
    expect(s.avgL100).toBeCloseTo(6 * loadFactor(0), 1);
  });
  it('fill-up calibration moves halfway toward reality', () => {
    expect(updateCorrection(1, 44, 40)).toBeCloseTo(1.05, 5);
  });
});

import { InterferenceGate, ProfileLearner } from '../src/features/engineLoad/engineDsp.js';
import { exposureAt } from '../src/services/elevation.js';

describe('interference gate', () => {
  const learner = new ProfileLearner(50);
  for (let i = 0; i < 50; i++) learner.add({ powerDb: -40, flux: 0.3 + (i % 3) * 0.1, hiDb: -60 + (i % 2) * 0.5, centroidHz: 150 });
  const profile = learner.finish();
  it('a single throttle step does not trip it', () => {
    const g = new InterferenceGate(profile);
    let r;
    for (let i = 0; i < 20; i++) r = g.step({ flux: i === 5 ? 9 : 0.3, hiDb: i < 5 ? -60 : -50 });
    expect(r.interfering).toBe(false);
  });
  it('music-like rhythm in 1–4 kHz trips it and is labelled voice', () => {
    const g = new InterferenceGate(profile);
    let r;
    for (let i = 0; i < 15; i++) r = g.step({ flux: 0.3, hiDb: i % 4 === 0 ? -45 : -60 });
    expect(r.interfering).toBe(true);
    expect(r.reason).toBe('voice');
  });
});

describe('terrain exposure', () => {
  // 20 km route, flat at 100 m with a 250 m-high pass at km 10
  const profile = Array.from({ length: 21 }, (_, k) => ({ distM: k * 1000, elev: k === 10 ? 350 : k === 9 || k === 11 ? 250 : 100 }));
  it('boosts wind on the pass, not on the flat', () => {
    const pass = exposureAt(profile, 10000);
    expect(pass.exposed).toBe(true);
    expect(pass.factor).toBeGreaterThan(1.2);
    expect(exposureAt(profile, 2000).factor).toBe(1);
  });
});

import { buildTrack, locateOnTrack, mergeRanges } from '../src/lib/track.js';
import { classRanges } from '../src/services/osrm.js';
import { fetchRoadInfo } from '../src/services/roadInfo.js';

describe('route track & road info', () => {
  // straight 10 km route due north from 38.0, 23.0
  const N = 101;
  const coords = Array.from({ length: N }, (_, i) => ({ lat: 38 + (i * 100) / 111320, lon: 23 }));
  const route = { coords, segDist: Array(N - 1).fill(100), segTime: Array(N - 1).fill(4), distanceM: 10000 };
  const track = buildTrack(route);
  const ptAt = (m, eastM = 0) => ({ lat: 38 + m / 111320, lon: 23 + eastM / (111320 * Math.cos((38 * Math.PI) / 180)) });

  it('locates points along the route', () => {
    const p = ptAt(4200, 10);
    const loc = locateOnTrack(track, p.lat, p.lon);
    expect(Math.abs(loc.distM - 4200)).toBeLessThanOrEqual(60);
    expect(loc.off).toBeLessThan(15);
  });
  it('merges ranges', () => {
    expect(mergeRanges([[0, 100], [180, 300], [1000, 1200]], 100)).toEqual([[0, 300], [1000, 1200]]);
  });
  it('turns OSRM intersection classes into toll/tunnel km ranges', () => {
    const xs = [{ ...ptAt(0), classes: [] }, { ...ptAt(2000), classes: ['toll', 'motorway'] }, { ...ptAt(5000), classes: ['toll', 'tunnel'] }, { ...ptAt(5600), classes: [] }];
    const r = classRanges(xs, (la, lo) => locateOnTrack(track, la, lo), 10000);
    const tollKm = r.toll.reduce((s, [a, b]) => s + b - a, 0) / 1000;
    expect(tollKm).toBeCloseTo(3.6, 1);
    expect(r.tunnel).toHaveLength(1);
  });
  it('OSM matching: dirt stretch ON the route counts, a dirt road that only CROSSES does not', async () => {
    const along = [ptAt(6000, 3), ptAt(6500, 2), ptAt(7000, 4), ptAt(7500, 1)];
    const crossing = [ptAt(3000, -400), ptAt(3000, 0), ptAt(3000, 400)];
    const cam = ptAt(8000, 15);
    global.fetch = async () => ({ ok: true, json: async () => ({ elements: [
      { type: 'way', id: 1, tags: { highway: 'unclassified', surface: 'gravel' }, geometry: along },
      { type: 'way', id: 2, tags: { highway: 'track' }, geometry: crossing },
      { type: 'node', id: 3, lat: cam.lat, lon: cam.lon, tags: { highway: 'speed_camera', maxspeed: '70' } },
    ] }) });
    const info = await fetchRoadInfo(track);
    expect(info.unpaved).toHaveLength(1);
    expect(info.unpaved[0].lengthM).toBeGreaterThan(1300);
    expect(info.cameras).toHaveLength(1);
    expect(info.cameras[0].maxspeed).toBe(70);
    expect(Math.abs(info.cameras[0].distM - 8000)).toBeLessThan(80);
  });
});

describe('track projection', () => {
  it('a point on the road between two samples is ~0 m off and located exactly', () => {
    const A = [37.98, 23.73], B = [38.20, 23.95], L = 31000, n = 120;
    const P = (d) => { const f = d / L; return { lat: A[0] + (B[0] - A[0]) * f, lon: A[1] + (B[1] - A[1]) * f }; };
    const coords = Array.from({ length: n }, (_, i) => P((L * i) / (n - 1)));
    const t = buildTrack({ coords, segDist: Array(n - 1).fill(L / (n - 1)), segTime: Array(n - 1).fill(15), distanceM: L });
    const p = P(18050);
    const loc = locateOnTrack(t, p.lat, p.lon);
    expect(loc.off).toBeLessThan(2);
    expect(Math.abs(loc.distM - 18050)).toBeLessThan(25);
  });
});

import { distGreek, instructionGreek, GR } from '../src/lib/voice.js';
import { guidanceStep, isActionable } from '../src/features/guidance/guidance.js';
import { parseMaxspeed, speedLimitAt } from '../src/services/speedLimit.js';

describe('Greek voice phrases', () => {
  it('distances the way people say them', () => {
    expect(distGreek(287)).toBe('300 μέτρα');
    expect(distGreek(1000)).toBe('1 χιλιόμετρο');
    expect(distGreek(1500)).toBe('1,5 χιλιόμετρα');
  });
  it('turns, roundabouts, ramps', () => {
    expect(instructionGreek({ type: 'turn', modifier: 'right', name: 'Κηφισίας' }, 300)).toBe('Σε 300 μέτρα, στρίψτε δεξιά προς Κηφισίας.');
    expect(instructionGreek({ type: 'roundabout', exit: 2 }, null)).toBe('Στον κυκλικό κόμβο, πάρτε τη δεύτερη έξοδο.');
    expect(instructionGreek({ type: 'off ramp', modifier: 'slight right', name: 'Αττική Οδός' }, 1000)).toBe('Σε 1 χιλιόμετρο, πάρτε την έξοδο δεξιά προς Αττική Οδός.');
    expect(GR.speeding(90)).toBe('Προσοχή, το όριο είναι 90.');
  });
});

describe('turn-by-turn timing', () => {
  const guide = [
    { distM: 5000, type: 'turn', modifier: 'left', name: 'Α' },
    { distM: 5100, type: 'turn', modifier: 'right', name: 'Β' },
    { distM: 9000, type: 'arrive' },
  ].filter(isActionable);
  it('early, near, now – each once – and chains a turn that follows within 150 m', () => {
    const said = new Set();
    const at = (p, v) => guidanceStep(guide, p, v, said).speech;
    expect(at(3000, 100)).toBe('Σε 2 χιλιόμετρα, στρίψτε αριστερά προς Α, και μετά, στρίψτε δεξιά προς Β.');
    expect(at(3100, 100)).toBeNull();
    expect(at(4520, 100)).toMatch(/^Σε 500 μέτρα, στρίψτε αριστερά/);
    expect(at(4900, 100)).toMatch(/^Στρίψτε αριστερά προς Α, και μετά/);
    expect(at(4950, 100)).toBeNull();
  });
  it('ignores "continue straight"', () => {
    expect(isActionable({ type: 'new name', modifier: 'straight' })).toBe(false);
    expect(isActionable({ type: 'continue', modifier: 'slight left' })).toBe(false);
    expect(isActionable({ type: 'fork', modifier: 'slight left' })).toBe(true);
  });
});

describe('speed limits', () => {
  it('parses OSM maxspeed incl. Greek zones and defaults', () => {
    expect(parseMaxspeed('90')).toEqual({ kmh: 90, explicit: true });
    expect(parseMaxspeed('GR:urban')).toEqual({ kmh: 50, explicit: true });
    expect(parseMaxspeed(undefined, 'motorway')).toEqual({ kmh: 130, explicit: false });
    expect(parseMaxspeed(undefined, 'primary')).toBeNull();
  });
  it('prefers posted limits and the longest stretch', () => {
    const r = [{ from: 0, to: 9000, kmh: 130, explicit: false }, { from: 4000, to: 6000, kmh: 100, explicit: true }, { from: 4900, to: 5100, kmh: 60, explicit: true }];
    expect(speedLimitAt(r, 5000).kmh).toBe(100);
    expect(speedLimitAt(r, 1000).kmh).toBe(130);
  });
});

import { fuelRate, airDensity, gradeAt, updateCorrection as fuelCorrection } from '../src/features/fuel/fuelModel.js';
import { presetById } from '../src/features/fuel/vehicles.js';

describe('physics fuel model', () => {
  const car = presetById('compact');
  const moto = presetById('naked');
  const flat = (kmh, extra = {}) => fuelRate(car, { speedKmh: kmh, accelMs2: 0, grade: 0, headwindKmh: 0, ...extra });
  it('matches real-world figures', () => {
    expect(flat(90).l100).toBeGreaterThan(4.8);
    expect(flat(90).l100).toBeLessThan(6.2);
    expect(flat(130).l100).toBeGreaterThan(7);
    expect(flat(130).l100).toBeLessThan(9.5);
    const m = fuelRate(moto, { speedKmh: 90 }).l100;
    expect(m).toBeGreaterThan(3);
    expect(m).toBeLessThan(5);
  });
  it('headwind, climbing and full throttle cost fuel; downhill coasting is free', () => {
    expect(flat(90, { headwindKmh: 30 }).l100).toBeGreaterThan(flat(90).l100 * 1.25);
    expect(flat(90, { grade: 0.05 }).l100).toBeGreaterThan(flat(90).l100 * 1.8);
    expect(flat(90, { loadDb: 12 }).lph).toBeCloseTo(flat(90).lph * 1.2, 1);
    expect(flat(90, { grade: -0.06 }).lph).toBe(0);
  });
  it('idle only while the engine runs (start-stop)', () => {
    expect(flat(0).lph).toBeCloseTo(car.idleLph, 5);
    expect(flat(0, { engineOn: false }).lph).toBe(0);
  });
  it('air density: hot or high air is thinner', () => {
    expect(airDensity(15, 0)).toBeCloseTo(1.225, 3);
    expect(airDensity(35, 1000)).toBeLessThan(1.05);
  });
  it('grade from the elevation profile', () => {
    const prof = [0, 1000, 2000, 3000].map((d) => ({ distM: d, elev: d * 0.04 }));
    expect(gradeAt(prof, 1500)).toBeCloseTo(0.04, 3);
  });
  it('fill-up correction moves halfway, bounded', () => {
    expect(fuelCorrection(1, 44, 40)).toBeCloseTo(1.05, 5);
  });
});

import { vibrationRms, ENGINE_ON_RMS } from '../src/features/fuel/useVibration.js';

describe('vibration', () => {
  const gen = (amp, n = 90) => Array.from({ length: n }, (_, i) => [amp * Math.sin(i * 2.1), 9.81 + amp * Math.cos(i * 1.7), amp * Math.sin(i * 0.9 + 1)]);
  it('gravity is removed; an idling engine reads as ON, a still phone as OFF', () => {
    expect(vibrationRms(gen(0))).toBeCloseTo(0, 5);
    expect(vibrationRms(gen(0.15))).toBeGreaterThan(ENGINE_ON_RMS);
    expect(vibrationRms(gen(0.005))).toBeLessThan(ENGINE_ON_RMS);
  });
});
