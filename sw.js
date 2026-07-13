// Service worker de Mi TradingView
// Cachea la "carcasa" de la app (HTML/CSS/JS) para abrir al instante;
// los datos de mercado siempre van a la red.

const CACHE = 'mtv-shell-v23';

const ASSETS = [
  './',
  './index.html',
  './styles.css?v=23',
  './indicators.js?v=23',
  './app.js?v=23',
  './drawings.js?v=23',
  './lib/lightweight-charts.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // APIs externas (Binance, KuCoin, Yahoo, proxies): siempre red
  if (url.origin !== self.location.origin) return;

  // archivos propios: caché primero, red como respaldo (y actualiza el caché)
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const fetched = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || fetched;
    })
  );
});
