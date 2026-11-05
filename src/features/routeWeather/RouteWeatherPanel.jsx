/**
 * Route results, weather first:
 *   - trip line (distance · time · arrival · traffic)
 *   - 🏁 destination card: weather AT ARRIVAL TIME
 *   - swipeable timeline of weather along the way (each point at the time you'll pass it)
 *   - main hazards on the way
 *   - ▶ Start ride, and a collapsible detail list
 */
import { t } from '../../lib/i18n.js';
import { useState } from 'react';
import { HAZARD_COLORS, HAZARD_LABELS } from './hazard.js';
import { weatherIcon, weatherText, compass } from './weatherIcons.js';
import { WindGlyph } from './RideAhead.jsx';

const SEV = { green: '#22c55e', orange: '#f97316', red: '#dc2626' };

const fmtTime = (unix) => new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} ${t('h')} ${Math.round((s % 3600) / 60)} ${t('min')}` : `${Math.round(s / 60)} ${t('min')}`);

export default function RouteWeatherPanel({ route, waypoints, destName, onSelect, onStart }) {
  const [details, setDetails] = useState(false);
  if (!route || !waypoints.length) return null;

  const dest = waypoints[waypoints.length - 1];
  const dw = dest.weather;
  const arrive = route.startUnix + route.durationS;
  const worst = Math.max(0, ...waypoints.map((w) => w.hazard.level));
  // Distinct hazards on the way (first km where each appears), most severe first.
  const hazards = [];
  for (const w of waypoints) for (const r of w.hazard.reasons) {
    const kind = r.split(/[ ,]/)[0];
    if (!hazards.some((h) => h.kind === kind)) hazards.push({ kind, text: r, km: w.distM / 1000, level: w.hazard.level });
  }
  hazards.sort((a, b) => b.level - a.level);

  return (
    <div className="space-y-3">
      {/* Trip line */}
      <div className="text-sm text-slate-300">
        <span className="font-semibold text-white">{fmtDur(route.durationS)}</span> · {(route.distanceM / 1000).toFixed(0)} {t('km')} · {t('arrive')}{' '}
        <span className="font-semibold text-white">{fmtTime(arrive)}</span>
        {route.traffic ? (
          <span className={route.traffic.delayS > 300 ? 'text-orange-400' : 'text-emerald-400'}>
            {' '}· 🚦 {route.traffic.delayS >= 60 ? t('+{n} min traffic', { n: Math.round(route.traffic.delayS / 60) }) : t('no traffic delays')}
          </span>
        ) : null}
      </div>

      {/* Destination at arrival */}
      <button onClick={() => onSelect?.(dest)}
        className="flex w-full items-center gap-3 rounded-xl p-3 text-left"
        style={{ background: `${HAZARD_COLORS[dest.hazard.level]}1f`, border: `2px solid ${HAZARD_COLORS[dest.hazard.level]}` }}>
        <span className="text-5xl leading-none">{weatherIcon(dw.weatherCode, arrive)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-slate-400">🏁 {destName ? t(destName) : t('Destination')} · {t('at')} {fmtTime(arrive)}</div>
          <div className="text-2xl font-bold text-white">{Math.round(dw.temperature)}°C <span className="text-base font-medium text-slate-300">{weatherText(dw.weatherCode)}</span></div>
          <div className="text-xs text-slate-300">
            💨 {Math.round(dw.windSpeed)} {t('km/h')} {compass(dw.windDirection)}, {t('gusts')} {Math.round(dw.windGusts)}
            {dw.precipitation >= 0.1 && <> · 💧 {dw.precipitation.toFixed(1)} mm/h</>}
            {dw.visibility < 5000 && <> · 👁 {(dw.visibility / 1000).toFixed(1)} {t('km')}</>}
          </div>
        </div>
      </button>

      {/* Timeline along the way */}
      <div>
        <div className="mb-1 flex justify-between text-[11px] uppercase tracking-wide text-slate-500">
          <span>{t('Weather on the way')}</span>
          <span style={{ color: HAZARD_COLORS[worst] }}>{t(HAZARD_LABELS[worst])}</span>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {waypoints.map((w, i) => (
            <button key={i} onClick={() => onSelect?.(w)}
              className="flex w-16 shrink-0 flex-col items-center rounded-lg bg-slate-800 py-1.5 text-xs"
              style={{ borderTop: `4px solid ${HAZARD_COLORS[w.hazard.level]}` }}>
              <span className="tabular-nums text-slate-400">{fmtTime(w.etaUnix)}</span>
              <span className="text-2xl leading-tight">{weatherIcon(w.weather.weatherCode, w.etaUnix)}</span>
              <span className="font-semibold tabular-nums text-white">{Math.round(w.weather.temperature)}°</span>
              <WindGlyph rel={w.wind.relAngle} color={SEV[w.wind.severity]} speed={w.weather.windSpeed} size={20} />
              {w.exposure?.exposed && <span className="text-[10px]">⛰</span>}
              <span className="tabular-nums text-[10px] text-slate-500">{i === waypoints.length - 1 ? '🏁' : `${(w.distM / 1000).toFixed(0)} ${t('km')}`}</span>
            </button>
          ))}
        </div>
      </div>

      {hazards.length > 0 && (
        <ul className="space-y-0.5 text-xs">
          {hazards.slice(0, 4).map((h) => (
            <li key={h.kind} style={{ color: HAZARD_COLORS[h.level] }}>⚠️ {h.text} <span className="text-slate-500">{t('from km {n}', { n: h.km.toFixed(0) })}</span></li>
          ))}
        </ul>
      )}

      {onStart && (
        <button onClick={onStart} className="w-full rounded-lg bg-emerald-600 py-2.5 font-semibold text-white active:bg-emerald-700">
          {t('▶ Start ride')}
        </button>
      )}

      <button onClick={() => setDetails((d) => !d)} className="text-xs text-slate-500 underline">
        {details ? t('Hide details') : t('Show details for every point')}
      </button>
      {details && (
        <ul className="space-y-1">
          {waypoints.map((w, i) => (
            <li key={i}>
              <button onClick={() => onSelect?.(w)}
                className="flex w-full items-center gap-2 rounded-md bg-slate-800/70 px-2 py-1.5 text-left text-xs text-slate-200">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: HAZARD_COLORS[w.hazard.level] }} />
                <span className="w-11 shrink-0 tabular-nums text-slate-400">{fmtTime(w.etaUnix)}</span>
                <span className="w-11 shrink-0 tabular-nums">{(w.distM / 1000).toFixed(0)} {t('km')}</span>
                <span className="w-9 shrink-0 tabular-nums">{Math.round(w.weather.temperature)}°</span>
                <span className="shrink-0 tabular-nums">💨{Math.round(w.weather.windSpeed)}/{Math.round(w.weather.windGusts)}</span>
                <span className="truncate text-slate-400">{w.hazard.reasons[0] || weatherText(w.weather.weatherCode)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
