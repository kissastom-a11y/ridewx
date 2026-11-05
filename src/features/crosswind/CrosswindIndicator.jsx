/**
 * Aviation-style relative wind display (think HSI/ND wind arrow, but
 * vehicle-referenced: the nose is ALWAYS up).
 *
 * Drawing math:
 *   SVG angles here are measured clockwise from 12 o'clock, same as θ.
 *   The arrow is drawn once at 12 o'clock pointing DOWN toward the centre
 *   (= wind from dead ahead) and then rotated by θ about the centre. So
 *   θ = +90° rotates it to 3 o'clock pointing left: wind from the right,
 *   pushing the vehicle left. Because θ is a FROM angle, the arrow tail sits
 *   on the side the wind comes from – exactly like a METAR wind barb.
 */
import { useMemo } from 'react';
import { analyzeWind, CROSSWIND_THRESHOLDS } from '../../lib/wind.js';

const SEV_COLOR = { green: '#22c55e', orange: '#f97316', red: '#dc2626' };
const C = 100; // SVG centre

export default function CrosswindIndicator({ wind, heading, speedKmh, headingSource }) {
  const a = useMemo(
    () => (wind && heading != null ? analyzeWind(wind, heading, speedKmh || 0) : null),
    [wind, heading, speedKmh],
  );

  if (!wind) return <Shell><p className="text-xs text-slate-400">Waiting for wind data…</p></Shell>;
  if (!a) return <Shell><p className="text-xs text-slate-400">Waiting for heading – start moving…</p></Shell>;

  const color = SEV_COLOR[a.severity];
  // Arrow thickness grows with wind speed (2 px … 10 px).
  const w = Math.min(10, 2 + wind.speed / 6);

  return (
    <Shell>
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 200 200" className="h-40 w-40 shrink-0">
          {/* Compass ring with clock ticks */}
          <circle cx={C} cy={C} r={88} fill="#0f172a" stroke="#334155" strokeWidth="2" />
          {Array.from({ length: 12 }, (_, i) => (
            <line key={i} x1={C} y1={14} x2={C} y2={i % 3 === 0 ? 26 : 20} stroke="#64748b" strokeWidth={i % 3 === 0 ? 3 : 1.5}
              transform={`rotate(${i * 30} ${C} ${C})`} />
          ))}
          <text x={C} y={40} textAnchor="middle" fontSize="11" fill="#94a3b8">12</text>

          {/* Vehicle – nose up */}
          <path d={`M${C} ${C - 22} L${C + 11} ${C + 16} L${C} ${C + 9} L${C - 11} ${C + 16} Z`} fill="#e2e8f0" />

          {/* Wind arrow: drawn at 12 o'clock pointing at centre, rotated by θ */}
          <g transform={`rotate(${a.relAngle} ${C} ${C})`}>
            <line x1={C} y1={10} x2={C} y2={C - 34} stroke={color} strokeWidth={w} strokeLinecap="round" />
            <path d={`M${C - 9} ${C - 42} L${C + 9} ${C - 42} L${C} ${C - 28} Z`} fill={color} />
          </g>

          {/* Lateral push marker beside the vehicle (opposite side to wind source) */}
          {a.quadrant === 'cross' || Math.abs(a.crosswind) >= CROSSWIND_THRESHOLDS.orange ? (
            <path
              d={a.side === 'right'
                ? `M${C - 22} ${C} l-14 0 m0 0 l6 -6 m-6 6 l6 6`
                : `M${C + 22} ${C} l14 0 m0 0 l-6 -6 m6 6 l-6 6`}
              stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
          ) : null}
        </svg>

        <dl className="grid flex-1 grid-cols-2 gap-x-2 gap-y-1 text-xs">
          <Stat label={a.headwind >= 0 ? 'Headwind' : 'Tailwind'} value={`${Math.abs(a.headwind).toFixed(0)} km/h`} />
          <Stat label={`X-wind ${a.side === 'right' ? 'R' : 'L'}`} value={`${Math.abs(a.crosswind).toFixed(0)} km/h`} color={color} />
          <Stat label="Gust X-wind" value={`${Math.abs(a.gustCross).toFixed(0)} km/h`} color={color} />
          <Stat label="Clock" value={`${a.clock} o'clock`} />
          <Stat label="Wind" value={`${Math.round(wind.direction).toString().padStart(3, '0')}°/${Math.round(wind.speed)} G${Math.round(wind.gusts)}`} />
          <Stat label="Apparent" value={`${a.apparent.speed.toFixed(0)} km/h @ ${a.apparent.angle.toFixed(0)}°`} />
          {a.quadrant === 'head' && a.drag != null && (
            <div className="col-span-2 mt-1">
              {/* Headwind drag indicator: ((V+H)/V)² vs still air */}
              <div className="mb-0.5 flex justify-between text-slate-400">
                <span>Aero drag</span>
                <span className="font-semibold text-slate-100">+{Math.round((a.drag - 1) * 100)}%</span>
              </div>
              <div className="h-1.5 rounded bg-slate-700">
                <div className="h-1.5 rounded bg-sky-500" style={{ width: `${Math.min(100, (a.drag - 1) * 100)}%` }} />
              </div>
            </div>
          )}
        </dl>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">
        HDG {Math.round(heading).toString().padStart(3, '0')}°T ({headingSource}) · {Math.round(speedKmh || 0)} km/h
      </p>
    </Shell>
  );
}

function Shell({ children }) {
  return <div className="rounded-xl bg-slate-800/80 p-3 backdrop-blur">{children}</div>;
}

function Stat({ label, value, color }) {
  return (
    <div>
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-semibold tabular-nums" style={{ color: color || '#f1f5f9' }}>{value}</dd>
    </div>
  );
}
