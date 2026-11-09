/* RideWX service worker
 * - Pages (index.html / navigations): NETWORK-FIRST, cache only as offline fallback.
 *   (v3 served a cached index.html first; after an update it pointed at JS files
 *   that no longer existed → blank page. Never again.)
 * - Hashed build files (assets/*): cache-first – their names change on every build.
 * - cameras.geojson: stale-while-revalidate (alerts keep working with no signal).
 * - OSRM / Open-Meteo / Nominatim: network-only (forecasts must be fresh).
 * - OpenFreeMap vector tiles/fonts/sprites: runtime cache of what you've viewed
 *   (so areas you've ridden through still show with weak signal). No bulk download.
 * - TomTom traffic: network-only (live data).
 */
const VERSION = 'ridewx-v6';
const SHELL = ['./', './index.html', './bike.html', './manifest.webmanifest', './bike.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './data/cameras.geojson'];
const TILE_CACHE = 'ridewx-tiles';
const MAX_TILES = 1500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== TILE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Live APIs: never serve stale weather/routes.
  if (/open-meteo\.com|project-osrm\.org|routing\.openstreetmap\.de|photon\.komoot\.io|nominatim\.openstreetmap\.org|tomtom\.com/.test(url.host)) return;

  if (url.host === 'tiles.openfreemap.org' && !url.pathname.startsWith('/styles/')) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === 'opaque') { cache.put(e.request, res.clone()); trimCache(TILE_CACHE, MAX_TILES); }
        return res;
      }),
    );
    return;
  }

  if (url.origin === self.location.origin && (e.request.mode === 'navigate' || url.pathname.endsWith('.html'))) {
    // Two apps share this worker: cache each page under its OWN name
    // (bike.html must never overwrite index.html in the cache, or vice versa).
    const page = url.pathname.endsWith('/bike.html') ? './bike.html' : './index.html';
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          // Clone NOW, before the page consumes the body (cloning later fails silently).
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(page, copy)); }
          return res;
        })
        .catch(() => caches.match(page)),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('.geojson')) {
      e.respondWith(
        caches.open(VERSION).then(async (cache) => {
          const hit = await cache.match(e.request);
          const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => hit);
          return hit || net;
        }),
      );
      return;
    }
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      }).catch(() => caches.match('./index.html'))),
    );
  }
});
