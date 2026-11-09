/**
 * Live ride loop – runs once per GPS fix:
 *
 *   fix → where am I on the route (along-track metres, off-route metres)
 *       → gradient: from the smoothed DEM profile at that point (GPS altitude
 *         is ±10 m noisy – useless for a 3 % ramp); off-route → regression of
 *         GPS altitude over the last ~150 m as a fallback
 *       → course: route bearing there (steadier than GNSS course on a bike)
 *       → wind: live Open-Meteo `current` at the rider (refresh every 5 min
 *         or 3 km), reduced to rider height, split into head/cross components
 *       → air density: live temp + humidity + pressure moved to road height
 *       → liveStep(): watts from speed, acceleration, gradient, wind
 *   every ~4 s  → "watts needed from here" for the target time, and the
 *                 projected finish at your last-30-s power, both by simulating
 *                 the REST of the route with the live wind.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { liveStep, windAtRiderHeight, windComponentsMs, airDensity, localPressure, constantPlan } from '../lib/cyclingPower.js';
import { profileAt } from '../lib/elevationProfile.js';
import { locateOnTrack } from '../lib/track.js';
import { haversine } from '../lib/geo.js';
import { fetchCurrentConditions, weatherAlong } from './services.js';

const CELL = 0.005;
export function makeTrack(profile) {
  if (!profile?.length) return null;
  const pts = profile.map((p) => ({ lat: p.lat, lon: p.lon, distM: p.distM }));
  const grid = new Map();
  pts.forEach((p, i) => {
    const k = `${Math.floor(p.lat / CELL)}:${Math.floor(p.lon / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  return { pts, grid, step: pts[1]?.distM - pts[0]?.distM || 50, total: pts[pts.length - 1].distM };
}

export function useLiveRide({ active, position, profile, pieces, sys, forecast, targetS, stopsS, startedAt, plan, useForecastWind }) {
  const track = useMemo(() => makeTrack(profile), [profile]);
  const [live, setLive] = useState(null);
  const [cond, setCond] = useState(null);
  const [need, setNeed] = useState(null);
  const est = useRef({});
  const altBuf = useRef([]);
  const lastFetch = useRef({ t: 0, lat: null, lon: null });
  const lastNeed = useRef(0);
  const totals = useRef({ work: 0, time: 0, lastT: null, maxDist: 0 });

  useEffect(() => {
    if (!active) { est.current = {}; altBuf.current = []; totals.current = { work: 0, time: 0, lastT: null, maxDist: 0 }; setLive(null); setNeed(null); }
  }, [active]);

  // live weather at the rider
  useEffect(() => {
    if (!active || !position || useForecastWind) return;
    const lf = lastFetch.current;
    const moved = lf.lat == null ? Infinity : haversine(lf.lat, lf.lon, position.lat, position.lon);
    if (Date.now() - lf.t < 5 * 60000 && moved < 3000) return;
    lastFetch.current = { t: Date.now(), lat: position.lat, lon: position.lon };
    fetchCurrentConditions(position.lat, position.lon).then(setCond).catch(() => {});
  }, [active, position, useForecastWind]);

  useEffect(() => {
    if (!active || !position || !profile?.length || !sys) return;
    const loc = locateOnTrack(track, position.lat, position.lon);
    const onRoute = loc && loc.off < 60;
    const distM = onRoute ? loc.distM : totals.current.maxDist;
    if (onRoute) totals.current.maxDist = Math.max(totals.current.maxDist, distM);

    // gradient
    let grade = 0;
    let gradeSrc = 'dem';
    if (onRoute) grade = profileAt(profile, distM, 'grade');
    else if (position.altitude != null) {
      const buf = altBuf.current;
      const last = buf[buf.length - 1];
      const step = last ? haversine(last.lat, last.lon, position.lat, position.lon) : 0;
      buf.push({ lat: position.lat, lon: position.lon, s: (last?.s || 0) + step, h: position.altitude });
      while (buf.length > 2 && buf[buf.length - 1].s - buf[0].s > 150) buf.shift();
      if (buf.length > 4 && buf[buf.length - 1].s - buf[0].s > 60) {
        const n = buf.length;
        const ms = buf.reduce((a, x) => a + x.s, 0) / n;
        const mh = buf.reduce((a, x) => a + x.h, 0) / n;
        const num = buf.reduce((a, x) => a + (x.s - ms) * (x.h - mh), 0);
        const den = buf.reduce((a, x) => a + (x.s - ms) ** 2, 0);
        grade = Math.max(-0.2, Math.min(0.2, den ? num / den : 0));
      }
      gradeSrc = 'gps';
    }
    const elev = onRoute ? profileAt(profile, distM, 'elev') : position.altitude;
    const course = onRoute ? profileAt(profile, distM, 'bearing') : position.heading ?? 0;

    // conditions
    const w = (!useForecastWind && cond) || weatherAlong(forecast, distM) || { windSpeed: 0, windDirection: 0, temperature: 15, pressure: 1013, humidity: 60 };
    const u = windAtRiderHeight((w.windSpeed ?? 0) / 3.6, sys.z0);
    const { head, cross } = windComponentsMs(u, w.windDirection ?? 0, course);
    const rho = airDensity({ tempC: w.temperature, pressureHpa: localPressure(w, elev), humidity: w.humidity });
    const speedMs = (position.speedKmh || 0) / 3.6;
    est.current = liveStep(est.current, { t: position.timestamp, speedMs, grade, head, cross, rho, sys });

    // ride totals (moving only)
    const T = totals.current;
    if (T.lastT != null && speedMs > 1) {
      const dt = (position.timestamp - T.lastT) / 1000;
      if (dt > 0 && dt < 30) { T.time += dt; T.work += est.current.power * dt; }
    }
    T.lastT = position.timestamp;

    const elapsed = startedAt ? (position.timestamp - startedAt) / 1000 : 0;
    const idx = Math.max(0, pieces.findIndex((p) => distM < p.d0 + p.ds));
    const total = profile[profile.length - 1].distM;

    // every ~4 s of ride time: what's needed from here, and where your current effort lands you
    if (position.timestamp - lastNeed.current > 4000 && pieces.length) {
      lastNeed.current = position.timestamp;
      const rest = pieces.slice(idx).map((p, k) => {
        const q = { ...p };
        if (k === 0) { const cut = Math.max(0, distM - p.d0); q.ds = Math.max(1, p.ds - cut); q.d0 = distM; }
        if (!useForecastWind && cond) {
          const uu = windAtRiderHeight(cond.windSpeed / 3.6, sys.z0);
          const c = windComponentsMs(uu, cond.windDirection, p.bearing);
          q.head = c.head; q.cross = c.cross;
        }
        return q;
      });
      const left = total - distM;
      const stopsLeft = stopsS * (left / total);
      const timeLeft = targetS - elapsed - stopsLeft;
      const v0 = Math.max(1, speedMs);
      const needPlan = timeLeft > 30 ? constantPlan(rest, sys, timeLeft, { v0 }) : null;
      // Schedule: where the plan says you should be at this point (plan time + share of stops).
      let planT = 0;
      if (plan?.per) {
        for (const x of plan.per) {
          if (x.d0 + x.ds <= distM) planT += x.t;
          else { if (distM > x.d0) planT += (x.t * (distM - x.d0)) / x.ds; break; }
        }
      }
      const delta = elapsed - (planT + stopsS * (distM / total)); // + behind, − ahead
      setNeed({
        watts: needPlan ? needPlan.base : null,
        feasible: needPlan ? needPlan.feasible : false,
        timeLeft,
        deltaS: delta,
        projectedS: targetS + delta,
      });
    }

    setLive({
      distM, onRoute, off: loc?.off ?? null, grade, gradeSrc, elev, course, head, cross, rho, w,
      rel: ((((w.windDirection ?? 0) - course) % 360) + 540) % 360 - 180, uKmh: u * 3.6,
      speedKmh: position.speedKmh, power: est.current.power, p3: est.current.p3, p10: est.current.p10, p30: est.current.p30,
      parts: est.current.parts, elapsed, left: total - distM, idx,
      target: plan ? plan.powerAt(idx) : null,
      avgPower: T.time ? T.work / T.time : 0,
      movingS: T.time,
      climbLeft: profile.reduce((a, p, i) => (i && p.distM > distM && p.elev > profile[i - 1].elev ? a + p.elev - profile[i - 1].elev : a), 0),
    });
  }, [position]); // eslint-disable-line react-hooks/exhaustive-deps

  return { live, cond, need };
}
