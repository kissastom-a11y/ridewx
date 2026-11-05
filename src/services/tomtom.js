/**
 * Optional live traffic via TomTom's free plan (key from developer.tomtom.com, no card).
 * Free daily allowance: 50 000 tile requests (traffic map overlay) + 2 500 other
 * requests (the traffic-aware route check below = 1 request per planned route).
 * The key lives only in this phone's localStorage – never in the public code.
 */
export const trafficFlowTiles = (key) =>
  `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}&tileSize=256`;

export const trafficIncidentTiles = (key) =>
  `https://api.tomtom.com/traffic/map/4/tile/incidents/s3/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`;

/**
 * Traffic-aware travel time for origin → destination.
 * Returns { travelS, noTrafficS, delayS } or null if anything fails (traffic is best-effort).
 */
export async function fetchTrafficSummary(key, origin, destination, { signal, travelMode = 'car', avoidTolls = false } = {}) {
  try {
    const url =
      `https://api.tomtom.com/routing/1/calculateRoute/${origin.lat},${origin.lon}:${destination.lat},${destination.lon}/json` +
      `?key=${encodeURIComponent(key)}&traffic=true&travelMode=${travelMode}&computeTravelTimeFor=all&routeRepresentation=summaryOnly` +
      (avoidTolls ? '&avoid=tollRoads' : '');
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const s = (await res.json()).routes?.[0]?.summary;
    if (!s) return null;
    return {
      travelS: s.travelTimeInSeconds,
      noTrafficS: s.noTrafficTravelTimeInSeconds ?? s.travelTimeInSeconds - (s.trafficDelayInSeconds || 0),
      delayS: s.trafficDelayInSeconds || 0,
    };
  } catch {
    return null;
  }
}

/** Quick key check: fetch one tile over Athens. */
export async function testTrafficKey(key) {
  try {
    const res = await fetch(trafficFlowTiles(key).replace('{z}', '10').replace('{x}', '579').replace('{y}', '395'));
    return res.ok;
  } catch {
    return false;
  }
}
