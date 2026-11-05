import { useMemo, useState } from 'react';
import MapView from './components/MapView.jsx';
import RouteForm from './features/routeWeather/RouteForm.jsx';
import RouteWeatherPanel from './features/routeWeather/RouteWeatherPanel.jsx';
import { useRouteWeather } from './features/routeWeather/useRouteWeather.js';
import CrosswindIndicator from './features/crosswind/CrosswindIndicator.jsx';
import { useLiveWind } from './features/crosswind/useLiveWind.js';
import CameraAlert from './features/cameras/CameraAlert.jsx';
import { useCameraProximity } from './features/cameras/useCameraProximity.js';
import { unlockAudio } from './features/cameras/alertSound.js';
import EngineLoadGauge from './features/engineLoad/EngineLoadGauge.jsx';
import { useGeolocation } from './hooks/useGeolocation.js';
import { useWakeLock } from './hooks/useWakeLock.js';

export default function App() {
  const rw = useRouteWeather();
  const [riding, setRiding] = useState(false);
  const [simulate, setSimulate] = useState(false);
  const [muted, setMuted] = useState(false);
  const [tab, setTab] = useState('plan'); // plan | ride
  const [focus, setFocus] = useState(null);

  const { position, error: gpsError } = useGeolocation({
    enabled: riding,
    simulateRoute: simulate && rw.route ? rw.route : null,
    speedFactor: 10,
  });
  useWakeLock(riding);
  const wind = useLiveWind(riding ? position : null);
  const { cameras, active } = useCameraProximity(riding ? position : null, { muted });
  const activeIds = useMemo(() => new Set(active.map((c) => c.id)), [active]);

  const startRide = (sim) => {
    unlockAudio(); // must happen inside this tap handler
    setSimulate(sim);
    setRiding(true);
    setTab('ride');
  };

  return (
    <div className="relative flex h-dvh flex-col text-slate-100">
      <div className="relative min-h-0 flex-1">
        <MapView
          segments={rw.segments}
          waypoints={rw.waypoints}
          cameras={cameras}
          position={position}
          activeIds={activeIds}
          follow={riding}
          focus={focus}
        />
        {riding && <CameraAlert active={active} />}
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
            <RouteForm onPlan={rw.plan} busy={rw.status === 'routing' || rw.status === 'weather'} />
            {rw.status === 'routing' && <p className="text-xs text-slate-400">Routing…</p>}
            {rw.status === 'weather' && <p className="text-xs text-slate-400">Fetching forecast for each waypoint at its ETA…</p>}
            {rw.error && <p className="text-xs text-red-400">{rw.error}</p>}
            <RouteWeatherPanel route={rw.route} waypoints={rw.waypoints} onSelect={setFocus} />
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
                <button onClick={() => setRiding(false)} className="flex-1 rounded-lg bg-red-700 py-2 font-semibold">Stop</button>
                <button onClick={() => setMuted((m) => !m)} className="rounded-lg bg-slate-700 px-3 text-sm">{muted ? '🔇' : '🔊'}</button>
              </div>
            )}
            {gpsError && <p className="text-xs text-red-400">{gpsError}</p>}
            {riding && (
              <CrosswindIndicator
                wind={wind}
                heading={position?.heading}
                speedKmh={position?.speedKmh}
                headingSource={position?.headingSource}
              />
            )}
            <EngineLoadGauge speedKmh={riding && position ? position.speedKmh : null} />
          </>
        )}
      </div>
    </div>
  );
}
