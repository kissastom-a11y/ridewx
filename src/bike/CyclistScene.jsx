/**
 * Animated side view of the rider – the "live" picture:
 *   - pedals turn while you put out power (≈ 60–95 rpm with effort), stop when coasting
 *   - wheels turn with real road speed, road markings stream past
 *   - the road tilts with the gradient (exaggerated ×3 so 4 % is visible)
 *   - wind streaks blow FROM the front (headwind) or FROM behind (tailwind),
 *     faster and denser the stronger the component along the bike
 * Legs use 2-link inverse kinematics (hip fixed, foot on the pedal) so the knee
 * moves like a real pedal stroke. Animation runs on requestAnimationFrame with
 * accumulated angles – changing speed never makes it jump.
 */
import { useEffect, useRef } from 'react';

const RW = { x: 62, y: 128 }; // rear wheel centre
const FW = { x: 178, y: 128 }; // front wheel centre
const WR = 33; // wheel radius
const BB = { x: 112, y: 130 }; // bottom bracket
const CR = 13; // crank length
const HIP = { x: 104, y: 74 };
const THIGH = 36;
const SHIN = 37;
const SHOULDER = { x: 146, y: 54 };
const HANDS = { x: 170, y: 80 };

function knee(hip, foot) {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  const d = Math.min(THIGH + SHIN - 0.01, Math.hypot(dx, dy));
  const a = Math.acos((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d));
  const base = Math.atan2(dy, dx);
  const ang = base - a; // knee forward (toward the front wheel)
  return { x: hip.x + THIGH * Math.cos(ang), y: hip.y + THIGH * Math.sin(ang) };
}

const N_STREAKS = 9;

export default function CyclistScene({ speedKmh = 0, power = 0, grade = 0, headKmh = 0, color = '#38bdf8' }) {
  const live = useRef({ speedKmh, power, grade, headKmh });
  live.current = { speedKmh, power, grade, headKmh };
  const refs = useRef({});
  const st = useRef({ crank: 0, wheel: 0, road: 0, tilt: 0, streaks: Array.from({ length: N_STREAKS }, (_, i) => ({ x: (i * 260) / N_STREAKS, y: 20 + ((i * 37) % 90), len: 18 + ((i * 13) % 22) })) });

  useEffect(() => {
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const L = live.current;
      const s = st.current;
      const v = Math.max(0, L.speedKmh) / 3.6;
      const pedalling = L.power > 15 && v > 0.5;
      const rpm = pedalling ? Math.min(95, 60 + L.power / 8) : 0;
      s.crank += (rpm / 60) * 2 * Math.PI * dt;
      s.wheel += (v / 2.1) * 2 * Math.PI * dt * 0.35; // slowed down so the eye can follow it
      s.road = (s.road + v * 9 * dt) % 40;
      const targetTilt = Math.max(-18, Math.min(18, (-Math.atan(L.grade) * 180 * 3) / Math.PI));
      s.tilt += (targetTilt - s.tilt) * Math.min(1, dt * 3);
      // wind relative to the ground: + head = air moving from front (right) to back (left)
      const wv = -L.headKmh * 6; // px/s, sign: negative = moves left
      s.streaks.forEach((k) => {
        k.x += wv * dt;
        if (k.x < -40) { k.x = 260; k.y = 15 + Math.random() * 95; }
        if (k.x > 260) { k.x = -40; k.y = 15 + Math.random() * 95; }
      });
      draw(refs.current, s, L);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const r = (k) => (el) => { refs.current[k] = el; };
  const windOn = Math.abs(headKmh) >= 2;

  return (
    <svg viewBox="0 0 240 175" className="w-full">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f172a" />
          <stop offset="1" stopColor="#1e293b" />
        </linearGradient>
      </defs>
      <rect width="240" height="175" rx="14" fill="url(#sky)" />
      {/* wind streaks */}
      <g opacity={windOn ? 0.85 : 0} stroke={headKmh > 0 ? '#f87171' : '#4ade80'} strokeWidth="2" strokeLinecap="round">
        {Array.from({ length: N_STREAKS }, (_, i) => <line key={i} ref={r(`w${i}`)} />)}
      </g>
      <g ref={r('world')}>
        {/* road */}
        <rect x="-80" y={RW.y + WR} width="400" height="60" fill="#334155" />
        <line x1="-80" x2="320" y1={RW.y + WR} y2={RW.y + WR} stroke="#64748b" strokeWidth="2" />
        <line ref={r('dash')} x1="-80" x2="320" y1={RW.y + WR + 10} y2={RW.y + WR + 10} stroke="#e2e8f0" strokeWidth="2.5" strokeDasharray="20 20" />
        {/* far leg (behind the bike) */}
        <g stroke="#475569" strokeWidth="7" strokeLinecap="round" fill="none"><polyline ref={r('legB')} /></g>
        <line ref={r('crankB')} stroke="#64748b" strokeWidth="3" strokeLinecap="round" />
        {/* wheels */}
        {[RW, FW].map((w, i) => (
          <g key={i}>
            <circle cx={w.x} cy={w.y} r={WR} fill="none" stroke="#e2e8f0" strokeWidth="4" />
            <circle cx={w.x} cy={w.y} r={WR - 5} fill="none" stroke="#475569" strokeWidth="1" />
            <g ref={r(`spokes${i}`)} stroke="#94a3b8" strokeWidth="1">
              {[0, 30, 60, 90, 120, 150].map((a) => <line key={a} x1={w.x - (WR - 4) * Math.cos((a * Math.PI) / 180)} y1={w.y - (WR - 4) * Math.sin((a * Math.PI) / 180)} x2={w.x + (WR - 4) * Math.cos((a * Math.PI) / 180)} y2={w.y + (WR - 4) * Math.sin((a * Math.PI) / 180)} />)}
            </g>
            <circle cx={w.x} cy={w.y} r="3" fill="#e2e8f0" />
          </g>
        ))}
        {/* frame */}
        <g stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <polyline points={`${RW.x},${RW.y} ${BB.x},${BB.y} 100,${HIP.y + 12} ${RW.x},${RW.y}`} />
          <polyline points={`100,${HIP.y + 12} 160,${HIP.y + 14} ${BB.x},${BB.y}`} />
          <polyline points={`160,${HIP.y + 14} 164,${HIP.y + 6} ${FW.x},${FW.y}`} />
        </g>
        <line x1="96" y1={HIP.y + 6} x2="112" y2={HIP.y + 6} stroke="#0f172a" strokeWidth="5" strokeLinecap="round" />
        <path d={`M164 ${HIP.y + 6} L168 ${HIP.y + 2} Q178 ${HIP.y + 2} 176 ${HIP.y + 12}`} stroke="#e2e8f0" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        {/* rider body */}
        <line x1={HIP.x} y1={HIP.y} x2={SHOULDER.x} y2={SHOULDER.y} stroke="#f97316" strokeWidth="13" strokeLinecap="round" />
        <polyline points={`${SHOULDER.x},${SHOULDER.y} 160,70 ${HANDS.x},${HANDS.y - 4}`} stroke="#fdba74" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="160" cy="40" r="10" fill="#fdba74" />
        <path d="M148 40 Q152 26 166 28 Q174 31 172 39 Z" fill={color} />
        {/* near leg + crank */}
        <line ref={r('crankA')} stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" />
        <circle cx={BB.x} cy={BB.y} r="7" fill="none" stroke="#e2e8f0" strokeWidth="3" />
        <g stroke="#1e3a8a" strokeWidth="8" strokeLinecap="round" fill="none"><polyline ref={r('legA')} /></g>
      </g>
    </svg>
  );
}

function draw(R, s, L) {
  if (!R.world) return;
  const cx = (RW.x + FW.x) / 2;
  const cy = RW.y + WR;
  R.world.setAttribute('transform', `rotate(${s.tilt.toFixed(2)} ${cx} ${cy})`);
  R.dash?.setAttribute('stroke-dashoffset', s.road.toFixed(1));
  const wDeg = (s.wheel * 180) / Math.PI;
  R.spokes0?.setAttribute('transform', `rotate(${wDeg.toFixed(1)} ${RW.x} ${RW.y})`);
  R.spokes1?.setAttribute('transform', `rotate(${wDeg.toFixed(1)} ${FW.x} ${FW.y})`);
  const legs = [[s.crank, 'A'], [s.crank + Math.PI, 'B']];
  for (const [a, k] of legs) {
    const foot = { x: BB.x + CR * Math.cos(a), y: BB.y + CR * Math.sin(a) };
    const kn = knee(HIP, foot);
    R[`leg${k}`]?.setAttribute('points', `${HIP.x},${HIP.y} ${kn.x.toFixed(1)},${kn.y.toFixed(1)} ${foot.x.toFixed(1)},${foot.y.toFixed(1)} ${(foot.x + 9).toFixed(1)},${(foot.y + 1).toFixed(1)}`);
    const c = R[`crank${k}`];
    if (c) { c.setAttribute('x1', BB.x); c.setAttribute('y1', BB.y); c.setAttribute('x2', foot.x.toFixed(1)); c.setAttribute('y2', foot.y.toFixed(1)); }
  }
  s.streaks.forEach((k, i) => {
    const el = R[`w${i}`];
    if (!el) return;
    const len = k.len * Math.min(2, 0.5 + Math.abs(L.headKmh) / 15);
    el.setAttribute('x1', k.x.toFixed(1));
    el.setAttribute('y1', k.y.toFixed(1));
    el.setAttribute('x2', (k.x + len).toFixed(1));
    el.setAttribute('y2', k.y.toFixed(1));
  });
}

/** Top-down wind dial: bike points up, arrow shows where the wind comes FROM relative to you. */
export function WindDial({ relDeg = 0, windKmh = 0, headKmh = 0, crossKmh = 0, size = 150 }) {
  const calm = windKmh < 2;
  const c = headKmh > 2 ? '#f87171' : headKmh < -2 ? '#4ade80' : '#facc15';
  return (
    <svg viewBox="0 0 120 120" width={size} height={size}>
      <circle cx="60" cy="60" r="54" fill="#0f172a" stroke="#334155" strokeWidth="2" />
      {['Μπροστά', 'Δεξιά', 'Πίσω', 'Αριστερά'].map((t, i) => {
        const a = (i * 90 * Math.PI) / 180;
        return <text key={t} x={60 + 44 * Math.sin(a)} y={63 - 44 * Math.cos(a)} fontSize="7" fill="#64748b" textAnchor="middle">{t}</text>;
      })}
      {/* bike from above */}
      <g fill="#e2e8f0">
        <rect x="57" y="40" width="6" height="40" rx="3" />
        <rect x="48" y="44" width="24" height="3" rx="1.5" />
        <circle cx="60" cy="58" r="6" fill="#f97316" />
      </g>
      {!calm && (
        <g transform={`rotate(${relDeg} 60 60)`}>
          <line x1="60" y1="10" x2="60" y2="30" stroke={c} strokeWidth="5" strokeLinecap="round" />
          <path d="M51 26 L60 38 L69 26 Z" fill={c} />
        </g>
      )}
      {calm && <text x="60" y="100" fontSize="9" fill="#94a3b8" textAnchor="middle">άπνοια</text>}
    </svg>
  );
}

/** Horizontal effort bar: zones 0–150 % FTP, white marker = you, blue tick = plan target. */
export function PowerGauge({ watts, target, ftp }) {
  const max = ftp * 1.5;
  const pos = (w) => `${Math.max(0, Math.min(100, (w / max) * 100))}%`;
  const zones = [[0, 0.56, '#64748b'], [0.56, 0.76, '#22c55e'], [0.76, 0.91, '#84cc16'], [0.91, 1.06, '#eab308'], [1.06, 1.21, '#f97316'], [1.21, 1.5, '#ef4444']];
  return (
    <div className="relative mt-3 h-5 w-full overflow-visible rounded-full bg-slate-800">
      <div className="flex h-5 overflow-hidden rounded-full">
        {zones.map(([a, b, c]) => <div key={a} style={{ width: `${((b - a) / 1.5) * 100}%`, background: c, opacity: 0.55 }} />)}
      </div>
      {target != null && <div className="absolute -top-1.5 h-8 w-1.5 -translate-x-1/2 rounded bg-sky-300" style={{ left: pos(target) }} />}
      <div className="absolute -top-2 h-9 w-3 -translate-x-1/2 rounded-full border-2 border-slate-900 bg-white shadow-lg transition-all duration-500" style={{ left: pos(watts) }} />
    </div>
  );
}
