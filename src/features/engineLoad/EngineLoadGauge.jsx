/**
 * Feature 4 UI: 3-state engine load display + estimated consumption + fill-up calibration.
 * Settings and the fuel-since-last-fill-up counter persist in localStorage.
 */
import { useCallback, useRef, useState } from 'react';
import { DEFAULTS, updateCorrection } from './engineDsp.js';
import { useEngineAudio } from './useEngineAudio.js';

const KEY = 'ridewx.engine.v1';
const load = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
};
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } };

const initial = () => load() || { vehicle: 'car', ...DEFAULTS.car, correction: 1, litresSinceFill: 0, fills: 0 };

const STATE = {
  green: { color: '#22c55e', label: 'CRUISE', sub: 'Low load' },
  orange: { color: '#f97316', label: 'LOAD', sub: 'Moderate / climbing' },
  red: { color: '#dc2626', label: 'HEAVY', sub: 'Wide-open throttle' },
};

export default function EngineLoadGauge({ speedKmh }) {
  const [cfg, setCfg] = useState(initial);
  const [showSettings, setShowSettings] = useState(false);
  const [refuel, setRefuel] = useState('');
  const baseRef = useRef(cfg.litresSinceFill);

  const update = (patch) => setCfg((c) => { const n = { ...c, ...patch }; save(n); return n; });

  const onTripUpdate = useCallback((sessionLitres) => {
    setCfg((c) => { const n = { ...c, litresSinceFill: baseRef.current + sessionLitres }; save(n); return n; });
  }, []);

  const { snap, status, error, start, stop } = useEngineAudio({ speedKmh, settings: cfg, onTripUpdate });
  const on = status === 'on';

  const begin = () => { baseRef.current = cfg.litresSinceFill; start(); };

  const applyRefuel = () => {
    const litres = parseFloat(refuel.replace(',', '.'));
    if (!(litres > 0)) return;
    update({ correction: updateCorrection(cfg.correction, litres, cfg.litresSinceFill), litresSinceFill: 0, fills: cfg.fills + 1 });
    setRefuel('');
  };

  const st = snap && !snap.calibrating ? STATE[snap.state] : null;
  const inputCls = 'w-20 rounded bg-slate-900 px-2 py-1 text-right text-slate-100 ring-1 ring-slate-700';

  return (
    <div className="space-y-2 rounded-xl bg-slate-800/80 p-3">
      <div className="flex items-center gap-3">
        <div
          className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4 text-center transition-colors"
          style={{ borderColor: st?.color || '#475569', background: st ? `${st.color}22` : 'transparent' }}
        >
          <span className="text-sm font-black" style={{ color: st?.color || '#94a3b8' }}>
            {!on ? 'OFF' : snap?.calibrating ? 'CAL…' : st?.label}
          </span>
          {on && snap && <span className="text-[10px] text-slate-400">+{snap.loadDb.toFixed(1)} dB</span>}
        </div>

        <div className="min-w-0 flex-1 text-xs">
          {on && snap?.calibrating && <p className="text-slate-400">Learning cruise sound at this speed… ride steadily for ~5 s.</p>}
          {on && st && <p className="font-semibold" style={{ color: st.color }}>{st.sub}</p>}
          <div className="mt-1 h-2 rounded bg-slate-700">
            <div className="h-2 rounded transition-all" style={{ width: `${Math.min(100, ((snap?.loadDb || 0) / 15) * 100)}%`, background: st?.color || '#64748b' }} />
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1">
            <div><dt className="text-slate-400">Now (est.)</dt>
              <dd className="font-semibold tabular-nums text-slate-100">
                {snap?.instL100 != null ? `${snap.instL100.toFixed(1)} L/100` : snap?.instLph != null ? `${snap.instLph.toFixed(2)} L/h` : '—'}
              </dd></div>
            <div><dt className="text-slate-400">Trip avg (est.)</dt>
              <dd className="font-semibold tabular-nums text-slate-100">{snap?.avgL100 != null ? `${snap.avgL100.toFixed(1)} L/100` : '—'}</dd></div>
            <div><dt className="text-slate-400">Trip</dt>
              <dd className="tabular-nums text-slate-100">{snap ? `${snap.tripKm.toFixed(1)} km · ${snap.tripLitres.toFixed(2)} L` : '—'}</dd></div>
            <div><dt className="text-slate-400">Since fill-up</dt>
              <dd className="tabular-nums text-slate-100">{cfg.litresSinceFill.toFixed(1)} L</dd></div>
          </dl>
        </div>
      </div>

      {speedKmh == null && on && <p className="text-[11px] text-amber-400">Start the ride (GPS) too – fuel estimates need speed.</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2">
        <button onClick={on ? stop : begin} className={`flex-1 rounded-lg py-2 text-sm font-semibold ${on ? 'bg-slate-700' : 'bg-violet-600'}`}>
          {on ? 'Stop engine monitor' : status === 'starting' ? 'Starting…' : '🎙 Start engine monitor'}
        </button>
        <button onClick={() => setShowSettings((s) => !s)} className="rounded-lg bg-slate-700 px-3 text-sm">⚙</button>
      </div>

      {showSettings && (
        <div className="space-y-2 rounded-lg bg-slate-900/60 p-2 text-xs text-slate-300">
          <div className="flex gap-1">
            {Object.entries(DEFAULTS).map(([k, d]) => (
              <button key={k} disabled={on}
                onClick={() => update({ vehicle: k, ...d, correction: 1, litresSinceFill: 0, fills: 0 })}
                className={`flex-1 rounded py-1 ${cfg.vehicle === k ? 'bg-slate-600 text-white' : 'bg-slate-800'} disabled:opacity-50`}>
                {d.label}
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between">Typical consumption (L/100 km)
            <input type="number" step="0.1" inputMode="decimal" className={inputCls} value={cfg.ratedL100} disabled={on}
              onChange={(e) => update({ ratedL100: parseFloat(e.target.value) || 0 })} />
          </label>
          <label className="flex items-center justify-between">Idle burn (L/h)
            <input type="number" step="0.05" inputMode="decimal" className={inputCls} value={cfg.idleLph} disabled={on}
              onChange={(e) => update({ idleLph: parseFloat(e.target.value) || 0 })} />
          </label>
          <div className="border-t border-slate-700 pt-2">
            <p className="mb-1">⛽ <b>Fill-up calibration</b> – fill to full, then after the next full fill-up enter the litres the pump showed:</p>
            <div className="flex gap-2">
              <input inputMode="decimal" placeholder="litres" className={`${inputCls} flex-1 text-left`} value={refuel} disabled={on}
                onChange={(e) => setRefuel(e.target.value)} />
              <button onClick={applyRefuel} disabled={on} className="rounded bg-emerald-700 px-3 disabled:opacity-50">Save</button>
            </div>
            <p className="mt-1 text-slate-500">
              Calibration factor ×{cfg.correction.toFixed(2)} · {cfg.fills} fill-up{cfg.fills === 1 ? '' : 's'} logged
              {cfg.fills < 2 ? ' – estimates firm up after 2–3 fill-ups.' : '.'}
            </p>
          </div>
          <p className="text-slate-500">Audio is analysed on the phone and never recorded or uploaded. Best placement: car – dash/console mount;
            motorcycle – tank bag or jacket pocket (out of the wind).</p>
        </div>
      )}
    </div>
  );
}
