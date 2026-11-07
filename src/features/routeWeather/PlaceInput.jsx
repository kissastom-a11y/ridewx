/**
 * Text box with a maps-style dropdown that searches AS YOU TYPE:
 *   📍 My current location            ← always first
 *   🏠 Home / 💼 Work / ⭐ saved…       (filtered by what you type)
 *   🕘 recent destinations             (filtered by what you type)
 *   🔎 live suggestions: shops, cafés, addresses, areas (TomTom or Photon),
 *      biased to where you are, debounced 300 ms
 * Picking a suggestion stores its exact coordinates – no second lookup on Go.
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '../../lib/i18n.js';
import { searchPlaces } from '../../services/placeSearch.js';

export const ME = { isMe: true, icon: '📍', name: 'My location' };
const show = (v) => (v && typeof v === 'object' ? `${v.icon || '📍'} ${t(v.name)}` : v || '');
const fmtDist = (m) => (m == null ? '' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} ${t('km')}`);

export default function PlaceInput({ value, onChange, placeholder, places = [], recents = [], className = '', near = null }) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState([]);
  const [loading, setLoading] = useState(false);
  const ctrl = useRef(null);
  const typed = typeof value === 'string' ? value.trim() : '';
  const text = typed.toLocaleLowerCase();
  const match = (name) => !text || t(name).toLocaleLowerCase().includes(text) || name.toLocaleLowerCase().includes(text);

  const saved = places.filter((p) => p.lat != null && match(p.name));
  const recent = recents.filter((r) => match(r.name)).slice(0, text ? 3 : 5);

  // Live suggestions, debounced; the previous request is cancelled on each keystroke.
  useEffect(() => {
    if (!open || typed.length < 2) { setHits([]); setLoading(false); return undefined; }
    const timer = setTimeout(() => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setLoading(true);
      searchPlaces(typed, { near, signal: c.signal })
        .then((r) => { if (!c.signal.aborted) setHits(r); })
        .catch(() => {})
        .finally(() => { if (!c.signal.aborted) setLoading(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [typed, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (v) => { onChange(v); setOpen(false); setHits([]); };
  // onMouseDown + preventDefault keeps focus in the input so the tap isn't lost to blur.
  const Item = ({ icon, label, sub, right, onPick, strong }) => (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onPick}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm active:bg-slate-700 ${strong ? 'font-semibold text-sky-300' : 'text-slate-100'}`}>
      <span className="w-6 shrink-0 text-center text-lg">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {sub && <span className="block truncate text-[11px] text-slate-500">{sub}</span>}
      </span>
      {right && <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{right}</span>}
    </button>
  );

  return (
    <div className="relative">
      <input className={className} placeholder={placeholder} value={show(value)} enterKeyHint="search" autoComplete="off"
        onFocus={(e) => { setOpen(true); if (value && typeof value === 'object') e.target.select(); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} />
      {open && (
        <div className="mt-1 max-h-80 overflow-y-auto rounded-xl bg-slate-800 shadow-xl ring-1 ring-slate-600">
          {!typed && <Item icon="📍" label={t('My current location')} strong onPick={() => pick(ME)} />}
          {saved.map((p) => <Item key={p.id} icon={p.icon} label={t(p.name)} sub={p.label} onPick={() => pick(p)} />)}
          {recent.map((r) => (
            <Item key={r.ts} icon="🕘" label={r.name} sub={r.label}
              onPick={() => pick({ icon: '🕘', name: r.name, lat: r.lat, lon: r.lon, label: r.label })} />
          ))}
          {hits.map((h, i) => (
            <Item key={`${h.lat},${h.lon},${i}`} icon={h.icon} label={h.name} sub={h.sub} right={fmtDist(h.distM)}
              onPick={() => pick({ icon: h.icon, name: h.name, lat: h.lat, lon: h.lon, label: [h.name, h.sub].filter(Boolean).join(', ') })} />
          ))}
          {typed.length >= 2 && loading && !hits.length && <div className="px-3 py-2.5 text-sm text-slate-400">🔎 {t('Searching…')}</div>}
          {typed.length >= 2 && !loading && !hits.length && <div className="px-3 py-2.5 text-sm text-slate-500">{t('No results')}</div>}
          {typed && !text.startsWith('📍') && (
            <div className="border-t border-slate-700 px-3 py-1.5 text-[10px] text-slate-500">
              {readKey() ? 'TomTom' : t('Tip: add your free TomTom key (🚦) for better business search')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function readKey() {
  try { return JSON.parse(localStorage.getItem('ridewx.tomtomKey') || '""'); } catch { return ''; }
}
