/**
 * React glue for the camera engine: loads /data/cameras.geojson once, then
 * runs proximityStep() on every new GPS fix (the `position` object changes
 * identity once per fix, so this effect IS the per-fix loop – no timers).
 */
import { useEffect, useRef, useState } from 'react';
import { indexCameras, proximityStep } from './cameraEngine.js';
import { playCameraAlert } from './alertSound.js';

export function useCameraProximity(position, { muted = false } = {}) {
  const [index, setIndex] = useState(null);
  const [active, setActive] = useState([]);
  const memory = useRef(new Map());

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/cameras.geojson`)
      .then((r) => r.json())
      .then((gj) => setIndex(indexCameras(gj)))
      .catch((e) => console.error('cameras.geojson failed to load', e));
  }, []);

  useEffect(() => {
    if (!index || !position) return;
    const { newAlerts, active: now } = proximityStep(index, memory.current, position);
    if (newAlerts.length && !muted) playCameraAlert(newAlerts[0]); // nearest only – don't stack voices
    setActive(now);
  }, [index, position, muted]);

  return { cameras: index?.cameras ?? [], active };
}
