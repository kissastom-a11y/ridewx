/**
 * wind.js – Feature 2: aviation-style relative wind & crosswind algorithm.
 *
 * ───────────────────────── THE CONVENTION ─────────────────────────
 * Open-Meteo `wind_direction_10m` follows the meteorological/aviation rule:
 * the direction the wind is blowing FROM, degrees TRUE. "270° / 30 km/h" is a
 * westerly – air arriving from the west, moving east. GPS course
 * (`coords.heading`) is also degrees TRUE, so the two can be subtracted
 * directly with no magnetic variation correction.
 *
 *   (If you ever feed in a MAGNETIC heading – e.g. from a phone compass via
 *    DeviceOrientationEvent – convert first: true = magnetic + variation(East +).
 *    Athens is ≈ +5° E today. Mixing true and magnetic is the same error as
 *    using a METAR wind (true) against a runway QDM (magnetic) without care.)
 *
 * ───────────────────────── RELATIVE ANGLE ─────────────────────────
 *     θ = normalize180( WindFrom − Heading )            θ ∈ (−180°, +180°]
 *
 *     θ =    0°  → wind from dead ahead    (12 o'clock, pure headwind)
 *     θ =  +90°  → wind from the RIGHT     ( 3 o'clock, pure crosswind)
 *     θ =  −90°  → wind from the LEFT      ( 9 o'clock, pure crosswind)
 *     θ = ±180°  → wind from behind        ( 6 o'clock, pure tailwind)
 *
 * Normalising to ±180° matters: heading 350°, wind 010° gives a raw
 * difference of −340°, which is really +20° (slightly right of the nose).
 *
 * ───────────────────────── COMPONENTS ─────────────────────────
 * Exactly the runway wind-component chart from the cockpit, with the vehicle
 * axis in place of the runway centreline:
 *
 *     Headwind  H = W · cos θ      (+ = headwind, − = tailwind)
 *     Crosswind X = W · sin θ      (+ = from right, − = from left)
 *
 * Gusts are resolved the same way: Xg = G · sin θ. A rider feels the gust
 * crosswind, not the mean, so severity is graded on max(|X|, |Xg|).
 *
 * ───────────────────────── APPARENT WIND ─────────────────────────
 * What actually hits the vehicle is the vector sum of the true wind and the
 * "wind of motion" (air coming from dead ahead at ground speed V). In a
 * vehicle frame with x = right, y = forward:
 *
 *   true wind velocity (where the air goes) = −W · (sin θ, cos θ)
 *   motion-induced air velocity             = (0, −V)
 *   apparent air velocity                   = (−W sin θ, −W cos θ − V)
 *
 *   apparent speed  Va = √[ (W sin θ)² + (W cos θ + V)² ]
 *   apparent angle  θa = atan2( W sin θ ,  W cos θ + V )    (FROM, like θ)
 *
 * The lateral component (W sin θ) is unchanged by speed – but as V grows the
 * apparent wind swings toward the nose, which is why a crosswind feels like a
 * "yaw angle" (β ≈ θa) on a motorbike at speed.
 *
 * ───────────────────────── DRAG ─────────────────────────
 * Aerodynamic drag ∝ ½ρ·Cd·A·Vair², and for the longitudinal axis
 * Vair = V + H. Compared with still air the drag force ratio is
 *     ((V + H) / V)²
 * so a 30 km/h headwind at 90 km/h → (120/90)² = 1.78 → +78 % drag (and,
 * since power = F·V, roughly +78 % aerodynamic power at the same ground speed).
 */
import { normalize180, normalize360, toRad, toDeg } from './geo.js';

/** θ = WindFrom − Heading, wrapped to (−180, 180]. */
export function relativeWindAngle(windFromDeg, headingDeg) {
  return normalize180(windFromDeg - headingDeg);
}

/** Resolve wind speed W at relative angle θ into head/cross components. */
export function windComponents(speed, relAngleDeg) {
  const θ = toRad(relAngleDeg);
  return {
    headwind: speed * Math.cos(θ), // + head / − tail
    crosswind: speed * Math.sin(θ), // + from right / − from left
  };
}

/** Apparent (felt) wind given true wind and ground speed (same units). */
export function apparentWind(windSpeed, relAngleDeg, groundSpeed) {
  const θ = toRad(relAngleDeg);
  const lateral = windSpeed * Math.sin(θ);
  const longitudinal = windSpeed * Math.cos(θ) + groundSpeed;
  return {
    speed: Math.hypot(lateral, longitudinal),
    angle: toDeg(Math.atan2(lateral, longitudinal)), // FROM, relative to nose, ±180
  };
}

/** Clock position (1..12) for a relative angle – how pilots call traffic & wind. */
export function clockPosition(relAngleDeg) {
  const h = Math.round(normalize360(relAngleDeg) / 30) % 12;
  return h === 0 ? 12 : h;
}

/** Drag ratio vs. still air ((V+H)/V)²; null when too slow to be meaningful. */
export function dragFactor(groundSpeedKmh, headwindKmh) {
  if (groundSpeedKmh < 15) return null;
  const v = Math.max(groundSpeedKmh + headwindKmh, 0);
  return (v / groundSpeedKmh) ** 2;
}

/** Thresholds from the spec (km/h). Exported so the UI legend reads the same numbers. */
export const CROSSWIND_THRESHOLDS = { orange: 20, red: 40, gustSpread: 25 };

/**
 * Severity:
 *   green  : effective crosswind < 20 km/h
 *   orange : 20–40 km/h
 *   red    : > 40 km/h, OR gusty (gust − mean ≥ 25 km/h) with crosswind ≥ 20
 * "Effective" = the larger of mean and gust crosswind components.
 */
export function crosswindSeverity(crossKmh, gustCrossKmh, windKmh = 0, gustKmh = 0) {
  const eff = Math.max(Math.abs(crossKmh), Math.abs(gustCrossKmh));
  const gusty = gustKmh - windKmh >= CROSSWIND_THRESHOLDS.gustSpread;
  if (eff > CROSSWIND_THRESHOLDS.red || (gusty && eff >= CROSSWIND_THRESHOLDS.orange)) return 'red';
  if (eff >= CROSSWIND_THRESHOLDS.orange) return 'orange';
  return 'green';
}

/**
 * One-call analysis used by the UI.
 * @param {{speed:number, direction:number, gusts:number}} wind  km/h, deg FROM true
 * @param {number} headingDeg   vehicle course, deg true
 * @param {number} groundSpeedKmh
 */
export function analyzeWind(wind, headingDeg, groundSpeedKmh = 0) {
  const rel = relativeWindAngle(wind.direction, headingDeg);
  const { headwind, crosswind } = windComponents(wind.speed, rel);
  const gustCross = windComponents(wind.gusts ?? wind.speed, rel).crosswind;
  const quadrant = Math.abs(rel) <= 45 ? 'head' : Math.abs(rel) >= 135 ? 'tail' : 'cross';
  return {
    relAngle: rel,
    clock: clockPosition(rel),
    quadrant,
    headwind,
    crosswind,
    gustCross,
    side: crosswind >= 0 ? 'right' : 'left',
    severity: crosswindSeverity(crosswind, gustCross, wind.speed, wind.gusts ?? wind.speed),
    apparent: apparentWind(wind.speed, rel, groundSpeedKmh),
    drag: dragFactor(groundSpeedKmh, headwind),
  };
}
