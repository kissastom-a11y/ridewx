import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGuidance } from '../features/guidance/useGuidance.js';
import ManeuverBanner from '../features/guidance/ManeuverBanner.jsx';
import { openSpotify } from '../features/music/openSpotify.js';
import { unlockAudio } from '../features/cameras/alertSound.js';
import { say, V, setVoiceEnabled, instructionText } from '../lib/voice.js';
import PlaceInput from '../features/routeWeather/PlaceInput.jsx';
import { useStoredState } from '../lib/storage.js';
import { useWakeLock } from '../hooks/useWakeLock.js';
import { ascentDescent, findSections } from '../lib/elevationProfile.js';
import { systemFrom, buildPieces, constantPlan, smartPlan, powerZone, sustainableMinutes, POSITIONS, EXPOSURE } from '../lib/cyclingPower.js';
import { weatherAlong } from './services.js';
import { usePlanner } from './usePlanner.js';
import { useBikeGps } from './useBikeGps.js';
import { useLiveRide } from './useLiveRide.js';
import { usePowerMeter, bluetoothSupported } from './usePowerMeter.js';
import BikeMap from './BikeMap.jsx';
import CyclistScene, { WindDial, PowerGauge } from './CyclistScene.jsx';
import ProfileChart from './ProfileChart.jsx';
import { BIKES, SURFACES, DEFAULT_RIDER, DIRECTOR_ROUTE } from './presets.js';
import { fmtDur, fmtKm, pct, compass8, windLabel, gradeColor, nowLocalInput } from './ui.js';

const inp = 'w-full rounded-xl bg-slate-800 px-3 py-3 text-base text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-sky-500';
const card = 'rounded-3xl bg-slate-900 p-4 ring-1 ring-slate-800';
const btn = 'rounded-xl px-4 py-3 text-base font-semibold active:scale-[.98]';

function Num({ label, value, onChange, step = 1, unit, min }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-400">{label}{unit ? ` (${unit})` : ''}</span>
      <input type="number" inputMode="decimal" className={inp} value={value} step={step} min={min}
        onChange={(e) => onChange(e.target.value === '' ? '' : +e.target.value)} />
    </label>
  );
}
function Sel({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-400">{label}</span>
      <select className={inp} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
const Kpi = ({ v, l, c, big }) => (
  <div className="rounded-xl bg-slate-800/70 px-3 py-2">
    <div className={`${big ? 'text-5xl' : 'text-3xl'} font-extrabold tabular-nums leading-tight`} style={c ? { color: c } : undefined}>{v}</div>
    <div className="text-sm text-slate-400">{l}</div>
  </div>
);

export default function BikeApp() {
  const [tab, setTab] = useState('plan');
  const [riders, setRiders] = useStoredState('bikewx.riders', [DEFAULT_RIDER]);
  const [riderId, setRiderId] = useStoredState('bikewx.rider', DEFAULT_RIDER.id);
  const rider = { ...DEFAULT_RIDER, ...(riders.find((r) => r.id === riderId) || riders[0]) };
  // A field being retyped is '' for a moment – fall back to the default so the maths never sees NaN.
  const rN = Object.fromEntries(Object.entries(rider).map(([k, v]) => [k, v === '' ? DEFAULT_RIDER[k] : v]));
  const setRider = (patch) => setRiders((rs) => rs.map((r) => (r.id === rider.id ? { ...r, ...patch } : r)));

  const [form, setForm] = useStoredState('bikewx.form', { from: DIRECTOR_ROUTE.from, via: DIRECTOR_ROUTE.via, to: DIRECTOR_ROUTE.to, targetMin: DIRECTOR_ROUTE.targetMin });
  const [depart, setDepart] = useState(nowLocalInput());
  const [wxMode, setWxMode] = useStoredState('bikewx.wxMode', 'forecast'); // forecast | manual
  const [manual, setManual] = useStoredState('bikewx.manualWx', { windSpeed: 10, windDirection: 0, temperature: 15, humidity: 60, pressure: 1013 });
  const planner = usePlanner();
  const data = planner.data;

  // ── pacing maths (recomputed instantly on any setting change) ──
  const sys = useMemo(() => systemFrom(rN), [rN.riderKg, rN.heightCm, rN.bikeKg, rN.kitKg, rN.position, rN.aeroFactor, rN.cdaOverride, rN.crr, rN.eta, rN.exposure, rN.maxPedalKmh, rN.maxDescentKmh, rN.ftp]); // eslint-disable-line react-hooks/exhaustive-deps
  const targetS = (+form.targetMin || 40) * 60;
  const stopsS = (+rN.stopsMin || 0) * 60;
  const wxFn = useCallback((d) => (wxMode === 'manual' || !data?.weather ? manual : weatherAlong(data.weather, d)), [wxMode, manual, data]);
  const calc = useMemo(() => {
    if (!data?.profile) return null;
    const pieces = buildPieces(data.profile, wxFn, sys);
    const moveS = Math.max(60, targetS - stopsS);
    const smart = smartPlan(pieces, sys, moveS, { beta: rN.pacingBeta, maxPct: rN.maxClimbPct });
    const constant = constantPlan(pieces, sys, moveS);
    const climbs = findSections(data.profile, { sign: 1 });
    const descents = findSections(data.profile, { sign: -1 });
    const ad = ascentDescent(data.profile);
    const alt = [-5, -2, 0, 2, 5].map((dm) => {
      const s = smartPlan(pieces, sys, Math.max(60, moveS + dm * 60), { beta: rN.pacingBeta, maxPct: rN.maxClimbPct });
      return { min: +form.targetMin + dm, avg: s.avgPower, np: s.np, feasible: s.feasible };
    });
    const total = data.profile[data.profile.length - 1].distM;
    const wxAvg = data.weather && wxMode !== 'manual' ? weatherAlong(data.weather, total / 2) : manual;
    return { pieces, smart, constant, climbs, descents, ad, alt, total, wxAvg };
  }, [data, sys, wxFn, targetS, stopsS, rN.pacingBeta, rN.maxClimbPct, form.targetMin, wxMode, manual]);

  // ── live ──
  const [riding, setRiding] = useState(false);
  const [simulate, setSimulate] = useState(false);
  const [factor, setFactor] = useState(10);
  const [startedAt, setStartedAt] = useState(null);
  const [follow, setFollow] = useState(true);
  const simRoute = useMemo(() => {
    if (!riding || !simulate || !calc) return null;
    const coords = [];
    const segDist = [];
    const segTime = [];
    calc.smart.per.forEach((x, i) => {
      const a = data.profile[i];
      coords.push({ lat: a.lat, lon: a.lon });
      segDist.push(x.ds);
      segTime.push(x.t);
    });
    const last = data.profile[data.profile.length - 1];
    coords.push({ lat: last.lat, lon: last.lon });
    return { coords, segDist, segTime };
  }, [riding, simulate, calc, data]);
  const gps = useBikeGps({ enabled: tab === 'ride' || riding, simRoute, speedFactor: factor });
  useWakeLock(riding);
  useEffect(() => { if (riding && !startedAt && gps.position) setStartedAt(gps.position.timestamp); }, [riding, gps.position, startedAt]);
  const pm = usePowerMeter();
  const [muted, setMuted] = useStoredState('bikewx.muted', false);
  useEffect(() => { setVoiceEnabled(!muted); }, [muted]);
  const { live, cond, need } = useLiveRide({
    active: riding, position: gps.position, profile: data?.profile, pieces: calc?.pieces || [], sys,
    forecast: wxMode === 'manual' || !data?.weather ? [{ distM: 0, ...manual }] : data.weather, targetS, stopsS, startedAt, plan: calc?.smart, useForecastWind: simulate || wxMode === 'manual',
  });

  const guidance = useGuidance({ riding, progress: live?.onRoute ? live.distM : null, guide: data?.guide, speedKmh: live?.speedKmh, muted });

  // Off the route for 4 fixes in a row → spoken warning (at most every 30 s). The map shows the way back.
  const offCount = useRef(0);
  const lastOff = useRef(0);
  useEffect(() => {
    if (!riding || !live) return;
    offCount.current = live.onRoute ? 0 : offCount.current + 1;
    if (offCount.current >= 4 && Date.now() - lastOff.current > 30000 && live.off != null) {
      lastOff.current = Date.now();
      if (!muted) say('Βγήκατε από τη διαδρομή. Επιστρέψτε στη χαραγμένη διαδρομή.', { urgent: true });
    }
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = () => {
    const departUnix = Math.floor(new Date(depart).getTime() / 1000);
    planner.plan({ from: form.from, via: form.via.filter((v) => v && (typeof v === 'object' || String(v).trim())), to: form.to, departUnix, targetS });
  };
  const addVia = (p) => setForm((f) => ({ ...f, via: [...f.via, { icon: '📌', name: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`, lat: p.lat, lon: p.lon }] }));

  const start = (sim) => {
    unlockAudio(); // must happen inside the tap (unlocks speech on iOS)
    if (!muted) say(V().rideStart);
    setSimulate(sim); setStartedAt(null); setRiding(true); setFollow(true); setTab('ride');
  };
  const stop = () => { setRiding(false); setSimulate(false); };

  return (
    <div className="flex h-full flex-col bg-slate-950 text-slate-100" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="flex items-center justify-between px-4 py-2">
        <div className="text-lg font-extrabold">🚴 RideWX <span className="text-sky-400">Watt</span></div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMuted(!muted)} className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 text-xl" title="Φωνή">{muted ? '🔇' : '🔊'}</button>
          <button onClick={openSpotify} className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1DB954] text-xl text-white" title="Spotify">🎵</button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-3 pb-4">
        {tab === 'plan' && (
          <PlanTab {...{ form, setForm, depart, setDepart, go, planner, data, calc, rider: rN, sys, wxMode, setWxMode, manual, setManual, addVia, start, targetS }} />
        )}
        {tab === 'ride' && (
          <RideTab {...{ guidance, muted, data, calc, live, cond, need, gps, riding, simulate, factor, setFactor, start, stop, pm, rider: rN, targetS, follow, setFollow, wxMode }} />
        )}
        {tab === 'set' && <SettingsTab {...{ rider, setRider, riders, setRiders, riderId: rider.id, setRiderId, sys }} />}
      </main>

      <nav className="grid grid-cols-3 border-t border-slate-800 bg-slate-950/95">
        {[['plan', '🗺️', 'Σχεδίαση'], ['ride', '🚴', 'Ζωντανά'], ['set', '⚙️', 'Ρυθμίσεις']].map(([k, ic, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex flex-col items-center gap-0.5 py-2.5 ${tab === k ? 'text-sky-400' : 'text-slate-400'}`}>
            <span className={`text-2xl ${tab === k ? '' : 'opacity-70 grayscale'}`}>{ic}</span>
            <span className={`text-sm ${tab === k ? 'font-bold' : ''}`}>{l}{k === 'ride' && riding ? ' ●' : ''}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ─────────────────────────── ΣΧΕΔΙΑΣΗ ─────────────────────────── */
function PlanTab({ form, setForm, depart, setDepart, go, planner, data, calc, rider, sys, wxMode, setWxMode, manual, setManual, addVia, start, targetS }) {
  const setVia = (i, v) => setForm((f) => ({ ...f, via: f.via.map((x, k) => (k === i ? v : x)) }));
  const s = calc?.smart;
  const npPct = s ? s.np / rider.ftp : 0;
  const zone = powerZone(npPct);
  const holdMin = sustainableMinutes(npPct);
  const verdict = !s ? null
    : !s.feasible ? { c: '#ef4444', t: 'Δεν βγαίνει: ούτε με τη μέγιστη ισχύ φτάνεις στον χρόνο. Δες τους εναλλακτικούς στόχους παρακάτω.' }
      : holdMin < targetS / 60 ? { c: '#ef4444', t: `Πάνω από τις δυνάμεις σου: αυτή η ένταση (NP ${Math.round(npPct * 100)}% FTP) κρατιέται ~${Math.round(holdMin)}′, ο στόχος θέλει ${Math.round(targetS / 60)}′.` }
        : npPct > 0.95 ? { c: '#f97316', t: 'Στο όριο: προσπάθεια time-trial. Καμία χαλάρωση, σωστή κατανομή στις ανόδους.' }
          : npPct > 0.85 ? { c: '#eab308', t: 'Απαιτητικό αλλά εφικτό: σταθερό tempo/sweet-spot.' }
            : { c: '#22c55e', t: 'Άνετα εφικτό με περιθώριο.' };

  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="space-y-2">
          <PlaceInput value={form.from} onChange={(v) => setForm((f) => ({ ...f, from: v }))} placeholder="Αφετηρία" className={inp} />
          {form.via.map((v, i) => (
            <div key={i} className="flex gap-2">
              <div className="flex-1"><PlaceInput value={v} onChange={(x) => setVia(i, x)} placeholder={`Μέσω ${i + 1}`} className={inp} /></div>
              <button className={`${btn} bg-slate-800 text-slate-300`} onClick={() => setForm((f) => ({ ...f, via: f.via.filter((_, k) => k !== i) }))}>✕</button>
            </div>
          ))}
          <PlaceInput value={form.to} onChange={(v) => setForm((f) => ({ ...f, to: v }))} placeholder="Προορισμός" className={inp} />
          <div className="flex gap-2 text-xs">
            <button className={`${btn} bg-slate-800 text-slate-300`} onClick={() => setForm((f) => ({ ...f, via: [...f.via, ''] }))}>+ ενδιάμεσο</button>
            <button className={`${btn} bg-slate-800 text-slate-300`} onClick={() => setForm({ from: DIRECTOR_ROUTE.from, via: DIRECTOR_ROUTE.via, to: DIRECTOR_ROUTE.to, targetMin: DIRECTOR_ROUTE.targetMin })}>↺ Αρτέμιδα → Π. Ράφτη</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Χρόνος στόχος" unit="λεπτά" value={form.targetMin} step={0.5} onChange={(v) => setForm((f) => ({ ...f, targetMin: v }))} />
            <label className="block"><span className="mb-1 block text-[11px] text-slate-400">Αναχώρηση</span>
              <input type="datetime-local" className={inp} value={depart} onChange={(e) => setDepart(e.target.value)} /></label>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1 rounded-lg bg-slate-800 p-1 text-xs">
              {[['forecast', 'Live πρόγνωση'], ['manual', 'Χειροκίνητος καιρός']].map(([k, l]) => (
                <button key={k} onClick={() => setWxMode(k)} className={`rounded-md px-2 py-1 ${wxMode === k ? 'bg-slate-600' : 'text-slate-400'}`}>{l}</button>
              ))}
            </div>
            <button onClick={go} disabled={planner.status === 'loading'} className={`${btn} bg-sky-600 text-white disabled:opacity-60`}>
              {planner.status === 'loading' ? planner.step : 'Υπολογισμός'}
            </button>
          </div>
          {wxMode === 'manual' && (
            <div className="grid grid-cols-3 gap-2">
              <Num label="Άνεμος" unit="km/h" value={manual.windSpeed} onChange={(v) => setManual({ ...manual, windSpeed: v })} />
              <Sel label="Από" value={String(manual.windDirection)} onChange={(v) => setManual({ ...manual, windDirection: +v })}
                options={[0, 45, 90, 135, 180, 225, 270, 315].map((d) => [String(d), `${compass8(d)} (${d}°)`])} />
              <Num label="Θερμ." unit="°C" value={manual.temperature} onChange={(v) => setManual({ ...manual, temperature: v })} />
            </div>
          )}
          {planner.error && <div className="rounded-lg bg-red-900/40 p-2 text-sm text-red-200">{planner.error}</div>}
          {data?.wxError && wxMode !== 'manual' && <div className="rounded-lg bg-amber-900/40 p-2 text-xs text-amber-200">Χωρίς πρόγνωση ({data.wxError}) – χρησιμοποιείται ο χειροκίνητος καιρός.</div>}
        </div>
      </div>

      <BikeMap profile={data?.profile} stops={data?.stops || []} onTap={addVia} className="h-56 overflow-hidden rounded-2xl" />
      <div className="-mt-2 text-center text-[11px] text-slate-500">Πάτα στον χάρτη για να προσθέσεις ενδιάμεσο σημείο (π.χ. για να «κλειδώσεις» Λ. Βραυρώνος) και ξαναϋπολόγισε.</div>

      {calc && (
        <>
          <div className={card}>
            <div className="mb-2 flex items-baseline justify-between">
              <div className="text-xs uppercase tracking-wide text-slate-400">Πλάνο για {fmtDur(targetS)}</div>
              <div className="text-[11px] text-slate-500">{data.route.source === 'bike' ? 'δρομολόγηση ποδηλάτου' : 'δρομολόγηση αυτοκινήτου (εφεδρική)'}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Kpi big v={`${Math.round(s.avgPower)} W`} l="Μέση ισχύς – έξυπνη κατανομή" c="#38bdf8" />
              <Kpi big v={`${Math.round(calc.constant.base)} W`} l="Σταθερή ισχύς σε όλη τη διαδρομή" />
              <Kpi v={`${Math.round(s.np)} W`} l={`NP · ${Math.round(npPct * 100)}% FTP`} c={zone.color} />
              <Kpi v={(s.avgPower / rider.riderKg).toFixed(2)} l="W/kg (μέση)" />
              <Kpi v={`${((calc.total / s.time) * 3.6).toFixed(1)}`} l="km/h μέση σε κίνηση" />
              <Kpi v={`${Math.round(s.work / 1000)} kJ`} l="Έργο" />
            </div>
            {verdict && <div className="mt-2 rounded-lg p-2 text-sm" style={{ background: `${verdict.c}22`, color: verdict.c }}><b>{zone.label}.</b> {verdict.t}</div>}
          </div>

          <div className={card}>
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span>{fmtKm(calc.total)} · ↑ {Math.round(calc.ad.up)} m · ↓ {Math.round(calc.ad.down)} m</span>
              <span className="text-sky-400">— watt πλάνου</span>
            </div>
            <ProfileChart profile={data.profile} pieces={calc.pieces} plan={s} climbs={calc.climbs} />
            <Legend />
          </div>

          <div className={card}>
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Καιρός {calc.wxAvg.eta == null ? '(χειροκίνητος)' : `στη μέση της διαδρομής, ${new Date(calc.wxAvg.eta * 1000).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}`}</div>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <Kpi v={`${Math.round(calc.wxAvg.windSpeed)}`} l={`km/h από ${compass8(calc.wxAvg.windDirection)} (10 m)`} />
              <Kpi v={`${Math.round(calc.wxAvg.windGusts ?? calc.wxAvg.windSpeed)}`} l="ριπές km/h" />
              <Kpi v={`${calc.wxAvg.temperature?.toFixed(0)}°`} l={`υγρ. ${Math.round(calc.wxAvg.humidity ?? 60)}%`} />
            </div>
            <div className="mt-2 text-[11px] text-slate-500">Ο άνεμος μειώνεται στο ύψος του αναβάτη ({EXPOSURE[rider.exposure]?.label}) και αναλύεται σε κόντρα/πρίμα/πλάγιο για κάθε κομμάτι δρόμου.</div>
          </div>

          {calc.climbs.length > 0 && (
            <div className={card}>
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Άνοδοι – πώς να τις πας</div>
              <table className="w-full text-sm">
                <thead className="text-[11px] text-slate-500"><tr><th className="text-left">km</th><th>μήκος</th><th>μέση/max</th><th>watt</th><th>χρόνος</th></tr></thead>
                <tbody>
                  {calc.climbs.map((c, i) => {
                    const ps = s.per.filter((x) => x.d0 >= c.start && x.d0 < c.end);
                    const t = ps.reduce((a, x) => a + x.t, 0);
                    const w = ps.reduce((a, x) => a + x.power * x.t, 0) / (t || 1);
                    return (
                      <tr key={i} className="border-t border-slate-800 text-center tabular-nums">
                        <td className="py-1 text-left">{(c.start / 1000).toFixed(1)}</td>
                        <td>{fmtKm(c.length)}</td>
                        <td><span style={{ color: gradeColor(c.avgGrade) }}>{pct(c.avgGrade)}</span> / {pct(c.maxGrade)}</td>
                        <td className="font-semibold text-sky-300">{Math.round(w)}</td>
                        <td>{fmtDur(t)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {calc.descents.length > 0 && <div className="mt-2 text-[11px] text-slate-500">Κάθοδοι: {calc.descents.map((d) => `${(d.start / 1000).toFixed(1)} km (${pct(d.avgGrade)})`).join(' · ')} – εκεί το πλάνο ρίχνει watt και «κερδίζει» ταχύτητα δωρεάν.</div>}
            </div>
          )}

          <div className={card}>
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Άλλοι στόχοι</div>
            <div className="grid grid-cols-5 gap-1 text-center text-sm tabular-nums">
              {calc.alt.map((a) => (
                <div key={a.min} className={`rounded-lg p-1 ${a.min === +calc.alt[2].min ? 'bg-sky-900/50' : 'bg-slate-800/60'}`}>
                  <div className="text-[11px] text-slate-400">{a.min}′</div>
                  <div className="font-semibold">{a.feasible ? Math.round(a.avg) : '✕'}</div>
                  <div className="text-[10px]" style={{ color: powerZone(a.np / rider.ftp).color }}>{Math.round((a.np / rider.ftp) * 100)}%</div>
                </div>
              ))}
            </div>
          </div>

          {data.guide?.length > 0 && (
            <details className={card}>
              <summary className="cursor-pointer text-xs uppercase tracking-wide text-slate-400">Οδηγίες διαδρομής ({data.guide.length} στροφές)</summary>
              <ol className="mt-2 space-y-1 text-sm">
                {data.guide.map((m, i) => (
                  <li key={i} className="flex gap-2 border-t border-slate-800 pt-1">
                    <span className="w-14 shrink-0 tabular-nums text-slate-400">{(m.distM / 1000).toFixed(1)} km</span>
                    <span>{instructionText(m)}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-2 text-[11px] text-slate-500">Στη διαδρομή οι οδηγίες λέγονται φωναχτά στα ελληνικά, όπως στο RideWX. Πάτα την πράσινη κάρτα για επανάληψη.</div>
            </details>
          )}

          <div className="flex gap-2">
            <button className={`${btn} flex-1 bg-emerald-600 text-white`} onClick={() => start(false)}>▶ Ξεκίνα (GPS)</button>
            <button className={`${btn} bg-slate-800 text-slate-200`} onClick={() => start(true)}>Προσομοίωση</button>
          </div>
          <div className="text-[11px] text-slate-500">
            Αναβάτης {rider.name}: {rider.riderKg} kg{!rider.weightConfirmed && ' ⚠ (επιβεβαίωσε στις Ρυθμίσεις)'} · FTP {rider.ftp} W · CdA {sys.cda.toFixed(3)} m² · σύνολο {sys.mass.toFixed(1)} kg · στάσεις {rider.stopsMin}′
          </div>
        </>
      )}
    </div>
  );
}

function Legend() {
  const items = [[-0.07, '≤−6'], [-0.04, '−3'], [-0.02, '−1'], [0, '0'], [0.02, '+1'], [0.04, '+3'], [0.07, '+6'], [0.1, '+9%']];
  return (
    <div className="mt-1 flex justify-center gap-1 text-[10px] text-slate-400">
      {items.map(([g, l]) => <span key={l} className="flex items-center gap-0.5"><i className="inline-block h-2 w-3 rounded-sm" style={{ background: gradeColor(g) }} />{l}</span>)}
    </div>
  );
}

/* ─────────────────────────── ΖΩΝΤΑΝΑ ─────────────────────────── */
function effortMsg(diff, tgt) {
  if (diff == null || tgt == null) return null;
  const band = Math.max(8, tgt * 0.07);
  if (diff > band) return { t: `Χαλάρωσε ${Math.round(diff)} W`, i: '▼', c: '#fdba74' };
  if (diff < -band) return { t: `Ανέβασε ${Math.round(-diff)} W`, i: '▲', c: '#fde047' };
  return { t: 'Στον στόχο', i: '✓', c: '#86efac' };
}

const Tile = ({ v, l, c, sub }) => (
  <div className="rounded-2xl bg-slate-900 p-3 ring-1 ring-slate-800">
    <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{l}</div>
    <div className="mt-1 text-[34px] font-extrabold leading-none tabular-nums" style={c ? { color: c } : undefined}>{v}</div>
    {sub && <div className="mt-1 text-sm text-slate-400">{sub}</div>}
  </div>
);

function RideTab({ guidance, muted, data, calc, live, cond, need, gps, riding, simulate, factor, setFactor, start, stop, pm, rider, targetS, follow, setFollow, wxMode }) {
  if (!calc) {
    return (
      <div className="mt-16 space-y-4 text-center">
        <div className="text-6xl">🚴</div>
        <div className="text-lg text-slate-300">Κάνε πρώτα <b>Υπολογισμό</b> στη Σχεδίαση.</div>
      </div>
    );
  }
  const measured = pm.watts;
  const watts = measured ?? live?.p3 ?? 0;
  const pctFtp = watts / rider.ftp;
  const zone = powerZone(pctFtp);
  const tgt = live?.target;
  const diff = tgt != null ? watts - tgt : null;
  const msg = riding ? effortMsg(diff, tgt) : null;
  const w = live?.w;
  const headKmh = live ? live.head * 3.6 : 0;
  const crossKmh = live ? live.cross * 3.6 : 0;
  const windWord = !live ? '–' : Math.abs(headKmh) < 2 ? (Math.abs(crossKmh) >= 2 ? 'Πλάγιος' : 'Άπνοια') : headKmh > 0 ? 'Κόντρα' : 'Πρίμα';

  return (
    <div className="space-y-3">
      {riding && guidance?.next && (
        <button type="button" className="sticky top-0 z-20 block h-[76px] w-full text-left"
          onClick={() => !muted && say(instructionText(guidance.next, guidance.dist), { urgent: true, force: true })}>
          <ManeuverBanner guidance={guidance} />
          <span role="button" onClick={(e) => { e.stopPropagation(); openSpotify(); }}
            className="absolute right-1 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#1DB954] text-2xl text-white shadow-lg">🎵</span>
        </button>
      )}
      {gps.error && <div className="rounded-xl bg-red-900/50 p-3 text-base text-red-200">{gps.error}</div>}
      {riding && live && !live.onRoute && live.off != null && (
        <div className="rounded-xl bg-amber-900/60 p-3 text-base text-amber-100">⚠ Εκτός διαδρομής ({Math.round(live.off)} m) – ακολούθησε τη γραμμή στον χάρτη.</div>
      )}

      {/* ── WATT: the hero, coloured by effort zone ── */}
      <div className="relative overflow-hidden rounded-3xl p-4 shadow-xl transition-colors duration-700"
        style={{ background: `linear-gradient(135deg, ${zone.color}ee, ${zone.color}88 60%, #0f172a)` }}>
        {riding && diff != null && diff > Math.max(15, tgt * 0.15) && <div className="pointer-events-none absolute inset-0 animate-pulse bg-white/10" />}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wider text-white/80">Watt τώρα {measured != null ? '· μετρητής' : '· εκτίμηση'}</div>
            <div className="flex items-baseline gap-1 text-white drop-shadow">
              <span className="text-[92px] font-black leading-none tabular-nums">{Math.round(watts)}</span>
              <span className="text-3xl font-bold">W</span>
            </div>
            <div className="mt-1 inline-block rounded-full bg-black/30 px-3 py-1 text-sm font-bold text-white">{zone.label} · {Math.round(pctFtp * 100)}% FTP</div>
          </div>
          <div className="text-right text-white">
            <div className="text-sm font-semibold uppercase tracking-wider text-white/80">Στόχος</div>
            <div className="text-5xl font-black tabular-nums leading-none">{tgt != null ? Math.round(tgt) : '–'}</div>
            <div className="text-sm text-white/80">W εδώ</div>
          </div>
        </div>
        {msg && <div className="mt-3 rounded-xl bg-black/35 px-3 py-2 text-center text-2xl font-extrabold" style={{ color: msg.c }}>{msg.i} {msg.t}</div>}
        <PowerGauge watts={watts} target={tgt} ftp={rider.ftp} />
      </div>

      {/* ── the rider, wind and road ── */}
      <div className="relative overflow-hidden rounded-3xl ring-1 ring-slate-800">
        <CyclistScene speedKmh={live?.speedKmh ?? 0} power={riding ? watts : 0} grade={live?.grade ?? 0} headKmh={headKmh} color={zone.color} />
        <div className="pointer-events-none absolute left-3 top-2 text-white">
          <span className="text-5xl font-black tabular-nums">{live ? live.speedKmh.toFixed(1) : '0.0'}</span>
          <span className="ml-1 text-lg font-semibold text-slate-300">km/h</span>
        </div>
        <div className="pointer-events-none absolute right-3 top-3 rounded-xl px-3 py-1 text-2xl font-black tabular-nums text-slate-900"
          style={{ background: gradeColor(live?.grade ?? 0) }}>{live ? pct(live.grade) : '0%'}</div>
      </div>

      <div className="flex items-center gap-3 rounded-3xl bg-slate-900 p-3 ring-1 ring-slate-800">
        <WindDial relDeg={live?.rel ?? 0} windKmh={live?.uKmh ?? 0} headKmh={headKmh} crossKmh={crossKmh} size={130} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Άνεμος σε σχέση με σένα</div>
          <div className="text-3xl font-extrabold" style={{ color: headKmh > 2 ? '#f87171' : headKmh < -2 ? '#4ade80' : '#facc15' }}>{windWord}</div>
          {live && (
            <div className="mt-1 space-y-0.5 text-base text-slate-300">
              <div>{headKmh >= 0 ? 'κόντρα' : 'πρίμα'} <b className="tabular-nums">{Math.abs(headKmh).toFixed(0)}</b> km/h</div>
              <div>πλάγιος <b className="tabular-nums">{Math.abs(crossKmh).toFixed(0)}</b> km/h {Math.abs(crossKmh) >= 2 ? (crossKmh > 0 ? 'από δεξιά' : 'από αριστερά') : ''}</div>
              {w && <div className="text-xs text-slate-500">{Math.round(w.windSpeed)} km/h από {compass8(w.windDirection)} στα 10 m · {simulate || wxMode === 'manual' ? 'πρόγνωση' : cond ? 'live' : '…'}</div>}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Tile l="Χρειάζεσαι" v={need?.watts != null ? `${Math.round(need.watts)} W` : '–'} c={need && !need.feasible ? '#ef4444' : '#38bdf8'}
          sub={need ? (need.feasible ? 'σταθερά ως το τέλος' : 'ο στόχος δεν βγαίνει') : 'από εδώ ως το τέλος'} />
        <Tile l="Πλάνο" v={need ? `${need.deltaS > 0 ? '+' : '−'}${fmtDur(Math.abs(need.deltaS))}` : '–'} c={need ? (need.deltaS > 0 ? '#f97316' : '#22c55e') : undefined}
          sub={need ? `${need.deltaS > 0 ? 'πίσω' : 'μπροστά'} · άφιξη ${fmtDur(need.projectedS)}` : 'μπροστά / πίσω'} />
        <Tile l="Χρόνος" v={live ? fmtDur(live.elapsed) : '0:00'} sub={`στόχος ${fmtDur(targetS)}`} />
        <Tile l="Απομένουν" v={live ? fmtKm(Math.max(0, live.left)) : fmtKm(calc.total)} sub={live ? `↑ ${Math.round(live.climbLeft)} m ακόμα` : ''} />
      </div>

      {!riding ? (
        <div className="grid grid-cols-3 gap-2">
          <button className="col-span-2 rounded-2xl bg-emerald-600 py-5 text-xl font-extrabold text-white active:scale-[.98]" onClick={() => start(false)}>▶ Ξεκίνα</button>
          <button className="rounded-2xl bg-slate-800 py-5 text-base font-bold text-slate-200 active:scale-[.98]" onClick={() => start(true)}>Προσομοίωση</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button className="rounded-2xl bg-red-600 px-6 py-4 text-lg font-extrabold text-white" onClick={stop}>■ Τέλος</button>
          {simulate && (
            <div className="flex flex-1 justify-between gap-1 rounded-2xl bg-slate-800 p-1 text-base">
              {[1, 5, 10, 20].map((f) => <button key={f} onClick={() => setFactor(f)} className={`flex-1 rounded-xl py-3 ${factor === f ? 'bg-slate-600 font-bold' : ''}`}>{f}×</button>)}
            </div>
          )}
        </div>
      )}

      <div className={card}>
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Υψομετρικό & watt πλάνου</div>
        <ProfileChart profile={data.profile} pieces={calc.pieces} plan={calc.smart} climbs={calc.climbs} atM={live?.distM ?? null} />
      </div>

      <div className="relative">
        <BikeMap profile={data.profile} stops={data.stops} position={gps.position} follow={follow} className="h-72 overflow-hidden rounded-3xl" />
        <button onClick={() => setFollow(!follow)} className={`absolute bottom-3 left-3 rounded-full px-4 py-2 text-sm font-bold shadow-lg ${follow ? 'bg-sky-600 text-white' : 'bg-white text-slate-800'}`}>
          {follow ? '◎ Ακολουθεί' : '◎ Ακολούθηση'}
        </button>
      </div>

      {live?.parts && (
        <div className={card}>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Πού πάνε τα watt τώρα</div>
          <Breakdown parts={live.parts} v={live.speedKmh / 3.6} eta={rider.eta} />
          <div className="mt-2 text-xs text-slate-500">ρ αέρα {live.rho.toFixed(3)} kg/m³ · μέση ισχύς σε κίνηση {Math.round(live.avgPower)} W</div>
        </div>
      )}

      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-base">Μετρητής ισχύος</div>
          {bluetoothSupported()
            ? (pm.status === 'on'
              ? <button className={`${btn} bg-slate-800`} onClick={pm.disconnect}>Αποσύνδεση {pm.name}</button>
              : <button className={`${btn} bg-slate-800`} onClick={pm.connect}>{pm.status === 'connecting' ? 'Σύνδεση…' : 'Σύνδεση Bluetooth'}</button>)
            : <span className="text-sm text-slate-500">μόνο Chrome σε Android</span>}
        </div>
        {pm.error && <div className="mt-1 text-sm text-red-300">{pm.error}</div>}
        <div className="mt-1 text-xs text-slate-500">Χωρίς μετρητή τα watt είναι εκτίμηση από ταχύτητα, επιτάχυνση, κλίση και άνεμο (±10–15%).</div>
      </div>
    </div>
  );
}

function Breakdown({ parts, v, eta }) {
  const rows = [['Αέρας', parts.aero, '#38bdf8'], ['Κύλιση', parts.roll, '#a3a3a3'], ['Κλίση', parts.grav, '#f97316'], ['Επιτάχυνση', parts.acc, '#a855f7']]
    .map(([l, f, c]) => [l, (f * v) / eta, c]);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r[1])));
  return (
    <div className="space-y-1">
      {rows.map(([l, p, c]) => (
        <div key={l} className="flex items-center gap-2 text-xs">
          <span className="w-20 text-slate-400">{l}</span>
          <div className="relative h-3 flex-1 rounded bg-slate-800">
            <div className="absolute top-0 h-3 rounded" style={{ background: c, width: `${(Math.abs(p) / max) * 50}%`, left: p >= 0 ? '50%' : `${50 - (Math.abs(p) / max) * 50}%` }} />
            <div className="absolute left-1/2 top-0 h-3 w-px bg-slate-500" />
          </div>
          <span className="w-12 text-right tabular-nums">{Math.round(p)} W</span>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────── ΡΥΘΜΙΣΕΙΣ ─────────────────────────── */
function SettingsTab({ rider, setRider, riders, setRiders, setRiderId, sys }) {
  const addRider = () => {
    const id = `r${Date.now()}`;
    setRiders((rs) => [...rs, { ...DEFAULT_RIDER, id, name: `Αναβάτης ${rs.length + 1}` }]);
    setRiderId(id);
  };
  const del = () => {
    if (riders.length < 2) return;
    const rest = riders.filter((r) => r.id !== rider.id);
    setRiders(rest);
    setRiderId(rest[0].id);
  };
  return (
    <div className="space-y-3">
      <div className={card}>
        <div className="mb-2 flex items-center gap-2">
          <select className={inp} value={rider.id} onChange={(e) => setRiderId(e.target.value)}>
            {riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button className={`${btn} bg-slate-800`} onClick={addRider}>+</button>
          <button className={`${btn} bg-slate-800 disabled:opacity-40`} disabled={riders.length < 2} onClick={del}>🗑</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 block"><span className="mb-1 block text-[11px] text-slate-400">Όνομα</span>
            <input className={inp} value={rider.name} onChange={(e) => setRider({ name: e.target.value })} /></label>
          <Num label="Βάρος αναβάτη" unit="kg" step={0.5} value={rider.riderKg} onChange={(v) => setRider({ riderKg: v, weightConfirmed: true })} />
          <Num label="Ύψος" unit="cm" value={rider.heightCm} onChange={(v) => setRider({ heightCm: v })} />
          <Num label="FTP" unit="W" value={rider.ftp} onChange={(v) => setRider({ ftp: v })} />
          <Num label="Στάσεις/φανάρια" unit="λεπτά" step={0.5} value={rider.stopsMin} onChange={(v) => setRider({ stopsMin: v })} />
        </div>
        {!rider.weightConfirmed && <div className="mt-2 text-xs text-amber-300">⚠ Το βάρος είναι προεπιλογή – βάλε το πραγματικό, επηρεάζει πολύ τις ανόδους.</div>}
      </div>

      <div className={card}>
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Ποδήλατο & θέση</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2"><Sel label="Ποδήλατο" value={rider.bikeId} options={BIKES.map((b) => [b.id, b.label])}
            onChange={(id) => { const b = BIKES.find((x) => x.id === id); setRider({ bikeId: id, bikeKg: b.kg, aeroFactor: b.aeroFactor }); }} /></div>
          <Num label="Βάρος ποδηλάτου" unit="kg" step={0.1} value={rider.bikeKg} onChange={(v) => setRider({ bikeKg: v })} />
          <Num label="Ρούχα/παγούρια/εργαλεία" unit="kg" step={0.1} value={rider.kitKg} onChange={(v) => setRider({ kitKg: v })} />
          <Sel label="Θέση" value={rider.position} options={Object.entries(POSITIONS).map(([k, p]) => [k, p.label])} onChange={(v) => setRider({ position: v })} />
          <Sel label="Δρόμος / ελαστικά" value={rider.surface} options={SURFACES.map((s) => [s.id, `${s.label} (${s.crr})`])}
            onChange={(id) => setRider({ surface: id, crr: SURFACES.find((s) => s.id === id).crr })} />
          <Sel label="Έκθεση στον άνεμο" value={rider.exposure} options={Object.entries(EXPOSURE).map(([k, e]) => [k, e.label])} onChange={(v) => setRider({ exposure: v })} />
          <Num label="CdA χειροκίνητα (0 = αυτόματο)" unit="m²" step={0.005} value={rider.cdaOverride} onChange={(v) => setRider({ cdaOverride: v })} />
        </div>
        <div className="mt-2 text-xs text-slate-400">CdA {sys.cda.toFixed(3)} m² · συνολική μάζα {sys.mass.toFixed(1)} kg · Crr {sys.crr}</div>
      </div>

      <div className={card}>
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Κατανομή προσπάθειας</div>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Μέγιστο στις ανόδους" unit="% FTP" value={Math.round(rider.maxClimbPct * 100)} onChange={(v) => setRider({ maxClimbPct: v / 100 })} />
          <Sel label="Επιθετικότητα κατανομής" value={String(rider.pacingBeta)} onChange={(v) => setRider({ pacingBeta: +v })}
            options={[['0', 'Καμία (σταθερά watt)'], ['0.2', 'Ήπια'], ['0.3', 'Κανονική'], ['0.45', 'Δυνατή']]} />
          <Num label="Σταματάς να κάνεις πετάλι πάνω από" unit="km/h" value={rider.maxPedalKmh} onChange={(v) => setRider({ maxPedalKmh: v })} />
          <Num label="Μέγιστη ταχύτητα καθόδου" unit="km/h" value={rider.maxDescentKmh} onChange={(v) => setRider({ maxDescentKmh: v })} />
          <Num label="Απόδοση μετάδοσης" step={0.005} value={rider.eta} onChange={(v) => setRider({ eta: v })} />
        </div>
        <div className="mt-2 text-[11px] text-slate-500">Έξυπνη κατανομή: περισσότερα watt εκεί που πας αργά (άνοδος, κόντρα αέρας), λιγότερα στις καθόδους και με πρίμα. Ίδιος χρόνος με μικρότερη μέση ισχύ.</div>
      </div>
    </div>
  );
}
