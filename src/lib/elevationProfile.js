/**
 * elevationProfile.js – from raw DEM samples to a rideable gradient profile.
 *
 * Why not just (Δh / Δs) between samples?
 *   The Copernicus 90 m DEM (Open-Meteo elevation API) has ±1–3 m noise and
 *   "sees" bridges, cuttings and embankments as the ground beside the road.
 *   Over 50 m spacing a 2 m error is a fake 4 % ramp. So:
 *     1. Gaussian smoothing of elevation over distance (σ ≈ 60 m),
 *     2. grade from a centred difference over ±50 m,
 *     3. clamp to ±25 % (no paved road is steeper – anything more is DEM noise),
 *     4. ascent/descent totals with a 2 m hysteresis (how Garmin/Strava avoid
 *        counting noise as climbing).
 * Climbs/descents are then detected as runs of ≥ 3 % lasting ≥ 300 m.
 */
import { initialBearing } from './geo.js';

export function smoothElevation(pts, sigmaM = 60) {
  const out = pts.map((p) => ({ ...p }));
  const valid = pts.filter((p) => p.elev != null);
  if (!valid.length) return out.map((p) => ({ ...p, elev: 0 }));
  for (let i = 0; i < pts.length; i++) {
    let w = 0;
    let s = 0;
    for (let j = i; j >= 0 && pts[i].distM - pts[j].distM <= 3 * sigmaM; j--) {
      if (pts[j].elev == null) continue;
      const k = Math.exp(-(((pts[i].distM - pts[j].distM) / sigmaM) ** 2) / 2);
      w += k; s += k * pts[j].elev;
    }
    for (let j = i + 1; j < pts.length && pts[j].distM - pts[i].distM <= 3 * sigmaM; j++) {
      if (pts[j].elev == null) continue;
      const k = Math.exp(-(((pts[j].distM - pts[i].distM) / sigmaM) ** 2) / 2);
      w += k; s += k * pts[j].elev;
    }
    out[i].elev = w ? s / w : valid[0].elev;
    out[i].rawElev = pts[i].elev;
  }
  return out;
}

/**
 * pts: [{lat, lon, distM, elev}] evenly spaced along the route.
 * Returns the same points with smoothed elev, grade (fraction) and bearing.
 */
export function buildProfile(pts, { sigmaM = 60, halfWindowM = 50, maxGrade = 0.25 } = {}) {
  const sm = smoothElevation(pts, sigmaM);
  const n = sm.length;
  for (let i = 0; i < n; i++) {
    let a = i;
    let b = i;
    while (a > 0 && sm[i].distM - sm[a].distM < halfWindowM) a--;
    while (b < n - 1 && sm[b].distM - sm[i].distM < halfWindowM) b++;
    const dd = sm[b].distM - sm[a].distM;
    const g = dd > 0 ? (sm[b].elev - sm[a].elev) / dd : 0;
    sm[i].grade = Math.max(-maxGrade, Math.min(maxGrade, g));
    const j = Math.min(i + 1, n - 1);
    const k = j === i ? Math.max(0, i - 1) : i;
    sm[i].bearing = j !== k ? initialBearing(sm[k].lat, sm[k].lon, sm[j].lat, sm[j].lon) : 0;
  }
  return sm;
}

/** Total ascent / descent with hysteresis (metres). */
export function ascentDescent(profile, hysteresisM = 2) {
  let up = 0;
  let down = 0;
  if (!profile.length) return { up, down };
  let ref = profile[0].elev;
  for (const p of profile) {
    const d = p.elev - ref;
    if (d >= hysteresisM) { up += d; ref = p.elev; } else if (d <= -hysteresisM) { down -= d; ref = p.elev; }
  }
  return { up, down };
}

/** Linear interpolation of a profile field at an along-route distance. */
export function profileAt(profile, distM, field = 'elev') {
  if (!profile?.length) return null;
  if (distM <= profile[0].distM) return profile[0][field];
  const last = profile[profile.length - 1];
  if (distM >= last.distM) return last[field];
  let lo = 0;
  let hi = profile.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (profile[m].distM <= distM) lo = m; else hi = m;
  }
  const a = profile[lo];
  const b = profile[hi];
  const f = (distM - a.distM) / (b.distM - a.distM || 1);
  return a[field] + (b[field] - a[field]) * f;
}

/**
 * Climbs (sign = +1) or descents (sign = −1): runs where grade·sign ≥ minGrade,
 * gaps under `joinM` bridged, kept when ≥ minLenM long.
 */
export function findSections(profile, { sign = 1, minGrade = 0.03, minLenM = 300, joinM = 120 } = {}) {
  const runs = [];
  let cur = null;
  for (const p of profile) {
    const on = p.grade * sign >= minGrade;
    if (on) {
      if (cur && p.distM - cur.end <= joinM) cur.end = p.distM;
      else { if (cur) runs.push(cur); cur = { start: p.distM, end: p.distM }; }
    }
  }
  if (cur) runs.push(cur);
  return runs
    .filter((r) => r.end - r.start >= minLenM)
    .map((r) => {
      const inside = profile.filter((p) => p.distM >= r.start && p.distM <= r.end);
      const e0 = profileAt(profile, r.start);
      const e1 = profileAt(profile, r.end);
      return {
        start: r.start,
        end: r.end,
        length: r.end - r.start,
        gain: e1 - e0,
        avgGrade: (e1 - e0) / (r.end - r.start),
        maxGrade: sign * Math.max(...inside.map((p) => p.grade * sign)),
        top: Math.max(e0, e1),
      };
    });
}

/** Even resampling of track points every `stepM` (input: [{lat, lon, distM}]). */
export function resampleTrack(pts, stepM) {
  if (pts.length < 2) return pts;
  const out = [];
  const total = pts[pts.length - 1].distM;
  let j = 0;
  for (let d = 0; d <= total + 1e-6; d += stepM) {
    while (j < pts.length - 2 && pts[j + 1].distM < d) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const f = Math.max(0, Math.min(1, (d - a.distM) / (b.distM - a.distM || 1)));
    out.push({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, distM: d });
  }
  if (total - out[out.length - 1].distM > stepM / 3) out.push({ ...pts[pts.length - 1] });
  return out;
}
