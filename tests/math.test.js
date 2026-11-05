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
