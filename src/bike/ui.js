/** Small formatting helpers shared by the bike screens. */
export function gradeColor(g) {
  const p = g * 100;
  if (p <= -6) return '#1d4ed8';
  if (p <= -3) return '#3b82f6';
  if (p < -1) return '#7dd3fc';
  if (p < 1) return '#94a3b8';
  if (p < 3) return '#facc15';
  if (p < 6) return '#f97316';
  if (p < 9) return '#ef4444';
  return '#7f1d1d';
}

export const fmtDur = (s) => {
  if (!Number.isFinite(s)) return '–';
  const neg = s < 0;
  const a = Math.abs(Math.round(s));
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const x = a % 60;
  return (neg ? '−' : '') + (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`;
};

export const fmtKm = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`);
export const pct = (g) => `${g >= 0 ? '+' : ''}${(g * 100).toFixed(1)}%`;

const DIRS = ['Β', 'ΒΑ', 'Α', 'ΝΑ', 'Ν', 'ΝΔ', 'Δ', 'ΒΔ'];
export const compass8 = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export function windLabel(headMs) {
  const k = headMs * 3.6;
  if (Math.abs(k) < 2) return 'πλάγιος/άπνοια';
  return k > 0 ? `κόντρα ${k.toFixed(0)} km/h` : `πρίμα ${(-k).toFixed(0)} km/h`;
}

export const nowLocalInput = () => {
  const d = new Date(Date.now() + 10 * 60000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
