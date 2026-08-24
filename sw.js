/* CiViX service worker.
   Two jobs only:
   1. Exist, with a fetch handler — Chrome requires this for the app to be
      installable, and the app must be installed for the share target to
      appear in the OS share sheet.
   2. Keep the capture page available offline, so a share never dead-ends
      when the user has no signal. */

const CACHE = 'civix-shell-v1';
const SHELL = [
  '/',
  '/capture.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll fails the whole install if any single file 404s, so add
      // them individually and tolerate misses.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try network, fall back to cache. Strip the query string on
  // the cache lookup so a shared link still resolves to the cached page.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(url.pathname) || caches.match('/capture.html'))
    );
    return;
  }

  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
