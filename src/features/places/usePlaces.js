/** Saved places (Home, Work, custom) and recent destinations, stored on the phone. */
import { useCallback } from 'react';
import { useStoredState } from '../../lib/storage.js';

const DEFAULT_PLACES = [
  { id: 'home', icon: '🏠', name: 'Home', lat: null, lon: null, label: '' },
  { id: 'work', icon: '💼', name: 'Work', lat: null, lon: null, label: '' },
];
const MAX_RECENTS = 6;

export function usePlaces() {
  const [places, setPlaces] = useStoredState('ridewx.places.v1', DEFAULT_PLACES);
  const [recents, setRecents] = useStoredState('ridewx.recents.v1', []);
  // Saved routes: { id, from: place|null (null = my location), to: place }
  const [routes, setRoutes] = useStoredState('ridewx.routes.v1', []);

  const saveRoute = useCallback((from, to) => {
    const key = (p) => (p ? `${p.lat?.toFixed(4)},${p.lon?.toFixed(4)}` : 'me');
    setRoutes((rs) => {
      // Same pair in either direction counts as the same route (it's reversible).
      const exists = rs.some((r) => (key(r.from) === key(from) && key(r.to) === key(to)) || (key(r.from) === key(to) && key(r.to) === key(from)));
      return exists ? rs : [...rs, { id: `r${Date.now()}`, from, to }];
    });
  }, [setRoutes]);
  const removeRoute = useCallback((id) => setRoutes((rs) => rs.filter((r) => r.id !== id)), [setRoutes]);

  /** "home", "Work", "gym" typed in a box → the saved place with that name. */
  const findByName = useCallback((text) => {
    const t = (text || '').trim().toLocaleLowerCase();
    if (!t) return null;
    return places.find((p) => p.lat != null && p.name.toLocaleLowerCase() === t) || null;
  }, [places]);

  const savePlace = useCallback((place) => {
    setPlaces((ps) => {
      const i = ps.findIndex((p) => p.id === place.id);
      if (i < 0) return [...ps, place];
      const next = ps.slice();
      next[i] = { ...ps[i], ...place };
      return next;
    });
  }, [setPlaces]);

  const removePlace = useCallback((id) => {
    setPlaces((ps) =>
      id === 'home' || id === 'work'
        ? ps.map((p) => (p.id === id ? { ...p, lat: null, lon: null, label: '' } : p)) // keep the slot, clear it
        : ps.filter((p) => p.id !== id),
    );
  }, [setPlaces]);

  const addRecent = useCallback((dest) => {
    if (!dest || dest.lat == null) return;
    setRecents((rs) => {
      const same = (r) => Math.abs(r.lat - dest.lat) < 1e-3 && Math.abs(r.lon - dest.lon) < 1e-3;
      const name = dest.name || (dest.label || '').split(',')[0] || `${dest.lat.toFixed(3)}, ${dest.lon.toFixed(3)}`;
      return [{ lat: dest.lat, lon: dest.lon, label: dest.label, name, ts: Date.now() }, ...rs.filter((r) => !same(r))].slice(0, MAX_RECENTS);
    });
  }, [setRecents]);

  const clearRecents = useCallback(() => setRecents([]), [setRecents]);

  return { places, recents, routes, savePlace, removePlace, addRecent, clearRecents, saveRoute, removeRoute, findByName };
}
