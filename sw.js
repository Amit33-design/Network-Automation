const CACHE = 'netdesign-v1';
const ASSETS = ['/', '/index.html', '/src/css/main.css',
  '/src/js/state.js', '/src/js/app.js', '/src/js/init.js'];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(ASSETS))
));
self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return; // never cache API
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
