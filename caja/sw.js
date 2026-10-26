// Caja Pa'l Antojo: funciona sin internet y recibe lo que se comparte desde WhatsApp (Android)
const CACHE = "caja-v2";
const ARCHIVOS = ["./", "./index.html", "./manifest.webmanifest", "./icono-192.png", "./icono-512.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function abrirDB() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open("pa-compartidos", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("items", { keyPath: "t" });
    r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
  });
}
async function guardarCompartido(item) {
  const db = await abrirDB();
  await new Promise(ok => { const tx = db.transaction("items", "readwrite"); tx.objectStore("items").put(item); tx.oncomplete = ok; tx.onerror = ok; });
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.pathname.endsWith("/compartir")) {
    e.respondWith((async () => {
      try {
        const f = await e.request.formData();
        const text = ["title", "text", "url"].map(k => f.get(k)).filter(Boolean).join("\n");
        const files = f.getAll("captures").filter(x => x && x.size);
        await guardarCompartido({ t: Date.now(), text, files });
      } catch (_) { }
      return Response.redirect(new URL("./?compartido=1", self.registration.scope).href, 303);
    })());
    return;
  }
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Primero internet; si no hay, lo guardado
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("./"))));
});
