/**
 * OSRM routing (free). Default = public demo server (`driving` profile, light use,
 * no SLA). For production, self-host OSRM and set VITE_OSRM_URL – same API.
 *
 * Options:
 *   exclude: ['toll'] / ['motorway'] – the car profile supports excluding
 *            toll, motorway and ferry classes at query time.
 *
 * We also ask for steps so we can read each intersection's road `classes`
 * (toll, motorway, ferry, tunnel…). A class applies to the road from that
 * intersection up to the next one – that's how we know which km are tolled
 * and where the tunnels are.
 */
const OSRM_URL = import.meta.env?.VITE_OSRM_URL || 'https://router.project-osrm.org';

export async function fetchRoute(origin, destination, { signal, exclude = [] } = {}) {
  const url =
    `${OSRM_URL}/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}` +
    `?overview=full&geometries=geojson&annotations=distance,duration&steps=true` +
    (exclude.length ? `&exclude=${exclude.join(',')}` : '');

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes?.length) throw new Error(`OSRM: ${json.message || json.code}`);

  const route = json.routes[0];
  // GeoJSON is [lon, lat] – convert once here so the rest of the app is {lat, lon}.
  const coords = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));

  // Per-edge annotations, concatenated across legs (one value per polyline edge).
  const segDist = route.legs.flatMap((l) => l.annotation.distance);
  const segTime = route.legs.flatMap((l) => l.annotation.duration);

  // Every intersection in order, with the classes of the road leaving it.
  const intersections = [];
  for (const leg of route.legs) for (const step of leg.steps || []) for (const x of step.intersections || []) {
    intersections.push({ lon: x.location[0], lat: x.location[1], classes: x.classes || [] });
  }

  return { coords, segDist, segTime, distanceM: route.distance, durationS: route.duration, intersections };
}

/**
 * Turn the intersection list into along-route km ranges per class, using a
 * locator (lat, lon) → distM on the route.
 * @returns {{ toll: [a,b][], tunnel: [a,b][], motorway: [a,b][], ferry: [a,b][] }}
 */
export function classRanges(intersections, locate, totalM) {
  const out = { toll: [], tunnel: [], motorway: [], ferry: [] };
  const located = intersections
    .map((x) => ({ ...x, d: locate(x.lat, x.lon)?.distM }))
    .filter((x) => x.d != null)
    .sort((a, b) => a.d - b.d);
  for (let i = 0; i < located.length; i++) {
    const a = located[i].d;
    const b = i + 1 < located.length ? located[i + 1].d : totalM;
    if (b <= a) continue;
    for (const c of located[i].classes) if (out[c]) out[c].push([a, b]);
  }
  return out;
}
