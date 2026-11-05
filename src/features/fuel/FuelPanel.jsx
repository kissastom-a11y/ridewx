/**
 * Ride-page fuel card: vehicle chip (one tap to switch), live consumption,
 * trip total, "where the fuel went" bar, sensor status and fill-up calibration.
 */
import { useState } from 'react';
import { PRESETS } from './vehicles.js';

const PARTS = [
  { k: 'roll', label: 'Tyres', color: '#64748b' },
  { k: 'aero', label: 'Air & wind', color: '#0ea5e9' },
  { k: 'grade', label: 'Climbing', color: '#a855f7' },
  { k: 'accel', label: 'Accelerating', color: '#f97316' },
  { k: 'idle', label: 'Engine base', color: '#eab308' },
];

export function VehiclePicker({ selectedId, onPick, onClose }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-end bg-black/60 p-3 sm:items-center sm:justify-center" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-2xl bg-slate-900 p-4 text-slate-100 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">What are you riding / driving?</h2>
        <p className="text-xs text-slate-400">Pick the closest – it's remembered. Fill-ups will fine-tune it to your vehicle.</p>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button key={p.id} onClick={() => { onPick(p.id); onClose(); }}
              className={`flex items-center gap-2 rounded-xl px-3 py-3 text-left text-sm ${p.id === selectedId ? 'bg-sky-700' : 'bg-slate-800 active:bg-slate-700'}`}>
              <span className="text-2xl">{p.icon}</span><span className="leading-tight">{p.label}</span>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="w-full rounded-lg py-2 text-sm text-slate-400">Close</button>
      </div>
    </div>
  );
}

export default function FuelPanel({ fuel, vehicle, vstate, onOpenPicker, onRefuel, vib, riding }) {
  const [refuel, setRefuel] = useState('');
  const [showCal, setShowCal] = useState(false);
  if (!vehicle) {
    return (
      <button onClick={onOpenPicker} className="w-full rounded-xl bg-slate-800/80 p-3 text-left text-sm text-slate-200">
        ⛽ <b>Fuel consumption</b> – tap to choose your vehicle
      </button>
    );
  }
  const total = fuel ? PARTS.reduce((s, p) => s + fuel.parts[p.k], 0) : 0;

  return (
    <div className="space-y-2 rounded-xl bg-slate-800/80 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">Fuel</span>
        <button onClick={onOpenPicker} className="rounded-full bg-slate-700 px-2.5 py-1 text-xs">{vehicle.icon} {vehicle.label} ▾</button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-2xl font-black tabular-nums text-white">
            {fuel?.overrun ? '0.0' : fuel?.l100 != null ? fuel.l100.toFixed(1) : fuel ? fuel.lph.toFixed(2) : '—'}
          </div>
          <div className="text-[10px] text-slate-400">{fuel?.l100 != null || fuel?.overrun ? 'L/100 now' : 'L/h (stopped)'}</div>
        </div>
        <div>
          <div className="text-2xl font-black tabular-nums text-white">{fuel?.avgL100 != null ? fuel.avgL100.toFixed(1) : '—'}</div>
          <div className="text-[10px] text-slate-400">L/100 trip avg</div>
        </div>
        <div>
          <div className="text-2xl font-black tabular-nums text-white">{fuel ? fuel.tripL.toFixed(2) : '—'}</div>
          <div className="text-[10px] text-slate-400">L this trip</div>
        </div>
      </div>

      {fuel && total > 0.001 && (
        <div>
          <div className="flex h-2.5 overflow-hidden rounded-full">
            {PARTS.map((p) => <div key={p.k} style={{ width: `${(fuel.parts[p.k] / total) * 100}%`, background: p.color }} />)}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-slate-400">
            {PARTS.filter((p) => fuel.parts[p.k] / total > 0.03).map((p) => (
              <span key={p.k}><span style={{ color: p.color }}>●</span> {p.label} {Math.round((fuel.parts[p.k] / total) * 100)}%</span>
            ))}
          </div>
        </div>
      )}

      {fuel && (
        <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-400">
          <span className="rounded bg-slate-900/70 px-1.5 py-0.5">📡 {fuel.inputs.accel >= 0 ? '+' : ''}{fuel.inputs.accel.toFixed(1)} m/s²</span>
          <span className="rounded bg-slate-900/70 px-1.5 py-0.5">⛰ {(fuel.inputs.grade * 100).toFixed(1)}%</span>
          <span className="rounded bg-slate-900/70 px-1.5 py-0.5">💨 {fuel.inputs.headwindKmh >= 0 ? 'head' : 'tail'} {Math.abs(Math.round(fuel.inputs.headwindKmh))}</span>
          <span className="rounded bg-slate-900/70 px-1.5 py-0.5">
            {fuel.inputs.loadSrc === 'sound' ? '🎙 sound' : fuel.inputs.loadSrc === 'vibration' ? '📳 vibration' : '🧮 physics only'}
          </span>
          {vib?.available && <span className="rounded bg-slate-900/70 px-1.5 py-0.5">📳 engine {fuel.inputs.engineOn ? 'on' : 'off'}</span>}
        </div>
      )}
      {riding && vib && !vib.available && (
        <p className="text-[10px] text-slate-500">📳 Vibration sensor not available in this browser – using speed &amp; sound.</p>
      )}

      <button onClick={() => setShowCal((v) => !v)} className="text-[11px] text-slate-400 underline">
        ⛽ Fill-up calibration (×{vstate.correction.toFixed(2)} · {vstate.fills} logged)
      </button>
      {showCal && (
        <div className="space-y-1 rounded-lg bg-slate-900/60 p-2 text-xs text-slate-300">
          <p>Fill to full. At the next full fill-up, enter the litres the pump showed. Estimated since last fill-up: <b>{vstate.litresSinceFill.toFixed(1)} L</b></p>
          <div className="flex gap-2">
            <input inputMode="decimal" placeholder="litres" value={refuel} onChange={(e) => setRefuel(e.target.value)}
              className="flex-1 rounded bg-slate-800 px-2 py-1 ring-1 ring-slate-700" />
            <button onClick={() => { const l = parseFloat(refuel.replace(',', '.')); if (l > 0) { onRefuel(l); setRefuel(''); } }}
              className="rounded bg-emerald-700 px-3">Save</button>
          </div>
          <p className="text-slate-500">Each fill-up nudges the estimate halfway toward reality – after 2–3 it fits your vehicle.</p>
        </div>
      )}
    </div>
  );
}
