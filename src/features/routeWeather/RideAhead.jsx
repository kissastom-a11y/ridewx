/**
 * Ride page: what's coming on the road ahead.
 *   - chips: weather + a wind arrow relative to your direction of travel (nose = up),
 *     coloured by crosswind severity, ⛰ when the point is exposed high ground
 *   - elevation profile with hazard colours, wind arrows above each point and
 *     a dot for where you are now
 */
import { useMemo } from 'react';
import { haversine } from '../../lib/geo.js';
import { HAZARD_COLORS } from './hazard.js';
import { weatherIcon } from './weatherIcons.js';

const SEV = { green: '#22c55e', orange: '#f97316', red: '#dc2626' };
const fmtTime = (unix) => new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Tiny relative-wind arrow: drawn pointing DOWN from the top (= wind from ahead), rotated by θ. */
export function WindGlyph({ rel, color, size = 22, speed = 20 }) {
  const w = Math.min(4, 1.5 + speed / 15);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size}>
      <circle cx="12" cy="12" r="11" fill="none" stroke="#334155" strokeWidth="1" />
      <path d="M12 8 l3 7 l-3 -2 l-3 2 z" fill="#94a3b8" />
      <g transform={`rotate(${rel} 12 12)`}>
        <line x1="12" y1="1" x2="12" y2="6" stroke={color} strokeWidth={w} strokeLinecap="round" />
        <path d="M9 5 L15 5 L12 9 Z" fill={color} />
      </g>
    </svg>
  );
}

export default function RideAhead({ waypoints, profile, spots = [], route, position }) {
  // Where am I along the route? Nearest profile point (if within 1.5 km of the road).
  const progress = useMemo(() => {
    if (!position || !profile?.length) return null;
    let best = null;
    let bd = Infinity;
    for (const p of profile) {
      const d = haversine(position.lat, position.lon, p.lat, p.lon);
      if (d < bd) { bd = d; best = p; }
    }
    return bd < 1500 ? best.distM : null;
  }, [position, profile]);

  if (!route || !waypoints?.length) {
    return <p className="rounded-xl bg-slate-800/60 p-3 text-xs text-slate-400">Plan a route to see weather and wind on the road ahead.</p>;
  }

  const ahead = waypoints.filter((w) => progress == null || w.distM >= progress - 500);
  const total = route.distanceM;

  // ── profile geometry ──
  const W = 340;
  const H = 96;
  const top = 26; // room for wind arrows
  const pts = (profile || []).filter((p) => p.elev != null);
  const minE = pts.length ? Math.min(...pts.map((p) => p.elev)) : 0;
  const maxE = pts.length ? Math.max(...pts.map((p) => p.elev)) : 1;
  const x = (d) => (d / total) * W;
  const y = (e) => top + (H - top - 4) * (1 - (e - minE) / Math.max(maxE - minE, 30));
  let climb = 0;
  for (let i = 1; i < pts.length; i++) climb += Math.max(0, pts[i].elev - pts[i - 1].elev);
  const levelAt = (d) => {
    for (let i = 0; i < waypoints.length - 1; i++) {
      if (d <= waypoints[i + 1].distM) return Math.max(waypoints[i].hazard.level, waypoints[i + 1].hazard.level);
    }
    return waypoints[waypoints.length - 1].hazard.level;
  };

  return (
    <div className="space-y-2 rounded-xl bg-slate-800/80 p-3">
      <div className="flex justify-between text-[11px] uppercase tracking-wide text-slate-500">
        <span>Road ahead</span>
        {progress != null && <span>{((total - progress) / 1000).toFixed(0)} km to go</span>}
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {ahead.map((w, i) => (
          <div key={i} className="flex w-[68px] shrink-0 flex-col items-center rounded-lg bg-slate-900/70 py-1.5 text-[11px]"
            style={{ borderTop: `4px solid ${HAZARD_COLORS[w.hazard.level]}` }}>
            <span className="tabular-nums text-slate-400">
              {progress == null ? fmtTime(w.etaUnix) : w.distM - progress < 600 ? 'now' : `${((w.distM - progress) / 1000).toFixed(0)} km`}
            </span>
            <span className="text-xl leading-tight">{weatherIcon(w.weather.weatherCode, w.etaUnix)}</span>
            <span className="font-semibold text-white">{Math.round(w.weather.temperature)}°</span>
            <WindGlyph rel={w.wind.relAngle} color={SEV[w.wind.severity]} speed={w.weather.windSpeed} />
            <span className="tabular-nums" style={{ color: SEV[w.wind.severity] }}>
              {Math.abs(w.wind.crosswind).toFixed(0)} {w.wind.side === 'right' ? 'R' : 'L'}
            </span>
            {w.exposure?.exposed && <span title="Exposed high ground">⛰ +{Math.round((w.exposure.factor - 1) * 100)}%</span>}
          </div>
        ))}
      </div>

      {spots.filter((sp) => progress == null || sp.distM >= progress).map((sp, i) => (
        <p key={i} className="text-xs" style={{ color: sp.gusts >= 60 ? '#dc2626' : sp.gusts >= 40 ? '#f97316' : '#cbd5e1' }}>
          ⛰ Exposed crest {progress == null ? `at km ${(sp.distM / 1000).toFixed(0)}` : `in ${((sp.distM - progress) / 1000).toFixed(0)} km`}
          {' '}({Math.round(sp.elev)} m): wind ≈ {sp.wind} km/h, gusts {sp.gusts}
        </p>
      ))}
      {pts.length > 1 && (
        <div>
          <svg viewBox={`0 0 ${W} ${H + 12}`} className="w-full">
            {/* terrain area */}
            <path d={`M0 ${H} ${pts.map((p) => `L${x(p.distM).toFixed(1)} ${y(p.elev).toFixed(1)}`).join(' ')} L${W} ${H} Z`} fill="#1e293b" />
            {/* hazard-coloured ridge line */}
            {pts.slice(1).map((p, i) => (
              <line key={i} x1={x(pts[i].distM)} y1={y(pts[i].elev)} x2={x(p.distM)} y2={y(p.elev)}
                stroke={HAZARD_COLORS[levelAt(p.distM)]} strokeWidth="2.5" strokeLinecap="round" />
            ))}
            {/* wind arrows above each weather point (relative to travel, nose = up) */}
            {waypoints.map((w, i) => {
              const cx = Math.min(W - 9, Math.max(9, x(w.distM)));
              const c = SEV[w.wind.severity];
              return (
                <g key={i} transform={`translate(${cx} 11) rotate(${w.wind.relAngle})`}>
                  <line x1="0" y1="-10" x2="0" y2="2" stroke={c} strokeWidth={Math.min(3.5, 1.2 + w.weather.windSpeed / 15)} strokeLinecap="round" />
                  <path d="M-3.5 1 L3.5 1 L0 6 Z" fill={c} />
                </g>
              );
            })}
            {/* exposed crests: boosted wind/gust */}
            {spots.map((sp, i) => (
              <g key={i}>
                <text x={x(sp.distM)} y={y(sp.elev) - 5} fontSize="11" textAnchor="middle">⛰</text>
                <text x={x(sp.distM) + (x(sp.distM) > W - 60 ? -12 : 12)} y={y(sp.elev) + 2} fontSize="9"
                  textAnchor={x(sp.distM) > W - 60 ? 'end' : 'start'} fontWeight="700" stroke="#0f172a" strokeWidth="3" paintOrder="stroke"
                  fill={sp.gusts >= 60 ? '#dc2626' : sp.gusts >= 40 ? '#f97316' : '#94a3b8'}>💨{sp.wind}/{sp.gusts}</text>
              </g>
            ))}
            {/* me */}
            {progress != null && (() => {
              const near = pts.reduce((a, p) => (Math.abs(p.distM - progress) < Math.abs(a.distM - progress) ? p : a), pts[0]);
              return <circle cx={x(progress)} cy={y(near.elev)} r="5" fill="#2563eb" stroke="#fff" strokeWidth="2" />;
            })()}
            <text x="2" y={H + 10} fontSize="9" fill="#64748b">{Math.round(minE)}–{Math.round(maxE)} m</text>
            <text x={W - 2} y={H + 10} fontSize="9" fill="#64748b" textAnchor="end">↗ {Math.round(climb)} m climb</text>
          </svg>
        </div>
      )}
      <p className="text-[10px] text-slate-500">Arrows: where the wind hits you from, with your direction of travel pointing up. ⛰ = exposed ridge/pass, wind boosted.</p>
    </div>
  );
}
