/**
 * Open the Spotify app (or the web player if it isn't installed).
 *   Android: an intent link launches the app directly, falling back to the web player.
 *   iPhone:  the spotify: scheme opens the app; if nothing happens in ~1.2 s we
 *            open the web player instead.
 *   Desktop: web player in a new tab.
 * Note: while Spotify is in front, phones may pause GPS for this web app –
 * switch back to RideWX for directions and alerts.
 */
const WEB = 'https://open.spotify.com';

export function openSpotify() {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) {
    window.location.href = `intent://open#Intent;scheme=spotify;package=com.spotify.music;S.browser_fallback_url=${encodeURIComponent(WEB)};end`;
    return;
  }
  if (/iphone|ipad|ipod/i.test(ua)) {
    const t0 = Date.now();
    const timer = setTimeout(() => { if (Date.now() - t0 < 2500 && document.visibilityState === 'visible') window.location.href = WEB; }, 1200);
    document.addEventListener('visibilitychange', () => clearTimeout(timer), { once: true });
    window.location.href = 'spotify:';
    return;
  }
  window.open(WEB, '_blank', 'noopener');
}
