/** First launch: choose Greek or English (screens + voice). Shown until a choice is made. */
import { LANGS, setLang } from '../../lib/i18n.js';

export default function LanguagePicker() {
  return (
    <div className="fixed inset-0 z-[3000] flex flex-col items-center justify-center gap-6 bg-slate-950 p-6 text-white">
      <img src="icons/icon-192.png" alt="" className="h-20 w-20 rounded-2xl shadow-xl" />
      <div className="text-center">
        <h1 className="text-2xl font-black">RideWX</h1>
        <p className="mt-1 text-sm text-slate-400">Επιλέξτε γλώσσα · Choose your language</p>
      </div>
      <div className="grid w-full max-w-xs gap-3">
        {LANGS.map((l) => (
          <button key={l.id} onClick={() => setLang(l.id)}
            className="flex items-center justify-center gap-3 rounded-2xl bg-slate-800 py-4 text-lg font-bold ring-1 ring-slate-700 active:bg-sky-700">
            <span className="text-3xl">{l.flag}</span> {l.label}
          </button>
        ))}
      </div>
      <p className="max-w-xs text-center text-[11px] text-slate-500">Οθόνες και φωνή · Screens and voice. Μπορείτε να το αλλάξετε αργότερα · You can change it later.</p>
    </div>
  );
}
