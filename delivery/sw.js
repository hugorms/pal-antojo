// App del repartidor: abre sin internet y muestra los avisos de pedidos aunque la app esté cerrada (Web Push)
const CACHE = "delivery-v2";
const ARCHIVOS = ["./", "./index.html", "./manifest.webmanifest", "../caja/acceso.js", "../caja/icono-192.png", "../caja/icono-512.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("delivery-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { cuerpo: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    await self.registration.showNotification(d.titulo || "Pa'l Antojo", {
      body: d.cuerpo || "", tag: d.tag || "pa-delivery", renotify: true, requireInteraction: /^oferta-/.test(d.tag || ""),
      vibrate: [300, 150, 300, 150, 300], icon: "../caja/icono-192.png", badge: "../caja/icono-192.png", data: { url: "./" },
    });
    // Si la app está abierta, que se actualice ya
    (await self.clients.matchAll({ type: "window" })).forEach(c => c.postMessage("latido"));
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil((async () => {
    const ws = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const w = ws.find(c => new URL(c.url).pathname.startsWith(new URL("./", self.registration.scope).pathname));
    if (w) { await w.focus(); w.postMessage("latido"); } else await self.clients.openWindow("./");
  })());
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("./"))));
});
