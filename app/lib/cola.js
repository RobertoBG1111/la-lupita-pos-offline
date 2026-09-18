// ── Cola de ventas offline — versión OFFLINE (stub) ─────────────────────────
// En el POS oficial, cuando se cae internet las ventas se ENCOLAN localmente y se
// reinyectan a la nube al reconectar. En esta versión 100% local la venta se
// escribe directo en IndexedDB (nunca queda "pendiente"), así que la cola siempre
// está vacía. Se conserva la MISMA API para no tocar las pantallas compartidas.

/** Nunca hay ventas pendientes de sincronizar en local. */
export async function contarPendientes() { return 0; }

/** No hay nada que sincronizar; la venta ya está persistida en IndexedDB. */
export async function sincronizar() { return { sincronizadas: 0, errores: 0 }; }

/** No aplica en local: la venta se registra directamente (ver datos.registrarVenta). */
export async function encolar(_payload) { /* no-op */ }
