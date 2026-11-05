/**
 * Controlled From / To form. Each box holds either typed text or a saved place
 * object ({icon, name, lat, lon}). Typing over a place turns it back into text.
 * ⇅ swaps the two. Empty "From" = my current location.
 */

/** datetime-local wants local "YYYY-MM-DDTHH:mm" */
export function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

import PlaceInput from './PlaceInput.jsx';

export const showVal = (v) => (v && typeof v === 'object' ? `${v.icon || '📍'} ${v.name}` : v || '');

export default function RouteForm({ from, to, setFrom, setTo, startTime, setStartTime, onSubmit, onSwap, busy, places = [], recents = [] }) {
  const input = 'w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-sky-500';

  const submit = (e) => {
    e.preventDefault();
    if (to) onSubmit();
  };

  return (
    <form onSubmit={submit} className="grid gap-2">
      <div className="flex items-stretch gap-2">
        <div className="grid flex-1 gap-2">
          <PlaceInput className={input} placeholder="📍 From: my location (or type)" value={from} onChange={setFrom} places={places} recents={recents} />
          <PlaceInput className={input} placeholder="🏁 Where to? (e.g. Work)" value={to} onChange={setTo} places={places} recents={recents} />
        </div>
        <button type="button" onClick={onSwap} title="Swap start and destination"
          className="w-11 shrink-0 rounded-lg bg-slate-800 text-xl text-slate-200 ring-1 ring-slate-700 active:bg-slate-700">⇅</button>
      </div>
      <div className="flex gap-2">
        <input type="datetime-local" className={input} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        <button disabled={busy || !to}
          className="shrink-0 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white active:bg-sky-700 disabled:opacity-50">
          {busy ? '…' : 'Go'}
        </button>
      </div>
    </form>
  );
}
