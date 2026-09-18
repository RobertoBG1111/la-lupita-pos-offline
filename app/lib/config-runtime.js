// ── Configuración en runtime — versión OFFLINE ──────────────────────────────
// La verdad de la configuración de la tienda (negocio, apariencia, envases,
// ticket, reglas) vive en el store `configuracion` de IndexedDB (fila id=1). En el
// arranque mergeamos lo guardado SOBRE los defaults de config.js, así la app nunca
// se rompe si falta una clave. Las pantallas consumen `getConfig()` (síncrono, ya
// cacheado). Misma API que el oficial, pero sin Supabase.

import { CONFIG } from "../config.js";
import { obtenerConfig } from "./datos.js";

const clon = (x) => JSON.parse(JSON.stringify(x));
const esObjetoPlano = (x) => x && typeof x === "object" && !Array.isArray(x);

// Mergea `over` SOBRE `base`: objetos planos se combinan recursivamente; arrays y
// primitivos REEMPLAZAN completos (así una lista de envases guardada sustituye a
// la default en vez de mezclarse elemento por elemento).
function mergear(base, over) {
  if (!esObjetoPlano(base) || !esObjetoPlano(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = esObjetoPlano(base[k]) && esObjetoPlano(over[k]) ? mergear(base[k], over[k]) : over[k];
  }
  return out;
}

let _cfg = clon(CONFIG); // arranca con defaults hasta que cargarConfig() lea IndexedDB

/** Config efectiva (defaults + lo guardado). Síncrono; usar tras cargarConfig(). */
export function getConfig() { return _cfg; }

/** Lee la fila de configuración local y la mergea sobre los defaults. Tolerante a fallos. */
export async function cargarConfig() {
  try {
    const datos = await obtenerConfig();
    _cfg = mergear(clon(CONFIG), datos || {});
    return _cfg;
  } catch (e) {
    console.warn("No se pudo cargar la configuración local; se usan los valores por defecto.", e);
    _cfg = clon(CONFIG);
    return _cfg;
  }
}

/** Vuelve a mergear en memoria (tras guardar, sin recargar la app). */
export function fijarConfig(datos) {
  _cfg = mergear(clon(CONFIG), datos || {});
  return _cfg;
}

/** Escribe las variables CSS de :root desde APARIENCIA (colores del tema). */
export function aplicarTema(cfg = _cfg) {
  const a = cfg?.APARIENCIA || {};
  const root = document.documentElement.style;
  const set = (v, val) => { if (val) root.setProperty(v, val); };
  set("--ambar", a.acento);
  set("--fondo", a.fondo);
  set("--venta-promo", a.linea_promo);
  set("--venta-combo", a.linea_combo);
  set("--venta-agotado", a.linea_agotado);
  set("--venta-bajo", a.linea_bajo);
}
