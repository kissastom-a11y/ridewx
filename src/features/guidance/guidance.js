/**
 * Turn-by-turn guidance logic (pure – testable).
 *
 * Which maneuvers deserve a voice? Real decisions only: turns, forks, ramps,
 * merges, roundabouts, end-of-road, and arrival. "Continue straight / road
 * changes name" is silent – busy riders don't need chatter.
 *
 * When to speak (distance-to-maneuver d, ground speed v):
 *   early : d ≤ 2000 m above 80 km/h, ≤ 1000 m above 50, else ≤ 500 m
 *           (only if the maneuver is far enough after the previous one)
 *   near  : d ≤ 500 m above 80 km/h, else ≤ 200 m
 *   now   : d ≤ clamp(v·4 s, 30 m, 120 m)   – about 4 seconds before
 * If another maneuver follows within 150 m, it's chained: "…και μετά, στρίψτε αριστερά".
 */
import { instructionText, maneuverText, V } from '../../lib/voice.js';

const ACTIONABLE = new Set(['turn', 'fork', 'merge', 'on ramp', 'off ramp', 'end of road', 'roundabout', 'rotary', 'roundabout turn', 'arrive']);
export const isActionable = (m) =>
  ACTIONABLE.has(m.type) || ((m.type === 'continue' || m.type === 'new name') && m.modifier && !/straight/.test(m.modifier) && /left|right|uturn/.test(m.modifier) && !/slight/.test(m.modifier));

export function thresholds(speedKmh) {
  const v = speedKmh || 0;
  return {
    early: v > 80 ? 2000 : v > 50 ? 1000 : 500,
    near: v > 80 ? 500 : 200,
    now: Math.max(30, Math.min(120, (v / 3.6) * 4)),
  };
}

/**
 * One guidance tick.
 * @param maneuvers  [{distM, type, modifier, exit, name}] sorted by distM (actionable only)
 * @param progress   metres along route
 * @param said       Set of "<index>:<stage>" already spoken (mutated)
 * @returns {{ next, dist, speech: string|null, urgent: boolean }}
 */
export function guidanceStep(maneuvers, progress, speedKmh, said) {
  const i = maneuvers.findIndex((m) => m.distM > progress + 5);
  if (i < 0) return { next: null, dist: null, speech: null, urgent: false };
  const next = maneuvers[i];
  const dist = next.distM - progress;
  const prevDist = i > 0 ? next.distM - maneuvers[i - 1].distM : Infinity;
  const t = thresholds(speedKmh);
  const after = maneuvers[i + 1];
  const chain = after && after.distM - next.distM < 150 && after.type !== 'arrive' ? `, ${V().and_then}, ${maneuverText(after)}` : '';

  let stage = null;
  if (dist <= t.now) stage = 'now';
  else if (dist <= t.near) stage = 'near';
  else if (dist <= t.early && prevDist > t.early * 1.3) stage = 'early';

  if (!stage || said.has(`${i}:${stage}`)) return { next, dist, speech: null, urgent: false };
  // Saying "now" makes the earlier stages moot; saying "near" makes "early" moot.
  said.add(`${i}:${stage}`);
  if (stage === 'now') { said.add(`${i}:near`); said.add(`${i}:early`); }
  if (stage === 'near') said.add(`${i}:early`);

  let speech;
  if (next.type === 'arrive') speech = stage === 'now' ? instructionText(next) : V().arriveIn(dist);
  else speech = instructionText(next, stage === 'now' ? null : dist).replace(/\.$/, '') + chain + '.';
  return { next, dist, speech, urgent: stage === 'now' };
}
