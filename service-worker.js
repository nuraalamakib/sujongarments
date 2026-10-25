const CACHE_NAME = 'sujan-garments-v6-2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];
const CDN_HOSTS = new Set([
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        for (const url of APP_SHELL) {
          try { await cache.add(url); } catch (_) {}
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
    }
    return response;
  } catch (_) {
    return caches.match(request);
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Google Apps Script data calls are intentionally NOT cached.
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com')) {
    return;
  }

  // HTML navigation: network first, cached app shell as offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request).then(response =>
        response ||
        caches.match('./index.html') ||
        new Response('সুজন গার্মেন্টস অফলাইনে চলছে।', {
          status: 503,
          headers: {'Content-Type':'text/plain;charset=utf-8'}
        })
      )
    );
    return;
  }

  // Libraries/fonts: cache first after the first successful online load.
  if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Same-origin assets: cache first.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
