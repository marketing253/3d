// Service worker: deixa o sistema instalável e abre a tela mesmo sem internet.
// Sempre busca a versão nova primeiro; o cache só é usado quando a rede falha.
const CACHE = "prec3d-v6"; // v6: painel em /admin
const BASE = ["/admin", "/app.css", "/app.js", "/fatiado.js", "/icon-192.png", "/manifest.webmanifest"];
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
  }).catch(() => caches.match(req).then(r => r || caches.match("/admin"))));
});

// Notificações de venda (pedido novo e pagamento), enviadas pelo servidor.
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = { corpo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || "8ON 3D", {
    body: d.corpo || "", tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || "/admin" },
    icon: "/icon-192.png", badge: "/favicon-32.png", vibrate: [120, 60, 120],
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/admin", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(cs => {
    const aberto = cs.find(c => new URL(c.url).pathname === "/admin");
    if (aberto) return aberto.focus().then(c => c.navigate ? c.navigate(url) : c);
    return self.clients.openWindow(url);
  }));
});
