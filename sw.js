const CACHE = 'fineinvoice-v4';
const ENTITLEMENT_SCRIPT = '/js/entitlement-sync.js';
const ASSETS = ['/', '/index.html', '/signup.html', '/signin.html', '/dashboard.html', '/app.html', '/invoices.html', '/customers.html', '/payment.html', '/css/theme.css', '/js/utils.js', ENTITLEMENT_SCRIPT, '/logo.jpg', '/manifest.json'];

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

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(fetch(request).then(async response => {
      if (!response.ok) return response;
      const type = response.headers.get('content-type') || '';
      if (!type.includes('text/html')) return response;
      const text = await response.text();
      if (text.includes(ENTITLEMENT_SCRIPT)) return new Response(text, {status: response.status, statusText: response.statusText, headers: response.headers});
      const injected = text.replace('</body>', `<script src="${ENTITLEMENT_SCRIPT}"></script></body>`);
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      return new Response(injected, {status: response.status, statusText: response.statusText, headers});
    }).catch(() => caches.match(request).then(cached => cached || caches.match('/index.html'))));
    return;
  }

  event.respondWith(fetch(request).then(response => {
    if (response && response.ok && /^https?:$/.test(new URL(response.url).protocol)) {
      const clone = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, clone).catch(() => {})).catch(() => {});
    }
    return response;
  }).catch(() => caches.match(request).then(cached => cached || caches.match('/index.html'))));
});
