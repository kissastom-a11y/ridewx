/** MapLibre map: route coloured by gradient, stop markers, rider dot. Tap = callback (add a via point). */
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { gradeColor } from './ui.js';

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const EMPTY = { type: 'FeatureCollection', features: [] };

function routeFC(profile) {
  if (!profile?.length) return EMPTY;
  const f = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    f.push({ type: 'Feature', properties: { c: gradeColor(a.grade) }, geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } });
  }
  return { type: 'FeatureCollection', features: f };
}

export default function BikeMap({ profile, stops = [], position, follow, onTap, className = '' }) {
  const el = useRef(null);
  const map = useRef(null);
  const ready = useRef(false);
  const dot = useRef(null);
  const stopMarkers = useRef([]);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;
  const data = useRef(EMPTY);

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current, style: STYLE, center: [23.99, 37.93], zoom: 11, attributionControl: { compact: true } });
    map.current = m;
    m.on('load', () => {
      m.addSource('route', { type: 'geojson', data: data.current });
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': '#0f172a', 'line-width': 9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': ['get', 'c'], 'line-width': 6 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      ready.current = true;
    });
    m.on('click', (e) => tapRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    return () => m.remove();
  }, []);

  useEffect(() => {
    data.current = routeFC(profile);
    const m = map.current;
    const apply = () => {
      m.getSource('route')?.setData(data.current);
      if (profile?.length) {
        const b = new maplibregl.LngLatBounds();
        profile.forEach((p) => b.extend([p.lon, p.lat]));
        m.fitBounds(b, { padding: 40, duration: 600 });
      }
    };
    if (ready.current) apply(); else m.once('load', apply);
  }, [profile]);

  useEffect(() => {
    stopMarkers.current.forEach((mk) => mk.remove());
    stopMarkers.current = stops.filter((s) => s?.lat != null).map((s, i, arr) => {
      const d = document.createElement('div');
      const end = i === 0 ? '#22c55e' : i === arr.length - 1 ? '#ef4444' : '#38bdf8';
      d.style.cssText = `width:16px;height:16px;border-radius:50%;background:${end};border:3px solid #fff;box-shadow:0 1px 4px #0008`;
      return new maplibregl.Marker({ element: d }).setLngLat([s.lon, s.lat]).addTo(map.current);
    });
  }, [stops]);

  useEffect(() => {
    if (!position) return;
    if (!dot.current) {
      const d = document.createElement('div');
      d.style.cssText = 'width:20px;height:20px;border-radius:50%;background:#f97316;border:3px solid #fff;box-shadow:0 0 0 6px #f9731655';
      dot.current = new maplibregl.Marker({ element: d }).setLngLat([position.lon, position.lat]).addTo(map.current);
    } else dot.current.setLngLat([position.lon, position.lat]);
    if (follow) map.current.easeTo({ center: [position.lon, position.lat], zoom: Math.max(map.current.getZoom(), 14), duration: 800 });
  }, [position, follow]);

  return <div ref={el} className={className} />;
}
