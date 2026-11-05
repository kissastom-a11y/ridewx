/** Listening bubble at the top of the map: what the app is hearing, live. */
import { t } from '../../lib/i18n.js';

export default function VoiceOverlay({ sc }) {
  const err = sc.error === 'denied' ? t('Microphone permission denied') : sc.error === 'unsupported' ? t('Voice commands need Chrome (Android) or Safari (iPhone).') : null;
  if (!sc.listening && !err && !sc.heard) return null;
  return (
    <div className="pointer-events-none absolute inset-x-3 top-24 z-[1200] flex justify-center">
      <div className="max-w-sm rounded-2xl bg-slate-900/95 px-4 py-3 text-center text-white shadow-2xl ring-2 ring-sky-500">
        {sc.listening ? (
          <>
            <div className="flex items-center justify-center gap-2 text-sm font-bold text-sky-300">
              <span className="inline-block h-3 w-3 animate-ping rounded-full bg-red-500" /> {t('Listening…')}
            </div>
            <div className="mt-1 min-h-5 text-lg font-semibold">{sc.interim || ' '}</div>
            {!sc.interim && <div className="mt-1 text-[11px] text-slate-400">{t('Try: “Take me home”, “Go to Kifisia”, “How much fuel?”, “Weather”, “Mute”, “Stop”')}</div>}
          </>
        ) : err ? (
          <div className="text-sm text-amber-300">{err}</div>
        ) : (
          <div className="text-base">🗣️ «{sc.heard}»</div>
        )}
      </div>
    </div>
  );
}
