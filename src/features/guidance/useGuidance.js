/** Runs guidanceStep on every position update while riding and speaks in Greek. */
import { useEffect, useRef, useState } from 'react';
import { guidanceStep } from './guidance.js';
import { say } from '../../lib/voice.js';

export function useGuidance({ riding, progress, guide, speedKmh, muted }) {
  const said = useRef(new Set());
  const [state, setState] = useState(null);

  // New route or new ride → start fresh.
  useEffect(() => { said.current = new Set(); setState(null); }, [guide, riding]);

  useEffect(() => {
    if (!riding || progress == null || !guide?.length) return;
    const r = guidanceStep(guide, progress, speedKmh, said.current);
    setState(r.next ? { next: r.next, dist: r.dist } : null);
    if (r.speech && !muted) say(r.speech, { urgent: r.urgent });
  }, [riding, progress, guide, speedKmh, muted]);

  return state;
}
