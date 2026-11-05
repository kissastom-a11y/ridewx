/**
 * Heads-up for things on the road ahead while riding:
 *   🚇 tunnel within 500 m → "Tunnel ahead. Lights on."
 *   🟤 unpaved within 500 m → "Dirt road ahead, 3 kilometres."
 * Each event is announced once per ride. Uses along-route progress, so a
 * tunnel on a parallel road or behind you never triggers.
 */
import { t, kmLabel } from '../../lib/i18n.js';
import { useEffect, useRef, useState } from 'react';
import { announce } from '../cameras/alertSound.js';
import { V } from '../../lib/voice.js';

export const ROAD_ALERT_M = 500;

export function useRoadAlerts({ progress, roadInfo, riding, muted }) {
  const [alert, setAlert] = useState(null);
  const done = useRef(new Set());
  const timer = useRef(null);

  useEffect(() => { if (!riding) { done.current.clear(); setAlert(null); } }, [riding]);

  useEffect(() => {
    if (!riding || progress == null || !roadInfo) return;
    const events = [
      ...(roadInfo.tunnels || []).map((t) => ({ id: `t${Math.round(t.from)}`, kind: 'tunnel', at: t.from, len: t.lengthM })),
      ...(roadInfo.unpaved || []).map((u) => ({ id: `u${Math.round(u.from)}`, kind: 'unpaved', at: u.from, len: u.lengthM })),
    ];
    for (const e of events) {
      const ahead = e.at - progress;
      if (ahead > 0 && ahead <= ROAD_ALERT_M && !done.current.has(e.id)) {
        done.current.add(e.id);
        const lenTxt = e.len >= 1000 ? `${(e.len / 1000).toFixed(1)} ${kmLabel()}` : `${Math.round(e.len / 10) * 10} m`;
        const a = e.kind === 'tunnel'
          ? { at: e.at, kind: 'tunnel', title: t('TUNNEL AHEAD'), sub: t('💡 Lights on · {len}', { len: lenTxt }), ahead, speech: V().tunnel(e.len) }
          : { at: e.at, kind: 'unpaved', title: t('DIRT ROAD AHEAD'), sub: t('🟤 Unpaved for {len}', { len: lenTxt }), ahead, speech: V().dirt(e.len) };
        setAlert(a);
        if (!muted) announce(a.speech);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setAlert(null), 10000);
        break;
      }
    }
  }, [progress, roadInfo, riding, muted]);

  // Live countdown while the banner is up.
  const live = alert ? { ...alert } : null;
  return live;
}
