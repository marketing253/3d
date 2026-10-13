// Service worker: deixa o sistema instalável e abre a tela mesmo sem internet.
// Sempre busca a versão nova primeiro; o cache só é usado quando a rede falha.
const CACHE = "prec3d-v1";
const BASE = ["/", "/app.css", "/app.js", "/fatiado.js", "/icon-192.png", "/manifest.webmanifest"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== self.location.origin) return;
  if (!BASE.includes(u.pathname)) return; // API, fotos, catálogo e pedidos sempre direto da rede
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
    return r;
  }).catch(() => caches.match(req).then(r => r || caches.match("/"))));
});
