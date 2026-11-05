/**
 * OSRM routing (free). Default = public demo server, which only serves the
 * `driving` profile and is meant for light/dev use (≈1 req/s, no SLA). For
 * production, self-host OSRM (Docker + Geofabrik Greece extract, ~1 GB RAM)
 * and point VITE_OSRM_URL at it – the API is identical.
 */
const OSRM_URL = import.meta.env?.VITE_OSRM_URL || 'https://router.project-osrm.org';

/**
 * @returns {Promise<{coords:{lat,lon}[], segDist:number[], segTime:number[], distanceM:number, durationS:number}>}
 */
export async function fetchRoute(origin, destination, { signal } = {}) {
  const url =
    `${OSRM_URL}/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}` +
    `?overview=full&geometries=geojson&annotations=distance,duration&steps=false`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes?.length) throw new Error(`OSRM: ${json.message || json.code}`);

  const route = json.routes[0];
  // GeoJSON is [lon, lat] – convert once here so the rest of the app is {lat, lon}.
  const coords = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));

  // Per-edge annotations, concatenated across legs. With overview=full their
  // length is coords.length − 1, i.e. one value per polyline edge.
  const segDist = route.legs.flatMap((l) => l.annotation.distance);
  const segTime = route.legs.flatMap((l) => l.annotation.duration);

  return { coords, segDist, segTime, distanceM: route.distance, durationS: route.duration };
}
