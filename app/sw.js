// ── Service worker — POS "La Lupita" (offline) ──────────────────────────────
// Estrategia NETWORK-FIRST para archivos propios: intenta la red (así nunca sirve
// módulos ES viejos tras una actualización) y cae al caché cuando no hay conexión.
// En esta versión TODO es local (IndexedDB), no hay backend que excluir.
const CACHE = "lalupita-offline-v1"; // subir la versión al hacer cambios de ruptura
// Precache COMPLETO del shell: un arranque en frío debe encontrar TODOS los
// módulos, estilos, fuentes y el catálogo semilla ya cacheados.
const SHELL = [
  "/", "/index.html", "/main.js", "/config.js", "/manifest.webmanifest",
  "/styles/fonts.css", "/styles/tokens.css", "/styles/base.css", "/styles/ticket.css",
  "/assets/logo.png", "/assets/icon-192.png", "/assets/icon-512.png",
  // Fuentes vendorizadas (para funcionar sin CDN).
  "/assets/fonts/fraunces-500.woff2", "/assets/fonts/fraunces-600.woff2",
  "/assets/fonts/plexmono-400.woff2", "/assets/fonts/plexmono-500.woff2",
  "/assets/fonts/plexsans-400.woff2", "/assets/fonts/plexsans-500.woff2", "/assets/fonts/plexsans-600.woff2",
  // Datos semilla (catálogo real + configuración inicial).
  "/data/catalogo.json", "/data/config-inicial.json",
  // lib
  "/lib/almacen.js", "/lib/auth.js", "/lib/cola.js", "/lib/conexion.js",
  "/lib/config-runtime.js", "/lib/datos.js", "/lib/escaner.js", "/lib/estado.js",
  "/lib/router.js", "/lib/seed.js", "/lib/ui.js", "/lib/ventas.js",
  // screens
  "/screens/index.js", "/screens/bienvenida.js", "/screens/login.js", "/screens/venta.js",
  "/screens/pago.js", "/screens/ticket.js", "/screens/envases.js", "/screens/corte.js",
  "/screens/historial.js", "/screens/inventario.js", "/screens/combos.js",
  "/screens/promociones.js", "/screens/reportes.js", "/screens/configuracion.js",
  "/screens/usuarios.js",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  // Precache tolerante: si un archivo falla, NO se cae toda la precarga.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // recursos externos: sin interceptar
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request)), // solo si no hay red
  );
});
