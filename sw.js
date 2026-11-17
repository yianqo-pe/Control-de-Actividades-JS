/* =====================================================================
   JESSDAY STYLE · Control de tiempo — service worker
   ---------------------------------------------------------------------
   - Permite instalar la app en el celular (Chrome lo exige).
   - Guarda solo los archivos de la propia app (index, estilos, código e íconos).
   - Estrategia "red primero": siempre intenta traer la versión más nueva de
     GitHub Pages; si no hay señal, usa la copia guardada.
   - NO toca Firebase, Google ni las fuentes: esas peticiones van directo a internet.
   ===================================================================== */
const CACHE = "jessday-v1"; // si algún día quieres forzar a limpiar lo guardado, cambia a v2, v3…
const ARCHIVOS = [
  "./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png", "icon-maskable-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // Cada archivo por separado: si uno falla, los demás igual se guardan
      .then(c => Promise.all(ARCHIVOS.map(a => c.add(a).catch(() => { /* se guardará en la primera visita */ }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);
  // Solo peticiones GET de esta misma página (GitHub Pages); lo demás pasa sin tocar
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then(res => {
        if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
        return res;
      })
      .catch(async () => {
        // Sin señal: usa la copia guardada (al abrir la app, el index.html)
        const guardado = await caches.match(req, { ignoreSearch: true });
        if (guardado) return guardado;
        if (req.mode === "navigate") return (await caches.match("index.html")) || (await caches.match("./"));
        return Response.error();
      })
  );
});