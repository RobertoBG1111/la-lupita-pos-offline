// ── Conexión — versión OFFLINE (stub) ──────────────────────────────────────
// En el POS oficial este módulo vigila la red para el modo sin conexión (banner +
// reinyección de la cola). En la versión offline TODO es local: no hay red que
// vigilar, así que siempre estamos "en línea" respecto a los datos (IndexedDB).
// Se conserva la MISMA API que el oficial para que las pantallas compartidas
// (corte.js, venta.js, main.js) se copien sin cambios.

/** Siempre true: los datos locales están siempre disponibles. */
export function estaOnline() { return true; }

/** No hay cambios de conexión que notificar. Devuelve un "desuscribir" no-op. */
export function alCambiarConexion(_fn) { return () => {}; }

/** No hay nada que monitorear en local. */
export function iniciarMonitor() { /* no-op */ }
