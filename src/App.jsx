import { useCallback, useMemo, useState } from 'react';
import MapView from './components/MapView.jsx';
import RouteForm, { nowLocal, showVal } from './features/routeWeather/RouteForm.jsx';
import RouteWeatherPanel from './features/routeWeather/RouteWeatherPanel.jsx';
import RideAhead from './features/routeWeather/RideAhead.jsx';
import { useRouteWeather } from './features/routeWeather/useRouteWeather.js';
import CrosswindIndicator from './features/crosswind/CrosswindIndicator.jsx';
import { useLiveWind } from './features/crosswind/useLiveWind.js';
import CameraAlert from './features/cameras/CameraAlert.jsx';
import { useCameraProximity } from './features/cameras/useCameraProximity.js';
import { unlockAudio } from './features/cameras/alertSound.js';
import EngineLoadGauge from './features/engineLoad/EngineLoadGauge.jsx';
import PlacesBar from './features/places/PlacesBar.jsx';
import { usePlaces } from './features/places/usePlaces.js';
import TrafficSetup from './features/traffic/TrafficSetup.jsx';
import { useGeolocation } from './hooks/useGeolocation.js';
import { useWakeLock } from './hooks/useWakeLock.js';
import { useCompass, fuseHeading, requestCompassPermission } from './hooks/useCompass.js';
import { useStoredState } from './lib/storage.js';

const fab = 'flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-lg text-slate-800 shadow-lg active:bg-slate-200';

export default function App() {
  const rw = useRouteWeather();
  const pl = usePlaces();
  const [riding, setRiding] = useState(false);
  const [simulate, setSimulate] = useState(false);
  const [follow, setFollow] = useState(false);
  const [muted, setMuted] = useState(false);
  const [tab, setTab] = useState('plan'); // plan | ride
  const [focus, setFocus] = useState(null);
  const [localErr, setLocalErr] = useState(null);
  const [theme, setTheme] = useStoredState('ridewx.theme', 'day');
  const [trafficKey, setTrafficKey] = useStoredState('ridewx.tomtomKey', '');
  const [showTraffic, setShowTraffic] = useStoredState('ridewx.showTraffic', true);
  const [trafficSetup, setTrafficSetup] = useState(false);
  // Form values: '' | typed text | saved place object
  const [fromVal, setFromVal] = useState('');
  const [toVal, setToVal] = useState('');
  const [startTime, setStartTime] = useState(nowLocal());
  const [lastPlan, setLastPlan] = useState(null); // { from: place|null, to: place } for "Save route"
  const [routeSaved, setRouteSaved] = useState(false);
  const [editRoute, setEditRoute] = useState(false); // show search boxes while a route is displayed

  // Location is requested as soon as the app opens (that's when the browser asks permission).
  const { position, error: gpsError } = useGeolocation({
    enabled: true,
    simulateRoute: riding && simulate && rw.route ? rw.route : null,
    speedFactor: 10,
  });
  useWakeLock(riding);
  const [compassOn, setCompassOn] = useState(!(window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function'));
  const compass = useCompass(compassOn);
  // In simulation, ignore the real compass so the replay's heading drives everything.
  const fused = fuseHeading(position, riding && simulate ? null : compass);
  const enableCompass = () => { if (!compassOn) requestCompassPermission().then((ok) => ok && setCompassOn(true)); };
  const wind = useLiveWind(riding ? position : null);
  const { cameras, active } = useCameraProximity(riding ? position : null, { muted });
  const activeIds = useMemo(() => new Set(active.map((c) => c.id)), [active]);

  const myLocation = position ? { lat: position.lat, lon: position.lon, label: 'My location' } : null;

  /** Form value → something the planner understands: saved place, my location (null), or text to geocode. */
  const resolveVal = useCallback((v) => {
    if (v && typeof v === 'object') return v;
    if (!v || !v.trim()) return null;
    return pl.findByName(v) || v.trim();
  }, [pl]);

  const asPoint = (v) => (v && typeof v === 'object' ? { lat: v.lat, lon: v.lon, label: v.label || v.name } : v);

  const runPlan = useCallback(async (fromV, toV, when) => {
    setLocalErr(null);
    setRouteSaved(false);
    const f = resolveVal(fromV);
    const t = resolveVal(toV);
    if (!t) return;
    const origin = f ? asPoint(f) : myLocation;
    if (!origin) { setLocalErr('Your location isn\'t available yet – allow location access or type a start point.'); return; }
    const res = await rw.plan({ from: origin, to: asPoint(t), startTime: when || nowLocal(), trafficKey: trafficKey || null });
    if (!res) return;
    // Remember both ends as place objects so the route can be saved & reversed.
    const toPlace = typeof t === 'object' ? t : { icon: '📍', name: t.split(',')[0], lat: res.destination.lat, lon: res.destination.lon, label: res.destination.label };
    const fromPlace = !f ? null : typeof f === 'object' ? f : { icon: '📍', name: f.split(',')[0], lat: res.origin.lat, lon: res.origin.lon, label: res.origin.label };
    setLastPlan({ from: fromPlace, to: toPlace });
    setEditRoute(false);
    pl.addRecent({ ...res.destination, name: toPlace.name });
  }, [resolveVal, myLocation, rw, trafficKey, pl]);

  const goTo = (dest) => {
    const place = { icon: dest.icon || '🕘', name: dest.name, lat: dest.lat, lon: dest.lon, label: dest.label };
    setFromVal('');
    setToVal(place);
    setStartTime(nowLocal());
    runPlan('', place);
  };

  const goRoute = (r, reverse) => {
    const a = reverse ? r.to : r.from;
    const b = reverse ? r.from : r.to;
    if (!b) { // reversing "my location → X" means X → my location
      if (!myLocation) { setLocalErr('Your location isn\'t available yet.'); return; }
    }
    const fromV = a || '';
    const toV = b || { icon: '📍', name: 'My location', ...myLocation };
    setFromVal(fromV);
    setToVal(toV);
    setStartTime(nowLocal());
    runPlan(fromV, toV);
  };

  const swap = () => {
    const f = fromVal || (myLocation ? { icon: '📍', name: 'My location', ...myLocation } : '');
    setFromVal(toVal);
    setToVal(f);
    if (rw.route) runPlan(toVal, f, startTime); // already had a route → show the reverse straight away
  };

  const startRide = (sim) => {
    unlockAudio(); // must happen inside this tap
    enableCompass(); // iOS asks for motion & orientation access here
    setSimulate(sim);
    setRiding(true);
    setFollow(true);
    setTab('ride');
  };
  const stopRide = () => { setRiding(false); setFollow(false); };

  const onTrafficButton = () => {
    if (!trafficKey) setTrafficSetup(true);
    else setShowTraffic((v) => !v);
  };

  const locate = () => {
    enableCompass();
    if (!position) return;
    if (riding) setFollow(true);
    else setFocus({ lat: position.lat, lon: position.lon, zoom: 15, t: Date.now() });
  };

  const busy = rw.status === 'routing' || rw.status === 'weather';

  return (
    <div className="relative flex h-dvh flex-col text-slate-100">
      <div className="relative min-h-0 flex-1">
        <MapView
          segments={rw.segments}
          waypoints={rw.waypoints}
          cameras={cameras}
          activeIds={activeIds}
          position={position}
          heading={fused.heading}
          follow={riding && follow}
          onUserPan={() => setFollow(false)}
          focus={focus}
          theme={theme}
          traffic={trafficKey && showTraffic ? trafficKey : null}
        />
        {riding && <CameraAlert active={active} />}

        {/* Floating buttons */}
        <div className="absolute right-3 top-1/4 z-[900] flex flex-col gap-2">
          <button className={fab} onClick={() => setTheme(theme === 'day' ? 'night' : 'day')} title="Day / night map">
            {theme === 'day' ? '🌙' : '☀️'}
          </button>
          <button className={`${fab} ${trafficKey && showTraffic ? 'ring-4 ring-emerald-500' : ''}`} onClick={onTrafficButton} title="Traffic">🚦</button>
          <button className={fab} onClick={locate} title="My location">📍</button>
        </div>

        {riding && !follow && (
          <button onClick={() => setFollow(true)}
            className="absolute bottom-4 left-1/2 z-[900] -translate-x-1/2 rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg">
            ◎ Re-centre
          </button>
        )}
        {gpsError && (
          <div className="absolute inset-x-3 bottom-3 z-[900] rounded-lg bg-amber-500/95 p-2 text-xs font-medium text-slate-900">
            📍 {gpsError}. Allow location for this site in your browser settings, then reopen the app.
          </div>
        )}
      </div>

      {/* Bottom sheet */}
      <div className="z-[1000] max-h-[60dvh] space-y-3 overflow-y-auto rounded-t-2xl bg-slate-900 p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-[0_-8px_24px_rgba(0,0,0,.4)]">
        <div className="flex gap-1 rounded-lg bg-slate-800 p-1 text-sm">
          {['plan', 'ride'].map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 rounded-md py-1.5 font-semibold capitalize ${tab === t ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'plan' && (
          <>
            {rw.route && rw.status === 'ready' && !editRoute ? (
              <>
                <div className="flex gap-2 text-sm">
                  <button onClick={() => setEditRoute(true)} className="flex-1 truncate rounded-lg bg-slate-800 px-3 py-2 text-left text-slate-200 ring-1 ring-slate-700">
                    {showVal(lastPlan?.from) || '📍 My location'} → {showVal(lastPlan?.to)}
                  </button>
                  <button onClick={swap} title="Reverse" className="w-11 rounded-lg bg-slate-800 text-lg ring-1 ring-slate-700">⇅</button>
                  <button onClick={() => { rw.clear(); setLastPlan(null); setToVal(''); }} title="Close route"
                    className="w-11 rounded-lg bg-slate-800 ring-1 ring-slate-700">✕</button>
                </div>
                <RouteWeatherPanel route={rw.route} waypoints={rw.waypoints} destName={lastPlan?.to?.name}
                  onSelect={(w) => setFocus({ ...w, zoom: 12, t: Date.now() })}
                  onStart={!riding ? () => startRide(false) : null} />
                {lastPlan && (
                  <button disabled={routeSaved} onClick={() => { pl.saveRoute(lastPlan.from, lastPlan.to); setRouteSaved(true); }}
                    className="w-full rounded-lg bg-slate-800 py-2 text-sm text-slate-200 ring-1 ring-slate-700 disabled:text-emerald-400">
                    {routeSaved ? '✓ Saved to My routes' : '⭐ Save this route'}
                  </button>
                )}
              </>
            ) : (
              <>
                <PlacesBar
                  places={pl.places}
                  recents={pl.recents}
                  position={position}
                  onGo={goTo}
                  onSave={pl.savePlace}
                  onRemove={pl.removePlace}
                  onClearRecents={pl.clearRecents}
                  routes={pl.routes}
                  onGoRoute={goRoute}
                  onRemoveRoute={pl.removeRoute}
                />
                <RouteForm from={fromVal} to={toVal} setFrom={setFromVal} setTo={setToVal} startTime={startTime} setStartTime={setStartTime}
                  onSubmit={() => runPlan(fromVal, toVal, startTime)} onSwap={swap} busy={busy} places={pl.places} />
                {rw.route && editRoute && (
                  <button onClick={() => setEditRoute(false)} className="text-xs text-slate-400 underline">← Back to current route</button>
                )}
              </>
            )}
            {rw.status === 'routing' && <p className="text-xs text-slate-400">Finding route{trafficKey ? ' + live traffic' : ''}…</p>}
            {rw.status === 'weather' && <p className="text-xs text-slate-400">Fetching weather for each point at your arrival time…</p>}
            {(rw.error || localErr) && <p className="text-xs text-red-400">{localErr || rw.error}</p>}
            <button onClick={() => setTrafficSetup(true)} className="text-xs text-slate-500 underline">
              {trafficKey ? 'Traffic settings' : 'Set up live traffic'}
            </button>
          </>
        )}

        {tab === 'ride' && (
          <>
            {!riding ? (
              <div className="flex gap-2">
                <button onClick={() => startRide(false)} className="flex-1 rounded-lg bg-emerald-600 py-3 font-semibold">Start ride (GPS)</button>
                <button onClick={() => startRide(true)} disabled={!rw.route}
                  className="rounded-lg bg-slate-700 px-3 text-sm disabled:opacity-40" title="Replays the planned route at 10× speed">
                  Simulate
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={stopRide} className="flex-1 rounded-lg bg-red-700 py-2 font-semibold">Stop</button>
                <button onClick={() => setMuted((m) => !m)} className="rounded-lg bg-slate-700 px-3 text-sm">{muted ? '🔇' : '🔊'}</button>
              </div>
            )}
            <RideAhead waypoints={rw.waypoints} profile={rw.profile} spots={rw.spots} route={rw.route} position={position} />
            {riding && (
              <CrosswindIndicator wind={wind} heading={fused.heading} speedKmh={position?.speedKmh} headingSource={fused.source} />
            )}
            <EngineLoadGauge speedKmh={riding && position ? position.speedKmh : null} />
          </>
        )}
      </div>

      {trafficSetup && <TrafficSetup currentKey={trafficKey} onSave={(k) => { setTrafficKey(k); setShowTraffic(true); }} onClose={() => setTrafficSetup(false)} />}
    </div>
  );
}
