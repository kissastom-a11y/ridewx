import { HAZARD_COLORS, HAZARD_LABELS } from './hazard.js';

const fmtTime = (unix) => new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function RouteWeatherPanel({ route, waypoints, onSelect, onStart }) {
  if (!route) return null;
  const worst = Math.max(0, ...waypoints.map((w) => w.hazard.level));

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-sm text-slate-300">
        <span>
          {(route.distanceM / 1000).toFixed(0)} km · {Math.round(route.durationS / 60)} min
        </span>
        <span className="font-semibold" style={{ color: HAZARD_COLORS[worst] }}>
          Worst: {HAZARD_LABELS[worst]}
        </span>
      </div>
      {route.traffic ? (
        <p className={`text-xs font-semibold ${route.traffic.delayS > 300 ? 'text-orange-400' : 'text-emerald-400'}`}>
          🚦 Live traffic: {route.traffic.delayS >= 60 ? `+${Math.round(route.traffic.delayS / 60)} min delay` : 'no delays'}
          {' · '}arrive ≈ {fmtTime(route.startUnix + route.durationS)}
        </p>
      ) : (
        <p className="text-xs text-slate-500">Arrive ≈ {fmtTime(route.startUnix + route.durationS)} (no live traffic – tap 🚦 to enable)</p>
      )}
      {onStart && (
        <button onClick={onStart} className="w-full rounded-lg bg-emerald-600 py-2.5 font-semibold text-white active:bg-emerald-700">
          ▶ Start ride
        </button>
      )}
      <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {waypoints.map((w, i) => (
          <li key={i}>
            <button
              onClick={() => onSelect?.(w)}
              className="flex w-full items-center gap-2 rounded-md bg-slate-800/70 px-2 py-1.5 text-left text-xs text-slate-200"
            >
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: HAZARD_COLORS[w.hazard.level] }} />
              <span className="w-12 shrink-0 tabular-nums text-slate-400">{fmtTime(w.etaUnix)}</span>
              <span className="w-12 shrink-0 tabular-nums">{(w.distM / 1000).toFixed(0)} km</span>
              <span className="w-10 shrink-0 tabular-nums">{Math.round(w.weather.temperature)}°</span>
              <span className="shrink-0 tabular-nums">
                {Math.round(w.weather.windSpeed)}/{Math.round(w.weather.windGusts)}
              </span>
              <span className="truncate text-slate-400">{w.hazard.reasons[0] || '—'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
