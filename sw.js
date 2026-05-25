var CACHE = 'ndal-v1';
var SHELL = [
  '/',
  '/index.html',
  '/src/js/init.js',
  '/src/js/bom.js',
  '/src/js/configgen.js',
  '/src/js/hld_diagram.js',
  '/src/js/ztp.js',
  '/src/js/jinja_engine.js',
  '/src/js/products.js',
  '/src/js/intent_constraints.js',
  '/src/js/bom_calculator.js',
  '/src/js/nlp_intent.js',
  '/src/js/troubleshoot.js',
  '/src/js/monitoring.js',
  '/src/js/topodisc.js',
  '/src/js/checks.js',
  '/src/js/deploy.js',
  '/src/js/rollback.js',
  '/src/js/cabling.js',
  '/src/js/optics.js',
  '/src/js/racklayout.js',
  '/src/js/tco.js',
  '/src/js/eol.js'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(SHELL); })
      .catch(function() { /* ignore individual failures */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(res) {
        if (res && res.status === 200) {
          var clone = res.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return res;
      });
    })
  );
});
