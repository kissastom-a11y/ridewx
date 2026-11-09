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
import ProfileChart from './ProfileChart.jsx';
import { BIKES, SURFACES, DEFAULT_RIDER, DIRECTOR_ROUTE } from './presets.js';
import { fmtDur, fmtKm, pct, compass8, windLabel, gradeColor, nowLocalInput } from './ui.js';

const inp = 'w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 ring-1 ring-slate-700 focus:outline-none focus:ring-sky-500';
const card = 'rounded-2xl bg-slate-900/80 p-3 ring-1 ring-slate-800';
const btn = 'rounded-xl px-3 py-2 text-sm font-semibold active:scale-[.98]';

function Num({ label, value, onChange, step = 1, unit, min }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-slate-400">{label}{unit ? ` (${unit})` : ''}</span>
      <input type="number" inputMode="decimal" className={inp} value={value} step={step} min={min}
        onChange={(e) => onChange(e.target.value === '' ? '' : +e.target.value)} />
    </label>
  );
}
function Sel({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-slate-400">{label}</span>
      <select className={inp} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
const Kpi = ({ v, l, c, big }) => (
  <div className="rounded-xl bg-slate-800/70 px-3 py-2">
    <div className={`${big ? 'text-4xl' : 'text-2xl'} font-bold tabular-nums leading-tight`} style={c ? { color: c } : undefined}>{v}</div>
    <div className="text-[11px] text-slate-400">{l}</div>
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
      <header className="flex items-center justify-between px-3 py-2">
        <div className="text-sm font-bold leading-tight">🚴 RideWX<br /><span className="text-sky-400">Watt</span></div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMuted(!muted)} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800" title="Φωνή">{muted ? '🔇' : '🔊'}</button>
          <button onClick={openSpotify} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1DB954] text-white" title="Spotify">🎵</button>
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-900 p-1 text-sm">
          {[['plan', 'Σχεδίαση'], ['ride', 'Ζωντανά'], ['set', 'Ρυθμίσεις']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-2.5 py-1 ${tab === k ? 'bg-sky-600 text-white' : 'text-slate-300'}`}>{l}</button>
          ))}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-3 pb-6">
        {tab === 'plan' && (
          <PlanTab {...{ form, setForm, depart, setDepart, go, planner, data, calc, rider: rN, sys, wxMode, setWxMode, manual, setManual, addVia, start, targetS }} />
        )}
        {tab === 'ride' && (
          <RideTab {...{ guidance, muted, data, calc, live, cond, need, gps, riding, simulate, factor, setFactor, start, stop, pm, rider: rN, targetS, follow, setFollow, wxMode }} />
        )}
        {tab === 'set' && <SettingsTab {...{ rider, setRider, riders, setRiders, riderId: rider.id, setRiderId, sys }} />}
      </main>
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
function RideTab({ guidance, muted, data, calc, live, cond, need, gps, riding, simulate, factor, setFactor, start, stop, pm, rider, targetS, follow, setFollow, wxMode }) {
  if (!calc) return <div className="mt-10 text-center text-slate-400">Κάνε πρώτα Υπολογισμό στη Σχεδίαση.</div>;
  const measured = pm.watts;
  const shown = measured ?? live?.p3 ?? 0;
  const zone = powerZone(shown / rider.ftp);
  const tgt = live?.target;
  const diff = tgt != null ? shown - tgt : null;
  const w = live?.w;
  return (
    <div className="space-y-3">
      {!riding ? (
        <div className="flex gap-2">
          <button className={`${btn} flex-1 bg-emerald-600 text-white`} onClick={() => start(false)}>▶ Ξεκίνα (GPS)</button>
          <button className={`${btn} bg-slate-800 text-slate-200`} onClick={() => start(true)}>Προσομοίωση</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button className={`${btn} bg-red-600 text-white`} onClick={stop}>■ Τέλος</button>
          {simulate && (
            <div className="flex gap-1 rounded-lg bg-slate-800 p-1 text-xs">
              {[1, 5, 10, 20].map((f) => <button key={f} onClick={() => setFactor(f)} className={`rounded px-2 py-1 ${factor === f ? 'bg-slate-600' : ''}`}>{f}×</button>)}
            </div>
          )}
          <label className="ml-auto flex items-center gap-1 text-xs text-slate-400"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> ακολούθηση</label>
        </div>
      )}
      {gps.error && <div className="rounded-lg bg-red-900/40 p-2 text-sm text-red-200">{gps.error}</div>}
      {riding && guidance?.next && (
        <button type="button" className="sticky top-0 z-10 block h-[76px] w-full text-left"
          onClick={() => !muted && say(instructionText(guidance.next, guidance.dist), { urgent: true, force: true })}>
          <ManeuverBanner guidance={guidance} />
          <span role="button" onClick={(e) => { e.stopPropagation(); openSpotify(); }}
            className="absolute right-1 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#1DB954] text-2xl text-white shadow-lg">🎵</span>
        </button>
      )}
      {riding && live && !live.onRoute && live.off != null && (
        <div className="rounded-lg bg-amber-900/50 p-2 text-sm text-amber-200">⚠ Εκτός διαδρομής ({Math.round(live.off)} m) – ακολούθησε τη χρωματιστή γραμμή στον χάρτη.</div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 rounded-2xl p-3 ring-1 ring-slate-800" style={{ background: `${zone.color}22` }}>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-6xl font-black tabular-nums leading-none" style={{ color: zone.color }}>{Math.round(shown)}<span className="text-2xl"> W</span></div>
              <div className="mt-1 text-xs text-slate-300">{measured != null ? `μετρητής ${pm.name} · εκτίμηση ${Math.round(live?.p3 ?? 0)} W` : 'εκτίμηση (3″)'} · {zone.label} · {Math.round((shown / rider.ftp) * 100)}% FTP</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-slate-400">στόχος εδώ</div>
              <div className="text-3xl font-bold tabular-nums text-sky-300">{tgt != null ? Math.round(tgt) : '–'}</div>
              {diff != null && <div className={`text-sm font-semibold ${Math.abs(diff) < 10 ? 'text-emerald-400' : diff > 0 ? 'text-orange-400' : 'text-yellow-300'}`}>{diff > 0 ? '+' : ''}{Math.round(diff)} W</div>}
            </div>
          </div>
        </div>
        <Kpi v={need?.watts != null ? `${Math.round(need.watts)} W` : '–'} l={need ? (need.feasible ? 'χρειάζεσαι σταθερά από εδώ' : 'δεν βγαίνει πια ο στόχος') : 'χρειάζεσαι από εδώ'} c={need && !need.feasible ? '#ef4444' : '#38bdf8'} />
        <Kpi v={need ? `${need.deltaS > 0 ? '+' : '−'}${fmtDur(Math.abs(need.deltaS))}` : '–'} l={need ? `${need.deltaS > 0 ? 'πίσω' : 'μπροστά'} από το πλάνο · άφιξη ≈ ${fmtDur(need.projectedS)}` : 'σε σχέση με το πλάνο'} c={need ? (need.deltaS > 0 ? '#f97316' : '#22c55e') : undefined} />
        <Kpi v={live ? live.speedKmh.toFixed(1) : '–'} l="km/h" />
        <Kpi v={live ? pct(live.grade) : '–'} l={live?.gradeSrc === 'gps' ? 'κλίση (GPS, εκτός διαδρομής)' : 'κλίση (υψομετρικό)'} c={live ? gradeColor(live.grade) : undefined} />
        <Kpi v={live ? windLabel(live.head) : '–'} l={live ? `πλάγιος ${Math.abs(live.cross * 3.6).toFixed(0)} km/h ${live.cross > 0 ? 'από δεξιά' : 'από αριστερά'}` : 'άνεμος'} />
        <Kpi v={live ? fmtDur(live.elapsed) : '–'} l={`χρόνος / στόχος ${fmtDur(targetS)}`} />
        <Kpi v={live ? fmtKm(Math.max(0, live.left)) : '–'} l={live ? `απομένουν · ↑ ${Math.round(live.climbLeft)} m` : 'απομένουν'} />
        <Kpi v={live ? `${Math.round(live.avgPower)} W` : '–'} l="μέση ισχύς σε κίνηση" />
      </div>

      <div className={card}>
        <ProfileChart profile={data.profile} pieces={calc.pieces} plan={calc.smart} climbs={calc.climbs} atM={live?.distM ?? null} />
      </div>

      <BikeMap profile={data.profile} stops={data.stops} position={gps.position} follow={follow} className="h-56 overflow-hidden rounded-2xl" />

      {live?.parts && (
        <div className={card}>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">Πού πάνε τα watt τώρα</div>
          <Breakdown parts={live.parts} v={live.speedKmh / 3.6} eta={rider.eta} />
          <div className="mt-2 text-[11px] text-slate-500">
            Καιρός: {simulate || wxMode === 'manual' ? 'πρόγνωση/χειροκίνητος' : cond ? `live Open-Meteo ${new Date(cond.fetchedAt).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}` : 'φόρτωση…'}
            {w && ` · ${Math.round(w.windSpeed)} km/h από ${compass8(w.windDirection)} · ${w.temperature?.toFixed(0)}° · ρ ${live.rho.toFixed(3)}`}
            {!live.onRoute && live.off != null && ` · εκτός διαδρομής ${Math.round(live.off)} m`}
          </div>
        </div>
      )}

      <div className={card}>
        <div className="flex items-center justify-between">
          <div className="text-sm">Μετρητής ισχύος Bluetooth</div>
          {bluetoothSupported()
            ? (pm.status === 'on'
              ? <button className={`${btn} bg-slate-800`} onClick={pm.disconnect}>Αποσύνδεση {pm.name}</button>
              : <button className={`${btn} bg-slate-800`} onClick={pm.connect}>{pm.status === 'connecting' ? 'Σύνδεση…' : 'Σύνδεση'}</button>)
            : <span className="text-xs text-slate-500">μόνο Chrome σε Android/PC</span>}
        </div>
        {pm.error && <div className="mt-1 text-xs text-red-300">{pm.error}</div>}
        <div className="mt-1 text-[11px] text-slate-500">Χωρίς μετρητή τα watt είναι εκτίμηση από ταχύτητα, επιτάχυνση, κλίση και άνεμο (±10–15%). Με μετρητή βλέπεις τα πραγματικά.</div>
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
