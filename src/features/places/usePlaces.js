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

  return { places, recents, savePlace, removePlace, addRecent, clearRecents };
}
