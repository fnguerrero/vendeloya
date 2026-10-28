/* Service worker mínimo: hace instalable la app y la abre sin señal.
   Red primero: lo cacheado es solo el respaldo. Al tocar el shell, subir VERSION. */
const VERSION = 'vendeloya-13';
const SHELL = ['./', 'index.html', 'styles.css?v=17', 'config.js?v=1', 'app.js?v=16', 'editor.js?v=2', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Al Worker no se lo toca: sus respuestas no se cachean nunca.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { const copia = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request))
  );
});
