/**
 * Wind drawn ON the map while riding: one arrow where the wind ENTERS the
 * screen and one where it LEAVES, on opposite edges – so you see the air
 * crossing your path, relative to your movement.
 *
 * Geometry. Screen "up" = your direction of travel (the map is heading-up when
 * following; if you rotate the map by hand we use the map's bearing instead):
 *     θs = windFrom − screenUpBearing          (0° = from ahead, +90° = from the right)
 * Direction from the screen centre toward the wind source: d = (sin θs, −cos θs).
 * We walk from the centre along d until we hit the screen edge (minus a margin):
 *     t = min( (W/2 − m)/|dx| , (H/2 − m)/|dy| ),   P_in = C + t·d,   P_out = C − t·d
 * Both arrows point the way the air travels (θs + 180°). Dashes flow along them;
 * thickness grows with wind speed; colour = crosswind severity (green/orange/red),
 * graded on the stronger of the steady and gust crosswind components.
 */
import { useEffect, useRef, useState } from 'react';
import { analyzeWind } from '../../lib/wind.js';
import { normalize180 } from '../../lib/geo.js';

const SEV = { green: '#22c55e', orange: '#f97316', red: '#dc2626' };

function Arrow({ x, y, angle, color, width, len = 74 }) {
  return (
    <svg className="pointer-events-none absolute" style={{ left: x - 50, top: y - 50, overflow: 'visible' }} width="100" height="100">
      <g transform={`rotate(${angle} 50 50)`} style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.55))' }}>
        <line x1="50" y1={50 - len / 2} x2="50" y2={50 + len / 2 - 12} stroke="#fff" strokeWidth={width + 4} strokeLinecap="round" />
        <line x1="50" y1={50 - len / 2} x2="50" y2={50 + len / 2 - 12} stroke={color} strokeWidth={width} strokeLinecap="round"
          strokeDasharray="10 7" style={{ animation: 'windflow 0.7s linear infinite' }} />
        <path d={`M${50 - width - 7} ${50 + len / 2 - 16} L${50 + width + 7} ${50 + len / 2 - 16} L50 ${50 + len / 2 + 4} Z`} fill={color} stroke="#fff" strokeWidth="2" />
      </g>
    </svg>
  );
}

export default function WindEdges({ wind, heading, screenUp }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!wind || heading == null) return <div ref={ref} />;
  const a = analyzeWind(wind, heading, 0);
  const color = SEV[a.severity];
  const width = Math.min(12, 4 + wind.speed / 6);

  const θs = normalize180(wind.direction - (screenUp ?? heading));
  const r = (θs * Math.PI) / 180;
  const dx = Math.sin(r);
  const dy = -Math.cos(r);
  const { w, h } = size;
  const mL = 44; // left margin
  const mR = 112; // right margin – keeps clear of the round map buttons
  const mTop = 110; // keep clear of the turn banner
  const mBot = 120; // keep clear of the speed display
  const cx = (mL + (w - mR)) / 2;
  const cy = (mTop + (h - mBot)) / 2;
  const halfW = (w - mL - mR) / 2;
  const halfH = (h - mBot - mTop) / 2;
  const t = Math.min(Math.abs(dx) > 1e-3 ? halfW / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-3 ? halfH / Math.abs(dy) : Infinity);
  const pin = { x: cx + t * dx, y: cy + t * dy };
  const pout = { x: cx - t * dx, y: cy - t * dy };
  // The arrow is drawn pointing DOWN (screen bearing 180°); rotating it by θs
  // makes it point along the air's travel (θs + 180°). Clockwise = positive.
  const rot = θs;

  // Label beside the incoming arrow, nudged toward the centre so it stays on screen.
  const lx = Math.min(w - 130, Math.max(8, pin.x - dx * 100 - 56));
  const ly = Math.min(h - mBot - 40, Math.max(mTop, pin.y - dy * 90 + (Math.abs(dx) > 0.7 ? 26 : -18)));

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-[880]">
      <Arrow x={pin.x} y={pin.y} angle={rot} color={color} width={width} />
      <Arrow x={pout.x} y={pout.y} angle={rot} color={color} width={width} len={56} />
      <div className="absolute rounded-lg bg-slate-900/80 px-2 py-1 text-[11px] font-bold leading-tight text-white shadow" style={{ left: lx, top: ly }}>
        <div>💨 {Math.round(wind.speed)} <span className="opacity-70">G{Math.round(wind.gusts)}</span> km/h</div>
        <div style={{ color }}>
          {a.quadrant === 'head' ? `⬇ head ${Math.round(a.headwind)}` : a.quadrant === 'tail' ? `⬆ tail ${Math.round(-a.headwind)}` : `↔ side ${Math.round(Math.abs(a.gustCross))}`}
        </div>
      </div>
    </div>
  );
}
