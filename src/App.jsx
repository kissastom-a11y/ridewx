import { t, langChosen, LANGS, setLang, lang } from './lib/i18n.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './components/MapView.jsx';
import RouteForm, { nowLocal, showVal } from './features/routeWeather/RouteForm.jsx';
import RouteWeatherPanel from './features/routeWeather/RouteWeatherPanel.jsx';
import RideAhead from './features/routeWeather/RideAhead.jsx';
import { useRouteWeather } from './features/routeWeather/useRouteWeather.js';
import { useLiveWind } from './features/crosswind/useLiveWind.js';
import CameraAlert from './features/cameras/CameraAlert.jsx';
import { useCameraProximity } from './features/cameras/useCameraProximity.js';
import { unlockAudio } from './features/cameras/alertSound.js';
import EngineLoadGauge from './features/engineLoad/EngineLoadGauge.jsx';
import PlacesBar from './features/places/PlacesBar.jsx';
import { usePlaces } from './features/places/usePlaces.js';
import TrafficSetup from './features/traffic/TrafficSetup.jsx';
import LanguagePicker from './features/settings/LanguagePicker.jsx';
import { parseCommand } from './features/voice/commands.js';
import { useSpeechCommands, speechCommandsSupported } from './features/voice/useSpeechCommands.js';
import { REPLY } from './features/voice/replies.js';
import VoiceOverlay from './features/voice/VoiceOverlay.jsx';
import { instructionText } from './lib/voice.js';
import { weatherText } from './features/routeWeather/weatherIcons.js';
import { useGeolocation } from './hooks/useGeolocation.js';
import { useWakeLock } from './hooks/useWakeLock.js';
import { useCompass, fuseHeading, requestCompassPermission } from './hooks/useCompass.js';
import { useStoredState } from './lib/storage.js';
import { locateOnTrack } from './lib/track.js';
import RoadSummary from './features/roadInfo/RoadSummary.jsx';
import RoadAlert from './features/roadInfo/RoadAlert.jsx';
import { useRoadAlerts } from './features/roadInfo/useRoadAlerts.js';
import { useGuidance } from './features/guidance/useGuidance.js';
import ManeuverBanner from './features/guidance/ManeuverBanner.jsx';
import { useSpeedLimit } from './features/speed/useSpeedLimit.js';
import SpeedHud from './features/speed/SpeedHud.jsx';
import WindEdges from './features/crosswind/WindEdges.jsx';
import { say, V, setVoiceEnabled, hasGreekVoice } from './lib/voice.js';
import { analyzeWind } from './lib/wind.js';
import FuelPanel, { VehiclePicker } from './features/fuel/FuelPanel.jsx';
import { useFuel } from './features/fuel/useFuel.js';
import { useVibration, requestMotionPermission } from './features/fuel/useVibration.js';
import { presetById } from './features/fuel/vehicles.js';
import { updateCorrection as fuelCorrection } from './features/fuel/fuelModel.js';

const NO_CAMS = [];
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
  const [editRoute, setEditRoute] = useState(false);
  const [avoidTolls, setAvoidTolls] = useStoredState('ridewx.avoidTolls', false); // show search boxes while a route is displayed

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
  const osmCams = rw.roadInfo?.cameras ?? NO_CAMS; // stable reference – avoids re-render loops
  const { cameras, active } = useCameraProximity(riding ? position : null, { muted, extra: osmCams });

  // Where am I along the planned route? (null if no route or > 150 m off it)
  const progressM = useMemo(() => {
    if (!rw.track || !position) return null;
    const loc = locateOnTrack(rw.track, position.lat, position.lon);
    return loc && loc.off < 150 ? loc.distM : null;
  }, [rw.track, position]);

  // Cameras ON the route: OSM ones + our own dataset's that sit within 60 m of it.
  const routeCameras = useMemo(() => {
    if (!rw.track) return [];
    const local = cameras.filter((c) => !String(c.id).startsWith('osm-')).map((c) => {
      const loc = locateOnTrack(rw.track, c.lat, c.lon);
      return loc && loc.off <= 60 ? { ...c, distM: loc.distM } : null;
    }).filter(Boolean);
    return [...osmCams, ...local].sort((a, b) => a.distM - b.distM);
  }, [rw.track, osmCams, cameras]);

  const roadAlert = useRoadAlerts({ progress: progressM, roadInfo: rw.roadInfo, riding, muted });
  const [mapBearing, setMapBearing] = useState(0);
  const [engineSnap, setEngineSnap] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false); // while riding the panel stays small so the map gets the screen
  useEffect(() => { setVoiceEnabled(!muted); }, [muted]);

  // 🗣️ Greek turn-by-turn
  const guidance = useGuidance({ riding, progress: progressM, guide: rw.route?.guide, speedKmh: position?.speedKmh, muted });
  // 🚦 speed limit + speeding warning
  const speedInfo = useSpeedLimit({ riding, position, heading: fused.heading, progress: progressM, ranges: rw.roadInfo?.speeds, muted });
  // ⛽ Fuel: vehicle (chosen once, remembered) + per-vehicle fill-up calibration
  const [vs, setVs] = useStoredState('ridewx.vehicle.v1', { presetId: null, cal: {} });
  const vehicle = presetById(vs.presetId);
  const vstate = (vehicle && vs.cal?.[vehicle.id]) || { correction: 1, litresSinceFill: 0, fills: 0 };
  const setVstate = (patch) => setVs((o) => ({ ...o, cal: { ...(o.cal || {}), [o.presetId]: { ...((o.cal || {})[o.presetId] || { correction: 1, litresSinceFill: 0, fills: 0 }), ...patch } } }));
  const [pickerOpen, setPickerOpen] = useState(false);
  // Always listen: on iPhone events simply start flowing once permission is granted in the
  // Start-ride tap; newer Chrome also exposes requestPermission but may never answer it.
  const vib = useVibration(riding, position?.speedKmh);
  const headwindKmh = wind && fused.heading != null ? analyzeWind(wind, fused.heading, 0).headwind : 0;
  const fuel = useFuel({
    riding, position, vehicle, correction: vstate.correction, progress: progressM, profile: rw.profile,
    headwindKmh, tempC: wind?.temperature, engineSnap, vib,
  });
  const fuelRef = useRef(fuel);
  fuelRef.current = fuel;

  // 💨 strong crosswind warning (once per 5 min)
  const xwWarned = useRef(0);
  useEffect(() => {
    if (!riding || muted || !wind || fused.heading == null) return;
    const a = analyzeWind(wind, fused.heading, 0);
    if (a.severity === 'red' && a.quadrant === 'cross' && Date.now() - xwWarned.current > 300000) {
      xwWarned.current = Date.now();
      say(V().crosswind(a.side, Math.abs(a.gustCross)));
    }
  }, [riding, muted, wind, fused.heading]);
  const activeIds = useMemo(() => new Set(active.map((c) => c.id)), [active]);

  const myLocation = position ? { lat: position.lat, lon: position.lon, label: 'My location' } : null;

  /** Form value → something the planner understands: saved place, my location (null), or text to geocode. */
  const resolveVal = useCallback((v) => {
    if (v && typeof v === 'object' && v.isMe) return myLocation ? { ...v, ...myLocation, name: 'My location' } : null; // live GPS position
    if (v && typeof v === 'object') return v;
    if (!v || !v.trim()) return null;
    return pl.findByName(v) || v.trim();
  }, [pl, myLocation]);

  const asPoint = (v) => (v && typeof v === 'object' ? { lat: v.lat, lon: v.lon, label: v.label || v.name } : v);

  const runPlan = useCallback(async (fromV, toV, when) => {
    setLocalErr(null);
    setRouteSaved(false);
    const f = resolveVal(fromV);
    const dest = resolveVal(toV);
    if (!dest) return;
    const origin = f ? asPoint(f) : myLocation;
    if (!origin) { setLocalErr(t("Your location isn't available yet – allow location access or type a start point.")); return; }
    const res = await rw.plan({ from: origin, to: asPoint(dest), startTime: when || nowLocal(), trafficKey: trafficKey || null, avoidTolls });
    if (!res) return;
    // Remember both ends as place objects so the route can be saved & reversed.
    const toPlace = typeof dest === 'object' ? dest : { icon: '📍', name: dest.split(',')[0], lat: res.destination.lat, lon: res.destination.lon, label: res.destination.label };
    const fromPlace = !f || f.isMe ? null : typeof f === 'object' ? f : { icon: '📍', name: f.split(',')[0], lat: res.origin.lat, lon: res.origin.lon, label: res.origin.label };
    setLastPlan({ from: fromPlace, to: toPlace });
    setEditRoute(false);
    pl.addRecent({ ...res.destination, name: toPlace.name });
    return res;
  }, [resolveVal, myLocation, rw, trafficKey, pl, avoidTolls]);

  const goTo = (dest) => {
    const place = { icon: dest.icon || '🕘', name: dest.name, lat: dest.lat, lon: dest.lon, label: dest.label };
    setFromVal('');
    setToVal(place);
    setStartTime(nowLocal());
    return runPlan('', place);
  };

  const goRoute = (r, reverse) => {
    const a = reverse ? r.to : r.from;
    const b = reverse ? r.from : r.to;
    if (!b) { // reversing "my location → X" means X → my location
      if (!myLocation) { setLocalErr(t('Location not available yet')); return; }
    }
    const fromV = a || '';
    const toV = b || { icon: '📍', name: 'My location', isMe: true, ...myLocation };
    setFromVal(fromV);
    setToVal(toV);
    setStartTime(nowLocal());
    runPlan(fromV, toV);
  };

  const swap = () => {
    const f = fromVal || (myLocation ? { icon: '📍', name: 'My location', isMe: true, ...myLocation } : '');
    setFromVal(toVal);
    setToVal(f);
    if (rw.route) runPlan(toVal, f, startTime); // already had a route → show the reverse straight away
  };

  // ↺ Off the route for 4 fixes in a row (and GPS is good) → new route from here.
  const offCount = useRef(0);
  const lastReroute = useRef(0);
  useEffect(() => {
    if (!riding || simulate || !rw.track || !position || rw.status !== 'ready' || !lastPlan?.to) return;
    const loc = locateOnTrack(rw.track, position.lat, position.lon);
    const off = !loc || loc.off > 70;
    offCount.current = off && (position.accuracy ?? 99) < 50 ? offCount.current + 1 : 0;
    if (offCount.current >= 4 && Date.now() - lastReroute.current > 20000) {
      lastReroute.current = Date.now();
      offCount.current = 0;
      if (!muted) say(V().rerouting, { urgent: true });
      runPlan('', lastPlan.to, nowLocal());
    }
  }, [position]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRide = (sim) => {
    unlockAudio(); // must happen inside this tap (also unlocks the Greek voice on iOS)
    enableCompass(); // iOS asks for motion & orientation access here
    if (!muted) say(V().rideStart);
    requestMotionPermission(); // iOS: vibration sensor prompt
    if (!vehicle) setPickerOpen(true);
    setSimulate(sim);
    setRiding(true);
    setFollow(true);
    setTab('ride');
  };
  const stopRide = () => {
    // Add this trip's fuel to the "since last fill-up" counter for calibration.
    if (vehicle && fuelRef.current?.tripL > 0) setVstate({ litresSinceFill: vstate.litresSinceFill + fuelRef.current.tripL });
    setRiding(false);
    setFollow(false);
  };

  const onTrafficButton = () => {
    if (!trafficKey) setTrafficSetup(true);
    else setShowTraffic((v) => !v);
  };

  // ── 🎤 Voice commands ──────────────────────────────────────────────
  // Handlers read the latest state through a ref (recognition results arrive
  // asynchronously, after renders have moved on).
  const live = useRef({});
  live.current = { riding, rw, fuel, wind, fused, guidance, speedInfo, progressM, trafficKey, pl, lastPlan, goTo, runPlan, startRide, stopRide };
  const onVoice = useCallback(async (alts) => {
    const L = live.current;
    const c = parseCommand(alts, { places: L.pl.places });
    const speak = (txt) => say(txt, { urgent: true, force: true });
    const go = async (res, name, id) => {
      if (!res) return false;
      speak(REPLY.goingTo(name, Math.max(1, Math.round(res.durationS / 60)), id));
      if (!L.riding) L.startRide(false);
      return true;
    };
    switch (c.type) {
      case 'place': {
        const ok = await go(await L.goTo(c.place), t(c.place.name), c.place.id);
        if (!ok) speak(REPLY.notFound(t(c.place.name)));
        break;
      }
      case 'place_unset': speak(REPLY.placeUnset(c.placeId)); break;
      case 'navigate': {
        speak(REPLY.searching(c.query));
        setFromVal('');
        setToVal(c.query);
        const res = await L.runPlan('', c.query, nowLocal());
        if (!(await go(res, (res?.destination?.label || c.query).split(',')[0]))) speak(REPLY.notFound(c.query));
        break;
      }
      case 'stop': if (L.riding) L.stopRide(); speak(REPLY.stopped()); break;
      case 'start': if (!L.riding) L.startRide(false); break;
      case 'mute': speak(REPLY.muted()); setTimeout(() => setMuted(true), 1200); break;
      case 'unmute': setMuted(false); speak(REPLY.ok()); break;
      case 'fuel': speak(REPLY.fuel(L.fuel)); break;
      case 'weather': {
        const wps = L.rw.waypoints || [];
        if (wps.length) {
          const d = wps[wps.length - 1];
          let txt = REPLY.weatherDest('', d.etaUnix, d.weather, weatherText(d.weather.weatherCode));
          const from = L.progressM ?? 0;
          const rain = wps.find((w) => w.distM >= from && w.weather.precipitation >= 0.5);
          if (rain) txt += REPLY.rainAhead(Math.max(1, Math.round((rain.distM - from) / 1000)));
          speak(txt);
        } else if (L.wind) speak(REPLY.weatherHere(L.wind));
        else speak(REPLY.noWind());
        break;
      }
      case 'wind':
        if (L.wind && L.fused.heading != null) speak(REPLY.wind(analyzeWind(L.wind, L.fused.heading, 0), L.wind));
        else if (L.wind) speak(REPLY.weatherHere(L.wind));
        else speak(REPLY.noWind());
        break;
      case 'eta': {
        const r = L.rw.route;
        if (!r) { speak(REPLY.noRoute()); break; }
        const left = Math.max(0, r.distanceM - (L.progressM ?? 0));
        const etaUnix = L.riding ? Date.now() / 1000 + (r.durationS * left) / r.distanceM : r.startUnix + r.durationS;
        speak(REPLY.eta(etaUnix, left));
        break;
      }
      case 'next':
        if (L.guidance?.next) speak(instructionText(L.guidance.next, L.guidance.dist));
        else speak(REPLY.noRoute());
        break;
      case 'limit': speak(REPLY.limit(L.speedInfo.limit?.kmh)); break;
      case 'traffic_on': if (L.trafficKey) setShowTraffic(true); else setTrafficSetup(true); speak(REPLY.ok()); break;
      case 'traffic_off': setShowTraffic(false); speak(REPLY.ok()); break;
      case 'night': setTheme('night'); speak(REPLY.ok()); break;
      case 'day': setTheme('day'); speak(REPLY.ok()); break;
      case 'help': speak(REPLY.help()); break;
      default: speak(REPLY.unknown(c.heard));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sc = useSpeechCommands(onVoice);
  const onMic = () => { unlockAudio(); enableCompass(); sc.start(); };

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
          onBearing={setMapBearing}
          track={rw.track}
          roadInfo={rw.roadInfo}
          routeCameras={routeCameras}
          follow={riding && follow}
          onUserPan={() => setFollow(false)}
          focus={focus}
          theme={theme}
          traffic={trafficKey && showTraffic ? trafficKey : null}
        />
        {riding && <ManeuverBanner guidance={guidance} />}
        <VoiceOverlay sc={sc} />
        {riding && <WindEdges wind={wind} heading={fused.heading} screenUp={follow ? fused.heading : mapBearing} />}
        {riding && <SpeedHud speed={speedInfo.speed} limit={speedInfo.limit} over={speedInfo.over} />}
        {riding && (engineSnap || fuel) && (
          <div className="pointer-events-none absolute bottom-24 left-3 z-[900] flex gap-1.5">
            {engineSnap && <EngineChip snap={engineSnap} />}
            {fuel && (
              <div className="rounded-full bg-slate-900/85 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg">
                ⛽ {fuel.overrun ? '0.0' : fuel.l100 != null ? fuel.l100.toFixed(1) : fuel.lph.toFixed(1) + ' L/h'}
              </div>
            )}
          </div>
        )}
        {riding && (
          <div className={`absolute inset-x-0 h-0 ${guidance ? 'top-[84px]' : 'top-0'}`}>
            {active.length ? <CameraAlert active={active} />
              : <RoadAlert alert={roadAlert} distance={roadAlert && progressM != null ? roadAlert.at - progressM : null} />}
          </div>
        )}

        {/* Floating buttons */}
        <div className={`absolute right-3 z-[1100] flex flex-col gap-2 ${riding ? 'top-[44%] -translate-y-1/2' : 'top-32'}`}>
          {speechCommandsSupported && (
            <button className={`${fab} ${sc.listening ? 'animate-pulse !bg-red-600 !text-white' : '!bg-sky-600 !text-white'}`} onClick={onMic} title="Voice command">🎤</button>
          )}
          <button className={fab} onClick={() => setTheme(theme === 'day' ? 'night' : 'day')} title="Day / night map">
            {theme === 'day' ? '🌙' : '☀️'}
          </button>
          <button className={`${fab} ${trafficKey && showTraffic ? 'ring-4 ring-emerald-500' : ''}`} onClick={onTrafficButton} title="Traffic">🚦</button>
          <button className={fab} onClick={locate} title="My location">📍</button>
        </div>

        {riding && !follow && (
          <button onClick={() => setFollow(true)}
            className="absolute bottom-4 left-1/2 z-[900] -translate-x-1/2 rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg">
            {t('◎ Re-centre')}
          </button>
        )}
        {gpsError && (
          <div className="absolute inset-x-3 bottom-3 z-[900] rounded-lg bg-amber-500/95 p-2 text-xs font-medium text-slate-900">
            {t('📍 {e}. Allow location for this site in your browser settings, then reopen the app.', { e: gpsError })}
          </div>
        )}
      </div>

      {/* Bottom sheet */}
      <div className={`z-[1000] ${riding && tab === 'ride' && !sheetOpen ? 'max-h-[30dvh]' : 'max-h-[60dvh]'} space-y-3 overflow-y-auto rounded-t-2xl bg-slate-900 p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-[0_-8px_24px_rgba(0,0,0,.4)]`}>
        {riding && tab === 'ride' && (
          <button onClick={() => setSheetOpen((o) => !o)} className="mx-auto -mt-1 block h-1.5 w-12 rounded-full bg-slate-600" aria-label="Expand panel" />
        )}
        <div className="flex gap-1 rounded-lg bg-slate-800 p-1 text-sm">
          {['plan', 'ride'].map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 rounded-md py-1.5 font-semibold ${tab === k ? 'bg-slate-700 text-white' : 'text-slate-400'}`}>
              {t(k === 'plan' ? 'Plan' : 'Ride')}
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
                <div className="flex gap-2">
                  <button onClick={() => { const v = !avoidTolls; setAvoidTolls(v); }}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${avoidTolls ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300 ring-1 ring-slate-700'}`}>
                    💶 {t(avoidTolls ? 'Avoiding tolls' : 'Avoid tolls')}
                  </button>
                  {avoidTolls !== !!rw.route.avoidTolls && (
                    <button onClick={() => runPlan(lastPlan?.from || '', lastPlan?.to, nowLocal())} className="rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold">
                      {t('↻ Update route')}
                    </button>
                  )}
                </div>
                <RoadSummary route={rw.route} roadInfo={rw.roadInfo} cameraCount={routeCameras.length} />
                <RouteWeatherPanel route={rw.route} waypoints={rw.waypoints} destName={lastPlan?.to?.name}
                  onSelect={(w) => setFocus({ ...w, zoom: 12, t: Date.now() })}
                  onStart={!riding ? () => startRide(false) : null} />
                {lastPlan && (
                  <button disabled={routeSaved} onClick={() => { pl.saveRoute(lastPlan.from, lastPlan.to); setRouteSaved(true); }}
                    className="w-full rounded-lg bg-slate-800 py-2 text-sm text-slate-200 ring-1 ring-slate-700 disabled:text-emerald-400">
                    {t(routeSaved ? '✓ Saved to My routes' : '⭐ Save this route')}
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
                <button onClick={() => setAvoidTolls(!avoidTolls)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${avoidTolls ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300 ring-1 ring-slate-700'}`}>
                  💶 {t(avoidTolls ? 'Avoiding tolls ✓' : 'Avoid tolls')}
                </button>
                <RouteForm from={fromVal} to={toVal} setFrom={setFromVal} setTo={setToVal} startTime={startTime} setStartTime={setStartTime}
                  onSubmit={() => runPlan(fromVal, toVal, startTime)} onSwap={swap} busy={busy} places={pl.places} recents={pl.recents} />
                {rw.route && editRoute && (
                  <button onClick={() => setEditRoute(false)} className="text-xs text-slate-400 underline">{t('← Back to current route')}</button>
                )}
              </>
            )}
            {rw.status === 'routing' && <p className="text-xs text-slate-400">{t(trafficKey ? 'Finding route + live traffic…' : 'Finding route…')}</p>}
            {rw.status === 'weather' && <p className="text-xs text-slate-400">{t('Fetching weather for each point at your arrival time…')}</p>}
            {(rw.error || localErr) && <p className="text-xs text-red-400">{localErr || rw.error}</p>}
            <div className="flex items-center justify-between">
              <button onClick={() => setTrafficSetup(true)} className="text-xs text-slate-500 underline">
                {t(trafficKey ? 'Traffic settings' : 'Set up live traffic')}
              </button>
              <div className="flex gap-1 text-xs">
                {LANGS.map((l) => (
                  <button key={l.id} onClick={() => l.id !== lang() && setLang(l.id)}
                    className={`rounded-full px-2 py-0.5 ${l.id === lang() ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>
                    {l.flag} {l.id.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'ride' && (
          <>
            {!riding ? (
              <div className="flex gap-2">
                <button onClick={() => startRide(false)} className="flex-1 rounded-lg bg-emerald-600 py-3 font-semibold">{t('Start ride (GPS)')}</button>
                <button onClick={() => startRide(true)} disabled={!rw.route}
                  className="rounded-lg bg-slate-700 px-3 text-sm disabled:opacity-40" title="Replays the planned route at 10× speed">
                  {t('Simulate')}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={stopRide} className="flex-1 rounded-lg bg-red-700 py-2 font-semibold">{t('Stop')}</button>
                <button onClick={() => setMuted((m) => !m)} className="rounded-lg bg-slate-700 px-3 text-sm">{muted ? '🔇' : '🔊'}</button>
              </div>
            )}
            <RideAhead waypoints={rw.waypoints} profile={rw.profile} spots={rw.spots} route={rw.route} position={position}
              progressM={progressM} roadInfo={rw.roadInfo} routeCameras={routeCameras} />
            {riding && !hasGreekVoice() && (
              <p className="rounded-lg bg-amber-500/15 p-2 text-[11px] text-amber-200">
                {t('🗣️ No voice for your language on this phone yet – install one for the best sound.')}{' '}
                {t('Android: Settings → Text-to-speech → Google → install voice data. iPhone: Settings → Accessibility → Spoken Content → Voices.')}
              </p>
            )}
            <FuelPanel fuel={fuel} vehicle={vehicle} vstate={vstate} vib={vib} riding={riding}
              onOpenPicker={() => setPickerOpen(true)}
              onRefuel={(l) => setVstate({ correction: fuelCorrection(vstate.correction, l, vstate.litresSinceFill), litresSinceFill: 0, fills: vstate.fills + 1 })} />
            <EngineLoadGauge speedKmh={riding && position ? position.speedKmh : null} autoStart={riding} onSnap={setEngineSnap} kind={vehicle?.kind} />
          </>
        )}
      </div>

      {!langChosen() && <LanguagePicker />}
      {pickerOpen && <VehiclePicker selectedId={vs.presetId} onPick={(id) => setVs((o) => ({ ...o, presetId: id }))} onClose={() => setPickerOpen(false)} />}
      {trafficSetup && <TrafficSetup currentKey={trafficKey} onSave={(k) => { setTrafficKey(k); setShowTraffic(true); }} onClose={() => setTrafficSetup(false)} />}
    </div>
  );
}

/** Small engine-load pill on the map while riding. */
function EngineChip({ snap }) {
  const map = {
    learning: ['#8b5cf6', `🧠 ${Math.round((snap.progress || 0) * 100)}%`],
    green: ['#22c55e', '🟢 CRUISE'],
    orange: ['#f97316', '🟠 LOAD'],
    red: ['#dc2626', '🔴 HEAVY'],
  };
  const [c, label] = snap.phase === 'learning' ? map.learning : snap.calibrating ? ['#64748b', '… CAL'] : map[snap.state];
  return (
    <div className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white shadow-lg"
      style={{ background: c, opacity: snap.interfering ? 0.55 : 1 }}>
      {label}{snap.interfering ? ' ⏸' : ''}
    </div>
  );
}
