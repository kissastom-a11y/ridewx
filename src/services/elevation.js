/**
 * Open-Meteo Elevation API (free, no key; Copernicus 90 m DEM). Max 100 points per call.
 * Returns metres for each {lat, lon}, or null entries if the request fails.
 */
export async function fetchElevations(points, { signal } = {}) {
  const out = new Array(points.length).fill(null);
  const jobs = [];
  for (let s = 0; s < points.length; s += 100) {
    const batch = points.slice(s, s + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${batch.map((p) => p.lat.toFixed(5)).join(',')}` +
      `&longitude=${batch.map((p) => p.lon.toFixed(5)).join(',')}`;
    jobs.push(
      fetch(url, { signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => j?.elevation?.forEach((e, k) => { out[s + k] = e; }))
        .catch(() => {}),
    );
  }
  await Promise.all(jobs);
  return out;
}

/**
 * Terrain exposure – how much a point sticks up above the road around it.
 *
 *   Δh = elevation(point) − mean elevation of the route within ±4 km
 *
 * Wind accelerates over ridges, passes and crests ("hill speed-up": roughly
 * ΔU/U ≈ 2·h/L for a hill of height h and half-length L). Weather models
 * smooth terrain over 2–11 km grid cells, so they under-state wind on exposed
 * high ground. We apply a conservative heuristic:
 *
 *   factor = 1 + min(0.5, max(0, Δh) / 600)      e.g. Δh = 150 m → +25 %
 *
 * and flag the point as exposed when Δh > 80 m. It is an estimate, not a
 * measurement – but it puts the warning where riders actually get pushed.
 */
export function exposureAt(profile, distM, windowM = 4000) {
  if (!profile?.length) return { elev: null, dh: 0, factor: 1, exposed: false };
  let best = profile[0];
  for (const p of profile) if (Math.abs(p.distM - distM) < Math.abs(best.distM - distM)) best = p;
  if (best.elev == null) return { elev: null, dh: 0, factor: 1, exposed: false };
  let sum = 0;
  let n = 0;
  for (const p of profile) if (p.elev != null && Math.abs(p.distM - distM) <= windowM) { sum += p.elev; n++; }
  const dh = n ? best.elev - sum / n : 0;
  return { elev: best.elev, dh, factor: 1 + Math.min(0.5, Math.max(0, dh) / 600), exposed: dh > 80 };
}
