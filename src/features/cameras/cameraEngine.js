/**
 * cameraEngine.js – Feature 3 Haversine proximity engine (pure, testable).
 *
 * ─────────────────────── PER-FIX LOOP (runs once per GPS fix) ───────────────────────
 *   1. SPATIAL HASH lookup  – O(1): only cameras in the 3×3 grid cells around us.
 *      A national dataset can hold thousands of nodes; haversine on all of
 *      them every second is wasteful on a phone. Cells are 0.02° (≈2.2 km N-S),
 *      so the 3×3 block always covers the 800 m re-arm radius.
 *   2. HAVERSINE distance   – exact great-circle metres for each candidate.
 *   3. RELEVANCE filter     – is the camera AHEAD of us and does it enforce OUR
 *      direction of travel? (Avoids alerting for the opposite carriageway or
 *      a camera we've already passed.)
 *   4. STATE MACHINE per camera, with hysteresis so GPS jitter around the
 *      500 m boundary doesn't fire repeated alarms:
 *
 *        IDLE ──(d ≤ 500 m & relevant)──▶ ALERTED ──(d grows 60 m past min)──▶ PASSED
 *          ▲                                                                       │
 *          └──────────────────────────(d > 800 m)──────────────────────────────────┘
 *
 *      Only IDLE→ALERTED produces a sound. ALERTED cameras stay on screen with a
 *      live countdown distance. PASSED cameras are silent until we're 800 m away.
 */
import { haversine, initialBearing, normalize180 } from '../../lib/geo.js';

export const ALERT_RADIUS_M = 500;
export const REARM_RADIUS_M = 800;
export const PASSED_MARGIN_M = 60; // distance must grow this much past the minimum to count as "passed"
export const AHEAD_HALF_ANGLE = 60; // camera must be within ±60° of our heading
export const DIRECTION_TOLERANCE = 45; // our heading vs. camera's enforced direction
const CELL = 0.02; // degrees

const key = (lat, lon) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;

/** GeoJSON FeatureCollection → flat camera list + spatial hash. */
export function indexCameras(geojson) {
  const cameras = (geojson.features || [])
    .filter((f) => f.geometry?.type === 'Point')
    .map((f, i) => {
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties || {};
      return {
        id: p.id ?? `cam-${i}`,
        lat,
        lon,
        type: p.type || 'speed_camera',
        name: p.name || '',
        maxspeed: p.maxspeed ?? null,
        direction: Number.isFinite(p.direction) ? p.direction : null,
        // Zones alert on entering their radius; point cameras at 500 m.
        alertRadius: p.type === 'enforcement_zone' ? Math.max(ALERT_RADIUS_M, p.radius_m || 0) : ALERT_RADIUS_M,
      };
    });
  const grid = new Map();
  for (const c of cameras) {
    const k = key(c.lat, c.lon);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(c);
  }
  return { cameras, grid };
}

function candidates(grid, lat, lon) {
  const r = Math.floor(lat / CELL);
  const c = Math.floor(lon / CELL);
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const cell = grid.get(`${r + dr}:${c + dc}`);
    if (cell) out.push(...cell);
  }
  return out;
}

/**
 * Is this camera relevant to us right now?
 *   Ahead test:   β = bearing(me → camera);  |normalize180(β − heading)| ≤ 60°
 *   Direction:    |normalize180(heading − camera.direction)| ≤ 45°
 * Without a heading (stationary, no GNSS course) we can't tell, so we fail
 * SAFE and treat the camera as relevant.
 */
export function isRelevant(cam, pos, distanceM) {
  if (cam.type === 'enforcement_zone' || pos.heading == null) return true;
  if (cam.direction != null && Math.abs(normalize180(pos.heading - cam.direction)) > DIRECTION_TOLERANCE) return false;
  if (distanceM < 80) return true; // bearing to a point we're about to pass is unstable
  const β = initialBearing(pos.lat, pos.lon, cam.lat, cam.lon);
  return Math.abs(normalize180(β - pos.heading)) <= AHEAD_HALF_ANGLE;
}

/**
 * One loop iteration.
 * @param memory Map<id, {phase:'alerted'|'passed', minDist:number}>  (mutated)
 * @returns {{ newAlerts: object[], active: object[] }}
 */
export function proximityStep(index, memory, pos) {
  const newAlerts = [];
  const active = [];
  const seen = new Set();

  for (const cam of candidates(index.grid, pos.lat, pos.lon)) {
    const d = haversine(pos.lat, pos.lon, cam.lat, cam.lon);
    const m = memory.get(cam.id);
    seen.add(cam.id);

    if (!m) {
      if (d <= cam.alertRadius && isRelevant(cam, pos, d)) {
        memory.set(cam.id, { phase: 'alerted', minDist: d });
        const hit = { ...cam, distance: d };
        newAlerts.push(hit);
        active.push(hit);
      }
      continue;
    }

    if (d > cam.alertRadius + (REARM_RADIUS_M - ALERT_RADIUS_M)) {
      memory.delete(cam.id); // re-arm
      continue;
    }
    if (m.phase === 'alerted') {
      m.minDist = Math.min(m.minDist, d);
      if (d > m.minDist + PASSED_MARGIN_M) m.phase = 'passed';
      else active.push({ ...cam, distance: d });
    }
  }
  // Cameras that left the 3×3 neighbourhood are far away – re-arm them.
  for (const id of memory.keys()) if (!seen.has(id)) memory.delete(id);

  active.sort((a, b) => a.distance - b.distance);
  return { newAlerts, active };
}
