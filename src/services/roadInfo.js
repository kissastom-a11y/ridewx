/**
 * Road info along a route from OpenStreetMap via the free Overpass API:
 *   - unpaved stretches (surface=gravel/dirt/… or highway=track)
 *   - tunnels (tunnel=yes on highways)
 *   - speed cameras (highway=speed_camera), with maxspeed / direction when tagged
 *   - speed limits (maxspeed on the roads you'll drive; Greek defaults for motorway/trunk)
 *
 * One query, using Overpass's "around a polyline" filter on a simplified copy of
 * the route. Then every OSM way is MATCHED against the route: it only counts if
 * at least 2 of its nodes lie within 25 m of the route and they span ≥ 80 m.
 * That rejects dirt side-roads that merely CROSS the route at a junction.
 *
 * Best-effort: on any failure we return empty info and the rest of the app works.
 */
import { locateOnTrack, mergeRanges, fastDist } from '../lib/track.js';
import { parseMaxspeed } from './speedLimit.js';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UNPAVED = 'unpaved|gravel|fine_gravel|dirt|ground|earth|sand|mud|compacted|grass|pebblestone|rock|gravel;ground';

function polylineArg(track, maxPts = 450) {
  const step = Math.max(1, Math.ceil(track.pts.length / maxPts));
  const pts = track.pts.filter((_, i) => i % step === 0);
  pts.push(track.pts[track.pts.length - 1]);
  return pts.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(',');
}

async function overpass(query, signal) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', body: `data=${encodeURIComponent(query)}`, signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (res.ok) return await res.json();
      lastErr = new Error(`Overpass HTTP ${res.status}`);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Match an OSM way's nodes to the route → [fromM, toM] or null. */
function matchWay(track, geometry, tolM = 25) {
  const hits = [];
  for (const n of geometry || []) {
    const loc = locateOnTrack(track, n.lat, n.lon);
    if (loc && loc.off <= tolM) hits.push(loc.distM);
  }
  if (hits.length < 2) return null;
  const a = Math.min(...hits);
  const b = Math.max(...hits);
  return b - a >= 80 ? [a, b] : null;
}

/** Camera direction tag → degrees true, or null (both ways / unknown). */
function parseDirection(tag) {
  if (tag == null) return null;
  const n = parseFloat(tag);
  if (Number.isFinite(n)) return ((n % 360) + 360) % 360;
  const card = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
  return card[String(tag).toUpperCase()] ?? null;
}

export async function fetchRoadInfo(track, { signal } = {}) {
  const line = polylineArg(track);
  const q = `[out:json][timeout:25];
(
  way(around:25,${line})[highway][surface~"^(${UNPAVED})$"];
  way(around:25,${line})[highway=track];
  way(around:25,${line})[highway][tunnel=yes];
  node(around:60,${line})[highway=speed_camera];
  way(around:20,${line})[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"][maxspeed];
  way(around:20,${line})[highway~"^(motorway|trunk)$"][!maxspeed];
);
out tags geom qt;`;
  const json = await overpass(q, signal);

  const unpaved = [];
  const tunnels = [];
  const cameras = [];
  const speeds = [];
  const unpavedRe = new RegExp(`^(${UNPAVED})$`);
  for (const el of json.elements || []) {
    const t = el.tags || {};
    if (el.type === 'way') {
      const r = matchWay(track, el.geometry);
      if (!r) continue;
      // One way can be several things at once (a motorway tunnel with a limit).
      if (t.tunnel === 'yes') tunnels.push({ range: r, name: t.name || t['tunnel:name'] || '' });
      if (t.highway === 'track' || (t.surface && unpavedRe.test(t.surface))) unpaved.push({ range: r, surface: t.surface || 'track' });
      const lim = parseMaxspeed(t.maxspeed, t.highway);
      if (lim) speeds.push({ from: r[0], to: r[1], ...lim });
    } else if (el.type === 'node' && t.highway === 'speed_camera') {
      const loc = locateOnTrack(track, el.lat, el.lon);
      if (!loc || loc.off > 60) continue;
      cameras.push({
        id: `osm-${el.id}`,
        lat: el.lat,
        lon: el.lon,
        distM: loc.distM,
        type: 'speed_camera',
        maxspeed: parseInt(t.maxspeed, 10) || null,
        direction: parseDirection(t.direction),
        name: t.name || 'Speed camera (OSM)',
        alertRadius: 500,
        source: 'osm',
      });
    }
  }

  // Merge pieces of the same tunnel / dirt stretch (OSM splits ways often).
  const tunnelRanges = mergeRanges(tunnels.map((x) => x.range), 60).map(([a, b]) => ({
    from: a, to: b, lengthM: b - a,
    name: tunnels.find((x) => x.range[0] <= b && x.range[1] >= a && x.name)?.name || '',
  }));
  const unpavedRanges = mergeRanges(unpaved.map((x) => x.range), 300).map(([a, b]) => ({
    from: a, to: b, lengthM: b - a,
    surface: unpaved.find((x) => x.range[0] <= b && x.range[1] >= a)?.surface || 'unpaved',
  })).filter((r) => r.lengthM >= 150);

  // De-duplicate cameras mapped twice (e.g. one node per carriageway within 30 m).
  const cams = [];
  for (const c of cameras.sort((a, b) => a.distM - b.distM)) {
    if (!cams.some((k) => fastDist(k.lat, k.lon, c.lat, c.lon) < 30)) cams.push(c);
  }
  return { unpaved: unpavedRanges, tunnels: tunnelRanges, cameras: cams, speeds };
}
