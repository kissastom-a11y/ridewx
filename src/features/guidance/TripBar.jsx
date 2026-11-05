/**
 * Bottom-of-map trip strip: arrival time · time left · distance left.
 * While riding, "left" is measured from where you are on the route
 * (time scales with the remaining share of the route's traffic-aware duration).
 */
import { t } from '../../lib/i18n.js';

const fmtClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtLeft = (s) => {
  const m = Math.max(1, Math.round(s / 60));
  return m >= 60 ? `${Math.floor(m / 60)} ${t('h')} ${m % 60} ${t('min')}` : `${m} ${t('min')}`;
};

export default function TripBar({ route, progressM, riding }) {
  if (!route) return null;
  const leftM = Math.max(0, route.distanceM - (riding && progressM != null ? progressM : 0));
  const leftS = route.durationS * (leftM / Math.max(route.distanceM, 1));
  const etaMs = riding ? Date.now() + leftS * 1000 : (route.startUnix + route.durationS) * 1000;
  const Cell = ({ icon, value, label, strong }) => (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <span className={`tabular-nums leading-tight ${strong ? 'text-xl font-black text-emerald-400' : 'text-lg font-bold text-white'}`}>{icon} {value}</span>
      <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
    </div>
  );
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 z-[900] flex items-center divide-x divide-slate-700 rounded-2xl bg-slate-900/92 px-1 py-1.5 shadow-2xl ring-1 ring-slate-700">
      <Cell icon="🕐" value={fmtClock(etaMs)} label={t('Arrival')} strong />
      <Cell icon="⏳" value={fmtLeft(leftS)} label={t('Time left')} />
      <Cell icon="📏" value={`${(leftM / 1000).toFixed(leftM < 10000 ? 1 : 0)} ${t('km')}`} label={t('Distance')} />
    </div>
  );
}
