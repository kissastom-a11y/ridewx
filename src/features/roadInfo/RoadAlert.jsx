/** Big banner for tunnel / dirt-road heads-up (same spot as the camera alert). */
export default function RoadAlert({ alert, distance }) {
  if (!alert) return null;
  const tunnel = alert.kind === 'tunnel';
  return (
    <div className={`pointer-events-none absolute inset-x-2 top-2 z-[1000] rounded-xl border-2 p-3 shadow-2xl ${
      tunnel ? 'border-yellow-300 bg-slate-950/95 text-yellow-200' : 'border-amber-300 bg-amber-800/95 text-amber-50'}`}>
      <div className="flex items-center gap-3">
        <div className="text-4xl">{tunnel ? '🚇' : '🟤'}</div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold tracking-widest">{alert.title}</div>
          <div className="text-2xl font-black tabular-nums">{distance != null ? `${Math.max(0, Math.round(distance))} m` : ''}</div>
          <div className="text-sm font-semibold">{alert.sub}</div>
        </div>
        {tunnel && <div className="animate-pulse text-4xl">💡</div>}
      </div>
    </div>
  );
}
