const CACHE = 'fineinvoice-v3';
const ASSETS = ['/', '/index.html', '/signup.html', '/signin.html', '/css/theme.css', '/js/utils.js', '/js/dashboard-entitlement-fix.js', '/logo.jpg', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || !/^https?:$/.test(url.protocol)) return;

  if (url.origin === self.location.origin && url.pathname.endsWith('/dashboard.html')) {
    event.respondWith(
      fetch(request).then(async response => {
        if (!response.ok) return response;
        const text = await response.text();
        if (text.includes('/js/dashboard-entitlement-fix.js')) return new Response(text, {status: response.status, headers: response.headers});
        const injected = text.replace('</body>', '<script src="/js/dashboard-entitlement-fix.js"></script></body>');
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        return new Response(injected, {status: response.status, statusText: response.statusText, headers});
      }).catch(() => caches.match(request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    fetch(request).then(response => {
      if (response && response.ok && /^https?:$/.test(new URL(response.url).protocol)) {
        const clone = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, clone).catch(() => {})).catch(() => {});
      }
      return response;
    }).catch(() => caches.match(request).then(cached => cached || caches.match('/index.html')))
  );
});
