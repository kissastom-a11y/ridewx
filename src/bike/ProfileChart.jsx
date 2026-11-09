/**
 * Elevation profile, each 1/200 of the route filled with its gradient colour,
 * the plan's target watts as a line above it, the rider's position, and a
 * touch read-out (km, altitude, gradient, target W, wind) under the finger.
 */
import { useMemo, useState } from 'react';
import { gradeColor, pct, windLabel } from './ui.js';

const W = 360;
const H = 170;
const L = 30;
const R = 30;
const T = 8;
const B = 18;
const PH = 46; // power band height

export default function ProfileChart({ profile, pieces, plan, atM = null, climbs = [] }) {
  const [hover, setHover] = useState(null);
  const geo = useMemo(() => {
    if (!profile?.length) return null;
    const total = profile[profile.length - 1].distM;
    const els = profile.map((p) => p.elev);
    const lo = Math.floor(Math.min(...els) / 10) * 10;
    const hi = Math.max(lo + 30, Math.ceil(Math.max(...els) / 10) * 10 + 10);
    const X = (d) => L + ((W - L - R) * d) / total;
    const Y = (e) => H - B - ((H - B - T - PH) * (e - lo)) / (hi - lo);
    const bars = [];
    const n = Math.min(200, profile.length - 1);
    for (let k = 0; k < n; k++) {
      const i0 = Math.floor((k * (profile.length - 1)) / n);
      const i1 = Math.floor(((k + 1) * (profile.length - 1)) / n);
      const a = profile[i0];
      const b = profile[i1];
      const g = (b.elev - a.elev) / (b.distM - a.distM || 1);
      bars.push(<path key={k} d={`M${X(a.distM)},${H - B} L${X(a.distM)},${Y(a.elev)} L${X(b.distM)},${Y(b.elev)} L${X(b.distM)},${H - B} Z`} fill={gradeColor(g)} />);
    }
    let pw = null;
    let pmax = 1;
    if (plan?.per?.length) {
      pmax = Math.max(...plan.per.map((x) => x.power), 1);
      const PY = (p) => T + PH - 6 - ((PH - 12) * p) / pmax;
      pw = plan.per.map((x, i) => `${i ? 'L' : 'M'}${X(x.d0)},${PY(x.power)} L${X(x.d0 + x.ds)},${PY(x.power)}`).join(' ');
    }
    const ticks = [];
    const stepKm = total > 60000 ? 10 : total > 25000 ? 5 : 2;
    for (let k = 0; k * stepKm * 1000 <= total; k++) ticks.push(k * stepKm);
    return { total, lo, hi, X, Y, bars, pw, pmax, ticks };
  }, [profile, plan]);

  if (!geo) return null;
  const { total, lo, hi, X, Y, bars, pw, pmax, ticks } = geo;

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const cx = ((e.touches?.[0]?.clientX ?? e.clientX) - r.left) * (W / r.width);
    const d = Math.max(0, Math.min(total, ((cx - L) / (W - L - R)) * total));
    const p = profile.reduce((best, x) => (Math.abs(x.distM - d) < Math.abs(best.distM - d) ? x : best), profile[0]);
    const pi = pieces?.findIndex((x) => d >= x.d0 && d < x.d0 + x.ds) ?? -1;
    setHover({ d, p, piece: pi >= 0 ? pieces[pi] : null, per: pi >= 0 ? plan?.per?.[pi] : null });
  };

  return (
    <div className="relative select-none">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" onPointerMove={onMove} onTouchMove={onMove} onPointerLeave={() => setHover(null)}>
        {[lo, (lo + hi) / 2, hi].map((e) => (
          <g key={e}>
            <line x1={L} x2={W - R} y1={Y(e)} y2={Y(e)} stroke="#334155" strokeWidth="0.5" />
            <text x={L - 3} y={Y(e) + 3} textAnchor="end" fontSize="8" fill="#94a3b8">{Math.round(e)}</text>
          </g>
        ))}
        {climbs.map((c, i) => <rect key={i} x={X(c.start)} width={X(c.end) - X(c.start)} y={T + PH} height={H - B - T - PH} fill="#f9731611" />)}
        {bars}
        <path d={profile.map((p, i) => `${i ? 'L' : 'M'}${X(p.distM)},${Y(p.elev)}`).join(' ')} fill="none" stroke="#f8fafc" strokeWidth="1" />
        {pw && (
          <g>
            <path d={pw} fill="none" stroke="#38bdf8" strokeWidth="1.6" />
            <text x={W - R + 3} y={T + 8} fontSize="8" fill="#38bdf8">{Math.round(pmax)}W</text>
            <text x={W - R + 3} y={T + PH - 4} fontSize="8" fill="#38bdf8">0</text>
          </g>
        )}
        {ticks.map((k) => <text key={k} x={X(k * 1000)} y={H - 5} textAnchor="middle" fontSize="8" fill="#94a3b8">{k}</text>)}
        <text x={W - R + 3} y={H - 5} fontSize="8" fill="#94a3b8">km</text>
        {atM != null && <line x1={X(atM)} x2={X(atM)} y1={T} y2={H - B} stroke="#f97316" strokeWidth="2" />}
        {hover && <line x1={X(hover.d)} x2={X(hover.d)} y1={T} y2={H - B} stroke="#fff" strokeWidth="0.8" strokeDasharray="2 2" />}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded-lg bg-slate-950/90 px-2 py-1 text-[11px] text-slate-100 whitespace-nowrap">
          {(hover.d / 1000).toFixed(2)} km · {Math.round(hover.p.elev)} m · <b style={{ color: gradeColor(hover.p.grade) }}>{pct(hover.p.grade)}</b>
          {hover.per && <> · <b className="text-sky-300">{Math.round(hover.per.power)} W</b> · {(hover.per.v * 3.6).toFixed(1)} km/h</>}
          {hover.piece && <> · {windLabel(hover.piece.head)}</>}
        </div>
      )}
    </div>
  );
}
