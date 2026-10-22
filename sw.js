/* ==========================================================================
   Service Worker - AntiGravity: Neon Pulse
   Architecture: Cache-First Assets, Stale-While-Revalidate Navigation,
                 Immediate Activation & 100% Offline Resilience
   ========================================================================== */

const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `antigravity-neon-pulse-${CACHE_VERSION}`;

// Pre-cached core application shell assets
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './src/display.js',
  './src/touch.js',
  './src/audio.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// 1. INSTALL LIFECYCLE: Pre-cache assets and skip waiting immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// 2. ACTIVATE LIFECYCLE: Purge obsolete cache generations and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('antigravity-neon-pulse-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      })
      .then(() => self.clients.claim())
  );
});

// 3. FETCH INTERCEPTION: Dual-Strategy with Query-String Independence
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Guard: Bypass non-GET requests (e.g. POST/PUT) and unsupported schemes (extensions, etc.)
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  // Strategy A: Navigation requests (HTML document launches, challenge links with query params)
  // Uses Stale-While-Revalidate matching cached index.html with ignoreSearch: true
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { ignoreSearch: true }).then((cachedIndex) => {
        const networkFetch = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put('./index.html', responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => cachedIndex);

        // Return cached index immediately for instantaneous offline launch, falling back to network
        return cachedIndex || networkFetch;
      })
    );
    return;
  }

  // Strategy B: Static Subresources (CSS, JS, Icons, Images) -> Cache-First with Network Fallback
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });

          return networkResponse;
        })
        .catch(() => {
          // Offline fallback for subresources if both cache and network fail
          if (request.destination === 'image') {
            return caches.match('./icons/icon.svg');
          }
          return new Response('Offline resource unavailable', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'Content-Type': 'text/plain' })
          });
        });
    })
  );
});
