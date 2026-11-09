# RideWX – Ride Companion PWA

Route weather · aviation-style crosswind · camera proximity alerts · acoustic engine load & fuel estimate.
100 % free data: OpenStreetMap tiles, OSRM routing, Nominatim geocoding, Open-Meteo weather, local GeoJSON.

## Second app: RideWX Watt (road cycling) – `bike.html`

Same build, own home-screen icon (`bike.webmanifest`). Answers *"what watts do I need to make it in N minutes?"*
and then coaches you live on the road.

- **Plan**: from → via → to (FOSSGIS OSRM bicycle routing), Copernicus DEM elevation every ~40 m, smoothed
  (σ 60 m) into a gradient profile; Open-Meteo forecast (wind, gusts, temp, humidity, pressure) at each point's ETA.
- **Physics** (`src/lib/cyclingPower.js`, unit-tested): aero with apparent wind at rider height (log profile),
  rolling, gravity, acceleration with wheel inertia, drivetrain losses, moist-air density moved to road height.
  Speed is integrated every 5 m with kinetic energy, so descents carry you into the next rise.
- **Two plans**: constant watts, and *smart pacing* (more on climbs/headwind, less on descents/tailwind, capped at
  % FTP) – same arrival time, lower average power. NP, %FTP, zone, sustainability check, climb-by-climb targets.
- **Live**: GPS → position on route → DEM gradient → live wind at the rider → estimated watts (3/10/30 s),
  target watts here, watts needed from here for the target, ahead/behind schedule. Optional Bluetooth power meter
  (Cycling Power Service, Chrome on Android/desktop). **Simulate** replays the plan at 1–20×.
- **Customisable**: several riders, bike presets (Factor Ostro VAM 2 …), position, tyres/road, wind exposure,
  manual CdA, pacing aggressiveness, coasting & descent speeds, stops – all saved on the phone.

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (localhost counts as a secure context for GPS)
npm test           # 22 unit tests for the geo / wind / camera / GPS math
npm run build      # static PWA in dist/ – deploy to any HTTPS static host
```

To try it at a desk: **Plan** a route → **Ride** tab → **Simulate**. That replays the route at 10× speed
through the same GPS pipeline, so the crosswind dial and camera alerts behave as they would on the road.
The sample cameras are around Athens, so plan for example `Syntagma, Athens` → `Kifisia`.

## Folder structure

```
ridewx/
├── index.html
├── package.json · vite.config.js
├── public/
│   ├── manifest.webmanifest        PWA manifest (standalone, portrait)
│   ├── sw.js                       Service worker: shell cache, tile cache, network-only APIs
│   ├── icons/icon.svg
│   └── data/cameras.geojson        SAMPLE camera dataset (placeholder points – replace)
├── src/
│   ├── main.jsx · App.jsx · index.css
│   ├── lib/                        Pure math – no React, fully unit-tested
│   │   ├── geo.js                  haversine, bearing, angle wrap, route resampling + ETA
│   │   ├── wind.js                 relative wind, head/cross components, apparent wind, drag, severity
│   │   └── gpsTracker.js           heading derivation & circular smoothing, route simulator
│   ├── services/                   Thin API clients
│   │   ├── osrm.js                 route + per-edge distance/duration annotations
│   │   ├── geocode.js              Nominatim (or raw "lat,lon")
│   │   └── openMeteo.js            batched multi-point forecast, time interpolation, current wind
│   ├── hooks/
│   │   ├── useGeolocation.js       watchPosition loop (or simulator) → trackerStep
│   │   └── useWakeLock.js          keep screen on while riding
│   ├── components/
│   │   └── MapView.jsx             Leaflet map: hazard-coloured route, cameras, position
│   └── features/
│       ├── routeWeather/           F1: useRouteWeather, hazard.js, RouteForm, RouteWeatherPanel
│       ├── crosswind/              F2: useLiveWind, CrosswindIndicator
│       ├── cameras/                F3: cameraEngine (pure), useCameraProximity, alertSound, CameraAlert
│       └── engineLoad/             F4: engineDsp (pure), useEngineAudio, EngineLoadGauge
└── tests/math.test.js
```

## Data flow

```
F1  form → geocode → OSRM (geometry + per-edge duration) → resample every 12 km
         → ETA = start + Σ edge durations → Open-Meteo hourly, interpolated to ETA
         → classifyHazard → coloured segments on map

GPS watchPosition (1 Hz) → trackerStep (validate, heading, speed) → position
         ├─ F2  useLiveWind (refetch per 5 km / 10 min) → analyzeWind(θ = WindFrom − Heading) → dial
         ├─ F3  proximityStep: spatial hash → haversine → ahead/direction filter → hysteresis state machine → alert
         └─ F4  speed for the noise floor & distance

F4  mic (AGC/NS/EC off) → high-pass → band-pass → FFT 4096 → band power (dB) & spectral centroid
         → loadDb = power − cruise floor[speed bucket] → green/orange/red (hysteresis)
         → L/100 = rated × f(loadDb) × fill-up correction → trip & since-fill-up litres
```

## Key design decisions

- **ETA uses OSRM per-edge durations**, not average speed, so motorway vs. town sections get realistic times.
- **Wind direction is interpolated as a vector**, never as a raw angle (350° and 010° average to 000°, not 180°).
- **Everything is degrees TRUE.** Open-Meteo wind and GNSS course are both true; if a magnetic compass
  heading is ever added, apply variation first (Athens ≈ +5° E).
- **Camera alerts use hysteresis** (alert at 500 m, passed when distance grows 60 m past minimum, re-arm at 800 m)
  plus ahead/direction filters, so GPS jitter and opposite carriageways don't cause false alarms.
- **Pure logic in `lib/` and `cameraEngine.js`** – testable in Node, reusable if you move to React Native later.

## Feature 4 – what the fuel figure means

The microphone measures **engine load relative to cruising at the same speed**, not fuel flow. Each 10 km/h
speed band has its own learned "cruise sound" level, so getting louder only because you're going faster doesn't
count as load. Consumption = typical L/100 × load factor × a correction learned from real fill-ups
(full tank → full tank). Expect a rough figure at first that firms up after 2–3 fill-ups, and only if the
monitor runs on every trip. Audio is processed on the device and never recorded or uploaded.

## Free-tier limits & production notes

| Service | Limit | Production path |
|---|---|---|
| OSRM demo server | Light use only, `driving` profile only | Self-host OSRM (Docker + Geofabrik Greece extract), set `VITE_OSRM_URL` |
| Nominatim | 1 req/s, no autocomplete | Self-host, or Photon (komoot) |
| Open-Meteo | 10 000 calls/day, **non-commercial** | Paid API key if the app is ever monetised |
| OSM tiles | No bulk/offline pre-download | A free-tier vector tile provider or self-hosted tiles for heavy use |

## Camera data – important

`cameras.geojson` holds **placeholder points only**. A real source is OSM nodes tagged
`highway=speed_camera` (export via Overpass Turbo). Laws on camera-location alerts differ by country
(for example, France bans showing exact positions and radar detectors are illegal in many EU countries,
Greece included). Fixed-camera databases are generally a different legal category from detectors,
but check the law where you'll ride or publish.
