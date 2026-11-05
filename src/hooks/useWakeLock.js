/** Keep the screen on while riding (Screen Wake Lock API, Chrome/Edge/Safari 16.4+). */
import { useEffect } from 'react';

export function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    const acquire = async () => {
      try { lock = await navigator.wakeLock.request('screen'); } catch { /* battery saver etc. */ }
    };
    acquire();
    // The lock is released whenever the tab is hidden; re-acquire on return.
    const onVis = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
