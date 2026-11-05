/**
 * One-tap shortcuts like a maps app:
 *   🏠 Home  💼 Work  ⭐ custom…  ＋     → tap = route from your location, leaving now
 *   🕘 recent destinations               → tap = same
 * An unset Home/Work opens the editor; ✏️ toggles edit mode for changing/removing.
 */
import { t } from '../../lib/i18n.js';
import { useState } from 'react';
import { geocode } from '../../services/geocode.js';

const ICONS = ['⭐', '🏋️', '🏫', '🛒', '⛽', '❤️', '🍽️', '🏍️'];

const lbl = (p) => (p ? `${p.icon || '📍'} ${t(p.name)}` : `📍 ${t('My location')}`);

export default function PlacesBar({ places, recents, routes = [], onGo, onGoRoute, onRemoveRoute, onSave, onRemove, onClearRecents, position }) {
  const [editing, setEditing] = useState(null); // place object being edited
  const [editMode, setEditMode] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const openEditor = (p) => { setEditing(p); setText(p.label || ''); setErr(null); };
  const tap = (p) => (editMode || p.lat == null ? openEditor(p) : onGo(p));

  const save = async (useHere) => {
    setErr(null);
    try {
      setBusy(true);
      let loc;
      if (useHere) {
        if (!position) throw new Error(t('Location not available yet'));
        loc = { lat: position.lat, lon: position.lon, label: 'Saved from my location' };
      } else {
        if (!text.trim()) throw new Error(t('Type an address or place'));
        loc = await geocode(text);
      }
      onSave({ ...editing, name: editing.name.trim() || 'Place', ...loc });
      setEditing(null);
      setEditMode(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const chip = 'shrink-0 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap';
  const input = 'w-full rounded-lg bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-sky-500';

  return (
    <div className="space-y-2">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {places.map((p) => (
          <button key={p.id} onClick={() => tap(p)}
            className={`${chip} ${p.lat == null ? 'border border-dashed border-slate-600 text-slate-400' : 'bg-slate-700 text-slate-100 active:bg-slate-600'} ${editMode ? 'ring-2 ring-amber-500' : ''}`}>
            {p.icon} {p.lat == null ? t('Set {name}', { name: t(p.name) }) : t(p.name)}
          </button>
        ))}
        <button onClick={() => openEditor({ id: `p${Date.now()}`, icon: '⭐', name: '', lat: null, lon: null, label: '', isNew: true })}
          className={`${chip} bg-slate-800 text-slate-300`}>＋</button>
        <button onClick={() => setEditMode((v) => !v)} className={`${chip} ${editMode ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
          {editMode ? t('Done') : '✏️'}
        </button>
      </div>

      {editing && (
        <div className="space-y-2 rounded-xl bg-slate-800 p-3">
          <div className="flex gap-2">
            {editing.id === 'home' || editing.id === 'work' ? (
              <span className="py-2 text-sm font-semibold">{editing.icon} {t(editing.name)}</span>
            ) : (
              <>
                <select value={editing.icon} onChange={(e) => setEditing({ ...editing, icon: e.target.value })}
                  className="rounded-lg bg-slate-900 px-2 text-lg ring-1 ring-slate-700">
                  {ICONS.map((i) => <option key={i}>{i}</option>)}
                </select>
                <input className={input} placeholder={t('Name (e.g. Gym)')} value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </>
            )}
          </div>
          <input className={input} placeholder={t('Address or place')} value={text} onChange={(e) => setText(e.target.value)} />
          {err && <p className="text-xs text-red-400">{err}</p>}
          <div className="flex flex-wrap gap-2 text-sm">
            <button disabled={busy} onClick={() => save(false)} className="rounded-lg bg-sky-600 px-3 py-1.5 font-semibold disabled:opacity-50">
              {busy ? '…' : t('Save')}
            </button>
            <button disabled={busy} onClick={() => save(true)} className="rounded-lg bg-slate-700 px-3 py-1.5">{t("📍 I'm here now")}</button>
            {!editing.isNew && editing.lat != null && (
              <button onClick={() => { onRemove(editing.id); setEditing(null); }} className="rounded-lg bg-red-900/70 px-3 py-1.5">{t('Remove')}</button>
            )}
            <button onClick={() => setEditing(null)} className="ml-auto rounded-lg px-3 py-1.5 text-slate-400">{t('Cancel')}</button>
          </div>
        </div>
      )}

      {routes.length > 0 && !editing && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">{t('My routes')}</div>
          <div className="space-y-1">
            {routes.map((r) => (
              <div key={r.id} className="flex gap-1">
                <button onClick={() => onGoRoute(r, false)}
                  className="flex min-w-0 flex-1 items-center gap-1 rounded-lg bg-slate-800/70 px-3 py-2 text-left text-sm active:bg-slate-700">
                  <span className="truncate">{lbl(r.from)}</span><span className="text-slate-500">→</span><span className="truncate">{lbl(r.to)}</span>
                </button>
                <button onClick={() => onGoRoute(r, true)} title="Reverse direction"
                  className="w-11 shrink-0 rounded-lg bg-slate-800/70 text-lg active:bg-slate-700">⇄</button>
                {editMode && (
                  <button onClick={() => onRemoveRoute(r.id)} className="w-11 shrink-0 rounded-lg bg-red-900/70">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {recents.length > 0 && !editing && (
        <div>
          <div className="mb-1 flex justify-between text-[11px] uppercase tracking-wide text-slate-500">
            <span>{t('Recent')}</span>
            <button onClick={onClearRecents}>{t('Clear')}</button>
          </div>
          <div className="space-y-1">
            {recents.map((r) => (
              <button key={r.ts} onClick={() => onGo(r)}
                className="flex w-full items-center gap-2 rounded-lg bg-slate-800/70 px-3 py-2 text-left text-sm active:bg-slate-700">
                <span>🕘</span>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
