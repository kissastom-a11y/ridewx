/* RideWX service worker
 * - App shell: cache-first (works offline once loaded).
 * - cameras.geojson: stale-while-revalidate (alerts keep working with no signal).
 * - OSRM / Open-Meteo / Nominatim: network-only (forecasts must be fresh).
 * - OSM tiles: small runtime cache of tiles you've already viewed. Bulk
 *   pre-downloading tiles is against the OSM tile usage policy, so we don't.
 */
const VERSION = 'ridewx-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon.svg', './data/cameras.geojson'];
const TILE_CACHE = 'ridewx-tiles';
const MAX_TILES = 400;

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
  if (/open-meteo\.com|project-osrm\.org|nominatim\.openstreetmap\.org/.test(url.host)) return;

  if (url.host.endsWith('tile.openstreetmap.org')) {
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
        if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => caches.match('./index.html'))),
    );
  }
});
