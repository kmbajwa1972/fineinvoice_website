const CACHE = 'fineinvoice-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/signup.html',
  '/signin.html',
  '/css/theme.css',
  '/js/utils.js',
  '/logo.jpg',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  // Cache Storage only accepts http(s) requests. Browser extensions,
  // devtools, file URLs, etc. must pass through untouched.
  if (request.method !== 'GET' || !/^https?:$/.test(new URL(request.url).protocol)) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok && /^https?:$/.test(new URL(response.url).protocol)) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => {
            cache.put(request, clone).catch(() => {});
          }).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('/index.html')))
  );
});
