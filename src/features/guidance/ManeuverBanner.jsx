/** Big green "next turn" card at the top of the map, like any navigation app. */
const ANGLE = { straight: 0, 'slight right': 40, right: 90, 'sharp right': 135, 'slight left': -40, left: -90, 'sharp left': -135 };

function Arrow({ m }) {
  if (m.type === 'arrive') return <span className="text-4xl">🏁</span>;
  if (m.type === 'roundabout' || m.type === 'rotary') {
    return (
      <svg viewBox="0 0 48 48" width="48" height="48">
        <circle cx="24" cy="26" r="9" fill="none" stroke="#fff" strokeWidth="4" />
        <path d="M24 46 V35" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        <text x="24" y="31" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff">{m.exit || ''}</text>
      </svg>
    );
  }
  if (m.modifier === 'uturn') {
    return (
      <svg viewBox="0 0 48 48" width="48" height="48">
        <path d="M30 44 V18 a8 8 0 0 0 -16 0 V30" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        <path d="M7 26 L14 36 L21 26 Z" fill="#fff" />
      </svg>
    );
  }
  const a = ANGLE[m.modifier] ?? 0;
  return (
    <svg viewBox="0 0 48 48" width="48" height="48">
      <path d="M24 46 V28" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      <g transform={`rotate(${a} 24 28)`}>
        <path d="M24 28 V10" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        <path d="M14 14 L24 2 L34 14 Z" fill="#fff" />
      </g>
    </svg>
  );
}

const fmt = (d) => (d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(d / 10) * 10)} m`);

export default function ManeuverBanner({ guidance }) {
  if (!guidance?.next) return null;
  const { next, dist } = guidance;
  return (
    <div className="pointer-events-none absolute left-2 right-16 top-2 z-[950] flex items-center gap-3 rounded-2xl bg-emerald-700/95 p-2.5 text-white shadow-2xl">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-emerald-800">
        <Arrow m={next} />
      </div>
      <div className="min-w-0">
        <div className="text-3xl font-black leading-none tabular-nums">{fmt(dist)}</div>
        <div className="truncate text-sm font-semibold opacity-90">{next.name || (next.type === 'arrive' ? 'Destination' : '')}</div>
      </div>
    </div>
  );
}
