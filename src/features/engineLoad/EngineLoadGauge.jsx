/**
 * Feature 4 UI: 3-state engine load display + estimated consumption + fill-up calibration.
 * Settings and the fuel-since-last-fill-up counter persist in localStorage.
 */
import { useCallback, useRef, useState } from 'react';
import { DEFAULTS, updateCorrection } from './engineDsp.js';
import { useEngineAudio } from './useEngineAudio.js';
import { readJSON } from '../../lib/storage.js';

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

  const onProfile = useCallback((profile) => update({ profile }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const { snap, status, error, start, stop } = useEngineAudio({ speedKmh, settings: cfg, profile: cfg.profile, onProfile, onTripUpdate });
  const on = status === 'on' || status === 'learning';
  const learning = snap?.phase === 'learning';

  const begin = (relearn = false) => { baseRef.current = cfg.litresSinceFill; start(relearn); };

  const applyRefuel = () => {
    const litres = parseFloat(refuel.replace(',', '.'));
    if (!(litres > 0)) return;
    update({ correction: updateCorrection(cfg.correction, litres, cfg.litresSinceFill), litresSinceFill: 0, fills: cfg.fills + 1 });
    setRefuel('');
  };

  const st = snap && !snap.calibrating && !learning ? STATE[snap.state] : null;
  const secsLeft = learning ? Math.max(0, Math.ceil((1 - snap.progress) * (readJSON('ridewx.debug.learnS', 60)))) : 0;
  const inputCls = 'w-20 rounded bg-slate-900 px-2 py-1 text-right text-slate-100 ring-1 ring-slate-700';

  return (
    <div className="relative space-y-2 rounded-xl bg-slate-800/80 p-3">
      {/* Speech-bubble messages */}
      {on && learning && (
        <Bubble color="#8b5cf6">
          <div className="flex items-center gap-2">
            <span className="animate-bounce text-2xl">🧠</span>
            <div className="flex-1">
              <div className="font-semibold">Learning your {cfg.vehicle === 'moto' ? 'bike' : 'car'}'s sound… {secsLeft}s</div>
              <div className="text-[11px] opacity-80">Music &amp; talking off please. Idle or ride steadily.</div>
              <div className="mt-1 h-1.5 rounded bg-white/25"><div className="h-1.5 rounded bg-white transition-all" style={{ width: `${Math.round(snap.progress * 100)}%` }} /></div>
            </div>
          </div>
        </Bubble>
      )}
      {on && !learning && snap?.interfering && (
        <Bubble color="#0ea5e9">
          <span className="text-xl">{snap.interferenceReason === 'voice' ? '🎵' : '💨'}</span>{' '}
          {snap.interferenceReason === 'voice' ? 'Music or voices – holding the reading' : 'Noise burst (wind/horn) – holding the reading'}
        </Bubble>
      )}
      {on && snap?.silent && (
        <Bubble color="#f59e0b">🎙️ No sound from the microphone – check the browser's mic permission.</Bubble>
      )}
      <div className="flex items-center gap-3">
        <div
          className="flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-full border-4 text-center transition-colors"
          style={{ borderColor: st?.color || '#475569', background: st ? `${st.color}22` : 'transparent' }}
        >
          <span className="text-sm font-black" style={{ color: st?.color || '#94a3b8' }}>
            {!on ? 'OFF' : learning ? 'LEARN' : snap?.calibrating ? 'CAL…' : st?.label}
          </span>
          {on && snap && <span className="text-[10px] text-slate-400">+{snap.loadDb.toFixed(1)} dB</span>}
        </div>

        <div className="min-w-0 flex-1 text-xs">
          {on && !learning && snap?.calibrating && <p className="text-slate-400">New speed – fine-tuning for ~5 s…</p>}
          {on && snap && (
            <div className="mb-1 flex items-center gap-1 text-[10px] text-slate-500">
              🎙️<div className="h-1 flex-1 rounded bg-slate-700"><div className="h-1 rounded bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, (snap.micDb + 100) * 1.4))}%` }} /></div>
            </div>
          )}
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
        <button onClick={() => (on ? stop() : begin(false))} className={`flex-1 rounded-lg py-2 text-sm font-semibold ${on ? 'bg-slate-700' : 'bg-violet-600'}`}>
          {on ? 'Stop engine monitor' : status === 'starting' ? 'Starting…' : cfg.profile ? '🎙 Start engine monitor' : '🎙 Start – learn my engine (1 min)'}
        </button>
        <button onClick={() => setShowSettings((s) => !s)} className="rounded-lg bg-slate-700 px-3 text-sm">⚙</button>
      </div>

      {showSettings && (
        <div className="space-y-2 rounded-lg bg-slate-900/60 p-2 text-xs text-slate-300">
          <div className="flex gap-1">
            {Object.entries(DEFAULTS).map(([k, d]) => (
              <button key={k} disabled={on}
                onClick={() => update({ vehicle: k, ...d, correction: 1, litresSinceFill: 0, fills: 0, profile: null })}
                className={`flex-1 rounded py-1 ${cfg.vehicle === k ? 'bg-slate-600 text-white' : 'bg-slate-800'} disabled:opacity-50`}>
                {d.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span>Engine sound profile: {cfg.profile ? `learned ${new Date(cfg.profile.learnedAt).toLocaleDateString()}` : 'not learned yet'}</span>
            <button disabled={on} onClick={() => begin(true)} className="rounded bg-violet-700 px-2 py-1 disabled:opacity-50">Re-learn</button>
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

function Bubble({ color, children }) {
  return (
    <div className="relative mb-3 rounded-2xl px-3 py-2 text-sm text-white shadow-lg" style={{ background: color }}>
      {children}
      {/* tail */}
      <span className="absolute -bottom-2 left-10 h-4 w-4 rotate-45" style={{ background: color }} />
    </div>
  );
}
