/**
 * geo.js – spherical-earth geometry used by every feature.
 *
 * Conventions used throughout the app:
 *   - Coordinates are { lat, lon } in decimal degrees (WGS-84).
 *     NOTE: GeoJSON / OSRM use [lon, lat] order – convert at the boundary.
 *   - Bearings/headings are degrees TRUE, clockwise from north, 0..360.
 *   - Distances in metres, times in seconds.
 */

/** Mean Earth radius (IUGG), metres. Error vs. WGS-84 ellipsoid ≤ ~0.5 %. */
export const EARTH_RADIUS_M = 6371008.8;

export const toRad = (deg) => (deg * Math.PI) / 180;
export const toDeg = (rad) => (rad * 180) / Math.PI;

/** Wrap any angle into [0, 360). */
export const normalize360 = (a) => ((a % 360) + 360) % 360;

/** Wrap any angle into (-180, 180]. Used for signed angular differences. */
export const normalize180 = (a) => {
  const x = normalize360(a);
  return x > 180 ? x - 360 : x;
};

/**
 * Haversine great-circle distance.
 *
 *   a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)
 *   c = 2 · atan2(√a, √(1−a))
 *   d = R · c
 *
 * φ = latitude, λ = longitude (radians). The haversine form stays numerically
 * stable for small distances (unlike the spherical law of cosines, whose acos()
 * loses precision when the two points are only metres apart – exactly the
 * case we care about for a 500 m camera alert).
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Initial great-circle bearing (forward azimuth) from point 1 to point 2.
 *
 *   θ = atan2( sin Δλ · cos φ2 ,  cos φ1 · sin φ2 − sin φ1 · cos φ2 · cos Δλ )
 *
 * Result is degrees TRUE, 0..360. Over the few-metre to few-km distances used
 * here the initial bearing equals the rhumb-line course for practical purposes.
 */
export function initialBearing(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalize360(toDeg(Math.atan2(y, x)));
}

/** Linear interpolation between two points (fine for sub-kilometre route edges). */
export function lerpPoint(a, b, f) {
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

/**
 * Cheap bounding-box pre-filter. Returns lat/lon deltas (degrees) that enclose
 * a circle of `radiusM` around `lat`. One degree of latitude ≈ 111.32 km
 * everywhere; one degree of longitude shrinks with cos(lat).
 */
export function degreeBox(lat, radiusM) {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.max(Math.cos(toRad(lat)), 1e-6));
  return { dLat, dLon };
}

/**
 * Resample an OSRM route into weather waypoints every `intervalM` metres.
 *
 * Inputs:
 *   coords     – [{lat, lon}, ...] full route geometry (N points)
 *   segDist    – metres for each edge i→i+1           (N−1 values, OSRM annotation)
 *   segTime    – seconds for each edge i→i+1          (N−1 values, OSRM annotation)
 *
 * The ETA of every waypoint comes from OSRM's per-edge `duration` annotation,
 * which already reflects the road class speed profile (motorway vs. urban
 * street), so a waypoint 50 km out on a motorway gets an earlier ETA than one
 * 50 km out through towns. Inside an edge we interpolate time linearly with
 * distance (constant speed along a single edge).
 *
 * Output: [{ lat, lon, distM, etaS, bearing, geomIndex }]
 *   geomIndex = index of the edge the waypoint lies on, used to slice the
 *   geometry for per-segment hazard colouring on the map.
 */
export function sampleRoute(coords, segDist, segTime, intervalM = 12000) {
  const out = [];
  if (coords.length < 2) return out;

  const push = (p, distM, etaS, i) => {
    const a = coords[i];
    const b = coords[Math.min(i + 1, coords.length - 1)];
    out.push({ ...p, distM, etaS, bearing: initialBearing(a.lat, a.lon, b.lat, b.lon), geomIndex: i });
  };

  push(coords[0], 0, 0, 0);

  let cumD = 0; // distance at start of current edge
  let cumT = 0; // time at start of current edge
  let next = intervalM;

  for (let i = 0; i < coords.length - 1; i++) {
    const d = segDist[i] ?? haversine(coords[i].lat, coords[i].lon, coords[i + 1].lat, coords[i + 1].lon);
    const t = segTime[i] ?? 0;
    // Emit every waypoint that falls inside this edge (long motorway edges can hold several).
    while (d > 0 && next <= cumD + d) {
      const f = (next - cumD) / d;
      push(lerpPoint(coords[i], coords[i + 1], f), next, cumT + t * f, i);
      next += intervalM;
    }
    cumD += d;
    cumT += t;
  }

  const last = coords.length - 1;
  // Always include the destination unless a waypoint landed within 2 km of it.
  if (cumD - out[out.length - 1].distM > 2000) {
    out.push({ ...coords[last], distM: cumD, etaS: cumT, bearing: out[out.length - 1].bearing, geomIndex: last - 1 });
  }
  return out;
}
