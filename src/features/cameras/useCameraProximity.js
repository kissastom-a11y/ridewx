/**
 * React glue for the camera engine: loads /data/cameras.geojson once, merges in
 * cameras found along the planned route (OpenStreetMap), then runs proximityStep()
 * on every new GPS fix (the `position` object changes once per fix, so this effect
 * IS the per-fix loop – no timers).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { indexCameras, proximityStep } from './cameraEngine.js';
import { playCameraAlert } from './alertSound.js';

export function useCameraProximity(position, { muted = false, extra = [] } = {}) {
  const [base, setBase] = useState(null);
  const [active, setActive] = useState([]);
  const memory = useRef(new Map());

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/cameras.geojson`)
      .then((r) => r.json())
      .then(setBase)
      .catch((e) => console.error('cameras.geojson failed to load', e));
  }, []);

  const index = useMemo(() => {
    if (!base) return null;
    const extraFeatures = extra.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: { id: c.id, type: c.type, maxspeed: c.maxspeed, direction: c.direction, name: c.name },
    }));
    return indexCameras({ features: [...(base.features || []), ...extraFeatures] });
  }, [base, extra]);

  useEffect(() => {
    if (!index || !position) return;
    const { newAlerts, active: now } = proximityStep(index, memory.current, position);
    if (newAlerts.length && !muted) playCameraAlert(newAlerts[0]); // nearest only – don't stack voices
    setActive(now);
  }, [index, position, muted]);

  return { cameras: index?.cameras ?? [], active };
}
