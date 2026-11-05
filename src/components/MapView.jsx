/**
 * Leaflet map driven imperatively (one map instance, layer groups updated in
 * effects). Avoids react-leaflet re-render overhead on a 1 Hz GPS stream.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { HAZARD_COLORS, HAZARD_LABELS } from '../features/routeWeather/hazard.js';

const fmtTime = (unix) => new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const CAM_COLOR = { speed_camera: '#ef4444', redlight_camera: '#f59e0b', buslane_camera: '#3b82f6', enforcement_zone: '#a855f7' };

export default function MapView({ segments, waypoints, cameras, position, activeIds, follow, focus }) {
  const el = useRef(null);
  const map = useRef(null);
  const layers = useRef({});

  // Init once
  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([37.98, 23.73], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    layers.current = {
      route: L.layerGroup().addTo(m),
      wps: L.layerGroup().addTo(m),
      cams: L.layerGroup().addTo(m),
      me: L.layerGroup().addTo(m),
    };
    map.current = m;
    return () => m.remove();
  }, []);

  // Route: one polyline per waypoint-to-waypoint segment, coloured by hazard
  useEffect(() => {
    const { route, wps } = layers.current;
    route.clearLayers();
    wps.clearLayers();
    if (!segments?.length) return;

    for (const s of segments) {
      // dark casing underneath for contrast on the light OSM style
      L.polyline(s.points.map((p) => [p.lat, p.lon]), { color: '#0f172a', weight: 9, opacity: 0.6 }).addTo(route);
      L.polyline(s.points.map((p) => [p.lat, p.lon]), { color: HAZARD_COLORS[s.level], weight: 6 }).addTo(route);
    }
    for (const w of waypoints) {
      const wx = w.weather;
      L.circleMarker([w.lat, w.lon], { radius: 5, color: '#0f172a', weight: 2, fillColor: HAZARD_COLORS[w.hazard.level], fillOpacity: 1 })
        .bindPopup(
          `<b>${fmtTime(w.etaUnix)} · ${(w.distM / 1000).toFixed(0)} km</b><br/>` +
            `${HAZARD_LABELS[w.hazard.level]}${w.hazard.reasons.length ? ': ' + w.hazard.reasons.join(', ') : ''}<br/>` +
            `${wx.temperature.toFixed(1)} °C · ${wx.precipitation.toFixed(1)} mm/h · vis ${(wx.visibility / 1000).toFixed(1)} km<br/>` +
            `Wind ${Math.round(wx.windDirection)}° / ${Math.round(wx.windSpeed)} G${Math.round(wx.windGusts)} km/h<br/>` +
            `Est. crosswind on this road: ${Math.abs(w.wind.crosswind).toFixed(0)} km/h ${w.wind.side}`,
        )
        .addTo(wps);
    }
    const all = segments.flatMap((s) => s.points.map((p) => [p.lat, p.lon]));
    map.current.fitBounds(all, { padding: [30, 30] });
  }, [segments, waypoints]);

  // Cameras (redrawn when the active set changes, to show 500 m rings)
  useEffect(() => {
    const { cams } = layers.current;
    cams.clearLayers();
    for (const c of cameras) {
      const hot = activeIds?.has(c.id);
      if (hot) L.circle([c.lat, c.lon], { radius: c.alertRadius, color: '#ef4444', weight: 1, fillOpacity: 0.12 }).addTo(cams);
      L.circleMarker([c.lat, c.lon], { radius: hot ? 8 : 5, color: '#fff', weight: 2, fillColor: CAM_COLOR[c.type] || '#ef4444', fillOpacity: 1 })
        .bindTooltip(`${c.name || c.type}${c.maxspeed ? ` (${c.maxspeed})` : ''}`)
        .addTo(cams);
    }
  }, [cameras, activeIds]);

  // Current position + heading chevron
  useEffect(() => {
    const { me } = layers.current;
    me.clearLayers();
    if (!position) return;
    const rot = position.heading ?? 0;
    const icon = L.divIcon({
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      html: `<svg viewBox="0 0 28 28" width="28" height="28" style="transform:rotate(${rot}deg)">
               <circle cx="14" cy="14" r="12" fill="#0ea5e9" stroke="#fff" stroke-width="2"/>
               <path d="M14 5 L20 20 L14 16 L8 20 Z" fill="#fff"/></svg>`,
    });
    if (position.accuracy > 20) L.circle([position.lat, position.lon], { radius: position.accuracy, weight: 0, fillOpacity: 0.1 }).addTo(me);
    L.marker([position.lat, position.lon], { icon }).addTo(me);
    if (follow) map.current.panTo([position.lat, position.lon], { animate: true });
  }, [position, follow]);

  useEffect(() => {
    if (focus) map.current.setView([focus.lat, focus.lon], 12);
  }, [focus]);

  return <div ref={el} className="h-full w-full" />;
}
