const CACHE_NAME = 'lead-tracker-firebase-v2';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './queries.js',
  './firebase-config.js',
  './manifest.webmanifest',
  './icon.svg',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((c) => c || fetch(e.request).catch(() => caches.match('./index.html'))),
  );
});
