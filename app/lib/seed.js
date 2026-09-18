// ── Siembra del catálogo inicial ────────────────────────────────────────────
// La primera vez que arranca la app (base vacía), carga el catálogo real de la
// tienda —exportado del POS oficial (Supabase) a `data/catalogo.json`— y la
// configuración inicial (`data/config-inicial.json`) dentro de IndexedDB. Así el
// POS offline queda listo para vender sin capturar 600+ productos a mano. NO se
// siembran ventas, turnos ni usuarios: el historial arranca en cero y el primer
// admin se crea desde la pantalla de Bienvenida.

import { getAll, conTx, put, ahoraISO } from "./almacen.js";

const STORES_CATALOGO = [
  "productos", "presentaciones", "promociones",
  "promocion_presentaciones", "combos", "combo_items",
];

async function traerJSON(ruta) {
  const r = await fetch(ruta, { cache: "no-store" });
  if (!r.ok) throw new Error(`No se pudo cargar ${ruta} (${r.status})`);
  return r.json();
}

/**
 * Siembra el catálogo si la base está vacía. Devuelve true si sembró, false si ya
 * había datos. Tolerante: si faltan los archivos de datos, no rompe el arranque.
 */
export async function sembrarSiVacio() {
  let productos;
  try { productos = await getAll("productos"); } catch { return false; }
  if (productos.length) return false; // ya hay catálogo: no tocar nada

  let cat;
  try { cat = await traerJSON("data/catalogo.json"); }
  catch (e) { console.warn("Sin catálogo semilla:", e); return false; }

  const ahora = ahoraISO();
  await conTx(STORES_CATALOGO, "readwrite", async (api) => {
    for (const p of cat.productos || []) {
      await api.put("productos", { ...p, stock_actual: Number(p.stock_actual) || 0, created_at: p.created_at || ahora });
    }
    for (const pr of cat.presentaciones || []) {
      await api.put("presentaciones", { ...pr, created_at: pr.created_at || ahora });
    }
    for (const q of cat.promociones || []) await api.put("promociones", { ...q, created_at: q.created_at || ahora });
    for (const pp of cat.promocion_presentaciones || []) await api.put("promocion_presentaciones", pp);
    for (const c of cat.combos || []) await api.put("combos", { ...c, created_at: c.created_at || ahora });
    for (const ci of cat.combo_items || []) await api.put("combo_items", ci);
  });

  // Configuración inicial de la tienda (colores, envases, ticket, reglas).
  try {
    const cfg = await traerJSON("data/config-inicial.json");
    if (cfg && typeof cfg === "object") await put("configuracion", { id: 1, datos: cfg, updated_at: ahora });
  } catch (e) { console.warn("Sin configuración semilla (se usan defaults):", e); }

  console.info(`Catálogo sembrado: ${(cat.productos || []).length} productos, ${(cat.presentaciones || []).length} presentaciones.`);
  return true;
}
