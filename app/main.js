// ── Arranque de la app — POS "La Lupita" (100% local, offline) ──────────────
import { $, activarGlow } from "./lib/ui.js";
import { montarRouter, registrarPantalla, ir, pantallaActual } from "./lib/router.js";
import { iniciarSesionPersistida, alCambiarSesion, perfil } from "./lib/auth.js";
import { cargarConfig, aplicarTema } from "./lib/config-runtime.js";
import { sembrarSiVacio } from "./lib/seed.js";
import { pantallas } from "./screens/index.js";

async function arranca() {
  const app = $("#app");
  montarRouter(app);
  for (const p of pantallas) registrarPantalla(p);
  activarGlow(document);

  // Primer arranque: siembra el catálogo real si la base está vacía.
  try { await sembrarSiVacio(); } catch (e) { console.warn("Siembra no disponible:", e); }

  // Configuración de la tienda (colores, envases, ticket, reglas) ANTES de pintar.
  try { await cargarConfig(); } catch (e) { console.warn("Configuración no disponible:", e); }
  aplicarTema();

  // Restaura la sesión del último usuario (si su perfil sigue activo).
  try { await iniciarSesionPersistida(); } catch (e) { console.warn("Sesión persistida no disponible:", e); }

  // Si en algún momento se pierde el perfil (cerrar turno / cambiar de usuario),
  // vuelve a Bienvenida.
  alCambiarSesion((s) => {
    if (!s?.perfil && !["bienvenida", "login"].includes(pantallaActual())) ir("bienvenida");
  });

  if (perfil()) ir("venta");
  else ir("bienvenida");
}

arranca().catch((e) => {
  console.error(e);
  document.getElementById("app").innerHTML =
    '<div class="cargando">No se pudo iniciar la app. Revisa la consola.</div>';
});

// PWA: registra el service worker (hace la app instalable y acelera la carga).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW:", e));
}
