/**
 * Vector map (MapLibre GL + OpenFreeMap – free, no key, no limits).
 * Smooth zoom/rotate/tilt like Google Maps. While riding with "follow" on it
 * goes heading-up with a 3D tilt, like a sat-nav; panning by hand stops following.
 *
 * All our overlays are GeoJSON sources. A style switch (day/night) wipes custom
 * layers, so they are (re)added on every 'style.load' from the cached data.
 */
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { HAZARD_COLORS, HAZARD_LABELS } from '../features/routeWeather/hazard.js';
import { trafficFlowTiles, trafficIncidentTiles } from '../services/tomtom.js';
import { weatherIcon } from '../features/routeWeather/weatherIcons.js';

export const MAP_STYLES = {
  day: 'https://tiles.openfreemap.org/styles/liberty',
  night: 'https://tiles.openfreemap.org/styles/dark',
};
const EMPTY = { type: 'FeatureCollection', features: [] };
const CAM_COLOR = { speed_camera: '#ef4444', redlight_camera: '#f59e0b', buslane_camera: '#3b82f6', enforcement_zone: '#a855f7' };
const fmtTime = (unix) => new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Polygon approximating a circle of radius r metres (for camera alert rings). */
function circle(lat, lon, r, n = 48) {
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    ring.push([lon + (r * Math.sin(a)) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.cos(a)) / 111320]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
}

function wpPopup(w) {
  const wx = w.weather;
  return `<b>${fmtTime(w.etaUnix)} · ${(w.distM / 1000).toFixed(0)} km</b><br/>` +
    `${HAZARD_LABELS[w.hazard.level]}${w.hazard.reasons.length ? ': ' + w.hazard.reasons.join(', ') : ''}<br/>` +
    `${wx.temperature.toFixed(1)} °C · ${wx.precipitation.toFixed(1)} mm/h · vis ${(wx.visibility / 1000).toFixed(1)} km<br/>` +
    `Wind ${Math.round(wx.windDirection)}° / ${Math.round(wx.windSpeed)} G${Math.round(wx.windGusts)} km/h<br/>` +
    `Crosswind on this road ≈ ${Math.abs(w.wind.crosswind).toFixed(0)} km/h ${w.wind.side}`;
}

export default function MapView({
  segments, waypoints, cameras, activeIds, position, heading = null, follow, onUserPan, focus, theme = 'day', traffic = null,
}) {
  const el = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const data = useRef({ route: EMPTY, wps: EMPTY, cams: EMPTY, rings: EMPTY });
  const trafficRef = useRef(traffic);
  const followRef = useRef(follow);
  const panRef = useRef(onUserPan);
  const firstFix = useRef(true);
  const headingRef = useRef(heading);
  headingRef.current = heading;
  const lastCenter = useRef(null);
  const posRef = useRef(position);
  posRef.current = position;
  const badges = useRef([]);
  trafficRef.current = traffic;
  followRef.current = follow;
  panRef.current = onUserPan;

  const syncTraffic = (m) => {
    for (const id of ['traffic-flow', 'traffic-inc']) {
      if (m.getLayer(id)) m.removeLayer(id);
      if (m.getSource(id)) m.removeSource(id);
    }
    const key = trafficRef.current;
    if (!key) return;
    const before = m.getLayer('route-casing') ? 'route-casing' : undefined;
    m.addSource('traffic-flow', { type: 'raster', tiles: [trafficFlowTiles(key)], tileSize: 256, attribution: '© TomTom' });
    m.addLayer({ id: 'traffic-flow', type: 'raster', source: 'traffic-flow', paint: { 'raster-opacity': 0.85 } }, before);
    m.addSource('traffic-inc', { type: 'raster', tiles: [trafficIncidentTiles(key)], tileSize: 256 });
    m.addLayer({ id: 'traffic-inc', type: 'raster', source: 'traffic-inc' }, before);
  };

  const addOverlays = (m) => {
    const d = data.current;
    for (const [id, fc] of Object.entries(d)) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: fc });
    m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#0b1220', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 16, 14], 'line-opacity': 0.55 } });
    m.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 16, 9] } });
    m.addLayer({ id: 'rings-fill', type: 'fill', source: 'rings', paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.12 } });
    m.addLayer({ id: 'rings-line', type: 'line', source: 'rings', paint: { 'line-color': '#ef4444', 'line-width': 1.5 } });
    m.addLayer({ id: 'cams', type: 'circle', source: 'cams',
      paint: {
        'circle-radius': ['case', ['get', 'hot'], 9, 6],
        'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
      } });
    syncTraffic(m);
  };

  // ── init once ──
  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current,
      style: MAP_STYLES[theme] || MAP_STYLES.day,
      center: [23.73, 37.98],
      zoom: 11,
      attributionControl: { compact: true },
      maxPitch: 60,
    });
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: false }), 'bottom-right');
    m.on('style.load', () => addOverlays(m));
    m.on('dragstart', (e) => { if (e.originalEvent) panRef.current?.(); });
    m.on('click', 'cams', (e) => {
      new maplibregl.Popup({ closeButton: false }).setLngLat(e.features[0].geometry.coordinates).setText(e.features[0].properties.label).addTo(m);
    });
    for (const l of ['cams']) {
      m.on('mouseenter', l, () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', l, () => { m.getCanvas().style.cursor = ''; });
    }

    // Position puck – chevron rotates with heading, aligned to the map.
    const puck = document.createElement('div');
    puck.innerHTML = `<svg viewBox="0 0 36 36" width="36" height="36">
      <circle cx="18" cy="18" r="15" fill="#2563eb" stroke="#fff" stroke-width="3"/>
      <path d="M18 7 L25 25 L18 21 L11 25 Z" fill="#fff"/></svg>`;
    puck.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,.4))';
    marker.current = new maplibregl.Marker({ element: puck, rotationAlignment: 'map', pitchAlignment: 'map' });

    map.current = m;
    return () => m.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── day / night ──
  const themeRef = useRef(theme);
  useEffect(() => {
    if (theme === themeRef.current) return; // initial style already set in the constructor
    themeRef.current = theme;
    map.current?.setStyle(MAP_STYLES[theme] || MAP_STYLES.day, { diff: false });
  }, [theme]);

  // ── traffic toggle ──
  useEffect(() => {
    const m = map.current;
    if (m?.isStyleLoaded()) syncTraffic(m);
  }, [traffic]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── route + waypoints ──
  useEffect(() => {
    const route = {
      type: 'FeatureCollection',
      features: (segments || []).map((s) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: s.points.map((p) => [p.lon, p.lat]) },
        properties: { color: HAZARD_COLORS[s.level] },
      })),
    };
    const wps = {
      type: 'FeatureCollection',
      features: (waypoints || []).map((w) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [w.lon, w.lat] },
        properties: { color: HAZARD_COLORS[w.hazard.level], html: wpPopup(w) },
      })),
    };
    // Weather badges (HTML markers: emoji + temperature) – visible without tapping.
    // Thin them out on long trips so they don't overlap; always keep the destination.
    badges.current.forEach((b) => b.remove());
    badges.current = [];
    const list = waypoints || [];
    const step = list.length > 14 ? Math.ceil(list.length / 12) : 1;
    list.forEach((w, i) => {
      const last = i === list.length - 1;
      if (!last && i % step !== 0) return;
      const el = document.createElement('div');
      const c = HAZARD_COLORS[w.hazard.level];
      el.style.cssText = `display:flex;align-items:center;gap:3px;padding:${last ? '4px 9px' : '2px 7px'};border-radius:999px;` +
        `background:#fff;border:2px solid ${c};box-shadow:0 2px 6px rgba(0,0,0,.35);font:600 ${last ? 14 : 12}px system-ui;color:#0f172a;cursor:pointer;white-space:nowrap`;
      el.innerHTML = `${last ? '🏁 ' : ''}<span style="font-size:${last ? 18 : 15}px">${weatherIcon(w.weather.weatherCode, w.etaUnix)}</span>` +
        `${Math.round(w.weather.temperature)}°${last ? ` <span style="font-weight:500;color:#475569">${fmtTime(w.etaUnix)}</span>` : ''}`;
      const mk = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] })
        .setLngLat([w.lon, w.lat])
        .setPopup(new maplibregl.Popup({ maxWidth: '260px', offset: 18 }).setHTML(wpPopup(w)));
      if (map.current) mk.addTo(map.current);
      badges.current.push(mk);

      // Wind vector on the WINDWARD side of the road, pointing at it.
      // The box is rotated by the wind's FROM bearing (true) and aligned to the
      // map, so its "top" faces where the wind comes from – the arrow drawn at
      // the top pointing to the centre therefore blows across the road exactly
      // as the real wind does, whatever way you rotate the map.
      const sev = { green: '#22c55e', orange: '#f97316', red: '#dc2626' }[w.wind.severity];
      const spd = w.weather.windSpeed * (w.exposure?.factor || 1);
      const len = Math.min(34, 14 + spd * 0.6);
      const sw = Math.min(7, 2.5 + spd / 10);
      const box = document.createElement('div');
      box.style.cssText = 'width:120px;height:120px;pointer-events:none';
      box.innerHTML = `<svg viewBox="0 0 120 120" width="120" height="120" style="overflow:visible;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))">
        <line x1="60" y1="${46 - len}" x2="60" y2="40" stroke="${sev}" stroke-width="${sw}" stroke-linecap="round"/>
        <path d="M${60 - sw - 4} 38 L${60 + sw + 4} 38 L60 50 Z" fill="${sev}"/>
        ${w.wind.severity !== 'green' ? `<text x="60" y="${40 - len}" text-anchor="middle" font-size="12" font-weight="700" fill="${sev}" stroke="#fff" stroke-width="3" paint-order="stroke">${Math.round(spd)}</text>` : ''}
      </svg>`;
      const arrow = new maplibregl.Marker({ element: box, rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat([w.lon, w.lat])
        .setRotation(w.weather.windDirection);
      if (map.current) arrow.addTo(map.current);
      badges.current.push(arrow);
    });

    data.current.route = route;
    data.current.wps = wps;
    const m = map.current;
    m?.getSource('route')?.setData(route);
    m?.getSource('wps')?.setData(wps);
    if (m && segments?.length && !followRef.current) {
      const b = new maplibregl.LngLatBounds();
      segments.forEach((s) => s.points.forEach((p) => b.extend([p.lon, p.lat])));
      m.fitBounds(b, { padding: 50, bearing: 0, pitch: 0, duration: 800 });
    }
  }, [segments, waypoints]);

  // ── cameras ──
  useEffect(() => {
    const cams = {
      type: 'FeatureCollection',
      features: cameras.map((c) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: { color: CAM_COLOR[c.type] || '#ef4444', hot: !!activeIds?.has(c.id), label: `${c.name || c.type}${c.maxspeed ? ` (${c.maxspeed})` : ''}` },
      })),
    };
    const rings = { type: 'FeatureCollection', features: cameras.filter((c) => activeIds?.has(c.id)).map((c) => circle(c.lat, c.lon, c.alertRadius)) };
    data.current.cams = cams;
    data.current.rings = rings;
    map.current?.getSource('cams')?.setData(cams);
    map.current?.getSource('rings')?.setData(rings);
  }, [cameras, activeIds]);

  // ── position / follow ──
  useEffect(() => {
    const m = map.current;
    if (!m || !position) return;
    marker.current.setLngLat([position.lon, position.lat]).setRotation(headingRef.current ?? 0).addTo(m);
    const moved = !lastCenter.current || Math.hypot(position.lat - lastCenter.current[0], position.lon - lastCenter.current[1]) > 2e-5;
    if (follow && moved) {
      lastCenter.current = [position.lat, position.lon];
      m.easeTo({
        center: [position.lon, position.lat],
        bearing: headingRef.current ?? m.getBearing(), // heading-up
        easing: (t) => t, // linear – consecutive 1 Hz fixes blend into continuous motion
        pitch: 50,
        zoom: Math.max(m.getZoom(), 15.5),
        // Shift the puck toward the bottom so you see more road ahead.
        offset: [0, Math.round(m.getContainer().clientHeight * 0.22)],
        duration: 1000,
      });
    } else if (firstFix.current && !segments?.length) {
      m.flyTo({ center: [position.lon, position.lat], zoom: 14 });
    }
    firstFix.current = false;
  }, [position, follow]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!follow) lastCenter.current = null; }, [follow]);

  // ── instant heading (compass ~15 Hz): rotate puck, and the map when following ──
  useEffect(() => {
    const m = map.current;
    if (!m || heading == null) return;
    marker.current?.setRotation(heading);
    // While a position glide is running it already carries the bearing; otherwise rotate now.
    if (follow && !m.isEasing() && posRef.current) {
      // Rotate around the puck (which sits below centre), not around the screen centre.
      m.easeTo({ center: [posRef.current.lon, posRef.current.lat], bearing: heading,
        offset: [0, Math.round(m.getContainer().clientHeight * 0.22)], duration: 0 });
    }
  }, [heading, follow]);

  // ── fly to a point on request ──
  useEffect(() => {
    if (focus) map.current?.flyTo({ center: [focus.lon, focus.lat], zoom: focus.zoom || 14, bearing: 0, pitch: 0 });
  }, [focus]);

  return <div ref={el} className="h-full w-full" />;
}
