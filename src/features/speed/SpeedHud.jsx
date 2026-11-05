/** Speed + limit sign, bottom-left of the map (like every navigation app). */
import { t } from '../../lib/i18n.js';
export default function SpeedHud({ speed, limit, over }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[900] flex items-end gap-2">
      <div className={`flex h-[72px] w-[72px] flex-col items-center justify-center rounded-2xl shadow-xl ${over ? 'animate-pulse bg-red-600 text-white' : 'bg-white/95 text-slate-900'}`}>
        <span className="text-3xl font-black leading-none tabular-nums">{Math.round(speed)}</span>
        <span className="text-[10px] font-semibold opacity-70">{t('km/h')}</span>
      </div>
      {limit && (
        <div className="flex h-14 w-14 items-center justify-center rounded-full border-[6px] border-red-600 bg-white text-xl font-black text-slate-900 shadow-xl"
          title={limit.explicit ? 'Posted limit' : 'Legal default for this road type'}>
          {limit.kmh}
        </div>
      )}
    </div>
  );
}
