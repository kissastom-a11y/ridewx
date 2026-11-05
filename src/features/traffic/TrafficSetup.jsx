/** One-time setup for the free TomTom traffic key. */
import { t } from '../../lib/i18n.js';
import { useState } from 'react';
import { testTrafficKey } from '../../services/tomtom.js';

export default function TrafficSetup({ currentKey, onSave, onClose }) {
  const [key, setKey] = useState(currentKey || '');
  const [state, setState] = useState(null); // null | 'testing' | 'bad'

  const save = async () => {
    const k = key.trim();
    if (!k) return;
    setState('testing');
    if (await testTrafficKey(k)) { onSave(k); onClose(); } else setState('bad');
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-end bg-black/60 p-3 sm:items-center sm:justify-center" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-2xl bg-slate-900 p-4 text-sm text-slate-200 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{t('🚦 Turn on live traffic')}</h2>
        <p className="text-slate-400">
          {t("Live traffic comes from TomTom's free plan. You need a free key once (about 3 minutes, no credit card):")}
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>{t('Open')} <a className="text-sky-400 underline" href="https://developer.tomtom.com/user/register" target="_blank" rel="noreferrer">developer.tomtom.com</a> {t('and create a free account.')}</li>
          <li>{t('In the dashboard, open Keys and copy your API key.')}</li>
          <li>{t('Paste it below and tap Save.')}</li>
        </ol>
        <input value={key} onChange={(e) => { setKey(e.target.value); setState(null); }} placeholder={t('Paste your TomTom API key')}
          className="w-full rounded-lg bg-slate-800 px-3 py-2 font-mono text-xs outline-none ring-1 ring-slate-700 focus:ring-sky-500" />
        {state === 'bad' && <p className="text-xs text-red-400">{t("That key didn't work – check you copied all of it.")}</p>}
        <p className="text-[11px] text-slate-500">{t('The key stays on this phone only. Free plan: 50,000 map-traffic tiles + 2,500 route checks per day.')}</p>
        <div className="flex gap-2">
          <button onClick={save} disabled={state === 'testing'} className="flex-1 rounded-lg bg-sky-600 py-2 font-semibold disabled:opacity-50">
            {t(state === 'testing' ? 'Checking…' : 'Save')}
          </button>
          {currentKey && <button onClick={() => { onSave(''); onClose(); }} className="rounded-lg bg-slate-700 px-3">{t('Remove key')}</button>}
          <button onClick={onClose} className="rounded-lg px-3 text-slate-400">{t('Close')}</button>
        </div>
      </div>
    </div>
  );
}
