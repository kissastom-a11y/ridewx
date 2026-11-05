import { useState } from 'react';

/** datetime-local wants local "YYYY-MM-DDTHH:mm" */
function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function RouteForm({ onPlan, busy }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [startTime, setStartTime] = useState(nowLocal());

  const submit = (e) => {
    e.preventDefault();
    if (from && to) onPlan({ from, to, startTime });
  };

  const input = 'w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none ring-1 ring-slate-700 focus:ring-sky-500';

  return (
    <form onSubmit={submit} className="grid gap-2">
      <input className={input} placeholder="From (place or lat,lon)" value={from} onChange={(e) => setFrom(e.target.value)} />
      <input className={input} placeholder="To (place or lat,lon)" value={to} onChange={(e) => setTo(e.target.value)} />
      <div className="flex gap-2">
        <input type="datetime-local" className={input} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        <button
          disabled={busy}
          className="shrink-0 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white active:bg-sky-700 disabled:opacity-50"
        >
          {busy ? '…' : 'Plan'}
        </button>
      </div>
    </form>
  );
}
