/**
 * Text box with a maps-style dropdown:
 *   📍 My current location      ← always first
 *   🏠 Home / 💼 Work / ⭐ saved…  (filtered by what you type)
 *   🕘 recent destinations        (filtered by what you type)
 *   🔍 Search "…"                 (keep the typed text → geocoded on Go)
 */
import { useState } from 'react';

export const ME = { isMe: true, icon: '📍', name: 'My location' };
const show = (v) => (v && typeof v === 'object' ? `${v.icon || '📍'} ${v.name}` : v || '');

export default function PlaceInput({ value, onChange, placeholder, places = [], recents = [], className = '' }) {
  const [open, setOpen] = useState(false);
  const text = typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
  const match = (name) => !text || name.toLocaleLowerCase().includes(text);

  const saved = places.filter((p) => p.lat != null && match(p.name));
  const recent = recents.filter((r) => match(r.name)).slice(0, 5);

  const pick = (v) => { onChange(v); setOpen(false); };
  // onMouseDown + preventDefault keeps focus in the input so the click isn't lost to blur.
  const Item = ({ icon, label, sub, onPick, strong }) => (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onPick}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm active:bg-slate-700 ${strong ? 'font-semibold text-sky-300' : 'text-slate-100'}`}>
      <span className="w-6 text-center text-lg">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {sub && <span className="block truncate text-[11px] text-slate-500">{sub}</span>}
      </span>
    </button>
  );

  return (
    <div className="relative">
      <input className={className} placeholder={placeholder} value={show(value)}
        onFocus={(e) => { setOpen(true); if (value && typeof value === 'object') e.target.select(); }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} />
      {open && (
        <div className="mt-1 max-h-64 overflow-y-auto rounded-xl bg-slate-800 shadow-xl ring-1 ring-slate-600">
          <Item icon="📍" label="My current location" strong onPick={() => pick(ME)} />
          {saved.map((p) => <Item key={p.id} icon={p.icon} label={p.name} sub={p.label} onPick={() => pick(p)} />)}
          {recent.map((r) => (
            <Item key={r.ts} icon="🕘" label={r.name} sub={r.label}
              onPick={() => pick({ icon: '🕘', name: r.name, lat: r.lat, lon: r.lon, label: r.label })} />
          ))}
          {text && <Item icon="🔍" label={`Search “${value.trim()}”`} onPick={() => setOpen(false)} />}
        </div>
      )}
    </div>
  );
}
