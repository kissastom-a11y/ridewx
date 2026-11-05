/**
 * Glanceable road facts for a planned route – one line each, icon first.
 * Busy riders read the icons; the text is there if they want it.
 */
import { t } from '../../lib/i18n.js';
const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} ${t('km')}` : `${Math.round(m)} m`);

export default function RoadSummary({ route, roadInfo, cameraCount }) {
  if (!route) return null;
  const ri = roadInfo || {};
  const loading = ri.status === 'loading';
  const tunnels = ri.tunnels || [];
  const unpaved = ri.unpaved || [];
  const longest = tunnels.reduce((m, t) => Math.max(m, t.lengthM), 0);
  const dirtTotal = unpaved.reduce((s, u) => s + u.lengthM, 0);

  const Row = ({ icon, children, tone = 'text-slate-200' }) => (
    <div className={`flex items-start gap-2 ${tone}`}><span className="w-5 shrink-0 text-center">{icon}</span><span>{children}</span></div>
  );

  return (
    <div className="space-y-1 rounded-xl bg-slate-800/70 p-2.5 text-xs">
      {route.avoidFailed ? (
        <Row icon="⚠️" tone="text-amber-300">{t('No toll-free route found – this one uses ~{n} km of toll road', { n: route.tollKm.toFixed(0) })}</Row>
      ) : route.tollKm >= 0.5 ? (
        <Row icon="💶">{t('Toll roads: ~{n} km', { n: route.tollKm.toFixed(0) })}</Row>
      ) : (
        <Row icon="✅" tone="text-emerald-300">{t('No toll roads')}{route.avoidTolls ? t(' (avoided)') : ''}</Row>
      )}

      {unpaved.length > 0 ? (
        <Row icon="🟤" tone="text-amber-300">
          {t('Dirt/gravel {len}: {list}', { len: km(dirtTotal), list: unpaved.slice(0, 3).map((u) => `${t('km')} ${(u.from / 1000).toFixed(0)}–${(u.to / 1000).toFixed(0)}`).join(', ') })}
          {unpaved.length > 3 ? ` +${unpaved.length - 3} more` : ''}
        </Row>
      ) : ri.status === 'ready' ? (
        <Row icon="✅" tone="text-emerald-300">{t('All paved')}</Row>
      ) : null}

      {tunnels.length > 0 && (
        <Row icon="🚇">{t('{n} tunnel(s) · longest {len} – lights on 💡', { n: tunnels.length, len: km(longest) })}</Row>
      )}

      {cameraCount > 0 && <Row icon="📷">{t('{n} speed camera(s) on the route', { n: cameraCount })}</Row>}

      {loading && <Row icon="⏳" tone="text-slate-400">{t('Checking road surface, tunnels & cameras…')}</Row>}
      {ri.status === 'error' && <Row icon="ℹ️" tone="text-slate-500">{t('Road details unavailable right now (map data server busy).')}</Row>}
    </div>
  );
}
