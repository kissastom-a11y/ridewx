/**
 * track.js – a densely resampled copy of the route (every ~100 m) with
 * cumulative distance, plus a spatial grid so "where on the route is this
 * point?" is O(1). Used for: matching OSM features to the route, the rider's
 * progress along the route, and slicing geometry for overlays.
 */
import { sampleRoute } from './geo.js';

const CELL = 0.005; // ≈ 550 m
const key = (lat, lon) => `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;

/** Fast local distance (equirectangular) – accurate to <0.1 % below a few km. */
export function fastDist(lat1, lon1, lat2, lon2) {
  const k = Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dx = (lon2 - lon1) * k * 111320;
  const dy = (lat2 - lat1) * 111320;
  return Math.sqrt(dx * dx + dy * dy);
}

export function buildTrack(route, spacingM = 100) {
  const step = Math.max(spacingM, route.distanceM / 4000); // cap at ~4000 points
  const pts = sampleRoute(route.coords, route.segDist, route.segTime, step).map((p) => ({ lat: p.lat, lon: p.lon, distM: p.distM }));
  const grid = new Map();
  pts.forEach((p, i) => {
    const k = key(p.lat, p.lon);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  return { pts, grid, step, total: route.distanceM };
}

/**
 * Where is (lat, lon) relative to the route? Finds the nearest track point via
 * the grid, then projects onto the two neighbouring segments – so a point that
 * is ON the road between two samples reads as 0 m off (not up to half the
 * sample spacing, which was a real bug: features mid-way between samples were
 * rejected as "off route").
 * Returns { distM (along route), off (metres from the route line) } or null.
 */
export function locateOnTrack(track, lat, lon) {
  if (!track) return null;
  const r = Math.floor(lat / CELL);
  const c = Math.floor(lon / CELL);
  let bi = -1;
  let bd = Infinity;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const ids = track.grid.get(`${r + dr}:${c + dc}`);
    if (!ids) continue;
    for (const i of ids) {
      const p = track.pts[i];
      const d = fastDist(lat, lon, p.lat, p.lon);
      if (d < bd) { bd = d; bi = i; }
    }
  }
  if (bi < 0) return null;
  let best = { distM: track.pts[bi].distM, off: bd };
  // Local flat projection (metres) around the query point.
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 111320;
  for (const j of [bi - 1, bi]) {
    const a = track.pts[j];
    const b = track.pts[j + 1];
    if (!a || !b) continue;
    const ax = (a.lon - lon) * kx, ay = (a.lat - lat) * ky;
    const bx = (b.lon - lon) * kx, by = (b.lat - lat) * ky;
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len2)); // projection of the query point (origin)
    const off = Math.hypot(ax + t * vx, ay + t * vy);
    if (off < best.off) best = { distM: a.distM + t * (b.distM - a.distM), off };
  }
  return best;
}

/** Geometry of the route between two along-route distances, as [lon, lat] pairs. */
export function sliceTrack(track, fromM, toM) {
  return track.pts.filter((p) => p.distM >= fromM - track.step / 2 && p.distM <= toM + track.step / 2).map((p) => [p.lon, p.lat]);
}

/** Merge overlapping/adjacent [a, b] ranges (gap ≤ joinM). */
export function mergeRanges(ranges, joinM = 150) {
  const s = [...ranges].sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + joinM) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}
