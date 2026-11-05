/**
 * Glanceable road facts for a planned route – one line each, icon first.
 * Busy riders read the icons; the text is there if they want it.
 */
const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

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
        <Row icon="⚠️" tone="text-amber-300">No toll-free route found – this one uses ~{route.tollKm.toFixed(0)} km of toll road</Row>
      ) : route.tollKm >= 0.5 ? (
        <Row icon="💶">Toll roads: ~{route.tollKm.toFixed(0)} km</Row>
      ) : (
        <Row icon="✅" tone="text-emerald-300">No toll roads{route.avoidTolls ? ' (avoided)' : ''}</Row>
      )}

      {unpaved.length > 0 ? (
        <Row icon="🟤" tone="text-amber-300">
          Dirt/gravel {km(dirtTotal)}: {unpaved.slice(0, 3).map((u) => `km ${(u.from / 1000).toFixed(0)}–${(u.to / 1000).toFixed(0)}`).join(', ')}
          {unpaved.length > 3 ? ` +${unpaved.length - 3} more` : ''}
        </Row>
      ) : ri.status === 'ready' ? (
        <Row icon="✅" tone="text-emerald-300">All paved</Row>
      ) : null}

      {tunnels.length > 0 && (
        <Row icon="🚇">{tunnels.length} tunnel{tunnels.length > 1 ? 's' : ''} · longest {km(longest)} – lights on 💡</Row>
      )}

      {cameraCount > 0 && <Row icon="📷">{cameraCount} speed camera{cameraCount > 1 ? 's' : ''} on the route</Row>}

      {loading && <Row icon="⏳" tone="text-slate-400">Checking road surface, tunnels &amp; cameras…</Row>}
      {ri.status === 'error' && <Row icon="ℹ️" tone="text-slate-500">Road details unavailable right now (map data server busy).</Row>}
    </div>
  );
}
